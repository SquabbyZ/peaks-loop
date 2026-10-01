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
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import type {
  CrossPassEdge,
  LlmConfidence,
  PassNumber,
  PassResult
} from './slice-topology-types.js';
import { arbitrate } from './llm-arbitrator.js';
import type { LlmRunner } from '../audit/audit-goal-service.js';
import {
  ANY_FROM_RE,
  buildEdge,
  isTestFile,
  type LlmCallTrace,
  type MergeOptions,
  type MergeResult,
  RE_EXPORT_RE,
  resolveImport,
  TYPE_IMPORT_RE
} from './cross-pass-edge-static-scan-support.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type { LlmCallTrace, MergeOptions, MergeResult };

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
  const cacheDir = opts.cacheDir ?? join(opts.projectRoot, '.peaks/cache/arbitrator');
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
        detectStaticEdges(
          file,
          slice.id,
          upper.passNumber,
          lower.passNumber,
          upperFileToSlice,
          edges
        );
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
      edges.push(
        buildEdge({
          fromPass,
          toPass,
          fromSliceId: upperSliceId,
          toSliceId: lowerSliceId,
          kind: 'type-shares',
          confidence: 'structural',
          evidence,
          arbitratedBy: null
        })
      );
    }
  });

  // 2. import-re-export — `export ... from '...'`
  forEachMatch(RE_EXPORT_RE, content, (spec, evidence) => {
    const resolved = resolveImport(file, spec);
    const upperSliceId = upperFileToSlice.get(resolved);
    if (upperSliceId !== undefined) {
      edges.push(
        buildEdge({
          fromPass,
          toPass,
          fromSliceId: upperSliceId,
          toSliceId: lowerSliceId,
          kind: 'import-re-export',
          confidence: 'structural',
          evidence,
          arbitratedBy: null
        })
      );
    }
  });

  // 3. fixture-shares — test file imports an upper module.
  if (isTestFile(file)) {
    forEachMatch(ANY_FROM_RE, content, (spec, evidence) => {
      const resolved = resolveImport(file, spec);
      const upperSliceId = upperFileToSlice.get(resolved);
      if (upperSliceId !== undefined) {
        edges.push(
          buildEdge({
            fromPass,
            toPass,
            fromSliceId: upperSliceId,
            toSliceId: lowerSliceId,
            kind: 'fixture-shares',
            confidence: 'structural',
            evidence,
            arbitratedBy: null
          })
        );
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

  const promptHash = createHash('sha256').update(prompt).digest('hex');
  const result = await arbitrate(prompt, {
    cacheDir,
    maxCallsPerInvocation,
    perCallTimeoutMs: 5000,
    llmRunner
  });

  const isFailurePath =
    result.callId === 'budget-exhausted' ||
    result.callId === 'timeout' ||
    result.callId === 'error';
  const confidence: LlmConfidence = isFailurePath ? 'low' : 'medium';

  llmCalls.push({
    callId: result.callId,
    promptHash,
    input: prompt,
    output: result.output ?? '',
    confidence,
    tokens: result.tokens
  });

  if (result.output === null) {
    return;
  }

  const parsed = parseDependsReply(result.output);
  if (parsed?.depends === true) {
    edges.push(
      buildEdge({
        fromPass,
        toPass,
        fromSliceId: upperSliceId,
        toSliceId: lowerSlice.id,
        kind: 'llm-arbitrated',
        confidence: 'llm',
        evidence: `llm:${result.callId}: ${parsed.reason}`,
        arbitratedBy: result.callId
      })
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
      reason: typeof obj.reason === 'string' ? obj.reason : ''
    };
  } catch {
    // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}
