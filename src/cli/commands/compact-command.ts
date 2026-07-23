/**
 * `peaks compact *` — strategic-compact CLI primitives.
 *
 * Two surfaces coexist under the same `peaks compact` group:
 *
 * 1. Public LLM surface (Task 1.6, design §11.1):
 *      - auto:          vendor-neutral auto compact handling
 *                       (probe + capability + plan/execute + verify
 *                       + resume). `--dry-run` is side-effect-free.
 *      - status:        read-only session circuit view.
 *      - capabilities:  read-only host capability profile view.
 *
 * 2. Legacy 5-verb group (slice 2026-07-01-strategic-compact-cli):
 *      - suggest / recommend / survival / dry-run / force
 *    Preserved as registered aliases for now; Task 1.7 handles their
 *    migration to the new public surface. The help text intentionally
 *    lists only the three primary commands — the legacy aliases are
 *    still functional but not discoverable from the help output.
 *
 * Each subcommand returns a `--json` envelope via `printResult`.
 */
import type { Command } from 'commander';
import { z } from 'zod';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { fail, ok, getErrorMessage } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { writeCheckpoint } from '../../services/session/session-checkpoint-service.js';
import { getSessionIdCanonical } from '../../services/session/session-manager.js';
import {
  buildRecommendEnvelopePure,
  dryRunCompact,
  suggestCompact
} from '../../services/compact/suggest-service.js';
import {
  PHASES,
  SURVIVAL_TABLE,
  isPhase,
  lookupPhaseTransition,
  type Phase
} from '../../services/compact/decision-tables.js';
import {
  AUTO_COMPACT_EXHAUSTED,
  AUTO_COMPACT_UNSUPPORTED_STRONG_GUARANTEE,
  createAttemptCoordinator,
  type CompactAutoInput,
  type CompactAutoResult,
  type CompactCoordinatorDependencies
} from '../../services/compact-core/attempt-coordinator.js';
import { createAttemptStore } from '../../services/compact-core/attempt-store.js';
import { AUTO_COMPACT_VERIFICATION_CIRCUIT_OPEN } from '../../services/compact-core/index.js';
import type { CapabilityProfile } from '../../services/compact-core/protocol/capability-profile.js';
import type { ProviderCertification } from '../../services/compact-core/compact-policy.js';

type CompactSuggestOptions = {
  json?: boolean;
  project?: string;
  sessionId?: string;
  apply?: boolean;
};

type CompactRecommendOptions = {
  from: string;
  to: string;
  json?: boolean;
};

type CompactSurvivalOptions = {
  json?: boolean;
};

type CompactDryRunOptions = {
  from?: string;
  to?: string;
  json?: boolean;
  project?: string;
  sessionId?: string;
};

type CompactForceOptions = {
  reason?: string;
  json?: boolean;
  project?: string;
  sessionId?: string;
  currentPlan?: string;
  openQuestions?: string;
  recentDecisions?: string;
  recentArtifactPaths?: string;
  gitStatus?: string;
  skillsActive?: string;
  todoState?: string;
};

// --- Task 1.6 (design §11.1) ---------------------------------------------
// Public LLM surface. The CLI accepts exactly the flags published in
// the brief; unknown flags (incl. `--execute`, `--binary`, `--vendor`)
// fail loudly via Commander's unknownOption path. The handlers do not
// branch on a host name and never spawn vendor binaries.

type CompactAutoOptions = {
  json?: boolean;
  project?: string;
  sessionId?: string;
  dryRun?: boolean;
  targetRatio?: string;
};

type CompactStatusOptions = {
  json?: boolean;
  project?: string;
  sessionId?: string;
};

type CompactCapabilitiesOptions = {
  json?: boolean;
  project?: string;
};

const TargetRatioSchema = z
  .number()
  .min(0, { message: 'target-ratio must be >= 0' })
  .max(1, { message: 'target-ratio must be <= 1' });

const DEFAULT_TARGET_RATIO = 0.6;

/**
 * Phase-1 capability profile. The CLI ships an honest "no certified
 * provider wired" surface so users / LLMs receive a parseable envelope
 * rather than a crash. Phase 3 will replace this with a real provider
 * registry lookup (design §12.1). The profile intentionally has every
 * capability field set to `none` so the admission policy returns
 * `blocked` (design §5.3) and the CLI returns
 * `AUTO_COMPACT_UNSUPPORTED_STRONG_GUARANTEE` — never a fabricated
 * success.
 */
const PHASE_1_UNSUPPORTED_PROFILE: CapabilityProfile = {
  schemaVersion: 1,
  contextMeasurement: 'none',
  nativeCompact: 'none',
  contextReplacement: 'none',
  progressSurface: 'none',
  continuation: 'none',
  completionSignal: 'none',
  rollbackSupport: 'none',
  capabilityEpoch: 'phase-1-no-provider'
};

const PHASE_1_NO_PROVIDER_ID = 'phase-1-no-provider';

function parseTargetRatio(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_TARGET_RATIO;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`target-ratio is not a finite number: ${raw}`);
  }
  const result = TargetRatioSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? 'invalid target-ratio');
  }
  return result.data;
}

/**
 * Phase-1 bridge factory. The factory is vendor-neutral: it never
 * inspects a host name and never tries to spawn a vendor binary. It
 * reports an "unsupported" certification so the coordinator returns
 * `AUTO_COMPACT_UNSUPPORTED_STRONG_GUARANTEE` for any attempt that
 * requires a host capability (design §5.3). The mutating methods
 * throw so a misconfigured call (e.g. by a future slice) cannot
 * secretly make a real host write.
 */
function createNoProviderBridgeFactory(): CompactCoordinatorDependencies['attachBridge'] {
  return async () => ({
    bridge: {
      probe: async () => PHASE_1_UNSUPPORTED_PROFILE,
      invokeNative: async function* () {
        throw new Error('phase-1: no certified provider is registered');
      },
      replaceWithCapsule: async function* () {
        throw new Error('phase-1: no certified provider is registered');
      },
      measureContext: async () => {
        throw new Error('phase-1: no certified provider is registered');
      },
      resume: async () => {
        throw new Error('phase-1: no certified provider is registered');
      },
      inspectTransaction: async () => {
        throw new Error('phase-1: no certified provider is registered');
      },
      rollback: async () => {
        throw new Error('phase-1: no certified provider is registered');
      }
    },
    certification: 'unsupported' as ProviderCertification,
    manualMetadata: null
  });
}

function compactAutoOutcomeToLabel(result: CompactAutoResult): {
  outcome: 'AUTO_COMPACT_PLAN' | 'AUTO_COMPACT_COMPLETED' | 'unsupported' | 'circuit-open' | 'exhausted';
  path?: 'native' | 'fallback';
} {
  if (result.ok) {
    if (result.code === 'AUTO_COMPACT_PLAN') {
      return { outcome: 'AUTO_COMPACT_PLAN', path: result.path };
    }
    return { outcome: 'AUTO_COMPACT_COMPLETED' };
  }
  if (result.code === AUTO_COMPACT_UNSUPPORTED_STRONG_GUARANTEE) {
    return { outcome: 'unsupported' };
  }
  if (result.code === AUTO_COMPACT_VERIFICATION_CIRCUIT_OPEN) {
    return { outcome: 'circuit-open' };
  }
  return { outcome: 'exhausted' };
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function resolveSessionId(
  projectRoot: string,
  explicit: string | undefined
): { sid: string | null; error: { code: string; message: string; nextActions: string[] } | null } {
  if (explicit !== undefined && explicit.length > 0) {
    return { sid: explicit, error: null };
  }
  // Statically-imported `getSessionIdCanonical` (see import block
  // at the top of this file). It is the single source of truth for
  // "what session is bound to this project"; we use it instead of
  // re-implementing the resolution here to keep one fix point when
  // the binding layout changes.
  const sid = getSessionIdCanonical(projectRoot) ?? null;
  if (sid === null) {
    return {
      sid: null,
      error: {
        code: 'NO_ACTIVE_SESSION',
        message: 'No active session bound. Run `peaks workspace init --project <repo> --json` to bind one.',
        nextActions: [`peaks workspace init --project ${projectRoot} --json`]
      }
    };
  }
  return { sid, error: null };
}

export function registerCompactCommands(program: Command, io: ProgramIO): void {
  const compact = program
    .command('compact')
    .description(
      'Strategic-compact control plane (design §11.1). Public LLM surface: ' +
        'auto / status / capabilities.'
    );

  // -----------------------------------------------------------------
  // 1. peaks compact suggest [--json]
  // -----------------------------------------------------------------
  addJsonOption(
    compact
      .command('suggest')
      .description(
        'Two-signal suggestion (context-size + tool-call-count). ' +
          'Honor COMPACT_THRESHOLD / COMPACT_CONTEXT_THRESHOLD / COMPACT_CONTEXT_INTERVAL env vars. ' +
          'Read-only by default; pass --apply to also append a one-line info row to the session log.'
      )
      .option('--project <path>', 'project root (defaults to git root or cwd)')
      .option('--session-id <sid>', 'override the active session id (defaults to the canonical binding)')
      .option('--apply', 'append a one-line info row to .peaks/_runtime/<sid>/session.json (default: dry-run)')
  ).action((options: CompactSuggestOptions) => {
    try {
      const projectRoot = options.project !== undefined
        ? resolveCanonicalProjectRoot(options.project)
        : (findProjectRoot(process.cwd()) ?? process.cwd());
      const session = resolveSessionId(projectRoot, options.sessionId);
      if (session.error !== null) {
        printResult(io, fail('compact.suggest', session.error.code, session.error.message, { projectRoot }, session.error.nextActions), options.json);
        process.exitCode = 1;
        return;
      }
      const result = suggestCompact({
        projectRoot,
        sessionId: session.sid
      });
      printResult(io, ok('compact.suggest', result, [], [
        result.shouldSuggest
          ? `Run \`peaks compact force --reason "<short note>"\` to checkpoint, then /compact.`
          : `Context at ${(result.ratio * 100).toFixed(1)}% (${result.tokensUsed} of ${result.windowKind === '1m' ? '1M' : '200k'}); below threshold.`
      ]), options.json);
    } catch (error) {
      printResult(io, fail('compact.suggest', 'COMPACT_SUGGEST_FAILED', getErrorMessage(error), {}, ['Verify project root and session binding before retrying']), options.json);
      process.exitCode = 1;
    }
  });

  // -----------------------------------------------------------------
  // 2. peaks compact recommend --from <phase> --to <phase> [--json]
  // -----------------------------------------------------------------
  addJsonOption(
    compact
      .command('recommend')
      .description(
        `Strategic-compact "Compaction Decision Guide" lookup. ` +
          `Valid phases: ${PHASES.join(', ')}. Pure function over (from, to); no I/O.`
      )
      .requiredOption('--from <phase>', `source phase (one of ${PHASES.join(', ')})`)
      .requiredOption('--to <phase>', `target phase (one of ${PHASES.join(', ')})`)
  ).action((options: CompactRecommendOptions) => {
    try {
      if (!isPhase(options.from)) {
        printResult(io, fail('compact.recommend', 'INVALID_PHASE', `--from must be one of ${PHASES.join(', ')} (got "${options.from}")`, { from: options.from }, [`Use --from ${PHASES.join('|')}`]), options.json);
        process.exitCode = 1;
        return;
      }
      if (!isPhase(options.to)) {
        printResult(io, fail('compact.recommend', 'INVALID_PHASE', `--to must be one of ${PHASES.join(', ')} (got "${options.to}")`, { to: options.to }, [`Use --to ${PHASES.join('|')}`]), options.json);
        process.exitCode = 1;
        return;
      }
      const envelope = buildRecommendEnvelopePure(options.from as Phase, options.to as Phase);
      const lookup = lookupPhaseTransition(options.from as Phase, options.to as Phase);
      printResult(io, ok('compact.recommend', {
        from: envelope.from,
        to: envelope.to,
        shouldCompact: envelope.shouldCompact,
        severity: envelope.severity,
        rationale: envelope.rationale,
        suggestedMessage: envelope.suggestedMessage,
        notInTable: lookup.notInTable
      }, lookup.notInTable ? [`Transition ${options.from} → ${options.to} is not in the strategic-compact table; defaulting to severity=no.`] : []), options.json);
    } catch (error) {
      printResult(io, fail('compact.recommend', 'COMPACT_RECOMMEND_FAILED', getErrorMessage(error), { from: options.from, to: options.to }, ['Verify the phase pair against the documented transitions']), options.json);
      process.exitCode = 1;
    }
  });

  // -----------------------------------------------------------------
  // 3. peaks compact survival [--json]
  // -----------------------------------------------------------------
  addJsonOption(
    compact
      .command('survival')
      .description('Strategic-compact "What Survives Compaction" table. Pure static data; no I/O.')
  ).action((options: CompactSurvivalOptions) => {
    printResult(io, ok('compact.survival', {
      persists: [...SURVIVAL_TABLE.persists],
      lost: [...SURVIVAL_TABLE.lost]
    }, [], [
      'Persists = guaranteed across `/compact`. Lost = not preserved; persist to disk before compacting.'
    ]), options.json);
  });

  // -----------------------------------------------------------------
  // 4. peaks compact dry-run [--from <phase>] [--to <phase>] [--json]
  // -----------------------------------------------------------------
  addJsonOption(
    compact
      .command('dry-run')
      .description(
        'Composite preview of (suggest + recommend + survival). ' +
          'No writes. The LLM calls this every tool-call cycle to stay informed.'
      )
      .option('--from <phase>', `optional source phase for recommend lookup (one of ${PHASES.join(', ')})`)
      .option('--to <phase>', `optional target phase for recommend lookup (one of ${PHASES.join(', ')})`)
      .option('--project <path>', 'project root (defaults to git root or cwd)')
      .option('--session-id <sid>', 'override the active session id')
  ).action((options: CompactDryRunOptions) => {
    try {
      const projectRoot = options.project !== undefined
        ? resolveCanonicalProjectRoot(options.project)
        : (findProjectRoot(process.cwd()) ?? process.cwd());
      const session = resolveSessionId(projectRoot, options.sessionId);
      if (session.error !== null) {
        printResult(io, fail('compact.dry-run', session.error.code, session.error.message, { projectRoot }, session.error.nextActions), options.json);
        process.exitCode = 1;
        return;
      }
      if ((options.from === undefined) !== (options.to === undefined)) {
        printResult(io, fail('compact.dry-run', 'PHASE_PAIR_INCOMPLETE', 'Both --from and --to must be provided together', { from: options.from, to: options.to }, ['Pass both --from and --to, or omit both for a suggest-only dry-run']), options.json);
        process.exitCode = 1;
        return;
      }
      if (options.from !== undefined && !isPhase(options.from)) {
        printResult(io, fail('compact.dry-run', 'INVALID_PHASE', `--from must be one of ${PHASES.join(', ')} (got "${options.from}")`, { from: options.from }, [`Use --from ${PHASES.join('|')}`]), options.json);
        process.exitCode = 1;
        return;
      }
      if (options.to !== undefined && !isPhase(options.to)) {
        printResult(io, fail('compact.dry-run', 'INVALID_PHASE', `--to must be one of ${PHASES.join(', ')} (got "${options.to}")`, { to: options.to }, [`Use --to ${PHASES.join('|')}`]), options.json);
        process.exitCode = 1;
        return;
      }
      const hasPhasePair = options.from !== undefined && options.to !== undefined;
      const dryRunInput: { projectRoot: string; sessionId: string | null; from?: Phase; to?: Phase } = {
        projectRoot,
        sessionId: session.sid
      };
      if (hasPhasePair) {
        dryRunInput.from = options.from as Phase;
        dryRunInput.to = options.to as Phase;
      }
      const result = dryRunCompact(dryRunInput);
      printResult(io, ok('compact.dry-run', result, [], [
        result.action === 'compact'
          ? `Action=compact: run \`peaks compact force --reason "<note>"\`, then /compact.`
          : `Action=skip: continue without compacting.`
      ]), options.json);
    } catch (error) {
      printResult(io, fail('compact.dry-run', 'COMPACT_DRY_RUN_FAILED', getErrorMessage(error), {}, ['Verify project root, session binding, and phase pair before retrying']), options.json);
      process.exitCode = 1;
    }
  });

  // -----------------------------------------------------------------
  // 5. peaks compact force [--reason <text>] [--json]
  // -----------------------------------------------------------------
  addJsonOption(
    compact
      .command('force')
      .description(
        'Write a pre-compact checkpoint via `peaks session checkpoint --reason context-fill`. ' +
          'The IDE-side `/compact` is still the LLM\'s call; this primitive guarantees ' +
          'the pre-compact state is persisted. NO sleep, NO wait for IDE response.'
      )
      .option('--reason <text>', 'human-readable reason for the pre-compact checkpoint', 'pre-force-compact')
      .option('--project <path>', 'project root (defaults to git root or cwd)')
      .option('--session-id <sid>', 'override the active session id')
      .option('--current-plan <text>', 'current plan summary (forwarded to the checkpoint snapshot)')
      .option('--open-questions <list>', 'newline-separated open questions')
      .option('--recent-decisions <list>', 'newline-separated recent decisions')
      .option('--recent-artifact-paths <list>', 'newline-separated recent artifact paths')
      .option('--git-status <text>', 'recent git status')
      .option('--skills-active <list>', 'newline-separated active skill names')
      .option('--todo-state <list>', 'newline-separated todo lines')
  ).action((options: CompactForceOptions) => {
    try {
      const projectRoot = options.project !== undefined
        ? resolveCanonicalProjectRoot(options.project)
        : (findProjectRoot(process.cwd()) ?? process.cwd());
      const session = resolveSessionId(projectRoot, options.sessionId);
      if (session.error !== null) {
        printResult(io, fail('compact.force', session.error.code, session.error.message, { projectRoot }, session.error.nextActions), options.json);
        process.exitCode = 1;
        return;
      }
          const reason = (options.reason ?? 'pre-force-compact').slice(0, 200);
      // The session-checkpoint-service restricts `reason` to a fixed
      // enum. The strategic-compact `force` primitive uses
      // 'context-fill' (the closest semantic match: the LLM is
      // compacting because of context pressure) and records the
      // caller's free-form reason in `gitStatus` so the snapshot
      // is self-describing without inventing a new enum value.
      const checkpointOptions: Parameters<typeof writeCheckpoint>[1] = {
        sessionId: session.sid as string,
        reason: 'context-fill',
        gitStatus: `compact.force: ${reason}`,
        openQuestions: splitList(options.openQuestions),
        recentDecisions: splitList(options.recentDecisions),
        recentArtifactPaths: splitList(options.recentArtifactPaths),
        skillsActive: splitList(options.skillsActive),
        todoState: splitList(options.todoState)
      };
      if (options.currentPlan !== undefined) {
        checkpointOptions.currentPlan = options.currentPlan;
      }
      const result = writeCheckpoint(projectRoot, checkpointOptions);
      printResult(io, ok('compact.force', {
        checkpointPath: result.path,
        reason: 'pre-force-compact',
        callerReason: reason,
        sessionId: result.sessionId,
        createdAt: result.createdAt,
        totalRetained: result.totalRetained,
        message: 'Pre-compact checkpoint written. The IDE-side /compact is still the LLM\'s call; this CLI does NOT invoke the IDE slash command.'
      }, [], [
        'After the LLM fires the IDE-side /compact, call `peaks compact survival` to see what to persist before the next compact.'
      ]), options.json);
    } catch (error) {
      printResult(io, fail('compact.force', 'COMPACT_FORCE_FAILED', getErrorMessage(error), {}, ['Verify the project path is writable and a session is bound']), options.json);
      process.exitCode = 1;
    }
  });

  // -----------------------------------------------------------------
  // Task 1.6 (design §11.1) — public LLM surface.
  // The three handlers below are the ONLY discoverable commands under
  // `peaks compact`. The legacy 5-verb group above remains registered
  // as aliases — Task 1.7 will migrate them.
  // -----------------------------------------------------------------

  // -----------------------------------------------------------------
  // 6. peaks compact auto --project <path> [--dry-run] [--target-ratio N] [--json]
  // -----------------------------------------------------------------
  addJsonOption(
    compact
      .command('auto')
      .description(
        'Vendor-neutral auto compact: probe + capability + plan + verify + resume. ' +
          '--dry-run is side-effect-free (no journal / circuit / mutating-bridge writes). ' +
          '--target-ratio defaults to 0.60 and must be in [0, 1].'
      )
      .option('--project <path>', 'project root (defaults to git root or cwd)')
      .option('--session-id <sid>', 'override the active session id (defaults to the canonical binding)')
      .option('--dry-run', 'plan only; no journal / circuit / mutating-bridge writes')
      .option('--target-ratio <ratio>', 'target post-compact context ratio in [0, 1] (default 0.60)')
  ).action(async (options: CompactAutoOptions) => {
    try {
      const projectRoot = options.project !== undefined
        ? resolveCanonicalProjectRoot(options.project)
        : (findProjectRoot(process.cwd()) ?? process.cwd());
      const session = resolveSessionId(projectRoot, options.sessionId);
      if (session.error !== null) {
        printResult(io, fail('compact.auto', session.error.code, session.error.message, { projectRoot }, session.error.nextActions), options.json);
        process.exitCode = 1;
        return;
      }
      let targetRatio: number;
      try {
        targetRatio = parseTargetRatio(options.targetRatio);
      } catch (parseError) {
        printResult(
          io,
          fail(
            'compact.auto',
            'INVALID_TARGET_RATIO',
            getErrorMessage(parseError),
            { targetRatio: options.targetRatio ?? null },
            ['Pass --target-ratio as a number in [0, 1] (default 0.60)']
          ),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      const dryRun = options.dryRun === true;
      const store = createAttemptStore({ projectRoot, sessionId: session.sid as string });
      const attachBridge = createNoProviderBridgeFactory();
      const coordinator = createAttemptCoordinator({
        attachBridge,
        store,
        now: () => new Date(),
        newAttemptId: () => `cli-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      });
      const autoInput: CompactAutoInput = {
        projectRoot,
        sessionId: session.sid as string,
        targetRatio,
        dryRun
      };
      let result: CompactAutoResult;
      try {
        result = await coordinator.compactAuto(autoInput);
      } catch (error) {
        printResult(
          io,
          fail(
            'compact.auto',
            'COMPACT_AUTO_FAILED',
            getErrorMessage(error),
            { projectRoot, sessionId: session.sid },
            ['Verify the project path and session binding before retrying']
          ),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      const label = compactAutoOutcomeToLabel(result);
      const data: Record<string, unknown> = {
        outcome: label.outcome,
        targetRatio,
        dryRun
      };
      if (label.path !== undefined) {
        data.path = label.path;
      }
      if (!result.ok) {
        data.code = result.code;
        data.manualFallback = result.manualFallback;
      }
      if (result.ok && result.code === 'AUTO_COMPACT_PLAN') {
        data.profile = result.profile;
      }
      if (result.ok && result.code === 'AUTO_COMPACT_COMPLETED') {
        data.receipt = result.receipt;
      }
      const warnings: string[] = [];
      const nextActions: string[] = [];
      if (!result.ok) {
        // Render the LLM-facing envelope as ok=false with the typed
        // blocking code; the LLM gets the next-action list from the
        // manual-fallback decision rather than a generic CLI error.
        if (result.manualFallback.kind === 'offer-natural-language-choice') {
          nextActions.push(`offer: ${result.manualFallback.label}`);
        } else if (result.manualFallback.kind === 'show-host-native-hint-once') {
          warnings.push('host-native-hint-shown-once');
        }
        printResult(
          io,
          fail(
            'compact.auto',
            result.code,
            `compact.auto blocked: ${result.code}`,
            data,
            nextActions
          ),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      printResult(io, ok('compact.auto', data, warnings, nextActions), options.json);
    } catch (error) {
      printResult(io, fail('compact.auto', 'COMPACT_AUTO_FAILED', getErrorMessage(error), {}, ['Verify the project path and session binding before retrying']), options.json);
      process.exitCode = 1;
    }
  });

  // -----------------------------------------------------------------
  // 7. peaks compact status --project <path> [--json]
  // -----------------------------------------------------------------
  addJsonOption(
    compact
      .command('status')
      .description(
        'Read-only view of the session circuit counter, last attempt, and last failure code. ' +
          'Does NOT write any journal / circuit file.'
      )
      .option('--project <path>', 'project root (defaults to git root or cwd)')
      .option('--session-id <sid>', 'override the active session id (defaults to the canonical binding)')
  ).action(async (options: CompactStatusOptions) => {
    try {
      const projectRoot = options.project !== undefined
        ? resolveCanonicalProjectRoot(options.project)
        : (findProjectRoot(process.cwd()) ?? process.cwd());
      const session = resolveSessionId(projectRoot, options.sessionId);
      if (session.error !== null) {
        printResult(io, fail('compact.status', session.error.code, session.error.message, { projectRoot }, session.error.nextActions), options.json);
        process.exitCode = 1;
        return;
      }
      const store = createAttemptStore({ projectRoot, sessionId: session.sid as string });
      try {
        const circuit = await store.readSessionCircuit();
        printResult(
          io,
          ok(
            'compact.status',
            {
              sessionId: circuit.sessionId,
              consecutiveVerificationFailures: circuit.consecutiveVerificationFailures,
              circuit: circuit.circuit,
              lastAttemptId: circuit.lastAttemptId,
              lastFailureCode: circuit.lastFailureCode,
              manualPromptShown: circuit.manualPromptShown,
              openedAt: circuit.openedAt,
              schemaVersion: circuit.schemaVersion
            },
            [],
            []
          ),
          options.json
        );
      } catch (error) {
        printResult(
          io,
          fail(
            'compact.status',
            'STATUS_READ_FAILED',
            getErrorMessage(error),
            { projectRoot, sessionId: session.sid },
            ['Verify the project path and session binding before retrying']
          ),
          options.json
        );
        process.exitCode = 1;
      }
    } catch (error) {
      printResult(io, fail('compact.status', 'STATUS_READ_FAILED', getErrorMessage(error), {}, ['Verify the project path and session binding before retrying']), options.json);
      process.exitCode = 1;
    }
  });

  // -----------------------------------------------------------------
  // 8. peaks compact capabilities --project <path> [--json]
  // -----------------------------------------------------------------
  addJsonOption(
    compact
      .command('capabilities')
      .description(
        'Read-only view of the host capability profile observed by the compact probe. ' +
          'In Phase 1 (no certified provider wired) this reports supported=false with an ' +
          'all-nones profile. The envelope carries NO vendor / binary / slashCommand field.'
      )
      .option('--project <path>', 'project root (defaults to git root or cwd)')
  ).action((options: CompactCapabilitiesOptions) => {
    try {
      const projectRoot = options.project !== undefined
        ? resolveCanonicalProjectRoot(options.project)
        : (findProjectRoot(process.cwd()) ?? process.cwd());
      // Phase 1 ships an honest "no certified provider" envelope. The
      // probe is read-only; the profile is the literal Phase-1
      // placeholder above so the LLMs can plan around `supported=false`
      // without hard-coding a vendor or binary.
      const profile = PHASE_1_UNSUPPORTED_PROFILE;
      const supported = false;
      const data = {
        providerId: PHASE_1_NO_PROVIDER_ID,
        certification: 'unsupported' as ProviderCertification,
        profile,
        supported
      };
      printResult(io, ok('compact.capabilities', data, [], [
        'No certified provider is registered. Real bridges ship in Phase 3 (design §12.2).'
      ]), options.json);
    } catch (error) {
      printResult(io, fail('compact.capabilities', 'CAPABILITIES_READ_FAILED', getErrorMessage(error), {}, ['Verify the project path before retrying']), options.json);
      process.exitCode = 1;
    }
  });
}
