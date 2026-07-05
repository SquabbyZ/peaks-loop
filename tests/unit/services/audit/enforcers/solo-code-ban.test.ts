import { describe, it, expect } from 'vitest';
import { isSoloCodeCommit, evaluateSoloCodeBan } from '../../../../../src/services/audit/enforcers/solo-code-ban.js';

describe('solo-code-ban.isSoloCodeCommit', () => {
  it('denies git commit from a peaks-* skill', () => {
    expect(isSoloCodeCommit('peaks-code', 'git commit -m "msg"')).toBe(true);
    expect(isSoloCodeCommit('peaks-rd', 'git commit -am "msg"')).toBe(true);
    expect(isSoloCodeCommit('peaks-qa', 'git commit --amend')).toBe(true);
  });

  it('denies git apply from a peaks-* skill', () => {
    expect(isSoloCodeCommit('peaks-code', 'git apply patch.diff')).toBe(true);
    expect(isSoloCodeCommit('peaks-rd', '   git apply -3 patch.diff')).toBe(true);
  });

  it('allows git commit from a non-peaks skill', () => {
    expect(isSoloCodeCommit('user', 'git commit -m "msg"')).toBe(false);
    expect(isSoloCodeCommit('other-tool', 'git commit -m "msg"')).toBe(false);
    expect(isSoloCodeCommit('', 'git commit -m "msg"')).toBe(false);
  });

  it('allows non-commit/apply git commands from peaks-* skills', () => {
    expect(isSoloCodeCommit('peaks-code', 'git status')).toBe(false);
    expect(isSoloCodeCommit('peaks-rd', 'git log --oneline -10')).toBe(false);
    expect(isSoloCodeCommit('peaks-code', 'git diff HEAD~1')).toBe(false);
  });

  it('allows non-git commands from peaks-* skills', () => {
    expect(isSoloCodeCommit('peaks-code', 'pnpm typecheck')).toBe(false);
    expect(isSoloCodeCommit('peaks-rd', 'ls -la')).toBe(false);
  });
});

describe('solo-code-ban.evaluateSoloCodeBan', () => {
  it('returns denied=true with reason for peaks-* skill + commit', () => {
    const result = evaluateSoloCodeBan({ skill: 'peaks-code', command: 'git commit -m "msg"' });
    expect(result.denied).toBe(true);
    expect(result.reason).toContain('Solo Code-Change Red Line');
    expect(result.reason).toContain('peaks request transition');
  });

  it('returns denied=false with empty reason otherwise', () => {
    const result = evaluateSoloCodeBan({ skill: 'user', command: 'git commit -m "msg"' });
    expect(result.denied).toBe(false);
    expect(result.reason).toBe('');
  });
});
