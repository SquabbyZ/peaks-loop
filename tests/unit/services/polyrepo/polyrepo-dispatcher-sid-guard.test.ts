// tests/unit/services/polyrepo/polyrepo-dispatcher-sid-guard.test.ts
//
// Guards the sid→path join in `childArtifactPath` (slice follow-up on job
// `2026-09-14-meta-integrity-fixes`, session `2026-09-13-session-21878f`).
//
// The defect, measured 2026-09-14 before the guard existed: `--sid` was joined
// into each child's artifact path unvalidated, so
//   peaks polyrepo dispatch --sid '../../../../../../PWNED-SID-ESCAPE'
// wrote `<parent-of-fixture>/PWNED-SID-ESCAPE/prd/src.md` — above every project
// root — and reported `ok: true`. Same class as the traversal HIGH the round
// closed at `peaks evidence generate`; it was pre-existing, not a regression of
// that round.
//
// The assertions are deliberately not "the guard exists":
//   - AC1: the traversal sid is REFUSED and nothing lands outside the child
//   - AC2: a well-formed sid still dispatches (control — a guard that refuses
//          everything would also pass AC1 and is indistinguishable from this
//          one without it)
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { dispatchArtifact } from '../../../../src/services/polyrepo/polyrepo-dispatcher.js';
import type { PolyrepoManifest } from '../../../../src/services/polyrepo/polyrepo-types.js';

let root: string;
let childRoot: string;
let sourcePath: string;
let manifest: PolyrepoManifest;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-polyrepo-guard-'));
  childRoot = join(root, 'childA');
  mkdirSync(childRoot, { recursive: true });
  sourcePath = join(root, 'src.md');
  writeFileSync(sourcePath, '# probe artifact\n\nBODY\n');
  manifest = {
    version: 1,
    root,
    detectedAt: new Date().toISOString(),
    children: [
      { id: 'childA', path: childRoot, gitRoot: false, peaksScope: 'child-only', peaksInstalled: false }
    ]
  };
});

/** Where the traversal sid in this file would land if the guard were absent.
 *  Derived, not guessed — a guessed path cleans the wrong directory and leaves
 *  the real escape on disk (measured: the mutation run littered
 *  `%LOCALAPPDATA%/PWNED-SID-ESCAPE` while an assertion happily passed). */
function escapeTarget(): string {
  const seed = join(childRoot, '.peaks', '_runtime');
  return resolve(join(seed, '..', '..', '..', '..', '..', '..', 'PWNED-SID-ESCAPE'));
}

afterEach(() => {
  // Remove the fixture AND the tree the traversal would have created, so a
  // regression cannot leave junk on the machine between runs.
  rmSync(escapeTarget(), { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

function dispatch(sid: string) {
  return dispatchArtifact({
    manifest,
    sid,
    rid: '2026-09-14-probe',
    targets: ['childA'],
    artifact: { role: 'prd', path: sourcePath }
  });
}

describe('polyrepo dispatch — sid path-traversal guard', () => {
  it('refuses a traversal sid and writes nothing outside the child', () => {
    expect(existsSync(escapeTarget())).toBe(false);

    expect(() => dispatch('../../../../../../PWNED-SID-ESCAPE')).toThrow(/Invalid session id/);

    expect(existsSync(escapeTarget())).toBe(false);
    // The child's own session dir must not have been created either — the guard
    // sits before the first mkdir, so a rejected dispatch leaves nothing.
    expect(existsSync(join(childRoot, '.peaks'))).toBe(false);
  });

  it('refuses a backslash sid', () => {
    expect(() => dispatch('..\\..\\PWNED-SID-ESCAPE')).toThrow(/Invalid session id/);
  });

  it('still dispatches a well-formed sid (control — not vacuous)', () => {
    const result = dispatch('2026-09-13-session-21878f');
    expect(result.perChild[0]?.ok).toBe(true);
    const written = join(childRoot, '.peaks', '_runtime', '2026-09-13-session-21878f', 'prd', 'src.md');
    expect(result.perChild[0]?.mirroredTo).toBe(written);
    expect(existsSync(written)).toBe(true);
    expect(readFileSync(written, 'utf8')).toContain('BODY');
  });
});
