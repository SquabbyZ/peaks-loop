/**
 * Evidence recorder — Phase 3 Task 3.3.
 *
 * Computes SHA-256 over evidence file bytes and produces sanitized
 * `EvidencePointer` items. Persists reports under the on-disk evidence
 * root when an out-dir is provided; in-memory otherwise.
 */
import { createHash } from 'node:crypto';
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute, sep } from 'node:path';
import {
  EvidencePointerSchema_,
  CompactConformanceCaseResultSchema_,
  CompactConformanceReportSchema_,
  EvidenceSchemaError,
  assertNoForbiddenEvidenceContent
} from './evidence-schema.js';
import type {
  CompactConformanceCaseResult,
  CompactConformanceReport,
  EvidencePointer
} from './conformance-types.js';

export class EvidenceFileError extends Error {
  override readonly name = 'EvidenceFileError';
}

export class EvidencePathError extends Error {
  override readonly name = 'EvidencePathError';
}

export interface RecordEvidenceOptions {
  readonly caseId: string;
  readonly projectRoot: string;
  readonly status: 'passed' | 'failed' | 'skipped';
  readonly startedAt: Date;
  readonly failureCode?: string;
  readonly failureMessage?: string;
  readonly outDir?: string;
  readonly now?: Date;
  readonly pointerSource?: (pointerRoot: string) => Promise<EvidencePointer[]>;
}

function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = canonicalize(obj[key]);
  }
  return sorted;
}

export function computeRecordDigest(report: CompactConformanceReport): string {
  const json = JSON.stringify(canonicalize(report));
  return createHash('sha256').update(json, 'utf8').digest('hex');
}

function normalizePath(projectRoot: string, candidate: string): string {
  // Accept both relative (to projectRoot) and absolute paths, as long
  // as the absolute path is contained within projectRoot. Anything else
  // is rejected. The relative output is POSIX-style.
  const abs = isAbsolute(candidate) ? candidate : resolve(projectRoot, candidate);
  const projectRootAbs = resolve(projectRoot);
  if (!abs.startsWith(projectRootAbs + sep) && abs !== projectRootAbs) {
    throw new EvidencePathError(`path escapes projectRoot: ${candidate}`);
  }
  const rel = relative(projectRoot, abs);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new EvidencePathError(`path escapes projectRoot: ${candidate}`);
  }
  if (rel.split(sep).includes('..')) {
    throw new EvidencePathError(`path contains traversal: ${candidate}`);
  }
  return rel.split(sep).join('/');
}

async function fileSha256(path: string): Promise<string> {
  if (!existsSync(path)) {
    throw new EvidenceFileError(`evidence file not found: ${path}`);
  }
  const buf = readFileSync(path);
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Resolve and validate the on-disk evidence file path. Returns the
 * relative POSIX form (no leading `/`, no drive letter).
 */
export async function ingestEvidenceFile(
  projectRoot: string,
  filePath: string,
  key: string,
  summary: string
): Promise<EvidencePointer> {
  // Resolve to absolute path first so existsSync works for both
  // relative (relative to projectRoot) and absolute inputs. The
  // normalization below fails closed on absolute or escaping paths.
  const abs = isAbsolute(filePath) ? filePath : resolve(projectRoot, filePath);
  if (!existsSync(abs)) {
    throw new EvidenceFileError(`evidence file not found: ${abs}`);
  }
  const rel = normalizePath(projectRoot, abs);
  const sha = await fileSha256(abs);
  const pointer: EvidencePointer = { key, path: rel, sha256: sha, summary };
  // Schema-level rejection (forbidden substrings, hex regex, etc.)
  const result = EvidencePointerSchema_.safeParse(pointer);
  if (!result.success) {
    throw new EvidenceSchemaError(result.error.issues.map((i) => i.message).join('; '));
  }
  return result.data;
}

/**
 * Write a case result to the optional out-dir as `<caseId>.json`, with
 * sanitized content. The schema-level sanitization run also forbids
 * raw capsule bodies / continuation tokens.
 */
export async function recordCaseResult(
  options: RecordEvidenceOptions
): Promise<CompactConformanceCaseResult> {
  const now = options.now ?? new Date();
  const evidence = options.pointerSource ? await options.pointerSource(options.projectRoot) : [];
  const result: CompactConformanceCaseResult = {
    caseId: options.caseId,
    status: options.status,
    startedAt: options.startedAt.toISOString(),
    completedAt: now.toISOString(),
    evidence
  };
  if (options.failureCode !== undefined) (result as { failureCode?: string }).failureCode = options.failureCode;
  if (options.failureMessage !== undefined) (result as { failureMessage?: string }).failureMessage = options.failureMessage;
  const parsed = CompactConformanceCaseResultSchema_.safeParse(result);
  if (!parsed.success) {
    throw new EvidenceSchemaError(parsed.error.issues.map((i) => i.message).join('; '));
  }
  // Schema-level secret scan on the entire result.
  assertNoForbiddenEvidenceContent(parsed.data);

  if (options.outDir) {
    const outDir = resolve(options.projectRoot, options.outDir);
    if (!outDir.startsWith(resolve(options.projectRoot))) {
      throw new EvidencePathError(`outDir escapes projectRoot: ${options.outDir}`);
    }
    mkdirSync(outDir, { recursive: true });
    const filePath = resolve(outDir, `${options.caseId}.json`);
    writeFileSync(filePath, JSON.stringify(parsed.data, null, 2), 'utf8');
  }
  return parsed.data;
}

/**
 * Build a full report from cases, optionally computing a digest. The
 * result is a strict-schema instance.
 */
export function buildReport(cases: readonly CompactConformanceCaseResult[], now: Date = new Date()): CompactConformanceReport {
  const partial = {
    contractVersion: 1 as const,
    generatedAt: now.toISOString(),
    cases
  };
  const withDigest = { ...partial, reportDigest: computeRecordDigest(partial as CompactConformanceReport) };
  const parsed = CompactConformanceReportSchema_.safeParse(withDigest);
  if (!parsed.success) {
    throw new EvidenceSchemaError(parsed.error.issues.map((i) => i.message).join('; '));
  }
  return parsed.data;
}
