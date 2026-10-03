// tests/unit/standards/_scope-shadow-coverage.ts
//
// The TWO-POPULATION reader behind `file-size-cap.test.ts` (F4 and the
// "counted four ways" arm) and the positive controls collected in
// `scope-shadow-coverage.test.ts`. Machinery here, scenarios there — the
// division `_file-size-cap-scan.ts` itself uses, and the only way the arms fit
// under the 500-line tests cap without dropping a single assertion. (The name
// avoids the `file-size` prefix on purpose: `policyWiringFindings` requires any
// file whose NAME claims to enforce the file-size cap to import the policy
// module directly, and this reader enforces it through the gate's own
// partition module, not through a second copy of the rule.)
//
// WHY TWO POPULATIONS EXIST (rid `2026-10-03-w10-rescope-a`, owner decision
// 2026-10-03, backlog §2.42). Before the rescope, "the files the census counts"
// and "the files the artifact has rows for" were the SAME set, and the F4 arm
// compared them directly. The rescope made them deliberately different: the
// CENSUS is still the wide instrument — every tracked file under
// `src/tests/packages/scripts`, measured so the out-of-scope debt stays
// measured (H3) — while the ARTIFACT's `files[]` rows and `ceilings` describe
// only the ENFORCED scope, `src/** + packages/*/src/**`. Both populations are
// correct numbers on the same day: 1495 counted, 943 gated, 552 shadow. What
// replaced the old one-set equality is a stronger accounting identity:
//
//   1. every IN-SCOPE counted file has a row (inside the scope, an omission is
//      still the 2026-09-30 bug: 1424 entries against a 1429-file scope);
//   2. the OUT-OF-SCOPE omissions are exactly what the artifact's `shadow`
//      block claims: their count equals `shadow.measuredFiles`, every path is
//      rooted in one of `shadow.scopeDirs`, and `rows + shadow.measuredFiles`
//      equals the census's own `scope.countedFiles`;
//   3. the ceilings and the shadow's size rows RE-PARTITION a live census:
//      ceiling + shadow = the wide totals the tool just reported, split by the
//      gate's own `.husky/file-size/partition.mjs` — never by a second rule
//      this file could invent.
//
// A plain "552 files have no row" is therefore NOT a refusal any more; an
// in-scope file with no row IS, and an omission the shadow does not account
// for is. The two kinds carry different messages so an operator fixes the
// right thing.

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  REPO_ROOT,
  overCapFromWalk,
  type CensusEnvelope
} from './_file-size-cap-scan.js';

/** The shadow block as the artifact publishes it. Read, never retyped (H3). */
export type ShadowBlock = {
  scopeDirs: readonly string[];
  measuredFiles: number;
  eslintFindings: number;
  eslintErrors: number;
  fileSizeOverCap: number;
  fileSizeExcessLines: number;
};

/** The partition the gate and the generator both run their census through. */
export type CensusSplit = {
  gated: { overCap: number; excessLines: number };
  shadow: { overCap: number; excessLines: number };
};

/** The slice of the published artifact this reader touches — real or fixture. */
export type ArtifactDocument = {
  shadow?: unknown;
  files?: Record<string, unknown>;
  ceilings?: Record<string, unknown>;
};

const num = (value: unknown, what: string): number => {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${what} is missing or not an integer — the artifact predates the rescope`);
  }
  return value;
};

/**
 * The ONE editable scope rule (`.husky/lint-scope.mjs`), loaded the way
 * `lint-file-list-parity.test.ts` and `lint-scope-rule.test.ts` load it. The
 * checker takes the predicate rather than importing it statically so a fixture
 * can hand it a different boundary and watch which kind of problem it reports.
 */
export async function loadLintScopeRule(): Promise<{
  isLintScoped: (file: string) => boolean;
  LINT_SCOPE_RULE: string;
}> {
  return (await import(
    pathToFileURL(join(REPO_ROOT, '.husky', 'lint-scope.mjs')).href
  )) as { isLintScoped: (file: string) => boolean; LINT_SCOPE_RULE: string };
}

/**
 * The gate's OWN partition module (`.husky/file-size/partition.mjs`), imported
 * where it lives — the same module the generator cut the seeded ceilings with —
 * so this reader re-derives the split rather than restating it.
 */
export async function loadCensusPartition(): Promise<{
  partitionCensusOverCap: (env: unknown) => CensusSplit;
}> {
  return (await import(
    pathToFileURL(join(REPO_ROOT, '.husky', 'file-size', 'partition.mjs')).href
  )) as { partitionCensusOverCap: (env: unknown) => CensusSplit };
}

/** The shadow block's CLAIM — the two fields the coverage checker may trust. */
export type ShadowClaim = { scopeDirs: readonly string[]; measuredFiles: number };

/** The artifact's shadow CLAIM, validated: absent or malformed is a throw, not a zero. */
export function shadowClaim(artifact: ArtifactDocument): ShadowClaim {
  const s = artifact.shadow as Record<string, unknown> | undefined;
  if (s === undefined || s === null || typeof s !== 'object') {
    throw new Error('the published artifact carries no `shadow` block');
  }
  if (!Array.isArray(s.scopeDirs) || !s.scopeDirs.every((d) => typeof d === 'string')) {
    throw new Error('artifact `shadow.scopeDirs` is missing or not a string list');
  }
  return { scopeDirs: s.scopeDirs, measuredFiles: num(s.measuredFiles, 'shadow.measuredFiles') };
}

/** The artifact's shadow block, validated field by field — absent is a throw, not a zero. */
export function shadowBlock(artifact: ArtifactDocument): ShadowBlock {
  const s = artifact.shadow as Record<string, unknown>;
  const claim = shadowClaim(artifact);
  return {
    ...claim,
    eslintFindings: num(s.eslintFindings, 'shadow.eslintFindings'),
    eslintErrors: num(s.eslintErrors, 'shadow.eslintErrors'),
    fileSizeOverCap: num(s.fileSizeOverCap, 'shadow.fileSizeOverCap'),
    fileSizeExcessLines: num(s.fileSizeExcessLines, 'shadow.fileSizeExcessLines')
  };
}

/** The three failure kinds F4 now distinguishes; empty/null means the books balance. */
export type CoverageProblems = {
  /** Kind 1 (the old bug, unchanged): an enforced file with no `files[]` row. */
  inScopeMissing: string[];
  /** Kind 2: a counted file with no row that the shadow block does NOT claim. */
  unaccounted: string[];
  /** Kind 3: the counts themselves do not add up; `null` when they do. */
  countProblem: string | null;
};

/**
 * The pure two-population coverage checker. `counted` is the wide census
 * population, `rowFiles` the artifact's `files[]` keys, `shadow` the parsed
 * block, `inEnforcedScope` the boundary rule. Every arm here is the brief's
 * invariant, and a planted defect in ANY of the three inputs must surface as
 * exactly one of the three kinds — that is what the controls in
 * `scope-shadow-coverage.test.ts` plant and watch.
 */
export function baselineCoverageProblems(
  args: {
    counted: readonly string[];
    rowFiles: readonly string[];
    shadow: { scopeDirs: readonly string[]; measuredFiles: number };
    inEnforcedScope: (file: string) => boolean;
  }
): CoverageProblems {
  const rows = new Set(args.rowFiles);
  const omitted = args.counted.filter((file) => !rows.has(file));
  const inScopeMissing = omitted.filter((file) => args.inEnforcedScope(file));
  const outOfScope = omitted.filter((file) => !args.inEnforcedScope(file));
  const rooted = (file: string): boolean =>
    args.shadow.scopeDirs.some((dir) => file === dir || file.startsWith(`${dir}/`));
  const unaccounted = outOfScope.filter((file) => !rooted(file));
  let countProblem: string | null = null;
  if (outOfScope.length !== args.shadow.measuredFiles) {
    countProblem =
      `${outOfScope.length} counted file(s) have no row, but shadow.measuredFiles claims ` +
      `${args.shadow.measuredFiles} — the omission set and the shadow block disagree`;
  } else if (rows.size + args.shadow.measuredFiles !== args.counted.length) {
    countProblem =
      `rows (${rows.size}) + shadow.measuredFiles (${args.shadow.measuredFiles}) != ` +
      `census countedFiles (${args.counted.length}) — some row describes no counted file`;
  }
  return { inScopeMissing, unaccounted, countProblem };
}

/** Read a numeric ceiling row off the artifact — never from a literal. */
export function ceilingNumber(artifact: ArtifactDocument, key: string): number {
  if (artifact.ceilings === undefined) {
    throw new Error('the published artifact carries no `ceilings` block');
  }
  return num(artifact.ceilings[key], `ceilings.${key}`);
}

/**
 * The live census re-partitioned through the GATE's own module, plus the same
 * gated over-cap count from the independent filesystem walk cut by the same
 * rule — the two readings the "counted four ways" arm cross-measures.
 */
export async function censusPartition(envelope: CensusEnvelope): Promise<{
  split: CensusSplit;
  walkGatedOverCap: number;
}> {
  const [{ partitionCensusOverCap }, rule] = await Promise.all([
    loadCensusPartition(),
    loadLintScopeRule()
  ]);
  return {
    split: partitionCensusOverCap(envelope),
    walkGatedOverCap: overCapFromWalk(REPO_ROOT).filter((e) => rule.isLintScoped(e.file)).length
  };
}

/** F4 against a real or fixture artifact document: the three kinds, in one record. */
export async function coverageProblems(
  artifact: ArtifactDocument,
  counted: readonly string[]
): Promise<CoverageProblems> {
  const rule = await loadLintScopeRule();
  return baselineCoverageProblems({
    counted,
    rowFiles: Object.keys(artifact.files ?? {}),
    shadow: shadowClaim(artifact),
    inEnforcedScope: rule.isLintScoped
  });
}
