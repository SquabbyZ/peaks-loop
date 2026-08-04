// tests/unit/session/session-manager-path-canonicalize.test.ts
//
// Slice 2026-08-04-rid-001-path-canonicalize.
//
// Why this test file exists:
//   `readSessionFile` compared the stored `projectRoot` against the
//   caller-passed one with a strict `===`. On Windows Git Bash the two
//   forms differ cosmetically for the SAME directory —
//   `peaks workspace init` stores `C:\Users\...\peaks-loop`, and a Git
//   Bash caller passes `C:/Users/.../peaks-loop`. Strict equality said
//   "no session bound", `presence:set` failed closed with
//   `PEAKS_SESSION_NOT_BOUND`, and the statusline rendered a permanent
//   `peaks empty`.
//
//   These cases pin the canonicalization contract so a future refactor
//   that reintroduces `===` (or over-corrects into case-folding on
//   POSIX) fails loudly.
//
// Dimensions covered:
//   - behavior:    getSessionId returns the bound id across equivalent
//                  path spellings, and null across genuinely different
//                  roots (Case 4 regression).
//   - integration: the binding is a real file on a real tmp workspace;
//                  Case 3 exercises a real macOS symlink.
//   - render:      omitted — getSessionId returns a bare string|null,
//                  no formatted output surface.
//   - a11y:        omitted — no human-facing text in this module.

import { describe, expect, it, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { declareDimensions } from '../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../_setup/tmp-workspace.js';

declareDimensions(
  'tests/unit/session/session-manager-path-canonicalize.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'getSessionId returns string|null; no formatted output surface' },
    { dim: 'a11y', reason: 'no human-facing text in the session-manager read path' },
  ],
);

// Relative import rather than the `~/src/...` alias: that alias is
// defined in vitest.config.ts but NOT in tsconfig.json#paths, so the 52
// test files using it each report a TS2307 under `pnpm tsc --noEmit`.
// A relative specifier resolves under both, keeping this slice's tsc
// delta at zero.
import { getSessionId } from '../../../src/services/session/session-manager.js';

const SESSION_ID = '2026-08-04-session-139b31';

/**
 * Write a session binding whose stored `projectRoot` is EXACTLY
 * `storedProjectRoot`, under the `.peaks/_runtime/session.json` owned by
 * `bindingHome`.
 *
 * We write the JSON directly rather than going through
 * `setCurrentSessionBinding`, because that path now canonicalizes on
 * write — which would erase the very spelling difference each case is
 * built to exercise.
 */
function writeBinding(bindingHome: string, storedProjectRoot: string): void {
  const runtimeDir = join(bindingHome, '.peaks', '_runtime');
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(
    join(runtimeDir, 'session.json'),
    JSON.stringify(
      { sessionId: SESSION_ID, createdAt: '2026-08-04T02:23:03.502Z', projectRoot: storedProjectRoot },
      null,
      2,
    ),
    'utf8',
  );
}

describe('behavior — projectRoot canonicalization on read', () => {
  const ws = withTmpWorkspacePerTest('peaks-path-canon-');

  it.runIf(process.platform === 'win32')(
    'Case 1 (Windows separator): binding stored with backslashes is found when queried with forward slashes',
    () => {
      const root = ws().path;
      // The exact 4.0.9 production split: workspace init writes the
      // backslash form, Git Bash queries with the forward-slash form.
      const backslashForm = root.replace(/\//g, '\\');
      const forwardSlashForm = root.replace(/\\/g, '/') + '/';

      writeBinding(root, backslashForm);

      expect(getSessionId(forwardSlashForm)).toBe(SESSION_ID);
    },
  );

  it.runIf(process.platform === 'win32')(
    'Case 2 (Windows case-insensitive): binding stored mixed-case is found when queried lower-case',
    () => {
      const root = ws().path;
      const mixedCaseForm = root.replace(/\//g, '\\');
      // NTFS is case-insensitive, so this denotes the SAME directory.
      // Note realpathSync alone does NOT fold Windows case (it echoes
      // the caller's spelling) — this case is what forces the explicit
      // Windows-only toLowerCase in projectRootCompareKey.
      const lowerCaseForm = root.replace(/\\/g, '/').toLowerCase();

      writeBinding(root, mixedCaseForm);

      expect(getSessionId(lowerCaseForm)).toBe(SESSION_ID);
    },
  );

  it.runIf(process.platform === 'darwin')(
    'Case 3 (macOS symlink): binding stored under /private/var is found when queried via /var',
    () => {
      const root = ws().path;
      // On macOS the tmp workspace resolves under /private/var/folders/...,
      // while /var/folders/... is the symlinked spelling of the same dir.
      // Skip rather than assert if this workspace is not on that pair, so
      // the case never silently passes on an unrelated path shape.
      if (!root.startsWith('/private/var/')) return;
      const symlinkedForm = root.replace(/^\/private/, '');

      writeBinding(root, root);

      expect(getSessionId(symlinkedForm)).toBe(SESSION_ID);
    },
  );

  it('Case 4 (regression): a genuinely different project root still returns null', () => {
    const root = ws().path;
    const otherRoot = join(root, 'some-other-project');
    mkdirSync(otherRoot, { recursive: true });

    // Binding belongs to `root`, but we query as `otherRoot` — a real,
    // existing, DIFFERENT directory. Canonicalization must not widen far
    // enough to match it, or every cross-project check silently passes.
    writeBinding(otherRoot, root);

    expect(getSessionId(otherRoot)).toBeNull();
  });

  it('Case 4b (regression): sibling directories differing only by name do not collide', () => {
    const root = ws().path;
    const projectA = join(root, 'project-a');
    const projectB = join(root, 'project-b');
    mkdirSync(projectA, { recursive: true });
    mkdirSync(projectB, { recursive: true });

    writeBinding(projectB, projectA);

    expect(getSessionId(projectB)).toBeNull();
  });

  it('returns the bound id for the exact stored spelling (no regression on the happy path)', () => {
    const root = ws().path;
    writeBinding(root, root);

    expect(getSessionId(root)).toBe(SESSION_ID);
  });
});

describe('integration — binding file on a real workspace', () => {
  const ws = withTmpWorkspacePerTest('peaks-path-canon-io-');

  it('returns null when no binding file exists at all', () => {
    expect(getSessionId(ws().path)).toBeNull();
  });

  it('returns null when the binding file is malformed JSON', () => {
    const root = ws().path;
    const runtimeDir = join(root, '.peaks', '_runtime');
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(join(runtimeDir, 'session.json'), '{ broken json', 'utf8');

    expect(getSessionId(root)).toBeNull();
  });

  it('does not throw when the queried project root does not exist on disk', () => {
    // projectRootCompareKey falls back to resolveInputPath when
    // realpath fails; a non-existent root must read as "unbound",
    // never as a crash.
    const missing = join(ws().path, 'definitely-not-created');
    expect(() => getSessionId(missing)).not.toThrow();
    expect(getSessionId(missing)).toBeNull();
  });
});
