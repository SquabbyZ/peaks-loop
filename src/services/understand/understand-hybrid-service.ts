import {
  createCodegraphInvocation,
  executeCodegraphInvocation,
  type CodegraphProcessRunner
} from '../codegraph/codegraph-service.js';
import { scanUnderstandAnything, summarizeKnowledgeGraph, type SummarizeKnowledgeGraphOptions, type UnderstandGraphSummary } from './understand-scan-service.js';
import { getErrorMessage } from 'peaks-loop-shared/result';

import type { UnderstandScanReport } from './understand-types.js';
import type {
  CodegraphContextBlock,
  UnderstandContextResult,
  UnderstandContextSource
} from './hybrid-types.js';

export type BuildUnderstandContextOptions = {
  projectRoot: string;
  files?: string[];
  sampleSize?: number;
  artifactDir?: string;
  codegraphRunner?: CodegraphProcessRunner;
};

const DEFAULT_FILES: readonly string[] = ['src/index.ts', 'package.json', 'README.md'];

function resolveFiles(files: string[] | undefined): string[] {
  if (files !== undefined && files.length > 0) {
    return [...files];
  }
  return [...DEFAULT_FILES];
}

async function safeSummarize(options: SummarizeKnowledgeGraphOptions): Promise<{ summary?: UnderstandGraphSummary; warning?: string }> {
  try {
    return { summary: await summarizeKnowledgeGraph(options) };
  } catch (error) {
    return { warning: `UA summary failed: ${getErrorMessage(error)}` };
  }
}

async function runCodegraph(
  projectRoot: string,
  files: string[],
  runner: CodegraphProcessRunner | undefined
): Promise<{ block?: CodegraphContextBlock; warning?: string }> {
  try {
    const invocation = createCodegraphInvocation({
      subcommand: 'affected',
      project: projectRoot,
      files,
      json: true
    });
    const execution = await executeCodegraphInvocation(invocation, runner);
    if (execution.exitCode !== 0) {
      return { warning: `codegraph affected exited with code ${execution.exitCode}: ${execution.stderr.slice(0, 200)}` };
    }
    let payload: unknown = null;
    let parseError: string | undefined;
    try {
      payload = JSON.parse(execution.stdout);
    } catch (error) {
      parseError = getErrorMessage(error);
    }
    return {
      block: {
        invocation: { subcommand: 'affected', files },
        execution,
        payload,
        ...(parseError !== undefined ? { parseError } : {})
      }
    };
  } catch (error) {
    return { warning: `codegraph affected failed: ${getErrorMessage(error)}` };
  }
}

function decideSource(
  uaScan: UnderstandScanReport,
  hasCodegraph: boolean
): UnderstandContextSource {
  const uaPresent = uaScan.exists && uaScan.graph.exists && uaScan.graph.parseError === undefined;
  if (uaPresent && hasCodegraph) return 'ua-and-codegraph-hybrid';
  if (uaPresent) return 'ua-only';
  if (hasCodegraph) return 'ua-missing-fallback-codegraph';
  return 'both-missing';
}

export async function buildUnderstandContext(
  options: BuildUnderstandContextOptions
): Promise<UnderstandContextResult> {
  const startedAt = Date.now();
  const files = resolveFiles(options.files);
  const sampleSize = options.sampleSize ?? 5;
  const warnings: string[] = [];

  const scanOptions: Parameters<typeof scanUnderstandAnything>[0] = { projectRoot: options.projectRoot };
  if (options.artifactDir !== undefined) {
    scanOptions.artifactDir = options.artifactDir;
  }
  const uaScan: UnderstandScanReport = await scanUnderstandAnything(scanOptions);

  const uaSummaryPromise: Promise<{ summary?: UnderstandGraphSummary; warning?: string }> = uaScan.exists && uaScan.graph.exists
    ? safeSummarize({ projectRoot: options.projectRoot, sampleSize, ...(options.artifactDir !== undefined ? { artifactDir: options.artifactDir } : {}) })
    : Promise.resolve({});

  const [uaSummary, codegraphResult] = await Promise.all([
    uaSummaryPromise,
    runCodegraph(options.projectRoot, files, options.codegraphRunner)
  ]);

  if (uaSummary.warning) warnings.push(uaSummary.warning);
  if (codegraphResult.warning) warnings.push(codegraphResult.warning);

  const source = decideSource(uaScan, codegraphResult.block !== undefined);

  const result: UnderstandContextResult = {
    projectRoot: options.projectRoot,
    source,
    durationMs: Date.now() - startedAt,
    warnings
  };

  if (source === 'ua-only' || source === 'ua-and-codegraph-hybrid') {
    result.ua = {
      scan: uaScan,
      ...(uaSummary.summary !== undefined ? { summary: uaSummary.summary } : {})
    };
  }
  if (codegraphResult.block) {
    result.codegraph = codegraphResult.block;
  }

  return result;
}
