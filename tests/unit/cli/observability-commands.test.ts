/**
 * CLI command tests for `peaks observability {status,slices,fanout,repair-cycles}`.
 *
 * Slice B of v2.11.1. Drives `registerObservabilityCommands` via a
 * Commander `program` configured with an in-memory `ProgramIO`,
 * then runs the subcommands against a temp project root that has
 * pre-emitted JSONL metrics (synthetic — no hook needed for tests).
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { registerObservabilityCommands } from '../../../src/cli/commands/observability-commands.js';
import { metricsDirPath } from '../../../src/services/observability/jsonl-store.js';

let projectRoot: string;
let stdoutBuf: string[];
let stderrBuf: string[];
let exitCode: number | undefined;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-obs-cli-'));
  stdoutBuf = [];
  stderrBuf = [];
  exitCode = undefined;
  process.exitCode = undefined;
});

afterEach(() => {
  if (existsSync(projectRoot)) {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

function makeIo() {
  return {
    stdout: (text: string) => stdoutBuf.push(text),
    stderr: (text: string) => stderrBuf.push(text)
  };
}

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerObservabilityCommands(program, makeIo());
  return program;
}

async function run(args: string[]): Promise<void> {
  const program = makeProgram();
  // commander.parseAsync exits via the configured exitOverride handler;
  // we capture via try/catch around the parse.
  try {
    await program.parseAsync(['node', 'peaks', ...args]);
  } catch (err) {
    // exitOverride throws on `--help` / version / etc — ignore for tests
    // that don't care about exit semantics.
    if (!(err instanceof Error) || !/commander\./.test(err.message)) throw err;
  }
}

/** Emit a slice-transition event into the session's metrics JSONL. */
function emitSliceTransition(sessionId: string, sliceRid: string, opts: {
  ts?: string;
  from?: string;
  to: string;
  artifactRole?: string;
}): void {
  const dir = metricsDirPath(projectRoot, sessionId);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'slices.jsonl');
  const record = {
    schemaVersion: 1,
    ts: opts.ts ?? '2026-06-26T09:30:00.000Z',
    sessionId,
    category: 'slice-transition',
    sliceRid,
    detail: {
      ...(opts.from !== undefined ? { from: opts.from } : {}),
      to: opts.to,
      ...(opts.artifactRole !== undefined ? { artifactRole: opts.artifactRole } : {})
    }
  };
  writeFileSync(file, JSON.stringify(record) + '\n', { flag: 'a' });
}

function emitDispatch(sessionId: string, role: 'rd' | 'qa' | 'code-reviewer' | 'security-reviewer' | 'karpathy-reviewer', ts = '2026-06-26T09:30:00.000Z'): void {
  const dir = metricsDirPath(projectRoot, sessionId);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'slices.jsonl');
  writeFileSync(file, JSON.stringify({
    schemaVersion: 1, ts, sessionId, category: 'dispatch', role, detail: {}
  }) + '\n', { flag: 'a' });
}

function jsonStdout(): { data: unknown; warnings: string[]; ok: boolean } {
  // printResult writes a JSON block followed by warnings on separate lines.
  // Each `stdout` call appends a chunk (no trailing newline). Join them.
  const joined = stdoutBuf.join('');
  const parsed = JSON.parse(joined) as { ok?: boolean; data?: unknown; warnings?: string[] };
  return {
    ok: parsed.ok === true,
    data: parsed.data,
    warnings: parsed.warnings ?? []
  };
}

describe('peaks observability status (AC-1)', () => {
  test('returns zeros + empty-session warning when no metrics file', async () => {
    await run(['observability', 'status', '--project', projectRoot, '--json']);

    const out = jsonStdout();
    expect(out.ok).toBe(true);
    const data = out.data as { status: { totalEvents: number; totalSlices: number; successCount: number; failCount: number; repairCyclePeak: number; fanoutCostTotal: number } };
    expect(data.status.totalEvents).toBe(0);
    expect(data.status.totalSlices).toBe(0);
    expect(data.status.successCount).toBe(0);
    expect(data.status.failCount).toBe(0);
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  test('aggregates over emitted slice transitions', async () => {
    emitSliceTransition('s1', '001', { from: 'draft', to: 'spec-locked', artifactRole: 'rd' });
    emitSliceTransition('s1', '001', { from: 'spec-locked', to: 'handed-off', artifactRole: 'rd' });
    emitSliceTransition('s1', '002', { from: 'draft', to: 'blocked', artifactRole: 'rd' });

    await run(['observability', 'status', '--project', projectRoot, '--json']);

    const out = jsonStdout();
    const data = out.data as { status: { totalEvents: number; totalSlices: number; successCount: number; failCount: number; fanoutCostTotal: number } };
    expect(data.status.totalEvents).toBe(3);
    expect(data.status.totalSlices).toBe(2);
    expect(data.status.successCount).toBe(1);
    expect(data.status.failCount).toBe(1);
    expect(data.status.fanoutCostTotal).toBe(0);
  });
});

describe('peaks observability slices (AC-2)', () => {
  test('returns per-slice rollup list', async () => {
    emitSliceTransition('s1', '001', {
      ts: '2026-06-26T09:00:00.000Z',
      from: 'draft', to: 'spec-locked', artifactRole: 'rd'
    });
    emitSliceTransition('s1', '001', {
      ts: '2026-06-26T09:30:00.000Z',
      from: 'spec-locked', to: 'handed-off', artifactRole: 'rd'
    });

    await run(['observability', 'slices', '--project', projectRoot, '--json']);

    const out = jsonStdout();
    const data = out.data as { total: number; slices: Array<{ sliceRid: string; transitions: number; finalState: string | null; success: boolean; durationMs: number | null }> };
    expect(data.total).toBe(1);
    expect(data.slices[0]?.sliceRid).toBe('001');
    expect(data.slices[0]?.transitions).toBe(2);
    expect(data.slices[0]?.finalState).toBe('handed-off');
    expect(data.slices[0]?.success).toBe(true);
    expect(data.slices[0]?.durationMs).toBe(30 * 60 * 1000);
  });
});

describe('peaks observability fanout (AC-3)', () => {
  test('returns zeros + slice-C warning when no dispatch events', async () => {
    emitSliceTransition('s1', '001', { from: 'draft', to: 'spec-locked', artifactRole: 'rd' });

    await run(['observability', 'fanout', '--project', projectRoot, '--json']);

    const out = jsonStdout();
    const data = out.data as { fanout: { total: number; perRole: Record<string, number> } };
    expect(data.fanout.total).toBe(0);
    expect(out.warnings.some((w) => /slice c/i.test(w))).toBe(true);
  });

  test('breaks down dispatch events by role', async () => {
    emitDispatch('s1', 'rd');
    emitDispatch('s1', 'rd');
    emitDispatch('s1', 'qa');

    await run(['observability', 'fanout', '--project', projectRoot, '--json']);

    const out = jsonStdout();
    const data = out.data as { fanout: { total: number; perRole: Record<string, number> } };
    expect(data.fanout.total).toBe(3);
    expect(data.fanout.perRole.rd).toBe(2);
    expect(data.fanout.perRole.qa).toBe(1);
    expect(data.fanout.perRole['karpathy-reviewer']).toBe(0);
  });
});

describe('peaks observability repair-cycles (AC-4)', () => {
  test('returns capHit false when below the cap', async () => {
    emitSliceTransition('s1', '001', { from: 'qa-handoff', to: 'verdict-issued', artifactRole: 'qa' });

    await run(['observability', 'repair-cycles', '--project', projectRoot, '--json']);

    const out = jsonStdout();
    const data = out.data as { cycles: { totalCycles: number; cap: number; capHit: boolean; capHitCount: number; perSlice: Array<{ sliceRid: string; cycleCount: number }> } };
    expect(data.cycles.totalCycles).toBe(1);
    expect(data.cycles.cap).toBe(3);
    expect(data.cycles.capHit).toBe(false);
    expect(data.cycles.capHitCount).toBe(0);
    expect(data.cycles.perSlice).toEqual([{ sliceRid: '001', cycleCount: 1 }]);
  });

  test('returns capHit true when any slice hits the cap', async () => {
    for (let i = 0; i < 3; i++) {
      emitSliceTransition('s1', '001', { from: 'qa-handoff', to: 'verdict-issued', artifactRole: 'qa' });
    }

    await run(['observability', 'repair-cycles', '--project', projectRoot, '--json']);

    const out = jsonStdout();
    const data = out.data as { cycles: { totalCycles: number; capHit: boolean; capHitCount: number } };
    expect(data.cycles.totalCycles).toBe(3);
    expect(data.cycles.capHit).toBe(true);
    expect(data.cycles.capHitCount).toBe(1);
  });
});

describe('non-JSON stdout', () => {
  test('observability status without --json prints JSON data block + warning', async () => {
    await run(['observability', 'status', '--project', projectRoot]);
    // Should at least emit the JSON data block to stdout.
    const joined = stdoutBuf.join('');
    expect(joined).toContain('"status"');
  });
});