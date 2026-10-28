// tests/unit/standards/runtime-root-scratch-guard.test.ts
//
// The guard behind the runtime-root rule: a FILE must not sit directly under
// `.peaks/_runtime/` unless the runtime-layout registry names it as a file the
// code writes there. Session directories are the only other legitimate tenants.
//
// WHY THIS FILE EXISTS. `.peaks/_runtime/` is the scope-axis root. A file there
// belongs to no session, so no session's cleanup reaches it. On 2026-10-28 six
// scratch files (`tmp-*.log`, `tmp-hs.err`, a `.ts` file) sat there, and nothing
// in the test gate could see them. `.peaks/_runtime/` is gitignored, so this
// guard cannot rely on CI: on a runner the directory is usually absent, and the
// guard then passes honestly because there is nothing to inspect.
//
// WHY IT REUSES THE CENSUS. `src/services/workspace/runtime-layout.ts` already
// owns the authoritative registry (`RUNTIME_SYSTEM_ENTRIES`, six file entries)
// and the pure census (`censusRuntimeRoot`) that the doctor check also uses.
// This file adds the vitest arm and the injection control; it adds no second
// list of allowed names, because a second list is the drift the registry's own
// comments warn about.
//
// NOTHING IS WRITTEN INTO THE REPOSITORY. Fixture trees live under
// `mkdtempSync(join(tmpdir(), ...))` and are removed by the test.
//
// Dimensions covered:
//   - behavior:    the stray-file, registered-file, session-dir and boundary cases
//   - integration: the real runtime root is clean (or absent), and an injected
//                  stray file turns the same reader red
//
// Dimensions omitted:
//   - a11y:        the operator-facing message is the doctor check's; it is
//                  asserted in tests/unit/doctor/l3-runtime-root-census.test.ts.
//   - render:      the guard returns names and renders no text of its own.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  censusRuntimeRoot,
  RUNTIME_SYSTEM_ENTRIES,
  type RuntimeRootRead
} from '../../../src/services/workspace/runtime-layout.js';

declareDimensions(
  'tests/unit/standards/runtime-root-scratch-guard.test.ts',
  ['behavior', 'integration'],
  [
    {
      dim: 'render',
      reason: 'the guard returns file names; it renders no text of its own'
    },
    {
      dim: 'a11y',
      reason:
        'the operator-facing message belongs to the doctor check, asserted in tests/unit/doctor/l3-runtime-root-census.test.ts'
    }
  ]
);

// The runtime tree is a working-directory concept, so the real root is resolved
// from cwd — NOT from the module location, which
// tests/unit/runtime/no-runtime-input-guard.test.ts' rule B refuses.
const REAL_RUNTIME_ROOT = join(process.cwd(), '.peaks', '_runtime');
const SESSION_DIR = '2026-10-28-session-2ffed0';

/** The six scratch files measured at the runtime root on 2026-10-28. */
const SCRATCH_NAMES = ['tmp-2fail.log', 'tmp-hs.err', 'tmp-reconcile.ts', 'tmp-smr.log'] as const;

/** Every file name the registry legitimises at the runtime root. */
const REGISTERED_FILES = RUNTIME_SYSTEM_ENTRIES.filter((entry) => entry.kind === 'file').map(
  (entry) => entry.name
);

let base: string;
let runtimeRoot: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'peaks-runtime-root-'));
  runtimeRoot = join(base, '.peaks', '_runtime');
  mkdirSync(runtimeRoot, { recursive: true });
});

afterEach(() => {
  try {
    rmSync(base, { recursive: true, force: true });
  } catch {
    // Windows open-handle race on the temp dir; it is reapable either way.
  }
});

/**
 * Read a runtime root from disk for the census.
 *
 * An absent root is an empty read, not an error: `.peaks/_runtime/` is
 * gitignored, so a CI runner has nothing there to inspect. A root that exists
 * but cannot be listed is `unreadable`, which the caller must not treat as clean.
 */
function readRuntimeRoot(dir: string): RuntimeRootRead {
  if (!existsSync(dir)) return { status: 'read', entries: [] };
  try {
    const entries = readdirSync(dir, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      kind: entry.isDirectory() ? ('dir' as const) : ('file' as const)
    }));
    return { status: 'read', entries };
  } catch (error) {
    return { status: 'unreadable', reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The file names at a runtime root that the census does not legitimise.
 *
 * Only files are reported here; a stray directory is the census's own concern.
 * An unreadable root THROWS: a guard that cannot look must not report "clean".
 */
function strayFiles(dir: string): readonly string[] {
  const census = censusRuntimeRoot({ read: readRuntimeRoot(dir) });
  if (census.status === 'undetermined') {
    throw new Error(`runtime root could not be read: ${census.reason}`);
  }
  if (census.status === 'clean') return [];
  return census.violations
    .filter((violation) => violation.kind === 'file')
    .map((violation) => violation.name)
    .sort();
}

/** Write a file directly under the fixture runtime root. */
function writeAtRoot(name: string, content = 'x\n'): void {
  writeFileSync(join(runtimeRoot, name), content, 'utf8');
}

describe('Scenario: behavior — the census names a stray file at the runtime root', () => {
  it('when scratch logs sit at the root, should report each one', () => {
    // given: the scratch names measured on 2026-10-28
    // when: the guard reads that root
    // then: every one is reported as a stray file
    for (const name of SCRATCH_NAMES) writeAtRoot(name);
    expect(strayFiles(runtimeRoot)).toEqual([...SCRATCH_NAMES]);
  });

  it('when only registered files and a session directory sit at the root, should report nothing', () => {
    // given: each registered file, and a session directory with a file in it
    // when: the guard reads that root
    // then: the tree is clean
    for (const name of REGISTERED_FILES) writeAtRoot(name);
    mkdirSync(join(runtimeRoot, SESSION_DIR));
    writeFileSync(join(runtimeRoot, SESSION_DIR, 'notes.md'), '# notes\n', 'utf8');
    expect(strayFiles(runtimeRoot)).toEqual([]);
  });

  it('when a session-shaped name is a file rather than a directory, should report it', () => {
    // given: a file wearing a session id as its name
    // when: the guard reads that root
    // then: it is a stray, since only a directory can be a session home
    writeAtRoot(SESSION_DIR);
    expect(strayFiles(runtimeRoot)).toEqual([SESSION_DIR]);
  });

  it('when a scratch file sits one directory below the root, should not report it', () => {
    // given: a scratch file inside a session directory
    // when: the guard reads the root
    // then: the boundary is the root itself, so it is out of reach
    mkdirSync(join(runtimeRoot, SESSION_DIR, 'rd'), { recursive: true });
    writeFileSync(join(runtimeRoot, SESSION_DIR, 'rd', 'tmp-hs.err'), '', 'utf8');
    expect(strayFiles(runtimeRoot)).toEqual([]);
  });

  it('when the runtime root is absent, should report nothing to inspect', () => {
    // given: no `.peaks/_runtime/` at all, as on a CI runner
    // when: the guard reads it
    // then: it passes, having nothing to inspect
    expect(strayFiles(join(base, 'no-such-runtime-root'))).toEqual([]);
  });

  it('when the runtime root cannot be listed, should throw rather than report clean', () => {
    // given: a path that exists but is a file, so it cannot be listed
    // when: the guard reads it
    // then: it throws, because "clean" is not an answer an unreadable tree may give
    const notADirectory = join(runtimeRoot, 'session.json');
    writeFileSync(notADirectory, '{}', 'utf8');
    expect(() => strayFiles(notADirectory)).toThrow(/could not be read/);
  });
});

describe('Scenario: integration — the real runtime root, and an injected control', () => {
  it('when the real runtime root is read, should hold no stray file', () => {
    // given: this checkout's `.peaks/_runtime/`, or none on a clean checkout
    // when: the guard reads it
    // then: no non-session, unregistered file sits at its root
    expect(strayFiles(REAL_RUNTIME_ROOT)).toEqual([]);
  });

  it('when scratch files are injected, should turn the arm red while a control stays silent', () => {
    // given: a control root holding only registered entries, and an injected
    //        root holding the same plus the scratch files
    // when: the guard reads both
    // then: the control is silent and the injected root is red on every scratch
    //       file — the arm is seen failing, not only ever seen passing
    const controlBase = mkdtempSync(join(tmpdir(), 'peaks-runtime-root-control-'));
    const controlRoot = join(controlBase, '.peaks', '_runtime');
    mkdirSync(controlRoot, { recursive: true });
    try {
      for (const name of REGISTERED_FILES) writeFileSync(join(controlRoot, name), 'x\n', 'utf8');
      for (const name of REGISTERED_FILES) writeAtRoot(name);
      for (const name of SCRATCH_NAMES) writeAtRoot(name);
      expect(strayFiles(controlRoot)).toEqual([]);
      expect(strayFiles(runtimeRoot)).toEqual([...SCRATCH_NAMES]);
    } finally {
      rmSync(controlBase, { recursive: true, force: true });
    }
  });
});
