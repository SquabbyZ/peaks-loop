/**
 * `peaks sub-agent dispatch <role> ...` — slice 2026-06-07-sub-agent-context-governance.
 *
 * Pulled out of `sub-agent-commands.ts` (slice 2026-06-23-audit-p0-split) to
 * honor the 800-line file cap (Karpathy #2 Simplicity First). The single
 * `dispatch` action lives here; the `--from-dag` sibling was further split
 * into `dispatch-from-dag.ts` (slice 2026-06-23-audit-3rd #7) because the
 * two paths share no logic and the `--from-dag` codepath loads three heavy
 * modules on first call (slice 9 perf) that the warm-path single-dispatch
 * never touches.
 *
 * Skill-first / CLI-auxiliary red line (PB-4 / AC-19/20): this command is
 * a primitive that the peaks-code / peaks-rd / peaks-qa SKILL.md compose.
 * Users do NOT invoke it directly; the --help text and dispatch
 * envelope's `nextActions` reinforce the point.
 */
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawn as childProcessSpawn } from 'node:child_process';
import type { Command } from 'commander';
import { fail, getErrorMessage, ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { detectInstalledIde } from '../../services/ide/ide-detector.js';
import { getAdapter } from '../../services/ide/ide-registry.js';
import {
  SubAgentNotSupportedError,
  type SubAgentToolCall
} from '../../services/dispatch/sub-agent-dispatcher.js';
import {
  emitObservabilityEvent,
  OBSERVABILITY_SUBAGENT_ROLES,
  type ObservabilitySubagentRole
} from '../../services/observability/observability-service.js';
import { noteDispatched, BATCH_LIMIT } from '../../services/dispatch/batch-counter.js';
import { writeInitialDispatchRecord } from '../../services/dispatch/dispatch-record-writer.js';
import { evaluatePromptSize } from '../../services/context/context-guard.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';
import { buildArtifactMeta, buildContextImpact, type ArtifactMeta } from '../../services/context/artifact-meta.js';
import { assertSafeArtifactPath } from 'peaks-loop-shared-channel';
import { compressPrompt, type HeadroomResult } from '../../services/context/headroom-client.js';
import { resolveHeadroomOptions } from '../../services/context/headroom-prefs.js';
import { loadPreferences } from '../../services/preferences/preferences-service.js';
import { DEFAULT_PREFERENCES } from '../../services/preferences/preferences-types.js';
import { writeLogEntry } from '../../services/log/logger.js';
import {
  DispatchOptions,
  HEADROOM_MODES,
  PROMPT_LIMIT_BYTES,
  RECOMMENDED_ROLES,
  validateRole
} from './sub-agent-shared.js';
import { runDispatchFromDag } from './dispatch-from-dag.js';
import {
  TEST_TOOL_DETECTION_BLOCK,
  formatTestToolDetection
} from '../../services/dispatch/test-tool-detection.js';
import { MemoryPreflightService } from '../../services/context/memory-preflight-service.js';
import { buildDispatchSystemPrompt } from '../../services/context/build-dispatch-system-prompt.js';
import type { ContextPercentProbe } from '../../services/context/auto-compact-types.js';
import {
  createDispatchProvenanceToken,
  DISPATCH_PROVENANCE_ENV,
  writeDispatchProvenance,
} from '../../services/worktree/dispatch-provenance.js';

export function registerDispatchCommand(parent: Command, io: ProgramIO): void {
  addJsonOption(
    parent
      .command('dispatch')
      .description(
        'Build an IDE-specific tool-call descriptor for a sub-agent dispatch. ' +
        'Dry-run by design; the LLM executes the returned toolCall in its own ' +
        'environment. Flags: --write-artifact (G7), --use-headroom (G7.7), ' +
        '--force (G9 CLI 兜底). ' +
        'See skills/peaks-code/references/sub-agent-dispatch.md for the ' +
        'orchestrator contract.'
      )
      .argument('<role>', 'sub-agent role (e.g. rd | qa | ui | txt | qa-business | qa-business-api)')
      // 2.7.0 slice-dag-dispatcher MVP: --prompt is required ONLY when --from-dag is NOT
      // supplied. Previously this was `.requiredOption('--prompt')`, which blocked
      // `dispatch --from-dag <file>` calls because commander.js validates
      // `.requiredOption` before the action handler runs. The mutual-exclusion
      // check is enforced below in the action body (--prompt XOR --from-dag).
      .option('--prompt <text>', 'the prompt to send to the sub-agent (required unless --from-dag is provided)')
      .option('--prompt-length <bytes>', 'DOGFOOD ONLY: synthesize a prompt of this size (overrides --prompt content for size only; content is "x" repeated)')
      .option('--request-id <rid>', 'the same <rid> used by peaks request init')
      .option('--session-id <sid>', 'override active session id (default: resolve from .peaks/_runtime/session.json; falls back to PEAKS_SESSION_ID env var; final fallback "unknown-sid")')
      .option('--project <path>', 'target project root (defaults to cwd)')
      .option('--batch-id <uuid>', 'batch id for the dispatch (default: auto-generated UUID)')
      .option('--write-artifact <path>', 'G7: register an artifact file at <path>; CLI computes sha256 + size + writes ArtifactMeta to the dispatch record')
      .option('--use-headroom', 'G7.7/G9: compress the prompt via headroom-ai before dispatch (opt-in; falls back to G7 metadata-only if headroom unavailable)')
      .option('--headroom-mode <mode>', `G7.7: headroom mode (${HEADROOM_MODES.join(' | ')}); default balanced`)
      .option('--force', 'G9: override the 80% hard reject threshold at CLI (NOT allowed at hook layer per RL-30 strict)')
      .option('--from-dag <file>', '2.7.0 slice-dag-dispatcher MVP: read a SliceDag JSON file, dispatch one sub-agent per node in topological order; --batch-id overrides the auto-generated batch id (mutually exclusive with <role>)')
      .option('--isolation <mode>', 'slice 2026-07-29-worktree-l2-extended Part 2.C: isolation mode for the sub-agent. Accepts "worktree" (Part 2.C + Part 12 L2 surface), "container" (Part 8 contract + Part 12 L4 docker runtime), or "vm" (Part 25 contract; the VM runtime is a follow-up rid and fail-fasts with ISOLATION_VM_NOT_YET_IMPLEMENTED). Auto-spawns a lease + injects PEAKS_<MODE>_LEASE_ID into the dispatch envelope so the sub-agent can write to the isolated surface without a separate auth grant.')
  ).action(async (role: string, options: DispatchOptions) => {
    const asJson = options.json === true;
    // 2.7.0 slice-dag-dispatcher MVP: --from-dag short-circuits the single
    // sub-agent path and runs the full DAG plan via `dag-orchestrator`.
    if (typeof options.fromDag === 'string' && options.fromDag.length > 0) {
      await runDispatchFromDag(role, options, asJson, io);
      return;
    }
    const validation = validateRole(role);
    if (validation !== null) {
      printResult(io, fail('sub-agent.dispatch', 'INVALID_ROLE', validation, { role, toolCall: null, dispatchRecordPath: null } as never, [
        'Use a non-empty role string with no control characters.',
        `Recommended: ${RECOMMENDED_ROLES}.`
      ]), asJson);
      process.exitCode = 1;
      return;
    }
    // Slice 3 (on-demand-ecc) D-012: the `agent` role was removed in
    // 4.0.0-beta.11 — there is no longer a subprocess path for it
    // (the upstream ECC v2.0.0 ships no `ecc` binary). This guard
    // sits AFTER role validation but BEFORE the missing-prompt
    // check so an action-path dispatch with a valid prompt still
    // returns a clear ROLE_REMOVED envelope + exit 1. Note that
    // Commander short-circuits `--help` BEFORE `.action()` fires,
    // so `peaks sub-agent dispatch agent --help` continues to
    // exit 0 with the help text — that is intentional, not a bug.
    if (role === 'agent') {
      printResult(io, fail('sub-agent.dispatch', 'ROLE_REMOVED',
        'The agent role was removed in Slice 3',
        { role, reason: 'role-removed-in-slice-3', toolCall: null, dispatchRecordPath: null } as never, []), asJson);
      process.exitCode = 1;
      return;
    }
    if (!options.prompt || options.prompt.length === 0) {
      printResult(io, fail('sub-agent.dispatch', 'MISSING_PROMPT', '--prompt is required when --from-dag is not provided', { role, toolCall: null, dispatchRecordPath: null } as never, [
        'Re-run with either:',
        '  • `--prompt <text>` for single-role dispatch, OR',
        '  • `--from-dag <file>` for DAG-aware multi-slice dispatch (no --prompt needed; the per-slice prompt is generated from the DAG nodes).'
      ]), asJson);
      process.exitCode = 1;
      return;
    }

    // DOGFOOD ONLY: --prompt-length overrides the actual prompt content with
    // a synthetic prompt of the given size in bytes. The original --prompt
    // is still required (commander needs it). This avoids ARG_MAX limits
    // on Windows when the dogfood prompt is > 200KB.
    if (typeof options.promptLength === 'string' && options.promptLength.length > 0) {
      const len = Number.parseInt(options.promptLength, 10);
      if (Number.isInteger(len) && len > 0) {
        options.prompt = 'x'.repeat(len);
      }
    }
    if (options.prompt.length + TEST_TOOL_DETECTION_BLOCK.length > PROMPT_LIMIT_BYTES) {
      printResult(io, fail('sub-agent.dispatch', 'PROMPT_TOO_LARGE', `prompt exceeds ${PROMPT_LIMIT_BYTES} bytes (got ${options.prompt.length})`, { role, toolCall: null, dispatchRecordPath: null } as never, [
        'Truncate the prompt or split into multiple dispatches.',
        'Pass --force to override the 80% threshold at CLI (NOT allowed at hook layer).'
      ]), asJson);
      process.exitCode = 1;
      return;
    }

    // G9 CLI 兜底 — evaluate prompt size against the threshold table.
    const decision = evaluatePromptSize(options.prompt.length, { force: options.force === true });
    if (!decision.allow) {
      printResult(io, fail('sub-agent.dispatch', decision.code, `prompt size ${options.prompt.length} bytes exceeds threshold (tier=${decision.evaluation.tier}, ratio=${decision.evaluation.ratio.toFixed(3)})`, {
        role,
        toolCall: null,
        dispatchRecordPath: null
      } as never, [
        decision.suggest ?? 'Trim prompt or pass --force to override at CLI.',
        'PreToolUse hook layer will still reject regardless of --force (RL-30 strict).'
      ]), asJson);
      process.exitCode = 1;
      return;
    }

    try {
      const projectRoot = options.project ?? process.cwd();
      // Slice 2026-06-26-unknown-sid-fallback-fix: when --session-id is not
      // passed, auto-resolve the active peaks session id from
      // `.peaks/_runtime/session.json` (or PEAKS_SESSION_ID env var) so
      // dispatch records land in `.peaks/_sub_agents/<real-sid>/` instead
      // of the `unknown-sid` fallback. The unknown-sid branch is preserved
      // as the last-resort so callers without a bound session (e.g. an
      // ad-hoc dispatch in a fresh tree) still get a deterministic path.
      const sid = options.sessionId
        ?? process.env.PEAKS_SESSION_ID
        ?? getCurrentSessionId(projectRoot)
        ?? 'unknown-sid';
      const rid = options.requestId ?? 'unknown-rid';
      const batchId = options.batchId ?? randomUUID();

      // Slice 2026-07-29-worktree-l2-extended Part 2.C: --isolation worktree
      // auto-spawns a worktree lease and injects PEAKS_WORKTREE_LEASE_ID
      // into the sub-agent dispatch envelope. This is the bridge that
      // makes the lease-aware gate (Part 2.B) work for sub-agents:
      // without this injection, the gate has no leaseId to consult and
      // the sub-agent would need a separate `peaks worktree auth grant`.
      let isolationMode: 'worktree' | 'container' | 'vm' | null = null;
      let leaseId: string | null = null;
      let worktreePath: string | null = null;
      let worktreeBranch: string | null = null;
      if (typeof options.isolation === 'string' && options.isolation.length > 0) {
        if (options.isolation !== 'worktree' && options.isolation !== 'container' && options.isolation !== 'vm') {
          printResult(io, fail('sub-agent.dispatch', 'INVALID_ISOLATION', `--isolation only accepts "worktree" | "container" | "vm" (got "${options.isolation}")`, {
            role,
            toolCall: null,
            dispatchRecordPath: null
          } as never, ['Drop --isolation or pass --isolation worktree / --isolation container / --isolation vm.']), asJson);
          process.exitCode = 1;
          return;
        }
        if (options.isolation === 'container') {
          // Slice 2026-07-29-worktree-l2-extended Part 12: container
          // isolation is now live (Part 8 contract was the
          // bridge; Part 12 is the runtime). Shell out to
          // `peaks container spawn` to run `docker run` and
          // write the container lease.
          isolationMode = 'container';
          try {
            const spawnResult = await spawnContainerLease({
              projectRoot,
              sessionId: sid,
              rid,
              role,
              purpose: `auto-spawned by dispatch --isolation container (batch=${batchId})`
            });
            // Reuse the leaseId variable — same field semantically
            // (id of the isolation surface the dispatch owns).
            leaseId = spawnResult.leaseId;
          } catch (error) {
            printResult(io, fail('sub-agent.dispatch', 'ISOLATION_CONTAINER_SPAWN_FAILED', getErrorMessage(error), {
              role,
              toolCall: null,
              dispatchRecordPath: null
            } as never, [
              'The dispatch aborts when --isolation container lease spawn fails; retry without --isolation or fix the underlying docker error.',
              'For environments without a docker daemon, use --isolation worktree (the L2 production path).'
            ]), asJson);
            process.exitCode = 1;
            return;
          }
        }
        if (options.isolation === 'worktree') {
          isolationMode = 'worktree';
          try {
            const spawnResult = await spawnWorktreeLease({
              projectRoot,
              sessionId: sid,
              rid,
              role,
              purpose: `auto-spawned by dispatch --isolation worktree (batch=${batchId})`
            });
            leaseId = spawnResult.leaseId;
            worktreePath = spawnResult.path;
            worktreeBranch = spawnResult.branch;
          } catch (error) {
            printResult(io, fail('sub-agent.dispatch', 'ISOLATION_SPAWN_FAILED', getErrorMessage(error), {
              role,
              toolCall: null,
              dispatchRecordPath: null
            } as never, [
              'The dispatch aborts when --isolation worktree lease spawn fails; retry without --isolation or fix the underlying git error.'
            ]), asJson);
            process.exitCode = 1;
            return;
          }
        } else if (options.isolation === 'vm') {
          // Slice 2026-07-29-worktree-l2-extended Part 25: the
          // VM isolation mode is the L4 follow-up to L4 container.
          // The CLI contract is shipped (--isolation vm is accepted
          // by the dispatch parser and reflected in the envelope's
          // isolationMode type). The VM runtime (Linux KVM / macOS
          // HyperKit / Windows Hyper-V) is a much larger follow-up
          // and is intentionally not implemented yet — we
          // fail-fast with ISOLATION_VM_NOT_YET_IMPLEMENTED so
          // operators see a clear "this is a placeholder" signal
          // rather than a silent fallback to worktree.
          //
          // The full implementation lives in a future rid; the
          // design is:
          //   1. New service: src/services/vm/vm-lease.ts (parallels
          //      worktree-lease.ts / container-lease.ts) — pure lease
          //      store with vmId + hypervisor + status.
          //   2. CLI: 'peaks vm spawn --hypervisor kvm|hyperkit|hyperv
          //      --image <name> --rid <rid> --role <role>' — runs
          //      virsh create / hvftool / hvcreate, captures the
          //      vm id, writes the lease.
          //   3. CLI: 'peaks vm release --lease-id <id>' — virsh
          //      destroy + cleanup.
          //   4. dispatch --isolation vm: shells out to peaks vm
          //      spawn, injects PEAKS_VM_LEASE_ID env (parallel
          //      to PEAKS_CONTAINER_LEASE_ID).
          //   5. PreToolUse gate: when the env var is set AND the
          //      tool call is bash-with-vm-bearing-command,
          //      allow via the vm lease.
          //
          // Until then: fail-fast.
          printResult(io, fail('sub-agent.dispatch', 'ISOLATION_VM_NOT_YET_IMPLEMENTED', '--isolation vm is the L4 follow-up to --isolation container (Part 25 contract); the VM runtime (KVM / HyperKit / Hyper-V) is a much larger follow-up rid and is intentionally not implemented yet. Drop --isolation or pass --isolation worktree / --isolation container for now.', {
            role,
            toolCall: null,
            dispatchRecordPath: null
          } as never, [
            'The VM contract is shipped (--isolation vm is accepted by the dispatch parser); the runtime is the next rid.',
            'Use --isolation worktree (L2 production) or --isolation container (L4 docker, Part 12) for now.'
          ]), asJson);
          process.exitCode = 1;
          return;
        }
      }


      // G7.7 / G9: resolve headroom options from preferences + CLI overrides.
      // Preferences hard-block when headroom.enabled=false (returns HEADROOM_DISABLED_BY_PREFERENCE).
      // loadPreferences can throw on schema mismatch; we fall back to defaults to avoid
      // breaking the dispatch on a stale preferences.json file.
      let projectPrefs = DEFAULT_PREFERENCES;
      let headroomPrefs = DEFAULT_PREFERENCES.headroom;
      try {
        projectPrefs = loadPreferences(projectRoot);
        headroomPrefs = projectPrefs.headroom;
      } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
        // Keep default preferences; the user can re-run with explicit --headroom-mode
        // if they want to override the fallback.
      }
      const headroomResolved = resolveHeadroomOptions(headroomPrefs, {
        useHeadroom: options.useHeadroom === true,
        ...(options.headroomMode !== undefined ? { headroomMode: options.headroomMode } : {})
      });
      if (headroomResolved.blocked !== null) {
        printResult(io, fail('sub-agent.dispatch', headroomResolved.blocked, `headroom integration is disabled in preferences (headroom.enabled=false); pass --headroom-mode and update preferences first, or run without --use-headroom`, {
          role,
          toolCall: null,
          dispatchRecordPath: null
        } as never, [
          'Edit .peaks/preferences.json: set headroom.enabled = true (per-touchpoint mode is headroom.perTouchpoint.subAgentDispatch).',
          'Or re-run without --use-headroom to dispatch without compression.'
        ]), asJson);
        process.exitCode = 1;
        return;
      }

      const ide = detectInstalledIde(projectRoot) ?? 'claude-code';
      const adapter = getAdapter(ide);
      if (!adapter.subAgentDispatcher.supportsRole(role)) {
        printResult(io, fail('sub-agent.dispatch', 'IDE_NOT_SUPPORTED', `IDE ${ide} does not support role "${role}"`, { role, toolCall: null, dispatchRecordPath: null } as never, [
          'Switch to a registered IDE (e.g. claude-code) or pick a role the current IDE supports.'
        ]), asJson);
        process.exitCode = 1;
        return;
      }

      // G7.7 headroom compress (opt-in). If headroom fails or is unavailable,
      // fall back to the original prompt + emit warning.
      // Slice 2026-07-22-orchestrator-memory-preflight (Task 5): prepend the
      // memory preflight block (or silently skip when unavailable) via the
      // pure-function builder, BEFORE the headroom-ai compress step so the
      // compressor sees the augmented payload.
      const preflightService = new MemoryPreflightService(projectRoot, projectPrefs);
      const memoryBlock = await preflightService.fetchBlock(role);
      // Slice 2026-07-29-context-evaluation-accuracy: capture the
      // authoritative context-fill probe before composing the
      // dispatch prompt. The probe is token-counted (IDE adapter's
      // `compact` env-var), not a byte estimate. The composer
      // prepends a `## Context window` block so the dispatched
      // sub-agent reads the actual ratio instead of guessing
      // from message length (char/4 estimates diverge by 2-4x
      // and have caused false "context too low" reports at 60%+
      // free).
      let contextProbe: ContextPercentProbe | null = null;
      try {
        const { readContextPercent } = await import('../../services/context/auto-compact-reader.js');
        contextProbe = readContextPercent({
          projectRoot,
          sessionId: sid,
          env: process.env
        });
      } catch {
        // Probe is best-effort; the composer renders a
        // "no probe available" hint instead of failing the
        // dispatch.
      }
      const memoryAugmentedBody = buildDispatchSystemPrompt({
        taskTitle: role,
        taskBody: options.prompt,
        memoryBlock,
        contextProbe
      });
      // Part 2.C: when --isolation worktree, prepend an isolation envelope
      // block so the sub-agent sees the lease id + worktree path BEFORE
      // headroom-ai compress. The block is short (a few lines) and the
      // compressor is expected to keep it. We deliberately do NOT set
      // process.env.PEAKS_WORKTREE_LEASE_ID here — sub-agents are spawned
      // by the LLM in its own environment, not as children of this CLI;
      // the lease id travels through the dispatch record + prompt body.
      const isolationBlock = isolationMode !== null && leaseId !== null
        ? `\n## Worktree isolation (Part 2.C)\n` +
          `leaseId: ${leaseId}\n` +
          `worktreePath: ${worktreePath}\n` +
          `branch: ${worktreeBranch}\n` +
          `You MAY ` + '`git worktree add` ' + `and ` + '`git worktree remove` ' + `against this lease without a separate ` + '`peaks worktree auth grant` ' + `— the PreToolUse gate reads the lease file. Run ` + '`peaks worktree release --lease-id ${leaseId}` ' + `when done.\n`
        : '';
      let effectivePrompt = `${formatTestToolDetection()}\n\n${memoryAugmentedBody}${isolationBlock}`;
      let headroomCompressed = false;
      let headroomResult: HeadroomResult | null = null;
      const warnings: string[] = [...decision.warnings];

      if (headroomResolved.mode !== null) {
        headroomResult = await compressPrompt(effectivePrompt, headroomResolved.mode);
        if (headroomResult.warning !== null) {
          warnings.push(headroomResult.warning);
        }
        if (headroomResult.compressed && headroomResult.compressedPrompt !== null) {
          effectivePrompt = headroomResult.compressedPrompt;
          headroomCompressed = true;
        }
      }

      let toolCall: SubAgentToolCall;
      try {
        toolCall = adapter.subAgentDispatcher.buildToolCall({ role, prompt: effectivePrompt, requestId: rid, sessionId: sid });
        // Part 2.C: stamp the toolCall with `isolation` + a sub-agent
        // env block so adapters that surface it (Claude Code's Task
        // tool) propagate the lease id to the spawned process. The
        // env block is the canonical hook the PreToolUse gate reads
        // (gate-commands.ts: process.env.PEAKS_WORKTREE_LEASE_ID).
        if (isolationMode !== null && leaseId !== null) {
          const existingEnv = (toolCall.args['env'] as Record<string, string> | undefined) ?? {};
          const provenanceToken = createDispatchProvenanceToken({
            sessionId: sid,
            requestId: rid,
            leaseId,
          });
          if (isolationMode === 'worktree') {
            writeDispatchProvenance({
              projectRoot,
              record: {
                schemaVersion: 1,
                token: provenanceToken,
                sessionId: sid,
                requestId: rid,
                leaseId,
                isolation: 'worktree',
                issuedAt: new Date().toISOString(),
              },
            });
          }
          toolCall = {
            ...toolCall,
            args: {
              ...toolCall.args,
              isolation: isolationMode,
              env: {
                ...existingEnv,
                PEAKS_WORKTREE_LEASE_ID: leaseId,
                ...(isolationMode === 'worktree' ? { [DISPATCH_PROVENANCE_ENV]: provenanceToken } : {}),
              }
            }
          };
        }
        // Slice C of v2.11.1 — observability hook #2/7. Fire-and-forget
        // per PRD Q4 (full-auto must never fail-loud). The
        // synchronous emit returns {written:false} on disk-full; we
        // deliberately swallow the result so dispatch contract is
        // unchanged. role is only included when it matches the schema's
        // known sub-agent role set; otherwise it's omitted (non-standard
        // roles like 'qa-business' would otherwise drop the event
        // through schema rejection).
        const KNOWN_ROLES: ReadonlySet<string> = new Set(OBSERVABILITY_SUBAGENT_ROLES);
        const knownRole: ObservabilitySubagentRole | null = KNOWN_ROLES.has(role) ? role as ObservabilitySubagentRole : null;
        emitObservabilityEvent({
          schemaVersion: 1,
          ts: new Date().toISOString(),
          sessionId: sid,
          category: 'dispatch',
          ...(knownRole !== null ? { role: knownRole } : {}),
          detail: {
            requestId: rid,
            ide: adapter.subAgentDispatcher.label,
            promptBytes: effectivePrompt.length,
            headroomCompressed
          }
        }, { projectRoot });
      } catch (error: unknown) {
        if (error instanceof SubAgentNotSupportedError) {
          printResult(io, fail('sub-agent.dispatch', 'IDE_NOT_SUPPORTED', error.message, { role, toolCall: null, dispatchRecordPath: null } as never, [
            'Switch IDE or pick a role the current IDE supports.'
          ]), asJson);
          process.exitCode = 1;
          return;
        }
        throw error;
      }

      // G7 — optional --write-artifact: build ArtifactMeta, attach to record.
      let artifactMeta: ArtifactMeta | null = null;
      if (typeof options.writeArtifact === 'string' && options.writeArtifact.length > 0) {
        try {
          assertSafeArtifactPath(options.writeArtifact, projectRoot);
          if (!existsSync(options.writeArtifact)) {
            warnings.push('ARTIFACT_NOT_FOUND');
          } else {
            artifactMeta = buildArtifactMeta({
              path: options.writeArtifact,
              rid,
              role,
              idx: 1, // single dispatch, idx=1
              summary: null
            });
          }
        } catch (err) {
          warnings.push(`ARTIFACT_PATH_INVALID: ${getErrorMessage(err)}`);
        }
      }

      const { path: dispatchRecordPath } = writeInitialDispatchRecord({
        projectRoot,
        sessionId: sid,
        requestId: rid,
        role,
        prompt: effectivePrompt,
        toolCall,
        batchId,
        // Slice 2026-07-29-worktree-l2-extended Part 3.A: persist the
        // lease id on the dispatch record so the finalize-time
        // release hook (markCompleted / heartbeat --status done) can
        // auto-fire `peaks worktree release` when the sub-agent
        // completes. Null when --isolation was not requested.
        leaseId,
        // Slice 2026-07-29-worktree-l2-extended Part 7: stamp the
        // ISO timestamp when the isolation mode was set up. Null
        // when --isolation was not requested. The dashboard reads
        // this directly off the dispatch record to compute
        // isolation duration without cross-referencing the
        // metrics stream.
        isolationStartedAt: isolationMode !== null ? new Date().toISOString() : null
      });
      const counter = noteDispatched(projectRoot, sid, batchId);
      if (counter.warning) {
        warnings.push(counter.warning.message);
      }
      const contextImpact = buildContextImpact({
        promptSize: effectivePrompt.length,
        artifactSizes: artifactMeta ? [artifactMeta.size] : []
      });
      const nextActions = [
        'Tool call is dry-run; LLM must execute the tool to actually dispatch the sub-agent.',
        'After dispatching, the sub-agent should call `peaks sub-agent heartbeat --record ' + dispatchRecordPath + '` periodically.'
      ];
      if (counter.warning) {
        nextActions.push(`Batch is over the RL-1 limit (${BATCH_LIMIT}); consider splitting into multiple batches.`);
      }
      if (headroomResult && headroomResult.warning === 'HEADROOM_UNAVAILABLE') {
        nextActions.push('Headroom daemon unavailable; dispatched with G7 metadata-only fallback.');
      }
      const expectedCompletionSeconds = 45;
      const artifactsPublicPaths = typeof options.writeArtifact === 'string' && options.writeArtifact.length > 0
        ? [options.writeArtifact]
        : [];
      const orchestratorVisibleHint = `⏳ Spawning sub-agent via Task tool: ${role} for rid=${rid}, batch-id=${batchId} (ETA ~${expectedCompletionSeconds}s)`;
      printResult(io, ok('sub-agent.dispatch', {
        // Slice 2026-06-23-audit-4th #E1: every CLI envelope carries
        // an envelopeVersion marker so consumers can detect contract
        // changes (the previous #4 dropped `data.prompt` silently).
        envelopeVersion: '2.3.0',
        role,
        ide: adapter.subAgentDispatcher.label,
        // Slice 2026-06-23-audit-3rd #4: do NOT echo `prompt` in stdout.
        // Prompts can carry user content (sometimes test credentials /
        // internal URLs) that has no business landing in shell history,
        // log aggregators, or tmux scrollback. The dispatch record on
        // disk (gitignored under .peaks/_sub_agents/) keeps the prompt
        // for the sub-agent to read; CLI stdout stays metadata-only.
        // Surface promptSize + originalPromptSize so the LLM-side
        // runner can still reason about headroom without seeing the
        // content.
        originalPromptSize: options.prompt.length,
        promptSize: effectivePrompt.length,
        toolCall,
        dispatchRecordPath,
        batchId,
        dispatchedInBatch: counter.count,
        headroomCompressed,
        headroomResult: headroomResult
          ? {
              mode: headroomResult.mode,
              compressed: headroomResult.compressed,
              compressionRatio: headroomResult.compressionRatio,
              tokensSaved: headroomResult.tokensSaved,
              warning: headroomResult.warning
            }
          : null,
        forcedAt: decision.forcedAt,
        contextImpact,
        artifactMetas: artifactMeta ? [artifactMeta] : [],
        orchestratorVisibleHint,
        artifactsPublicPaths,
        expectedCompletionSeconds,
        // Part 2.C: when --isolation worktree, surface the lease
        // handle to the LLM-side runner so it can call
        // `peaks worktree release --lease-id <id>` after the sub-agent
        // finishes (or rely on the next gc pass to clean up). When
        // isolation is not requested, isolation === null.
        isolation: isolationMode,
        leaseId,
        worktreePath,
        worktreeBranch
      }, warnings, nextActions), asJson);
      // Slice 2026-06-23-audit-4th #B1: structured log on success path.
      // Best-effort: writeLogEntry swallows its own errors (logger.ts:155-159),
      // so a full disk or missing ~/.peaks/logs/ dir never blocks the dispatch.
      try {
        writeLogEntry({
          ts: new Date().toISOString(),
          level: 'info',
          command: 'sub-agent.dispatch',
          msg: 'dispatched',
          sessionId: sid,
          batchId,
          data: {
            rid,
            role,
            batchId,
            dispatchedInBatch: counter.count,
            headroomCompressed,
            forcedAt: decision.forcedAt
          }
        });
      } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
        /* best-effort */
      }
    } catch (error: unknown) {
      printResult(io, fail('sub-agent.dispatch', 'DISPATCH_ERROR', getErrorMessage(error), { role, toolCall: null, dispatchRecordPath: null } as never, [
        'See error message; if you are dispatching from a SKILL.md, the LLM should retry with a smaller prompt or pick a different role.'
      ]), asJson);
      process.exitCode = 1;
    }
  });
}

/**
 * 2.7.0 slice-dag-dispatcher MVP — see `dispatch-from-dag.ts`.
 * The function was pulled out of this file in slice 2026-06-23-audit-3rd
 * #7 to honor the 800-line file cap and isolate the three heavy
 * module loads (slice-dag / dag-orchestrator / contract-store) to the
 * --from-dag codepath only.
 */

/**
 * Part 2.C (slice 2026-07-29-worktree-l2-extended) — spawn a worktree
 * lease by shelling out to `peaks worktree spawn` (avoid re-implementing
 * the lease-write + git-worktree-add sequence in this file). The CLI
 * does the lease write, the git worktree add, AND the error handling;
 * we just parse the JSON envelope and surface the leaseId + path.
 *
 * Throws on spawn failure; the caller converts the error to a
 * ISOLATION_SPAWN_FAILED envelope. Synchronous wait is acceptable: the
 * dispatch is already async, the lease is a few hundred ms of FS work,
 * and we need the leaseId before we build the dispatch record.
 */
function spawnWorktreeLease(args: {
  projectRoot: string;
  sessionId: string;
  rid: string;
  role: string;
  purpose: string;
}): Promise<{ leaseId: string; path: string; branch: string; expiresAt: number }> {
  return new Promise((resolve, reject) => {
    const child = childProcessSpawn(process.execPath, [
      // The compiled CLI lives in dist/cli/peaks.js. We pass the entry
      // through node so the test suite (which also runs on the same
      // process) and the production binary share the same path. When
      // the binary is invoked as `peaks`, the package bin stub does
      // this for us; here we explicitly use process.execPath + the
      // resolved entry to avoid PATH surprises.
      process.argv[1] ?? '',
      'worktree', 'spawn',
      '--rid', args.rid,
      '--role', args.role,
      '--purpose', args.purpose,
      '--project', args.projectRoot,
      '--session', args.sessionId,
      '--json'
    ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: true });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    child.on('error', (err) => reject(new Error(`worktree spawn subprocess failed: ${err.message}`)));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`peaks worktree spawn exited ${code}; stderr: ${stderr.trim() || '(empty)'}`));
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout);
      } catch (err) {
        reject(new Error(`peaks worktree spawn produced unparseable JSON: ${(err as Error).message}; stdout: ${stdout.slice(0, 400)}`));
        return;
      }
      if (typeof parsed !== 'object' || parsed === null) {
        reject(new Error('peaks worktree spawn envelope is not an object'));
        return;
      }
      const env = parsed as { ok?: boolean; data?: { lease?: { leaseId: string; path: string; branch: string; expiresAt: number } } };
      if (env.ok !== true || !env.data?.lease) {
        reject(new Error(`peaks worktree spawn envelope missing lease; got: ${stdout.slice(0, 200)}`));
        return;
      }
      resolve({
        leaseId: env.data.lease.leaseId,
        path: env.data.lease.path,
        branch: env.data.lease.branch,
        expiresAt: env.data.lease.expiresAt
      });
      // Part 47: unref via setImmediate so the close handler
      // finishes first and Node's stdio 'end' events drain the
      // stdout/stderr buffers before the parent releases the
      // child handle. Without this microtask defer, the unref
      // races the buffered stdout close and the test receives
      // an empty JSON envelope.
      setImmediate(() => { child.unref(); });
    });
  });
}

/**
 * Slice 2026-07-29-worktree-l2-extended Part 12: container
 * isolation bridge. Shells out to `peaks container spawn` to
 * run `docker run` + write the container lease. Returns the
 * leaseId the dispatch record needs to persist. The shape is
 * a subset of the spawnWorktreeLease return (just leaseId);
 * we do not need the path/branch/expiresAt for the container
 * path because the envelope surfaces a different set of
 * fields (image + containerId; see container-lease.ts).
 */
function spawnContainerLease(args: {
  projectRoot: string;
  sessionId: string;
  rid: string;
  role: string;
  purpose: string;
}): Promise<{ leaseId: string }> {
  return new Promise((resolve, reject) => {
    const child = childProcessSpawn(process.execPath, [
      process.argv[1] ?? '',
      'container', 'spawn',
      '--rid', args.rid,
      '--role', args.role,
      '--purpose', args.purpose,
      '--project', args.projectRoot,
      '--session', args.sessionId,
      '--json'
    ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    child.on('error', (err) => reject(new Error(`container spawn subprocess failed: ${err.message}`)));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`peaks container spawn exited ${code}; stderr: ${stderr.trim() || '(empty)'}`));
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout);
      } catch (err) {
        reject(new Error(`peaks container spawn produced unparseable JSON: ${(err as Error).message}; stdout: ${stdout.slice(0, 400)}`));
        return;
      }
      if (typeof parsed !== 'object' || parsed === null) {
        reject(new Error('peaks container spawn envelope is not an object'));
        return;
      }
      const env = parsed as { ok?: boolean; data?: { lease?: { leaseId: string } } };
      if (env.ok !== true || !env.data?.lease) {
        reject(new Error(`peaks container spawn envelope missing lease; got: ${stdout.slice(0, 200)}`));
        return;
      }
      resolve({ leaseId: env.data.lease.leaseId });
    });
    // See spawnWorktreeLease above for the rationale.
    child.unref();
  });
}
