// tests/unit/hooks/presence-marker-detector.test.ts
//
// 4-dimension unit test for src/services/hooks/presence-marker-detector.ts.
//
// Slice 2026-07-31-rid-presence-marker-silent-catch-sweep narrows two silent
// catches inside the file-local `readPresenceFile` helper:
//
//   catch #1  readFileSync(absolutePath, 'utf8')  — was `catch { return null }`
//   catch #2  JSON.parse(raw)                     — was `catch { return null }`
//
// Pre-rid the JSON.parse catch would SILENTLY swallow SyntaxError from a
// broken `.peaks/_runtime/active-skill.json`, so a corrupt marker file made
// `detectPresenceMarker` quietly return `{ active: false }` instead of
// surfacing the corruption. This is the exact same anti-pattern that hid
// rid-001-r1 (`require is not defined` ReferenceError) and rid-001-r3 (broken
// `~/.claude/statusline-state.json` SyntaxError) until production.
//
// Post-rid both catches re-throw `ReferenceError` / `SyntaxError` to the
// caller (so a future corrupt-marker-file regression fails loudly) while
// still swallowing IO errors (`ENOENT`, `EACCES`, …) — the original
// "presence not found" semantic.
//
// We drive the public `detectPresenceMarker` export rather than break the
// file-local `readPresenceFile` symbol loose, because the file-local helper
// is not part of the package surface and exposing it just for testing would
// create fake-green backwards-compat pressure.
//
// Dimensions covered:
//   - render:     not applicable — no user-visible text in this module
//   - behavior:   SyntaxError from broken JSON surfaces, IO error returns null
//   - integration: real fs read of synthetic `.peaks/_runtime/active-skill.json`
//                  and tmp-missing project root
//   - a11y:       not applicable — no user-visible text in this module
//
// Run with: pnpm vitest run tests/unit/hooks/presence-marker-detector.test.ts

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';

// Slice 2026-07-31-rid-presence-marker-silent-catch-sweep needs to verify
// that an IO error raised inside the readFileSync try block is STILL
// silently swallowed (the original "presence not found" semantic must be
// preserved), while a SyntaxError from JSON.parse SURFACES. ESM module
// namespaces are frozen, so `vi.spyOn(fsModule, 'readFileSync')` fails at
// runtime with "Cannot redefine property: readFileSync" — the same
// constraint already documented in rid-001-r2.
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
const { detectPresenceMarker } = await import('../../../src/services/hooks/presence-marker-detector.js');

declareDimensions(
  'tests/unit/hooks/presence-marker-detector.test.ts',
  ['behavior', 'integration'],
  [
    {
      dim: 'render',
      reason: 'no user-visible text in this module; the public surface is a typed return object only',
    },
    {
      dim: 'a11y',
      reason: 'no user-visible text in this module; this file is consumed by hooks, not rendered for humans',
    },
  ],
);

const SAMPLE_MESSAGE_WITH_MARKER = [
  'Peaks-Loop Skill: peaks-code | Peaks-Loop Gate: rd-running | Next: write tests',
].join('\n');

// Slice 2026-07-31-rid-presence-marker-silent-catch-sweep narrows the
// silent catches in `readPresenceFile`. Pre-rid they swallowed ALL errors
// (including ReferenceError, SyntaxError) which would have hidden the
// rid-001-r1 ESM `require is not defined` regression if the same shape
// ever applied to the marker file.
//
// The tests below pin both halves of the contract from the public surface:
//
//   Case A: SyntaxError from JSON.parse on broken active-skill.json bubbles
//           up through detectPresenceMarker (NOT swallowed → caller sees
//           the corruption).
//   Case B: IO error (EACCES-style) raised by readFileSync against an
//           existing marker file is STILL swallowed (backward-compat:
//           presence-not-found semantic preserved when the file is unreadable).
describe("Scenario: behavior — readPresenceFile catch narrows to IO errors only", () => {
  it("when invoked, should Case A: SyntaxError from broken active-skill.json surfaces to caller (NOT swallowed)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    // Build a tmp project with the canonical presence marker path containing
    // INVALID JSON. existsSync returns true → readFileSync runs → JSON.parse
    // throws SyntaxError. Post-rid the catch MUST re-throw instead of
    // returning null — this is the same anti-fake-green contract pinned by
    // rid-001-r2 for readClaudeTranscriptFallback and rid-001-r3 for
    // readClaudeStatuslinePercent.
    const tmpDir = mkdtempSync(join(tmpdir(), 'peaks-presence-syntax-'));
    mkdirSync(join(tmpDir, '.peaks', '_runtime'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.peaks', '_runtime', 'active-skill.json'),
      '{ this is not valid JSON :: ',
      'utf8',
    );
    try {
      expect(() =>
        detectPresenceMarker({
          project: tmpDir,
          latestAssistantMessage: SAMPLE_MESSAGE_WITH_MARKER,
        }),
      ).toThrow(SyntaxError);
    } finally {
      // tmp cleanup is best-effort — OS will reap on next boot
    }
  });

  it("when invoked, should Case B: IO error from readFileSync against existing marker file returns active=false (still swallowed)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    // Backward-compat: the original "presence not found" semantic MUST be
    // preserved for genuine IO failures (EACCES on a read-protected marker
    // file). We simulate an IO error by handing the hoisted `__fsMocks`
    // bag a fake readFileSync that throws a plain Error (not
    // ReferenceError / SyntaxError) — the narrow catch must let plain
    // IO errors through to `return null` so detectPresenceMarker returns
    // { active: false } instead of crashing the hook.
    const tmpDir = mkdtempSync(join(tmpdir(), 'peaks-presence-io-'));
    mkdirSync(join(tmpDir, '.peaks', '_runtime'), { recursive: true });
    writeFileSync(
      join(tmpDir, '.peaks', '_runtime', 'active-skill.json'),
      '{"skill":"peaks-code"}',
      'utf8',
    );
    __fsMocks.readFileSync = () => {
      throw new Error('EACCES: permission denied');
    };
    try {
      const out = detectPresenceMarker({
        project: tmpDir,
        latestAssistantMessage: SAMPLE_MESSAGE_WITH_MARKER,
      });
      // IO error path → presence is "not active" (no warning, no marker)
      expect(out.active).toBe(false);
      expect(out.markerFound).toBe(false);
    } finally {
      __fsMocks.readFileSync = null;
    }
  });
});
