/**
 * Slice benchmark wrapper (slice 2026-06-14-fzf-headroom-rollout).
 *
 * Wraps `decomposeSlices` with a thin observability layer that records
 * total wall time, codegraph call count, confidence distribution, and
 * input/output byte counts. The result is attached to the
 * DecompositionResult envelope only when `peaks slice decompose --benchmark`
 * is passed.
 *
 * The benchmark does NOT mutate the algorithm's output; it is pure
 * measurement. Codegraph call counting is achieved by wrapping the
 * caller-provided `codegraphRunner`.
 */

import { Buffer } from 'node:buffer';
import type { CodegraphRunner, DecomposeOptions, DecompositionResult, SliceBenchmark } from './slice-decompose-types.js';
import { decomposeSlices, defaultCodegraphRunner } from './slice-decompose-service.js';

export interface BenchmarkEnvelope {
  benchmark: SliceBenchmark;
  result: DecompositionResult;
}

export async function decomposeSlicesWithBenchmark(
  rid: string,
  prdMarkdown: string,
  projectRoot: string,
  options: DecomposeOptions = {}
): Promise<BenchmarkEnvelope> {
  const codegraphQueries = { count: 0 };
  const baseRunner: CodegraphRunner = options.codegraphRunner ?? defaultCodegraphRunner();
  const wrappedRunner: CodegraphRunner = {
    query: async (text, root) => {
      codegraphQueries.count += 1;
      return baseRunner.query(text, root);
    },
    affected: async (files, root) => {
      codegraphQueries.count += 1;
      return baseRunner.affected(files, root);
    },
    status: async (root) => {
      codegraphQueries.count += 1;
      return baseRunner.status(root);
    }
  };

  const t0 = Date.now();
  const result = await decomposeSlices(rid, prdMarkdown, projectRoot, {
    ...options,
    codegraphRunner: wrappedRunner
  });
  const totalMs = Date.now() - t0;

  const p50ConfidenceDistribution = { low: 0, mid: 0, high: 0 };
  for (const batch of result.parallelBatches) {
    for (const slice of batch.slices) {
      if (slice.estimate.confidence === 'low') p50ConfidenceDistribution.low += 1;
      else if (slice.estimate.confidence === 'medium') p50ConfidenceDistribution.mid += 1;
      else p50ConfidenceDistribution.high += 1;
    }
  }

  const benchmark: SliceBenchmark = {
    rid,
    totalMs,
    codegraphQueries: codegraphQueries.count,
    p50ConfidenceDistribution,
    inputApproxBytes: { prd: Buffer.byteLength(prdMarkdown, 'utf8') },
    outputJsonBytes: Buffer.byteLength(JSON.stringify(result), 'utf8'),
    capturedAt: new Date().toISOString()
  };

  return { result, benchmark };
}
