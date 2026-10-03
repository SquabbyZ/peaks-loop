/**
 * `.husky/lint-scope.mjs` — THE one editable spelling of the strict-legs scope
 * (rid `2026-10-03-w10-rescope-a`, owner decision 2026-10-03, backlog §2.42).
 *
 * THE RULE: `src/**` plus `packages/<anything>/src/**` — "the code that is the
 * product". Not an enumeration of the four current package names: a new
 * `packages/new-pkg/src/a.ts` joins the ENFORCED scope by existing, because the
 * predicate below is a pattern and the artifact's enumerated `scope.dirs` is
 * DERIVED from it (`deriveScopeDirs`, run over `git ls-files` at generation
 * time). Everything that once carried its own copy of the boundary reads it
 * here or reads the artifact this module wrote:
 *   - `.husky/baseline/paths.mjs` (the measurement universe + this rule)
 *   - `scripts/lint/lint-file-list.mjs` `scopeDirs()` — reads `scope.dirs` from
 *     the artifact verbatim, unchanged derivation.
 *   - the per-file ratchet (`inScope` in `.husky/gate/context.mjs`) — same path.
 *
 * MEASURED_DIRS vs `FILE_SIZE_SCOPE_DIRS`. This gate world is plain `.mjs` and
 * cannot import the `.ts` policy, so the universe is spelled twice on purpose —
 * the same bridge posture as `EXTENSIONS` / `FILE_SIZE_SCOPE_EXTENSIONS`. It is
 * a copy NOTHING may leave unobserved: `tests/unit/lint/lint-scope-rule.test.ts`
 * compares the two lists arm-for-arm (item 8 of the slice brief — a copy that
 * nothing observes is how §2.28 happened).
 */

/** The rule, in the words the refusal messages quote. */
export const LINT_SCOPE_RULE = 'src/** + packages/*/src/**';

/**
 * The generator's MEASUREMENT universe: every file the legs still walk, so the
 * out-of-scope debt stays measured (shadow rows, H3). Mirrors
 * `FILE_SIZE_SCOPE_DIRS` in `src/services/scan/file-size-policy.ts`; the gated
 * subset below is what the ceilings actually enforce.
 */
export const MEASURED_DIRS = ['src', 'tests', 'packages', 'scripts'];

const PACKAGE_SRC = /^packages\/([^/]+)\/src\//;

/** Forward slashes, so a Windows-native path matches the same rule as a POSIX one. */
const posix = (file) => file.split('\\').join('/');

/** True when `file` is in the ENFORCED lint scope (the owner's 2026-10-03 boundary). */
export function isLintScoped(file) {
  const path = posix(file);
  return path.startsWith('src/') || PACKAGE_SRC.test(path);
}

/** Split a measured list into the enforced subset and the shadow subset. */
export function partitionLintScope(files) {
  const gated = [];
  const shadow = [];
  for (const file of files) (isLintScoped(file) ? gated : shadow).push(file);
  return { gated, shadow };
}

/**
 * The artifact's `scope.dirs`, DERIVED from the gated paths (never typed): the
 * distinct `src` and `packages/<name>/src` prefixes this population actually
 * contains, sorted. `scopeDirs()` reads the result verbatim, so a new package
 * appears here the run its first `src/` file is tracked — no constant to edit.
 */
export function deriveScopeDirs(gatedFiles) {
  const dirs = new Set();
  for (const file of gatedFiles) {
    if (file.startsWith('src/')) dirs.add('src');
    else {
      const hit = PACKAGE_SRC.exec(posix(file));
      if (hit !== null) dirs.add(`packages/${hit[1]}/src`);
    }
  }
  return [...dirs].sort();
}

/**
 * Where the shadow population lives, for `shadow.scopeDirs`: the `packages/<name>`
 * parent for package files, the top-level directory otherwise. The point is that a
 * reader can see where the boundary was drawn, not re-derive it from 552 rows.
 */
export function shadowScopeDirs(shadowFiles) {
  const dirs = new Set();
  for (const file of shadowFiles) {
    const path = posix(file);
    const pkg = /^packages\/[^/]+(?=\/)/.exec(path);
    if (pkg !== null) dirs.add(pkg[0]);
    else {
      const slash = path.indexOf('/');
      dirs.add(slash < 0 ? path : path.slice(0, slash));
    }
  }
  return [...dirs].sort();
}
