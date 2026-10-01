/**
 * cross-pass-edge-static-scan-support — the finding-free primitives that back
 * `cross-pass-edge-merger.ts`.
 *
 * Hoisted verbatim by the wave-5 file-size split
 * (rid 2026-10-01-wave5-w5-2-slice-scan). Nothing in this module *decides*
 * anything: the static-detection regexes, the import-specifier resolver, the
 * edge-shape builder and the merger's public contracts are data and pure
 * lookups. The detection pipeline that reads them (`merge`,
 * `detectStaticEdges`, `runLlmFallback`) stays in the parent, and the parent
 * re-exports these types so `./cross-pass-edge-merger.js` remains the public
 * import path.
 */

import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import type { CrossPassEdge, LlmConfidence, PassNumber } from './slice-topology-types.js';
import type { LlmRunner } from '../audit/audit-goal-service.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface MergeResult {
  readonly edges: readonly CrossPassEdge[];
  readonly llmCalls: readonly LlmCallTrace[];
}

export interface MergeOptions {
  readonly projectRoot: string;
  readonly llmRunner?: LlmRunner;
  readonly cacheDir?: string;
  readonly maxLlmCalls?: number;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/**
 * Full LLM-call trace captured by `runLlmFallback` for every arbitrator call.
 * Mirrors v2 `LlmArbitration` minus the non-null `tokens` contract; the
 * orchestrator coalesces a possible `null` `tokens` to a zeroed pair.
 */
export interface LlmCallTrace {
  readonly callId: string;
  readonly promptHash: string;
  readonly input: string;
  readonly output: string;
  readonly confidence: LlmConfidence;
  readonly tokens: { readonly input: number; readonly output: number } | null;
}

// ---------------------------------------------------------------------------
// Static-detection regexes
// ---------------------------------------------------------------------------

/** `import type { Foo } from '../upper/...'` and `import type * as Foo from '...'` */
const TYPE_IMPORT_RE = /import\s+type\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g;

/** `export { Bar } from '...'` / `export * from '...'` / `export type { Bar } from '...'`. */
const RE_EXPORT_RE = /\bexport\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g;

/** Any `from '...'` — used only for the fixture-shares rule (test files). */
const ANY_FROM_RE = /\bfrom\s+['"]([^'"]+)['"]/g;

const RESOLVE_EXTENSIONS = [
  '',
  '.ts',
  '.tsx',
  '.js',
  '/index.ts',
  '/index.tsx',
  '/index.js'
] as const;

export { ANY_FROM_RE, RE_EXPORT_RE, TYPE_IMPORT_RE };

// ---------------------------------------------------------------------------
// Edge shape
// ---------------------------------------------------------------------------

interface EdgeFields {
  readonly fromPass: PassNumber;
  readonly toPass: PassNumber;
  readonly fromSliceId: string;
  readonly toSliceId: string;
  readonly kind: CrossPassEdge['kind'];
  readonly confidence: CrossPassEdge['confidence'];
  readonly evidence: string;
  readonly arbitratedBy: string | null;
}

function buildEdge(fields: EdgeFields): CrossPassEdge {
  return {
    fromPass: fields.fromPass,
    toPass: fields.toPass,
    fromSliceId: fields.fromSliceId,
    toSliceId: fields.toSliceId,
    kind: fields.kind,
    confidence: fields.confidence,
    evidence: fields.evidence,
    arbitratedBy: fields.arbitratedBy
  };
}

export { buildEdge };

// ---------------------------------------------------------------------------
// Specifier + path predicates
// ---------------------------------------------------------------------------

/**
 * Resolve an import specifier relative to the importing file. Tries common
 * TypeScript extensions and returns the first candidate that exists on disk;
 * if none exist (e.g. the file is virtual / generated), falls back to the
 * `.ts` form so the caller can still match against its own index.
 */
function resolveImport(fromFile: string, spec: string): string {
  const base = isAbsolute(spec) ? spec : resolve(dirname(fromFile), spec);

  for (const ext of RESOLVE_EXTENSIONS) {
    const candidate = base + ext;
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return base + '.ts';
}

function isTestFile(filePath: string): boolean {
  return (
    filePath.endsWith('.test.ts') ||
    filePath.endsWith('.test.tsx') ||
    filePath.endsWith('.test.js') ||
    /(^|[\\/])__tests__[\\/]/.test(filePath) ||
    /(^|[\\/])tests[\\/]/.test(filePath)
  );
}

export { isTestFile, resolveImport };
