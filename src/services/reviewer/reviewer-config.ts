/**
 * reviewer-config.ts — load the `reviewer` section from
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
  /** A {@link ReviewerProviderName}, or any future provider name. */
  name: string;
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

/** A4.1 — the reviewer needs at least two provider families to be usable. */
export const MIN_REVIEWER_PROVIDERS = 2;

/**
 * Three states, so `peaks reviewer status` can tell "nothing configured"
 * apart from "configured, but not enough providers" (backlog §7.10 ③).
 * `providerCount` is the number of VALID entries after parsing, which is
 * what the >=2 requirement is measured on.
 */
export type ReviewerConfigStatus =
  | { ok: true; config: ReviewerConfig }
  | {
      ok: false;
      reason: 'no-reviewer-config' | 'insufficient-providers';
      providerCount: number;
      requiredProviders: number;
    };

const VALID_SELECTION: ReadonlyArray<ReviewerSelectionMode> = ['round-robin', 'hash', 'random'];
const VALID_FALLBACK: ReadonlyArray<ReviewerFallbackMode> = ['skip', 'error'];

export function defaultReviewerConfigPath(): string {
  return join(homedir(), '.peaks', 'config.json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function absentStatus(): ReviewerConfigStatus {
  return {
    ok: false,
    reason: 'no-reviewer-config',
    providerCount: 0,
    requiredProviders: MIN_REVIEWER_PROVIDERS
  };
}

function insufficientStatus(providerCount: number): ReviewerConfigStatus {
  return {
    ok: false,
    reason: 'insufficient-providers',
    providerCount,
    requiredProviders: MIN_REVIEWER_PROVIDERS
  };
}

type SectionRead = { ok: true; reviewer: Record<string, unknown> } | { ok: false };

/** The `reviewer` object, or `{ ok: false }` when the file / section is absent or unreadable. */
function readSection(path: string): SectionRead {
  if (!existsSync(path)) return { ok: false };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return { ok: false };
  }
  if (!isRecord(raw)) return { ok: false };
  const reviewer = raw['reviewer'];
  return isRecord(reviewer) ? { ok: true, reviewer } : { ok: false };
}

function parseProviders(raw: unknown): {
  providers: ReviewerProviderConfig[];
  total: number;
} {
  if (!Array.isArray(raw)) return { providers: [], total: 0 };
  const providers: ReviewerProviderConfig[] = [];
  for (const entry of raw) {
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
  return { providers, total: raw.length };
}

function readSelection(raw: unknown): ReviewerSelectionMode {
  return typeof raw === 'string' && (VALID_SELECTION as ReadonlyArray<string>).includes(raw)
    ? (raw as ReviewerSelectionMode)
    : 'round-robin';
}

function readFallback(raw: unknown): ReviewerFallbackMode {
  return typeof raw === 'string' && (VALID_FALLBACK as ReadonlyArray<string>).includes(raw)
    ? (raw as ReviewerFallbackMode)
    : 'skip';
}

function readRdProviderName(raw: unknown): string | null {
  return raw === null || typeof raw === 'string' ? raw : null;
}

function readRequireDistinct(raw: unknown): boolean {
  return typeof raw === 'boolean' ? raw : true;
}

function readSchemaPath(raw: unknown): string {
  return typeof raw === 'string' && raw.length > 0 ? raw : 'schemas/reviewer-envelope.schema.json';
}

/**
 * Read + parse `~/.peaks/config.json` (or override path) and return the
 * `reviewer` section if present. NEVER throws on missing file — the CLI
 * records the skip reason in the envelope instead.
 */
export function loadReviewerConfig(options: { path?: string } = {}): ReviewerConfigStatus {
  const path = options.path ?? defaultReviewerConfigPath();
  const section = readSection(path);
  if (!section.ok) return absentStatus();
  const reviewer = section.reviewer;
  const { providers, total } = parseProviders(reviewer['providers']);
  if (total < MIN_REVIEWER_PROVIDERS || providers.length < MIN_REVIEWER_PROVIDERS) {
    // A4.1 requires >=2 valid providers. The section exists but is not
    // usable; report the count rather than collapsing it into "no section".
    return insufficientStatus(total < MIN_REVIEWER_PROVIDERS ? total : providers.length);
  }
  return {
    ok: true,
    config: {
      providers,
      selection: readSelection(reviewer['selection']),
      rdProviderName: readRdProviderName(reviewer['rdProviderName']),
      requireDistinctModelFamily: readRequireDistinct(reviewer['requireDistinctModelFamily']),
      fallbackOnError: readFallback(reviewer['fallbackOnError']),
      schemaPath: readSchemaPath(reviewer['schemaPath'])
    }
  };
}
