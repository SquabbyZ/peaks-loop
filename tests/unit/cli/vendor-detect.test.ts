import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../packages/peaks-loop-internal-runtime/src/index', () => ({
  defaultRegistry: () => ({
    list: () => [
      { id: 'claude', detectInstalled: vi.fn(async () => true) },
      { id: 'codex', detectInstalled: vi.fn(async () => false) },
      { id: 'copilot', detectInstalled: vi.fn(async () => false) },
    ],
  }),
}));

import { vendorDetect } from '../../../src/cli/commands/vendor-detect';

describe('peaks vendor-detect', () => {
  it('reports installed vendors with recommended default', async () => {
    const out = await vendorDetect({ json: true });
    expect(out.ok).toBe(true);
    expect(out.data.installed).toContain('claude');
    expect(out.data.installed).not.toContain('codex');
    expect(out.data.recommended).toBe('claude');
  });
});