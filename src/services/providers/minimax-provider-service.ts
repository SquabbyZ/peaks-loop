import type { MiniMaxProviderConfig } from '../config/config-types.js';
import { getErrorMessage, redactSensitiveErrorMessage } from '../../shared/result.js';

const DEFAULT_SMOKE_MODEL = 'MiniMax-M2.7';
const MINIMAX_API_HOST = 'api.minimaxi.com';
const SMOKE_PROMPT = 'Output exactly: peaks-ok';
const SMOKE_EXPECTED_TEXT = 'peaks-ok';
const MAX_TOKENS = 64;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_MODEL_FIELD_LENGTH = 128;
const SENSITIVE_MODEL_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:api[\s_-]?key|token|password|secret)\s*[:=]\s*['\"]?[^\s'\"]{8,}/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{20,}\b/,
  /\bghp_[0-9A-Za-z_]{20,}\b/,
  /\bgithub_pat_[0-9A-Za-z_]{20,}\b/,
  /\bglpat-[0-9A-Za-z_-]{20,}\b/,
  /\bxox[abprse]-[0-9A-Za-z-]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/
] as const;

export type MiniMaxProviderSmokeOptions = {
  model?: string;
};

export type MiniMaxProviderSmokeResult = {
  provider: 'minimax';
  configured: boolean;
  baseUrlConfigured: boolean;
  apiKeyConfigured: boolean;
  endpoint: string;
  model: string;
  ok: boolean;
  status: number;
  responseText: string | null;
  summary: string | null;
};

type MiniMaxMessageResponse = {
  content?: unknown;
};

export type MiniMaxPromptOptions = {
  model?: string;
  prompt: string;
  successText?: string;
  successMatch?: 'includes' | 'startsWith';
};

function getHttpsBaseUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === MINIMAX_API_HOST && url.username.length === 0 && url.password.length === 0 && url.search.length === 0 && url.hash.length === 0 ? url : null;
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}

function buildMessagesEndpoint(baseUrl: URL): string {
  return new URL('v1/messages', baseUrl.toString().endsWith('/') ? baseUrl : `${baseUrl.toString()}/`).toString();
}

function normalizeModel(model: string | undefined): string {
  const normalized = model?.trim() || DEFAULT_SMOKE_MODEL;
  if (normalized.length > MAX_MODEL_FIELD_LENGTH) {
    throw new Error(`model must be ${MAX_MODEL_FIELD_LENGTH} characters or less`);
  }
  if (SENSITIVE_MODEL_PATTERNS.some((pattern) => pattern.test(normalized))) {
    throw new Error('Model contains possible sensitive material and was not sent to MiniMax');
  }
  return normalized;
}

function getProviderConfigStatus(config: MiniMaxProviderConfig): Pick<MiniMaxProviderSmokeResult, 'configured' | 'baseUrlConfigured' | 'apiKeyConfigured'> {
  const baseUrl = config.baseUrl?.trim();
  const apiKey = config.apiKey?.trim();
  const baseUrlConfigured = typeof baseUrl === 'string' && baseUrl.length > 0 && getHttpsBaseUrl(baseUrl) !== null;
  const apiKeyConfigured = typeof apiKey === 'string' && apiKey.length > 0;
  return {
    configured: baseUrlConfigured && apiKeyConfigured,
    baseUrlConfigured,
    apiKeyConfigured
  };
}

function extractResponseText(value: unknown): string | null {
  if (value === null || typeof value !== 'object') return null;
  const content = (value as MiniMaxMessageResponse).content;
  if (!Array.isArray(content)) return null;
  const textParts = content
    .filter((item): item is { type: string; text: string } => item !== null && typeof item === 'object' && (item as { type?: unknown }).type === 'text' && typeof (item as { text?: unknown }).text === 'string')
    .map((item) => item.text)
    .filter((text) => text.trim().length > 0);
  return textParts.length > 0 ? textParts.join('') : null;
}

function createSmokeResult(
  configStatus: Pick<MiniMaxProviderSmokeResult, 'configured' | 'baseUrlConfigured' | 'apiKeyConfigured'>,
  endpoint: string,
  model: string,
  fields: Pick<MiniMaxProviderSmokeResult, 'ok' | 'status' | 'responseText'>
): MiniMaxProviderSmokeResult {
  return {
    provider: 'minimax',
    ...configStatus,
    endpoint,
    model,
    ...fields,
    summary: fields.responseText === null ? null : fields.responseText.length > 120 ? `${fields.responseText.slice(0, 117)}...` : fields.responseText
  };
}

function createErrorSmokeResult(
  configStatus: Pick<MiniMaxProviderSmokeResult, 'configured' | 'baseUrlConfigured' | 'apiKeyConfigured'>,
  endpoint: string,
  model: string,
  error: unknown
): MiniMaxProviderSmokeResult {
  return {
    provider: 'minimax',
    ...configStatus,
    endpoint,
    model,
    ok: false,
    status: 0,
    responseText: null,
    summary: redactSensitiveErrorMessage(getErrorMessage(error))
  };
}

export async function runMiniMaxPrompt(config: MiniMaxProviderConfig, options: MiniMaxPromptOptions, fetchImpl: typeof fetch = fetch): Promise<MiniMaxProviderSmokeResult> {
  const baseUrl = config.baseUrl?.trim();
  const apiKey = config.apiKey?.trim();
  const configStatus = getProviderConfigStatus(config);
  const model = normalizeModel(options.model);
  const httpsBaseUrl = baseUrl ? getHttpsBaseUrl(baseUrl) : null;
  const endpoint = httpsBaseUrl ? buildMessagesEndpoint(httpsBaseUrl) : '';
  if (!baseUrl || !apiKey || !httpsBaseUrl) {
    return createSmokeResult(configStatus, endpoint, model, { ok: false, status: 0, responseText: null });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content: options.prompt }]
      }),
      signal: controller.signal,
      redirect: 'error'
    });

    const responseJson = await response.json().catch((): unknown => null);
    const responseText = extractResponseText(responseJson);
    let hasSuccessText = true;
    if (options.successText) {
      if (options.successMatch === 'startsWith') {
        hasSuccessText = responseText?.trimStart().startsWith(options.successText) === true;
      } else {
        hasSuccessText = responseText?.includes(options.successText) === true;
      }
    }
    const ok = response.ok && responseText !== null && hasSuccessText;

    clearTimeout(timeout);
    return createSmokeResult(configStatus, endpoint, model, {
      ok,
      status: response.status,
      responseText
    });
  } catch (error) {
    clearTimeout(timeout);
    return createErrorSmokeResult(configStatus, endpoint, model, error);
  }
}

export async function testMiniMaxProvider(config: MiniMaxProviderConfig, options: MiniMaxProviderSmokeOptions = {}, fetchImpl: typeof fetch = fetch): Promise<MiniMaxProviderSmokeResult> {
  return runMiniMaxPrompt(config, { ...(options.model !== undefined ? { model: options.model } : {}), prompt: SMOKE_PROMPT, successText: SMOKE_EXPECTED_TEXT }, fetchImpl);
}
