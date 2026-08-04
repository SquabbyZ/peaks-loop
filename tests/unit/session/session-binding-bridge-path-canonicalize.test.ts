// tests/unit/session/session-binding-bridge-path-canonicalize.test.ts
//
// Slice 2026-08-04-rid-002-bridge-canonicalize.
//
// Why this test file exists:
//   `src/services/session/session-binding-bridge.ts` was extracted from
//   `session-manager.ts` in v2.18.0 to keep that file under the Karpathy
//   800 LOC cap. The extraction moved the low-level `readSessionFile` /
//   `readSessionFileCanonical` / `writeSessionFile` private helpers
//   verbatim, but at that time those functions still used a strict
//   `===` `projectRoot` comparison (line 78 `readSessionFile`) and a
//   non-case-folded `resolveStoredAgainstCaller` compare (line 99
//   `readSessionFileCanonical`). Slice rid-001 fixed the same bug in
//   `session-manager.ts` (the readers retained there) but did NOT
//   touch the bridge copy, so Windows Git Bash callers still saw the
//   cascade error.
//
//   These cases pin the canonicalization contract on the bridge
//   private helpers — exercised via the public `ensureSession` (the
//   only user-facing entry that touches these primitives) — so a
//   future regression that reverts the bridge to `===` (or over-
//   corrects into case-folding on POSIX) fails loudly here.
//
// Dimensions covered:
//   - behavior:    ensureSession finds / writes bindings under any
//                  equivalent path spelling, and refuses to match a
//                  genuinely different project (Case 4 regression).
//   - integration: the binding is a real file on a real tmp workspace;
//                  Case 3 inspects the on-disk JSON written by
//                  writeSessionFile.
//   - render:      omitted — ensureSession returns string, no formatted
//                  output surface.
//   - a11y:        omitted — no human-facing text in the bridge write
//                  path.

import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { declareDimensions } from '../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../_setup/tmp-workspace.js';
import { ensureSession } from '../../../src/services/session/session-binding-bridge.js';
import { resolveInputPath, stableRealPath } from '../../../src/shared/path-utils.js';

declareDimensions(
  'tests/unit/session/session-binding-bridge-path-canonicalize.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'ensureSession returns string; no formatted output surface' },
    { dim: 'a11y', reason: 'no human-facing text in the bridge write path' },
  ],
);

const SESSION_ID = '2026-08-04-session-139b31-rid2';

/**
 * Write a session binding whose stored `projectRoot` is EXACTLY
 * `storedProjectRoot`, under the canonical `.peaks/_runtime/session.json`.
 *
 * Direct writeFileSync (not via `setCurrentSessionBinding`) because that
 * path canonicalizes on write — which would erase the very spelling
 * difference each case is built to exercise.
 */
function writeBinding(bindingHome: string, storedProjectRoot: string): void {
  const runtimeDir = join(bindingHome, '.peaks', '_runtime');
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(
    join(runtimeDir, 'session.json'),
    JSON.stringify(
      { sessionId: SESSION_ID, createdAt: '2026-08-04T02:30:00.000Z', projectRoot: storedProjectRoot },
      null,
      2,
    ),
    'utf8',
  );
}

describe('behavior — bridge readSessionFile path spelling', () => {
  const ws = withTmpWorkspacePerTest('peaks-bridge-canon-');

  it.runIf(process.platform === 'win32')(
    'Case 1 (Windows separator): bridge finds binding stored with backslashes when queried with forward slashes',
    async () => {
      const root = ws().path;
      // The tmp dir on Windows hosts has no `/` separator at all, so a
      // naive `replace(/\//g, '\\')` is a no-op. Use a distinguishable
      // forward-slash form by replacing EACH `\` with `/` (NOT a no-op)
      // and bumping a trailing character so the strict-`===` mutation
      // cannot accidentally match — they always differ in both separator
      // and trailing char.
      const backslashForm = root + '\\';
      const forwardSlashForm = root.replace(/\\/g, '/') + '/';

      writeBinding(root, backslashForm);

      const sessionId = await ensureSession(forwardSlashForm);
      expect(sessionId).toBe(SESSION_ID);
    },
  );

  it.runIf(process.platform === 'win32')(
    'Case 2 (Windows case-insensitive): bridge finds a binding stored mixed-case when queried lower-case',
    async () => {
      const root = ws().path;
      const mixedCaseForm = root;
      // Lowercase the whole path — different from mixedCaseForm on both
      // the case axis AND (because realpathSync echoes case on win32)
      // the compareKey axis. Strict `===` cannot match.
      const lowerCaseForm = root.replace(/\\/g, '/').toLowerCase();

      writeBinding(root, mixedCaseForm);

      const sessionId = await ensureSession(lowerCaseForm);
      expect(sessionId).toBe(SESSION_ID);
    },
  );

  it('Case 3 (write contract): bridge.writeSessionFile persists stableRealPath form, not the caller-passed spelling', async () => {
    const root = ws().path;
    // Pass a form that IS NOT byte-equal to stableRealPath(root). On
    // Windows tmp dirs the host path (e.g. C:\Users\SMALLM~1\...) and
    // the realpath form may already match, so append a `/.\seg` to force
    // a divergence: stableRealPath on `root/.` returns the canonical
    // `root`, so the canonicalized stored form MUST equal `stableRealPath(root)`
    // — but the raw caller-supplied `root/` would not (it has the trailing
    // separator). On POSIX, callers pass `join(resolveInputPath(root), '.')`
    // which canonicalizes to the same `root` either way, so POSIX Case 3
    // additionally forces a relative-vs-absolute mismatch via the
    // resolveInputPath path prefix.
    const inputForm = process.platform === 'win32'
      ? root + '\\.'
      : join(resolveInputPath(root) + '/');
    const expectedCanonical = stableRealPath(root);

    const sessionId = await ensureSession(inputForm);
    expect(sessionId).toMatch(/^\d{4}-\d{2}-\d{2}-session-[a-f0-9]+$/);

    const bindingPath = join(root, '.peaks', '_runtime', 'session.json');
    const raw = readFileSync(bindingPath, 'utf8');
    const parsed = JSON.parse(raw) as { sessionId: string; projectRoot: string };
    expect(parsed.sessionId).toBe(sessionId);
    expect(parsed.projectRoot).toBe(expectedCanonical);
  });

  it('Case 4 (regression): a genuinely different project root still returns null', async () => {
    const root = ws().path;
    const projectA = join(root, 'project-a');
    const projectB = join(root, 'project-b');
    mkdirSync(projectA, { recursive: true });
    mkdirSync(projectB, { recursive: true });

    // Put projectA's binding at projectB's binding path. The stored
    // projectRoot names projectA, the caller passes projectB. Same
    // physical location on disk (a same-child-path forgery), but the
    // canonicalized project roots differ — projectRootsMatch must
    // reject this so cross-project checks still fail closed. If the
    // canonicalization widens, ensureSession would auto-generate on
    // projectB and the binding at projectB/.peaks/_runtime/session.json
    // would have projectRoot: <canonical of A>, which this test would
    // catch via the SESSION_ID mismatch on read.
    writeBinding(projectB, projectA);

    const sessionId = await ensureSession(projectB);
    expect(sessionId).not.toBe(SESSION_ID);
    expect(sessionId).toMatch(/^\d{4}-\d{2}-\d{2}-session-[a-f0-9]+$/);
  });
});
