import { describe, it, expect } from 'vitest';
import { StatusProtocol } from '../../../packages/peaks-loop-internal-runtime/src/index';

describe('AutoCompact flow (G8)', () => {
  it('appends ≥ 5 consecutive compact events without record corruption', () => {
    const sp = new StatusProtocol();
    let rec: any = { mode: 'detached', vendor: 'claude', autoCompactEvents: [] };
    for (let i = 0; i < 5; i++) {
      rec = sp.appendCompactEvent(rec, {
        at: 1000 + i, threshold: i === 4 ? '0.95' : '0.85',
        tokensBefore: 100, tokensAfter: 30,
      });
    }
    expect(rec.autoCompactEvents).toHaveLength(5);
    expect(rec.autoCompactEvents[4].threshold).toBe('0.95');
  });
});