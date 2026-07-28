/**
 * rid-030 F-direction: `peaks dashboard summary --since <duration>` tests.
 *
 * 6 cases:
 *  1. empty session → all 5 metrics return 0 (no crash)
 *  2. emits cycle / token-usage / dispatch / post-compact / monotonic-trigger
 *     events; verifies each metric counter
 *  3. tokenCount sums input + output across multiple token-usage events
 *  4. --since 1h filters out older events (only recent counted)
 *  5. explicit --project + --session-id resolves the correct metrics file
 *  6. JSON envelope shape (ok=true, data.metrics.*) and human-readable JSON
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseJsonOutput, runCommand, writeUserConfig } from '../cli-program-test-utils.js';
import { aggregateDashboardMetricsFromEvents, type DashboardMetrics } from '../../../src/services/observability/aggregation.js';
import type { ObservabilityEvent } from '../../../src/services/observability/observability-service.js';

writeUserConfig();

const SESSION_ID = '2026-07-28-session-22381b';

function writeEvent(workdir: string, sid: string, event: ObservabilityEvent): void {
  const dir = join(workdir, '.peaks', '_runtime', sid, 'metrics');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'slices.jsonl'), JSON.stringify(event) + '\n', { flag: 'a' });
}

function makeEvent(category: ObservabilityEvent['category'], detail: Record<string, unknown>, ts: string): ObservabilityEvent {
  return {
    schemaVersion: 1,
    ts,
    sessionId: SESSION_ID,
    category,
    detail
  };
}

describe('rid-030: peaks dashboard summary (5 metric classes)', () => {
  let workdir = '';

  beforeEach(() => {
    workdir = join(tmpdir(), `peaks-loop-dash-summary-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(workdir, '.peaks', '_runtime', SESSION_ID, 'metrics'), { recursive: true });
    writeFileSync(join(workdir, '.peaks', '_runtime', 'session.json'), JSON.stringify({ sessionId: SESSION_ID, projectRoot: workdir }));
    process.chdir(workdir);
  });

  afterEach(() => {
    if (existsSync(workdir)) {
      try { rmSync(workdir, { recursive: true, force: true }); } catch { /* best effort on Windows */ }
    }
  });

  it('returns zero metrics for an empty session (no crash)', async () => {
    const { stdout } = await runCommand(['dashboard', 'summary', '--since', '24h', '--project', workdir, '--session-id', SESSION_ID, '--json']);
    const out = parseJsonOutput<{ metrics: DashboardMetrics }>(stdout);
    expect(out.ok).toBe(true);
    expect(out.data.metrics).toEqual({
      cycleCount: 0,
      tokenCount: 0,
      dispatchCount: 0,
      compactCount: 0,
      monotonicTriggerCount: 0
    });
  });

  it('counts each of the 5 metric classes from emitted events', async () => {
    const now = new Date().toISOString();
    writeEvent(workdir, SESSION_ID, makeEvent('cycle', { cycle: 1, status: 'started' }, now));
    writeEvent(workdir, SESSION_ID, makeEvent('cycle', { cycle: 1, status: 'completed' }, now));
    writeEvent(workdir, SESSION_ID, makeEvent('dispatch', { status: 'done' }, now));
    writeEvent(workdir, SESSION_ID, makeEvent('dispatch', { status: 'done' }, now));
    writeEvent(workdir, SESSION_ID, makeEvent('dispatch', { status: 'done' }, now));
    writeEvent(workdir, SESSION_ID, makeEvent('post-compact', { tokensBefore: 1000 }, now));
    writeEvent(workdir, SESSION_ID, makeEvent('monotonic-trigger', { report: 'warn', action: 'gate' }, now));

    const { stdout } = await runCommand(['dashboard', 'summary', '--since', '24h', '--project', workdir, '--session-id', SESSION_ID, '--json']);
    const out = parseJsonOutput<{ metrics: DashboardMetrics; sessionId: string; since: string }>(stdout);
    expect(out.ok).toBe(true);
    expect(out.data.sessionId).toBe(SESSION_ID);
    expect(out.data.since).toBe('24h');
    expect(out.data.metrics.cycleCount).toBe(2);
    expect(out.data.metrics.dispatchCount).toBe(3);
    expect(out.data.metrics.compactCount).toBe(1);
    expect(out.data.metrics.monotonicTriggerCount).toBe(1);
    expect(out.data.metrics.tokenCount).toBe(0);
  });

  it('sums tokenCount from inputTokens + outputTokens across token-usage events', async () => {
    const now = new Date().toISOString();
    writeEvent(workdir, SESSION_ID, makeEvent('token-usage', { inputTokens: 100, outputTokens: 50, totalTokens: 150 }, now));
    writeEvent(workdir, SESSION_ID, makeEvent('token-usage', { inputTokens: 200, outputTokens: 75, totalTokens: 275 }, now));
    writeEvent(workdir, SESSION_ID, makeEvent('token-usage', { inputTokens: 10, outputTokens: 5 }, now));

    const { stdout } = await runCommand(['dashboard', 'summary', '--since', '24h', '--project', workdir, '--session-id', SESSION_ID, '--json']);
    const out = parseJsonOutput<{ metrics: DashboardMetrics }>(stdout);
    expect(out.ok).toBe(true);
    expect(out.data.metrics.tokenCount).toBe(440);
  });

  it('filters out events older than --since 1h', async () => {
    const old = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    const recent = new Date().toISOString();
    writeEvent(workdir, SESSION_ID, makeEvent('cycle', { cycle: 1, status: 'started' }, old));
    writeEvent(workdir, SESSION_ID, makeEvent('cycle', { cycle: 2, status: 'started' }, recent));
    writeEvent(workdir, SESSION_ID, makeEvent('dispatch', { status: 'done' }, old));
    writeEvent(workdir, SESSION_ID, makeEvent('dispatch', { status: 'done' }, recent));

    const { stdout } = await runCommand(['dashboard', 'summary', '--since', '1h', '--project', workdir, '--session-id', SESSION_ID, '--json']);
    const out = parseJsonOutput<{ metrics: DashboardMetrics }>(stdout);
    expect(out.ok).toBe(true);
    expect(out.data.metrics.cycleCount).toBe(1);
    expect(out.data.metrics.dispatchCount).toBe(1);
  });

  it('resolves the correct metrics file when --project + --session-id are explicit', async () => {
    const alt = join(tmpdir(), `peaks-loop-dash-alt-${Date.now()}`);
    const altSid = '2026-07-28-session-alt0001';
    mkdirSync(join(alt, '.peaks', '_runtime', altSid, 'metrics'), { recursive: true });
    writeEvent(alt, altSid, makeEvent('cycle', { cycle: 7, status: 'completed' }, new Date().toISOString()));

    const { stdout } = await runCommand(['dashboard', 'summary', '--since', '24h', '--project', alt, '--session-id', altSid, '--json']);
    const out = parseJsonOutput<{ metrics: DashboardMetrics; sessionId: string }>(stdout);
    expect(out.ok).toBe(true);
    expect(out.data.sessionId).toBe(altSid);
    expect(out.data.metrics.cycleCount).toBe(1);

    rmSync(alt, { recursive: true, force: true });
  });

  it('emits human-readable JSON when --json is omitted', async () => {
    const now = new Date().toISOString();
    writeEvent(workdir, SESSION_ID, makeEvent('cycle', { cycle: 1, status: 'completed' }, now));

    const { stdout } = await runCommand(['dashboard', 'summary', '--since', '24h', '--project', workdir, '--session-id', SESSION_ID]);
    const joined = stdout.join('\n');
    expect(joined).toContain('"cycleCount"');
    expect(joined).toContain('"tokenCount"');
    expect(joined).toContain('"dispatchCount"');
    expect(joined).toContain('"compactCount"');
    expect(joined).toContain('"monotonicTriggerCount"');
  });

  it('aggregateDashboardMetricsFromEvents (pure helper) is consistent with the file-based helper', () => {
    const events: ObservabilityEvent[] = [
      makeEvent('cycle', { cycle: 1, status: 'started' }, '2026-07-28T00:00:00.000Z'),
      makeEvent('token-usage', { inputTokens: 50, outputTokens: 25, totalTokens: 75 }, '2026-07-28T00:01:00.000Z'),
      makeEvent('dispatch', { status: 'done' }, '2026-07-28T00:02:00.000Z'),
      makeEvent('post-compact', { tokensBefore: 100 }, '2026-07-28T00:03:00.000Z'),
      makeEvent('monotonic-trigger', { report: 'pass', action: 'gate' }, '2026-07-28T00:04:00.000Z')
    ];
    const result = aggregateDashboardMetricsFromEvents(events, new Date('2026-07-27T00:00:00.000Z'));
    expect(result).toEqual({
      cycleCount: 1,
      tokenCount: 75,
      dispatchCount: 1,
      compactCount: 1,
      monotonicTriggerCount: 1
    });
  });
});