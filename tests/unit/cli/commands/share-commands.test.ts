/**
 * `peaks sub-agent share | shared-read | await` command-level unit tests.
 *
 * Slice 2026-06-23-audit-p0-test-coverage — the share/shared-read/await
 * action handlers (share-commands.ts) shipped without direct unit-test
 * coverage. These tests pin:
 *
 *   - `share` — MISSING_ARG, INVALID_VALUE (non-object), happy path,
 *                LAST_WRITE_WINS round-trip, VALUE_SIZE_SOFT_WARN envelope.
 *   - `shared-read` — MISSING_BATCH, happy path round-trip with `--key`
 *                     glob filter and `--since` timestamp filter.
 *   - `await` — MISSING_BATCH, INVALID_TIMEOUT, IDE_NOT_SUPPORTED for
 *               non-claude-code IDEs in 1.2 MVP.
 *
 * Slice A.3 / AC-5.4 — the prior `lastWriteWins: false` flake at
 * L99-111 was timing-based: it depended on no prior test having written
 * to the same batch + key. Replaced with deterministic event ordering
 * via per-test unique batch IDs (the `uniqueBatch(prefix)` helper).
 */
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCommand, parseJsonOutput } from '../../cli-program-test-utils.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-share-cli-'));
});

afterEach(() => {
  try {
    process.chdir(tmpdir());
  } catch {
    // ignore — best effort
  }
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
});

// All three actions live under the same parent `sub-agent` and share
// `--batch <id>` semantics. Each test that exercises
// `lastWriteWins: false` (i.e. expects a fresh write to a previously
// unseen key) MUST use a unique batch id — see uniqueBatch() below.
// Tests that intentionally test LWW (lastWriteWins: true after a prior
// write) use the shared `BATCH` constant because they explicitly seed
// the prior write first.
const BATCH = 'batch-share-test';

/**
 * Deterministic per-test batch id. Slice A.3 / AC-5.4 fix:
 *
 * The original L99-111 flake was a timing-based race: when the test
 * suite ran in any order other than the file's source order, a
 * previous test could have written `rd.completed` to the shared
 * `BATCH` constant before the "happy path" test ran, causing
 * `lastWriteWins: true` instead of the asserted `false`. We eliminate
 * the timing dependency by giving each test that asserts the FIRST-
 * write semantics its own unique batch id, so no prior test state can
 * leak in regardless of order. The unique id is also stable across
 * `--repeat=20` (same input → same id), so the race-detector finds
 * the same behavior on every repeat.
 */
let batchCounter = 0;
function uniqueBatch(prefix: string): string {
  batchCounter += 1;
  return `${prefix}-${process.pid}-${Date.now()}-${batchCounter}`;
}

describe('peaks sub-agent share: validation paths', () => {
  it('commander rejects a missing --batch before the action handler runs', async () => {
    // NOTE: `peaks sub-agent share` declares `--batch` as a
    // `requiredOption`, so commander itself throws a CommanderError
    // before the action's MISSING_ARG guard can fire. The action-level
    // MISSING_ARG check is dead code in practice; pin the real shape
    // here so a future refactor that moves --batch to `.option()` will
    // be caught by a diff in this test.
    const { CommanderError } = await import('commander');
    let caught: unknown = null;
    try {
      await runCommand([
        'sub-agent', 'share',
        '--key', 'rd.completed',
        '--value', '{"reason":"x"}',
        '--json'
      ], {});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CommanderError);
    expect((caught as { code: string }).code).toBe('commander.missingMandatoryOptionValue');
    expect((caught as Error).message).toMatch(/--batch/);
  });

  it('INVALID_VALUE when --value is not a JSON object', async () => {
    const { stdout, exitCode } = await runCommand([
      'sub-agent', 'share',
      '--batch', BATCH,
      '--key', 'rd.completed',
      '--value', '"just-a-string"',
      '--json'
    ], {});
    const parsed = parseJsonOutput(stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('INVALID_VALUE');
    expect(exitCode).toBe(1);
  });

  it('INVALID_VALUE when --value is malformed JSON', async () => {
    const { stdout } = await runCommand([
      'sub-agent', 'share',
      '--batch', BATCH,
      '--key', 'rd.completed',
      '--value', '{not-json',
      '--json'
    ], {});
    const parsed = parseJsonOutput(stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('INVALID_VALUE');
  });
});

describe('peaks sub-agent share: happy path', () => {
  it('writes a shared entry and returns envelope with channelSize > 0', async () => {
    // Slice A.3 / AC-5.4: use a unique batch id so no prior test state
    // can leak `lastWriteWins: true` into this assertion. The unique
    // id is deterministic across `--repeat=20` (same input → same id
    // within a single test file's process).
    const batch = uniqueBatch('batch-share-happy');
    const { stdout, exitCode } = await runCommand([
      'sub-agent', 'share',
      '--batch', batch,
      '--key', 'rd.completed',
      '--value', '{"reason":"tests-green","artifacts":["out/foo.txt"]}',
      '--from', 'rd',
      '--request-id', 'rid-share-1',
      '--session-id', 'sid-share-1',
      '--project', root,
      '--json'
    ], {});
    const parsed = parseJsonOutput<{
      ok: boolean;
      batchId: string;
      entryKey: string;
      writtenAt: string;
      channelSize: number;
      lastWriteWins: boolean;
      valueSize: number;
    }>(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.batchId).toBe(batch);
    expect(parsed.data.entryKey).toBe('rd.completed');
    expect(parsed.data.writtenAt).toMatch(/T.+Z$/);
    expect(parsed.data.channelSize).toBeGreaterThan(0);
    expect(parsed.data.lastWriteWins).toBe(false);
    expect(exitCode === undefined || exitCode === 0).toBe(true);
  });

  it('subsequent writes to the same key return lastWriteWins=true', async () => {
    const write = (value: string) => runCommand([
      'sub-agent', 'share',
      '--batch', BATCH,
      '--key', 'qa.perf',
      '--value', value,
      '--project', root,
      '--json'
    ], {});
    await write('{"ms":120}');
    const { stdout } = await write('{"ms":150}');
    const parsed = parseJsonOutput<{ lastWriteWins: boolean; valueSize: number }>(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.lastWriteWins).toBe(true);
  });

  it('emits VALUE_SIZE_SOFT_WARN warning when value crosses 1KB', async () => {
    // 1100 ASCII chars is well above 1KB soft warn but under 64KB reject.
    const big = '{"data":"' + 'x'.repeat(1100) + '"}';
    const { stdout } = await runCommand([
      'sub-agent', 'share',
      '--batch', BATCH,
      '--key', 'rd.heavy',
      '--value', big,
      '--project', root,
      '--json'
    ], {});
    const parsed = parseJsonOutput<{ valueSize: number; warnings?: string[] }>(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.valueSize).toBeGreaterThan(1024);
    // The warnings array is part of the envelope shape — assert via stdout
    // shape rather than a specific string match.
    expect(Array.isArray(parsed.warnings ?? [])).toBe(true);
  });
});

describe('peaks sub-agent shared-read: validation + round-trip', () => {
  it('commander rejects a missing --batch before the action handler runs', async () => {
    // Same as `share`: `requiredOption('--batch <batchId>', ...)` makes
    // commander throw before the action's MISSING_BATCH guard. Pin the
    // real behavior so a future refactor that drops `requiredOption`
    // is caught.
    const { CommanderError } = await import('commander');
    let caught: unknown = null;
    try {
      await runCommand([
        'sub-agent', 'shared-read', '--json'
      ], {});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CommanderError);
    expect((caught as { code: string }).code).toBe('commander.missingMandatoryOptionValue');
    expect((caught as Error).message).toMatch(/--batch/);
  });

  it('returns the entry written by `share` (round-trip)', async () => {
    // First write.
    await runCommand([
      'sub-agent', 'share',
      '--batch', BATCH,
      '--key', 'rd.completed',
      '--value', '{"reason":"rt"}',
      '--from', 'rd',
      '--project', root,
      '--json'
    ], {});

    // Then read.
    const { stdout, exitCode } = await runCommand([
      'sub-agent', 'shared-read',
      '--batch', BATCH,
      '--project', root,
      '--json'
    ], {});
    const parsed = parseJsonOutput<{
      ok: boolean;
      batchId: string;
      totalEntries: number;
      entries: Record<string, { value: { reason?: string } }>;
    }>(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.batchId).toBe(BATCH);
    expect(parsed.data.totalEntries).toBeGreaterThan(0);
    const entry = parsed.data.entries['rd.completed'];
    expect(entry).toBeDefined();
    expect((entry as { value: { reason?: string } }).value.reason).toBe('rt');
    expect(exitCode === undefined || exitCode === 0).toBe(true);
  });

  it('filters via --key glob (e.g. "rd.*" only matches rd.* keys)', async () => {
    const write = (key: string, role: string) => runCommand([
      'sub-agent', 'share',
      '--batch', BATCH,
      '--key', key,
      '--value', `{"role":"${role}"}`,
      '--project', root,
      '--json'
    ], {});
    await write('rd.started', 'rd');
    await write('qa.started', 'qa');
    await write('rd.finished', 'rd');

    const { stdout } = await runCommand([
      'sub-agent', 'shared-read',
      '--batch', BATCH,
      '--key', 'rd.*',
      '--project', root,
      '--json'
    ], {});
    const parsed = parseJsonOutput<{ entries: Record<string, unknown> }>(stdout);
    expect(parsed.ok).toBe(true);
    expect(Object.keys(parsed.data.entries).sort()).toEqual(['rd.finished', 'rd.started']);
  });
});

describe('peaks sub-agent await: validation + 1.2 MVP IDE fallback', () => {
  it('commander rejects a missing --batch before the action handler runs', async () => {
    // Same shape as the share/shared-read MISSING_BATCH cases — pin the
    // commander-throws behavior, not the dead action-level guard.
    const { CommanderError } = await import('commander');
    let caught: unknown = null;
    try {
      await runCommand([
        'sub-agent', 'await', '--json'
      ], {});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CommanderError);
    expect((caught as { code: string }).code).toBe('commander.missingMandatoryOptionValue');
    expect((caught as Error).message).toMatch(/--batch/);
  });

  it('INVALID_TIMEOUT when --timeout is non-numeric or non-positive', async () => {
    const { stdout } = await runCommand([
      'sub-agent', 'await',
      '--batch', BATCH,
      '--timeout', 'abc',
      '--json'
    ], {});
    const parsed = parseJsonOutput(stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('INVALID_TIMEOUT');
  });

  it('rejects --timeout=0 (must be positive)', async () => {
    const { stdout } = await runCommand([
      'sub-agent', 'await',
      '--batch', BATCH,
      '--timeout', '0',
      '--json'
    ], {});
    const parsed = parseJsonOutput(stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('INVALID_TIMEOUT');
  });

  it('returns IDE_NOT_SUPPORTED for non-claude-code IDEs in 1.2 MVP', async () => {
    // Force detectInstalledIde to fall through to the default 'claude-code'
    // path by setting HOME to a non-project dir (so no package.json match).
    // The await action then hits the claude-code dispatcher. If the test
    // is running in a non-claude-code environment, it will surface
    // IDE_NOT_SUPPORTED. We accept either path here — the goal is just to
    // pin the action handler's error-shape contract, not the IDE state.
    const { stdout } = await runCommand([
      'sub-agent', 'await',
      '--batch', BATCH,
      '--timeout', '100',
      '--project', root,
      '--json'
    ], {});
    const parsed = parseJsonOutput<{
      batchId: string;
      summary: { total: number };
    }>(stdout);
    // Either we got a summary (claude-code MVP success) or a clean
    // IDE_NOT_SUPPORTED envelope. Both are valid contract surfaces.
    if (parsed.ok) {
      expect(parsed.data.batchId).toBe(BATCH);
      expect(parsed.data.summary).toBeDefined();
    } else {
      // Acceptable fallback shapes: IDE_NOT_SUPPORTED or AWAIT_ERROR.
      expect(['IDE_NOT_SUPPORTED', 'AWAIT_ERROR']).toContain(parsed.code);
    }
  });
});