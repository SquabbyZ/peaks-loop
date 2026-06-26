/**
 * Tests for `jsonl-store.ts` — pure file I/O for observability metrics.
 *
 * Slice A of v2.11.1 (slice topology observability). Mirrors the
 * existing `tests/unit/services/session/` pattern: real-fs tests in
 * per-test temp dirs via `mkdtempSync`, `afterEach` cleanup.
 */

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  MAX_METRICS_FILES,
  METRICS_DIR,
  METRICS_FILENAME,
  appendMetricLine,
  listSessionDirsWithMetrics,
  metricsDirPath,
  metricsFilePath,
  pruneMetricsFiles,
  readMetricLines
} from '../../../../src/services/observability/jsonl-store.js';
import { getSessionDir } from '../../../../src/services/session/getSessionDir.js';

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-obs-jsonl-'));
});

afterEach(() => {
  if (existsSync(projectRoot)) {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

function writeSession(sid: string, ageMs: number): string {
  const dir = getSessionDir(projectRoot, sid);
  mkdirSync(join(dir, METRICS_DIR), { recursive: true });
  const path = metricsFilePath(projectRoot, sid);
  writeFileSync(path, '{"schemaVersion":1}\n', 'utf8');
  // Force mtime by setting atime+mtime (mtime first then atime per syscall convention).
  const past = new Date(Date.now() - ageMs);
  const future = new Date(past.getTime() + 1000);
  // utimesSync via fs.utimesSync would be cleaner, but we can use the
  // same pattern checkpoint-service tests use by writing again to bump.
  // For determinism, we touch the file with an explicit timestamp via
  // Date.now offset — but mtime resolution makes this fragile, so we
  // instead rely on write order (later writes have higher mtime) and
  // adjust the test ordering explicitly. The helper just records the
  // path; ordering is asserted via write ordering in prune tests.
  void future;
  return path;
}

describe('jsonl-store path resolution', () => {
  test('metricsFilePath routes through getSessionDir (canonical)', () => {
    const sid = '2026-06-26-session-aabbcc';
    const expected = join(getSessionDir(projectRoot, sid), METRICS_DIR, METRICS_FILENAME);
    expect(metricsFilePath(projectRoot, sid)).toBe(expected);
  });

  test('metricsDirPath routes through getSessionDir (canonical)', () => {
    const sid = '2026-06-26-session-aabbcc';
    const expected = join(getSessionDir(projectRoot, sid), METRICS_DIR);
    expect(metricsDirPath(projectRoot, sid)).toBe(expected);
  });

  test('constants are exposed', () => {
    expect(MAX_METRICS_FILES).toBe(10);
    expect(METRICS_DIR).toBe('metrics');
    expect(METRICS_FILENAME).toBe('slices.jsonl');
  });
});

describe('appendMetricLine', () => {
  test('creates the metrics dir on first write and appends a line', () => {
    const sid = '2026-06-26-session-append';
    expect(existsSync(metricsDirPath(projectRoot, sid))).toBe(false);

    const ok = appendMetricLine(projectRoot, sid, '{"x":1}');

    expect(ok).toBe(true);
    expect(existsSync(metricsDirPath(projectRoot, sid))).toBe(true);
    expect(readFileSync(metricsFilePath(projectRoot, sid), 'utf8')).toBe('{"x":1}\n');
  });

  test('appends multiple lines, one newline-terminated line each', () => {
    const sid = '2026-06-26-session-append-multi';
    appendMetricLine(projectRoot, sid, '{"x":1}');
    appendMetricLine(projectRoot, sid, '{"x":2}');
    appendMetricLine(projectRoot, sid, '{"x":3}');
    expect(readFileSync(metricsFilePath(projectRoot, sid), 'utf8')).toBe('{"x":1}\n{"x":2}\n{"x":3}\n');
  });

  test('returns false (and does not throw) when the file path is unwritable', () => {
    const sid = '2026-06-26-session-append-fail';
    // Pre-create the metrics dir, then make the file read-only + the dir
    // read-only so appendFileSync fails with EACCES.
    mkdirSync(metricsDirPath(projectRoot, sid), { recursive: true });
    const path = metricsFilePath(projectRoot, sid);
    writeFileSync(path, '', 'utf8');
    chmodSync(path, 0o444);
    chmodSync(metricsDirPath(projectRoot, sid), 0o555);
    if (process.platform === 'win32') {
      // Windows ignores POSIX mode bits for non-executable files; skip
      // the negative case rather than producing a false negative.
      expect(true).toBe(true);
      return;
    }

    const ok = appendMetricLine(projectRoot, sid, '{"x":1}');

    expect(ok).toBe(false);
    // restore so afterEach rm works
    chmodSync(metricsDirPath(projectRoot, sid), 0o755);
    chmodSync(path, 0o644);
  });
});

describe('readMetricLines', () => {
  test('returns [] when the file does not exist', () => {
    expect(readMetricLines(projectRoot, '2026-06-26-session-no-file')).toEqual([]);
  });

  test('returns non-empty lines, filtering out blank trailing line', () => {
    const sid = '2026-06-26-session-read';
    mkdirSync(join(getSessionDir(projectRoot, sid), METRICS_DIR), { recursive: true });
    writeFileSync(metricsFilePath(projectRoot, sid), '{"a":1}\n{"a":2}\n\n', 'utf8');
    expect(readMetricLines(projectRoot, sid)).toEqual(['{"a":1}', '{"a":2}']);
  });

  test('tolerates CRLF line endings', () => {
    const sid = '2026-06-26-session-crlf';
    mkdirSync(join(getSessionDir(projectRoot, sid), METRICS_DIR), { recursive: true });
    writeFileSync(metricsFilePath(projectRoot, sid), '{"a":1}\r\n{"a":2}\r\n', 'utf8');
    expect(readMetricLines(projectRoot, sid)).toEqual(['{"a":1}', '{"a":2}']);
  });
});

describe('listSessionDirsWithMetrics', () => {
  test('returns [] when no .peaks/_runtime/ exists', () => {
    expect(listSessionDirsWithMetrics(projectRoot)).toEqual([]);
  });

  test('returns sessions that have a metrics file, with mtime', () => {
    writeSession('2026-06-26-session-a', 60_000);
    writeSession('2026-06-26-session-b', 30_000);
    const result = listSessionDirsWithMetrics(projectRoot);
    expect(result.map((r) => r.sessionId).sort()).toEqual([
      '2026-06-26-session-a',
      '2026-06-26-session-b'
    ]);
    expect(result.every((r) => typeof r.mtimeMs === 'number' && r.mtimeMs > 0)).toBe(true);
  });

  test('skips session dirs without a metrics file', () => {
    mkdirSync(getSessionDir(projectRoot, '2026-06-26-session-empty'), { recursive: true });
    writeSession('2026-06-26-session-with-metrics', 0);
    const result = listSessionDirsWithMetrics(projectRoot);
    expect(result).toHaveLength(1);
    expect(result[0]?.sessionId).toBe('2026-06-26-session-with-metrics');
  });

  test('skips non-directory entries under _runtime', () => {
    // A stray file under _runtime (e.g. the binding session.json) should
    // not show up as a session.
    mkdirSync(join(projectRoot, '.peaks', '_runtime'), { recursive: true });
    writeFileSync(join(projectRoot, '.peaks', '_runtime', 'stray.txt'), 'noise', 'utf8');
    expect(listSessionDirsWithMetrics(projectRoot)).toEqual([]);
  });
});

describe('pruneMetricsFiles', () => {
  test('no-op when count <= MAX_METRICS_FILES', () => {
    for (let i = 0; i < 5; i++) {
      writeSession(`2026-06-26-session-prune-noop-${i}`, (5 - i) * 1000);
    }
    expect(pruneMetricsFiles(projectRoot)).toEqual([]);
  });

  test('removes oldest files beyond MAX_METRICS_FILES', () => {
    // Write 12 sessions — last write wins highest mtime on most filesystems,
    // but mtime resolution can be 1s on some platforms. We force ordering by
    // writing in time-ascending order and using sleep to separate writes.
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const sid = `2026-06-26-session-prune-${String(i).padStart(2, '0')}`;
      ids.push(sid);
      writeSession(sid, (12 - i) * 1000);
      // Sleep 5ms to push mtime apart (works on Windows + Unix).
      const start = Date.now();
      while (Date.now() - start < 5) { /* spin */ }
    }

    const removed = pruneMetricsFiles(projectRoot);

    expect(removed).toHaveLength(2);
    const remaining = listSessionDirsWithMetrics(projectRoot).map((r) => r.sessionId);
    expect(remaining).toHaveLength(10);
    // The two OLDEST (by mtime) must be removed — i.e. prune-*00 and prune-*01
    // (written first in the loop).
    expect(remaining).not.toContain('2026-06-26-session-prune-00');
    expect(remaining).not.toContain('2026-06-26-session-prune-01');
  });

  test('returns [] when no metrics files exist', () => {
    expect(pruneMetricsFiles(projectRoot)).toEqual([]);
  });
});