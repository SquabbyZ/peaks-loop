#!/usr/bin/env node
/**
 * scripts/test-changed-classify.mjs — the pure classifier behind `test-changed.mjs`.
 *
 * WHY A SEPARATE MODULE, the same reason `scripts/git-hook-env.mjs` exists: the runner
 * executes its whole flow at import time, so no test can read a rule out of it without
 * starting a suite. Everything here is pure in / pure out — no `fs`, no `spawn`, no
 * `process`, no env. One fs/git fact is an explicit OPTION (`baselineContentMoved`), so the
 * rule stays an arm and only the fact is plumbing. Existence filtering of the returned paths
 * stays in the runner: whether a path is on disk is an fs fact, not a classification fact.
 *
 * INPUT SHAPE. `git diff --name-status -z` stdout — NUL-separated, never C-quoted — parsed by
 * `parseNameStatus`, which lives here for the same reason: a rename naming two paths is a rule.
 *
 * The guard tier is an ADDITION to a mapping, never a substitute for the unmapped→full backstop —
 * and UNCONDITIONAL: `subset()` puts it into EVERY subset verdict, so a content-only diff reaches it.
 */
/**
 * Full-suite triggers: a path no `src/<area>` rule can reach — root configs, `scripts/`, dot-dirs.
 *
 * The `/^\.peaks\//` trigger STAYS broad on purpose. Real repo-root `.peaks/` files ARE
 * read off the working tree by tests, so a blanket `.peaks/` exemption would skip tests
 * that should run:
 *   - tests/unit/standards/loop-engineering-guidelines.test.ts:50 reads
 *     `.peaks/standards/loop-engineering-guidelines.md`
 *   - tests/unit/standards/repo-citation-integrity.test.ts:243,247 reads
 *     `.peaks/PROJECT.md` + every `*.md` under `.peaks/standards/`
 *   - tests/unit/standards/capability-glossary.test.ts:16 `git grep`s `.peaks/standards`
 */
export const FULL_FALLBACK_TRIGGERS = Object.freeze([
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^vitest\.config\.ts$/,
  /^tsconfig\.json$/,
  /^scripts\//,
  /^\.claude\//,
  /^\.peaks\//,
  /^\.github\//,
  /^\.husky\//
]);

/** The published ceiling artifact — the one path the broad `.peaks/` trigger must not catch. */
export const BASELINE_REL = '.peaks/lint/gate-baseline.json';

/**
 * The file that DEFINES which files the census counts — `FILE_SIZE_SCOPE_DIRS` and
 * `FILE_SIZE_SCOPE_EXTENSIONS` there, consumed by `scripts/lint/file-size-census.ts`. Named
 * here as a single path on purpose: it is the population's DEFINITION, not its contents, and
 * a pin asserts it exists on disk so a move is a red arm rather than silent drift.
 */
export const CENSUS_POLICY_REL = 'src/services/scan/file-size-policy.ts';

/**
 * Paths the broad triggers above would catch but that do NOT by themselves mean "run the
 * whole suite". Exact match only — a single-file exemption, not a prefix rule.
 *
 * NO LONGER A 0-TEST EXEMPTION (see R1): the artifact's contents select its guard suites, and
 * a diff that leaves it untouched-in-content lands on `baseline-inert` instead of silently
 * costing a suite. The old justification — "no test reads it" — was false.
 */
export const FULL_FALLBACK_EXEMPT = Object.freeze([BASELINE_REL]);

/** The whole-tree population guards: R2/R3 reach them, and `subset()` adds them to every subset. */
export const STANDARDS_GUARD_PATH = 'tests/unit/standards/';

/** The gate-artifact guard suite beside it — R1's second member. */
export const LINT_GUARD_PATH = 'tests/unit/lint/';

/**
 * THE WHOLE-TREE GUARD TIER — the two DIRECTORIES in this list, unioned with `ROOT_TIER_SELECTOR`
 * below into every subset verdict. Their subject is the repository TREE: the area rule above maps
 * `src/<area>` to `tests/unit/<area>`, so neither is reachable through an area of its own. A
 * tree-subject guard suite living anywhere else belongs HERE, or it silently stops running.
 */
export const GATE_GUARD_SUITES = Object.freeze([STANDARDS_GUARD_PATH, LINT_GUARD_PATH]);

/** The ROOT of `tests/unit/`, as a SELECTOR: no area reaches it, and `scripts/test-changed-root-tier.mjs`
 *  expands it into the root's own `*.test.ts` files — the union member below, on every subset verdict. */
export const ROOT_TIER_SELECTOR = 'tests/unit/*.test.ts';
const TIER = [...GATE_GUARD_SUITES, ROOT_TIER_SELECTOR];

/**
 * git statuses that change the file POPULATION, as opposed to one file's contents.
 *
 * `T` (typechange), `U` (unmerged), `X` (unknown) and `B` (broken pairing) are deliberately NOT
 * here, and that omission is safe only because of a DEPENDENCY worth naming: the census this set
 * exists to guard is a STRING-ONLY path/extension predicate — `isPolicyMeasuredFile` over
 * `git ls-files`, consumed by `scripts/lint/file-size-census.ts` — with no `lstat` anywhere, so
 * none of those four letters can add a path to or remove one from the counted population. A `T`
 * is one existing path changing mode, which `M` already covers for the population's purposes.
 *
 * WHAT WOULD INVALIDATE IT: a census that starts consulting `lstat` (a `T` would then change what
 * is measured, e.g. a file replaced by a symlink), or any status letter that starts adding or
 * removing paths from the listing rather than describing one path that is already there. Either
 * one turns a miss into a green push that counted the wrong population — add the letter here, or
 * move the guard off the status letter, but do not leave it out.
 */
export const FILE_SET_STATUSES = Object.freeze(['A', 'D', 'R', 'C']);

/** A `full` verdict, so the reasons that reach the whole suite share one shape. */
function full(code, reasons) {
  return { mode: 'full', paths: [], code, reasons };
}

/** A `subset` verdict — with the whole-tree guard tier unioned in, whatever selected the subset. */
function subset(paths, code, reasons) {
  return { mode: 'subset', paths: [...new Set([...paths, ...TIER])], code, reasons };
}

/** git's status letter, upper-cased; `''` when the entry carries no readable letter. */
function statusOf(entry) {
  return String(entry?.status ?? '')
    .trim()
    .charAt(0)
    .toUpperCase();
}

/**
 * Does this status change the file POPULATION (which paths exist and are counted), rather
 * than one file's contents?
 *
 * An UNREADABLE status fails CLOSED and counts as a population change: a gate whose unknown
 * case reads as "nothing to check" is the false-green class this module exists to close, and
 * the old permissive fallback also suppressed R2 outright. `T` (typechange) is deliberately
 * NOT in the set — it changes one path's mode, not the set of paths, so `M` is the right
 * reading of it.
 */
export function isPopulationChange(status) {
  return status === '' || FILE_SET_STATUSES.includes(status);
}

/**
 * One entry per path, statuses UNIONED — not first-wins.
 *
 * The runner feeds `[...staged, ...unstaged]`, so one path arrives twice: `M` in the index and
 * `D` on disk. First-wins would keep the `M` and skip R2, and flipping the order would flip the
 * verdict. A path is a file-set change if ANY of its occurrences carries a file-set status.
 */
export function mergeEntries(diffEntries) {
  const byPath = new Map();
  for (const entry of diffEntries ?? []) {
    const path = typeof entry?.path === 'string' ? entry.path.trim() : '';
    if (path === '') continue;
    const status = statusOf(entry);
    const previous = byPath.get(path);
    if (previous === undefined) {
      byPath.set(path, { status, path });
    } else if (isPopulationChange(status)) {
      previous.status = status;
    }
  }
  return [...byPath.values()];
}

/**
 * `git diff --name-status -z` stdout → `{ status, path }` entries.
 *
 * THE `-z` IS PART OF THE CONTRACT, not a flag: without it git C-quotes a path holding
 * non-ASCII or control bytes (`core.quotePath` defaults on), the quoted string matches no
 * anchored trigger, no area regex and no `BASELINE_REL`, and the suite that path belongs to is
 * silently dropped from the selection. Under `-z` records are NUL-separated and NOTHING is
 * quoted, so a space, a newline and any byte above ASCII arrive byte-for-byte.
 *
 * A record is `STATUS\0path\0`, or `STATUS\0old\0new\0` for `R<score>`/`C<score>`: a rename
 * names TWO paths, both emitted under the same status letter. Fields are consumed by the count
 * the letter implies, never in fixed-size groups. Text carrying no NUL at all — a caller that
 * dropped `-z` — yields no entry rather than a quoted one, so the diff reads unmapped and the
 * whole suite runs: the failure direction is the safe one.
 */
export function parseNameStatus(stdout) {
  const fields = String(stdout ?? '').split('\0');
  const entries = [];
  for (let cursor = 0; cursor < fields.length && fields[cursor] !== '';) {
    const status = fields[cursor].trim().charAt(0).toUpperCase();
    const count = status === 'R' || status === 'C' ? 2 : 1;
    if (cursor + count >= fields.length) break;
    for (let n = 1; n <= count; n += 1) entries.push({ status, path: fields[cursor + n] });
    cursor += count + 1;
  }
  return entries;
}

/**
 * The artifact minus the one line a no-op regeneration rewrites — `generatedAt`, measured
 * 2026-10-10. CRLF is normalized because `core.autocrlf` can differ by `\r` alone, not content.
 */
export function withoutGeneratedAt(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .filter((line) => !/"generatedAt"\s*:/.test(line))
    .join('\n');
}

/**
 * Classify a diff into what the suite should run.
 *
 * @param {ReadonlyArray<{ status?: string, path?: string }>} diffEntries
 * @param {{ baselineContentMoved?: boolean }} [options]
 *   `baselineContentMoved` is the ONE fs/git fact the classifier cannot compute: whether
 *   `BASELINE_REL` changed in anything but `generatedAt`. Omitted FAILS CLOSED as "moved", because
 *   the alternative is a content change that silently costs zero tests.
 * @returns {{ mode: 'full' | 'none' | 'subset', paths: string[], code: string, reasons: string[] }}
 *   `code` is the machine-readable verdict: 'empty-diff' / 'trigger' / 'unmapped' /
 *   'baseline-inert' / 'r1-readers' / 'subset'. `mode` alone conflates the trigger fallback
 *   with the unmapped one, so an arm proving either by asserting only `mode` is vacuous.
 */
export function classifyChanged(diffEntries = [], options = {}) {
  const baselineContentMoved = options.baselineContentMoved !== false;
  const entries = mergeEntries(diffEntries);

  if (entries.length === 0) {
    return full('empty-diff', [
      'no changed paths — an empty diff proves nothing, so the whole suite runs'
    ]);
  }

  const triggering = fullFallbackHits(entries);
  if (triggering.length > 0) {
    return full('trigger', [
      `config/infrastructure path (${triggering.map((entry) => entry.path).join(', ')}) — its blast radius is not inferable from a file list, so the whole suite runs`
    ]);
  }

  const mapped = new Set();
  const reasons = [];
  pickTestFiles(entries, mapped, reasons);
  pickSrcAreas(entries, mapped, reasons);
  const guards = populationGuards(entries, baselineContentMoved, reasons);

  // THE NET IS DECIDED ON THE MAPPING ALONE. The population guards are unioned in below
  // (`[...mapped, ...guards]`) and `subset()` adds the whole tier on top, never here: while the guards
  // fed the net, any A/D/R/C (or any diff touching the baseline) made this branch unreachable and
  // `A README.md` selected 13 guard files.
  if (mapped.size === 0) {
    if (!entries.every((entry) => FULL_FALLBACK_EXEMPT.includes(entry.path))) {
      return full('unmapped', [
        'nothing in the diff maps to a test path — so the whole suite runs'
      ]);
    }
    if (!baselineContentMoved) return baselineInert(entries);
    return subset(guards, 'r1-readers', reasons);
  }

  return subset([...mapped, ...guards], 'subset', reasons);
}

/** The changed paths whose blast radius this mapping declines to infer. */
function fullFallbackHits(entries) {
  return entries.filter(
    (entry) =>
      !FULL_FALLBACK_EXEMPT.includes(entry.path) &&
      FULL_FALLBACK_TRIGGERS.some((re) => re.test(entry.path))
  );
}

/**
 * A changed test file is its own selection: run the file the diff touched.
 *
 * `D` is SKIPPED: a deleted path can never be a runnable test, and this function is pure (no
 * `fs`), so this is the only place that fact can be encoded. The runner's downstream
 * `existsSync` filter is too late — a `D tests/**` still counted as `mapped` would keep
 * `mapped.size > 0` and silence the unmapped→full-suite backstop for the whole diff.
 */
function pickTestFiles(entries, picked, reasons) {
  for (const entry of entries) {
    if (!/^tests\/.+\.test\.ts$/.test(entry.path)) continue;
    if (entry.status === 'D') continue;
    picked.add(entry.path);
    reasons.push(`${entry.status || 'M'} ${entry.path} — the test file itself changed`);
  }
}

/**
 * `tests/unit/` directories no `src` area can reach, each with the reason it is a DECISION. The two
 * triggers (`publish`, `scripts`) are per-path; the rest are reached only when nothing else maps.
 */
export const UNREACHABLE_UNIT_DIRS = Object.freeze([
  { dir: 'scripts', reason: 'subject is scripts/** — a FULL_FALLBACK_TRIGGER' },
  { dir: 'publish', reason: 'subject is package.json#files + .github/workflows — both triggers' },
  { dir: 'vendor', reason: 'packages/*/src/vendor/**; full only if nothing else maps' },
  { dir: '_samples', reason: 'unit collection excludes it; only CI `pnpm test:e2e` runs it' },
  { dir: '_setup', reason: 'the test harness itself; full only if nothing else maps' }
]);

/**
 * `src/<dir>/…` → `tests/unit/<dir>` for EVERY directory segment: the top-level rule UNIONED with
 * each deeper segment. Existence is the runner's fs fact — it keeps the paths on disk. A `Set`
 * carries membership and an array carries ORDER: HEAD deduped areas through a `Set`, and an
 * `areas.includes(...)` scan here would make the walk quadratic in the number of entries.
 */
function pickSrcAreas(entries, picked, reasons) {
  const seen = new Set();
  const areas = [];
  for (const entry of entries) {
    const segments = entry.path.split('/');
    if (segments[0] !== 'src' || segments.length < 2) continue;
    for (const area of [segments[1], ...segments.slice(2, -1)]) {
      if (seen.has(area)) continue;
      seen.add(area);
      areas.push(area);
    }
  }
  if (areas.length > 0) {
    for (const area of areas) {
      // vitest path filters: the directory itself, and its trailing-slash spelling.
      picked.add(`tests/unit/${area}`);
      picked.add(`tests/unit/${area}/`);
    }
    reasons.push(`src area(s) ${areas.join(', ')} → tests/unit/<area>`);
    return;
  }
  if (entries.some((entry) => entry.path.startsWith('src/'))) {
    picked.add('tests/unit');
    reasons.push('a src/ path with no area segment → tests/unit');
  }
}

/** R1 + R2 + R3 — why the tier matters on this diff; `subset()` is what always selects it. */
function populationGuards(entries, baselineContentMoved, reasons) {
  const guards = new Set();

  const baselineTouched = entries.some((entry) => entry.path === BASELINE_REL);
  if (baselineTouched && baselineContentMoved) {
    for (const suite of GATE_GUARD_SUITES) guards.add(suite);
    reasons.push(
      `${BASELINE_REL} changed — the suites that guard it are ${GATE_GUARD_SUITES.join(', ')}; a new guard suite must be named in GATE_GUARD_SUITES, and the root of \`tests/unit/\` rides every subset by rule`
    );
  }

  if (entries.some((entry) => entry.path === CENSUS_POLICY_REL)) {
    guards.add(STANDARDS_GUARD_PATH);
    reasons.push(
      `${CENSUS_POLICY_REL} changed — it DEFINES the censused population (FILE_SIZE_SCOPE_DIRS / FILE_SIZE_SCOPE_EXTENSIONS), so the population guards must see it`
    );
  }

  const population = entries.filter((entry) => isPopulationChange(entry.status));
  if (population.length > 0) {
    guards.add(STANDARDS_GUARD_PATH);
    reasons.push(
      `file set changed (${population.map((entry) => `${entry.status || '?'} ${entry.path}`).join(', ')}) — the population guards in ${STANDARDS_GUARD_PATH} must see it`
    );
  }

  return [...guards];
}

/**
 * The diff's only content is the artifact's `generatedAt` stamp, which no guard can observe.
 * 0 tests is the correct answer and is SAID OUT LOUD by the runner — a silent green is
 * indistinguishable from a suite that ran and found nothing.
 *
 * The one path to `mode: 'none'`, and arm-covered: every case the runner cannot read (missing
 * blob, missing worktree file, git failure) reads as content moved instead.
 */
function baselineInert(entries) {
  return {
    mode: 'none',
    paths: [],
    code: 'baseline-inert',
    reasons: [
      `every changed path is gate data (${entries.map((entry) => entry.path).join(', ')}) whose content did not move — only its generatedAt stamp did, which no test can observe; 0 test files, said out loud rather than run`
    ]
  };
}
