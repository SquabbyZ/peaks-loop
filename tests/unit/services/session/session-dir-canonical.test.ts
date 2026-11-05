// tests/unit/services/session/session-dir-canonical.test.ts
//
// Repo-wide static scan for the canonical per-session workspace path
// (slice 005-session-runtime-dir-regression + slice 012 "5th writer").
//
// History. This file was deleted in f17aa377 ("delete 559 legacy unit tests
// and reset vitest config") while six places still asserted it was live —
// the `getSessionDir.ts` docstring and five `.peaks/memory/` files. Rebuilt
// as **S5** (user decision UD-1): a separate commit, NOT part of the
// `peaks-web` acceptance.
//
// Three invariants:
//
//  (a) `getSessionDir(root, sid)` returns `<root>/.peaks/_runtime/<sid>`.
//
//  (b) A static scan over `src/**` flags any direct join of `.peaks` +
//      `sessionId` that does NOT route through `getSessionDir`. The
//      back-compat **read** sites are excluded by an explicit allow-list
//      (the bug is write-paths only). A second, SEPARATE allow-list covers
//      the one other legitimate shape: a session id that names a FILE inside
//      a git-TRACKED `.peaks/` tree, not a session runtime directory.
//
//  (c) A static scan over `skills/**` flags a session-scoped artifact path
//      (`<root>/.peaks/<sid>/...`, missing `_runtime/`) that a sub-agent
//      would follow verbatim. The 5th writer was the QA 3-way fan-out
//      contract `skills/bee/peaks-qa/references/qa-fanout-contract.md`,
//      which instructed sub-agents to write to `.peaks/<sid>/qa/...`
//      instead of `.peaks/_runtime/<sid>/qa/...`. Markdown is a writer in
//      spirit because the LLM follows it literally.
//
// Repairs applied when rebuilding, vs. `git show f17aa377^:<this file>`:
//
//  1. **The src scan could not fail for the bug class it exists for.** The
//     original matched only `join(..., '.peaks', sessionId)` — `sessionId`
//     as the FINAL argument. But the slice-005 regression wrote a *sub-path*
//     (`join(root, '.peaks', sessionId, 'qa', 'performance-findings.md')`),
//     i.e. `sessionId` mid-chain; its user-visible symptom was
//     `.peaks/<sid>/qa/performance-findings.md` at the project root. The
//     original pattern returned 0 hits on exactly the shape it was written
//     to catch. Now matches a `join(...)` chain that mentions `.peaks` and a
//     session-id token with the canonical `_runtime` segment missing in
//     between, wherever the token sits in the chain.
//  2. **The skills half could not see the bee tree.** The original walked
//     `skills/<skill>/references/*.md` — one level. The fan-out contracts
//     live at `skills/bee/<skill>/references/*.md`, two levels down. Now
//     walks `skills/**/*.md` recursively (161 files).
//  3. **The placeholder alternation was `<sid>` only**, although the
//     original's own comment claimed it handled `<sid>`, `<session-id>` and
//     `<sessionId>`. Widened to those three session-scoped shapes. Bare
//     `<id>` is deliberately NOT matched: it denotes a global SOP id
//     (`~/.peaks/sops/<id>/`), not a session, and matching it produced a
//     false positive at `skills/peaks-sop/references/sop-authoring.md:139`.
//  4. **Allow-list entries are now machine-checked to be load-bearing.** A
//     test asserts every `src/` entry actually suppresses a violation, so an
//     inert entry cannot accumulate (three entries in the original were
//     already dead). The two historical `skills/` entries were dropped
//     outright: later slices canonicalized both files, so the exemptions
//     only served to blind the scan to those paths.
//  5. **The slice-020 `PLATFORM_FALLBACKS.length === 1` assertion was
//     dropped.** The table was deleted in 4.0.8 by user decision C1
//     ("every caller resolution MUST go through the active IDE adapter").
//     The assertion pinned a contract the product deliberately reversed —
//     the code is right, the assertion was wrong. Unit coverage of caller
//     resolution lives in `caller-id-resolution.test.ts`.
//
// Dimensions covered:
//   - render:      the resolver's returned path shape
//   - behavior:    each scanner's accept/reject decision, on a tmp fixture
//   - integration: both scanners walk the real on-disk repo tree
//   - a11y:        OMITTED — no human-facing text or exit code in this surface

import { describe, expect, test } from 'vitest';
import { dirname, join } from 'node:path';
import { defaultStateRoot, sessionRuntimeDir } from 'peaks-loop-workspace-runtime';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { getSessionDir, tryGetSessionDir } from '~/src/services/session/getSessionDir';
import {
  ALLOWED_LEGACY_READ_PATHS,
  ALLOWED_LEGACY_SKILL_PATHS,
  ALLOWED_SRC_PATHS,
  ALLOWED_TRACKED_SESSION_ARTIFACT_PATHS,
  COMPOSITION_BASELINE,
  findDirectRuntimeComposition,
  findSessionDirJoinViolations,
  findSkillMarkdownLegacySessionPaths,
  inertEntries,
  listFiles,
  scanTree
} from './_session-dir-scans.js';

declareDimensions(
  'tests/unit/services/session/session-dir-canonical.test.ts',
  ['render', 'behavior', 'integration'],
  [{ dim: 'a11y', reason: 'static scans expose no human-facing text or exit code' }]
);

/** Build a throwaway tree containing exactly one deliberate violation each. */
function makeFixtureTree(): {
  root: string;
  srcFile: string;
  skillFile: string;
  compositionFile: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'peaks-scan-fixture-'));

  const srcFile = join(root, 'src', 'services', 'example', 'writer.ts');
  mkdirSync(join(root, 'src', 'services', 'example'), { recursive: true });
  // The slice-005 shape: a sub-path under the legacy dir, sessionId mid-chain.
  writeFileSync(
    srcFile,
    `const p = join(root, '.peaks', sessionId, 'qa', 'performance-findings.md');\n`,
    'utf8'
  );

  // Two levels deep on purpose: the original one-level walker could not see
  // `skills/bee/<skill>/references/`, which is where the fan-out lives.
  const skillFile = join(root, 'skills', 'bee', 'peaks-qa', 'references', 'fanout.md');
  mkdirSync(join(root, 'skills', 'bee', 'peaks-qa', 'references'), { recursive: true });
  writeFileSync(skillFile, `Write evidence at .peaks/<sid>/qa/test-reports/<rid>.md\n`, 'utf8');

  // Invariant (d): the hand-rolled runtime dir the two collapsed resolvers used.
  const compositionFile = join(root, 'src', 'services', 'example', 'hand-rolled.ts');
  writeFileSync(
    compositionFile,
    `const dir = join(projectRoot, '.peaks', '_runtime', sessionId);\n`,
    'utf8'
  );

  return { root, srcFile, skillFile, compositionFile };
}

describe('Scenario: render — canonical resolver shape (invariant a)', () => {
  test('when invoked, should compose <root>/.peaks/_runtime/<sessionId> only', () => {
    // given: a project root and a session id
    const root = join('repo', 'project');
    const sid = '2026-06-06-session-5b1095';
    // when: the resolver is asked for that session's directory
    const dir = getSessionDir(root, sid);
    // then: it ends in `.peaks/_runtime/<sid>` and NOT in the legacy
    //       `.peaks/<sid>` layout. The separator is not pinned: the path now
    //       comes from the package, which emits forward slashes on both hosts.
    expect(dir).toMatch(/[\\/]\.peaks[\\/]_runtime[\\/]2026-06-06-session-5b1095$/);
    expect(dir).not.toMatch(/[\\/]\.peaks[\\/]2026-06-06-session-5b1095$/);
  });

  test('when invoked, should delegate to the workspace-runtime package', () => {
    // given: a project root and a single-segment session id
    // when: the resolver and the package's entry are asked for the same dir
    // then: they are the same string, and the total entry answers the same
    const root = join('repo', 'project');
    const sid = '2026-06-06-session-5b1095';
    const fromResolver = getSessionDir(root, sid);
    const fromPackage = sessionRuntimeDir({ stateRoot: defaultStateRoot(root), sessionId: sid });
    expect(fromResolver).toBe(fromPackage);
    expect(tryGetSessionDir(root, sid)).toEqual({ ok: true, dir: fromPackage });
    // The resolver's own stricter guard still runs FIRST: the package would
    // accept nothing this rejects, but the reverse is not true.
    expect(() => getSessionDir(root, '..')).toThrow(/Invalid session id/);
  });
});

describe('Scenario: behavior — each scanner rejects a deliberate violation (invariant b + c)', () => {
  test('src scanner flags a legacy sub-path join (sessionId mid-chain)', () => {
    const { root, srcFile } = makeFixtureTree();
    try {
      const violations = findSessionDirJoinViolations(srcFile);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.line).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('when a file composes .peaks with _runtime, should flag it and accept the package entry', () => {
    // given: a fixture file that composes `.peaks` + `_runtime` by hand
    // when: the scanner reads it, then the same file is rewritten to delegate
    // then: the hand-rolled form is flagged at its line and the delegate is not
    const { root, compositionFile } = makeFixtureTree();
    try {
      const violations = findDirectRuntimeComposition(compositionFile);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.line).toBe(1);
      writeFileSync(
        compositionFile,
        `const dir = sessionRuntimeDir({ stateRoot: defaultStateRoot(projectRoot), sessionId });\n`,
        'utf8'
      );
      expect(findDirectRuntimeComposition(compositionFile)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('when a baseline entry suppresses nothing, should report it inert', () => {
    // given: one file that composes by hand and one that does not, both exempted
    // when: each entry is asked whether it suppresses a real composition
    // then: only the clean file is reported inert
    const { root, compositionFile } = makeFixtureTree();
    const cleanFile = join(dirname(compositionFile), 'clean.ts');
    writeFileSync(cleanFile, `const dir = getSessionDir(projectRoot, sessionId);\n`, 'utf8');
    const toRel = (abs: string): string =>
      abs.replace(/\\/g, '/').slice(root.replace(/\\/g, '/').length + 1);
    const baseline = [toRel(compositionFile), toRel(cleanFile)];
    try {
      const inert = inertEntries(baseline, findDirectRuntimeComposition, root);
      expect(inert).toEqual([toRel(cleanFile)]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('skills scanner flags a legacy .peaks/<sid>/ path but accepts the canonical form', () => {
    const { root, skillFile } = makeFixtureTree();
    try {
      const violations = findSkillMarkdownLegacySessionPaths(skillFile);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.line).toBe(1);

      writeFileSync(
        skillFile,
        `Write evidence at .peaks/_runtime/<sid>/qa/test-reports/<rid>.md\n`,
        'utf8'
      );
      expect(findSkillMarkdownLegacySessionPaths(skillFile)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('Scenario: integration — repo-wide static scans (invariant b + c)', () => {
  const root = process.cwd();

  test('no direct .peaks + sessionId join in src/ outside the resolver and allow-list', () => {
    const files = listFiles(join(root, 'src'), (name) => /\.(ts|mjs|js)$/.test(name));
    expect(files.length).toBeGreaterThan(0);
    expect(scanTree(root, files, findSessionDirJoinViolations)).toEqual([]);
  });

  test('no legacy session-scoped artifact path in skills/**/*.md', () => {
    const files = listFiles(join(root, 'skills'), (name) => name.endsWith('.md'));
    expect(files.length).toBeGreaterThan(0);
    expect(scanTree(root, files, findSkillMarkdownLegacySessionPaths)).toEqual([]);
  });

  test('when the repo is scanned, should find no direct .peaks + _runtime composition outside the baseline', () => {
    // given: every source file under src/
    // when: the composition scan walks them
    // then: nothing outside the published baseline is found
    const files = listFiles(join(root, 'src'), (name) => /\.(ts|mjs|js)$/.test(name));
    expect(files.length).toBeGreaterThan(0);
    expect(scanTree(root, files, findDirectRuntimeComposition)).toEqual([]);
  });

  test('when the baseline is checked, should find every entry present and load-bearing', () => {
    // given: the published ratchet baseline
    // when: each entry is probed against the real tree
    // then: it exists, and it still suppresses a composition
    expect(COMPOSITION_BASELINE.files.length).toBeGreaterThan(0);
    for (const rel of COMPOSITION_BASELINE.files) {
      expect(existsSync(join(root, rel)), rel).toBe(true);
    }
    // An inert entry is a hole: exempting a clean file only blinds the scan to
    // that path. Measured over the real tree, so an entry whose composition was
    // deleted must be removed from the baseline.
    expect(inertEntries(COMPOSITION_BASELINE.files, findDirectRuntimeComposition, root)).toEqual(
      []
    );
  });

  test('every src allow-list entry is load-bearing and its file still exists', () => {
    for (const rel of ALLOWED_SRC_PATHS) {
      const abs = join(root, rel);
      expect(existsSync(abs), rel).toBe(true);
      // Inert entries are a hole in the guard: exempting a clean file only
      // blinds the scan to that path. Every entry must suppress something.
      const unexempted = findSessionDirJoinViolations(abs, { applyAllowList: false });
      expect(unexempted.length, `${rel} is exempt but nothing was suppressed`).toBeGreaterThan(0);
      expect(findSessionDirJoinViolations(abs), rel).toEqual([]);
    }
  });

  // A file listed under BOTH reasons would mean one of the two reasons is false
  // for it, and the split would be decoration rather than a rule.
  test('when the two src allow-lists are compared, should name no file listed under both', () => {
    // given: the two allow-lists, each with its own reason
    // when: the overlap between them is computed
    // then: no file is listed under both reasons
    const legacy = new Set(ALLOWED_LEGACY_READ_PATHS);
    const tracked = ALLOWED_TRACKED_SESSION_ARTIFACT_PATHS.filter((rel) => legacy.has(rel));
    expect(tracked).toEqual([]);
  });

  test('every skills allow-list entry still exists (rename-rot guard)', () => {
    for (const rel of ALLOWED_LEGACY_SKILL_PATHS) {
      expect(existsSync(join(root, rel)), rel).toBe(true);
    }
  });
});
