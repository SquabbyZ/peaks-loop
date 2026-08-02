// tests/unit/context/render-context-block-fallback.test.ts
//
// Slice 4.0.7-dogfood-PR-11. Verifies that `renderContextBlock`
// short-circuits to the "no probe available" message when the
// probe's source is one of the untrusted fallbacks (e.g.
// conservative-fallback) so the sub-agent does not mistake
// "0.0% used (100.0% free)" for a real measurement.
//
// Run with: pnpm vitest run tests/unit/context/render-context-block-fallback.test.ts

import { describe, expect, it } from 'vitest';
import { buildDispatchSystemPrompt } from '../../../src/services/context/build-dispatch-system-prompt.js';

describe('buildDispatchSystemPrompt: context block fallback (PR-11)', () => {
  it('trusted source (token-counted) renders the authoritative block with used/free percent', () => {
    const result = buildDispatchSystemPrompt({
      taskTitle: 'rd',
      taskBody: 'x',
      memoryBlock: { block: '', count: 0, bytes: 0 },
      contextProbe: { ratio: 0.42, source: 'token-counted', ide: 'claude-code' }
    });
    expect(result).toContain('42.0% used');
    expect(result).toContain('58.0% free');
    expect(result).not.toContain('does not trust this source');
  });

  it('untrusted source (conservative-fallback) short-circuits to the "no probe available" message', () => {
    const result = buildDispatchSystemPrompt({
      taskTitle: 'rd',
      taskBody: 'x',
      memoryBlock: { block: '', count: 0, bytes: 0 },
      contextProbe: { ratio: 0, source: 'conservative-fallback', ide: 'claude-code' }
    });
    expect(result).toContain('does not trust this source');
    expect(result).toContain('Treat the displayed ratio as unverified');
  });

  it('null probe renders the bare "no probe available" message', () => {
    const result = buildDispatchSystemPrompt({
      taskTitle: 'rd',
      taskBody: 'x',
      memoryBlock: { block: '', count: 0, bytes: 0 },
      contextProbe: null
    });
    expect(result).toContain('no probe available');
    expect(result).toContain('peaks code context-now');
  });
});
