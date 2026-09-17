// src/services/codegraph/codegraph-include-reconciler.ts
//
// Slice-002 of `2026-09-16-codegraph-index-integrity` — the INCLUDE axis
// of the config repair. It answers one question:
//
//   "Which extensions does upstream's extractor support but upstream's own
//    default `include` template never names, and which of those does THIS
//    project's `include` still not admit?"
//
// Why this exists (the real defect, measured): upstream
// `@colbymchenry/codegraph` decides what to parse from its own
// `EXTENSION_MAP` (37 extensions in 0.7.10), but `init` writes a 32-entry
// `DEFAULT_CONFIG.include` template that names only 32 of them. Five
// supported extensions are therefore absent from every fresh config:
// `.mjs`, `.cjs`, `.pyw`, `.hxx`, `.rake`. Upstream's `mergeConfig` has no
// separate override channel — `config.json`'s `include` replaces the
// defaults wholesale — so a fresh clone indexes none of them while
// `peaks codegraph status` still prints `[OK] Index is up to date`. On this
// repo that was 31 tracked files (30 `.mjs` + 1 `.cjs`) absent from a
// 1220-row index. It is the same class of defect as upstream's default
// `exclude` template colliding with real source directories, which slice S2
// of `2026-09-12-codegraph-exclude-integrity` already self-heals at the
// `init` seam; the include axis was simply never reconciled.
//
// Genericity (binding — mirrors the exclude reconciler): no hardcoded
// extension list, no hardcoded rule names, no project-specific paths. The
// candidate set is COMPUTED from upstream's own two tables (`EXTENSION_MAP`
// in `dist/extraction/grammars.js`, `DEFAULT_CONFIG` in `dist/types.js`),
// and every candidate is confirmed against upstream's own decision pair
// (`isLanguageSupported(detectLanguage(...))` — the same two functions
// `extraction/index.js` calls). Upstream can add an extension tomorrow and
// this module picks it up with no edit here; the "five" above is a
// measurement, not a constant in the code.
//
// Additive, never clobbering: a project's `include` is append-only from
// here. No user entry is removed, reordered or rewritten, and an extension
// any existing entry already admits is left alone. Append-only is the same
// posture `codegraph-exclude-repair.ts` takes toward a third-party config
// file it edits.
//
// Scope: PURE (`normalizeCodegraphInclude`) plus ONE read-only adapter
// (`upstreamIncludeCandidateExtensions`, which reads the installed upstream
// package). Nothing in this module writes a file.
//
// NOTE FOR FUTURE EDITORS: glob literals contain the two-character
// sequence that ends a block comment, so every comment in this file uses
// `//` lines — INCLUDING the exported API documentation, which is why this
// file has no `/** ... */` blocks. Do not convert them.

import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';

import { compileCodegraphGlobs, type CompiledCodegraphGlobs } from './codegraph-exclude-reconciler.js';

// ─────────────────────────────────────────────────────────────────────
// Which extensions does this project's `include` already admit?
// ─────────────────────────────────────────────────────────────────────

// The pattern upstream's own template uses for a bare extension: all 32
// entries of `DEFAULT_CONFIG.include` have exactly this shape, and they are
// matched with `picomatch(..., { dot: true })` — the same engine, and the
// same options, that `matchesCodegraphGlob` delegates to. So an appended
// pattern is indistinguishable in form from an upstream-authored one.
function includePatternForExtension(extension: string): string {
  return `**/*${extension}`;
}

// A synthetic path used ONLY to ask "does any existing rule admit a file
// with this extension". A root-level probe answers that question exactly
// for every pattern shape upstream itself writes, because `picomatch`'s
// trailing-slash-star-star prefix matches zero path segments (measured:
// the `.mjs` pattern matches both `probe.mjs` and `a/b/probe.mjs`).
//
// KNOWN PROXY LIMIT, stated rather than hidden: a path-narrowed rule such as
// a `src`-prefixed brace list of js/mjs does NOT match the root-level probe,
// so an extension admitted only under a subdirectory is treated as
// uncovered and the bare extension pattern is appended. That errs ADDITIVE —
// the index admits more tracked files, never fewer — and it is pinned by a
// test rather than left to be discovered. A false "already covered" cannot
// occur for any pattern upstream's template can produce, and if it did its
// only effect would be to leave the gap the inspector already reports.
function extensionProbePath(extension: string): string {
  return `codegraph-include-probe${extension}`;
}

// Compiled ONCE per rule, never per (candidate x rule) pair — see
// `compileCodegraphGlobs`. The `matchers` list is the include list the
// candidate is tested against: the caller's entries first, then the
// patterns this same pass has already decided to append, so a duplicate
// candidate cannot append twice without re-parsing the list each time
// (perf audit S10: the re-parse was 0.25 / 2.15 / 23.4 / 234.4 ms at
// 32 / 320 / 3,200 / 32,000 rules, plus a spread array per candidate).
function isExtensionAdmitted(
  extension: string,
  matchers: readonly CompiledCodegraphGlobs[]
): boolean {
  const probe = extensionProbePath(extension);
  return matchers.some((matcher) => matcher.matchesAny(probe));
}

// ─────────────────────────────────────────────────────────────────────
// Pure normalization
// ─────────────────────────────────────────────────────────────────────

export type CodegraphIncludeNormalizePlan = {
  // True when at least one pattern would actually be appended.
  readonly changed: boolean;
  // The `include` array after the appends.
  readonly include: readonly string[];
  // Patterns appended, in candidate order. Empty when `changed` is false.
  readonly addedPatterns: readonly string[];
};

// Pure: given the current `include` list and the extensions upstream
// supports but its own template omits, return the list with the uncovered
// ones appended. No fs, no clock, no serialization.
//
// The result is always a SUPERSET of the input, in the input's order, so a
// caller can never remove or reorder a user entry. Appending an extension
// the list already admits is a no-op, which is what makes the whole
// normalization idempotent: feeding the repaired list back in yields
// `changed: false`.
//
// Candidates are de-duplicated by their EFFECT, not by string equality:
// each candidate is tested against the input list PLUS the patterns this
// call has already appended, so a duplicate candidate cannot append twice.
export function normalizeCodegraphInclude(input: {
  readonly include: readonly string[];
  readonly candidateExtensions: readonly string[];
}): CodegraphIncludeNormalizePlan {
  const addedPatterns: string[] = [];
  // The include list as this pass sees it, compiled once. Appending a
  // pattern extends the list by ONE compiled rule instead of re-parsing
  // every entry on the next candidate (see `isExtensionAdmitted`).
  const matchers: CompiledCodegraphGlobs[] = [compileCodegraphGlobs(input.include)];

  for (const candidate of input.candidateExtensions) {
    const extension = candidate.startsWith('.') ? candidate : `.${candidate}`;
    if (isExtensionAdmitted(extension, matchers)) {
      continue;
    }

    const pattern = includePatternForExtension(extension);
    addedPatterns.push(pattern);
    matchers.push(compileCodegraphGlobs([pattern]));
  }

  if (addedPatterns.length === 0) {
    return { changed: false, include: input.include, addedPatterns: [] };
  }

  return {
    changed: true,
    include: [...input.include, ...addedPatterns],
    addedPatterns
  };
}

// ─────────────────────────────────────────────────────────────────────
// Upstream oracle — "which supported extensions has its template lost"
// ─────────────────────────────────────────────────────────────────────

// The two upstream tables this adapter reads, from two different modules of
// the installed package: `EXTENSION_MAP` (the extractor's own
// extension → language table) lives in `dist/extraction/grammars.js`, and
// `DEFAULT_CONFIG.include` (the template upstream `init` writes) in
// `dist/types.js`.
type UpstreamTypesModule = {
  readonly DEFAULT_CONFIG: { readonly include: readonly string[] };
};

// `extraction/index.js` decides whether to parse a file with exactly this
// pair of calls. Reached instead of a hand-rolled extension list for the
// same reason the exclude reconciler matches with `picomatch` rather than a
// hand-rolled matcher: calling upstream's own decision cannot drift from it.
type UpstreamGrammarsModule = {
  readonly EXTENSION_MAP: Readonly<Record<string, string>>;
  readonly detectLanguage: (filePath: string, source?: string) => string;
  readonly isLanguageSupported: (language: string) => boolean;
};

let cachedCandidateExtensions: readonly string[] | null = null;

// The extensions upstream's extractor supports but its own default
// `include` template never names, as dotted extensions — measured against
// the installed `@colbymchenry/codegraph` 0.7.10 as `.mjs`, `.cjs`,
// `.pyw`, `.hxx`, `.rake`, in that order.
//
// Derived entirely from upstream's own data:
//
//   1. `EXTENSION_MAP` keys are the extension universe the extractor knows.
//   2. The extensions upstream's template already names are read off
//      `DEFAULT_CONFIG.include` — the entry's own extension, so the
//      comparison is extension-to-extension and cannot be confused by a
//      template that switches glob syntax.
//   3. A candidate is kept only when upstream's own support decision
//      accepts it, so a table entry with no grammar behind it is never
//      repaired into the config.
//
// Returns the same array on every call (module-level cache); the two
// modules only define tables and functions, so the load is cheap and
// Node's `require` cache makes later calls free.
export function upstreamUnnamedIncludeExtensions(): readonly string[] {
  if (cachedCandidateExtensions === null) {
    const require = createRequire(import.meta.url);
    const packageJsonPath = require.resolve('@colbymchenry/codegraph/package.json');
    const distDir = join(dirname(packageJsonPath), 'dist');

    const types = require(join(distDir, 'types.js')) as UpstreamTypesModule;
    const grammars = require(join(distDir, 'extraction', 'grammars.js')) as UpstreamGrammarsModule;

    const namedByTemplate = new Set(
      types.DEFAULT_CONFIG.include.map((entry) => extname(entry).toLowerCase())
    );

    cachedCandidateExtensions = Object.keys(grammars.EXTENSION_MAP).filter(
      (extension) =>
        !namedByTemplate.has(extension.toLowerCase()) &&
        grammars.isLanguageSupported(grammars.detectLanguage(`probe${extension}`))
    );
  }

  return cachedCandidateExtensions;
}
