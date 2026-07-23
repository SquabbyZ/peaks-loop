/**
 * `peaks compact *` — capability-first compact control plane.
 *
 * Public LLM surface (Task 1.6, design §11.1). These are the ONLY
 * commands registered under `peaks compact`:
 *
 *   - auto:          vendor-neutral auto compact handling
 *                    (probe + capability + plan/execute + verify
 *                    + resume). `--dry-run` is side-effect-free.
 *   - status:        read-only session circuit view.
 *   - capabilities:  read-only host capability profile view.
 *
 * Task 1.7 (design §13.1) retired the legacy 5-verb group
 * (`suggest / recommend / survival / dry-run / force`) outright:
 * those verbs used a different signal + semantics from the control
 * plane and are no longer registered as Commander subcommands.
 * `peaks compact --help` now lists exactly `auto / status /
 * capabilities / help`. The underlying pure services
 * (`suggest-service`, `decision-tables`) remain for the
 * request-transition hook but are no longer exposed as CLI verbs.
 *
 * Each subcommand returns a `--json` envelope via `printResult`.
 */
import type { Command } from 'commander';
import { z } from 'zod';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { fail, ok, getErrorMessage } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { getSessionIdCanonical } from '../../services/session/session-manager.js';
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
      'Capability-first compact control plane (design §11.1). ' +
        'Public LLM surface: auto / status / capabilities.'
    );

  // -----------------------------------------------------------------
  // 1. peaks compact auto --project <path> [--dry-run] [--target-ratio N] [--json]
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
  // 2. peaks compact status --project <path> [--json]
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
  // 3. peaks compact capabilities --project <path> [--json]
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
