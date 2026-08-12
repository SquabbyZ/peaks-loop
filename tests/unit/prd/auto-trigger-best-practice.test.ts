/**
 * Slice 2026-08-12 best-practice-scan — Slice F auto-trigger test.
 *
 * Validates AC-1 promotion (PARTIAL → PASS):
 *   - Case 1: handoff body has businessGoal → spawn called with correct args
 *   - Case 2: spawn 'error' event → result status='failed', never throws
 *   - Case 3: businessGoal empty → result status='skipped-empty-goal', no spawn
 *
 * Mocking strategy:
 *   - `node:child_process` (spawn) — captures the BPS invocation args
 *   - `node:fs.existsSync` — controls the "peaks binary present?" gate
 *   - The PRD artifact is laid down on disk in a temp dir so
 *     `showRequestArtifact` reads the real body (no service mock needed)
 */

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync as realExistsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('node:child_process', () => ({
  spawn: vi.fn()
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn()
  };
});

const { spawn } = await import('node:child_process');
const spawnMock = vi.mocked(spawn);
const { existsSync } = await import('node:fs');
const existsSyncMock = vi.mocked(existsSync);

const { extractBusinessGoal, triggerBestPracticeScan } = await import(
  '../../../src/services/prd/best-practice-auto-trigger.js'
);

type FakeChild = EventEmitter & {
  pid?: number;
  unref?: () => void;
};

function makeFakeChild(opts: { pid?: number; fire?: 'spawn' | 'error'; errorMessage?: string } = {}): FakeChild {
  const ee = new EventEmitter() as FakeChild;
  ee.pid = opts.pid ?? 12345;
  ee.unref = () => {
    /* no-op for tests */
  };
  // Attach a fallback 'error' listener so that if the implementation never
  // adds its own, the EventEmitter doesn't crash the test process (Node
  // treats unhandled 'error' events as fatal).
  ee.on('error', () => {
    /* swallowed — implementation listens too, this is the safety net */
  });
  // Override .once() so that when the implementation attaches a listener,
  // we fire the event synchronously on the next microtask. This avoids any
  // race between setImmediate and the test's await resolution.
  const origOnce = ee.once.bind(ee);
  ee.once = (event: string, cb: (...args: unknown[]) => void) => {
    if (event === 'spawn' || event === 'error') {
      queueMicrotask(() => {
        if (opts.fire === 'error') {
          ee.emit('error', new Error(opts.errorMessage ?? 'spawn failed'));
        } else {
          ee.emit('spawn');
        }
      });
    }
    return origOnce(event as never, cb as never);
  };
  return ee;
}

const SESSION_ID = '2026-08-12-session-4aaf2b';
const REQUEST_ID = 'rid-best-practice-scan-auto-trigger';

let projectRoot: string;
let peaksBinPath: string;

function makePrdBody(goalsSection: string, rawInput = 'fallback raw input'): string {
  return `# PRD Request ${REQUEST_ID}

- session: ${SESSION_ID}
- type: feature
- source: verbal
- raw input (sanitized): ${rawInput}

## Goals

${goalsSection}

## Non-goals

- nothing

## Acceptance criteria

- AC-1 trigger fires automatically at peaks-prd exit

## Status

- state: confirmed-by-user
- last update: 2026-08-12T00:00:00Z
`;
}

function writePrdArtifact(goalsSection: string, rawInput?: string): void {
  const dir = join(projectRoot, '.peaks', '_runtime', SESSION_ID, 'prd', 'requests');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${REQUEST_ID}.md`), makePrdBody(goalsSection, rawInput), 'utf8');
}

describe('extractBusinessGoal (pure)', () => {
  it('returns the first non-empty bullet from ## Goals', () => {
    const body = makePrdBody('- Add auto-trigger to peaks-prd handoff\n- Second goal');
    expect(extractBusinessGoal(body)).toBe('Add auto-trigger to peaks-prd handoff');
  });

  it('skips placeholder "..." markers', () => {
    const body = makePrdBody('- ...\n- Real goal');
    expect(extractBusinessGoal(body)).toBe('Real goal');
  });

  it('falls back to raw input (sanitized) when ## Goals is empty', () => {
    const body = makePrdBody('- ...');
    // The "raw input (sanitized)" line is "fallback raw input", so that wins.
    expect(extractBusinessGoal(body)).toBe('fallback raw input');
  });

  it('returns null when both Goals and raw input are absent or empty', () => {
    const body = `# PRD\n\n## Status\n- state: draft\n`;
    expect(extractBusinessGoal(body)).toBeNull();
  });
});

describe('triggerBestPracticeScan (auto-trigger post-step)', () => {
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'bps-auto-trigger-'));
    peaksBinPath = join(projectRoot, 'bin', 'peaks.js');
    spawnMock.mockReset();
    existsSyncMock.mockReset();
    // Default: peaks binary exists at the canonical path
    existsSyncMock.mockImplementation((p) => String(p) === peaksBinPath);
  });

  afterEach(() => {
    spawnMock.mockReset();
    existsSyncMock.mockReset();
    if (realExistsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('Case 1: handoff body has businessGoal → spawn invoked with correct args (intent + project + json flag)', async () => {
    // given: a real PRD body whose ## Goals first bullet is a non-empty goal
    writePrdArtifact('- Wire peaks best-practice-scan after businessGoal completes');
    spawnMock.mockReturnValue(makeFakeChild({ pid: 99999, fire: 'spawn' }) as unknown as ReturnType<typeof spawn>);

    // when: the auto-trigger fires for this session+request
    const result = await triggerBestPracticeScan({
      projectRoot,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID
    });

    // then: result is 'triggered' and spawn was called once with the canonical args
    expect(result.status).toBe('triggered');
    expect(result.businessGoal).toBe('Wire peaks best-practice-scan after businessGoal completes');
    expect(result.pid).toBe(99999);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const callArgs = spawnMock.mock.calls[0] as [string, string[], Record<string, unknown>];
    expect(callArgs[0]).toBe(process.execPath);
    expect(callArgs[1]).toEqual([
      peaksBinPath,
      'best-practice-scan',
      '--project',
      projectRoot,
      '--intent',
      'Wire peaks best-practice-scan after businessGoal completes',
      '--json'
    ]);
    expect(callArgs[2]).toMatchObject({ cwd: projectRoot, stdio: 'ignore', detached: true });
    expect((callArgs[2] as { env: Record<string, string> }).env.PEAKS_BEST_PRACTICE_STDIN).toBe('');
  });

  it('Case 2: spawn "error" event → result is "failed" (transition is NOT blocked)', async () => {
    // given: a valid PRD body but spawn fails (e.g., exec permission denied)
    writePrdArtifact('- Real goal that should still trigger but spawn fails');
    spawnMock.mockReturnValue(
      makeFakeChild({ fire: 'error', errorMessage: 'EACCES permission denied' }) as unknown as ReturnType<typeof spawn>
    );

    // when: the auto-trigger fires
    const result = await triggerBestPracticeScan({
      projectRoot,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID
    });

    // then: result is 'failed' with the reason — no throw, no exit code 1
    expect(result.status).toBe('failed');
    expect(result.businessGoal).toBe('Real goal that should still trigger but spawn fails');
    expect(result.reason).toBe('EACCES permission denied');
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('Case 3: businessGoal empty (only "..." placeholders, no raw input fallback) → NO spawn invoked', async () => {
    // given: a PRD body with ONLY placeholder bullets AND no raw input fallback
    writePrdArtifact('- ...\n- ...\n- ...', '...');
    // Note: spawnMock is NOT pre-loaded with a return value — if it IS called,
    // the test will fail because spawnMock returns undefined.

    // when: the auto-trigger fires
    const result = await triggerBestPracticeScan({
      projectRoot,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID
    });

    // then: result is 'skipped-empty-goal' and spawn is NEVER called
    expect(result.status).toBe('skipped-empty-goal');
    expect(result.businessGoal).toBeUndefined();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('Case 3b: PRD artifact missing entirely → "skipped-artifact-missing", no spawn', async () => {
    // given: no PRD artifact on disk

    // when
    const result = await triggerBestPracticeScan({
      projectRoot,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID
    });

    // then
    expect(result.status).toBe('skipped-artifact-missing');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('Case 4: peaks binary missing → "skipped-artifact-missing" with reason, no spawn', async () => {
    // given: a valid PRD body but the peaks binary does not exist
    writePrdArtifact('- Some goal');
    existsSyncMock.mockReturnValue(false); // nothing exists

    // when
    const result = await triggerBestPracticeScan({
      projectRoot,
      sessionId: SESSION_ID,
      requestId: REQUEST_ID
    });

    // then
    expect(result.status).toBe('skipped-artifact-missing');
    expect(typeof result.reason).toBe('string');
    expect(result.reason).toContain('peaks binary not found');
    expect(spawnMock).not.toHaveBeenCalled();
  });
});