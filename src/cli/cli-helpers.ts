import { Command } from 'commander';
import { fail, getErrorMessage, ok, redactSensitiveErrorMessage, type ResultEnvelope } from '../shared/result.js';
import type { ArtifactProvider, GuidedArtifactSetup } from '../services/artifacts/artifact-service.js';
import type { ConfigLayer } from '../services/config/config-service.js';
import type { MiniMaxProviderSmokeResult } from '../services/providers/minimax-provider-service.js';
import type { MiniMaxWorkerResult } from '../services/providers/minimax-worker-service.js';
import type { RecommendationWorkflow } from '../services/recommendations/recommendation-service.js';

export type ProgramIO = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

const MINIMAX_API_HOST = 'api.minimaxi.com';

export function printResult<T>(io: ProgramIO, result: ResultEnvelope<T>, asJson = false): void {
  if (asJson) {
    io.stdout(JSON.stringify(result, null, 2));
    return;
  }

  if (!result.ok) {
    io.stderr(`${result.code}: ${result.message}`);
    for (const action of result.nextActions) {
      io.stderr(`- ${action}`);
    }
    return;
  }

  io.stdout(JSON.stringify(result.data, null, 2));
  for (const warning of result.warnings) {
    io.stderr(`warning: ${warning}`);
  }
  for (const action of result.nextActions) {
    io.stdout(`next: ${action}`);
  }
}

export function addJsonOption(command: Command): Command {
  return command.option('--json', 'print machine-readable JSON envelope');
}

export function failUnsupportedNonDryRun(io: ProgramIO, command: string, asJson?: boolean): void {
  printResult(io, fail(command, 'UNSUPPORTED_NON_DRY_RUN', 'Only dry-run planning is supported', {}, ['Rerun with --dry-run or omit --no-dry-run']), asJson);
  process.exitCode = 1;
}

/** CLI shim helper: render a `{ ok: boolean, error?, data? }` envelope
 *  and set `process.exitCode = 1` on failure.
 *
 *  Library functions MUST return envelopes like `{ ok, error?, data? }`
 *  and MUST NOT mutate `process.exitCode` themselves. The shim (the
 *  Commander `.action()` callback in `register*Commands`) owns the
 *  process-exit side-effect so the library can be re-used from non-CLI
 *  contexts (vitest, programmatic dispatch, plugin loading).
 *
 *  Output format mirrors the existing `registerSedimentCommands` shim:
 *  a JSON envelope on stdout (one line, parseable), nothing else.
 */
export interface CliEnvelope { ok: boolean; error?: string; data?: unknown }
export function printCliEnvelope(io: ProgramIO, r: CliEnvelope): void {
  if (r.ok) {
    io.stdout(JSON.stringify({ ok: true, data: r.data ?? null }));
    return;
  }
  io.stdout(JSON.stringify({ ok: false, error: r.error }));
  process.exitCode = 1;
}

export function isRecommendationWorkflow(value: string): value is RecommendationWorkflow {
  return value === 'code-refactor' || value === 'product-refactor' || value === 'frontend-design';
}

export function isArtifactProvider(value: string): value is ArtifactProvider {
  return value === 'github' || value === 'gitlab';
}

export function isArtifactSetupStep(value: string): value is GuidedArtifactSetup['step'] {
  return value === 'detect' || value === 'configure' || value === 'validate' || value === 'complete';
}

export function isArtifactRepoSegment(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !value.includes('..') && !value.endsWith('.');
}

export function isMiniMaxHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === MINIMAX_API_HOST && url.username.length === 0 && url.password.length === 0 && url.search.length === 0 && url.hash.length === 0;
  } catch {
    return false;
  }
}

export function parseConfigLayer(value: string | undefined): ConfigLayer | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  return value === 'user' || value === 'project' ? value : null;
}

export function printInvalidConfigLayer(io: ProgramIO, command: string, asJson?: boolean): void {
  printResult(io, fail(command, 'INVALID_CONFIG_LAYER', 'Config layer must be user or project', {}, ['Use --layer user or --layer project']), asJson);
  process.exitCode = 1;
}

export function multipleOption(value: string, previous: string[]): string[] {
  return [...(previous || []), value];
}

export function summarizeMiniMaxSmokeResult(result: MiniMaxProviderSmokeResult): MiniMaxProviderSmokeResult {
  return { ...result, responseText: null, summary: null };
}

export function summarizeMiniMaxWorkerResult(result: MiniMaxWorkerResult): MiniMaxWorkerResult {
  const provider = summarizeMiniMaxSmokeResult(result.provider);
  return {
    ...result,
    provider,
    reviewHandoff: {
      model: result.reviewHandoff.model,
      prompt: '[redacted]'
    }
  };
}

export { getErrorMessage, ok, redactSensitiveErrorMessage };
