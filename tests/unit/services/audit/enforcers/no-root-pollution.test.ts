import { describe, it, expect } from 'vitest';
import { isRootWrite } from '../../../../../src/services/audit/enforcers/no-root-pollution.js';

describe('no-root-pollution.isRootWrite', () => {
  const projectRoot = '/c/Users/smallMark/Desktop/peaks-loop';

  it('allows documented root files', () => {
    expect(isRootWrite({ projectRoot, filePath: '/c/Users/smallMark/Desktop/peaks-loop/README.md' })).toEqual(
      expect.objectContaining({ isRoot: true, allowed: true }),
    );
    expect(isRootWrite({ projectRoot, filePath: '/c/Users/smallMark/Desktop/peaks-loop/package.json' })).toEqual(
      expect.objectContaining({ isRoot: true, allowed: true }),
    );
    expect(isRootWrite({ projectRoot, filePath: '/c/Users/smallMark/Desktop/peaks-loop/LICENSE' })).toEqual(
      expect.objectContaining({ isRoot: true, allowed: true }),
    );
    expect(isRootWrite({ projectRoot, filePath: '/c/Users/smallMark/Desktop/peaks-loop/.gitignore' })).toEqual(
      expect.objectContaining({ isRoot: true, allowed: true }),
    );
  });

  it('denies undocumented root files', () => {
    expect(isRootWrite({ projectRoot, filePath: '/c/Users/smallMark/Desktop/peaks-loop/peaks-foo.md' })).toEqual(
      expect.objectContaining({ isRoot: true, allowed: false, denyReason: expect.stringContaining('no-root-pollution') }),
    );
  });

  it('allows non-root files (depth > 1)', () => {
    expect(isRootWrite({ projectRoot, filePath: '/c/Users/smallMark/Desktop/peaks-loop/docs/foo.md' })).toEqual(
      expect.objectContaining({ isRoot: false, allowed: true }),
    );
    expect(isRootWrite({ projectRoot, filePath: '/c/Users/smallMark/Desktop/peaks-loop/src/cli/index.ts' })).toEqual(
      expect.objectContaining({ isRoot: false, allowed: true }),
    );
    expect(isRootWrite({ projectRoot, filePath: '/c/Users/smallMark/Desktop/peaks-loop/tests/unit/foo.test.ts' })).toEqual(
      expect.objectContaining({ isRoot: false, allowed: true }),
    );
  });

  it('allows project config dirs at root', () => {
    expect(isRootWrite({ projectRoot, filePath: '/c/Users/smallMark/Desktop/peaks-loop/openspec/changes/foo.md' })).toEqual(
      expect.objectContaining({ isRoot: false, allowed: true }),
    );
    expect(isRootWrite({ projectRoot, filePath: '/c/Users/smallMark/Desktop/peaks-loop/.peaks/_runtime/foo/skill.md' })).toEqual(
      expect.objectContaining({ isRoot: false, allowed: true }),
    );
    expect(isRootWrite({ projectRoot, filePath: '/c/Users/smallMark/Desktop/peaks-loop/.claude/settings.json' })).toEqual(
      expect.objectContaining({ isRoot: false, allowed: true }),
    );
  });

  it('allows skills/ and src/ as top-level dirs', () => {
    expect(isRootWrite({ projectRoot, filePath: '/c/Users/smallMark/Desktop/peaks-loop/skills/peaks-code/SKILL.md' })).toEqual(
      expect.objectContaining({ isRoot: false, allowed: true }),
    );
    expect(isRootWrite({ projectRoot, filePath: '/c/Users/smallMark/Desktop/peaks-loop/src/services/foo.ts' })).toEqual(
      expect.objectContaining({ isRoot: false, allowed: true }),
    );
  });

  it('deny reason names the file path and the recovery options', () => {
    const result = isRootWrite({ projectRoot, filePath: '/c/Users/smallMark/Desktop/peaks-loop/random.md' });
    expect(result.denyReason).toContain('random.md');
    expect(result.denyReason).toMatch(/docs|tests|skills/);
  });
});
