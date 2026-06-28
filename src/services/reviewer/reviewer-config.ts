/**
 * reviewer-config.ts — load the `reviewer` section from
 * `~/.peaks/config.json`. AC-4.1 mandates:
 *   - providers[] (>=2 entries; ollama / anthropic / openai supported)
 *   - selection: 'round-robin' | 'hash(rid)' | 'random'
 *   - rdProviderName: string | null
 *   - requireDistinctModelFamily: boolean (default true)
 *   - fallbackOnError: 'skip' | 'error'
 *   - schemaPath: string (default 'schemas/reviewer-envelope.schema.json')
 *
 * Missing section => the reviewer is OFF (transition still passes; envelope
 * records `skipped: no-reviewer-config`). The CLI never silently prompts for
 * API keys; missing env vars surface as `providerUnavailable` and the
 * fallbackOnError policy decides whether to skip or throw.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type ReviewerProviderName = 'ollama' | 'anthropic' | 'openai' | 'bedrock' | 'azure';

export type ReviewerProviderConfig = {
  name: ReviewerProviderName | string;
  model: string;
  endpoint?: string | undefined;
  apiKeyEnv?: string | undefined;
};

export type ReviewerSelectionMode = 'round-robin' | 'hash' | 'random';

export type ReviewerFallbackMode = 'skip' | 'error';

export type ReviewerConfig = {
  providers: ReadonlyArray<ReviewerProviderConfig>;
  selection: ReviewerSelectionMode;
  rdProviderName: string | null;
  requireDistinctModelFamily: boolean;
  fallbackOnError: ReviewerFallbackMode;
  schemaPath: string;
};

export type ReviewerConfigStatus =
  | { ok: true; config: ReviewerConfig }
  | { ok: false; reason: 'no-reviewer-config' };

const VALID_SELECTION: ReadonlyArray<ReviewerSelectionMode> = ['round-robin', 'hash', 'random'];
const VALID_FALLBACK: ReadonlyArray<ReviewerFallbackMode> = ['skip', 'error'];

export function defaultReviewerConfigPath(): string {
  return join(homedir(), '.peaks', 'config.json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read + parse `~/.peaks/config.json` (or override path) and return the
 * `reviewer` section if present. NEVER throws on missing file — returns
 * `{ ok: false, reason: 'no-reviewer-config' }` instead so the CLI can
 * record the skip reason in the envelope.
 */
export function loadReviewerConfig(options: { path?: string } = {}): ReviewerConfigStatus {
  const path = options.path ?? defaultReviewerConfigPath();
  if (!existsSync(path)) {
    return { ok: false, reason: 'no-reviewer-config' };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return { ok: false, reason: 'no-reviewer-config' };
  }
  if (!isRecord(raw)) return { ok: false, reason: 'no-reviewer-config' };
  const reviewer = raw['reviewer'];
  if (!isRecord(reviewer)) return { ok: false, reason: 'no-reviewer-config' };

  const providersRaw = reviewer['providers'];
  if (!Array.isArray(providersRaw) || providersRaw.length < 2) {
    // A4.1 explicitly requires >=2 providers; with <2 we treat the
    // section as absent so the reviewer is skipped cleanly.
    return { ok: false, reason: 'no-reviewer-config' };
  }

  const providers: ReviewerProviderConfig[] = [];
  for (const entry of providersRaw) {
    if (!isRecord(entry)) continue;
    const name = entry['name'];
    const model = entry['model'];
    if (typeof name !== 'string' || typeof model !== 'string') continue;
    providers.push({
      name,
      model,
      endpoint: typeof entry['endpoint'] === 'string' ? entry['endpoint'] : undefined,
      apiKeyEnv: typeof entry['apiKeyEnv'] === 'string' ? entry['apiKeyEnv'] : undefined
    });
  }
  if (providers.length < 2) return { ok: false, reason: 'no-reviewer-config' };

  const selectionRaw = reviewer['selection'];
  const selection: ReviewerSelectionMode =
    typeof selectionRaw === 'string' && (VALID_SELECTION as ReadonlyArray<string>).includes(selectionRaw)
      ? (selectionRaw as ReviewerSelectionMode)
      : 'round-robin';

  const fallbackRaw = reviewer['fallbackOnError'];
  const fallbackOnError: ReviewerFallbackMode =
    typeof fallbackRaw === 'string' && (VALID_FALLBACK as ReadonlyArray<string>).includes(fallbackRaw)
      ? (fallbackRaw as ReviewerFallbackMode)
      : 'skip';

  const rdProviderNameRaw = reviewer['rdProviderName'];
  const rdProviderName =
    rdProviderNameRaw === null || typeof rdProviderNameRaw === 'string' ? (rdProviderNameRaw as string | null) : null;

  const requireDistinct = reviewer['requireDistinctModelFamily'];
  const requireDistinctModelFamily = typeof requireDistinct === 'boolean' ? requireDistinct : true;

  const schemaPathRaw = reviewer['schemaPath'];
  const schemaPath =
    typeof schemaPathRaw === 'string' && schemaPathRaw.length > 0
      ? schemaPathRaw
      : 'schemas/reviewer-envelope.schema.json';

  return {
    ok: true,
    config: {
      providers,
      selection,
      rdProviderName,
      requireDistinctModelFamily,
      fallbackOnError,
      schemaPath
    }
  };
}
