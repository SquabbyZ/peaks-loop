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
// BARE CITATIONS. A backtick is a deliberate act: it is how a document says
// "this is a path". The three citations this guard was built for were all
// backticked, and so the backtick-only reading saw them. The citation that rots
// silently is the one written WITHOUT backticks, because nothing in the text
// marks it as a path at all — which is exactly the shape disclosed as scope gap
// #1 in 4.0.51. Two bare shapes are read, and no others:
//   - `tests/**/*.test.ts` anywhere in prose (`BARE_TEST_CITATION`), the same
//     pattern the comment corpus already used, now applied to the main path;
//   - a bare `*.test.ts` FILENAME that reads as a citation — it must carry a
//     `-`, sit on whitespace or a line boundary at both ends, and name no
//     directory (`BARE_TEST_FILENAME`). The `-` requirement is what keeps the
//     everyday bare filename (`README.md`, `CHANGELOG.md`, `SKILL.md`) out, and
//     it is deliberately the narrowest reading that covers the shape the gap
//     named: `zig.test.ts` without a dash is NOT read (see the case that pins
//     that boundary). This is the B1 shape, not "bare filenames in general".
// Both scans run through the same exclusions, the same resolution and the same
// dedup as every other citation. One thing does differ, and it is forced rather
// than chosen: `isCandidate` opens with `PATH_SHAPED`, which requires a slash,
// and a filename has no `parent` segment for the document-relative walk either.
// So the filename shape is checked against `BARE_FILENAME_SHAPED` and admitted
// directly — the one place where a second shape test exists, and the honest
// reason it had to.
//
// A bare match is skipped when it falls INSIDE a backtick span, which is the
// existing `(?<!`)` lookbehind generalized from "immediately after a backtick"
// to "anywhere within one". That is not a carve-out: the span was already read
// by the backtick scan, and a path that is a fragment of a larger inline-code
// span (`summary: "… covered by config-service.api.test.ts …"`) is part of a
// quoted sample, not a claim about this tree. Measured, this is what the whole
// of the widening costs: over the real corpus the two bare rules match three
// tokens and all three are inside such a span — i.e. the corpus is unchanged,
// and the finding the guards below were told to expect stays at zero.
//
// RESIDUAL GAP, measured while landing this. A BACKTICKED bare filename (e.g.
// `` `skills-skill-md-naming.test.ts` ``) is still invisible: the span reading
// fails `PATH_SHAPED` for want of a slash, and the bare readings skip anything
// inside a span. It is not closed here because closing it is not free: the
// markdown corpus holds two backticked filenames of this shape
// (`.peaks/standards/catalog-governance/v2-14-classifications.md`, naming tests
// that no commit ever added), and a span rule that admitted the shape would
// report both — and a bare filename has no directory, so no resolution origin
// exists to clear them with. That is a change to the resolution contract, not a
// widening of the candidate rule, so the case pinning the gap is disclosed
// rather than closed.
//
// Counted honestly: the SCRIPT corpus holds two more of the same shape
// (`scripts/sync-version.mjs`, `scripts/peaks-ide-audit-log.mjs`), both naming
// tests `f17aa377` deleted and both written as basenames precisely so this
// guard cannot resolve them. They are four in the repository, two in the
// markdown corpus; neither pair is fixed here.
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
 *
 * The comment corpus reaches this pattern through `commentText`, which
 * backticks each match so the single candidate rule then applies to it. The
 * markdown corpus has no such shim, so `findDanglingCitations` runs this
 * pattern directly as well — the same regex at a second call site, not a second
 * regex.
 */
const BARE_TEST_CITATION = /(?<!`)(tests\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.test\.ts)(?![\w./-])/g;

/**
 * A bare `*.test.ts` FILENAME carrying no directory — the second bare shape,
 * and the one AC-8 named (`skills-skill-md-naming.test.ts`, cited by
 * `skills/bee/peaks-qa/SKILL.md` until 4.0.51 rewrote it, the test having been
 * deleted in `457b9a87`).
 *
 * `BARE_TEST_CITATION` cannot reach this shape: its pattern begins `tests\/`, so
 * a filename with no prefix never matches it. That is the whole reason this
 * rule exists.
 *
 * DELIBERATELY NARROWER than the rule above, and narrower than "bare filenames"
 * — three conditions, each excluding a measured non-citation:
 *   - `.test.ts` — a bare `README.md` / `CHANGELOG.md` / `SKILL.md` is a name,
 *     not a citation, and these documents are full of them;
 *   - a `-` in the name — the shape the gap named, and it keeps
 *     `config.ts`-style prose out of the way;
 *   - whitespace or a line boundary at BOTH ends — an unquoted filename
 *     adjacent to punctuation (`v1-fallback.test.ts"`, `x.test.ts;`) is
 *     sample-record content, which is where the corpus's bare filenames live.
 * The `/`-free character class is what guarantees this rule and the one above
 * never overlap: this one cannot match inside a path.
 *
 * OVER THE REAL CORPUS this pattern matches exactly one token
 * (`4-dimensions.md:45`), and it is inside a backtick span, so it is skipped.
 * That is the measured basis for the corpus staying green — not a hope.
 *
 * A bare filename has no directory, so it names no origin a path could be
 * resolved from: like every other candidate it is handed to the caller's
 * `exists`, which resolves it at the repository root or beside the citing
 * document, and nowhere else.
 */
/**
 * The filename shape itself, written once. The scan below anchors it with the
 * boundaries that turn a filename into a citation; `isCandidate` re-checks the
 * name alone, because `PATH_SHAPED` — which every other candidate must satisfy
 * — requires a slash and a filename has none. Two hand-written copies of these
 * character classes would be two rules free to drift apart.
 */
const BARE_FILENAME_NAME = String.raw`[A-Za-z0-9_][A-Za-z0-9_.-]*-[A-Za-z0-9_.-]*\.test\.ts`;
const BARE_TEST_FILENAME = new RegExp(String.raw`(?:^|(?<=\s))(${BARE_FILENAME_NAME})(?=\s|$)`, 'g');
const BARE_FILENAME_SHAPED = new RegExp(`^${BARE_FILENAME_NAME}$`);

/**
 * The bare shapes, in the order they are read over a line, each paired with
 * whether it names a directory. The flag is per-shape because it is the shape
 * that decides which test in `isCandidate` applies — never the caller's mood.
 */
const BARE_SCANS: ReadonlyArray<readonly [RegExp, boolean]> = [
  [BARE_TEST_CITATION, false],
  [BARE_TEST_FILENAME, true],
];

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

/**
 * `from` and `to` bound the citation in `line`, INCLUSIVE of its backticks where
 * it has them — the span's opening backtick to just past its closing one. A bare
 * match has no backticks, so its own bounds are passed instead. Two rules below
 * read the text outside that range, which is why the bounds are offsets rather
 * than a length: the caller must not have to know that a span carries two extra
 * characters.
 */
function isCandidate(
  span: string,
  line: string,
  from: number,
  to: number,
  ctx: CitationContext,
  /**
   * Set only by the bare-filename rule, whose own pattern has already
   * established the filename shape. A filename names no directory, so it
   * cannot satisfy `PATH_SHAPED`, which requires a slash. Every other rule here
   * applies to it unchanged, so this second shape opens no door the first one
   * did not.
   *
   * The document-relative walk is skipped for it too, and that skip is
   * DEFENSIVE rather than load-bearing: at the one call site that exists, the
   * shape test above already rejects any span carrying a slash, so the walk is
   * unreachable for a `namesNoDirectory` span today. What it guards against is
   * a future call site reaching the walk with a slashless span, where
   * `slice(0, lastIndexOf('/'))` finds no slash (`-1`) and silently drops the
   * span's last character. A hardening, not a repair — nothing is broken now.
   */
  namesNoDirectory = false,
): boolean {
  // excludes `<sid>` placeholders, globs and bare non-paths
  if (!(namesNoDirectory ? BARE_FILENAME_SHAPED.test(span) : PATH_SHAPED.test(span))) return false;
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
  const before = line.slice(0, from);
  const after = line.slice(to);
  if (before.lastIndexOf('<') > before.lastIndexOf('>') && after.includes('>')) return false;
  if (ILLUSTRATION_CUE.test(before)) return false;
  const basename = span.slice(span.lastIndexOf('/') + 1);
  const dot = basename.indexOf('.');
  if (SYNTHETIC_STEMS.has(dot === -1 ? basename : basename.slice(0, dot))) return false;
  if (REPO_ANCHORS.test(span)) return true; // an anchored citation claims this repo
  // A filename has no `parent` to walk with, and its shape is the whole claim:
  // whether the tree holds it is the caller's `exists` to answer. This also
  // keeps the walk above off a slashless span, where it would cut the last
  // character — unreachable while the shape test above rejects a slash, but the
  // guard should not depend on that test staying where it is.
  if (namesNoDirectory) return true;
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
      /** Paths already reported on this line, so a second reading cannot repeat one. */
      const reported = new Set<string>();

      /**
       * The one disposition every reading shares: the candidate rule, then
       * resolution. `from`/`to` are the citation's bounds in `line`, backticks
       * included where it has them.
       */
      const judge = (span: string, from: number, to: number, namesNoDirectory = false): void => {
        const candidate = span.trim();
        if (!isCandidate(candidate, line, from, to, ctx, namesNoDirectory)) return;
        if (exists(candidate, id)) return; // a resolvable citation is never exempted
        if (SESSION_WORKSPACE_DIRS.has(candidate.split('/')[0] ?? '')) return;
        if (reported.has(candidate)) return;
        reported.add(candidate);
        findings.push(`${id}:${index + 1} cites \`${candidate}\``);
      };

      /** Every backtick span on the line, as `[from, to)` offsets. */
      const spans: Array<readonly [number, number]> = [];
      BACKTICK_SPAN.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = BACKTICK_SPAN.exec(line)) !== null) {
        const to = match.index + match[0].length;
        spans.push([match.index, to]);
        judge(match[1] ?? '', match.index, to);
      }

      // The bare shapes, which the scan above cannot see. A match inside a span
      // is skipped: the span was just judged, and a path that is a fragment of a
      // longer inline-code literal is part of that literal, not a citation of
      // its own. Outside the spans, a bare citation is judged exactly as a
      // backticked one is — same candidate rule, same resolution, same dedup.
      for (const [scan, namesNoDirectory] of BARE_SCANS) {
        scan.lastIndex = 0;
        let bare: RegExpExecArray | null;
        while ((bare = scan.exec(line)) !== null) {
          const hit = bare; // a const, so the closure below keeps the narrowing
          const to = hit.index + hit[0].length;
          if (spans.some(([from, spanTo]) => hit.index >= from && to <= spanTo)) continue;
          judge(hit[1] ?? '', hit.index, to, namesNoDirectory);
        }
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

describe('Scenario: behavior — the bare scans see citations the backticks hide', () => {
  const noPathsExist = (): boolean => false;

  it('when prose names a bare tests/ path that is gone, should report it', () => {
    // given: gap #1's first shape — the path written without backticks, which a
    //        backtick-only reading cannot fail on
    const texts = [{ id: 'FAKE.md', body: 'Coverage is asserted by tests/some-thing.test.ts today.' }];

    // when: the checker runs with nothing on disk
    const findings = findDanglingCitations(texts, noPathsExist);

    // then: it is reported like any other dangling citation
    expect(findings).toEqual(['FAKE.md:1 cites `tests/some-thing.test.ts`']);
  });

  it('when prose names a bare tests/ path that exists, should report nothing', () => {
    // given: the clean control for the case above — same shape, resolvable
    const texts = [{ id: 'FAKE.md', body: 'Coverage is asserted by tests/unit/standards/repo-citation-integrity.test.ts today.' }];

    // when: the checker runs against a tree that holds it
    const findings = findDanglingCitations(texts, (rel) => rel === 'tests/unit/standards/repo-citation-integrity.test.ts');

    // then: the guard stays green
    expect(findings).toEqual([]);
  });

  it('when the same dangling path is backticked, should still report it', () => {
    // given: the pre-existing shape, unchanged — the widening must not have
    //        moved the backtick path's behavior
    const texts = [{ id: 'FAKE.md', body: 'Coverage is asserted by `tests/nonexistent.test.ts` today.' }];

    // when: the checker runs with nothing on disk
    const findings = findDanglingCitations(texts, noPathsExist);

    // then: it is reported once
    expect(findings).toEqual(['FAKE.md:1 cites `tests/nonexistent.test.ts`']);
  });

  it('when prose names a bare path that is not a test, should not report it', () => {
    // given: the precision control — the bare rule is drawn at `.test.ts`, not
    //        at paths in general
    const texts = [{ id: 'FAKE.md', body: 'The entry point is src/some-file.ts and the config is config/settings.json.' }];

    // when: the checker runs with nothing on disk
    const findings = findDanglingCitations(texts, noPathsExist);

    // then: neither is claimed as a citation
    expect(findings).toEqual([]);
  });

  it('when a dangling path is both backticked and bare on one line, should report it once', () => {
    // given: one line reading the same missing path twice — once marked as a
    //        path, once in plain prose
    const texts = [{ id: 'FAKE.md', body: 'See `tests/gone.test.ts`; tests/gone.test.ts is the guard.' }];

    // when: the checker runs with nothing on disk
    const findings = findDanglingCitations(texts, noPathsExist);

    // then: the second reading does not repeat a finding the first already made
    //       — one dangling path is one thing for the reader to fix
    expect(findings).toEqual(['FAKE.md:1 cites `tests/gone.test.ts`']);
  });

  it('when prose names a bare test FILENAME with no directory, should report it', () => {
    // given: AC-8's exact shape — the citation 4.0.51 found in
    //        `skills/bee/peaks-qa/SKILL.md`, whose test was deleted in
    //        `457b9a87`. `BARE_TEST_CITATION` opens with `tests\/` and cannot
    //        match it; without this rule the shape stays invisible
    const texts = [{ id: 'FAKE.md', body: 'The guard is pinned by skills-skill-md-naming.test.ts in this suite.' }];

    // when: the checker runs with nothing on disk
    const findings = findDanglingCitations(texts, noPathsExist);

    // then: it is reported like any other dangling citation
    expect(findings).toEqual(['FAKE.md:1 cites `skills-skill-md-naming.test.ts`']);
  });

  it('when prose names a bare filename that is not a test, should not report it', () => {
    // given: the precision control for the rule above — a bare filename is a
    //        name, not a citation, and these documents are full of them
    const texts = [{ id: 'FAKE.md', body: 'Read README.md and CHANGELOG.md, then see .peaks/PROJECT.md.' }];

    // when: the checker runs with nothing on disk
    const findings = findDanglingCitations(texts, noPathsExist);

    // then: none is claimed as a citation
    expect(findings).toEqual([]);
  });

  it('when a bare test filename carries no dash, should not report it', () => {
    // given: the boundary this rule is drawn at, and it is deliberate: the
    //        filename shape is read only when it carries a `-`. A wider reading
    //        would take in the sample-record filenames that this corpus writes
    //        on purpose (`config-service.modules.test.ts` inside a quoted
    //        `summary:` value), which are illustrations, not citations.
    //
    //        THE PROBE MUST BE A STEM NO OTHER RULE EXCLUDES, or this case pins
    //        nothing. The first draft used `foo.test.ts` and was worthless:
    //        `foo` is in `SYNTHETIC_STEMS`, so deleting the `-` condition
    //        outright left this case green (mutation m8, measured — see the QA
    //        section of the tech doc). `zig` appears in no exclusion list, so
    //        the same mutation now reports this probe and turns this case red,
    //        which is what makes it a boundary rather than a coincidence
    const texts = [{ id: 'FAKE.md', body: 'Coverage moved to zig.test.ts last week.' }];

    // when: the checker runs with nothing on disk
    const findings = findDanglingCitations(texts, noPathsExist);

    // then: the narrow reading holds — this is a known, chosen limit
    expect(findings).toEqual([]);
  });

  it('when a bare filename is backticked, should stay unreported — a residual gap, pinned', () => {
    // given: the same filename, marked as a path. MEASURED, and not what the
    //        brief for this slice assumed: the span reading does NOT cover it
    //        either. `BACKTICK_SPAN` scans spans, but `isCandidate` opens with
    //        `PATH_SHAPED`, which requires a slash — so a backticked filename
    //        fails the shape test exactly as a bare one does, and this slice's
    //        widening (which reads only OUTSIDE spans) does not reach it
    const texts = [{ id: 'FAKE.md', body: 'The guard is pinned by `skills-skill-md-naming.test.ts` in this suite.' }];

    // when: the checker runs with nothing on disk
    const findings = findDanglingCitations(texts, noPathsExist);

    // then: nothing is reported. This case is a scope disclosure, not a
    //       satisfied goal: a backticked filename is still invisible, and it is
    //       pinned here so the gap cannot close or widen unnoticed. Closing it
    //       means teaching the SPAN rule the filename shape, which would change
    //       what the pre-existing backtick path admits for every document.
    expect(findings).toEqual([]);
  });

  it('when a bare citation sits inside a longer inline-code span, should not report it', () => {
    // given: the shape the real corpus actually contains — a path that is a
    //        fragment of a quoted sample record wrapped in backticks. Nothing
    //        here claims this tree holds the file
    const texts = [{
      id: 'FAKE.md',
      body: '> `summary: "AC-1 covered by config-service.api.test.ts (public API unchanged)"`',
    }];

    // when: the checker runs with nothing on disk
    const findings = findDanglingCitations(texts, noPathsExist);

    // then: the span was judged as a whole and found to be prose, so its
    //       fragments are not re-litigated as citations
    expect(findings).toEqual([]);
  });
});

describe('Scenario: integration — the real corpus resolves on the real tree', () => {
  /** The corpus, read off the working tree, keyed by its repo-relative id. */
  const corpusTexts = (): Array<{ id: string; body: string }> =>
    corpusFiles(REPO_ROOT).map((abs) => ({
      id: abs.slice(REPO_ROOT.length + 1).split('\\').join('/'),
      body: readFileSync(abs, 'utf8'),
    }));

  /**
   * How a citation resolves here: from the repo root, then from the citing
   * document's own directory (how a document inside `skills/` cites its
   * siblings), then anything the root `.gitignore` tells git never to track.
   */
  const resolveOnTree = (rel: string, fromId: string): boolean => {
    if (existsSync(join(REPO_ROOT, rel))) return true;
    if (existsSync(join(REPO_ROOT, fromId, '..', rel))) return true;
    return isGitIgnored(rel);
  };

  it('when the normative documents are read, should cite only paths that exist', () => {
    // given: the real corpus, read off the working tree
    const texts = corpusTexts();

    // when: every path-shaped citation is resolved against the tree, first from
    //       the repo root and then from the citing document's own directory
    const findings = findDanglingCitations(texts, resolveOnTree, (rel) => isDirectory(join(REPO_ROOT, rel)));

    // then: nothing dangles — and this is the case that would fail if the bare
    //       scans below reported a sample-record filename as a missing file
    expect(findings, `dangling citations:\n${findings.join('\n')}`).toEqual([]);
  });

  it('when a bare citation is spliced into the real corpus, should report it', () => {
    // given: the real corpus, plus the two shapes the bare scans exist for —
    //        one written with a directory, one as a bare filename
    const texts = corpusTexts();
    texts.push({
      id: 'skills/peaks-audit/SKILL.md',
      body: 'The behaviour is pinned by tests/unit/skills/a-gone-bare.test.ts and by a-gone-filename.test.ts today.',
    });

    // when: the widened checker runs over exactly that corpus
    const findings = findDanglingCitations(texts, resolveOnTree, (rel) => isDirectory(join(REPO_ROOT, rel)));

    // then: both are reported, and nothing else is. The corpus above is the
    //       baseline; this is the injection that proves the scan reading it is
    //       live — a rule that could not return a finding would pass the case
    //       above while guarding nothing
    expect(findings).toEqual([
      'skills/peaks-audit/SKILL.md:1 cites `tests/unit/skills/a-gone-bare.test.ts`',
      'skills/peaks-audit/SKILL.md:1 cites `a-gone-filename.test.ts`',
    ]);
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
