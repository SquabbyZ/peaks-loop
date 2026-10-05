// src/services/audit/red-line-audit-input.ts
//
// Validates the JSON a caller hands to `peaks audit artifact write --kind
// decision`.
//
// The input crosses a system boundary — it is a file from disk, usually an
// archived scan — and the writer it feeds renders whatever it is given into a
// memory record with no further checks. Without a validator here, a truncated
// or reshaped JSON would land in `.peaks/memory/audit-decisions/` as if it were
// a verdict, and the memory index would treat it as one. So the shape is
// asserted field by field, and every refusal names the field that failed.
//
// Why not a schema library: the contract is six fields and two item shapes, all
// of which already exist as TypeScript types in `./types.js`. A runtime schema
// would be a second spelling of the same contract, free to drift.

import type { RedLineAudit, RedLineEntry, EnforcerFinding } from './types.js';

/** The refusal the CLI reports as `AUDIT_ARTIFACT_INPUT_INVALID`. */
export class RedLineAuditInputError extends Error {
  constructor(problem: string) {
    super(`decision input is not a RedLineAudit: ${problem}`);
    this.name = 'RedLineAuditInputError';
  }
}

const COUNT_FIELDS = ['totalRedLines', 'cliBacked', 'partial', 'proseOnly'] as const;
const ENTRY_FIELDS = ['id', 'rule', 'source', 'backing'] as const;
const FINDING_FIELDS = ['enforcerId', 'rule', 'severity', 'file', 'detail'] as const;
const FINDING_SEVERITIES = ['pass', 'warn', 'fail'] as const;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RedLineAuditInputError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireCounts(audit: Record<string, unknown>): void {
  for (const field of COUNT_FIELDS) {
    const value = audit[field];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new RedLineAuditInputError(`${field} must be a non-negative integer`);
    }
  }
}

function requireEntries(audit: Record<string, unknown>): void {
  const entries = audit['audit'];
  if (!Array.isArray(entries)) {
    throw new RedLineAuditInputError('audit must be an array of red-line entries');
  }
  for (const entry of entries) {
    const record = asRecord(entry, 'audit[]');
    for (const field of ENTRY_FIELDS) {
      if (typeof record[field] !== 'string') {
        throw new RedLineAuditInputError(`audit[].${field} must be a string`);
      }
    }
    const ref = record['enforcerRef'];
    if (typeof ref !== 'string' && ref !== null) {
      throw new RedLineAuditInputError('audit[].enforcerRef must be a string or null');
    }
  }
}

function requireFindings(audit: Record<string, unknown>): void {
  const findings = audit['enforcerFindings'];
  if (!Array.isArray(findings)) {
    throw new RedLineAuditInputError('enforcerFindings must be an array');
  }
  for (const finding of findings) {
    const record = asRecord(finding, 'enforcerFindings[]');
    for (const field of FINDING_FIELDS) {
      if (typeof record[field] !== 'string') {
        throw new RedLineAuditInputError(`enforcerFindings[].${field} must be a string`);
      }
    }
    const severity = record['severity'];
    if (
      typeof severity !== 'string' ||
      !(FINDING_SEVERITIES as readonly string[]).includes(severity)
    ) {
      throw new RedLineAuditInputError(
        `enforcerFindings[].severity must be one of ${FINDING_SEVERITIES.join(' | ')}`
      );
    }
  }
}

/**
 * Parse and validate a RedLineAudit JSON document. Throws
 * `RedLineAuditInputError` naming the first field that failed; returns the
 * parsed value typed as `RedLineAudit` once every field holds.
 */
export function parseRedLineAuditInput(text: string): RedLineAudit {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new RedLineAuditInputError(`invalid JSON (${String(error)})`);
  }

  const audit = asRecord(parsed, 'the document');
  requireCounts(audit);
  requireEntries(audit);
  requireFindings(audit);

  return {
    totalRedLines: Number(audit['totalRedLines']),
    cliBacked: Number(audit['cliBacked']),
    partial: Number(audit['partial']),
    proseOnly: Number(audit['proseOnly']),
    audit: (audit['audit'] as unknown[]).map((entry) => entry as RedLineEntry),
    enforcerFindings: (audit['enforcerFindings'] as unknown[]).map(
      (finding) => finding as EnforcerFinding
    )
  };
}
