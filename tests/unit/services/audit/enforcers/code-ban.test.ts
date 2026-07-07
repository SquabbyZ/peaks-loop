import { describe, it, expect } from 'vitest';
import { isCodeCommit, evaluateCodeBan } from '../../../../../src/services/audit/enforcers/code-ban.js';

describe('code-commit-ban.isCodeCommit', () => {
  it('denies git commit from a peaks-* skill', () => {
    expect(isCodeCommit('peaks-code', 'git commit -m "msg"')).toBe(true);
    expect(isCodeCommit('peaks-rd', 'git commit -am "msg"')).toBe(true);
    expect(isCodeCommit('peaks-qa', 'git commit --amend')).toBe(true);
  });

  it('denies git apply from a peaks-* skill', () => {
    expect(isCodeCommit('peaks-code', 'git apply patch.diff')).toBe(true);
    expect(isCodeCommit('peaks-rd', '   git apply -3 patch.diff')).toBe(true);
  });

  it('allows git commit from a non-peaks skill', () => {
    expect(isCodeCommit('user', 'git commit -m "msg"')).toBe(false);
    expect(isCodeCommit('other-tool', 'git commit -m "msg"')).toBe(false);
    expect(isCodeCommit('', 'git commit -m "msg"')).toBe(false);
  });

  it('allows non-commit/apply git commands from peaks-* skills', () => {
    expect(isCodeCommit('peaks-code', 'git status')).toBe(false);
    expect(isCodeCommit('peaks-rd', 'git log --oneline -10')).toBe(false);
    expect(isCodeCommit('peaks-code', 'git diff HEAD~1')).toBe(false);
  });

  it('allows non-git commands from peaks-* skills', () => {
    expect(isCodeCommit('peaks-code', 'pnpm typecheck')).toBe(false);
    expect(isCodeCommit('peaks-rd', 'ls -la')).toBe(false);
  });
});

describe('code-commit-ban.evaluateCodeBan', () => {
  it('returns denied=true with reason for peaks-* skill + commit', () => {
    const result = evaluateCodeBan({ skill: 'peaks-code', command: 'git commit -m "msg"' });
    expect(result.denied).toBe(true);
    expect(result.reason).toContain('Code Commit Ban Red Line');
    expect(result.reason).toContain('peaks request transition');
  });

  it('returns denied=false with empty reason otherwise', () => {
    const result = evaluateCodeBan({ skill: 'user', command: 'git commit -m "msg"' });
    expect(result.denied).toBe(false);
    expect(result.reason).toBe('');
  });
});