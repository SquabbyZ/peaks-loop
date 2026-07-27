/**
 * rid-020b: `peaks code run --24h` flag plumbing.
 *
 * AC-B1 — confirms the integration surface accepts/rejects the
 * flag, and that the T3/T4 tier auto-engages 24H_ACTIVE while
 * non-T3/T4 routes through the brainstorming reference-only
 * bridge.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProgram } from '../../../src/cli/program.js';
import { runCommand } from '../cli-program-test-utils.js';

const { writeUserConfig } = await import('../cli-program-test-utils.js');
writeUserConfig();

describe('rid-020b: peaks code run --24h', () => {
  let harness: ReturnType<typeof createProgram> | null = null;
  let workdir = '';

  beforeEach(() => {
    workdir = join(tmpdir(), `peaks-loop-24h-run-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(workdir, '.peaks', '_runtime', '2026-07-28-session-22381b'), { recursive: true });
    writeFileSync(join(workdir, '.peaks', '_runtime', 'session.json'), JSON.stringify({ sessionId: '2026-07-28-session-22381b', projectRoot: workdir }));
    process.chdir(workdir);
  });

  afterEach(() => {
    harness = null;
    if (existsSync(workdir)) {
      try { rmSync(workdir, { recursive: true, force: true }); } catch { /* best effort on Windows */ }
    }
  });

  it('rejects when --24h is omitted', async () => {
    const { stdout, exitCode } = await runCommand(['code', 'run', 'rid-020b']);
    const out = stdout.join('\n');
    expect(out).toMatch(/CODE_RUN_24H_REQUIRED/);
    expect(exitCode).toBe(1);
  });

  it('emits a reference-only brainstorming bridge for non-T3/T4', async () => {
    const { stdout, exitCode } = await runCommand(['code', 'run', 'rid-020b', '--24h', '--tier', 'T2']);
    const out = stdout.join('\n');
    expect(out).toMatch(/"mode"\s*:\s*"24H_REQUESTED"/);
    expect(out).toMatch(/brainstorming/);
    expect(exitCode).not.toBe(1);
  });

  it('auto-engages 24H_ACTIVE for T3 tier', async () => {
    const { stdout, exitCode } = await runCommand(['code', 'run', 'rid-020b', '--24h', '--tier', 'T3']);
    const out = stdout.join('\n');
    expect(out).toMatch(/"mode"\s*:\s*"24H_ACTIVE"/);
    expect(out).toMatch(/"autoEngaged"\s*:\s*true/);
    expect(out).toMatch(/"state"\s*:\s*"24H_ACTIVE"/);
    expect(exitCode).not.toBe(1);
  });

  it('auto-engages 24H_ACTIVE for T4 trigger', async () => {
    const { stdout } = await runCommand(['code', 'run', 'rid-020b', '--24h', '--trigger', 'T4']);
    const out = stdout.join('\n');
    expect(out).toMatch(/"mode"\s*:\s*"24H_ACTIVE"/);
    expect(out).toMatch(/"trigger"\s*:\s*"T4"/);
  });

  it('writes a 24h-state.json when auto-engaging', async () => {
    await runCommand(['code', 'run', 'rid-020b', '--24h', '--tier', 'T3', '--project', workdir, '--session-id', '2026-07-28-session-22381b']);
    const path = join(workdir, '.peaks', '_runtime', '2026-07-28-session-22381b', '24h-state.json');
    expect(existsSync(path)).toBe(true);
  });

  it('skips the brainstorming gate for T3 (no BRAINSTORM step)', async () => {
    const { stdout } = await runCommand(['code', 'run', 'rid-020b', '--24h', '--tier', 'T3', '--json']);
    const out = stdout.join('\n');
    expect(out).toMatch(/"state"\s*:\s*"24H_ACTIVE"/);
    expect(out).not.toMatch(/BRAINSTORM/);
  });
});
