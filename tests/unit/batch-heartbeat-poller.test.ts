import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BatchHeartbeatPoller, DEFAULT_POLL_INTERVAL_MS, DEFAULT_STALE_THRESHOLD_MS, type PollerEvent } from '../../src/services/solo/batch-heartbeat-poller.js';
import { writeInitialDispatchRecord, appendHeartbeat, markCompleted } from '../../src/services/dispatch/dispatch-record-writer.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-poller-'));
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
});

describe('BatchHeartbeatPoller (G6.2 / AC-35)', () => {
  it('emits a status line on tick() with all 3 sub-agents', () => {
    const { path: p1 } = writeInitialDispatchRecord({
      projectRoot: root, sessionId: 's', requestId: 'r1', role: 'rd',
      prompt: 'p', toolCall: { name: 'Task', args: {} }, batchId: 'b',
      now: () => new Date('2026-06-07T00:00:00Z')
    });
    const { path: p2 } = writeInitialDispatchRecord({
      projectRoot: root, sessionId: 's', requestId: 'r2', role: 'qa',
      prompt: 'p', toolCall: { name: 'Task', args: {} }, batchId: 'b',
      now: () => new Date('2026-06-07T00:00:00Z')
    });
    const { path: p3 } = writeInitialDispatchRecord({
      projectRoot: root, sessionId: 's', requestId: 'r3', role: 'ui',
      prompt: 'p', toolCall: { name: 'Task', args: {} }, batchId: 'b',
      now: () => new Date('2026-06-07T00:00:00Z')
    });
    appendHeartbeat({ recordPath: p1, status: 'running', progress: 45, now: () => new Date('2026-06-07T00:00:10Z') });
    appendHeartbeat({ recordPath: p2, status: 'running', progress: 30, now: () => new Date('2026-06-07T00:00:15Z') });
    appendHeartbeat({ recordPath: p3, status: 'running', progress: 20, now: () => new Date('2026-06-07T00:00:20Z') });

    const events: PollerEvent[] = [];
    const poller = new BatchHeartbeatPoller(
      [{ path: p1, role: 'rd' }, { path: p2, role: 'qa' }, { path: p3, role: 'ui' }],
      { onStatus: (e) => events.push(e) },
      { prefix: '[peaks-code]', now: () => new Date('2026-06-07T00:00:30Z') }
    );
    poller.tick();
    const status = events.find((e) => e.kind === 'status') as Extract<PollerEvent, { kind: 'status' }> | undefined;
    expect(status).toBeDefined();
    expect(status?.line).toContain('[peaks-code] swarm 3/3 running');
    expect(status?.line).toContain('rd 45%');
    expect(status?.line).toContain('qa 30%');
    expect(status?.line).toContain('ui 20%');
  });

  it('marks a sub-agent as stale after the threshold (5 min)', () => {
    const { path } = writeInitialDispatchRecord({
      projectRoot: root, sessionId: 's', requestId: 'r', role: 'rd',
      prompt: 'p', toolCall: { name: 'Task', args: {} }, batchId: 'b',
      now: () => new Date('2026-06-07T00:00:00Z')
    });
    appendHeartbeat({ recordPath: path, status: 'running', progress: 10, now: () => new Date('2026-06-07T00:00:00Z') });

    const events: PollerEvent[] = [];
    const poller = new BatchHeartbeatPoller(
      [{ path, role: 'rd' }],
      { onStatus: (e) => events.push(e), onStale: (e) => events.push(e) },
      { prefix: '[p]', now: () => new Date('2026-06-07T00:06:00Z') }
    );
    poller.tick();
    const status = events.find((e) => e.kind === 'status') as Extract<PollerEvent, { kind: 'status' }> | undefined;
    expect(status?.line).toContain('⚠ stale');
    const stale = events.find((e) => e.kind === 'stale');
    expect(stale).toBeDefined();
    expect((stale as Extract<PollerEvent, { kind: 'stale' }>).lastBeatAgoSec).toBeGreaterThanOrEqual(300);
  });

  it('emits done when all sub-agents are terminal', () => {
    const { path: p1 } = writeInitialDispatchRecord({
      projectRoot: root, sessionId: 's', requestId: 'r1', role: 'rd',
      prompt: 'p', toolCall: { name: 'Task', args: {} }, batchId: 'b',
      now: () => new Date('2026-06-07T00:00:00Z')
    });
    const { path: p2 } = writeInitialDispatchRecord({
      projectRoot: root, sessionId: 's', requestId: 'r2', role: 'qa',
      prompt: 'p', toolCall: { name: 'Task', args: {} }, batchId: 'b',
      now: () => new Date('2026-06-07T00:00:00Z')
    });
    appendHeartbeat({ recordPath: p1, status: 'running', progress: 100 });
    markCompleted({ recordPath: p1, outcome: 'success', status: 'done' });
    appendHeartbeat({ recordPath: p2, status: 'running', progress: 100 });
    markCompleted({ recordPath: p2, outcome: 'success', status: 'done' });

    const events: PollerEvent[] = [];
    const poller = new BatchHeartbeatPoller(
      [{ path: p1, role: 'rd' }, { path: p2, role: 'qa' }],
      { onDone: (e) => events.push(e) },
      { prefix: '[p]' }
    );
    poller.tick();
    const done = events.find((e) => e.kind === 'done');
    expect(done).toBeDefined();
  });

  it('exposes the default poll interval + stale threshold for the contract', () => {
    expect(DEFAULT_POLL_INTERVAL_MS).toBe(10_000);
    expect(DEFAULT_STALE_THRESHOLD_MS).toBe(5 * 60 * 1000);
  });
});
