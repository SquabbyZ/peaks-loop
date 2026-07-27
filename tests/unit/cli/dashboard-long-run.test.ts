/**
 * rid-020b: `peaks dashboard long-run --since <duration>` indicator view.
 *
 * AC-B2 — parses the duration flag, emits the 5 indicator classes
 * (dispatch / autoCompact / monotonicTrigger / subAgentFailure /
 * checkpointFrequency) plus boundary cases (since=0 / since>24h /
 * empty state).
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseJsonOutput, runCommand, writeUserConfig } from '../cli-program-test-utils.js';

writeUserConfig();

describe('rid-020b: peaks dashboard long-run', () => {
  let workdir = '';

  beforeEach(() => {
    workdir = join(tmpdir(), `peaks-loop-24h-dash-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(workdir, '.peaks', '_runtime', '2026-07-28-session-22381b', 'metrics'), { recursive: true });
    writeFileSync(join(workdir, '.peaks', '_runtime', 'session.json'), JSON.stringify({ sessionId: '2026-07-28-session-22381b', projectRoot: workdir }));
    writeFileSync(join(workdir, '.peaks', '_runtime', '2026-07-28-session-22381b', '24h-state.json'), JSON.stringify({
      state: '24H_ACTIVE',
      enteredAt: new Date().toISOString(),
      enteredFrom: 'BRAINSTORM',
      activeSlices: ['rid-020a', 'rid-020b'],
      monotonicGuards: 4,
      autoCompactCount: 3,
      checkpoints: 2,
      lastCheckpointAt: new Date(Date.now() - 60_000).toISOString(),
      attempts: { prd_direction_change: 0, blocker_3_consecutive_slices: 1, registry_affecting_failure: 0, destructive_irreversible_op: 0, any_B1_B2_failure_3x_non_converging: 0, runtime_or_shared_version_mismatch: 0, 'sub-agent_stale_5min_x3': 0 },
      exitCondition: null
    }));
    process.chdir(workdir);
  });

  afterEach(() => {
    if (existsSync(workdir)) {
      try { rmSync(workdir, { recursive: true, force: true }); } catch { /* best effort on Windows */ }
    }
  });

  it('parses --since 24h and emits 5 indicator classes', async () => {
    const { stdout } = await runCommand(['dashboard', 'long-run', '--since', '24h', '--project', workdir, '--session-id', '2026-07-28-session-22381b', '--json']);
    const out = parseJsonOutput<{
      indicators: { dispatchCount: number; autoCompactCount: number; monotonicTriggerCount: number; subAgentFailureCount: number; checkpointFrequency: number | null };
    }>(stdout);
    expect(out.ok).toBe(true);
    expect(out.data.indicators).toEqual(
      expect.objectContaining({
        autoCompactCount: 3,
        monotonicTriggerCount: 4,
        subAgentFailureCount: 1
      })
    );
    expect(Object.keys(out.data.indicators).sort()).toEqual(
      ['autoCompactCount', 'checkpointFrequency', 'dispatchCount', 'monotonicTriggerCount', 'subAgentFailureCount']
    );
  });

  it('caps --since 72h at the 24h window', async () => {
    const { stdout } = await runCommand(['dashboard', 'long-run', '--since', '72h', '--project', workdir, '--session-id', '2026-07-28-session-22381b', '--json']);
    const out = parseJsonOutput<{ sinceMs: number; sinceCapped: boolean; boundary: string }>(stdout);
    expect(out.data.sinceMs).toBe(24 * 60 * 60 * 1000);
    expect(out.data.sinceCapped).toBe(true);
    expect(out.data.boundary).toBe('cap');
  });

  it('reports the empty boundary for since=0h', async () => {
    const { stdout } = await runCommand(['dashboard', 'long-run', '--since', '0h', '--project', workdir, '--session-id', '2026-07-28-session-22381b', '--json']);
    const out = parseJsonOutput<{ boundary: string; sinceMs: number }>(stdout);
    expect(out.data.boundary).toBe('empty');
    expect(out.data.sinceMs).toBe(0);
  });

  it('parses 8h and 30m windows', async () => {
    const eight = await runCommand(['dashboard', 'long-run', '--since', '8h', '--project', workdir, '--session-id', '2026-07-28-session-22381b', '--json']);
    const halfHour = await runCommand(['dashboard', 'long-run', '--since', '30m', '--project', workdir, '--session-id', '2026-07-28-session-22381b', '--json']);
    const eightMs = (parseJsonOutput<{ sinceMs: number }>(eight.stdout).data.sinceMs);
    const halfMs = (parseJsonOutput<{ sinceMs: number }>(halfHour.stdout).data.sinceMs);
    expect(eightMs).toBe(8 * 60 * 60 * 1000);
    expect(halfMs).toBe(30 * 60 * 1000);
  });

  it('rejects unparseable since values', async () => {
    const { stdout, exitCode } = await runCommand(['dashboard', 'long-run', '--since', 'three', '--project', workdir, '--session-id', '2026-07-28-session-22381b', '--json']);
    expect(stdout.join('\n')).toMatch(/INVALID_SINCE/);
    expect(exitCode).toBe(1);
  });

  it('surfaces 24H_ACTIVE snapshot state from the on-disk file', async () => {
    const { stdout } = await runCommand(['dashboard', 'long-run', '--since', '24h', '--project', workdir, '--session-id', '2026-07-28-session-22381b', '--json']);
    const out = parseJsonOutput<{ snapshot: { state: string } }>(stdout);
    expect(out.data.snapshot.state).toBe('24H_ACTIVE');
  });
});
