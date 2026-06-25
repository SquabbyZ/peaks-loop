/**
 * CrossPassEdgeMerger — Phase 2 of slice-topology-multipass (W2 T7).
 *
 * Produces `CrossPassEdge`s that span two adjacent decomposition passes by
 * combining fast structural detectors with the `LLMArbitrator` fallback.
 *
 * Pipeline (per adjacent pass pair `(upper, lower)`):
 *   1. Build a `path → upperSliceId` index of every file owned by `upper`.
 *   2. For each lower slice, for each file in that slice:
 *        a. type-shares      — `import type { ... } from '...'` resolves to an upper file.
 *        b. import-re-export — `export ... from '...'` resolves to an upper file.
 *        c. fixture-shares    — file is a test file AND `from '...'` resolves to an upper file.
 *      Each match emits one `CrossPassEdge` with `confidence: 'structural'` and
 *      `arbitratedBy: null`.
 *   3. If a lower slice emitted NO static edges AND `opts.llmRunner` is provided AND
 *      `llmCalls.length < opts.maxLlmCalls`, invoke `arbitrate(...)` once. On a
 *      successful `{"depends": true}` response, emit one edge with
 *      `kind: 'llm-arbitrated'`, `confidence: 'llm'`, and `arbitratedBy: <callId>`.
 *   4. The budget is `opts.maxLlmCalls ?? 2`; once exhausted the merger returns
 *      what it has accumulated and never crashes.
 *
 * Pass 3 is reserved for future use; the type allows `passNumber: 3` but v1 input
 * never contains it. Pairs are processed left-to-right so edges are deterministic.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import type {
  CrossPassEdge,
  PassNumber,
  PassResult,
} from './slice-topology-types.js';
import { arbitrate } from './llm-arbitrator.js';
import type { LlmRunner } from '../audit/audit-goal-service.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface MergeResult {
  readonly edges: readonly CrossPassEdge[];
  readonly llmCalls: readonly {
    readonly callId: string;
    readonly tokens: { readonly input: number; readonly output: number } | null;
  }[];
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

/** Subset of `LlmArbitration` we track here — the edge stores only `callId`. */
interface LlmCallTrace {
  readonly callId: string;
  readonly tokens: { readonly input: number; readonly output: number } | null;
}

// ---------------------------------------------------------------------------
// Static-detection regexes
// ---------------------------------------------------------------------------

/** `import type { Foo } from '../upper/...'` and `import type * as Foo from '...'` */
const TYPE_IMPORT_RE =
  /import\s+type\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g;

/** `export { Bar } from '...'` / `export * from '...'` / `export type { Bar } from '...'`. */
const RE_EXPORT_RE =
  /\bexport\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g;

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

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function merge(
  passes: readonly PassResult[],
  opts: MergeOptions
): Promise<MergeResult> {
  const edges: CrossPassEdge[] = [];
  const llmCalls: LlmCallTrace[] = [];
  const maxLlm = opts.maxLlmCalls ?? 2;
  const cacheDir =
    opts.cacheDir ?? join(opts.projectRoot, '.peaks/cache/arbitrator');
  mkdirSync(cacheDir, { recursive: true });

  for (let i = 0; i < passes.length - 1; i++) {
    const upper = passes[i]!;
    const lower = passes[i + 1]!;

    // Index every upper file → the slice that owns it.
    const upperFileToSlice = new Map<string, string>();
    for (const slice of upper.slices) {
      for (const file of slice.files) {
        upperFileToSlice.set(file, slice.id);
      }
    }

    for (const slice of lower.slices) {
      const emittedBefore = edges.length;

      for (const file of slice.files) {
        detectStaticEdges(file, slice.id, upper.passNumber, lower.passNumber, upperFileToSlice, edges);
      }

      const hadStaticEdge = edges.length > emittedBefore;

      // LLM fallback — only when this slice emitted nothing AND we still have budget.
      if (!hadStaticEdge && opts.llmRunner && llmCalls.length < maxLlm) {
        await runLlmFallback(
          upper,
          slice,
          upper.passNumber,
          lower.passNumber,
          cacheDir,
          maxLlm,
          opts.llmRunner,
          edges,
          llmCalls
        );
      }
    }
  }

  return { edges, llmCalls };
}

// ---------------------------------------------------------------------------
// Static detectors — append matched edges to `edges` in-place.
// ---------------------------------------------------------------------------

function detectStaticEdges(
  file: string,
  lowerSliceId: string,
  fromPass: PassNumber,
  toPass: PassNumber,
  upperFileToSlice: ReadonlyMap<string, string>,
  edges: CrossPassEdge[]
): void {
  if (!existsSync(file)) {
    return;
  }
  const content = readFileSync(file, 'utf8');

  // 1. type-shares — `import type ... from '...'`
  forEachMatch(TYPE_IMPORT_RE, content, (spec, evidence) => {
    const resolved = resolveImport(file, spec);
    const upperSliceId = upperFileToSlice.get(resolved);
    if (upperSliceId !== undefined) {
      edges.push(buildEdge({
        fromPass,
        toPass,
        fromSliceId: upperSliceId,
        toSliceId: lowerSliceId,
        kind: 'type-shares',
        confidence: 'structural',
        evidence,
        arbitratedBy: null,
      }));
    }
  });

  // 2. import-re-export — `export ... from '...'`
  forEachMatch(RE_EXPORT_RE, content, (spec, evidence) => {
    const resolved = resolveImport(file, spec);
    const upperSliceId = upperFileToSlice.get(resolved);
    if (upperSliceId !== undefined) {
      edges.push(buildEdge({
        fromPass,
        toPass,
        fromSliceId: upperSliceId,
        toSliceId: lowerSliceId,
        kind: 'import-re-export',
        confidence: 'structural',
        evidence,
        arbitratedBy: null,
      }));
    }
  });

  // 3. fixture-shares — test file imports an upper module.
  if (isTestFile(file)) {
    forEachMatch(ANY_FROM_RE, content, (spec, evidence) => {
      const resolved = resolveImport(file, spec);
      const upperSliceId = upperFileToSlice.get(resolved);
      if (upperSliceId !== undefined) {
        edges.push(buildEdge({
          fromPass,
          toPass,
          fromSliceId: upperSliceId,
          toSliceId: lowerSliceId,
          kind: 'fixture-shares',
          confidence: 'structural',
          evidence,
          arbitratedBy: null,
        }));
      }
    });
  }
}

// ---------------------------------------------------------------------------
// LLM fallback
// ---------------------------------------------------------------------------

async function runLlmFallback(
  upper: PassResult,
  lowerSlice: { readonly id: string },
  fromPass: PassNumber,
  toPass: PassNumber,
  cacheDir: string,
  maxCallsPerInvocation: number,
  llmRunner: LlmRunner,
  edges: CrossPassEdge[],
  llmCalls: LlmCallTrace[]
): Promise<void> {
  const upperSliceId = upper.slices[0]?.id ?? '<unknown-upper>';
  const prompt =
    `Does upper slice "${upperSliceId}" depend on lower slice "${lowerSlice.id}"? ` +
    `Reply with JSON of the shape {"depends": boolean, "reason": string}.`;

  const result = await arbitrate(prompt, {
    cacheDir,
    maxCallsPerInvocation,
    perCallTimeoutMs: 5000,
    llmRunner,
  });

  llmCalls.push({ callId: result.callId, tokens: result.tokens });

  if (result.output === null) {
    return;
  }

  const parsed = parseDependsReply(result.output);
  if (parsed?.depends === true) {
    edges.push(buildEdge({
      fromPass,
      toPass,
      fromSliceId: upperSliceId,
      toSliceId: lowerSlice.id,
      kind: 'llm-arbitrated',
      confidence: 'llm',
      evidence: `llm:${result.callId}: ${parsed.reason}`,
      arbitratedBy: result.callId,
    }));
  }
}

// ---------------------------------------------------------------------------
// Helpers
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
    arbitratedBy: fields.arbitratedBy,
  };
}

function forEachMatch(
  re: RegExp,
  content: string,
  cb: (spec: string, evidence: string) => void
): void {
  re.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const spec = match[1]!;
    cb(spec, match[0]);
  }
}

/**
 * Resolve an import specifier relative to the importing file. Tries common
 * TypeScript extensions and returns the first candidate that exists on disk;
 * if none exist (e.g. the file is virtual / generated), falls back to the
 * `.ts` form so the caller can still match against its own index.
 */
function resolveImport(fromFile: string, spec: string): string {
  const base = isAbsolute(spec)
    ? spec
    : resolve(dirname(fromFile), spec);

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

function parseDependsReply(
  raw: string
): { readonly depends: boolean; readonly reason: string } | null {
  // Accept either a pure JSON object or a fenced ```json { ... } ``` block.
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1]! : raw;
  try {
    const obj = JSON.parse(candidate) as { depends?: unknown; reason?: unknown };
    if (typeof obj.depends !== 'boolean') return null;
    return {
      depends: obj.depends,
      reason: typeof obj.reason === 'string' ? obj.reason : '',
    };
  } catch {
    return null;
  }
}