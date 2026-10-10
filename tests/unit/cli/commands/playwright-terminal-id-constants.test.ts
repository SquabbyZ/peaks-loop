// tests/unit/cli/commands/playwright-terminal-id-constants.test.ts
//
// WHY THIS FILE EXISTS
// --------------------
// Batch 1 of slice 2 (`339746bb`) publishes no enumeration of its
// non-relocation edits at all, and the equivalence evidence the round used
// cannot see a function body. A function-keyed AST comparison of that commit
// (see `.peaks/_runtime/2026-10-10-session-062f74/qa/unproven-edit-audit.md`,
// Part A) found two edits that no request declared: the literals in the
// terminal-id helpers were replaced by named constants while the helpers moved
// to `playwright-session-store.ts`.
//
//     deriveTerminalId    -16  +TERMINAL_HASH_CHARS
//     sanitizeTerminalId  -64  +TERMINAL_ID_MAX_CHARS
//
// A constant is a behaviour-bearing edit — `16` and `64` are the whole of what
// those helpers promise. Both constants are module-private, so nothing can
// assert them by name; what CAN be asserted is the observable output they
// produce, which is what this file does. A direct call, no daemon, no browser,
// no environment.
//
// Dimensions covered:
//   - render:      the id string `deriveTerminalId` returns
//   - behavior:    both branches (session-env and ppid/hash) and both constants
//   - integration: omitted — the function is pure over its injected `env`/`ppid`
//   - a11y:        omitted — no human-visible text, exit code or message

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { deriveTerminalId } from '~/src/cli/commands/playwright-session-store.js';

declareDimensions(
  'tests/unit/cli/commands/playwright-terminal-id-constants.test.ts',
  ['render', 'behavior'],
  [
    { dim: 'integration', reason: 'pure function over injected env/ppid; no fs, spawn or network' },
    { dim: 'a11y', reason: 'no human-visible text, exit code or structured message is produced' }
  ]
);

const SHA_16 = (input: string): string =>
  createHash('sha256').update(input).digest('hex').slice(0, 16);

describe('Scenario: behavior — the terminal-id helpers keep their documented widths', () => {
  it('when a terminal session id is longer than the cap, should truncate it to exactly 64 characters', () => {
    // given: a 100-character TERM_SESSION_ID, all of it legal id characters
    const raw = 'a'.repeat(100);

    // when: the id is derived from the environment
    const id = deriveTerminalId({ TERM_SESSION_ID: raw }, 1);

    // then: it is the cap, not the input, that decides the length
    expect(id).toHaveLength(64);
    expect(id).toBe('a'.repeat(64));
  });

  it('when the terminal session id is under the cap, should keep it whole and sanitized', () => {
    // given: an id with a character the id alphabet does not allow
    const id = deriveTerminalId({ TERM_SESSION_ID: 'term/one' }, 1);

    // when/then: nothing is truncated, and the illegal character is replaced
    expect(id).toBe('term_one');
  });

  it('when there is no session env at all, should fall back to a 16-hex-character ppid hash', () => {
    // given: an environment with neither TERM_SESSION_ID nor WT_SESSION
    const env = { SSH_TTY: '/dev/ttys004' } as NodeJS.ProcessEnv;

    // when: the id is derived
    const id = deriveTerminalId(env, 4242);

    // then: it is `tty-` plus the first 16 hex characters of the documented hash
    expect(id).toBe(`tty-${SHA_16('4242-/dev/ttys004')}`);
    expect(id).toMatch(/^tty-[0-9a-f]{16}$/);
  });

  it('when SSH_TTY is absent too, should still produce a 16-hex-character ppid hash', () => {
    // given: the bare environment the helper falls back to
    const id = deriveTerminalId({}, 7);

    // when/then: `no-tty` is the documented sentinel input to the hash
    expect(id).toBe(`tty-${SHA_16('7-no-tty')}`);
  });

  it('when WT_SESSION is the only session env, should derive the same way from the `wt-` prefix', () => {
    // given: a Windows Terminal session id
    const id = deriveTerminalId({ WT_SESSION: 'b1c2' }, 1);

    // when/then: the prefix is part of the id, and the cap still applies
    expect(id).toBe('wt-b1c2');
  });
});
