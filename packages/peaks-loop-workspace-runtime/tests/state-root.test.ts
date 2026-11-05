import { describe, expect, it } from 'vitest';

import { defaultStateRoot, isSinglePathSegment, sessionRuntimeDir } from '../src/state-root.js';

const STATE_ROOT = '/custom/state';

function invalidId(sessionId: string): Error {
  return new Error(`Invalid session id: ${sessionId} (must be a single path segment)`);
}

describe('defaultStateRoot', () => {
  it('when given a project root, should compose the runtime root beneath it', () => {
    // given:
    const projectRoot = '/work/project';
    // when:
    const stateRoot = defaultStateRoot(projectRoot);
    // then:
    expect(stateRoot).toBe('/work/project/.peaks/_runtime');
  });

  it('when the project root ends in a separator, should not double it', () => {
    // given:
    const projectRoot = 'C:\\work\\project\\';
    // when:
    const dir = sessionRuntimeDir({ stateRoot: defaultStateRoot(projectRoot), sessionId: 'sid-1' });
    // then:
    expect(dir).toBe('C:/work/project/.peaks/_runtime/sid-1');
  });
});

describe('sessionRuntimeDir', () => {
  it('when a state root and session id are given, should append one segment', () => {
    // given:
    const scope = { stateRoot: '/custom/state', sessionId: '2026-11-05-session-af31e4' };
    // when:
    const dir = sessionRuntimeDir(scope);
    // then:
    expect(dir).toBe('/custom/state/2026-11-05-session-af31e4');
  });

  it('when the state root uses backslashes, should emit forward slashes', () => {
    // given:
    const scope = { stateRoot: 'C:\\custom\\state', sessionId: 'sid-1' };
    // when:
    const dir = sessionRuntimeDir(scope);
    // then:
    expect(dir).toBe('C:/custom/state/sid-1');
  });

  it('when the state root has a trailing separator, should not double it', () => {
    // given:
    const scope = { stateRoot: '/custom/state/', sessionId: 'sid-1' };
    // when:
    const dir = sessionRuntimeDir(scope);
    // then:
    expect(dir).toBe('/custom/state/sid-1');
  });
});

describe('session id validation', () => {
  it('when the session id is empty, should throw the single-segment message', () => {
    // given:
    const sessionId = '';
    // when:
    const run = (): string => sessionRuntimeDir({ stateRoot: STATE_ROOT, sessionId });
    // then:
    expect(run).toThrowError(invalidId(sessionId));
  });

  it('when the session id is a dot, should throw the single-segment message', () => {
    // given:
    const sessionId = '.';
    // when:
    const run = (): string => sessionRuntimeDir({ stateRoot: STATE_ROOT, sessionId });
    // then:
    expect(run).toThrowError(invalidId(sessionId));
  });

  it('when the session id is a dot-dot, should throw the single-segment message', () => {
    // given:
    const sessionId = '..';
    // when:
    const run = (): string => sessionRuntimeDir({ stateRoot: STATE_ROOT, sessionId });
    // then:
    expect(run).toThrowError(invalidId(sessionId));
  });

  it('when the session id contains a forward slash, should throw the single-segment message', () => {
    // given:
    const sessionId = 'a/b';
    // when:
    const run = (): string => sessionRuntimeDir({ stateRoot: STATE_ROOT, sessionId });
    // then:
    expect(run).toThrowError(invalidId(sessionId));
  });

  it('when the session id contains a backslash, should throw the single-segment message', () => {
    // given:
    const sessionId = 'a\\b';
    // when:
    const run = (): string => sessionRuntimeDir({ stateRoot: STATE_ROOT, sessionId });
    // then:
    expect(run).toThrowError(invalidId(sessionId));
  });

  it('when the session id contains a NUL, should throw the single-segment message', () => {
    // given:
    const sessionId = 'a\0b';
    // when:
    const run = (): string => sessionRuntimeDir({ stateRoot: STATE_ROOT, sessionId });
    // then:
    expect(run).toThrowError(invalidId(sessionId));
  });

  it('when the id is one ordinary segment, should accept it', () => {
    // given:
    const ids = ['sid-1', '2026-11-05-session-af31e4', 'a b'];
    // when:
    const verdicts = ids.map((id) => isSinglePathSegment(id));
    // then:
    expect(verdicts).toEqual([true, true, true]);
  });
});
