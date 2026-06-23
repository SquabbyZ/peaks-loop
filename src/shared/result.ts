import { randomUUID } from 'node:crypto';

export type ResultEnvelope<T> = {
  ok: boolean;
  command: string;
  data: T;
  warnings: string[];
  nextActions: string[];
  code?: string;
  message?: string;
  /**
   * Slice 2026-06-23-audit-4th #B3: opaque per-failure correlation
   * id. Always present on `fail()` envelopes. Lets a user say
   * "my last failure was errorId=X; show me the JSONL log lines
   * tagged with X" without grepping on a code/message that may be
   * repeated. Also written to the next writeLogEntry call (best-effort)
   * by the caller so the log entry can be cross-referenced.
   */
  errorId?: string;
};

export function ok<T>(command: string, data: T, warnings: string[] = [], nextActions: string[] = []): ResultEnvelope<T> {
  return { ok: true, command, data, warnings, nextActions };
}

export function fail<T>(command: string, code: string, message: string, data: T, nextActions: string[] = []): ResultEnvelope<T> {
  // Slice 2026-06-23-audit-4th #B3: mint a fresh errorId per failure.
  // The id is opaque (uuid v4) and never reused; downstream log
  // entries from the same code path can carry the same id for
  // post-hoc correlation.
  return {
    ok: false,
    command,
    code,
    message: redactSensitiveErrorMessage(message),
    data,
    warnings: [],
    nextActions,
    errorId: randomUUID()
  };
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
