// tests/unit/standards/doc-claim-corrections.test.ts
//
// The two claims `rid-t1-doc-claim-corrections` corrected, locked.
//
// WHY THIS FILE EXISTS. That slice changed prose only: a backlog entry that
// repeated a stale claim about how a unit suite fails when the repo-root
// `dist/` is missing, and a doc comment that stated a property of the
// Code-Gate's fallback more broadly than the property holds. A prose fix
// leaves nothing that can rot back — the next writer sees a correct sentence
// and cannot tell it from one that was always correct. So both claims are
// pinned here, where a change to either one turns a test red.
//
// (A) THE MISSING-ROOT-BUILD FAILURE IS DIRECTED. The shared guard
//     `tests/unit/_setup/root-dist-prerequisite.ts` throws a message that
//     names the missing path and the remedy (`pnpm build`), and the two unit
//     files that consume the root build WIRE it: the directed failure is in
//     the failure path, not merely available in a helper nobody calls.
//
// (B) THE REWORDED DOC COMMENT STATES EXACTLY WHAT IS TRUE. The
//     one-directional property in `src/services/hooks/hook-payload-cwd.ts` is
//     scoped to the base being the call's own directory, the comment says so,
//     and it says the direction is NOT a general property of the fallback.
//
// NOTHING IS WRITTEN INTO THE REPOSITORY. The one fixture tree is built under
// `mkdtempSync(join(tmpdir(), ...))` and removed by the test.
//
// Dimensions covered:
//   - behavior:    the guard throws the directed message, and returns the path
//                  when the build output is there
//   - integration: both real consumers wire a directed missing-build failure,
//                  and the module that carries the reworded comment is read
//   - a11y:        the failure names the path AND the remedy; the comment names
//                  the condition the property needs
//
// Dimensions omitted:
//   - render:      this guard prints nothing of its own; the reader-visible
//                  text is the thrown message and the doc comment, both
//                  judged under a11y.

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { assertBuiltPath } from '../_setup/root-dist-prerequisite.js';

declareDimensions(
  'tests/unit/standards/doc-claim-corrections.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason: 'the guard prints no output of its own; the reader-visible text is the thrown message'
    }
  ]
);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The build output the tarball suite reads out of the repo root. */
const CODEGRAPH_BUILD_DIR = 'dist/services/codegraph';

/** The two unit files that consume the repo-root build output. */
const TARBALL_SUITE = 'tests/unit/cli/verify-codegraph-tarball.test.ts';
const STATUSLINE_SUITE = 'tests/unit/cli/statusline-cli-integration.test.ts';

/** The module whose doc comment this slice reworded. */
const HOOK_PAYLOAD_CWD = 'src/services/hooks/hook-payload-cwd.ts';

/** The bare-assertion shape the corrected claim was about. */
const BARE_ASSERTION = 'expected 1 to be';

/**
 * The tarball suite's shape BEFORE the 2026-10-19 fix (`rid-root-dist-prereq`):
 * the AC1 arm asserts on the script's exit code and nothing else, so a missing
 * root build reached a bare assertion diff instead of a directed failure.
 */
const PRE_FIX_TARBALL_SHAPE = [
  "import { describe, expect, it } from 'vitest';",
  "describe('verify-codegraph-tarball (rid-CG-005)', () => {",
  "  it('exits 0 when the package ships the build output', () => {",
  '    const result = runVerify(projectRoot);',
  '    expect(result.status).toBe(0);',
  '  });',
  '});'
].join('\n');

/** A repo-root-relative file, read as UTF-8. */
function repoFile(rel: string): string {
  return readFileSync(join(REPO_ROOT, ...rel.split('/')), 'utf8');
}

/**
 * The doc block of `resolveToolCallBaseDir` — the one this slice reworded.
 * Reading the block rather than the whole file keeps a match elsewhere in the
 * module from satisfying a claim about the comment.
 */
function resolveToolCallBaseDirDoc(): string {
  const source = repoFile(HOOK_PAYLOAD_CWD);
  const fnAt = source.indexOf('export function resolveToolCallBaseDir');
  if (fnAt < 0) throw new Error(`${HOOK_PAYLOAD_CWD} no longer declares resolveToolCallBaseDir`);
  const openAt = source.lastIndexOf('/**', fnAt);
  const closeAt = source.indexOf('*/', openAt);
  if (openAt < 0 || closeAt < 0) {
    throw new Error('the doc block of resolveToolCallBaseDir was not found');
  }
  return source.slice(openAt, closeAt + 2);
}

/**
 * The doc block as one line of prose: the block markers and each line's
 * leading `*` are dropped and the wrapping is collapsed — a prose claim is a
 * sentence, not a line, so re-wrapping the comment must not change a verdict.
 */
function unwrapped(doc: string): string {
  return doc
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\*+\s?/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Does this consumer wire a DIRECTED missing-build failure?
 *
 * Two shapes count: a call to the shared guard, or a thrown Error whose
 * message names the remedy. A suite that only asserts on an exit code wires
 * neither — that is the pre-fix shape, and this detector rejects it.
 */
function wiresDirectedMissingBuild(source: string): boolean {
  return (
    source.includes('assertBuiltPath(') ||
    (source.includes('throw new Error(') && source.includes('pnpm build'))
  );
}

// ── behavior: the guard throws a directed message ─────────────────────────────

describe('Scenario: behavior — a missing build path is a directed failure', () => {
  it('when the build output is missing, should name the missing path and the build command', () => {
    // given: a temp root that holds no build output
    // when: the shared guard is asked for the missing build path
    // then: the message names the missing path and the remedy
    const root = mkdtempSync(join(tmpdir(), 'peaks-doc-claim-'));
    try {
      let message = '';
      try {
        assertBuiltPath(root, CODEGRAPH_BUILD_DIR);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain('Prerequisite missing:');
      expect(message).toContain(join(root, 'dist', 'services', 'codegraph'));
      expect(message).toContain('Run "pnpm build"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('when the build output exists, should return it, so the guard is not a constant throw', () => {
    // given: a temp root that holds the build output
    // when: the shared guard is asked for that build path
    // then: it returns the path instead of throwing
    const root = mkdtempSync(join(tmpdir(), 'peaks-doc-claim-'));
    try {
      const expected = join(root, 'dist', 'services', 'codegraph');
      mkdirSync(expected, { recursive: true });
      expect(assertBuiltPath(root, CODEGRAPH_BUILD_DIR)).toBe(expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── integration: the directed failure is wired, not merely available ─────────

describe('Scenario: integration — the directed failure is wired into the consumers', () => {
  it('when the tarball suite is read, should call the shared guard before its own assertion', () => {
    // given: the tarball suite's source
    // when: the guard call and the AC1 assertion are located
    // then: the guard is imported, called with the real root, and called first
    const source = repoFile(TARBALL_SUITE);
    expect(source).toContain("from '../_setup/root-dist-prerequisite.js'");
    const guardAt = source.indexOf('assertBuiltPath(projectRoot, CODEGRAPH_BUILD_DIR)');
    const assertionAt = source.indexOf('expect(result.status).toBe(0)');
    expect(guardAt).toBeGreaterThan(-1);
    expect(assertionAt).toBeGreaterThan(-1);
    expect(guardAt, 'the directed failure must come before the bare assertion').toBeLessThan(
      assertionAt
    );
  });

  // NOTE: the statusline suite does NOT call the shared guard — it throws the
  // same sentence from its own `resolveDistEntry()`, which is what the shared
  // helper's own header records. The claim under test is that BOTH consumers
  // wire a directed failure, not that both call one helper.
  it('when the statusline suite is read, should wire a directed missing-build failure of its own', () => {
    // given: the statusline suite's source
    // when: the missing-build failure it throws is located
    // then: the sentence names what is missing and the remedy
    const source = repoFile(STATUSLINE_SUITE);
    expect(source).toContain('Could not resolve dist/cli/index.js from');
    expect(source).toContain('Run "pnpm build" in the repo root before running this test.');
  });

  it('when the wiring is judged, should reject the pre-fix shape and accept both consumers', () => {
    // given: the pre-fix tarball shape and the two real consumers
    // when: the wiring detector reads each of them
    // then: the pre-fix shape is rejected and both consumers are accepted
    expect(wiresDirectedMissingBuild(PRE_FIX_TARBALL_SHAPE)).toBe(false);
    expect(wiresDirectedMissingBuild(repoFile(TARBALL_SUITE))).toBe(true);
    expect(wiresDirectedMissingBuild(repoFile(STATUSLINE_SUITE))).toBe(true);
  });
});

// ── a11y: the failure and the comment both name what the reader needs ───────

describe('Scenario: a11y — the failure and the comment say what is true', () => {
  it('when the build output is missing, should not read as a bare assertion', () => {
    // given: a temp root that holds no build output
    // when: the shared guard is asked for the missing build path
    // then: the message is a directed one, not the bare assertion diff
    const root = mkdtempSync(join(tmpdir(), 'peaks-doc-claim-'));
    try {
      let message = '';
      try {
        assertBuiltPath(root, CODEGRAPH_BUILD_DIR);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toContain(BARE_ASSERTION);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('when the module comment is read, should not claim the fallback error is one-directional outright', () => {
    // given: the doc block of resolveToolCallBaseDir
    // when: the pre-change unqualified claim is looked for
    // then: it is gone — the sentence was scoped, not deleted
    const doc = unwrapped(resolveToolCallBaseDirDoc());
    expect(doc).not.toContain('and the error is one-directional');
    expect(doc).not.toContain('It is never the other way round');
    expect(doc).not.toContain('the trade the gate makes everywhere else');
  });

  it('when the module comment is read, should scope the claim to the base being the call directory', () => {
    // given: the doc block of resolveToolCallBaseDir
    // when: the scoped qualifier is looked for
    // then: it names the condition the property needs and the counter-case
    const doc = unwrapped(resolveToolCallBaseDirDoc());
    expect(doc).toContain('While the base the path is read against IS the call');
    expect(doc).toContain('NOT a general property of the fallback');
    expect(doc).toContain('can be ALLOWED');
  });
});
