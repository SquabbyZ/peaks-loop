import { describe, expect, it } from 'vitest';

import { detectIdeFromEnv, IDE_KINDS, isIdeKind } from '../../../../src/services/context/ide-detect.js';

describe('ide-detect behavior', () => {
  it('detects Claude Code from either Claude environment marker', () => {
    expect(detectIdeFromEnv({ CLAUDE_CODE_ENTRYPOINT: 'cli' })).toBe('claude-code');
    expect(detectIdeFromEnv({ CLAUDE_SESSION_ID: 'session-1' })).toBe('claude-code');
  });

  it('detects Trae and OpenCode markers', () => {
    expect(detectIdeFromEnv({ TRAE_CLI: '1' })).toBe('trae');
    expect(detectIdeFromEnv({ OPENCODE: '1' })).toBe('opencode');
  });

  it('returns unknown when no supported marker is present', () => {
    expect(detectIdeFromEnv({})).toBe('unknown');
  });

  it('ignores empty marker values', () => {
    expect(detectIdeFromEnv({ CLAUDE_CODE_ENTRYPOINT: '', TRAE_CLI: '' })).toBe('unknown');
  });
});

describe('ide-detect contract', () => {
  it('exposes the supported kind list and type guard', () => {
    expect(IDE_KINDS).toEqual(['claude-code', 'trae', 'opencode', 'unknown']);
    expect(isIdeKind('trae')).toBe(true);
    expect(isIdeKind('cursor')).toBe(false);
  });
});
