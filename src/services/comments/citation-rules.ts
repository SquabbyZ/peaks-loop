/**
 * What makes a backtick span a claim about this repository's file tree.
 *
 * These are the candidate rules, shared by the two readers of the same judgement:
 * the comment classifier (`comment-hygiene.ts`) and, by literal, the repository's
 * citation guard (`tests/unit/standards/repo-citation-integrity.test.ts`).
 * `tests/unit/comments/citation-parity.test.ts` pins that the two spellings agree —
 * a shape rule restated in a second place and then drifting is the defect this
 * repository keeps documenting for itself.
 *
 * The rules are exclusions, and every one of them exists because of a measured
 * false positive rather than a taste for tidiness. See `isCitationCandidate`.
 */

/** Backtick span that has at least one `/` — a path citation, not a mention. */
export const PATH_SHAPED = /^[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)+$/;

/** First segments that make a span repo-relative rather than document-relative. */
export const REPO_ANCHORS =
  /^(\.peaks|\.claude|\.github|src|tests|docs|scripts|skills|packages|bin|openspec|contracts)\//;

/** `path.ts:14-17` — strip before judging; the FILE must exist, the line may move. */
export const LINE_SUFFIX = /:\d+(?:-\d+)?$/;

/**
 * Session-runtime dirs. A path starting with one of these is a runtime artifact
 * written under `.peaks/_runtime/<sessionId>/` and abbreviated in prose; it is
 * not a repo file, and reporting it as missing is how a guard starts being
 * ignored. Same exemption list the citation guard carries.
 */
export const SESSION_WORKSPACE_DIRS = new Set([
  'prd',
  'rd',
  'qa',
  'sc',
  'txt',
  'audit',
  'ui',
  'session',
  'system'
]);

/** `<placeholder>`, an ellipsis, a glob segment — illustrative, not asserted. */
export const SYNTHETIC_SEGMENT = /[<>*…]|etc\.$/;

/**
 * A segment that is exactly an ASCII ellipsis names a path *family*
 * (`src/...`, `openspec/changes/...`), not a file. `SYNTHETIC_SEGMENT` above
 * catches the Unicode `…` and the glob `*`; this catches `...`, which its
 * character class admits.
 */
export const ELLIPSIS_SEGMENT = /(?:^|\/)\.\.\.(?:$|\/)/;

/**
 * The bare-`*.test.ts`-filename shape, written once. A filename carries no slash,
 * so `PATH_SHAPED` cannot see it; this is the second shape a candidate claim can
 * take, and the guard reads the same character classes.
 */
const BARE_FILENAME_NAME = String.raw`[A-Za-z0-9_][A-Za-z0-9_.-]*-[A-Za-z0-9_.-]*\.test\.ts`;
export const BARE_TEST_FILENAME_SHAPE = new RegExp(`^${BARE_FILENAME_NAME}$`);

/**
 * Runtime state the CLI writes into a project. In a checkout of THIS repository
 * these are absent by design — they are produced in the consuming project at run
 * time — so a comment naming them makes no claim about this tree.
 */
export const RUNTIME_STATE_PREFIXES = [
  '.peaks/_runtime/',
  '.peaks/cron/',
  '.peaks/cache/',
  // Both are gitignored at the repository root and written per run: `_dogfood/` by
  // the dogfood harness, `_sub_agents/` by `peaks sub-agent dispatch`.
  '.peaks/_dogfood/',
  '.peaks/_sub_agents/'
] as const;

/**
 * A file sitting flat in a project's `.peaks/` root is state the CLI writes there
 * at run time — `.peaks/fork-state.json`, `.peaks/polyrepo.json`,
 * `.peaks/role-registry.json`, `.peaks/.gitignore`, `.peaks/smoke-paths.json`.
 *
 * What this repository's own `.peaks/` commits is directories (`standards/`,
 * `docs/`, `lint/`, `memory/`) plus four flat files, every one of which is
 * present, so a citation to a tracked flat file resolves and this rule never fires
 * for it. The shape is trusted over an entry list because an entry list has to
 * grow with every runtime file the CLI adds — and the cost is stated: a future flat
 * `.peaks/<file>` that is committed and later deleted would be hidden here.
 * Repository convention is that top-level `.peaks/` entries are session or decision
 * state, and a citation of that shape describes the consuming project.
 */
export const RUNTIME_STATE_ROOT_FILE = /^\.peaks\/[^/]+$/;

/** Stems that name a shape rather than a file (`src/services/x/y.ts`, `foo.ts`). */
export const SYNTHETIC_STEMS = new Set([
  'x',
  'y',
  'z',
  'foo',
  'bar',
  'baz',
  'qux',
  'example',
  'sample',
  'dummy',
  'placeholder'
]);

/**
 * Text that introduces a path as a shape to copy into the consumer's own
 * repository, rather than a claim that this tree contains it.
 */
export const ILLUSTRATION_CUE =
  /(?:e\.g\.|i\.e\.|for example|such as|reference shape|Example:)\s*\(?\s*$/i;

/**
 * A sentence that reasons about what a path *would* do, rather than reporting
 * that a file is there.
 *
 * Two measured shapes, both read from the whole line because the cue sits on
 * either side of the span:
 *
 *   - a matching rule illustrated with made-up operands —
 *     `E.g. \`src/services/login\` should match \`src/services/login/handler.ts\``.
 *     Neither path is in any repository; the line is about the glob semantics.
 *     The `ILLUSTRATION_CUE` above cannot reach the second operand, because the
 *     cue must sit immediately before the span to fire, and here it does not.
 *   - a deliberate counterexample — `Written into \`.peaks/.gitignore\` they
 *     resolved to \`…\` and \`…\` — matching nothing, in every project`. The comment
 *     names two paths precisely because they match nothing; reporting them as
 *     missing files asks the reader to fix a bug the text is describing.
 *
 * The list is modal phrases only, and the boundary is load-bearing: the real
 * finding at `src/services/workspace/claude-settings-template.ts:90` asserts that a
 * handler "invokes the shipped script" by path, uses no modal, and stays reported —
 * the script is not in the tree. Bare `resolves to` was tried and dropped from the
 * list for the opposite reason: it also appears in live assertions about files that
 * DO exist, and a cue that clears those is a cue that hides debt.
 *
 * (This rule's own header was reported by the scan it documents — the sentence
 * above quoted the missing script's path verbatim, and quoting a dead path in prose
 * about a dead path is still a dead path. Cited by file and line now.)
 */
export const HYPOTHETICAL_CUE =
  /\b(?:should match|would (?:match|resolve|be|land|fail)|matching nothing|matched nothing|resolved to|do(?:es)? not match|never matched|hypothetical|counterexample|in that case)\b/i;

/**
 * Documented runtime paths that are legitimately absent from a checkout. Each
 * entry needs a reason; an allowlist without one is how a guard dies.
 */
export const OPTIONAL_RUNTIME_PATHS = new Set([
  // Legacy fallback location of the active-skill marker; the canonical path is
  // `.peaks/_runtime/active-skill.json`, so this dotfile is absent by design.
  '.peaks/.active-skill.json',
  // Legacy back-compat location of the session binding file, read by
  // `peaks session` when the canonical `.peaks/_runtime/session.json` is gone.
  '.peaks/.session.json'
]);

/** One path-shaped backtick span, with the offsets that bound it in its line. */
export type Citation = {
  readonly span: string;
  /** Offset of the opening backtick. */
  readonly from: number;
  /** Offset just past the closing backtick. */
  readonly to: number;
};

/** What the candidate rule needs beyond the span itself. */
export type CitationContext = {
  /** Repo-relative path of the citing file or document. */
  readonly file: string;
  /** True when a repo-relative path is a directory in the working tree. */
  readonly dirExists: (relDir: string) => boolean;
};

/**
 * The second resolution origin, made explicit: an unanchored span is a SIBLING
 * reference, so its parent directory must exist next to the citing file — and only
 * there.
 *
 * The repo root is deliberately not an origin for an unanchored span: writing a
 * repo-root path is exactly what the anchors are for. The walk is narrower than the
 * citation guard's every-ancestor version, and the reason is measured: with every
 * ancestor tried, `hooks/hooks.json` cited from
 * `src/services/doctor/doctor-service/checks/` was adopted by `src/services/hooks/`
 * four levels up, and `memory/index.json` by `src/services/memory/` — 16 findings
 * of paths inside installed packages and under
 * `.peaks/_runtime/<sessionId>/`, reported as missing repository files. A
 * sibling-only reading loses nothing real: a deleted file cited by the directory it
 * lived in still has that parent dir, and is still reported.
 */
export function isFileRelative(citation: string, ctx: CitationContext): boolean {
  const parent = citation.slice(0, citation.lastIndexOf('/'));
  const cut = ctx.file.lastIndexOf('/');
  if (cut === -1) return false;
  return ctx.dirExists(`${ctx.file.slice(0, cut)}/${parent}`);
}

/**
 * Spans that name something outside this repository: a package, a GitHub Action,
 * runtime state the CLI writes in the consuming project, a path *family*, or the
 * `./` form a document uses for a project it is installed into.
 */
function namesSomethingElse(span: string): boolean {
  if (span.includes('@')) return true; // npm package / GitHub-Action refs
  if (RUNTIME_STATE_PREFIXES.some((prefix) => span.startsWith(prefix))) return true;
  if (RUNTIME_STATE_ROOT_FILE.test(span)) return true;
  if (OPTIONAL_RUNTIME_PATHS.has(span)) return true;
  if (ELLIPSIS_SEGMENT.test(span)) return true;
  // A repo path in this tree is written from the repo root; `./x` is where the
  // CONSUMING project must not put a file.
  return span.startsWith('./');
}

/**
 * Spans that are template text or an illustration rather than an assertion: wrapped
 * in a `<…>` fill-in, introduced by an example cue, or built from stems that exist
 * only to show a shape.
 */
function illustratesRatherThanAsserts(citation: Citation, line: string, span: string): boolean {
  const before = line.slice(0, citation.from);
  const after = line.slice(citation.to);
  // Inside a `<…>` fill-in the span is template text meant to be replaced.
  if (before.lastIndexOf('<') > before.lastIndexOf('>') && after.includes('>')) return true;
  if (ILLUSTRATION_CUE.test(before)) return true;
  const basename = span.slice(span.lastIndexOf('/') + 1);
  const dot = basename.indexOf('.');
  return SYNTHETIC_STEMS.has(dot === -1 ? basename : basename.slice(0, dot));
}

/**
 * Is this span a claim about the working tree at all?
 *
 * These are the candidate exclusions the repository's citation guard applies to
 * markdown and to `scripts/` comments, transplanted to source comments —
 * deliberately the SAME rules, not a second definition of "citation". Porting them
 * was the answer to a measurement: 188 findings for roughly 20 real dead
 * references, because a comment that gives a shape as an example (`a/b`,
 * `pages/api`), names a path inside an installed package (`hooks/hooks.json`), or
 * documents runtime state the CLI writes in the user's project
 * (`.peaks/cron/schedule.json`) all read as "missing file" to a probe that only
 * knows `exists`.
 *
 * The direction to preserve is the guard's stated invariant: these must never hide
 * an ANCHORED citation. A path beginning `src/`, `tests/`, `docs/`, `skills/`,
 * `scripts/`, `packages/` or `.peaks/` claims a location in this repository, and
 * nothing below lets it through unread.
 *
 * `namesNoDirectory` is set only by the bare-`*.test.ts`-filename reading, whose own
 * pattern has already established the filename shape: a filename names no
 * directory, so it cannot satisfy `PATH_SHAPED`, and it has no parent directory to
 * read as a sibling.
 */
export function isCitationCandidate(
  citation: Citation,
  line: string,
  ctx: CitationContext,
  namesNoDirectory = false
): boolean {
  const span = citation.span;
  if (!(namesNoDirectory ? BARE_TEST_FILENAME_SHAPE.test(span) : PATH_SHAPED.test(span)))
    return false;
  if (namesSomethingElse(span)) return false;
  if (illustratesRatherThanAsserts(citation, line, span)) return false;
  // The line reasons about what a path would do; it does not claim one is there.
  if (HYPOTHETICAL_CUE.test(line)) return false;
  if (REPO_ANCHORS.test(span)) return true;
  if (namesNoDirectory) return true;
  return isFileRelative(span, ctx);
}
