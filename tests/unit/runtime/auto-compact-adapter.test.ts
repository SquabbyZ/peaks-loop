import { describe, it, expect } from 'vitest';
import { AutoCompactAdapter } from '../../../packages/peaks-loop-internal-runtime/src/auto-compact-adapter';

describe('AutoCompactAdapter (G8)', () => {
  it('emits peaks-auto-compact marker with thresholds 0.85 and 0.95', () => {
    const a = new AutoCompactAdapter();
    const m = a.marker({ rid: 'r1', sid: 's1', vendorWindow: 200000 });
    expect(m).toContain('<peaks-auto-compact');
    expect(m).toContain('threshold="0.85|0.95"');
    expect(m).toContain('vendor-window="200000"');
    expect(m).toContain('不要等 peaks 主进程来催');
    expect(m).toContain('不限费用');
  });

  it('parses scratch file payload', () => {
    const a = new AutoCompactAdapter();
    const ev = a.parseScratchFile({
      seq: 1, at: 100, summary: 'done X',
      decisionsKept: ['UUID v7'], discardedOptions: ['JWT'],
    });
    expect(ev).toMatchObject({ at: 100, tokensBefore: 0 });
  });
});