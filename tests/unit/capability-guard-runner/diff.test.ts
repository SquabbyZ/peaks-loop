import { describe, expect, it } from 'vitest';
import { formatHumanReadableDiff } from '~/src/services/capability-guard-runner/diff';

describe('formatHumanReadableDiff', () => {
  it('produces a multi-line report naming the broken invariant', () => {
    const out = formatHumanReadableDiff({ before: 'a == 1', after: 'a == 2', reason: 'J03#2 broken' });
    expect(out).toContain('J03#2 broken');
    expect(out).toContain('- a == 1');
    expect(out).toContain('+ a == 2');
  });
});