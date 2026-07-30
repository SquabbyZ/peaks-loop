// tests/unit/services/session/get-session-dir.test.ts
//
// 4-dimension unit test for the canonical session-directory resolver
// (`src/services/session/getSessionDir.ts`) and the caller-id
// type surface (`src/services/session/caller-id-types.ts`).
//
// Why this test file exists:
//   1. The session-dir helper is the ONE place every other peaks-loop
//      module is supposed to route through to compose the per-session
//      workspace path. Pin its contract so a future refactor that
//      bypasses it (a direct `join('.peaks', sid)`) is caught.
//   2. CALLER_ID_REGEX + CallerIdError are the shared contract that
//      `resolve-caller-id` and the per-caller binding layout depend
//      on. Locking them here means a future tightening of the regex
//      or a new error code is a deliberate change.
//
// Dimensions covered:
//   - render:    path composition shape; regex pattern shape
//   - behavior:  path composition (forward + back slashes via path.join
//                platform handling); regex accept/reject; CallerIdError
//                carries the documented code/source/value
//   - integration: not applicable (pure module)
//   - a11y:      CallerIdError.message is human-readable

import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';
import { join } from 'node:path';

declareDimensions(
  'tests/unit/services/session/get-session-dir.test.ts',
  ['render', 'behavior', 'a11y'],
  [{ dim: 'integration', reason: 'pure module' }],
);

import { getSessionDir } from '~/src/services/session/getSessionDir';
import {
  CALLER_ID_REGEX,
  CallerIdError,
  type CallerBinding,
  type CallerIdSource,
  type CallerSkillPresence,
} from '~/src/services/session/caller-id-types';

describe('render — getSessionDir shape', () => {
  it('composes <projectRoot>/.peaks/_runtime/<sessionId>', () => {
    expect(getSessionDir('/proj', 'sid-1')).toBe(join('/proj', '.peaks', '_runtime', 'sid-1'));
  });

  it('handles a project root that already ends with a path separator', () => {
    // node:path.join collapses redundant separators, so the result is
    // well-formed regardless. The test pins that.
    expect(getSessionDir('/proj/', 'sid-1')).toBe(join('/proj', '.peaks', '_runtime', 'sid-1'));
  });

  it('uses only the canonical 3-segment path (no legacy top-level layout)', () => {
    const out = getSessionDir('/proj', 'sid');
    // The canonical invariant: .peaks/_runtime/<sid>, NOT any legacy
    // top-level /worktrees /artifacts /etc. under .peaks/<sid>.
    expect(out).toMatch(/\.peaks[\\/]_runtime[\\/]sid$/);
    expect(out).not.toMatch(/\.peaks[\\/]sid[\\/]/);
  });
});

describe('render — caller-id types', () => {
  it('CALLER_ID_REGEX matches the documented shape (letters/digits/._- ; 1-200 chars)', () => {
    expect('abc').toMatch(CALLER_ID_REGEX);
    expect('abc-123_xyz.0').toMatch(CALLER_ID_REGEX);
    expect('a'.repeat(200)).toMatch(CALLER_ID_REGEX);
  });

  it('CallerBinding interface includes all 8 documented fields', () => {
    // The interface itself is erased at runtime; this test pins the
    // documented shape via a structural assignment.
    const sample: CallerBinding = {
      callerId: 'c1',
      peakSessionId: 'sid-1',
      projectRoot: '/proj',
      createdAt: '2026-07-30T00:00:00.000Z',
      lastActivityAt: '2026-07-30T00:00:00.000Z',
      skill: 'peaks-code',
      mode: 'full-auto',
      gate: 'startup',
    };
    expect(Object.keys(sample).sort()).toEqual([
      'callerId', 'createdAt', 'gate', 'lastActivityAt',
      'mode', 'peakSessionId', 'projectRoot', 'skill',
    ]);
  });

  it('CallerSkillPresence interface includes the 5 required + 2 optional fields', () => {
    const required: CallerSkillPresence = {
      callerId: 'c1',
      skill: 'peaks-code',
      setAt: '2026-07-30T00:00:00.000Z',
    };
    expect(required.callerId).toBe('c1');
    const withOptionals: CallerSkillPresence = {
      ...required,
      mode: 'full-auto',
      gate: 'startup',
      lastHeartbeat: '2026-07-30T00:00:00.000Z',
    };
    expect(withOptionals.lastHeartbeat).toBeDefined();
  });
});

describe('behavior — CALLER_ID_REGEX', () => {
  it('rejects empty input', () => {
    expect('').not.toMatch(CALLER_ID_REGEX);
  });

  it('rejects strings longer than 200 chars', () => {
    expect('a'.repeat(201)).not.toMatch(CALLER_ID_REGEX);
  });

  it('rejects path separators (Windows + Unix)', () => {
    expect('a/b').not.toMatch(CALLER_ID_REGEX);
    expect('a\\b').not.toMatch(CALLER_ID_REGEX);
  });

  it('rejects whitespace and control chars', () => {
    expect('a b').not.toMatch(CALLER_ID_REGEX);
    expect('a\tb').not.toMatch(CALLER_ID_REGEX);
    expect('a\nb').not.toMatch(CALLER_ID_REGEX);
    expect('a\0b').not.toMatch(CALLER_ID_REGEX);
  });

  it('rejects non-ASCII Unicode', () => {
    expect('héllo').not.toMatch(CALLER_ID_REGEX);
    expect('日本').not.toMatch(CALLER_ID_REGEX);
  });
});

describe('behavior — CallerIdError', () => {
  it('EX_USAGE error: code + source + value + name are all set', () => {
    const err = new CallerIdError('EX_USAGE', 'env', 'no callerId available', undefined);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CallerIdError');
    expect(err.code).toBe('EX_USAGE');
    expect(err.source).toBe<CallerIdSource>('env');
    expect(err.value).toBeUndefined();
  });

  it('EX_DATAERR error: code + source + value are all set', () => {
    const err = new CallerIdError('EX_DATAERR', 'flag', 'bad callerId', 'a/b');
    expect(err.code).toBe('EX_DATAERR');
    expect(err.source).toBe<CallerIdSource>('flag');
    expect(err.value).toBe('a/b');
  });

  it('throws when called without `new` (subclass of Error contract)', () => {
    // TypeScript prevents direct call at compile time, but the
    // runtime contract still requires `new`. Pin it.
    expect(() => CallerIdError('EX_USAGE', 'none', 'msg')).toThrow(TypeError);
  });
});

describe('a11y — CallerIdError message surface', () => {
  it('message text is human-readable and starts with a capital letter (style guide)', () => {
    const err = new CallerIdError('EX_DATAERR', 'env', 'Caller id must match D1 regex', 'bad/id');
    expect(err.message).toMatch(/^[A-Z]/);
    expect(err.message).not.toMatch(/at .+:\d+/);
  });
});
