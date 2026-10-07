// tests/unit/services/codegraph/codegraph-include-reconciler.test.ts
//
// 4-dimension unit test for
// `src/services/codegraph/codegraph-include-reconciler.ts` (slice-002 of
// rid-2026-09-16-codegraph-index-integrity).
//
// The defect this guards: upstream `@colbymchenry/codegraph` decides what to
// parse from its own `EXTENSION_MAP`, but `init` writes a `DEFAULT_CONFIG`
// `include` template that omits five of those extensions (`.mjs`, `.cjs`,
// `.pyw`, `.hxx`, `.rake`). `mergeConfig` has no separate override channel,
// so a fresh clone indexes none of them while `status` says the index is up
// to date — on this repo, 31 tracked files.
//
// UPGRADE NOTE (codegraph 1.6.2). That defect, and the question this module
// asks, belong to an upstream that ships an `include` template. 1.6.2 does
// not: `init` writes no `config.json`, there is no `DEFAULT_CONFIG`, and
// indexing is decided by `.gitignore`. The derivation is unchanged and now
// names EVERY supported extension as a candidate, because an absent template
// names nothing. That consequence is pinned below as a measured property of
// the installed package, not left to be discovered, and the cases whose
// subject is the pure normalizer run against a small template fixture so
// they keep their coverage. What the consequence should MEAN for the include
// axis is the deferred config-axis slice's decision; see the module's note.
//
// What must hold:
//   1. The candidate set is DERIVED from upstream's own two tables, so the
//      ORACLE here is re-derived from the same tables at test time rather
//      than hardcoded. A hardcoded list in the test would pass even if the
//      module stopped reading upstream.
//   2. The derived set is non-empty and AGREES with that independent
//      re-derivation, so an always-empty probe fails.
//   3. Normalization is APPEND-ONLY and idempotent — a user entry is never
//      removed or reordered, and a second pass adds nothing.
//   4. Coverage is decided by the SAME matcher the exclude reconciler uses
//      (picomatch via `matchesCodegraphGlob`), so `**/*` and a brace list
//      are both recognised as already covering an extension.
//   5. The proxy limit (a path-narrowed rule does not cover the root probe)
//      is PINNED by a test rather than left to be discovered.
//
// Dimensions covered:
//   - behavior:    the pure normalizer (append-only, idempotent, coverage)
//   - integration: the real installed `@colbymchenry/codegraph` tables
//   - render:      the appended pattern text, and the config list it produces
//   - a11y:        omitted — the module prints nothing and returns a plan
//
// Run with: pnpm vitest run tests/unit/services/codegraph/codegraph-include-reconciler.test.ts

import { createRequire } from 'node:module';
import { extname, join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Counts every `picomatch(...)` parse while passing straight through to the
// real implementation. Perf audit S10: the normalizer used to test each
// candidate against the whole include list by recompiling every rule on every
// candidate — quadratic in the rule count (0.25 / 2.15 / 23.4 / 234.4 ms at
// 32 / 320 / 3,200 / 32,000 rules) plus a spread array per candidate. The
// count is the assertion, so this is a structural pin rather than a timing
// measurement that would vary by machine.
const picomatchCalls = vi.hoisted(() => ({ patterns: [] as string[] }));

vi.mock('picomatch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('picomatch')>();
  // `picomatch` is `export =`, so the namespace carries the callable as
  // `default` at run time while the TYPE models it as the call signature
  // itself. The cast is the interop seam, not a shortcut.
  const realPicomatch = actual as unknown as {
    default: (pattern: string, options?: unknown) => unknown;
  };

  return {
    ...actual,
    default: (pattern: string, options?: unknown): unknown => {
      picomatchCalls.patterns.push(pattern);
      return realPicomatch.default(pattern, options);
    }
  };
});

import {
  normalizeCodegraphInclude,
  upstreamUnnamedIncludeExtensions
} from '../../../../src/services/codegraph/codegraph-include-reconciler.js';
import { filterAdmittedTrackedFiles } from '../../../../src/services/codegraph/codegraph-exclude-reconciler.js';
import { resolveCodegraphUpstreamLayout } from '../../../../src/services/codegraph/codegraph-upstream-layout.js';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions('tests/unit/services/codegraph/codegraph-include-reconciler.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

// ── the REAL upstream tables (never a list copied into this file) ─────

const require = createRequire(import.meta.url);
// Read through the SAME resolver the production oracle uses, so this file
// cannot disagree with the module about where upstream's tables live — and
// so it keeps reading them from the per-platform bundle under 1.6.x, where
// the main package carries no `.js` at all.
const UPSTREAM_MODULE_DIR = resolveCodegraphUpstreamLayout().moduleDir;

// `DEFAULT_CONFIG` is OPTIONAL because it is absent from 1.6.x: that
// release's `types.js` exports only NODE_KINDS / EDGE_KINDS / LANGUAGES, it
// writes no `config.json`, and it decides what to index from `.gitignore`
// instead of from an `include` list. Typing it as possibly-undefined is
// what makes the absence part of the test's subject rather than a crash.
const UPSTREAM_TYPES = require(join(UPSTREAM_MODULE_DIR, 'types.js')) as {
  DEFAULT_CONFIG?: { include: string[] };
};
const UPSTREAM_GRAMMARS = require(join(UPSTREAM_MODULE_DIR, 'extraction', 'grammars.js')) as {
  EXTENSION_MAP: Record<string, string>;
  detectLanguage: (filePath: string) => string;
  isLanguageSupported: (language: string) => boolean;
};

// An include list for the cases whose subject is the PURE NORMALIZER. They
// need some realistic starting list, and the normalizer is template-agnostic,
// so a fixture exercises them exactly as well as upstream's own would. The
// one case whose subject IS upstream's data (`should match the set re-derived
// here…`) deliberately uses the live derivation instead.
const TEMPLATE_INCLUDE: readonly string[] = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.py'];

// The specification, restated independently of the module: every extension
// the extractor knows, minus the ones upstream's own template already names,
// minus any the extractor would not actually parse. `?? []` mirrors the
// module: an upstream with no template has named no extension, so under
// 1.6.2 this is the whole supported table (78 measured) rather than 0.7.x's
// five — the upgrade's visible consequence, pinned by the case below.
function expectedUnnamedExtensions(): string[] {
  const named = new Set(
    (UPSTREAM_TYPES.DEFAULT_CONFIG?.include ?? []).map((entry) => extname(entry).toLowerCase())
  );

  return Object.keys(UPSTREAM_GRAMMARS.EXTENSION_MAP).filter(
    (extension) =>
      !named.has(extension.toLowerCase()) &&
      UPSTREAM_GRAMMARS.isLanguageSupported(UPSTREAM_GRAMMARS.detectLanguage(`probe${extension}`))
  );
}

const CANDIDATES = upstreamUnnamedIncludeExtensions();

// ── integration: the candidate set comes from upstream ───────────────

describe('upstreamUnnamedIncludeExtensions (derived from upstream)', () => {
  it('should match the set re-derived here from upstream`s own two tables', () => {
    expect([...CANDIDATES]).toEqual(expectedUnnamedExtensions());
  });

  it('should list EVERY supported extension, because 1.6.x ships no template to name any', () => {
    // This case REPLACES one named "should be non-empty and include the
    // extensions the live defect is made of", which asserted exactly
    // `.mjs` and `.cjs`. That assertion has no subject under 1.6.2: the
    // defect it named — upstream's `init` template omitting five extensions
    // its own extractor supports — cannot occur when there is no template
    // and no `include` allow-list at all.
    //
    // The set is not empty, though, and that is the upgrade's visible
    // consequence rather than a bug: an absent template names nothing, so
    // the derivation's condition "not named by the template" is true of
    // every extension. So the case states the measured shape instead of
    // pretending the axis still behaves — and it is the first assertion that
    // carries the weight, because it pins the CAUSE to a measured property
    // of the installed package. It goes red the day upstream ships a
    // template again and the derivation has something to exclude.
    expect(UPSTREAM_TYPES.DEFAULT_CONFIG).toBeUndefined();
    expect(CANDIDATES.length).toBeGreaterThan(0);
    expect(CANDIDATES).toContain('.mjs');
    expect(CANDIDATES).toContain('.cjs');
    // …and this is the part that is genuinely different from 0.7.x: `.ts` is
    // a candidate now, because nothing named it.
    expect(CANDIDATES).toContain('.ts');
  });

  // DELETED CASE: "should NOT list an extension upstream's own template
  // already names", which asserted `.ts` / `.tsx` were ABSENT. It guarded the
  // naming-exclusion half of the derivation, and its premise was that a
  // template names `.ts`. There is no template, so `.ts` is correctly a
  // candidate and the assertion is simply false — not weakened, false. The
  // naming-exclusion logic itself is still exercised: the coverage cases
  // below feed the normalizer a list that already admits an extension and
  // require the corresponding candidate NOT to be re-appended.

  it('should return the same array on every call', () => {
    expect(upstreamUnnamedIncludeExtensions()).toBe(CANDIDATES);
  });
});

// ── behavior: the pure normalizer ────────────────────────────────────

describe('normalizeCodegraphInclude (pure plan)', () => {
  beforeEach(() => {
    picomatchCalls.patterns.length = 0;
  });

  it('should compile each rule ONCE, not once per (candidate x rule) pair', () => {
    const include = ['a/**', 'b/**', 'c/**', 'd/**'];
    const candidates = ['.mjs', '.cjs'];

    const plan = normalizeCodegraphInclude({ include, candidateExtensions: candidates });

    expect(plan.addedPatterns).toEqual(['**/*.mjs', '**/*.cjs']);
    // 4 rules compiled once + one compile per appended pattern = 6. The
    // per-(candidate x rule) implementation this replaced compiled the whole
    // list again for each candidate — 4 + 5 = 9 here, and quadratic in the
    // rule count (measured at 234 ms for 32,000 rules).
    expect(picomatchCalls.patterns).toHaveLength(include.length + plan.addedPatterns.length);
    // …and it compiled the RULES, not an expanded spread of them: a
    // re-parsing implementation repeats entries, which this pins directly.
    expect(new Set(picomatchCalls.patterns).size).toBe(picomatchCalls.patterns.length);
  });

  it('should append every candidate the list does not admit, leaving its entries in front', () => {
    // `candidateExtensions` is upstream's raw table, NOT a pre-filtered set:
    // the list's own patterns are part of the decision. That distinction did
    // not show under 0.7.x, where the candidates were exactly the extensions
    // no template pattern admitted — but 1.6.x's candidate set is the whole
    // supported table, so it includes extensions this fixture already covers,
    // and those must not be appended a second time.
    const plan = normalizeCodegraphInclude({
      include: TEMPLATE_INCLUDE,
      candidateExtensions: CANDIDATES
    });

    const uncovered = CANDIDATES.filter(
      (extension) =>
        filterAdmittedTrackedFiles([`probe${extension}`], TEMPLATE_INCLUDE).length === 0
    );

    expect(plan.changed).toBe(true);
    expect(plan.addedPatterns).toEqual(uncovered.map((extension) => `**/*${extension}`));
    expect(plan.addedPatterns.length).toBeGreaterThan(0);
    // The caller's entries survive verbatim, in order, at the front.
    expect(plan.include.slice(0, TEMPLATE_INCLUDE.length)).toEqual(TEMPLATE_INCLUDE);
  });

  it('is idempotent — feeding the repaired list back in changes nothing', () => {
    const first = normalizeCodegraphInclude({
      include: TEMPLATE_INCLUDE,
      candidateExtensions: CANDIDATES
    });
    const second = normalizeCodegraphInclude({
      include: first.include,
      candidateExtensions: CANDIDATES
    });

    expect(second.changed).toBe(false);
    expect(second.addedPatterns).toEqual([]);
    expect(second.include).toEqual(first.include);
  });

  it('should add NOTHING when the list already covers every extension', () => {
    // `**/*` admits every path, so every candidate extension is covered. This
    // is the clean control for the whole module: without it, an
    // implementation that always appends would pass every other case here.
    const plan = normalizeCodegraphInclude({
      include: ['**/*'],
      candidateExtensions: CANDIDATES
    });

    expect(plan.changed).toBe(false);
    expect(plan.addedPatterns).toEqual([]);
    expect(plan.include).toEqual(['**/*']);
  });

  it('should recognise an extended (brace) rule as covering the extensions it names', () => {
    // Coverage is decided by the real matcher, not by string equality: this
    // rule names js/mjs/cjs inside a brace list, which no `includes()` check
    // could see.
    const plan = normalizeCodegraphInclude({
      include: ['**/*.{js,mjs,cjs}'],
      candidateExtensions: CANDIDATES
    });

    expect(plan.addedPatterns).not.toContain('**/*.mjs');
    expect(plan.addedPatterns).not.toContain('**/*.cjs');
    expect(plan.addedPatterns).toContain('**/*.rake');
  });

  it('should never remove, reorder or rewrite a user entry', () => {
    const include = ['src/**/*.ts', '**/*.vendor.js', '', '**/*.py'];
    const plan = normalizeCodegraphInclude({ include, candidateExtensions: ['.mjs'] });

    // The junk empty rule survives too: this module appends, and an empty
    // rule is the exclude reconciler's documented problem (it skips it when
    // compiling), not this one's.
    expect(plan.include.slice(0, include.length)).toEqual(include);
    expect(plan.include.length).toBe(include.length + 1);
  });

  it('should tolerate an empty include list and a junk empty rule without throwing', () => {
    // `picomatch('')` throws, and a config carrying `"include": [""]` used to
    // abort the exclusion reconciliation. The matcher below is the same one,
    // so the same guard has to hold here.
    expect(normalizeCodegraphInclude({ include: [], candidateExtensions: ['.mjs'] }).changed).toBe(
      true
    );
    expect(
      normalizeCodegraphInclude({ include: [''], candidateExtensions: ['.mjs'] }).addedPatterns
    ).toEqual(['**/*.mjs']);
  });

  it('should not append a duplicate candidate twice', () => {
    // The second and third candidates are the same extension as the first, so
    // the append that already happened covers them — dedupe is by EFFECT
    // (the matcher), not by string equality against the input list.
    const plan = normalizeCodegraphInclude({
      include: [],
      candidateExtensions: ['.pyw', '.pyw', 'pyw']
    });

    expect(plan.addedPatterns).toEqual(['**/*.pyw']);
  });

  it('for an extension-only candidate list, should accept both dotted and bare forms', () => {
    expect(
      normalizeCodegraphInclude({ include: [], candidateExtensions: ['mjs'] }).addedPatterns
    ).toEqual(['**/*.mjs']);
  });
});

// ── render + behavior: the plan really admits the files that were dropped ──

describe('the appended patterns admit what the unpinned include dropped', () => {
  it('should turn a not-admitted tracked .mjs into an admitted one', () => {
    const tracked = ['src/ok.ts', 'scripts/tool.mjs'];

    // before — the template fixture, which is what a template-bearing
    // upstream's fresh clone has (1.6.x clones have no config at all)
    const before = filterAdmittedTrackedFiles(tracked, TEMPLATE_INCLUDE);
    expect(before).toEqual(['src/ok.ts']);

    // after
    const plan = normalizeCodegraphInclude({
      include: TEMPLATE_INCLUDE,
      candidateExtensions: CANDIDATES
    });
    const after = filterAdmittedTrackedFiles(tracked, plan.include);
    expect(after).toEqual(tracked);
  });

  it('should pin the KNOWN proxy limit — a path-narrowed rule does not cover the root probe', () => {
    // Measured, not hypothetical: `src/**/*.mjs` does not admit a root-level
    // `tool.mjs`, so `.mjs` counts as uncovered and the bare pattern is
    // appended. This errs ADDITIVE (the index admits more, never fewer) and
    // is asserted here so the behaviour is a decision rather than a
    // discovery.
    const plan = normalizeCodegraphInclude({
      include: ['src/**/*.mjs'],
      candidateExtensions: ['.mjs']
    });

    expect(plan.addedPatterns).toEqual(['**/*.mjs']);
    expect(filterAdmittedTrackedFiles(['tool.mjs'], plan.include)).toEqual(['tool.mjs']);
  });

  it('DECLARED LIMITATION — an UPPERCASE extension is still dropped, and is not repaired here', () => {
    // Upstream's `detectLanguage` lowercases the extension
    // (`grammars.js`: `filePath.substring(lastIndexOf('.')).toLowerCase()`),
    // so a tracked `Tool.MJS` IS something its extractor would parse — while
    // every include pattern in its template (and ours) matches case
    // SENSITIVELY, so `**/*.mjs` does not admit it.
    //
    // This module does NOT close that: `.MJS` is not a key of
    // `EXTENSION_MAP`, so it is not a candidate, and emitting every case
    // variant of every extension would multiply the appended patterns for a
    // naming style that a real repository of source files does not use. Pinned
    // here so the residual is a recorded decision rather than an unexamined
    // blind spot — and it is still DETECTED, because the inspector reports any
    // supported tracked file the include list does not admit.
    expect(UPSTREAM_GRAMMARS.detectLanguage('Tool.MJS')).toBe('javascript');
    expect(filterAdmittedTrackedFiles(['Tool.MJS'], ['**/*.mjs'])).toEqual([]);
    expect(CANDIDATES).not.toContain('.MJS');
  });
});
