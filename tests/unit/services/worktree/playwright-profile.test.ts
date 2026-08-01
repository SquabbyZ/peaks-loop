import { describe, expect, it } from 'vitest';
import { playwrightProfilePaths } from '~/src/services/worktree/playwright-profile';

describe('playwrightProfilePaths', () => {
  it('returns a user-data-dir under .peaks/_runtime and a deterministic profile name', () => {
    const out = playwrightProfilePaths({ projectRoot: '/r', sessionId: 's1', dispatchId: 'd1' });
    expect(out.userDataDir.replace(/\\/g, '/')).toContain('/.peaks/_runtime/s1/pw-profiles/d1');
    expect(out.profileName).toBe('dispatch-d1');
  });
  it('collision guard: same dispatchId produces the same path', () => {
    const a = playwrightProfilePaths({ projectRoot: '/r', sessionId: 's1', dispatchId: 'd1' });
    const b = playwrightProfilePaths({ projectRoot: '/r', sessionId: 's1', dispatchId: 'd1' });
    expect(a).toEqual(b);
  });
});
