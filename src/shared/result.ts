export type ResultEnvelope<T> = {
  ok: boolean;
  command: string;
  data: T;
  warnings: string[];
  nextActions: string[];
  code?: string;
  message?: string;
};

export function ok<T>(command: string, data: T, warnings: string[] = [], nextActions: string[] = []): ResultEnvelope<T> {
  return { ok: true, command, data, warnings, nextActions };
}

export function fail<T>(command: string, code: string, message: string, data: T, nextActions: string[] = []): ResultEnvelope<T> {
  return { ok: false, command, code, message, data, warnings: [], nextActions };
}

const SENSITIVE_ERROR_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:api[\s_-]?key|token|password|secret)\s*[:=]\s*['\"]?[^\s'\"]{8,}/gi,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{20,}\b/g,
  /\bghp_[0-9A-Za-z_]{20,}\b/g,
  /\bgithub_pat_[0-9A-Za-z_]{20,}\b/g,
  /\bglpat-[0-9A-Za-z_-]{20,}\b/g,
  /\bxox[abprse]-[0-9A-Za-z-]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /(secret|token|password|api[-_ ]?key)/gi
] as const;

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Unexpected error';
}

export function redactSensitiveErrorMessage(message: string): string {
  return SENSITIVE_ERROR_PATTERNS.reduce((redacted, pattern) => redacted.replace(pattern, '[redacted]'), message);
}
