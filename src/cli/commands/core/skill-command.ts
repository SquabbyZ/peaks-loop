import type { Command } from 'commander';
import { runDoctor } from '../../../services/doctor/index.js';
import { listSkills } from '../../../services/skills/skill-registry.js';
import { runSkillSync, SYNC_PLATFORMS } from '../../../services/skills/sync-service.js';
import { inspectSkillRunbook } from '../../../services/skills/skill-runbook-service.js';
import { setSkillPresence, clearSkillPresence, getSkillPresence, isSkillPresenceMode, touchSkillHeartbeat, checkStalePresence } from '../../../services/skills/skill-presence-service.js';
import { detectPresenceMarker } from '../../../services/hooks/presence-marker-detector.js';
import { findProjectRoot } from '../../../services/config/config-safety.js';
import { generateProjectContext } from '../../../services/memory/project-context-service.js';
import { getSessionId, setSessionMeta } from '../../../services/session/session-manager.js';
import { resolveCallerProjection } from '../../../services/session/resolve-caller-id.js';
import { gcStalePresenceLeases } from '../../../services/skills/presence-lease-service.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { stableRealPath } from '../../../shared/path-utils.js';

/**
 * Canonicalize a user-supplied `--project <path>` value.
 *
 * Git Bash on Windows hands us forward-slash paths
 * (`C:/Users/.../peaks-loop`) while `peaks workspace init` writes the
 * backslash form, and either side may carry a trailing separator or
 * differing case. Resolving to the real path here means every
 * downstream consumer (`getSessionId`, `setSessionMeta`,
 * `setSkillPresence`) sees one stable form.
 *
 * Returns the input unchanged when it cannot be resolved (path does
 * not exist yet, or is not readable) so a bad `--project` still
 * reaches the existing error handling rather than throwing here.
 */
function canonicalizeProjectOption(project: string | undefined): string | undefined {
  if (project === undefined) return undefined;
  try {
    return stableRealPath(project);
  } catch {
    return project;
  }
}

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../../cli-helpers.js';
// Slice S0 (4.0.0-beta.5 peaks-solo dispatcher release):
// `peaks skill search` is the CLI primitive that feeds the
// peaks-solo dispatcher (S1). Adding a single import + register call
// here keeps the change surgical and leaves all existing skill
// subcommands (list / doctor / sync / runbook / presence / heartbeat)
// untouched. See
// docs/superpowers/specs/2026-07-08-peaks-solo-dispatcher-design.md §3.2
// and the S0 plan under docs/superpowers/plans/.
import { registerSkillSearchCommand } from '../skill-search-commands.js';

export function registerSkillCommand(program: Command, io: ProgramIO): void {
  const skill = program.command('skill').description('Manage Peaks skills');

  addJsonOption(skill.command('list').description('List skills derived from skills/*/SKILL.md').option('--include-internal', 'include skills with visibility: internal (default: hide them)')).action(async (options: { json?: boolean; includeInternal?: boolean }) => {
    let skills = await listSkills();
    if (options.includeInternal !== true) {
      skills = skills.filter((s) => s.visibility !== 'internal');
    }
    if (options.json === true) {
      printResult(io, ok('skill.list', { skills }), true);
    } else {
      const sorted = [...skills].sort((a, b) => {
        // Slice S0 (4.0.0-beta.5): peaks-solo is the dispatcher (front
        // door) — list it FIRST so users discover the dispatcher before
        // any specific leaf. Followed by peaks-sop (current default
        // runbook showcase) and peaks-code (canonical code-domain
        // orchestrator); everything else falls back to alphabetical.
        if (a.name === 'peaks-solo') return -1;
        if (b.name === 'peaks-solo') return 1;
        if (a.name === 'peaks-sop') return -1;
        if (b.name === 'peaks-sop') return 1;
        if (a.name === 'peaks-code') return -1;
        if (b.name === 'peaks-code') return 1;
        return a.name.localeCompare(b.name);
      });
      for (const skill of sorted) {
        io.stdout(`  ${skill.name.padEnd(14)}${skill.description}`);
      }
      io.stdout(`\n  Invoke any skill by typing its name in conversation (e.g. \`peaks-sop\`).`);
    }
  });

  addJsonOption(skill.command('doctor').description('Run skill-related doctor checks')).action(async (options: { json?: boolean }) => {
    const report = await runDoctor();
    const skillChecks = report.checks.filter((check) => check.id.startsWith('skill'));
    const failed = skillChecks.filter((check) => !check.ok).length;
    if (options.json === true) {
      printResult(io, ok('skill.doctor', { checks: skillChecks, ok: failed === 0 }), true);
    } else {
      for (const check of skillChecks) {
        const icon = check.ok ? '+' : '×';
        io.stdout(`  ${icon}  ${check.message}`);
      }
      io.stdout(`\n  ${skillChecks.length - failed} passed, ${failed} failed`);
      if (failed > 0) {
        io.stderr('\nOne or more skill checks failed.');
      }
    }
    if (failed > 0) {
      process.exitCode = 1;
    }
  });

  // Slice #12 final piece (per spec §9 line 1105):
  // `peaks skills sync 8 平台分发`. Idempotent: re-running is a
  // no-op when the symlinks are already correct.
  addJsonOption(
    skill
      .command('sync')
      .description(
        `Sync the peaks-* skill family to one or all of the 8 supported LLM-CLI platforms (${SYNC_PLATFORMS.join(', ')}). Idempotent.`
      )
      .option('--platform <id>', `sync only one platform (default: --all). Valid: ${SYNC_PLATFORMS.join(', ')}`)
      .option('--all', 'sync all 8 platforms (default if --platform is omitted)')
      .option('--dry-run', 'do not write; emit the same shape with applied=false')
      .option('--reconcile-junctions', 'repair Peaks-managed skill Junctions whose targets were deleted with a host worktree')
      .option('--project <path>', 'project root (default: cwd)')
  ).action(async (options: { platform?: string; all?: boolean; dryRun?: boolean; reconcileJunctions?: boolean; project?: string; json?: boolean }) => {
    try {
      const projectRoot = options.project ?? process.cwd();
      const platforms = options.platform !== undefined ? [options.platform as never] : undefined;
      const result = await runSkillSync({
        projectRoot,
        ...(platforms !== undefined ? { platforms } : {}),
        ...(options.dryRun === true ? { dryRun: true } : {}),
        ...(options.reconcileJunctions === true ? { reconcileJunctions: true } : {}),
      });
      const envelope = ok('skill.sync', result, [], [
        `syncedCount: ${result.syncedCount}/${result.perPlatform.length} platforms`,
        `totalInstalled: ${result.totalInstalled} skill symlinks`,
        result.failedCount > 0
          ? `failedCount: ${result.failedCount} (run \`peaks skill status\` for details)`
          : 'no failures',
      ]);
      printResult(io, envelope, options.json);
      if (result.failedCount > 0) {
        process.exitCode = 1;
      }
    } catch (error) {
      const message = getErrorMessage(error);
      printResult(
        io,
        fail('skill.sync', 'SKILL_SYNC_FAILED', message, { applied: false }, [message]),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    skill
      .command('runbook <name>')
      .description('Inspect a skill Default runbook section and its --apply authorization-note status')
  ).action(async (name: string, options: { json?: boolean }) => {
    try {
      const inspection = await inspectSkillRunbook(name);
      const result = inspection.ok
        ? ok('skill.runbook', inspection)
        : fail(
            'skill.runbook',
            inspection.hasRunbook ? 'SKILL_RUNBOOK_APPLY_UNGATED' : 'SKILL_RUNBOOK_MISSING',
            inspection.hasRunbook
              ? `Skill ${inspection.name} has ${inspection.destructiveApplyLines.length} destructive --apply command(s) without an authorization/dry-run note`
              : `Skill ${inspection.name} is missing a ## Default runbook section`,
            inspection,
            inspection.hasRunbook
              ? ['Add an authorization or --dry-run note next to destructive --apply lines in the runbook section']
              : ['Add a `## Default runbook` section to the skill SKILL.md']
          );
      printResult(io, result, options.json);
      if (!inspection.ok) {
        process.exitCode = 1;
      }
    } catch (error) {
      printResult(
        io,
        fail('skill.runbook', 'SKILL_NOT_FOUND', getErrorMessage(error), { name }),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    skill
      .command('presence')
      .description('Show the currently active Peaks skill (alias: presence:get)')
      .option('--check-stale', 'slice 002 (v2.15.0): also report whether the recorded outer session id still matches the current one. Default false (back-compat).')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((options: { json?: boolean; checkStale?: boolean; project?: string }) => {
    const projectOption = canonicalizeProjectOption(options.project);
    const presence = getSkillPresence(projectOption);
    if (presence === null) {
      printResult(io, ok('skill.presence', { active: false }), options.json);
      return;
    }
    if (options.checkStale === true) {
      // Slice 002 (v2.15.0) AC-1: pair the read with a staleness
      // check so callers (peaks-code Step 1, statusline) get both
      // pieces of info from a single CLI invocation. The presence
      // is returned UNCHANGED — `--check-stale` is a read-only flag,
      // not a clear.
      const staleness = checkStalePresence({ projectRootOverride: projectOption });
      printResult(
        io,
        ok('skill.presence', {
          active: true,
          ...presence,
          stale: staleness.stale,
          staleReason: staleness.reason,
          currentOuterSessionId: staleness.currentOuterSessionId,
          recordedOuterSessionId: staleness.recordedOuterSessionId
        }),
        options.json
      );
      return;
    }
    printResult(io, ok('skill.presence', { active: true, ...presence }), options.json);
  });

  addJsonOption(
    skill
      .command('presence:set <name>')
      .description('Set the currently active Peaks skill for session-wide visibility. Slice 4.0.8: requires a bound session and an adapter-resolved caller id (fail-closed); raw unlink is rejected.')
      .option('--mode <mode>', 'execution mode')
      .option('--gate <gate>', 'current gate')
      .option('--project <path>', 'project root path (auto-detected from cwd when omitted)')
  ).action((name: string, options: { mode?: string; gate?: string; project?: string; json?: boolean }) => {
    const projectOption = canonicalizeProjectOption(options.project);
    const projectRoot = projectOption ?? findProjectRoot(process.cwd()) ?? process.cwd();
    if (options.mode !== undefined && !isSkillPresenceMode(options.mode)) {
      printResult(
        io,
        fail('skill.presence:set', 'INVALID_MODE',
          `Invalid mode: ${options.mode} (expected one of: full-auto, assisted, swarm, strict)`,
          { name, mode: options.mode },
          ['Use a valid mode: full-auto, assisted, swarm, or strict']),
        options.json
      );
      process.exitCode = 1;
      return;
    }
    // Slice 4.0.8 (D1 + D2): `presence:set` is fail-closed. We refuse
    // any write when (a) no peaks session is bound, or (b) the active
    // IDE adapter cannot resolve a valid callerId. Both failures
    // surface BEFORE any filesystem write. The legacy
    // `setSkillPresence` wrapper is kept as a compat shim for tests
    // and CLI flows that intentionally do not need a session — but
    // production CLI traffic must go through this gate.
    const boundSessionId = getSessionId(projectRoot);
    if (boundSessionId === null) {
      printResult(
        io,
        fail('skill.presence:set', 'PEAKS_SESSION_NOT_BOUND',
          'No canonical peaks session is bound for this project (RD §3 D1).',
          { projectRoot, name },
          ['Run `peaks workspace init --project <p>` first, then re-run `peaks skill presence:set`.']),
        options.json
      );
      process.exitCode = 1;
      return;
    }
    try {
      resolveCallerProjection({ projectRoot });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      printResult(
        io,
        fail('skill.presence:set', 'PEAKS_CALLER_NOT_RESOLVED',
          `Active IDE adapter could not resolve a callerId (RD §3 D1): ${message}`,
          { projectRoot, name },
          ['Ensure the active IDE is detected by `peaks` and the IDE session variable is set.',
           'Or set PEAKS_CALLER_ID=<id> in the environment for scripted usage.']),
        options.json
      );
      process.exitCode = 1;
      return;
    }
    const presence = setSkillPresence(name, options.mode, options.gate, projectOption);
    // Session metadata is updated when a session is bound (read-only
    // path: `getSessionId`). We do not auto-spawn a session.
    if (boundSessionId !== null) {
      setSessionMeta(projectRoot, boundSessionId, {
        skill: name,
        ...(options.mode ? { mode: options.mode } : {}),
        ...(options.gate ? { gate: options.gate } : {})
      });
    }
    printResult(io, ok('skill.presence:set', { active: true, ...presence }), options.json);
  });

  addJsonOption(
    skill
      .command('presence:clear')
      .description('Clear the active Peaks skill presence indicator. Slice 4.0.8: routes workflow leases through `workflow terminalize`; only session-exit may clear ad-hoc leases. Raw unlink is FORBIDDEN.')
      .option('--project <path>', 'project root path (auto-detected from cwd when omitted)')
  ).action(async (options: { project?: string; json?: boolean }) => {
    const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    // Slice 4.0.8 (DR): `presence:clear` is a workflow terminalizer,
    // not a raw unlink. For workflow-bound leases the call is routed
    // through `workflow terminalize` (canonical in
    // workflow-presence-lifecycle.ts). Ad-hoc (non-workflow) leases
    // remain terminalizable only via session exit. We delegate to the
    // compat shim `clearSkillPresence`, which the compat wrapper
    // re-routes to `terminalizePresenceLease` when a workflow
    // binding is present.
    const removed = clearSkillPresence(options.project);
    // Auto-update project context so future sessions have up-to-date history.
    // Slice 2026-07-15-project-scan-bootstrap: generateProjectContext now also
    // bootstraps `.peaks/project-scan/` (idempotent). Await the async
    // signature; failure is still non-fatal so we don't block the clear.
    try {
      await generateProjectContext(projectRoot);
    } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
      // non-fatal: context update failure should not block presence clear
    }
    printResult(io, ok('skill.presence:clear', { active: false, removed, projectContextUpdated: true }), options.json);
  });

  // Slice 4.0.8 (RD §4): manual lease GC primitive. LLM-coordinated;
  // never a user-typed requirement. The user / LLM runner invokes
  // `peaks skill lease gc --project <p>` to drain leases that meet
  // both stale predicates (24h start AND 1h heartbeat) for the
  // canonical project. Returns a typed envelope so the runner can
  // branch on the aggregate counters.
  // Note: `.command('lease gc')` implicitly creates the `lease`
  // parent under `skill`; we MUST NOT also call `.command('lease')`
  // separately, or Commander.js throws "cannot add command 'lease' as
  // already have command 'lease'" at startup.
  addJsonOption(
    skill
      .command('lease gc')
      .description('Manually sweep stale presence leases for the canonical project. Both predicates required: now - lastHeartbeat > 1h AND now - startedAt > 24h. Drained leases are classified; corrupt graphs surface as PEAKS_GRAPH_REF_BROKEN warnings and are excluded.')
      .option('--project <path>', 'project root (default: cwd)')
      .option('--now <iso>', 'override the current time (test seam)')
  ).action(async (options: { project?: string; now?: string; json?: boolean }) => {
    const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    try {
      const result = await gcStalePresenceLeases({
        projectRoot,
        ...(options.now !== undefined ? { now: options.now } : {}),
        trigger: 'manual',
      });
      printResult(io, ok('skill.lease.gc', {
        envelopeVersion: '4.0.8',
        removed: result.removed,
        retained: result.retained,
        trigger: result.trigger,
        inFlightBatch: result.inFlightBatch,
        warnings: result.warnings,
        errors: result.errors,
      }, result.warnings.map((w) => `${w.code}: ${w.message}`), [
        'GC predicate: now - lastHeartbeat > 1h AND now - startedAt > 24h (RD §3 D2 + D3).',
        'Re-run `peaks workspace init` or `peaks skill presence:set` to sweep the same project on the bound trigger.',
      ]), options.json);
    } catch (err) {
      printResult(io, fail('skill.lease.gc', 'PEAKS_LEASE_GC_FAILED', getErrorMessage(err), { projectRoot }, ['Re-run with a valid --project and ensure the session is bound.']), options.json);
      process.exitCode = 1;
    }
  });

  // Slice 002 (v2.15.0) — AC-1: presence staleness detector.
  // peaks-code Step 1 (and `peaks code should-pause --step
  // step-1-mode-select`) calls this to decide whether the recorded
  // `mode` field can be trusted or whether the LLM must AskUserQuestion.
  addJsonOption(
    skill
      .command('presence:check-stale')
      .description(
        'Slice 002 (v2.15.0) AC-1: report whether the recorded presence outer session id still matches the current outer session id. ' +
          'Returns { stale: boolean, reason: "outer-session-mismatch" | "no-presence" | null }. ' +
          'Pure read-only — does NOT clear the presence (use `peaks skill presence:clear` for that).'
      )
      .option('--project <path>', 'project root (default: cwd)')
      .option('--current-outer <id>', 'override the current outer session id (test seam; default: read from PEAKS_OUTER_SESSION_ID / CLAUDE_CODE_SESSION_ID)')
  ).action((options: { project?: string; currentOuter?: string; json?: boolean }) => {
    // v2.15.0 slice 002 repair: do NOT pass `currentOuter: undefined`
    // when the user omits the flag. The service-layer branch
    // `'currentOuter' in opts` returns true for an explicit
    // `undefined` (the key exists on the spread object literal),
    // which would skip the env-var fallback and pin `current =
    // undefined` — always reading the presence as stale. Build a
    // sparse opts object so the service can fall back to
    // `getCurrentOuterSessionId()` (reads PEAKS_OUTER_SESSION_ID /
    // CLAUDE_CODE_SESSION_ID).
    const checkOpts: { projectRootOverride?: string; currentOuter?: string | undefined } =
      options.project !== undefined ? { projectRootOverride: options.project } : {};
    if (options.currentOuter !== undefined) {
      checkOpts.currentOuter = options.currentOuter;
    }
    const result = checkStalePresence(checkOpts);
    // Always emit `currentOuterSessionId` in the JSON envelope (even
    // when undefined → ''), per slice 002 AC-1 contract: downstream
    // tooling (statusline, sub-agent dispatch) reads the field by
    // name, never by `data.currentOuterSessionId ?? ''`. JSON.stringify
    // drops `undefined` properties, so we coerce to '' before
    // wrapping in the envelope.
    const data = {
      stale: result.stale,
      reason: result.reason,
      presence: result.presence,
      currentOuterSessionId: result.currentOuterSessionId ?? '',
      recordedOuterSessionId: result.recordedOuterSessionId ?? ''
    };
    printResult(io, ok('skill.presence:check-stale', data), options.json);
  });

  addJsonOption(
    skill
      .command('heartbeat')
      .description('Show the heartbeat status of the active Peaks skill')
  ).action((options: { json?: boolean }) => {
    const presence = getSkillPresence();
    if (presence === null) {
      printResult(io, ok('skill.heartbeat', { active: false, heartbeat: 'none' }), options.json);
      return;
    }
    printResult(io, ok('skill.heartbeat', {
      active: true,
      skill: presence.skill,
      gate: presence.gate ?? null,
      lastHeartbeat: presence.lastHeartbeat ?? presence.setAt,
      setAt: presence.setAt
    }), options.json);
  });

  addJsonOption(
    skill
      .command('heartbeat:touch')
      .description('Update the heartbeat timestamp (called by the LLM each turn to confirm peaks skill context is alive)')
  ).action((options: { json?: boolean }) => {
    const updated = touchSkillHeartbeat();
    if (updated === null) {
      printResult(io, ok('skill.heartbeat:touch', { active: false, heartbeat: 'none' }), options.json);
      return;
    }
    printResult(io, ok('skill.heartbeat:touch', {
      active: true,
      skill: updated.skill,
      lastHeartbeat: updated.lastHeartbeat
    }), options.json);
  });

  addJsonOption(
    skill
      .command('detect-marker-loss')
      .description('Detect whether the latest assistant message lost the Peaks-Loop status header while a peaks skill is still active (slice 028 detection primitive).')
      .option('--project <path>', 'project root path (auto-detected from cwd when omitted)')
      .option('--message <text>', 'latest assistant message text to scan (defaults to reading the most recent LLM response from the stdin pipe, or empty string when no pipe is attached)')
  ).action((options: { project?: string; message?: string; json?: boolean }) => {
    const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const message = options.message ?? '';
    const result = detectPresenceMarker({ project: projectRoot, latestAssistantMessage: message });
    printResult(io, ok('skill.detect-marker-loss', result), options.json);
  });

  // Slice S0 — register `peaks skill search`. Sibling subcommand to
  // list / runbook / presence; preserves the existing surface
  // (HC-10 — 老入口保留).
  registerSkillSearchCommand(program, io);
}
