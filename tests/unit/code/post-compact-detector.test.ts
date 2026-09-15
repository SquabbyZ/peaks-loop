// tests/unit/code/post-compact-detector.test.ts
//
// 4-dimension unit test for src/services/code/post-compact-detector.ts.
//
// Slice 2026-07-31-rid-post-compact-detector-silent-catch-sweep narrows two
// silent catches inside the file-local helpers:
//
//   catch #1  safeReadCheckpoint(...) wraps statSync + readFileSync + JSON.parse
//   catch #2  readActiveSkillName(...) wraps getSkillPresence(...)
//
// Pre-rid both catches carried `catch { return null }` / `catch { return
// undefined }` which silently swallowed ALL errors — including
// `ReferenceError` (ESM module-load bugs) and `SyntaxError` (parse bugs from
// a corrupt checkpoint). This is the exact anti-fake-green pattern pinned
// by rid-001-r2 (readClaudeTranscriptFallback) and rid-001-r3
// (readClaudeStatuslinePercent), and previously by
// rid-presence-marker-silent-catch-sweep (readPresenceFile).
//
// Post-rid both catches re-throw `ReferenceError` / `SyntaxError` to the
// caller (so a future module-load or parse bug fails loudly) while still
// swallowing IO errors (`ENOENT`, `EACCES`, …) — the original "checkpoint
// not readable" / "presence unreadable" semantic.
//
// S6 (2026-09-15) — THE RULE IS NOW THE OTHER WAY ROUND. Naming the two JS
// error classes to rethrow is not the same as "swallow IO errors": it
// swallowed every OTHER class instead, i.e. exactly the unexpected ones. The
// predicate is now `isExpectedFsMiss` (`src/shared/fs-utils.ts`) — swallow the
// fs-miss codes (`ENOENT`, `ENOTDIR`, `EISDIR`, `EACCES`, `EPERM`, `ELOOP`,
// `ENAMETOOLONG`), propagate everything else. Case A (SyntaxError) and the new
// Case C (TypeError) pin the propagate half; Case B pins the swallow half with
// a fixture that throws the `{ code: 'EACCES' }` a real `readFileSync` throws.
//
// Dimensions covered:
//   - render:     not applicable — no user-visible text in this module
//   - behavior:   SyntaxError from broken checkpoint JSON surfaces, a non-IO
//                 error surfaces, an fs-miss still returns
//                 `no-checkpoint-today`
//   - integration: real fs read of synthetic checkpoint under tmp project root
//   - a11y:       not applicable — no user-visible text in this module
//
// Run with: pnpm vitest run tests/unit/code/post-compact-detector.test.ts

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';

// Slice 2026-07-31-rid-post-compact-detector-silent-catch-sweep needs to
// verify that an IO error raised inside the safeReadCheckpoint readFileSync
// block is STILL silently swallowed (the original "checkpoint unreadable"
// semantic must be preserved), while a SyntaxError from JSON.parse
// SURFACES. ESM module namespaces are frozen, so
// `vi.spyOn(fsModule, 'readFileSync')` fails at runtime with "Cannot
// redefine property: readFileSync" — the same constraint already
// documented in rid-001-r2 and rid-presence-marker-silent-catch-sweep.
//
// The accepted workaround is a per-file `vi.mock('node:fs', …)` with a
// hoisted, controllable replacement. `vi.hoisted` is required because
// `vi.mock` is hoisted to the top of the file BEFORE all imports, and the
// factory must reference a value that exists at hoist time.
const __fsMocks = vi.hoisted(() => ({
  // Default: pass-through to real implementation. Each test can override
  // before triggering the call.
  readFileSync: null as unknown as ((...args: unknown[]) => unknown) | null,
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    readFileSync: (...args: unknown[]) => {
      if (__fsMocks.readFileSync) {
        return __fsMocks.readFileSync(...args);
      }
      return (actual.readFileSync as (...a: unknown[]) => unknown)(...args);
    },
  };
});

// Import AFTER the `vi.mock` above so the mocked `node:fs` is bound to the
// module under test.
const { detectPostCompactResume } = await import('../../../src/services/code/post-compact-detector.js');

declareDimensions(
  'tests/unit/code/post-compact-detector.test.ts',
  ['behavior', 'integration'],
  [
    {
      dim: 'render',
      reason: 'no user-visible text in this module; the public surface is a typed return object only',
    },
    {
      dim: 'a11y',
      reason: 'no user-visible text in this module; this file is consumed by peaks-code Step 0.7, not rendered for humans',
    },
  ],
);

// Slice 2026-07-31-rid-post-compact-detector-silent-catch-sweep narrows the
// silent catches in `safeReadCheckpoint`. Pre-rid they swallowed ALL errors
// (including ReferenceError, SyntaxError) which would have hidden the
// rid-001-r1 ESM `require is not defined` regression if the same shape
// ever applied to a checkpoint read.
//
// The tests below pin both halves of the contract from the public surface:
//
//   Case A: SyntaxError from JSON.parse on a broken checkpoint JSON bubbles
//           up through detectPostCompactResume (NOT swallowed → caller sees
//           the corruption).
//   Case B: IO error (EACCES-style) raised by readFileSync against an
//           existing checkpoint file is STILL swallowed (backward-compat:
//           no-checkpoint-today semantic preserved when the file is
//           unreadable).
describe("Scenario: behavior — safeReadCheckpoint catch narrows to IO errors only", () => {
  it("when invoked, should Case A: SyntaxError from broken checkpoint JSON surfaces to caller (NOT swallowed)", async () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    // Build a tmp project with the canonical checkpoint path containing
    // INVALID JSON. existsSync returns true → statSync + readFileSync run
    // → JSON.parse throws SyntaxError. Post-rid the catch MUST re-throw
    // instead of returning null — this is the same anti-fake-green
    // contract pinned by rid-001-r2 for readClaudeTranscriptFallback,
    // rid-001-r3 for readClaudeStatuslinePercent, and
    // rid-presence-marker-silent-catch-sweep for readPresenceFile.
    const tmpDir = mkdtempSync(join(tmpdir(), 'peaks-pcr-syntax-'));
    const sessionId = '2026-07-31-test-session';
    const runtimeDir = join(tmpDir, '.peaks', '_runtime', sessionId);
    mkdirSync(join(runtimeDir, 'checkpoints'), { recursive: true });
    writeFileSync(
      join(runtimeDir, 'checkpoints', 'cp-bad.json'),
      '{ this is not valid JSON :: ',
      'utf8',
    );
    // We expect detectPostCompactResume to re-throw the SyntaxError.
    // The presence-marker is not on disk so we pre-seed activeSkill to
    // 'peaks-code' so we don't need a presence file for this test.
    await expect(
      detectPostCompactResume({
        sessionId,
        projectRoot: tmpDir,
        activeSkill: 'peaks-code',
      }),
    ).rejects.toThrow(SyntaxError);
  });

  it("when invoked, should Case B: IO error from readFileSync against existing checkpoint returns no-checkpoint-today (still swallowed)", async () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    // Backward-compat: the original "checkpoint unreadable" semantic MUST
    // be preserved for genuine IO failures (EACCES on a read-protected
    // checkpoint). We simulate one by throwing what Node ACTUALLY throws —
    // an Error carrying `code: 'EACCES'` — so the catch's predicate
    // (`isExpectedFsMiss`) sees the same shape production sees.
    //
    // S6 (2026-09-15): this fixture used to throw a plain Error whose MESSAGE
    // said "EACCES", and passed because the old catch rethrew only
    // ReferenceError / SyntaxError. That made the fixture agree with a rule
    // the prose above did not actually describe ("plain IO errors"): a plain
    // Error is not an IO error, it is an error of unknown kind, and the old
    // catch swallowed it. The assertion below is unchanged; only the fixture
    // now matches the situation it claims to simulate.
    const tmpDir = mkdtempSync(join(tmpdir(), 'peaks-pcr-io-'));
    const sessionId = '2026-07-31-test-session';
    const runtimeDir = join(tmpDir, '.peaks', '_runtime', sessionId);
    mkdirSync(join(runtimeDir, 'checkpoints'), { recursive: true });
    writeFileSync(
      join(runtimeDir, 'checkpoints', 'cp-good.json'),
      '{"mode":"rd"}',
      'utf8',
    );
    __fsMocks.readFileSync = () => {
      throw Object.assign(new Error('EACCES: permission denied, open cp-good.json'), {
        code: 'EACCES',
        errno: -13,
        syscall: 'open',
      });
    };
    try {
      const out = await detectPostCompactResume({
        sessionId,
        projectRoot: tmpDir,
        activeSkill: 'peaks-code',
      });
      // IO error path → checkpoint unreadable → falls through to
      // no-checkpoint-today (no auto-resume).
      expect(out.shouldAutoResume).toBe(false);
      expect(out.reason).toBe('no-checkpoint-today');
    } finally {
      __fsMocks.readFileSync = null;
    }
  });

  it("when invoked, should Case C: a NON-IO error from readFileSync surfaces to caller (NOT swallowed)", async () => {
    // S6 (2026-09-15) — the half the old rule got backwards.
    //
    // The pre-S6 catch rethrew `ReferenceError` and `SyntaxError` by name and
    // swallowed EVERYTHING else, so the more unexpected the failure the more
    // certainly it was hidden: a `TypeError` from a bad field, an
    // `ERR_INVALID_ARG_TYPE` from a wrong argument, an error thrown by a
    // dependency — all read as "no checkpoint today". The rule is now the
    // other way round: swallow the fs-miss codes, propagate the rest. This
    // case fails against the old code by design.
    const tmpDir = mkdtempSync(join(tmpdir(), 'peaks-pcr-nonio-'));
    const sessionId = '2026-07-31-test-session';
    const runtimeDir = join(tmpDir, '.peaks', '_runtime', sessionId);
    mkdirSync(join(runtimeDir, 'checkpoints'), { recursive: true });
    writeFileSync(join(runtimeDir, 'checkpoints', 'cp-good.json'), '{"mode":"rd"}', 'utf8');
    __fsMocks.readFileSync = () => {
      throw new TypeError('cannot read properties of undefined (reading "utf8")');
    };
    try {
      await expect(
        detectPostCompactResume({
          sessionId,
          projectRoot: tmpDir,
          activeSkill: 'peaks-code',
        }),
      ).rejects.toThrow(TypeError);
    } finally {
      __fsMocks.readFileSync = null;
    }
  });
});