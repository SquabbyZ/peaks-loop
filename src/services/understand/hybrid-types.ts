import type { CodegraphExecutionResult } from '../codegraph/codegraph-service.js';
import type { UnderstandScanReport } from './understand-types.js';
import type { UnderstandGraphSummary } from './understand-scan-service.js';

/**
 * Slice 2026-07-02-codegraph-ua-hybrid — envelope contract for the
 * `peaks understand context` command. The service layer decides which
 * evidence to include based on environment detection; the source field
 * is the authoritative routing signal.
 */
export type UnderstandContextSource =
  | 'ua-only'
  | 'ua-missing-fallback-codegraph'
  | 'ua-and-codegraph-hybrid'
  | 'both-missing';

export type CodegraphContextBlock = {
  invocation: {
    subcommand: 'affected';
    files: string[];
  };
  execution: CodegraphExecutionResult;
  /** Parsed JSON from `codegraph affected --json` when exitCode === 0; null otherwise. */
  payload: unknown;
  parseError?: string;
};

export type UnderstandContextResult = {
  projectRoot: string;
  source: UnderstandContextSource;
  ua?: {
    scan: UnderstandScanReport;
    summary?: UnderstandGraphSummary;
  };
  codegraph?: CodegraphContextBlock;
  /** Wall-clock milliseconds spent on the slowest parallel branch. */
  durationMs: number;
  warnings: string[];
};
