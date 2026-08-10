import { describe, it, expect } from 'vitest';
import { StatusProtocol } from '../../../packages/peaks-loop-internal-runtime/src/status-protocol';

describe('StatusProtocol', () => {
  it('merges heartbeat into record and updates status', () => {
    const sp = new StatusProtocol();
    const rec: any = { mode: 'detached', vendor: 'claude', heartbeats: [], status: 'running' };
    const merged = sp.merge(rec, { rid: 'r1', vendor: 'claude', progress: 50, state: 'running', note: 'a', ts: 1 });
    expect(merged.heartbeats).toHaveLength(1);
    expect(merged.heartbeats[0]).toMatchObject({ progress: 50, note: 'a' });
  });

  it('marks stale after 5 minutes without beat', () => {
    const sp = new StatusProtocol();
    const fiveMinAgo = Date.now() - 5 * 60 * 1000 - 1;
    expect(sp.isStale(fiveMinAgo)).toBe(true);
    expect(sp.isStale(Date.now())).toBe(false);
  });

  it('appends autoCompactEvents to record (G8)', () => {
    const sp = new StatusProtocol();
    const rec: any = { autoCompactEvents: [] };
    const merged = sp.appendCompactEvent(rec, { at: 1, threshold: '0.85', tokensBefore: 100, tokensAfter: 30 });
    expect(merged.autoCompactEvents).toHaveLength(1);
    expect(merged.autoCompactEvents[0]).toMatchObject({ threshold: '0.85' });
  });
});