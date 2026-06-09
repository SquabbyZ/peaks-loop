/**
 * Slice 020 — sub-agent-caller-inheritance.test.ts.
 *
 * Covers M5 (sub-agent inherits parent's callerId via spawn env) and
 * R2 (3-level spawn chain preserves the original parent's callerId).
 * Per the contract, sub-agents do NOT generate their own callerId;
 * they inherit the parent's via `PEAKS_CALLER_ID=<parent>` in the
 * spawn env.
 *
 * See `.peaks/_runtime/2026-06-09-session-8bfe7d/prd/source/caller-id-contract.md`
 * (M5) and the QA test-cases document
 * `.peaks/_runtime/2026-06-09-session-8bfe7d/qa/test-cases/002-020-2026-06-09-caller-keyed-session-binding.md`
 * (TC-A6e).
 */

import { describe, expect, test } from 'vitest';
import { resolveCallerId } from '../../../../src/services/session/resolve-caller-id.js';

describe('M5 — sub-agent inherits parent callerId via PEAKS_CALLER_ID', () => {
  test('sub-agent with PEAKS_CALLER_ID=<parent> returns parent\'s id, not its own pid', () => {
    // The sub-agent's own process would have its own CLAUDE_CODE_SESSION_ID
    // (or no env at all in a synthetic test). The parent's callerId
    // wins because D4 priority: env (PEAKS_CALLER_ID) > platform fallback.
    const id = resolveCallerId({
      env: {
        PEAKS_CALLER_ID: 'parent-caller-id',
        CLAUDE_CODE_SESSION_ID: 'sub-agent-own-claude-id'
      }
    });
    expect(id).toBe('parent-caller-id');
  });

  test('sub-agent with only PEAKS_CALLER_ID set uses that', () => {
    const id = resolveCallerId({
      env: { PEAKS_CALLER_ID: 'inherited-id' }
    });
    expect(id).toBe('inherited-id');
  });

  test('sub-agent with no PEAKS_CALLER_ID and no Claude env falls through to D2 (rejects)', () => {
    expect(() => resolveCallerId({ env: {} })).toThrow(/No caller id available/);
  });
});

describe('R2 — 3-level spawn chain preserves the original parent\'s callerId', () => {
  test('grandparent callerId survives 3 levels of spawn inheritance', () => {
    // Level 0 (root): `peaks-solo` runs with `PEAKS_CALLER_ID=grandparent-id`.
    // Level 1: spawns `peaks-rd` with `PEAKS_CALLER_ID=grandparent-id` in spawn env.
    // Level 2: `peaks-rd` spawns `peaks-qa` with `PEAKS_CALLER_ID=grandparent-id` in spawn env.
    // Level 3: `peaks-qa` reads `process.env.PEAKS_CALLER_ID` — it should be `grandparent-id`.
    //
    // The deepest agent sees the ORIGINAL parent's callerId, NOT its
    // own pid, NOT its immediate parent's pid if the chain is 3 deep.
    const deepestId = resolveCallerId({
      env: {
        PEAKS_CALLER_ID: 'grandparent-id',
        // The deepest agent's own harness env vars should be ignored
        // (env beats platform fallback per D4).
        CLAUDE_CODE_SESSION_ID: 'deepest-agent-own-claude-id'
      }
    });
    expect(deepestId).toBe('grandparent-id');
  });

  test('explicit flag in the deepest agent overrides the inherited env', () => {
    // Even at the deepest level, an explicit `--caller-id` flag
    // wins (D4 level 1: flag > env > fallback). This is the
    // per-invocation override that lets a sub-agent say "for THIS
    // call only, use a different id" without disturbing the
    // inherited env.
    const id = resolveCallerId({
      flagValue: 'explicit-deepest-override',
      env: { PEAKS_CALLER_ID: 'grandparent-id' }
    });
    expect(id).toBe('explicit-deepest-override');
  });
});

describe('CallerIdError surfaces the right source for inherited callers', () => {
  test('env value with whitespace reports source=env (so the sub-agent can fix PEAKS_CALLER_ID)', () => {
    try {
      resolveCallerId({ env: { PEAKS_CALLER_ID: 'bad value' } });
      expect.fail('expected CallerIdError');
    } catch (error) {
      const e = error as unknown as { code: string; source: string; message: string };
      expect(e.code).toBe('EX_DATAERR');
      expect(e.source).toBe('env');
      // The error message tells the user the source (`env`) and what
      // to fix (the regex). The D2 message also names PEAKS_CALLER_ID;
      // the D5 message names the source level. Together they let the
      // user identify the offender without seeing the full stack.
      expect(e.message).toMatch(/source: env/);
      expect(e.message).toMatch(/callerId must match/);
    }
  });
});
