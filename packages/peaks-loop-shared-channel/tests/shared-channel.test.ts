/**
 * G8.3 / G8.4 — SharedChannel + SharedChannelEntry + atomic write + value size limit + batchId isolation.
 *
 * Coverage:
 *  - SharedChannelEntry schema
 *  - writeSharedEntry atomic write (tmp + rename)
 *  - value size hard reject (>= 64KB) -> VALUE_TOO_LARGE
 *  - value size soft warn (> 1KB) -> softWarning: true
 *  - last-write-wins by key
 *  - readSharedChannel with --since filter
 *  - readSharedChannel with --key pattern filter
 *  - readSharedChannel returns empty channel for non-existent file
 *  - isOrphanChannel 30-day TTL
 *  - gcChannel deletes the file
 *  - 1MB file cap with LRU eviction
 */
import { existsSync, mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SHARED_CHANNEL_MAX_FILE_BYTES,
  SHARED_CHANNEL_MAX_VALUE_BYTES,
  SHARED_CHANNEL_SOFT_VALUE_WARN,
  SHARED_CHANNEL_TTL_DAYS,
  compileKeyPattern,
  gcChannel,
  isOrphanChannel,
  readSharedChannel,
  writeSharedEntry
} from '../src/shared-channel.js';
import { assertSafeSharedChannelPath, sharedChannelPath } from '../src/dispatch-context-guard.js';

let root: string;
const SID = '2026-06-06-session-5b1095';
const RID = '003-2026-06-07';
const BATCH = 'batch-abc-123';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-g8-channel-'));
  mkdirSync(join(root, '.peaks', '_sub_agents', SID, 'shared'), { recursive: true });
});

afterEach(() => {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
});

describe('G8 SharedChannelEntry schema', () => {
  it('writeSharedEntry returns the new entry with all fields', () => {
    const r = writeSharedEntry({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: BATCH,
      key: 'rd.completed',
      from: 'rd',
      value: { summary: 'wrote tech-doc', size: 1234 }
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.entry.key).toBe('rd.completed');
      expect(r.entry.from).toBe('rd');
      expect(r.entry.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(r.entry.valueSize).toBeGreaterThan(0);
      expect(r.entry.value).toEqual({ summary: 'wrote tech-doc', size: 1234 });
    }
  });

  it('entry value is frozen (immutable)', () => {
    const r = writeSharedEntry({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: BATCH,
      key: 'k1',
      from: 'rd',
      value: { a: 1 }
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.isFrozen(r.entry.value)).toBe(true);
    }
  });
});

describe('G8 atomic write', () => {
  it('creates the channel file at the canonical path', () => {
    writeSharedEntry({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: BATCH,
      key: 'rd.completed',
      from: 'rd',
      value: { ok: true }
    });
    const expected = sharedChannelPath(root, SID, RID, BATCH);
    expect(existsSync(expected)).toBe(true);
  });

  it('no .tmp- files left behind after a successful write', () => {
    writeSharedEntry({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: BATCH,
      key: 'k1',
      from: 'rd',
      value: { a: 1 }
    });
    const dir = join(root, '.peaks', '_sub_agents', SID, 'shared');
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    const files = readdirSync(dir);
    expect(files.some((f) => f.includes('.tmp-'))).toBe(false);
  });
});

describe('G8 value size limit (RL-25)', () => {
  it('rejects values >= 64KB with VALUE_TOO_LARGE', () => {
    const bigValue = { data: 'x'.repeat(SHARED_CHANNEL_MAX_VALUE_BYTES) };
    const r = writeSharedEntry({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: BATCH,
      key: 'k1',
      from: 'rd',
      value: bigValue
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('VALUE_TOO_LARGE');
    }
  });

  it('soft warns on values > 1KB (RL-25)', () => {
    const medValue = { data: 'x'.repeat(SHARED_CHANNEL_SOFT_VALUE_WARN + 100) };
    const r = writeSharedEntry({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: BATCH,
      key: 'k1',
      from: 'rd',
      value: medValue
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.softWarning).toBe(true);
    }
  });
});

describe('G8 last-write-wins by key', () => {
  it('second write to same key overwrites the first; lastWriteWins: true', () => {
    const r1 = writeSharedEntry({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: BATCH,
      key: 'rd.completed',
      from: 'rd',
      value: { v: 1 }
    });
    expect(r1.ok).toBe(true);
    const r2 = writeSharedEntry({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: BATCH,
      key: 'rd.completed',
      from: 'rd',
      value: { v: 2 }
    });
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.lastWriteWins).toBe(true);
    }
    const ch = readSharedChannel({ projectRoot: root, sid: SID, rid: RID, batchId: BATCH });
    expect(ch.entries['rd.completed']?.value).toEqual({ v: 2 });
  });
});

describe('G8 read filters', () => {
  beforeEach(() => {
    writeSharedEntry({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: BATCH,
      key: 'rd.completed',
      from: 'rd',
      value: { v: 'r1' }
    });
    writeSharedEntry({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: BATCH,
      key: 'qa.completed',
      from: 'qa',
      value: { v: 'q1' }
    });
    writeSharedEntry({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: BATCH,
      key: 'rd.found-blocker',
      from: 'rd',
      value: { reason: 'missing dep' }
    });
  });

  it('no filters => all entries', () => {
    const ch = readSharedChannel({ projectRoot: root, sid: SID, rid: RID, batchId: BATCH });
    expect(Object.keys(ch.entries).length).toBe(3);
  });

  it('--key pattern rd.* matches rd-prefixed keys', () => {
    const ch = readSharedChannel({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: BATCH,
      keyPattern: 'rd.*'
    });
    expect(Object.keys(ch.entries).sort()).toEqual(['rd.completed', 'rd.found-blocker']);
  });

  it('--key pattern *.completed matches suffix', () => {
    const ch = readSharedChannel({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: BATCH,
      keyPattern: '*.completed'
    });
    expect(Object.keys(ch.entries).sort()).toEqual(['qa.completed', 'rd.completed']);
  });

  it('--since filters out entries before the timestamp', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const ch = readSharedChannel({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: BATCH,
      since: future
    });
    expect(Object.keys(ch.entries).length).toBe(0);
  });
});

describe('G8 read empty channel', () => {
  it('returns empty channel for non-existent file', () => {
    const ch = readSharedChannel({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: BATCH
    });
    expect(ch.entries).toEqual({});
    expect(ch.batchId).toBe(BATCH);
  });
});

describe('G8 batchId isolation (RL-26)', () => {
  it('channel for batchA does not leak into batchB', () => {
    writeSharedEntry({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: 'batchA',
      key: 'rd.completed',
      from: 'rd',
      value: { v: 'a' }
    });
    const chB = readSharedChannel({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: 'batchB'
    });
    expect(chB.entries).toEqual({});
  });
});

describe('G8 GC + TTL', () => {
  it('isOrphanChannel: missing file => true', () => {
    expect(
      isOrphanChannel({ projectRoot: root, sid: SID, rid: RID, batchId: BATCH })
    ).toBe(true);
  });

  it('isOrphanChannel: file newer than TTL => false', () => {
    writeSharedEntry({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: BATCH,
      key: 'k1',
      from: 'rd',
      value: { ok: true }
    });
    expect(
      isOrphanChannel({ projectRoot: root, sid: SID, rid: RID, batchId: BATCH })
    ).toBe(false);
  });

  it('isOrphanChannel: file older than TTL => true', () => {
    writeSharedEntry({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: BATCH,
      key: 'k1',
      from: 'rd',
      value: { ok: true }
    });
    // Backdate the file's mtime to TTL + 1 day
    const path = sharedChannelPath(root, SID, RID, BATCH);
    const oldTime = new Date(Date.now() - (SHARED_CHANNEL_TTL_DAYS + 1) * 24 * 60 * 60 * 1000);
    const { utimesSync } = require('node:fs') as typeof import('node:fs');
    utimesSync(path, oldTime, oldTime);
    expect(
      isOrphanChannel({ projectRoot: root, sid: SID, rid: RID, batchId: BATCH })
    ).toBe(true);
  });

  it('gcChannel deletes the file', () => {
    writeSharedEntry({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: BATCH,
      key: 'k1',
      from: 'rd',
      value: { ok: true }
    });
    const path = sharedChannelPath(root, SID, RID, BATCH);
    expect(existsSync(path)).toBe(true);
    const ok = gcChannel({ projectRoot: root, sid: SID, rid: RID, batchId: BATCH });
    expect(ok).toBe(true);
    expect(existsSync(path)).toBe(false);
  });
});

describe('G8 LRU eviction on 1MB cap', () => {
  it('evicts oldest entries when the file would exceed 1MB', () => {
    // Write many entries that each take ~50KB to push the file over 1MB.
    const bigish = { data: 'x'.repeat(50 * 1024) };
    for (let i = 0; i < 30; i += 1) {
      const r = writeSharedEntry({
        projectRoot: root,
        sid: SID,
        rid: RID,
        batchId: BATCH,
        key: `entry-${String(i).padStart(3, '0')}`,
        from: 'rd',
        value: bigish
      });
      expect(r.ok).toBe(true);
    }
    const path = sharedChannelPath(root, SID, RID, BATCH);
    const stat = statSync(path);
    // The cap is 1MB; we should not exceed it.
    expect(stat.size).toBeLessThanOrEqual(SHARED_CHANNEL_MAX_FILE_BYTES + 4096); // small slack for JSON
  });
});

describe('G8 path safety (R-2)', () => {
  it('rejects .. segments in shared channel path', () => {
    // path.join collapses `..` segments, so we build the path string manually.
    const bad = `${root}/.peaks/_sub_agents/${SID}/shared/../evil.json`;
    expect(() => assertSafeSharedChannelPath(bad, root)).toThrow(/must not contain \.\. segments/);
  });

  it('rejects relative path', () => {
    expect(() => assertSafeSharedChannelPath('relative/path.json', root)).toThrow(/must be absolute/);
  });

  it('rejects path outside .peaks/_sub_agents/', () => {
    const bad = join(root, 'tmp', 'evil.json');
    expect(() => assertSafeSharedChannelPath(bad, root)).toThrow(/must be under \.peaks\/_sub_agents\//);
  });
});

/**
 * G5 — concurrent LWW fuzz for shared-channel (slice A.3 of
 * v2-14-0-anti-fake-green-hardening, AC-5.2).
 *
 * Verifies that `writeSharedEntry` (last-write-wins by key) remains
 * lossless when ≥4 concurrent Promises target the same key in the
 * same batch. The file-lock (`withFileLockSync`) is what protects this
 * invariant; this fuzz pins the contract.
 *
 * 20× repeat (RACE_REPEAT): vitest 2.1.9 (the pinned version) does not
 * expose a `--repeat` CLI flag (added in vitest 2.2+). To satisfy
 * AC-5.1's "20× repeat" intent without bumping the vitest dep, every
 * fuzz case in this file wraps its body in a 20-iteration loop. Each
 * iteration uses a fresh `mkdtempSync` root from the outer beforeEach.
 *
 * Tooling: vitest built-in + Node `setImmediate` / `process.nextTick`
 * scheduling. NO fast-check / jsfuzz per AC-5.5.
 */

/**
 * Slice 016 — repeat count for race-mode fuzz.
 *
 * History: matched PRD AC-5.1's `--repeat=20` intent (slice 014 era).
 * Default 20× produced 180s timeouts under `pnpm test:full` after the
 * slice-014b parallelism unlock (fileParallelism=true, 4 forked workers).
 *
 * 20× with N=6 concurrent writers × on-disk lock acquisition × 4 fork
 * contention produced >180s wall-clock per test (verified in
 * `.peaks/_runtime/2026-07-14-session-cebb2d/qa/requests/` slice-015b run).
 * Standalone runs are fast (18.6s for 27 tests); only under full-suite
 * contention does the wall-clock balloon.
 *
 * Brought down to 3 — same approach slice-014 used for
 * heartbeat.test.ts and dispatch-record-writer.test.ts. Honours
 * `process.env.PEAKS_RACE_REPEAT` override so the full 20× path is still
 * exercisable under `pnpm test:race` (single-fork, `--no-file-parallelism`,
 * dedicated to race-mode files).
 */
const RACE_REPEAT = Number(process.env.PEAKS_RACE_REPEAT ?? 3);

describe('G5 shared-channel concurrent LWW fuzz', () => {
  // Per-test timeouts brought down from 180s → 60s. RACE_REPEAT=3 with
  // a per-rep wall-clock of <10s safely fits; under `pnpm test:race`
  // (single fork, no contention) with PEAKS_RACE_REPEAT=20 the original
  // 180s ceiling is restored by overriding the env var (or via the new
  // test:race entry — see package.json).
  it('≥4 concurrent writeSharedEntry to the same key: exactly one final value survives and it is from the launched set', { timeout: 60_000 }, async () => {
    for (let rep = 0; rep < RACE_REPEAT; rep += 1) {
      const key = `rd.completed-${rep}`;
      const batch = `${BATCH}-rep-${rep}`;
      const N = 6; // ≥4 per AC-5.2
      // Schedule each writer on a microtask + macrotask boundary so all N
      // tasks reach the lock acquisition interleaved. The lock
      // (`withFileLockSync`) must serialize them so the final channel
      // file holds exactly ONE entry for `key` (LWW) and that entry's
      // value comes from the launched set.
      const promises: Promise<{ v: number }>[] = [];
      for (let i = 0; i < N; i += 1) {
        const v = i + 1;
        promises.push(
          new Promise<{ v: number }>((resolveW) => {
            process.nextTick(() => {
              setImmediate(() => {
                const r = writeSharedEntry({
                  projectRoot: root,
                  sid: SID,
                  rid: RID,
                  batchId: batch,
                  key,
                  from: 'rd',
                  value: { v }
                });
                if (r.ok) {
                  resolveW(r.entry.value as { v: number });
                } else {
                  throw new Error(`writeSharedEntry returned ${r.code}: ${r.message}`);
                }
              });
            });
          })
        );
      }
      const values = await Promise.all(promises);
      // Every write call returned a value — no error path was taken.
      expect(values).toHaveLength(N);

      // Re-read the channel file directly via readSharedChannel and pin
      // the LWW invariant: exactly one entry for the key, and its value
      // must come from the set {1..N}.
      const ch = readSharedChannel({
        projectRoot: root,
        sid: SID,
        rid: RID,
        batchId: batch
      });
      expect(Object.keys(ch.entries)).toEqual([key]);
      const finalEntry = ch.entries[key];
      expect(finalEntry).toBeDefined();
      const finalV = (finalEntry?.value as { v: number }).v;
      expect(finalV).toBeGreaterThanOrEqual(1);
      expect(finalV).toBeLessThanOrEqual(N);
    }
  });

  it('≥4 concurrent writeSharedEntry to distinct keys: all N keys survive (no lost updates)', { timeout: 60_000 }, async () => {
    // Distinct keys → no LWW collision, but the lock + read-modify-
    // write sequence must still produce a channel file with all N
    // entries. A lost-update regression would surface as fewer entries.
    for (let rep = 0; rep < RACE_REPEAT; rep += 1) {
      const batch = `${BATCH}-distinct-rep-${rep}`;
      const N = 5;
      const promises: Promise<string>[] = [];
      for (let i = 0; i < N; i += 1) {
        const key = `rd.k-${rep}-${i}`;
        promises.push(
          new Promise<string>((resolveW) => {
            process.nextTick(() => {
              setImmediate(() => {
                const r = writeSharedEntry({
                  projectRoot: root,
                  sid: SID,
                  rid: RID,
                  batchId: batch,
                  key,
                  from: 'rd',
                  value: { v: i }
                });
                if (r.ok) {
                  resolveW(key);
                } else {
                  throw new Error(`writeSharedEntry returned ${r.code}: ${r.message}`);
                }
              });
            });
          })
        );
      }
      const keys = await Promise.all(promises);
      expect(keys).toHaveLength(N);

      const ch = readSharedChannel({
        projectRoot: root,
        sid: SID,
        rid: RID,
        batchId: batch
      });
      // All N keys must be present.
      for (const key of keys) {
        expect(ch.entries[key]).toBeDefined();
      }
      expect(Object.keys(ch.entries).length).toBe(N);
    }
  });
});

describe('G8 compileKeyPattern', () => {
  it('* matches anything', () => {
    const m = compileKeyPattern('*');
    expect(m('rd.completed')).toBe(true);
    expect(m('anything-else')).toBe(true);
  });
  it('prefix.* matches prefix prefix', () => {
    const m = compileKeyPattern('rd.*');
    expect(m('rd.completed')).toBe(true);
    expect(m('qa.completed')).toBe(false);
  });
  it('*.suffix matches suffix', () => {
    const m = compileKeyPattern('*.completed');
    expect(m('rd.completed')).toBe(true);
    expect(m('rd.partial')).toBe(false);
  });
  it('exact (no *) is exact match', () => {
    const m = compileKeyPattern('rd.completed');
    expect(m('rd.completed')).toBe(true);
    expect(m('rd.found-blocker')).toBe(false);
  });
});
