#!/usr/bin/env node
/**
 * scripts/test-changed-root-tier.mjs — the ROOT of `tests/unit/`, selected by RULE.
 *
 * THE HOLE THIS CLOSES. The area rule maps `src/<area>` to `tests/unit/<area>` — always a
 * SUBDIRECTORY. A test file at the ROOT of `tests/unit/` therefore has no area, and nothing
 * reaches it by construction. That is not theoretical: slice s10 added a test file with an
 * unflagged `child_process` call site, the repository's spawn-hygiene ratchet caught it — and
 * the ratchet lives at the ROOT, so four reviewers, QA and both tiers were blind to a defect in
 * the slice's own new file. Only the full suite runs it, and only a push runs the full suite.
 *
 * WHY A SELECTOR, AND WHY THIS MODULE EXPANDS IT. "Union the root's `*.test.ts`" is a statement
 * about a RULE, not a path string, and both halves of that were measured on vitest 4.1.10:
 * `filterFiles` matches a filter with `String.includes` — no glob, no depth branch — so
 * `tests/unit/` is a substring of all 494 test files under it and `tests/unit/*.test.ts` matches
 * NONE of them. Worse, the runner filters candidates through `existsSync`, and
 * `existsSync('tests/unit/*.test.ts')` is FALSE: an unexpanded selector is dropped SILENTLY, and
 * a lone selector would escalate to the full suite — a cost increase wearing the bug's clothes.
 * So the classifier DECLARES the selector (it may hold no fs fact, and the selector is the tier's
 * third member, so it is declared where `GATE_GUARD_SUITES` is), the runner reads the directory
 * listing (it already owns every fs fact), and the rule turning one into the other lives HERE,
 * where it can be armed instead of merely stated.
 *
 * WHY THIS IS NOT A THIRD MEMBER OF `GATE_GUARD_SUITES`. That constant is pinned by two arms as a
 * set of DIRECTORIES THAT EXIST ON DISK — `existsSync(join(REPO_ROOT, suite))`, and a `mkdirSync`
 * in two end-to-end fixtures. A selector is neither, and `*` is not a legal Windows directory
 * name. `GATE_GUARD_SUITES` stays exactly the two directories it names; the root is a different
 * KIND of member and gets its own representation.
 *
 * WHY A SEPARATE MODULE AND NOT MORE LINES IN THE CLASSIFIER. A measured budget, not taste: the
 * file-size census asserts `shadow.fileSizeExcessLines` by EQUALITY
 * (`tests/unit/standards/file-size-cap.test.ts`), and `scripts/test-changed-classify.mjs` already
 * carries 66 excess lines. A file UNDER its cap adds nothing to that sum, so the rule's narrative
 * — which a contributor has to be able to find — is paid for here, at zero census cost. The
 * classifier also IMPORTS NOTHING by design: three plant arms write a copy of it into a temp
 * directory and import that, so a relative import would break every one of them.
 *
 * THE CONVENTION, WRITTEN DOWN (it was unstated and unenforced before this module). A file at the
 * ROOT of `tests/unit/` is asserting something about the REPOSITORY, and is bought a permanent
 * slot in every subset verdict for the rest of the repository's life. A file-scoped test belongs
 * in an area directory. No arm can state that rule — "is this test's subject the repository?" is
 * exactly the predicate that does not exist (four measured counterexamples, PRD 010 §"THE
 * POPULATION") — so it is stated here, where a contributor meets it, and nowhere else.
 *
 * WHAT THE SLOT COSTS, AND WHY THE SHAPE OF THE FILE MATTERS MORE THAN ITS SIZE. Measured on this
 * host 2026-10-16, six runs: the tier's wall clock has a **2× spread** (248 s vs 124 s back to
 * back), so no percentage against it is a measurement — the stable instrument is vitest's own
 * aggregate `import`, which the root trio moves by **+1.6 s ± 0.15 s**. Of that, the tests are
 * **13 ms** for all 32 of them; the rest is import, and almost all of it is ONE file
 * (`spawn-windows-hide-guard.test.ts`, whose top-level IIFE imports `typescript` and walks the
 * tree at module scope). The asymmetry is the thing to remember: **a root file with many cheap
 * tests is nearly free, and a root file that scans the repository at module scope costs about
 * 1.3 s on every subset verdict, forever.** Three small files also land in a 59-file queue whose
 * workers are already busy, so at `maxWorkers = 2` the critical path moves by at most +0.8 s and
 * was measured to absorb to ~0 s. The price is import-shaped and fixed, not proportional to what
 * you add — but it is paid on every push, so pay it with a file that tests something.
 *
 * Dimensions: this module renders nothing and produces no human-facing text, so no
 * `declareDimensions` suite covers it; its arms live in
 * `tests/unit/scripts/test-changed-guard-tier.test.ts`, beside the tier's.
 */

import { ROOT_TIER_SELECTOR } from './test-changed-classify.mjs';

/**
 * THE ROOT'S VOCABULARY, DECLARED HERE AND RECONCILED WITH THE CLASSIFIER AT LOAD.
 *
 * The directory and the file-name pattern are the two halves of the selector the classifier
 * declares, and this module declares both of them itself rather than deriving one from the other's
 * TEXT. The derivation is what must not happen: `String.replace` with no match returns its input
 * unchanged, so a selector that stopped carrying the suffix would silently yield a directory
 * literally named `tests/unit/*.test.ts`, this module would walk nothing, and the gate would stay
 * green. The reconciliation below is one comparison, it runs once per process, and it THROWS — so
 * the runner cannot start at all on a mismatch, which is louder than any runtime branch.
 *
 * The `String(...)` in the message is not decoration: this binding arrives through a sibling `.mjs`
 * import that carries no type information, and `@typescript-eslint/restrict-template-expressions`
 * reads it as `never`. The conversion belongs at the point of use — the message has to be able to
 * print the value that failed, and a disabled rule or a widened one would hide the next real one.
 */
const ROOT_DIR = 'tests/unit';
const SELECTOR_FILE = '*.test.ts';
if (`${ROOT_DIR}/${SELECTOR_FILE}` !== ROOT_TIER_SELECTOR) {
  throw new Error(
    `the classifier declares ROOT_TIER_SELECTOR ${String(ROOT_TIER_SELECTOR)}, not ${ROOT_DIR}/${SELECTOR_FILE}`
  );
}

/**
 * The root selector → the test files the directory listing actually holds.
 *
 * `rootListing` is a bare `readdirSync` of the root: names, not paths, and NOT filtered by
 * `isFile` — an entry that is a directory fails the `.test.ts` shape test anyway, and asking the
 * fs one more question to answer something a string already answers is a second fs fact. It is NOT
 * defaulted: a caller that forgets the listing gets a loud TypeError rather than a silent zero, the
 * same way a caller that forgets `paths` gets one.
 *
 * THE BOUND IS THE SHAPE TEST, NOT A COUNT. The root can never contribute a nested file, because
 * only a name with NO separator and the `.test.ts` suffix is admitted: `services`, `sub/n.test.ts`
 * and `sub\\n.test.ts` are all refused, and the bare `tests/unit` / `tests/unit/` can never be an
 * output at all (every output carries a file name). `tests/unit/` is a substring of all 494 test
 * files, so this is the difference between 3 files and the whole unit suite.
 *
 * THE MATCH IS THE CONTRACT, NOT A CHARACTER CLASS. An entry is expanded when it IS the selector
 * the union declared, by `===`; every other entry is passed through UNCHANGED, because the runner
 * owns the fs fact of what exists and this module owns only the rule. An earlier draft refused any
 * entry containing `*` — and `*` is a legal POSIX file name that the classifier copies verbatim out
 * of a diff, so a push touching `tests/unit/scripts/wild*card.test.ts` died with exit 1 before
 * `existsSync` ever ran. Narrowed, not deleted: the refuse below fires only for a ROOT-LEVEL
 * pattern, which no path under a subdirectory and no ordinary file name can be.
 *
 * THROWS on such a root-level selector, and that is the fail-CLOSED direction. Passed through, it
 * would be dropped by the runner's `existsSync` filter (vitest's own filter is a case-insensitive
 * `String.includes`, so no glob ever runs) and the run would stay green with a guard missing.
 */
export function expandRootTier(paths, rootListing) {
  const root = [];
  for (const name of rootListing) {
    if (/^[^/\\]+\.test\.ts$/.test(name)) root.push(`${ROOT_DIR}/${name}`);
  }
  return [
    ...new Set(
      paths.flatMap((path) => {
        if (path === ROOT_TIER_SELECTOR) return root;
        if (path.startsWith(`${ROOT_DIR}/*`)) {
          throw new Error(`no rule in this module expands the selector ${path}`);
        }
        return [path];
      })
    )
  ];
}
