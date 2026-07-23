/**
 * Task 1.2 — durable attempt store.
 *
 * Atomic temp+rename writes under
 * `.peaks/_runtime/<sessionId>/compact-attempts/<attemptId>.journal.json`,
 * plus a single `session-circuit.json` per session that persists across
 * process restarts (design §10.3, §10.5).
 *
 * Security model (design §16):
 *   - every read uses `O_NOFOLLOW` so symlinked files / hardlinks
 *     pointing outside `compact-attempts/` are rejected;
 *   - the `compact-attempts/` directory itself is rejected when it is a
 *     symlink OR when its canonical path (after `realpathSync`) escapes
 *     the canonical `<projectRoot>/.peaks/_runtime` anchor. The
 *     realpath check catches Windows junctions / reparse points, which
 *     `lstat(...).isSymbolicLink()` returns FALSE for;
 *   - `sessionId` / `attemptId` are validated as path segments *before*
 *     `path.join` so `..` and absolute paths never reach the disk;
 *   - atomic temp+rename + 0o600 target where supported.
 *
 * The store is purely I/O; no vendor names, no host identifiers, no
 * CLI verbs leak into the journal payload (§15, §17).
 *
 * --- Atomic writer note (fix 4) ---
 * This module duplicates the `atomicWriteJson` helper from
 * `src/services/ide/shared/atomic-json.ts` because the global
 * architecture forbids `src/services/compact-core/**` from importing
 * `src/services/ide/**`. Both writers share an identical security
 * contract: `O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW`, 0o600 target,
 * pretty-printed JSON, rename over the target, best-effort temp cleanup
 * on rename failure. Extraction into a shared helper is intentionally
 * deferred to a dedicated refactor slice (per coordinator guidance) so
 * this PR does not broaden beyond Task 1.2.
 */
import {
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  COMPACT_JOURNAL_STAGES,
  CompactAttemptJournalSchema,
  CompactSessionCircuitStateSchema,
  VERIFICATION_CIRCUIT_TRIP_THRESHOLD,
  assertSafeIdempotencyKey,
  assertSafePathSegment,
  isInsideRuntimeAnchor,
  isPermittedStageTransition,
  type CompactAttemptJournal,
  type CompactSessionCircuitState
} from './attempt-schema.js';

// Re-export the public schema surface so downstream slices can keep
// importing this module instead of reaching into the schema file.
export {
  COMPACT_JOURNAL_STAGES,
  CompactAttemptJournalSchema,
  CompactSessionCircuitStateSchema,
  VERIFICATION_CIRCUIT_TRIP_THRESHOLD,
  assertSafeIdempotencyKey,
  assertSafePathSegment,
  isInsideRuntimeAnchor,
  isPermittedStageTransition
} from './attempt-schema.js';
export type {
  CompactAttemptJournal,
  CompactJournalStage,
  CompactSessionCircuitState
} from './attempt-schema.js';

/** 0o600 — owner read/write only. Same constant the IDE settings writer uses. */
export const ATTEMPT_FILE_MODE = 0o600;

const PEAKS_DIR = '.peaks';
const RUNTIME_DIR = '_runtime';
const COMPACT_ATTEMPTS_DIR = 'compact-attempts';
const JOURNAL_SUFFIX = '.journal.json';
const CIRCUIT_FILE = 'session-circuit.json';
const TEMP_PREFIX = '.attempt-';

export interface CreateAttemptStoreOptions {
  readonly projectRoot: string;
  readonly sessionId: string;
}

export interface AttemptStore {
  /** Atomic write of one attempt journal. */
  writeAttempt(journal: CompactAttemptJournal): Promise<void>;
  /** Read a previously-written attempt journal (no-follow). */
  readAttempt(attemptId: string): Promise<CompactAttemptJournal | null>;
  /** Append an idempotency key to a journal's `sealedIdempotencyKeys`. */
  sealIdempotencyKey(attemptId: string, key: string): Promise<void>;
  /** Read the session circuit state. */
  readSessionCircuit(): Promise<CompactSessionCircuitState>;
  /** Increment the consecutive verification failure counter and possibly trip the circuit. */
  recordVerificationFailure(attemptId: string, code: string): Promise<CompactSessionCircuitState>;
  /** Record that the manual-prompt hint was shown to the user. */
  markManualPromptShown(): Promise<void>;
  /** Close the circuit and zero the counter (only after an explicit recovery signal). */
  markVerificationRecovered(): Promise<CompactSessionCircuitState>;
  /** Manually reset the failure count (only legal while the circuit is closed). */
  resetVerificationFailures(): Promise<void>;
}

/**
 * Construct an `AttemptStore` rooted at `projectRoot`. Validates
 * `sessionId` immediately; `attemptId` is validated at every call site
 * (later slices can pass arbitrary new ids).
 */
export function createAttemptStore(options: CreateAttemptStoreOptions): AttemptStore {
  const { projectRoot, sessionId } = options;
  if (!projectRoot || typeof projectRoot !== 'string') {
    throw new Error('createAttemptStore: projectRoot is required');
  }
  assertSafePathSegment('sessionId', sessionId);

  // Resolve the canonical project root ONCE so every containment check
  // below has a stable, realpath-based anchor. On Windows this expands
  // any junction/reparse point at the project root.
  const canonicalProjectRoot = safeRealpath(projectRoot);

  const compactDir = join(projectRoot, PEAKS_DIR, RUNTIME_DIR, sessionId, COMPACT_ATTEMPTS_DIR);
  const canonicalRuntimeAnchor = join(canonicalProjectRoot, PEAKS_DIR, RUNTIME_DIR);

  function assertContained(canonicalTarget: string, canonicalTargetParent?: string): void {
    if (
      !isInsideRuntimeAnchor({
        projectRoot,
        canonicalProjectRoot,
        canonicalTarget,
        canonicalTargetParent
      })
    ) {
      throw new Error(
        `refusing to operate outside canonical runtime anchor ${canonicalRuntimeAnchor}: ${canonicalTarget}`
      );
    }
  }

  function ensureCompactDir(): void {
    if (existsSync(compactDir)) {
      const st = lstatSync(compactDir);
      if (st.isSymbolicLink()) {
        throw new Error(`compact-attempts directory must not be a symlink: ${compactDir}`);
      }
      if (!st.isDirectory()) {
        throw new Error(`compact-attempts path is not a directory: ${compactDir}`);
      }
      // Realpath containment guard: a Windows junction or reparse point
      // at `compact-attempts/` is not detectable by `isSymbolicLink()`,
      // so we resolve the canonical path and verify it still sits
      // inside the canonical runtime anchor.
      const canonicalCompactDir = safeRealpath(compactDir);
      const canonicalParent = safeRealpath(dirname(compactDir));
      assertContained(canonicalCompactDir, canonicalParent);
    } else {
      mkdirSync(compactDir, { recursive: true });
      // After mkdir, re-resolve to make sure the OS didn't honour a
      // pre-existing reparse point at the parent path.
      const canonicalCompactDir = safeRealpath(compactDir);
      const canonicalParent = safeRealpath(dirname(compactDir));
      assertContained(canonicalCompactDir, canonicalParent);
    }
  }

  function journalPathFor(attemptId: string): string {
    assertSafePathSegment('attemptId', attemptId);
    return join(compactDir, `${attemptId}${JOURNAL_SUFFIX}`);
  }

  function circuitPath(): string {
    return join(compactDir, CIRCUIT_FILE);
  }

  function atomicWriteJson(filePath: string, value: unknown): void {
    const dir = dirname(filePath);
    mkdirSync(dir, { recursive: true });
    const tempPath = join(dir, `${TEMP_PREFIX}${randomUUID()}.tmp`);
    const fd = openSync(
      tempPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      ATTEMPT_FILE_MODE
    );
    try {
      writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    } finally {
      closeSync(fd);
    }
    try {
      renameSync(tempPath, filePath);
    } catch (error) {
      try {
        unlinkSync(tempPath);
      } catch {
        // best effort
      }
      throw error;
    }
  }

  function readNoFollowJson<T>(filePath: string): T {
    const fd = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const raw = readFileSync(fd, 'utf8');
      return JSON.parse(raw) as T;
    } finally {
      closeSync(fd);
    }
  }

  function assertNoSymlink(filePath: string): void {
    if (!existsSync(filePath)) return;
    if (lstatSync(filePath).isSymbolicLink()) {
      throw new Error(`refusing to follow symlink at ${filePath}`);
    }
  }

  function loadSessionCircuit(): CompactSessionCircuitState {
    const p = circuitPath();
    if (!existsSync(p)) {
      return {
        schemaVersion: 1,
        sessionId,
        consecutiveVerificationFailures: 0,
        circuit: 'closed',
        openedAt: null,
        lastAttemptId: null,
        lastFailureCode: null,
        manualPromptShown: false
      };
    }
    assertNoSymlink(p);
    const parsed = readNoFollowJson<unknown>(p);
    return CompactSessionCircuitStateSchema.parse(parsed);
  }

  function saveSessionCircuit(circuit: CompactSessionCircuitState): void {
    ensureCompactDir();
    atomicWriteJson(circuitPath(), CompactSessionCircuitStateSchema.parse(circuit));
  }

  function assertMonotonicTransition(prev: CompactAttemptJournal, next: CompactAttemptJournal): void {
    if (next.pathGeneration < prev.pathGeneration) {
      throw new Error(
        `attempt journal pathGeneration must not regress: ${prev.pathGeneration} → ${next.pathGeneration}`
      );
    }
    if (!isPermittedStageTransition(prev.stage, next.stage)) {
      throw new Error(
        `attempt journal stage must not regress without a recovery transition: ${prev.stage} → ${next.stage}`
      );
    }
    if (next.sessionId !== prev.sessionId) {
      throw new Error('attempt journal sessionId is immutable');
    }
    if (next.capabilityEpoch !== prev.capabilityEpoch) {
      throw new Error('attempt journal capabilityEpoch is immutable');
    }
  }

  async function writeAttempt(journal: CompactAttemptJournal): Promise<void> {
    const validated = CompactAttemptJournalSchema.parse(journal);
    const path = journalPathFor(validated.attemptId);
    ensureCompactDir();
    if (existsSync(path)) {
      assertNoSymlink(path);
      const priorRaw = readNoFollowJson<unknown>(path);
      const prior = CompactAttemptJournalSchema.parse(priorRaw);
      assertMonotonicTransition(prior, validated);
    }
    atomicWriteJson(path, validated);
  }

  async function readAttempt(attemptId: string): Promise<CompactAttemptJournal | null> {
    const path = journalPathFor(attemptId);
    if (!existsSync(path)) return null;
    assertNoSymlink(path);
    const raw = readNoFollowJson<unknown>(path);
    return CompactAttemptJournalSchema.parse(raw);
  }

  async function sealIdempotencyKey(attemptId: string, key: string): Promise<void> {
    assertSafeIdempotencyKey(key);
    const current = await readAttempt(attemptId);
    if (!current) {
      throw new Error(`cannot seal idempotency key: attempt ${attemptId} has no journal yet`);
    }
    const merged: CompactAttemptJournal = {
      ...current,
      sealedIdempotencyKeys: current.sealedIdempotencyKeys.includes(key)
        ? current.sealedIdempotencyKeys
        : [...current.sealedIdempotencyKeys, key],
      updatedAt: new Date().toISOString()
    };
    await writeAttempt(merged);
  }

  async function readSessionCircuit(): Promise<CompactSessionCircuitState> {
    return loadSessionCircuit();
  }

  async function recordVerificationFailure(
    attemptId: string,
    code: string
  ): Promise<CompactSessionCircuitState> {
    assertSafePathSegment('attemptId', attemptId);
    if (!/^[A-Z][A-Z0-9_]*$/.test(code)) {
      throw new Error(`failure code "${code}" must be SCREAMING_SNAKE_CASE`);
    }
    const prev = loadSessionCircuit();
    const count = prev.consecutiveVerificationFailures + 1;
    const trip = count >= VERIFICATION_CIRCUIT_TRIP_THRESHOLD;
    const next: CompactSessionCircuitState = {
      ...prev,
      consecutiveVerificationFailures: count,
      circuit: trip ? 'open' : prev.circuit,
      openedAt: trip ? new Date().toISOString() : prev.openedAt,
      lastAttemptId: attemptId,
      lastFailureCode: code
    };
    saveSessionCircuit(next);
    return next;
  }

  async function markManualPromptShown(): Promise<void> {
    const prev = loadSessionCircuit();
    if (prev.manualPromptShown) return;
    saveSessionCircuit({ ...prev, manualPromptShown: true });
  }

  async function markVerificationRecovered(): Promise<CompactSessionCircuitState> {
    const prev = loadSessionCircuit();
    const next: CompactSessionCircuitState = {
      ...prev,
      consecutiveVerificationFailures: 0,
      circuit: 'closed',
      openedAt: null,
      lastFailureCode: null
    };
    saveSessionCircuit(next);
    return next;
  }

  async function resetVerificationFailures(): Promise<void> {
    const prev = loadSessionCircuit();
    if (prev.circuit === 'open') {
      throw new Error(
        'cannot reset verification failures while the circuit is open (design §10.3)'
      );
    }
    if (prev.consecutiveVerificationFailures === 0) return;
    saveSessionCircuit({ ...prev, consecutiveVerificationFailures: 0, lastFailureCode: null });
  }

  return {
    writeAttempt,
    readAttempt,
    sealIdempotencyKey,
    readSessionCircuit,
    recordVerificationFailure,
    markManualPromptShown,
    markVerificationRecovered,
    resetVerificationFailures
  };
}

/**
 * `realpathSync` wrapper that throws a descriptive error when the path
 * cannot be resolved. We intentionally do NOT silently fall back to the
 * raw input — a path whose canonical form cannot be resolved is, by
 * definition, uncontained, and the store must refuse to operate on it.
 */
function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch (error) {
    throw new Error(
      `failed to resolve canonical path for ${p}: ${(error as Error).message ?? String(error)}`
    );
  }
}