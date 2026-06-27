/**
 * v2.13.2 AC-2 — `peaks verdict aggregate` CLI tests (≥4 cases).
 *
 * Pins the 4 PRD cases:
 *   - all 5 envelopes present
 *   - 1 envelope missing → still runs
 *   - all envelopes missing → returns pass
 *   - JSON envelope shape contains { verdict, reasons, sources }
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { registerVerdictAggregateCommands } from '../../../../src/cli/commands/verdict-aggregate-command.js';
import type { ProgramIO } from '../../../../src/cli/cli-helpers.js';

function makeIo(): { io: ProgramIO; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: { stdout: (t) => out.push(t), stderr: (t) => err.push(t) }
  };
}

function makeProject(sid: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'verdict-agg-'));
  const runtime = join(dir, '.peaks', '_runtime', sid);
  mkdirSync(join(runtime, 'audit'), { recursive: true });
  mkdirSync(join(runtime, 'mut'), { recursive: true });
  mkdirSync(join(runtime, 'qa', 'test-reports'), { recursive: true });
  mkdirSync(join(runtime, 'rd'), { recursive: true });
  return dir;
}

function writeSecurity(path: string, verdict: 'pass' | 'warn' | 'block', violations: Array<{ severity: string; file: string; line: number; hint: string }> = []): void {
  const lines = [
    '## Findings',
    '',
    ...violations.map((v) => `- [${v.severity}] auth @ ${v.file}:${v.line} — ${v.hint}`),
    '',
    '## Verdict',
    '',
    `verdict: ${verdict}`
  ];
  writeFileSync(path, lines.join('\n'));
}

function writeKarpathy(path: string): void {
  writeFileSync(path, 'gateAction: pass\npassed: true\n');
}

function writeMut(path: string, passed: boolean, killRate: number): void {
  writeFileSync(path, JSON.stringify({ passed, killRate, weakRate: 0.01, violations: [] }));
}

function writeQa(path: string, verdict: string): void {
  writeFileSync(path, `verdict: ${verdict}\n`);
}

describe('v2.13.2 verdict aggregate CLI (AC-2)', () => {
  let project: string;
  let sid: string;

  beforeEach(() => {
    sid = '2026-06-27-session-test';
    project = makeProject(sid);
  });

  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  test('A: all 5 inputs present + 2-audit dedup → verdict=warn, reasons deduped to 1 with both sources', async () => {
    writeSecurity(join(project, '.peaks', '_runtime', sid, 'audit/security.md'), 'warn', [{ severity: 'HIGH', file: 'src/x.ts', line: 1, hint: 'shared' }]);
    writeSecurity(join(project, '.peaks', '_runtime', sid, 'audit/perf.md'), 'warn', [{ severity: 'HIGH', file: 'src/x.ts', line: 1, hint: 'shared' }]);
    writeKarpathy(join(project, '.peaks', '_runtime', sid, 'rd/karpathy-review.md'));
    writeMut(join(project, '.peaks', '_runtime', sid, 'mut/mut-report.json'), true, 0.91);
    writeQa(join(project, '.peaks', '_runtime', sid, 'qa/test-reports/rid-1.md'), 'pass');

    const { io, out } = makeIo();
    const program = new Command();
    registerVerdictAggregateCommands(program, io);
    await program.parseAsync([
      'node', 'peaks', 'verdict', 'aggregate',
      '--from-rid', 'rid-1',
      '--sid', sid,
      '--project', project,
      '--json'
    ]);
    if (out.length === 0) {
      throw new Error('no stdout produced');
    }
    const last = JSON.parse(out[out.length - 1]!);
    expect(last.ok).toBe(true);
    expect(last.data.verdict).toBe('warn');
    expect(last.data.reasons).toHaveLength(1);
    expect(last.data.reasons[0].sources).toEqual(['security-audit', 'perf-audit']);
    expect(last.data.sources).toEqual({
      security: 'present',
      perf: 'present',
      karpathy: 'present',
      mut: 'present',
      qa: 'present'
    });
  });

  test('B: 1 envelope missing → still runs, source flag = missing', async () => {
    writeSecurity(join(project, '.peaks', '_runtime', sid, 'audit/security.md'), 'block', [{ severity: 'CRITICAL', file: 'a.ts', line: 1, hint: 'h' }]);
    // omit perf
    writeKarpathy(join(project, '.peaks', '_runtime', sid, 'rd/karpathy-review.md'));
    writeMut(join(project, '.peaks', '_runtime', sid, 'mut/mut-report.json'), true, 0.91);
    writeQa(join(project, '.peaks', '_runtime', sid, 'qa/test-reports/rid-2.md'), 'pass');

    const { io, out } = makeIo();
    const program = new Command();
    registerVerdictAggregateCommands(program, io);
    await program.parseAsync([
      'node', 'peaks', 'verdict', 'aggregate',
      '--from-rid', 'rid-2',
      '--sid', sid,
      '--project', project,
      '--json'
    ]);
    const last = JSON.parse(out[out.length - 1]!);
    expect(last.ok).toBe(true);
    expect(last.data.sources.perf).toBe('missing');
    expect(last.data.verdict).toBe('block');
  });

  test('C: all envelopes missing → returns pass with all sources missing', async () => {
    const { io, out } = makeIo();
    const program = new Command();
    registerVerdictAggregateCommands(program, io);
    await program.parseAsync([
      'node', 'peaks', 'verdict', 'aggregate',
      '--from-rid', 'rid-3',
      '--sid', sid,
      '--project', project,
      '--json'
    ]);
    const last = JSON.parse(out[out.length - 1]!);
    expect(last.ok).toBe(true);
    expect(last.data.verdict).toBe('pass');
    expect(last.data.reasons).toEqual([]);
    expect(last.data.sources).toEqual({
      security: 'missing',
      perf: 'missing',
      karpathy: 'missing',
      mut: 'missing',
      qa: 'missing'
    });
  });

  test('D: JSON envelope shape matches the spec { verdict, reasons, sources }', async () => {
    writeSecurity(join(project, '.peaks', '_runtime', sid, 'audit/security.md'), 'warn', [{ severity: 'HIGH', file: 'a.ts', line: 1, hint: 'h' }]);
    writeSecurity(join(project, '.peaks', '_runtime', sid, 'audit/perf.md'), 'pass');
    writeKarpathy(join(project, '.peaks', '_runtime', sid, 'rd/karpathy-review.md'));
    writeMut(join(project, '.peaks', '_runtime', sid, 'mut/mut-report.json'), true, 0.95);
    writeQa(join(project, '.peaks', '_runtime', sid, 'qa/test-reports/rid-4.md'), 'pass');

    const { io, out } = makeIo();
    const program = new Command();
    registerVerdictAggregateCommands(program, io);
    await program.parseAsync([
      'node', 'peaks', 'verdict', 'aggregate',
      '--from-rid', 'rid-4',
      '--sid', sid,
      '--project', project,
      '--json'
    ]);
    const last = JSON.parse(out[out.length - 1]!);
    expect(last.ok).toBe(true);
    expect(typeof last.data.verdict).toBe('string');
    expect(Array.isArray(last.data.reasons)).toBe(true);
    expect(typeof last.data.sources).toBe('object');
    expect(Object.keys(last.data.sources).sort()).toEqual(['karpathy', 'mut', 'perf', 'qa', 'security']);
  });
});