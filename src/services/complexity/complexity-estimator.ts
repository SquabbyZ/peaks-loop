/**
 * v2.15.0 follow-up — G10: complexity estimator.
 *
 * 12 Gaps memory: the G2 complexity tier drives user-attended vs overnight
 * scheduling. This service estimates the complexity of a set of files
 * based on LOC + a few cheap heuristics.
 *
 * Tier thresholds (G2 12 Gaps memory):
 *   - trivial : ≤ 50 lines, no async, no IO
 *   - simple  : ≤ 200 lines, ≤ 3 exports
 *   - complex : > 200 lines, OR many exports, OR has async/await
 *
 * Pure function. CLI: `peaks complexity estimate --files <list>`.
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type ComplexityTier = 'trivial' | 'simple' | 'complex';

export interface FileComplexity {
  readonly file: string;
  readonly lines: number;
  readonly exports: number;
  readonly hasAsync: boolean;
  readonly tier: ComplexityTier;
}

export interface ComplexityEstimate {
  readonly files: readonly FileComplexity[];
  readonly overall: ComplexityTier;
  readonly summary: { trivial: number; simple: number; complex: number };
}

function countMatches(content: string, regex: RegExp): number {
  return (content.match(regex) ?? []).length;
}

export function estimateFileComplexity(file: string): FileComplexity | null {
  if (!existsSync(file)) return null;
  const stat = statSync(file);
  if (!stat.isFile()) return null;
  let content: string;
  try {
    content = readFileSync(file, 'utf8');
  } catch (err) {
    console.warn(`estimateFileComplexity: failed to read ${file}: ${(err as Error).message}`);
    return null;
  }
  const lines = content.split('\n').length;
  const exports = countMatches(content, /^export\s+/gm);
  const hasAsync = /\basync\s+(function|\([^)]*\)\s*=>|[a-zA-Z_$][a-zA-Z0-9_$]*\s*\()/m.test(content);
  let tier: ComplexityTier = 'trivial';
  if (lines > 200 || exports > 10 || hasAsync) tier = 'complex';
  else if (lines > 50 || exports > 3) tier = 'simple';
  return { file, lines, exports, hasAsync, tier };
}

export function aggregateTier(tiers: readonly ComplexityTier[]): ComplexityTier {
  if (tiers.some((t) => t === 'complex')) return 'complex';
  if (tiers.some((t) => t === 'simple')) return 'simple';
  return 'trivial';
}

export function estimateComplexity(projectRoot: string, files: readonly string[]): ComplexityEstimate {
  const results: FileComplexity[] = [];
  for (const f of files) {
    const path = resolve(projectRoot, f);
    const c = estimateFileComplexity(path);
    if (c !== null) results.push(c);
  }
  const summary = { trivial: 0, simple: 0, complex: 0 };
  for (const r of results) {
    summary[r.tier]++;
  }
  return { files: results, overall: aggregateTier(results.map((r) => r.tier)), summary };
}
