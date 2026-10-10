// tests/unit/services/audit/code-ban.test.ts
//
// The commit ban skipped itself entirely when the driver could not be
// resolved: `hook-handle.ts` guarded the whole evaluation with
// `if (activeSkill.skill !== null)`, so a resolution failure meant no ban at
// all. The replacement has to tell two different situations apart, which is
// what the extra inputs are for:
//
//   - the caller DID resolve and simply has no peaks skill  -> allow
//     (Review Focus #1: otherwise every ordinary session in a repo with the
//     gate installed cannot commit)
//   - the caller could NOT be resolved while a peaks lease is present -> ban
//     ("peaks is here, but not necessarily you")

import { describe, expect, it } from 'vitest';

import { evaluateCodeBan } from '../../../../src/services/audit/enforcers/code-ban.js';

const COMMIT = 'git commit -m "fix: something"';

describe('evaluateCodeBan — unresolved identity', () => {
  it('bans a commit from a peaks-* skill', () => {
    const r = evaluateCodeBan({
      skill: 'peaks-code',
      command: COMMIT,
      peaksLeasePresent: true,
      identityResolved: true
    });
    expect(r.denied).toBe(true);
  });

  it('allows a commit from a caller that resolved and has no peaks skill', () => {
    const r = evaluateCodeBan({
      skill: null,
      command: COMMIT,
      peaksLeasePresent: true,
      identityResolved: true
    });
    expect(r.denied).toBe(false);
  });

  it('bans when the identity could not be resolved while a peaks lease is present', () => {
    const r = evaluateCodeBan({
      skill: null,
      command: COMMIT,
      peaksLeasePresent: true,
      identityResolved: false
    });
    expect(r.denied).toBe(true);
  });

  it('allows when the identity could not be resolved and no peaks lease exists', () => {
    const r = evaluateCodeBan({
      skill: null,
      command: COMMIT,
      peaksLeasePresent: false,
      identityResolved: false
    });
    expect(r.denied).toBe(false);
  });

  it('ignores commands that are not commits, whatever the identity says', () => {
    const r = evaluateCodeBan({
      skill: 'peaks-code',
      command: 'ls -la',
      peaksLeasePresent: true,
      identityResolved: false
    });
    expect(r.denied).toBe(false);
  });

  it('names an actionable next step when it bans on unresolved identity', () => {
    // Review Focus #5: this branch must not fail silently.
    const r = evaluateCodeBan({
      skill: null,
      command: COMMIT,
      peaksLeasePresent: true,
      identityResolved: false
    });
    expect(r.reason.length).toBeGreaterThan(0);
    expect(r.reason).toMatch(/request transition|session/i);
  });
});
