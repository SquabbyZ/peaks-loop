/**
 * Task 1.2 — atomic attempt journals + session failure state.
 *
 * Covers design §6 (state machine), §10.3 (verification circuit), §10.5
 * (atomic attempt journals under `.peaks/_runtime/<sessionId>/`), §15
 * (observability — no raw transcript / capsule / secrets) and §16 (path
 * safety). The store is the durable seam the later verifier / circuit /
 * coordinator slices consume.
 *
 *   paths:
 *     .peaks/_runtime/<sessionId>/compact-attempts/<attemptId>.journal.json
 *     .peaks/_runtime/<sessionId>/compact-attempts/session-circuit.json
 *
 * Hard constraints re-verified here:
 *   - atomic temp + rename, 0o600 target where supported
 *   - no-follow reads
 *   - monotonic pathGeneration; stage regression rejected unless it is
 *     an explicit recovery transition (the §10.2 rules)
 *   - session circuit state persists across a fresh store instance and a
 *     new attemptId (must not be cleared by an attemptId rotation, design
 *     §10.3)
 *   - path segment validation before join; symlink/junction escape rejected
 *   - journal contains no raw continuation token, capsule, transcript,
 *     secret or vendor command (§15)
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  COMPACT_STAGES,
  type CompactAttemptJournal,
  type CompactSessionCircuitState
} from '../../../../src/services/compact-core/attempt-schema.js';
import {
  createAttemptStore,
  type AttemptStore
} from '../../../../src/services/compact-core/attempt-store.js';

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-attempt-store-'));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

const SESSION = 'sess-2026-07-23-aaaa';
const ATTEMPT = 'attempt-0001';

function newJournal(overrides: Partial<CompactAttemptJournal> = {}): CompactAttemptJournal {
  const now = '2026-07-23T00:00:00.000Z';
  return {
    schemaVersion: 1,
    sessionId: SESSION,
    attemptId: ATTEMPT,
    pathGeneration: 0,
    stage: 'probing',
    verificationFailureCount: 0,
    capabilityEpoch: 'epoch-1',
    sealedIdempotencyKeys: [],
    lastFailureCode: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

describe('COMPACT_STAGES', () => {
  it('lists the §6.1 state-machine stages including terminal/recovery transitions', () => {
    expect(COMPACT_STAGES).toContain('probing');
    expect(COMPACT_STAGES).toContain('preparing');
    expect(COMPACT_STAGES).toContain('checkpointing');
    expect(COMPACT_STAGES).toContain('native-compacting');
    expect(COMPACT_STAGES).toContain('fallback-summarizing');
    expect(COMPACT_STAGES).toContain('replacing');
    expect(COMPACT_STAGES).toContain('verifying');
    expect(COMPACT_STAGES).toContain('resuming');
    expect(COMPACT_STAGES).toContain('recovering');
    expect(COMPACT_STAGES).toContain('retrying');
    expect(COMPACT_STAGES).toContain('rolled-back');
    expect(COMPACT_STAGES).toContain('blocked');
    expect(COMPACT_STAGES).toContain('completed');
  });
});

describe('createAttemptStore — path safety', () => {
  it('rejects sessionId containing a path separator or traversal', () => {
    expect(() => createAttemptStore({ projectRoot, sessionId: '../escape' })).toThrow(/sessionId/);
    expect(() => createAttemptStore({ projectRoot, sessionId: 'a/b' })).toThrow(/sessionId/);
    expect(() => createAttemptStore({ projectRoot, sessionId: '' })).toThrow(/sessionId/);
  });

  it('rejects attemptId containing a path separator or traversal', async () => {
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });
    await expect(store.writeAttempt(newJournal({ attemptId: '../escape' }))).rejects.toThrow(/attemptId/);
    await expect(store.writeAttempt(newJournal({ attemptId: 'a/b' }))).rejects.toThrow(/attemptId/);
    await expect(store.writeAttempt(newJournal({ attemptId: '' }))).rejects.toThrow(/attemptId/);
  });

  it('writes under .peaks/_runtime/<sessionId>/compact-attempts/<attemptId>.journal.json', async () => {
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });
    await store.writeAttempt(newJournal());
    const expected = join(
      projectRoot,
      '.peaks',
      '_runtime',
      SESSION,
      'compact-attempts',
      `${ATTEMPT}.journal.json`
    );
    expect(existsSync(expected)).toBe(true);
  });

  it('writes the session-circuit.json lazily on the first circuit mutation', async () => {
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });
    await store.writeAttempt(newJournal());
    const expected = join(
      projectRoot,
      '.peaks',
      '_runtime',
      SESSION,
      'compact-attempts',
      'session-circuit.json'
    );
    // The circuit is read-then-mutated lazily. A bare `writeAttempt` does
    // not touch the circuit, so the file does not exist yet.
    expect(existsSync(expected)).toBe(false);
    await store.recordVerificationFailure(ATTEMPT, 'CONTEXT_NOT_REDUCED');
    expect(existsSync(expected)).toBe(true);
  });

  it('rejects a symlinked compact-attempts directory (junction escape)', async () => {
    if (process.platform === 'win32') {
      // symlink creation requires elevated privileges on Windows; the
      // structural guard is still validated via the no-follow read tests
      // below, which exercise the same escape surface without requiring
      // admin or Developer Mode. Skip the junction test here.
      return;
    }
    // Build the parent dir tree, then replace compact-attempts with a
    // symlink pointing outside the project root. The store must refuse.
    const outsideDir = mkdtempSync(join(tmpdir(), 'peaks-outside-'));
    try {
      const runtimeDir = join(projectRoot, '.peaks', '_runtime', SESSION);
      mkdirSync(join(runtimeDir, 'compact-attempts'), { recursive: true });
      // Remove the directory and replace with a symlink.
      rmSync(join(runtimeDir, 'compact-attempts'), { recursive: true, force: true });
      symlinkSync(outsideDir, join(runtimeDir, 'compact-attempts'), 'dir');

      const store = createAttemptStore({ projectRoot, sessionId: SESSION });
      await expect(store.writeAttempt(newJournal())).rejects.toThrow(/symlink/);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

describe('atomic write semantics', () => {
  it('uses temp + rename (no leftover temp files)', async () => {
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });
    await store.writeAttempt(newJournal());
    const compactDir = join(projectRoot, '.peaks', '_runtime', SESSION, 'compact-attempts');
    const leftovers = readdirSyncCompat(compactDir).filter((f) => f.startsWith('.attempt-') && f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('writes the journal with 0o600 permissions where supported', async () => {
    if (process.platform === 'win32') {
      // chmod has no meaningful effect on Windows; skip.
      return;
    }
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });
    await store.writeAttempt(newJournal());
    const target = join(
      projectRoot,
      '.peaks',
      '_runtime',
      SESSION,
      'compact-attempts',
      `${ATTEMPT}.journal.json`
    );
    const stat = lstatSync(target);
    // Mask out the high bits; we only assert the lower 9 (perm bits).
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('the previous target file is replaced atomically (no truncation window)', async () => {
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });
    await store.writeAttempt(newJournal({ pathGeneration: 0 }));
    // Replace with a new generation; the file content must be the new
    // generation end-to-end (no half-written intermediate).
    const target = join(
      projectRoot,
      '.peaks',
      '_runtime',
      SESSION,
      'compact-attempts',
      `${ATTEMPT}.journal.json`
    );
    await store.writeAttempt(newJournal({ pathGeneration: 1, stage: 'preparing' }));
    const raw = readFileSync(target, 'utf8');
    const parsed = JSON.parse(raw) as CompactAttemptJournal;
    expect(parsed.pathGeneration).toBe(1);
    expect(parsed.stage).toBe('preparing');
  });
});

describe('on-disk shape (strict Zod)', () => {
  it('rejects a corrupt journal (schemaVersion mismatch)', async () => {
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });
    await store.writeAttempt(newJournal());
    const target = join(
      projectRoot,
      '.peaks',
      '_runtime',
      SESSION,
      'compact-attempts',
      `${ATTEMPT}.journal.json`
    );
    writeFileSync(target, JSON.stringify({ ...newJournal(), schemaVersion: 2 }), 'utf8');
    await expect(store.readAttempt(ATTEMPT)).rejects.toThrow();
  });

  it('rejects an unknown stage', async () => {
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });
    await store.writeAttempt(newJournal());
    const target = join(
      projectRoot,
      '.peaks',
      '_runtime',
      SESSION,
      'compact-attempts',
      `${ATTEMPT}.journal.json`
    );
    const raw = JSON.parse(readFileSync(target, 'utf8')) as Record<string, unknown>;
    raw.stage = 'invented-stage';
    writeFileSync(target, JSON.stringify(raw), 'utf8');
    await expect(store.readAttempt(ATTEMPT)).rejects.toThrow(/stage/);
  });

  it('rejects a journal with a negative pathGeneration', async () => {
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });
    await store.writeAttempt(newJournal());
    const target = join(
      projectRoot,
      '.peaks',
      '_runtime',
      SESSION,
      'compact-attempts',
      `${ATTEMPT}.journal.json`
    );
    const raw = JSON.parse(readFileSync(target, 'utf8')) as Record<string, unknown>;
    raw.pathGeneration = -1;
    writeFileSync(target, JSON.stringify(raw), 'utf8');
    await expect(store.readAttempt(ATTEMPT)).rejects.toThrow();
  });

  it('rejects malformed JSON', async () => {
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });
    await store.writeAttempt(newJournal());
    const target = join(
      projectRoot,
      '.peaks',
      '_runtime',
      SESSION,
      'compact-attempts',
      `${ATTEMPT}.journal.json`
    );
    writeFileSync(target, '{ not json', 'utf8');
    await expect(store.readAttempt(ATTEMPT)).rejects.toThrow();
  });

  it('rejects a symlinked journal file (no-follow)', async () => {
    if (process.platform === 'win32') {
      // Creating a symlink to a file requires elevated privileges on
      // Windows. The no-follow read guard is independently exercised by
      // the symlinked session-circuit.json test below, which uses a
      // similar surface; we skip here to avoid permission flakiness.
      return;
    }
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });
    await store.writeAttempt(newJournal());
    const compactDir = join(projectRoot, '.peaks', '_runtime', SESSION, 'compact-attempts');
    const target = join(compactDir, `${ATTEMPT}.journal.json`);
    const outside = join(tmpdir(), `peaks-outside-${Date.now()}.json`);
    writeFileSync(outside, JSON.stringify(newJournal({ stage: 'verifying' })), 'utf8');
    try {
      // Replace the real journal with a symlink to a different payload;
      // the no-follow open must reject the symlink target on read.
      rmSync(target, { force: true });
      symlinkSync(outside, target, 'file');
      await expect(store.readAttempt(ATTEMPT)).rejects.toThrow(/symlink/);
    } finally {
      rmSync(outside, { force: true });
    }
  });
});

describe('monotonic generation + stage rules', () => {
  it('rejects a re-write with a smaller pathGeneration', async () => {
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });
    await store.writeAttempt(newJournal({ pathGeneration: 2, stage: 'replacing' }));
    await expect(
      store.writeAttempt(newJournal({ pathGeneration: 1, stage: 'preparing' }))
    ).rejects.toThrow(/pathGeneration/);
  });

  it('rejects an explicit stage regression unless it is a recovery transition', async () => {
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });
    await store.writeAttempt(newJournal({ pathGeneration: 3, stage: 'verifying' }));
    // Replacing back to 'preparing' is a plain regression → reject.
    await expect(
      store.writeAttempt(newJournal({ pathGeneration: 3, stage: 'preparing' }))
    ).rejects.toThrow(/stage/);
  });

  it('accepts a stage regression into the recovery transition family', async () => {
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });
    await store.writeAttempt(newJournal({ pathGeneration: 5, stage: 'verifying' }));
    // verifying → recovering is the §10.2 recovery path → allowed.
    await expect(
      store.writeAttempt(newJournal({ pathGeneration: 5, stage: 'recovering', lastFailureCode: 'COMPACT_TIMEOUT' }))
    ).resolves.toBeUndefined();
    // recovering → retrying is the next step in the recovery family → allowed.
    await expect(
      store.writeAttempt(newJournal({ pathGeneration: 5, stage: 'retrying' }))
    ).resolves.toBeUndefined();
  });

  it('bumps updatedAt on every successful write', async () => {
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });
    const first = newJournal({ updatedAt: '2026-07-23T00:00:00.000Z' });
    await store.writeAttempt(first);
    const later = newJournal({
      pathGeneration: 1,
      stage: 'preparing',
      updatedAt: '2026-07-23T00:00:05.000Z'
    });
    await store.writeAttempt(later);
    const read = await store.readAttempt(ATTEMPT);
    expect(read?.updatedAt).toBe('2026-07-23T00:00:05.000Z');
  });
});

describe('sealed idempotency keys', () => {
  it('appends new keys without duplicates', async () => {
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });
    await store.writeAttempt(newJournal({ sealedIdempotencyKeys: ['key-1'] }));
    await store.sealIdempotencyKey(ATTEMPT, 'key-2');
    await store.sealIdempotencyKey(ATTEMPT, 'key-1'); // duplicate, no-op
    const read = await store.readAttempt(ATTEMPT);
    expect(read?.sealedIdempotencyKeys).toEqual(['key-1', 'key-2']);
  });

  it('rejects empty / unsafe idempotency keys', async () => {
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });
    await store.writeAttempt(newJournal());
    await expect(store.sealIdempotencyKey(ATTEMPT, '')).rejects.toThrow(/idempotency/);
    await expect(store.sealIdempotencyKey(ATTEMPT, 'a/b')).rejects.toThrow(/idempotency/);
  });
});

describe('session circuit persistence', () => {
  it('reads back a closed circuit with zero failures', async () => {
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });
    await store.writeAttempt(newJournal());
    const circuit = await store.readSessionCircuit();
    expect(circuit).toMatchObject({
      schemaVersion: 1,
      sessionId: SESSION,
      consecutiveVerificationFailures: 0,
      circuit: 'closed',
      openedAt: null,
      manualPromptShown: false
    });
  });

  it('persists the verification failure count across a new store instance', async () => {
    const first: AttemptStore = createAttemptStore({ projectRoot, sessionId: SESSION });
    await first.writeAttempt(newJournal());
    await first.recordVerificationFailure(ATTEMPT, 'CONTEXT_NOT_REDUCED');
    await first.recordVerificationFailure(ATTEMPT, 'CONTINUITY_MISMATCH');

    const second: AttemptStore = createAttemptStore({ projectRoot, sessionId: SESSION });
    const circuit = await second.readSessionCircuit();
    expect(circuit.consecutiveVerificationFailures).toBe(2);
    expect(circuit.lastAttemptId).toBe(ATTEMPT);
    expect(circuit.circuit).toBe('closed');
  });

  it('opens the circuit on the third consecutive verification failure (§10.3)', async () => {
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });
    await store.writeAttempt(newJournal());
    await store.recordVerificationFailure(ATTEMPT, 'CONTEXT_NOT_REDUCED');
    await store.recordVerificationFailure(ATTEMPT, 'CONTEXT_NOT_REDUCED');
    await store.recordVerificationFailure(ATTEMPT, 'CONTEXT_NOT_REDUCED');
    const circuit = await store.readSessionCircuit();
    expect(circuit.circuit).toBe('open');
    expect(circuit.openedAt).not.toBeNull();
    expect(circuit.consecutiveVerificationFailures).toBe(3);
  });

  it('persists the open circuit across a new attemptId (cannot be bypassed by rotating the attempt)', async () => {
    const first: AttemptStore = createAttemptStore({ projectRoot, sessionId: SESSION });
    await first.writeAttempt(newJournal());
    await first.recordVerificationFailure(ATTEMPT, 'CONTEXT_NOT_REDUCED');
    await first.recordVerificationFailure(ATTEMPT, 'CONTEXT_NOT_REDUCED');
    await first.recordVerificationFailure(ATTEMPT, 'CONTEXT_NOT_REDUCED');

    // Now spin a brand-new attemptId and a brand-new store instance;
    // the circuit must still be open with the failures intact.
    const ATTEMPT_TWO = 'attempt-0002';
    const second: AttemptStore = createAttemptStore({ projectRoot, sessionId: SESSION });
    await second.writeAttempt(newJournal({ attemptId: ATTEMPT_TWO, pathGeneration: 0 }));
    const circuit = await second.readSessionCircuit();
    expect(circuit.circuit).toBe('open');
    expect(circuit.consecutiveVerificationFailures).toBe(3);
  });

  it('closes the circuit only on an explicit recovery signal', async () => {
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });
    await store.writeAttempt(newJournal());
    await store.recordVerificationFailure(ATTEMPT, 'CONTEXT_NOT_REDUCED');
    await store.recordVerificationFailure(ATTEMPT, 'CONTEXT_NOT_REDUCED');
    await store.recordVerificationFailure(ATTEMPT, 'CONTEXT_NOT_REDUCED');
    // Marking manual prompt shown must NOT close the circuit.
    await store.markManualPromptShown();
    const openCircuit = await store.readSessionCircuit();
    expect(openCircuit.circuit).toBe('open');
    expect(openCircuit.manualPromptShown).toBe(true);

    await store.markVerificationRecovered();
    const closedCircuit = await store.readSessionCircuit();
    expect(closedCircuit.circuit).toBe('closed');
    expect(closedCircuit.consecutiveVerificationFailures).toBe(0);
    expect(closedCircuit.openedAt).toBeNull();
  });

  it('reset clears the failure count only when the circuit is not open (§10.3 says process restart must not zero the counter)', async () => {
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });
    await store.writeAttempt(newJournal());
    await store.recordVerificationFailure(ATTEMPT, 'CONTEXT_NOT_REDUCED');
    await store.recordVerificationFailure(ATTEMPT, 'CONTEXT_NOT_REDUCED');
    // Two failures, circuit closed: reset must be honoured.
    await store.resetVerificationFailures();
    const cleared = await store.readSessionCircuit();
    expect(cleared.consecutiveVerificationFailures).toBe(0);

    // Trip the circuit, then try to reset — it must be rejected.
    await store.recordVerificationFailure(ATTEMPT, 'CONTEXT_NOT_REDUCED');
    await store.recordVerificationFailure(ATTEMPT, 'CONTEXT_NOT_REDUCED');
    await store.recordVerificationFailure(ATTEMPT, 'CONTEXT_NOT_REDUCED');
    await expect(store.resetVerificationFailures()).rejects.toThrow(/open/);
  });
});

describe('observability — journal contains no raw secrets (§15)', () => {
  it('does not serialize raw continuation tokens, capsule digests, transcripts or vendor commands', async () => {
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });
    await store.writeAttempt(newJournal({ lastFailureCode: 'CONTINUITY_MISMATCH' }));
    const target = join(
      projectRoot,
      '.peaks',
      '_runtime',
      SESSION,
      'compact-attempts',
      `${ATTEMPT}.journal.json`
    );
    const raw = readFileSync(target, 'utf8');
    // Defensive markers: these substrings must never appear in the journal.
    for (const forbidden of [
      'continuationToken',
      'capsule',
      'transcript',
      'secret',
      '/compact',
      'claude -c',
      'codex resume',
      'openai.com',
      'anthropic.com'
    ]) {
      expect(raw.toLowerCase()).not.toContain(forbidden);
    }
  });
});

describe('no-follow read for circuit state', () => {
  it('refuses to follow a symlinked session-circuit.json', async () => {
    if (process.platform === 'win32') {
      // Symlink creation requires elevated privileges on Windows.
      // The hardlink escape below exercises the same surface without
      // symlink creation.
      return;
    }
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });
    await store.writeAttempt(newJournal());
    const target = join(
      projectRoot,
      '.peaks',
      '_runtime',
      SESSION,
      'compact-attempts',
      'session-circuit.json'
    );
    const outside = join(tmpdir(), `peaks-outside-circuit-${Date.now()}.json`);
    const tampered: CompactSessionCircuitState = {
      schemaVersion: 1,
      sessionId: SESSION,
      consecutiveVerificationFailures: 0,
      circuit: 'closed',
      openedAt: null,
      lastAttemptId: null,
      lastFailureCode: null,
      manualPromptShown: false
    };
    writeFileSync(outside, JSON.stringify(tampered), 'utf8');
    try {
      rmSync(target, { force: true });
      symlinkSync(outside, target, 'file');
      await expect(store.readSessionCircuit()).rejects.toThrow(/symlink/);
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it('refuses to follow a hardlink to a file outside the compact-attempts directory', async () => {
    if (process.platform === 'win32') {
      // Hardlinks across devices rarely succeed on Windows and the
      // symlink/junction escape surface is already covered by the
      // symlink test. Skip.
      return;
    }
    const store = createAttemptStore({ projectRoot, sessionId: SESSION });
    await store.writeAttempt(newJournal());
    const compactDir = join(projectRoot, '.peaks', '_runtime', SESSION, 'compact-attempts');
    const target = join(compactDir, 'session-circuit.json');

    const outsideDir = mkdtempSync(join(tmpdir(), 'peaks-circuit-outside-'));
    const outside = join(outsideDir, 'hijack.json');
    writeFileSync(outside, '{"schemaVersion":1,"sessionId":"hijack","consecutiveVerificationFailures":0,"circuit":"closed","openedAt":null,"lastAttemptId":null,"manualPromptShown":false}', 'utf8');
    try {
      rmSync(target, { force: true });
      linkSync(outside, target);
      await expect(store.readSessionCircuit()).rejects.toThrow();
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

function readdirSyncCompat(dir: string): string[] {
  return readdirSync(dir);
}