// tests/unit/standards/repo-citation-integrity.test.ts
//
// Reference-integrity guard: every repo-relative path written in backticks in
// the normative documents must resolve on disk.
//
// WHY. When a cited file is deleted, the citation that points at it does not
// change: it keeps reading exactly like a live one. Three such citations
// survived in this repo for weeks —
//   - `CLAUDE.md` + `.peaks/PROJECT.md` cited a vitest guard deleted in
//     `457b9a87` as a live enforcement layer ("will fail the suite");
//   - `.peaks/standards/loop-engineering-guidelines.md` cited its own deleted
//     test as "exercised by";
//   - the same file cited a design spec retired in `e6e35842` as "Inherits
//     from".
// Nothing in the suite could notice any of them. This guard is the notice.
//
// SCOPE (deliberately bounded). Corpus: `CLAUDE.md`, `.peaks/PROJECT.md`,
// `README.md`, every `*.md` under `.peaks/standards/`, and every `*.md` under
// `skills/`. Not in scope: memory files and `CHANGELOG.md`-style prose — those
// describe historical state, so a repo-root resolution would report false
// positives and the guard would be trained away.
//
// `skills/**` joined the corpus after `de0872b7` moved nine skills into
// `skills/bee/` without updating the paths that pointed at them: the citations
// kept reading like live ones and nothing noticed. A skill document cites paths
// two ways — repo-root-relative, and relative to its own directory
// (`references/x.md`, `../peaks-rd/references/x.md`) — so a candidate resolves
// if EITHER the repo root or the citing file's own directory contains it. That
// is a resolution rule, not an allowlist: it is the same "resolve it and see"
// test the root-relative case always used, applied from the second natural
// origin.
//
// A candidate is a backtick span that (a) looks like a path — slash-separated
// segments, no spaces, no `<placeholder>`, no glob — and (b) either carries a
// file extension or sits under a repo-root anchor directory. That pair of rules
// is what separates a path citation from `TODO/FIXME/XXX` (a category label) and
// `pnpm/action-setup@v4` (a GitHub Action ref, excluded by the `@`).
//
// Three classes are exempt by construction, not by an allowlist:
//   - runtime state under `.peaks/` — gitignored session state, plus the cron
//     and arbitration-cache subtrees the CLI writes (`RUNTIME_STATE_PREFIXES`);
//   - the workspace-relative abbreviation of the same thing — `rd/tech-doc.md`
//     for `.peaks/_runtime/<sessionId>/rd/tech-doc.md` (see
//     `SESSION_WORKSPACE_DIRS`);
//   - anything the root `.gitignore` matches is by definition a path git is
//     told never to track, so the tree is not required to contain it
//     (e.g. `.peaks/preferences.json`).
// The one literal exemption is `OPTIONAL_RUNTIME_PATHS`, each entry carrying
// its reason.
//
// PRECISION. Teaching `skills/**` to this guard (N2) reported 178 dangling
// citations for 64 files; 85 survived the first pass, and most of those were
// not citations at all. A guard that reports shapes and foreign paths as
// missing files trains its reader to ignore it, so the candidate rule now
// excludes five non-citation classes by construction — each in `isCandidate`
// with its reason:
//   - a path *family* (`src/...`, `openspec/changes/...`) names no file;
//   - a `./`-prefixed path belongs to the *consuming* project's root;
//   - a path inside a `<…>` fill-in is template text;
//   - a path introduced by an illustration cue (`e.g.`, `reference shape`) is
//     a shape for the consumer to reproduce, not a claim about this tree;
//   - a path with no repo-root anchor is document-relative and must hang off
//     the citing document's own neighbourhood — the repo root is NOT an origin
//     for it, because writing a repo-root path is what the anchors are for
//     (`isDocumentRelative`).
// None of these can hide a real regression: a citation of a deleted file in
// any of those five shapes was never resolvable from this repo's root to begin
// with. What they must not do is hide an *anchored* citation, and none does.
//
// Dimensions covered:
//   - behavior:    the pure checker flags a dangling citation and clears a
//                  resolvable one (both controls live in this file, so the
//                  guard cannot pass by being unable to fail)
//   - integration: the real corpus is read off the real working tree
//   - render:      OMITTED — the checker returns data, it renders nothing
//   - a11y:        OMITTED — no human-facing surface; findings are reported
//                  through the assertion message

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/standards/repo-citation-integrity.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'the checker returns findings; it renders nothing' },
    { dim: 'a11y', reason: 'no human-facing surface; findings surface in the assertion message' },
  ],
);

const REPO_ROOT = resolve(__dirname, '..', '..', '..');

/** The normative documents that cite repo paths. */
const CORPUS_ENTRIES = ['CLAUDE.md', '.peaks/PROJECT.md', 'README.md'] as const;
const CORPUS_DIRS = ['.peaks/standards', 'skills'] as const;

/**
 * First segments of a citation that names a file in the per-session workspace
 * rather than in the repository. The normative form of such a path is
 * `.peaks/_runtime/<sessionId>/rd/tech-doc.md`, which the two rules above
 * already exempt (the `<placeholder>` shape test, and the `.peaks/_runtime/`
 * prefix test); the skill documents routinely abbreviate it to the
 * workspace-relative suffix, `rd/tech-doc.md`. Exempting the abbreviation is
 * the same exemption, not a new one — and it cannot mask a repository path,
 * because a citation that resolves against the tree is cleared before this
 * rule is ever consulted for it (see `findDanglingCitations`).
 */
const SESSION_WORKSPACE_DIRS = new Set(['prd', 'rd', 'qa', 'sc', 'txt', 'audit', 'ui', 'session', 'system']);

/** A backtick span must look like this to be treated as a path citation. */
const PATH_SHAPED = /^[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)+$/;
const REPO_ANCHORS = /^(\.peaks|\.claude|\.github|src|tests|docs|scripts|skills|packages|bin|openspec)\//;
const BACKTICK_SPAN = /`([^`\n]+)`/g;

/**
 * `.peaks/` state the CLI writes into a project, as opposed to files the
 * repository tracks. All of it is absent from a clean checkout by design, so a
 * document naming a file inside one is not claiming the tree holds it:
 *   - `_runtime/` — per-session artifacts, gitignored;
 *   - `cron/`     — the scheduler's `schedule.json` / `scheduler.pid`
 *                   (`src/cli/commands/cron-commands.ts`);
 *   - `cache/`    — the arbitration cache; `cross-pass-edge-merger.ts` defaults
 *                   `opts.cacheDir` to `.peaks/cache/arbitrator`.
 */
const RUNTIME_STATE_PREFIXES = ['.peaks/_runtime/', '.peaks/cron/', '.peaks/cache/'] as const;

/**
 * A segment that is exactly an ellipsis names a path *family*
 * (`src/...`, `openspec/changes/...`), not a file: there is nothing on disk
 * for it to resolve to, so "it does not exist" is not a finding.
 */
const ELLIPSIS_SEGMENT = /(?:^|\/)\.\.\.(?:$|\/)/;

/**
 * Stems that name a shape rather than a file. `src/services/foo.ts` in a table
 * of hard-blocked path *families* is illustrating `src/`; no repository owes
 * anyone a file called `x.ts`.
 */
const SYNTHETIC_STEMS = new Set(['x', 'y', 'z', 'foo', 'bar', 'baz', 'qux', 'example', 'sample', 'dummy', 'placeholder']);

/**
 * Text that introduces a path as a shape to copy into the consumer's own
 * repository, e.g. "exactly one mapper file (e.g. `mappers/user.mapper.ts`)".
 * Such a path is not a claim that this tree contains it.
 */
const ILLUSTRATION_CUE = /(?:e\.g\.|i\.e\.|for example|such as|reference shape|Example:)\s*\(?\s*$/i;

/**
 * Paths that are documented by design and legitimately absent from a checkout.
 * Each entry needs a reason; an allowlist without one is how a guard dies.
 */
const OPTIONAL_RUNTIME_PATHS = new Set([
  // Legacy fallback location of the active-skill marker. `.peaks/PROJECT.md`
  // and `CLAUDE.md` both document the lookup as canonical-first; the canonical
  // path is `.peaks/_runtime/active-skill.json`, so this one is absent in a
  // clean clone by design.
  '.peaks/.active-skill.json',
  // Legacy fallback location of the session binding file — the same shape as
  // the entry above. `peaks session` reads the canonical
  // `.peaks/_runtime/session.json` and falls back to this dotfile;
  // `src/cli/commands/core/session-command.ts` calls it "the legacy back-compat
  // path". It is in neither `.gitignore` nor most working trees, so without
  // this entry the guard would require the tree to hold a file the runtime no
  // longer writes.
  '.peaks/.session.json',
]);

/** Every markdown file in the corpus, absolute paths, repo-relative order. */
export function corpusFiles(repoRoot: string): string[] {
  const files: string[] = CORPUS_ENTRIES.map((rel) => join(repoRoot, rel)).filter((abs) => existsSync(abs));
  const walk = (relDir: string): void => {
    const absDir = join(repoRoot, relDir);
    if (!existsSync(absDir)) return;
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const rel = `${relDir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith('.md')) files.push(join(repoRoot, rel));
    }
  };
  for (const dir of CORPUS_DIRS) walk(dir);
  return files;
}

/**
 * A bare `tests/**\[.test.ts]` path in prose or in a comment — a citation the
 * backtick rule cannot see.
 *
 * MEASURED, not assumed. Over the comment text of every file under `scripts/`,
 * this pattern names 3 paths and all 3 dangle (`sync-version.mjs:80`,
 * `clean-dist.mjs:14`, `peaks-ide-audit-log.mjs:10`), each of them a comment
 * asserting coverage by a test that is gone. Widening the same measurement to
 * EVERY bare path-shaped token in those comments (29 tokens) reported 5
 * findings, of which only those 3 are citations: the other two are
 * `src/index.ts` inside a sentence describing what a *consumed* package's
 * export map must contain, and `tests/fixtures/…md` inside an example command
 * line. A rule that reads shapes and examples as missing files is how a guard
 * trains its reader to ignore it, so the bare-token rule is drawn at test-file
 * citations — the exact class E2 reported — rather than at paths in general.
 */
const BARE_TEST_CITATION = /(?<!`)(tests\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.test\.ts)(?![\w./-])/g;

/**
 * The comment text of a source file, line for line.
 *
 * A code comment cites paths the same way a document does, and it rots the
 * same way when the cited file is deleted — E2 (rid
 * 2026-09-17-cli-output-and-stale-refs) is exactly that: `sync-version.mjs`
 * pointed at tests/unit/scripts/sync-version-invalidation.test.ts, deleted in
 * `f17aa377`, and the markdown-only corpus could not see it.
 *
 * Line count and line ORDER are preserved exactly, so a finding's line number
 * is the line the reader will open. Only comment content survives:
 *   - a line whose trimmed form starts `//`, `/*` or `*` is a comment line
 *     and is passed through whole;
 *   - otherwise the text from the first `//` is kept as a trailing comment;
 *   - every other line becomes empty.
 *
 * A surviving line then has its bare test-file citations backticked (see
 * `BARE_TEST_CITATION`), so the one candidate rule the checker already knows
 * applies to them too. This is why E2's instance is visible here: it was
 * written without backticks, and a backtick-only reading cannot fail on it.
 *
 * Truncation can only REMOVE text, so a span cut in half yields no candidate
 * rather than a wrong one — a false negative on a template literal, never a
 * false finding. A `//` inside a string literal (`'https://…'`) is the one
 * shape this misreads as comment start, and the guard's candidate rule
 * already excludes it: a URL carries `:` and `@`-prefixed refs are skipped.
 *
 * `src/**` is deliberately NOT in this corpus. The class certainly lives
 * there too, but the blast radius of teaching the guard to read ~1300 source
 * files is unmeasured, and this repository's rule is to measure a widening
 * before landing it rather than to turn the suite red on a guess.
 */
export function commentText(body: string): string {
  return body
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      const comment =
        trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')
          ? line
          : (() => {
              const at = line.indexOf('//');
              return at === -1 ? '' : line.slice(at);
            })();
      BARE_TEST_CITATION.lastIndex = 0;
      return comment.replace(BARE_TEST_CITATION, '`$1`');
    })
    .join('\n');
}

/** Every `.mjs` / `.ts` file under `scripts/`, repo-relative, sorted. */
export function scriptFiles(repoRoot: string): string[] {
  const absDir = join(repoRoot, 'scripts');
  if (!existsSync(absDir)) return [];
  const files: string[] = [];
  const walk = (relDir: string): void => {
    for (const entry of readdirSync(join(repoRoot, relDir), { withFileTypes: true })) {
      const rel = `${relDir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith('.mjs') || entry.name.endsWith('.ts')) files.push(rel);
    }
  };
  walk('scripts');
  return files.sort();
}

/** What the candidate rule needs beyond the span itself. */
interface CitationContext {
  /** Repo-relative id of the citing document. */
  readonly id: string;
  /** True when a repo-relative path is a directory in the working tree. */
  readonly dirExists: (relDir: string) => boolean;
}

/**
 * The second resolution origin, made explicit: a span with no repo-root anchor
 * is read from the citing document's own directory and nowhere else — the
 * `references/x.md` a SKILL.md sibling writes. Every ancestor below the repo
 * root is tried, so a file inside `references/` can cite `references/v3.md`
 * meaning its skill's `references/v3.md`.
 *
 * The repo root is deliberately NOT an origin for a non-anchored span: writing
 * a repo-root path is exactly what the anchors are for, and a bare
 * `mappers/…`, `agent/…`, `hooks/hooks.json` or `raw/page-2.json` in these
 * documents names a file in the *consumer's* project or in a third-party
 * package. Those paths dangle from here by construction, and reporting them
 * was 13 of the 85 findings the first pass produced.
 */
function isDocumentRelative(span: string, ctx: CitationContext): boolean {
  const parent = span.slice(0, span.lastIndexOf('/'));
  const cut = ctx.id.lastIndexOf('/');
  if (cut === -1) return false; // a top-level document has no neighbourhood
  let dir = ctx.id.slice(0, cut);
  for (;;) {
    if (ctx.dirExists(`${dir}/${parent}`)) return true;
    const up = dir.lastIndexOf('/');
    if (up === -1) return false;
    dir = dir.slice(0, up);
  }
}

function isCandidate(span: string, line: string, backtickAt: number, spanLength: number, ctx: CitationContext): boolean {
  if (!PATH_SHAPED.test(span)) return false; // excludes `<sid>` placeholders and globs
  if (span.includes('@')) return false; // npm / GitHub-Action refs
  if (RUNTIME_STATE_PREFIXES.some((prefix) => span.startsWith(prefix))) return false;
  if (OPTIONAL_RUNTIME_PATHS.has(span)) return false;
  if (ELLIPSIS_SEGMENT.test(span)) return false;
  // `./feishu-doc-snapshot.md` is where the *consuming* project must not drop a
  // Feishu export (peaks-prd says so in the same breath, "project root"). A
  // repo path in this corpus is written from the repo root, never `./`-prefixed.
  if (span.startsWith('./')) return false;
  // Inside a `<…>` fill-in the span is template text: the scan checklists ask
  // the reader to *replace* it, so it is not a claim about this tree.
  const before = line.slice(0, backtickAt);
  const after = line.slice(backtickAt + spanLength + 2); // +2 for the backticks
  if (before.lastIndexOf('<') > before.lastIndexOf('>') && after.includes('>')) return false;
  if (ILLUSTRATION_CUE.test(before)) return false;
  const basename = span.slice(span.lastIndexOf('/') + 1);
  const dot = basename.indexOf('.');
  if (SYNTHETIC_STEMS.has(dot === -1 ? basename : basename.slice(0, dot))) return false;
  if (REPO_ANCHORS.test(span)) return true; // an anchored citation claims this repo
  return isDocumentRelative(span, ctx);
}

/**
 * Pure checker: every path-shaped backtick span in `texts` must satisfy
 * `exists`. Returns `"<text-id>:<line> cites <path>"` for each dangling one.
 * `exists` is handed the citing text's id as well, so a caller can resolve a
 * citation from the citing document's own directory.
 */
export function findDanglingCitations(
  texts: ReadonlyArray<{ id: string; body: string }>,
  exists: (relPath: string, fromId: string) => boolean,
  /**
   * True when a repo-relative path is a directory that exists. Only the
   * document-relative branch of `isCandidate` consults it, so the pure
   * behavior controls — whose spans are all repo-anchored — may omit it.
   */
  dirExists: (relDir: string) => boolean = () => false,
): string[] {
  const findings: string[] = [];
  for (const { id, body } of texts) {
    const ctx: CitationContext = { id, dirExists };
    body.split(/\r?\n/).forEach((line, index) => {
      BACKTICK_SPAN.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = BACKTICK_SPAN.exec(line)) !== null) {
        const candidate = (match[1] ?? '').trim();
        if (!isCandidate(candidate, line, match.index, match[0].length, ctx)) continue;
        if (exists(candidate, id)) continue; // a resolvable citation is never exempted
        if (SESSION_WORKSPACE_DIRS.has(candidate.split('/')[0] ?? '')) continue;
        findings.push(`${id}:${index + 1} cites \`${candidate}\``);
      }
    });
  }
  return findings;
}

describe('Scenario: behavior — the checker can fail, and can clear', () => {
  const noPathsExist = (): boolean => false;

  it('when a corpus text cites a path that does not exist, should report it', () => {
    // given: a document citing two repo paths, only one of which exists
    const texts = [{ id: 'FAKE.md', body: 'See `tests/unit/does-not-exist.test.ts` and `src/cli/index.ts`.' }];
    const exists = (rel: string): boolean => rel === 'src/cli/index.ts';

    // when: the corpus is checked
    const findings = findDanglingCitations(texts, exists);

    // then: exactly the dangling citation is reported
    expect(findings).toEqual(['FAKE.md:1 cites `tests/unit/does-not-exist.test.ts`']);
  });

  it('when every cited path exists, should report nothing', () => {
    // given: a document whose citations all resolve (the clean-tree control)
    const texts = [{ id: 'FAKE.md', body: 'See `src/cli/index.ts` and `tests/unit/standards/repo-citation-integrity.test.ts`.' }];

    // when: the corpus is checked
    const findings = findDanglingCitations(texts, (rel) => rel.startsWith('src/') || rel.startsWith('tests/'));

    // then: the guard stays green
    expect(findings).toEqual([]);
  });

  it('when a span is not a path citation, should not treat it as one', () => {
    // given: prose carrying a category label, an action ref, a glob and a
    //        per-session path — plus one real dangling citation as the control
    const texts = [{
      id: 'FAKE.md',
      body: [
        'Categories `TODO/FIXME/XXX`, action `pnpm/action-setup@v4`,',
        'glob `src/**/*.ts`, session `.peaks/_runtime/<sid>/rd/x.md`,',
        'and `docs/gone.md`.',
      ].join('\n'),
    }];

    // when: the corpus is checked with nothing on disk
    const findings = findDanglingCitations(texts, noPathsExist);

    // then: only the real path citation is reported, with its line number
    expect(findings).toEqual(['FAKE.md:3 cites `docs/gone.md`']);
  });
});

describe('Scenario: integration — the real corpus resolves on the real tree', () => {
  it('when the normative documents are read, should cite only paths that exist', () => {
    // given: the real corpus, read off the working tree
    const texts = corpusFiles(REPO_ROOT).map((abs) => ({
      id: abs.slice(REPO_ROOT.length + 1).split('\\').join('/'),
      body: readFileSync(abs, 'utf8'),
    }));

    // when: every path-shaped backtick citation is resolved against the tree,
    //       first from the repo root and then from the citing document's own
    //       directory (how a document inside `skills/` cites its siblings)
    const findings = findDanglingCitations(
      texts,
      (rel, fromId) => {
        if (existsSync(join(REPO_ROOT, rel))) return true;
        if (existsSync(join(REPO_ROOT, fromId, '..', rel))) return true;
        return isGitIgnored(rel);
      },
      (rel) => isDirectory(join(REPO_ROOT, rel)),
    );

    // then: nothing dangles
    expect(findings, `dangling citations:\n${findings.join('\n')}`).toEqual([]);
  });

  it('when the corpus is enumerated, should include the normative documents', () => {
    // given: the corpus definition
    // when: it is enumerated
    const ids = corpusFiles(REPO_ROOT).map((abs) => abs.slice(REPO_ROOT.length + 1).split('\\').join('/'));

    // then: the documents the brief names as normative are all present
    expect(ids).toContain('CLAUDE.md');
    expect(ids).toContain('.peaks/PROJECT.md');
    expect(ids).toContain('README.md');
    expect(ids.filter((id) => id.startsWith('.peaks/standards/')).length).toBeGreaterThan(0);
    expect(ids.filter((id) => id.startsWith('skills/')).length).toBeGreaterThan(0);
  });

  it('when the corpus directory is missing, should report an empty corpus rather than throw', () => {
    // given: a root with no `.peaks/standards/` and no top-level documents
    const emptyRoot = join(REPO_ROOT, 'tests', 'unit', '_samples', 'no-such-corpus-root');

    // when: the corpus is enumerated
    const ids = corpusFiles(emptyRoot);

    // then: it comes back empty instead of raising
    expect(ids).toEqual([]);
  });
});

describe('Scenario: integration — script comments cite only paths that exist', () => {
  it('when the script corpus is enumerated, should cover every .mjs and .ts under scripts/', () => {
    // given: the corpus definition
    // when: it is enumerated
    const ids = scriptFiles(REPO_ROOT);

    // then: it is non-empty and names the file E2 was reported against — the
    //       corpus must contain its subject, or it cannot see the defect
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toContain('scripts/sync-version.mjs');
    expect(ids).toContain('scripts/clean-dist.mjs');
  });

  it('when the script comments are read, should cite only paths that exist', () => {
    // given: the comment text of every script, read off the working tree
    const texts = scriptFiles(REPO_ROOT).map((id) => ({
      id,
      body: commentText(readFileSync(join(REPO_ROOT, id), 'utf8')),
    }));

    // when: every path-shaped backtick citation in a comment is resolved
    const findings = findDanglingCitations(
      texts,
      (rel) => existsSync(join(REPO_ROOT, rel)) || isGitIgnored(rel),
    );

    // then: nothing dangles
    expect(findings, `dangling script-comment citations:\n${findings.join('\n')}`).toEqual([]);
  });
});

describe('Scenario: behavior — the comment corpus can fail, and cannot read code as prose', () => {
  it('when a comment cites a deleted test, should report it with the real line number', () => {
    // given: a script whose comment cites a test that is not on the tree
    const body = ['#!/usr/bin/env node', 'import { x } from "y";', '// pinned by `tests/unit/scripts/gone.test.ts`', 'x();'].join('\n');

    // when: its comment text is checked
    const findings = findDanglingCitations(
      [{ id: 'scripts/fake.mjs', body: commentText(body) }],
      () => false,
    );

    // then: the citation is reported at the line the reader will open
    expect(findings).toEqual(['scripts/fake.mjs:3 cites `tests/unit/scripts/gone.test.ts`']);
  });

  it('when a comment cites a file that exists, should report nothing', () => {
    // given: the clean control for the case above
    const body = ['#!/usr/bin/env node', '// pinned by `tests/unit/standards/repo-citation-integrity.test.ts`'].join('\n');

    // when: its comment text is checked
    const findings = findDanglingCitations(
      [{ id: 'scripts/fake.mjs', body: commentText(body) }],
      (rel) => rel === 'tests/unit/standards/repo-citation-integrity.test.ts',
    );

    // then: the guard stays green
    expect(findings).toEqual([]);
  });

  it('when a path appears in CODE and not in a comment, should not treat it as a citation', () => {
    // given: a script whose only path-shaped string is a runtime argument —
    //        the shape the corpus must not read as prose, or every import and
    //        every fs call would become a citation
    const body = ['#!/usr/bin/env node', 'const manifest = "release/artifacts/index.json";', 'run("scripts/does-not-exist.mjs");'].join('\n');

    // when: its comment text is checked
    const findings = findDanglingCitations(
      [{ id: 'scripts/fake.mjs', body: commentText(body) }],
      () => false,
    );

    // then: no citation is claimed — code is not prose
    expect(findings).toEqual([]);
  });

  it('when a comment names a deleted test WITHOUT backticks, should still report it', () => {
    // given: E2's exact shape — a comment asserting coverage, the test path
    //        written in bare prose, the file gone. A backtick-only reading
    //        passes over this, which is why the defect survived
    const body = ['#!/usr/bin/env node', '// This narrow unlink stays because it is unit-tested by', '// tests/unit/scripts/sync-version-invalidation.test.ts and', '// catching the Bug-04 lineage on its own is cheap insurance.'].join('\n');

    // when: its comment text is checked
    const findings = findDanglingCitations(
      [{ id: 'scripts/fake.mjs', body: commentText(body) }],
      () => false,
    );

    // then: the citation is reported at the line the reader will open — the
    //       citing line is 3, and the shim line above it is not miscounted
    expect(findings).toEqual(['scripts/fake.mjs:3 cites `tests/unit/scripts/sync-version-invalidation.test.ts`']);
  });

  it('when a comment names a bare path that is NOT a test, should not report it', () => {
    // given: the precision control for the rule above — the two shapes the
    //        measurement rejected as non-citations (a path describing what a
    //        CONSUMED package must contain, and a path inside an example
    //        command line)
    const body = [
      '#!/usr/bin/env node',
      '// For "." the source is src/index.ts.',
      '//   --variant-from tests/fixtures/replay/2026-06-27-gone-audit-security.md \\',
    ].join('\n');

    // when: its comment text is checked
    const findings = findDanglingCitations(
      [{ id: 'scripts/fake.mjs', body: commentText(body) }],
      () => false,
    );

    // then: neither is claimed as a citation — the bare-token rule is drawn
    //       at test-file citations, so a guard is not taught to cry wolf
    expect(findings).toEqual([]);
  });
});

/**
 * Is `absPath` a directory? Used only as the document-relative origin probe
 * (`isDocumentRelative`), where a path that cannot be stat'ed is simply not an
 * origin — the same answer as an absent one.
 */
function isDirectory(absPath: string): boolean {
  try {
    return statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The root `.gitignore` is the arbiter of "git is told never to track this".
 * Resolved by reading the file rather than spawning `git`, so the check stays
 * synchronous with the rest of the corpus walk.
 */
function isGitIgnored(relPath: string): boolean {
  const gitignorePath = join(REPO_ROOT, '.gitignore');
  if (!existsSync(gitignorePath)) return false;
  const patterns = readFileSync(gitignorePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  return patterns.some((pattern) => {
    const normalized = pattern.replace(/^\/+/, '');
    if (normalized.endsWith('/')) return relPath.startsWith(normalized);
    return relPath === normalized || relPath.startsWith(`${normalized}/`);
  });
}
