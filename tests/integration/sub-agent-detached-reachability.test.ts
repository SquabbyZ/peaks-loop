/**
 * Anti-fake-green reachability test: spawn the real built `peaks` binary
 * for `peaks sub-agent dispatch` and assert the 4 rid-001 detached
 * options + the in-process backward-compat path.
 *
 * rid-001 redo (slice 2026-08-11-detached-sub-agent-design):
 *   The original rid-001 rd artifact declared "5/5 reachability tests
 *   PASS" but the test files were never written to disk — fake-green at
 *   the artifact-writing level. This file lands the test on disk + makes
 *   the fake-green surface unreachable by:
 *     1. Spawning the REAL built binary via `execFileSync(node, [bin/peaks.js, ...])`
 *     2. Asserting --help output lists all 4 new options (--mode, --vendor,
 *        --no-throttle, --max-concurrent)
 *     3. Asserting the in-process backward-compat path (no --mode and
 *        explicit --mode in-process) BOTH produce the `sub-agent.dispatch`
 *        envelope shape — proves the branch-in-action pattern did not break
 *        106+ existing dispatch call sites
 *
 * This file MUST land on disk + be tracked by git for the slice to be
 * considered complete.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const BIN = resolve(__dirname, '../../bin/peaks.js');
const BIN_TIMEOUT_MS = 30_000;

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

function runBin(args: readonly string[], cwd: string): RunResult {
  try {
    const stdout = execFileSync('node', [BIN, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: BIN_TIMEOUT_MS,
    }).toString('utf8');
    return { stdout, stderr: '', code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    return {
      stdout: typeof e.stdout === 'string' ? e.stdout : e.stdout?.toString('utf8') ?? '',
      stderr: typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString('utf8') ?? '',
      code: e.status ?? 1,
    };
  }
}

interface DispatchEnvelope {
  readonly ok: boolean;
  readonly command: string;
}

const projects: string[] = [];

afterEach(() => {
  for (const root of projects) {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  }
  projects.length = 0;
});

describe('peaks sub-agent dispatch --mode detached reachability (rid-001 anti-fake-green)', () => {
  test('dispatch --help lists --mode, --vendor, --no-throttle, --max-concurrent', () => {
    const project = mkdtempSync(join(tmpdir(), 'peaks-rid-001-dispatch-help-'));
    projects.push(project);

    const r = runBin(['sub-agent', 'dispatch', '--help'], project);

    expect(r.code).toBe(0);
    // All four options MUST be present in the help output (anti-fake-green
    // gate; the original CLI did not register them).
    expect(r.stdout).toMatch(/--mode/);
    expect(r.stdout).toMatch(/--vendor/);
    expect(r.stdout).toMatch(/--no-throttle/);
    expect(r.stdout).toMatch(/--max-concurrent/);
  });

  test('dispatch rd (no --mode) keeps in-process envelope (backward compat)', () => {
    const project = mkdtempSync(join(tmpdir(), 'peaks-rid-001-dispatch-inproc-default-'));
    projects.push(project);

    const r = runBin(
      [
        'sub-agent', 'dispatch', 'rd',
        '--prompt', 'rid-001 reachability probe — in-process default path',
        '--graph-node', 'rid-001-reach-default',
        '--json',
      ],
      project
    );

    // exit 0 expected (in-process success); the in-process envelope shape
    // is unchanged from 4.0.20 — proves the branch-in-action pattern did
    // not break backward compat.
    expect(r.code).toBe(0);

    let envelope: DispatchEnvelope;
    try {
      envelope = JSON.parse(r.stdout.trim()) as DispatchEnvelope;
    } catch (err) {
      throw new Error(
        `dispatch rd --graph-node n1 --json (no --mode) returned non-JSON stdout; ` +
        `code=${r.code} stdout=${JSON.stringify(r.stdout.slice(0, 200))} ` +
        `stderr=${JSON.stringify(r.stderr.slice(0, 200))} err=${(err as Error).message}`
      );
    }

    // This MUST be the in-process envelope shape (command === 'sub-agent.dispatch'),
    // NOT the detached envelope shape. The branch-in-action pattern routes
    // --mode detached to a separate code path; the default must stay here.
    expect(envelope.command).toBe('sub-agent.dispatch');
    expect(envelope.command).not.toBe('sub-agent.dispatch.detached');
  });

  test('dispatch rd --mode in-process also returns in-process envelope (NOT detached)', () => {
    const project = mkdtempSync(join(tmpdir(), 'peaks-rid-001-dispatch-inproc-explicit-'));
    projects.push(project);

    const r = runBin(
      [
        'sub-agent', 'dispatch', 'rd',
        '--prompt', 'rid-001 reachability probe — explicit in-process',
        '--graph-node', 'rid-001-reach-explicit',
        '--mode', 'in-process',
        '--json',
      ],
      project
    );

    expect(r.code).toBe(0);

    let envelope: DispatchEnvelope;
    try {
      envelope = JSON.parse(r.stdout.trim()) as DispatchEnvelope;
    } catch (err) {
      throw new Error(
        `dispatch rd --mode in-process --json returned non-JSON stdout; ` +
        `code=${r.code} stdout=${JSON.stringify(r.stdout.slice(0, 200))} ` +
        `stderr=${JSON.stringify(r.stderr.slice(0, 200))} err=${(err as Error).message}`
      );
    }

    // Explicit --mode in-process must STILL route to the in-process
    // envelope (not detached). Only `--mode detached` is special;
    // every other value of --mode (including missing) keeps the
    // warm-path in-process dispatch.
    expect(envelope.command).toBe('sub-agent.dispatch');
    expect(envelope.command).not.toBe('sub-agent.dispatch.detached');
  });
});
