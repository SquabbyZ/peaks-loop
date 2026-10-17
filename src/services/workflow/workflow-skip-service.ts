/**
 *
 * Pure-function classifier (`canSkipSlice`) + side-effecting applicator
 * (`applySkip`). Both are testable without filesystem mocks: injected
 * read/write state functions, the real store in production.
 *
 * Three rules (per RD §Why + Tech Doc §2-4):
 *   - Rule 1 (slice type allowlist): `bugfix` / `feature` / `refactor`
 *     can never skip QA. The allowlist is DERIVED from the pipeline's
 *     QA-free set (`QA_FREE_TYPES`); today that is `docs` / `chore`.
 *   - Rule 2 (one-time semantics): the same skip on the same rid is an
 *     idempotent no-op (`applied: false`); a different one is denied with
 *     `reason: "rid already has a different skip applied"`.
 *   - Rule 3 (role-based authorization): scripts (caller kind derived
 *     from `$PEAKS_CALLER_ID` env var) MUST pass `--i-have-reviewed`
 *     in addition to `--reason`.
 */
import { execFileSync } from 'node:child_process';
import { userInfo } from 'node:os';
import {
  hasControlChars,
  readSkipState,
  writeSkipState,
  type WorkflowSkipState
} from './workflow-state-store.js';
import { showRequestArtifact } from '../artifacts/request-artifact-service.js';
import type { RequestType } from '../artifacts/artifact-prerequisites.js';
import { QA_FREE_TYPES } from './pipeline-verify-qa-phase.js';

export const SKIPPABLE_TYPES: ReadonlyArray<RequestType> = QA_FREE_TYPES;
const SCRIPT_CALLER_IDS: ReadonlyArray<string> = ['ci', 'postinstall', 'cron'];

export type SkipArgs = {
  /** Request id this skip applies to. */
  rid: string;
  /** Comma-separated gate names from the CLI; parsed to string[]. */
  gatesRaw: string;
  /** Required, free-text justification. */
  reason: string;
  /** Optional. When set, the apply is previewed but no state is written. */
  dryRun?: boolean;
  /** Required for script callers (see Rule 3). */
  iHaveReviewed?: boolean;
  /** Caller kind, derived from $PEAKS_CALLER_ID by the CLI. When omitted,
   *  defaults to 'human' (the CLI's normal terminal path). */
  callerKind?: 'human' | 'llm' | 'script';
};

export type CanSkipVerdict =
  | { allowed: true; reason: null; sliceType: RequestType; callerKind: 'human' | 'llm' | 'script' }
  | { allowed: false; reason: string; sliceType?: RequestType };

export type ApplySkipResult =
  | {
      applied: true;
      idempotent: false;
      skippedGates: string[];
      rid: string;
      persistedTo: string;
      sliceType: RequestType;
    }
  | {
      applied: false;
      idempotent: true;
      skippedGates: string[];
      rid: string;
      persistedTo: string | null;
      sliceType: RequestType;
    }
  | {
      applied: false;
      idempotent: false;
      skippedGates: string[];
      rid: string;
      persistedTo: string | null;
      sliceType?: RequestType;
      reason: string;
    };

/** Parse the `--gates` CLI arg (e.g. "QA,slice-check") into string[]. */
export function parseGatesList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Determine the caller kind for Rule 3. CLI passes
 * `args.callerKind` directly when the user invoked the command
 * interactively; for script callers (CI / postinstall) the CLI
 * inspects `$PEAKS_CALLER_ID` and passes 'script'.
 */
export function detectCallerKind(envCallerId: string | undefined): 'human' | 'llm' | 'script' {
  if (envCallerId === undefined || envCallerId.length === 0) {
    return 'human';
  }
  return SCRIPT_CALLER_IDS.includes(envCallerId) ? 'script' : 'llm';
}

/**
 * Pure three-rule classifier. Does NOT touch the filesystem; the
 * `currentState` argument is the result of a prior `readSkipState`
 * call (or null if no state file exists). The slice type is
 * read from the RD request artifact via `showRequestArtifact`.
 *
 * Returns a verdict; the caller is expected to either apply or
 * surface the rejection reason. Reasons are user-readable English
 * suitable for the `nextActions` envelope.
 */
export async function canSkipSlice(
  projectRoot: string,
  sessionId: string,
  args: SkipArgs,
  currentState: WorkflowSkipState | null
): Promise<CanSkipVerdict> {
  // Argument validation (no filesystem).
  if (args.reason.trim().length === 0 || hasControlChars(args.reason)) {
    return {
      allowed: false,
      reason:
        'skip requires a single-line --reason; what is the user-visible justification for this QA bypass?'
    };
  }
  const gates = parseGatesList(args.gatesRaw);
  if (gates.length === 0 || gates.some(hasControlChars)) {
    return {
      allowed: false,
      reason: '--gates must list at least one single-line gate name (e.g. "QA" or "QA,slice-check")'
    };
  }

  // Resolve caller kind.
  const callerKind = args.callerKind ?? 'human';

  // Rule 3: script callers must carry --i-have-reviewed.
  if (callerKind === 'script' && args.iHaveReviewed !== true) {
    return { allowed: false, reason: 'script caller must pass --i-have-reviewed' };
  }

  // Read the slice type from the RD request.
  let sliceType: RequestType;
  try {
    const rdArtifact = await showRequestArtifact({ projectRoot, role: 'rd', requestId: args.rid });
    if (rdArtifact === null) {
      return {
        allowed: false,
        reason: `RD request artifact not found for rid "${args.rid}"; cannot determine slice type`
      };
    }
    sliceType = rdArtifact.requestType;
  } catch (error) {
    return {
      allowed: false,
      reason: `failed to read slice type from RD artifact: ${error instanceof Error ? error.message : 'unknown error'}`
    };
  }

  // Rule 1: type allowlist.
  if (!SKIPPABLE_TYPES.includes(sliceType)) {
    return {
      allowed: false,
      reason: `slice type "${sliceType}" cannot skip QA (QA-free types: ${SKIPPABLE_TYPES.join(', ')})`,
      sliceType
    };
  }

  // Rule 2: one-time semantics — same skip on the same rid is idempotent.
  if (currentState !== null) {
    const sameGates = sameStringSet(currentState.skippedGates, gates);
    if (sameGates) {
      return { allowed: true, reason: null, sliceType, callerKind };
    }
    return {
      allowed: false,
      reason: `rid already has a different skip applied (existing: [${currentState.skippedGates.join(', ')}]; requested: [${gates.join(', ')}]); abandon or amend manually`,
      sliceType
    };
  }

  return { allowed: true, reason: null, sliceType, callerKind };
}

/**
 * Apply a skip. Caller is expected to have already called
 * `canSkipSlice` and received `allowed: true`. The function is
 * still defensive — if the verdict is `allowed: false`, it returns
 * the rejection as `applied: false` without writing.
 */
export async function applySkip(
  projectRoot: string,
  sessionId: string,
  args: SkipArgs
): Promise<ApplySkipResult> {
  const verdict = await canSkipSlice(
    projectRoot,
    sessionId,
    args,
    readSkipState(projectRoot, sessionId, args.rid)
  );
  if (!verdict.allowed) {
    return {
      applied: false,
      idempotent: false,
      skippedGates: parseGatesList(args.gatesRaw),
      rid: args.rid,
      persistedTo: null,
      reason: verdict.reason
    };
  }

  const gates = parseGatesList(args.gatesRaw);
  const existing = readSkipState(projectRoot, sessionId, args.rid);
  if (existing !== null && sameStringSet(existing.skippedGates, gates)) {
    // Idempotent re-skip.
    return {
      applied: false,
      idempotent: true,
      skippedGates: existing.skippedGates,
      rid: args.rid,
      persistedTo: existing ? pathFromStateFile(projectRoot, sessionId, args.rid) : null,
      sliceType: verdict.sliceType
    };
  }

  if (args.dryRun === true) {
    return {
      applied: false,
      idempotent: false,
      skippedGates: gates,
      rid: args.rid,
      persistedTo: null,
      sliceType: verdict.sliceType,
      reason: 'dry-run: no state written'
    };
  }

  const callerKind = verdict.callerKind;
  const state: WorkflowSkipState = {
    rid: args.rid,
    skippedGates: gates,
    skipReason: args.reason.trim(),
    skipAppliedAt: new Date().toISOString(),
    skipAppliedBy: resolveSkipAppliedBy(),
    callerKind
  };
  const persistedTo = writeSkipState(projectRoot, sessionId, state);
  return {
    applied: true,
    idempotent: false,
    skippedGates: gates,
    rid: args.rid,
    persistedTo,
    sliceType: verdict.sliceType
  };
}

function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const aSorted = [...a].sort();
  const bSorted = [...b].sort();
  return aSorted.every((v, i) => v === bSorted[i]);
}

function pathFromStateFile(projectRoot: string, sessionId: string, rid: string): string {
  // Re-export the path-computation from the state store. We avoid
  // importing the internal helper to keep the public surface narrow.
  return `${projectRoot}/.peaks/_runtime/${sessionId}/workflow-state/${rid}.json`;
}

/** Resolve the author of the skip. Reads `git config --global user.name`
 *  synchronously, falling back to the OS user and then 'unknown'. A value
 *  carrying a control character is not written (the reader would refuse it). */
function resolveSkipAppliedBy(): string {
  try {
    const out = execFileSync('git', ['config', '--global', 'user.name'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true
    });
    const trimmed = out.trim();
    if (trimmed.length > 0) {
      return hasControlChars(trimmed) ? 'unknown' : trimmed;
    }
  } catch {
    // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    // fall through
  }
  try {
    const info = userInfo();
    return hasControlChars(info.username) ? 'unknown' : info.username;
  } catch {
    return 'unknown';
  }
}

/** Exposed for tests. */
export const _internal = { SKIPPABLE_TYPES, SCRIPT_CALLER_IDS, sameStringSet };
