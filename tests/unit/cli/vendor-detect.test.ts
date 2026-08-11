import { describe, it, expect, vi } from 'vitest';

// Mock at the workspace alias 'peaks-loop-internal-runtime' (NOT the
// source-file path). The handler (src/cli/commands/vendor-detect.ts)
// imports via the package alias which resolves to
// node_modules/peaks-loop-internal-runtime/dist/index.js. Mocking at
// the alias intercepts ALL import shapes — the old path-based mocks
// crashed because the production handler bypasses the mocked source.
vi.mock('peaks-loop-internal-runtime', () => ({
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
