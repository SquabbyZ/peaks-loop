/**
 * reviewer-config-write.ts — write the `reviewer` section to
 * `~/.peaks/config.json` on the user's behalf (backlog §7.10 ①).
 *
 * The LLM runs the CLI; the user never hand-authors JSON. The writer
 * merges into the existing file so unrelated keys survive, and it refuses
 * to overwrite a file it cannot parse rather than clobbering it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  defaultReviewerConfigPath,
  type ReviewerConfig,
  type ReviewerProviderConfig
} from './reviewer-config.js';

/** Providers `reviewer-service.ts` can actually dispatch to. */
export const DISPATCHABLE_PROVIDER_NAMES: ReadonlyArray<string> = ['ollama', 'anthropic', 'openai'];

export type ReviewerConfigWriteResult =
  { ok: true; path: string } | { ok: false; reason: 'unreadable-config'; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Null when valid; otherwise the reason the section cannot be written. */
export function validateReviewerSection(config: ReviewerConfig): string | null {
  if (config.providers.length < 2) {
    return `at least 2 providers are required (got ${config.providers.length})`;
  }
  for (const provider of config.providers) {
    if (!DISPATCHABLE_PROVIDER_NAMES.includes(provider.name)) {
      return `unsupported provider "${provider.name}" (accepted: ${DISPATCHABLE_PROVIDER_NAMES.join(', ')})`;
    }
    if (provider.model.trim().length === 0) {
      return `provider "${provider.name}" has an empty model id`;
    }
  }
  return null;
}

export function writeReviewerConfig(
  config: ReviewerConfig,
  options: { path?: string } = {}
): ReviewerConfigWriteResult {
  const path = options.path ?? defaultReviewerConfigPath();
  let existing: Record<string, unknown> = {};
  if (existsSync(path)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    } catch {
      return {
        ok: false,
        reason: 'unreadable-config',
        message: `${path} is not valid JSON; refusing to overwrite it`
      };
    }
    if (!isRecord(parsed)) {
      return {
        ok: false,
        reason: 'unreadable-config',
        message: `${path} does not contain a JSON object; refusing to overwrite it`
      };
    }
    existing = parsed;
  }
  const next = { ...existing, reviewer: config };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2), 'utf8');
  return { ok: true, path };
}

/** `name:model`; the first colon splits, so `llama3.2:8b` survives. */
export function parseProviderSpec(spec: string): ReviewerProviderConfig | null {
  const separator = spec.indexOf(':');
  if (separator <= 0) return null;
  const name = spec.slice(0, separator).trim();
  const model = spec.slice(separator + 1).trim();
  if (name.length === 0 || model.length === 0) return null;
  return { name, model };
}
