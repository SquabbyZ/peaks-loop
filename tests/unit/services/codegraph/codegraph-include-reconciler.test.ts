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
// What must hold:
//   1. The candidate set is DERIVED from upstream's own two tables, so the
//      ORACLE here is re-derived from the same tables at test time rather
//      than hardcoded. A hardcoded list in the test would pass even if the
//      module stopped reading upstream.
//   2. Non-vacuity: the derived set is non-empty and contains the two
//      extensions the live defect is made of, so an always-empty probe fails.
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
import { extname } from 'node:path';
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
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions('tests/unit/services/codegraph/codegraph-include-reconciler.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

// ── the REAL upstream tables (never a list copied into this file) ─────

const require = createRequire(import.meta.url);
const UPSTREAM_ROOT = require.resolve('@colbymchenry/codegraph/package.json');

const UPSTREAM_TYPES = require(UPSTREAM_ROOT.replace(/package\.json$/, 'dist/types.js')) as {
  DEFAULT_CONFIG: { include: string[] };
};
const UPSTREAM_GRAMMARS = require(
  UPSTREAM_ROOT.replace(/package\.json$/, 'dist/extraction/grammars.js')
) as {
  EXTENSION_MAP: Record<string, string>;
  detectLanguage: (filePath: string) => string;
  isLanguageSupported: (language: string) => boolean;
};

// The specification, restated independently of the module: every extension
// the extractor knows, minus the ones upstream's own template already names,
// minus any the extractor would not actually parse.
function expectedUnnamedExtensions(): string[] {
  const named = new Set(
    UPSTREAM_TYPES.DEFAULT_CONFIG.include.map((entry) => extname(entry).toLowerCase())
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

  it('should be non-empty and include the extensions the live defect is made of', () => {
    // Without this, an always-empty implementation would satisfy the
    // equality above only by accident, and the include axis would never be
    // repaired. `.mjs` and `.cjs` are the two measured on this repo (30 + 1
    // of the 31 missing tracked files).
    expect(CANDIDATES.length).toBeGreaterThan(0);
    expect(CANDIDATES).toContain('.mjs');
    expect(CANDIDATES).toContain('.cjs');
  });

  it('should NOT list an extension upstream`s own template already names', () => {
    // The negative polarity of the same claim: `.ts` is named by the default
    // template, so a candidate set that contains it is not derived from the
    // template at all.
    expect(CANDIDATES).not.toContain('.ts');
    expect(CANDIDATES).not.toContain('.tsx');
  });

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

  it('should append every candidate to the real upstream template', () => {
    const plan = normalizeCodegraphInclude({
      include: UPSTREAM_TYPES.DEFAULT_CONFIG.include,
      candidateExtensions: CANDIDATES
    });

    expect(plan.changed).toBe(true);
    expect(plan.addedPatterns).toEqual(CANDIDATES.map((extension) => `**/*${extension}`));
    // The upstream entries survive verbatim, in order, at the front.
    expect(plan.include.slice(0, UPSTREAM_TYPES.DEFAULT_CONFIG.include.length)).toEqual(
      UPSTREAM_TYPES.DEFAULT_CONFIG.include
    );
  });

  it('is idempotent — feeding the repaired list back in changes nothing', () => {
    const first = normalizeCodegraphInclude({
      include: UPSTREAM_TYPES.DEFAULT_CONFIG.include,
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

    // before — the upstream default template, which is what a fresh clone has
    const before = filterAdmittedTrackedFiles(tracked, UPSTREAM_TYPES.DEFAULT_CONFIG.include);
    expect(before).toEqual(['src/ok.ts']);

    // after
    const plan = normalizeCodegraphInclude({
      include: UPSTREAM_TYPES.DEFAULT_CONFIG.include,
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
