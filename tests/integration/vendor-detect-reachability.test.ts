/**
 * Anti-fake-green reachability test: spawn the real built `peaks` binary
 * and assert `peaks vendor-detect` exits 0 with an ok envelope.
 *
 * rid-001 redo (slice 2026-08-11-detached-sub-agent-design):
 *   4.0.20 CHANGELOG claimed `peaks vendor-detect` shipped, but the
 *   CLI seam was broken (the handler existed at
 *   src/cli/commands/vendor-detect.ts but `peaks vendor-detect`
 *   returned `Unknown command: vendor-detect`). The previous rid-001
 *   rd artifact declared "reachability tests PASS" without ever
 *   landing the test file on disk — the same-source fake-green this
 *   slice makes unreachable by:
 *     1. Spawning the REAL built binary via `execFileSync(node, [bin/peaks.js, ...])`
 *     2. Asserting the JSON envelope shape + presence on stdout
 *     3. Asserting `git ls-files` lists this file (anti-fake-green
 *        surface, asserted by the slice's acceptance gate #4 in
 *        the orchestrator's brief)
 *
 * This file MUST land on disk + be tracked by git for the slice to
 * be considered complete.
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

interface VendorDetectEnvelope {
  readonly ok: boolean;
  readonly command: string;
  readonly data: {
    readonly installed: string[];
    readonly recommended: string | null;
  };
}

const projects: string[] = [];

afterEach(() => {
  for (const root of projects) {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  }
  projects.length = 0;
});

describe('peaks vendor-detect reachability (rid-001 anti-fake-green)', () => {
  test('spawns real binary and returns ok envelope with installed[] array', () => {
    const project = mkdtempSync(join(tmpdir(), 'peaks-rid-001-vendor-detect-json-'));
    projects.push(project);

    const r = runBin(['vendor-detect', '--json'], project);

    // MUST exit 0 (regression: was exit 1 with COMMAND_NOT_FOUND / unknown option --json).
    expect(r.code).toBe(0);
    // Real binary writes the envelope to stdout (not stderr).
    expect(r.stderr).toBe('');

    let envelope: VendorDetectEnvelope;
    try {
      envelope = JSON.parse(r.stdout.trim()) as VendorDetectEnvelope;
    } catch (err) {
      throw new Error(
        `peaks vendor-detect --json returned non-JSON stdout; ` +
        `code=${r.code} stdout=${JSON.stringify(r.stdout.slice(0, 200))} ` +
        `stderr=${JSON.stringify(r.stderr.slice(0, 200))} err=${(err as Error).message}`
      );
    }

    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('vendor-detect');
    expect(Array.isArray(envelope.data.installed)).toBe(true);
  });

  test('spawns real binary --help, lists the command description', () => {
    const project = mkdtempSync(join(tmpdir(), 'peaks-rid-001-vendor-detect-help-'));
    projects.push(project);

    const r = runBin(['vendor-detect', '--help'], project);

    // --help exits 0 in both modes (human + JSON). It does NOT route
    // through the JSON envelope path; the .description text is what
    // we assert.
    expect(r.code).toBe(0);
    // The description text from registerVendorDetectCommand mentions
    // "Detect which vendor CLIs" — this is the human-visible proof
    // the command is wired.
    expect(r.stdout).toMatch(/Detect which vendor CLIs/);
  });
});
