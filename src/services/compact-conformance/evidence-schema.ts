/**
 * Conformance evidence schema + integrity — Phase 3 Task 3.3.
 *
 * Strict Zod schemas for `EvidencePointer` and `CompactConformanceCaseResult`.
 * Rejects raw tokens, raw transcripts, raw capsule bodies, secret-like
 * substrings, missing digests, and outside-root paths.
 */
import { z } from 'zod';

export const CONFORMANCE_EVIDENCE_SCHEMA_VERSION = 1 as const;

const HEX_64 = /^[a-f0-9]{64}$/i;

const RELATIVE_POSIX = /^(?!.*\.\.)(?!.*\/\/)(?!^(\/|[A-Za-z]:\/))(?!.*\.(env|pem|key)$)(?!.*(id_rsa|id_dsa|passwd|shadow))[^<>:"|?*\0]+$/;

const FORBIDDEN_SUBSTRINGS = [
  'secret',
  'password',
  'api_key',
  'api-key',
  'token=',
  'bearer ',
  'authorization:',
  'private_key',
  'capsule_body',
  'continuationToken',
  'continuation_token'
];

export class EvidenceSchemaError extends Error {
  override readonly name = 'EvidenceSchemaError';
  constructor(message: string) {
    super(message);
  }
}

const EvidencePointerSchema = z
  .object({
    key: z.string().min(1).max(128),
    path: z.string().min(1).max(1024).regex(RELATIVE_POSIX, 'path must be relative and contain no traversal / forbidden patterns'),
    sha256: z.string().regex(HEX_64, 'sha256 must be 64 lowercase hex chars'),
    summary: z.string().min(1).max(256)
  })
  .strict();

const ConformanceCaseStatusSchema = z.enum(['passed', 'failed', 'skipped']);

const CompactConformanceCaseResultSchema = z
  .object({
    caseId: z.string().min(1).max(256),
    status: ConformanceCaseStatusSchema,
    startedAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }),
    evidence: z.array(EvidencePointerSchema).default([]),
    failureCode: z.string().min(1).max(64).optional(),
    failureMessage: z.string().min(1).max(1024).optional()
  })
  .strict()
  .superRefine((result, ctx) => {
    if (result.status === 'skipped' && result.failureCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'skipped cases must not carry failureCode; skipped is not a failure'
      });
    }
    if (result.status === 'passed' && (result.failureCode || result.failureMessage)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'passed cases must not carry failureCode/failureMessage'
      });
    }
    if (new Date(result.completedAt).getTime() < new Date(result.startedAt).getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'completedAt must not be before startedAt'
      });
    }
  });

const CompactConformanceReportSchema = z
  .object({
    contractVersion: z.literal(CONFORMANCE_EVIDENCE_SCHEMA_VERSION),
    generatedAt: z.string().datetime({ offset: true }),
    cases: z.array(CompactConformanceCaseResultSchema).min(0).max(1024),
    reportDigest: z.string().regex(HEX_64).optional()
  })
  .strict();

export const CompactConformanceCaseResultSchema_ = CompactConformanceCaseResultSchema;
export const CompactConformanceReportSchema_ = CompactConformanceReportSchema;
export const EvidencePointerSchema_ = EvidencePointerSchema;

/**
 * Recursive scan of any JSON-serializable value for forbidden substrings.
 * Mirrors provider-manifest-schema but with the conformance-specific
 * blacklist (capsule body, continuation token, etc.).
 */
export function assertNoForbiddenEvidenceContent(value: unknown, path = '$'): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    for (const s of FORBIDDEN_SUBSTRINGS) {
      if (value.toLowerCase().includes(s)) {
        throw new EvidenceSchemaError(`${path} contains forbidden substring "${s}"`);
      }
    }
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      assertNoForbiddenEvidenceContent(value[i], `${path}[${i}]`);
    }
    return;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const k of Object.keys(obj)) {
      assertNoForbiddenEvidenceContent(k, `${path}.${k}`);
      assertNoForbiddenEvidenceContent(obj[k], `${path}.${k}`);
    }
  }
}
