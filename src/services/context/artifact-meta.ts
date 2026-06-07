/**
 * G7 — sub-agent context minimal-occupation (RL-17..RL-22, AC-38..AC-43).
 *
 * `ArtifactMeta` is what the dispatch record stores per sub-agent artifact
 * instead of the full content. The `contentInlined: false` literal is the
 * API contract: the type system rejects `true`, so main LLM context can
 * never accidentally be flooded with inlined artifact bodies.
 *
 * The artifact's content lives on disk at `path`; the meta is ~200 chars
 * (path + size + sha256 + status + summary), so 3 sub-agents × ~200 chars
 * = ~600 chars net context increase per batch instead of 3MB+.
 *
 * Path convention (G7.4.c):
 *   `.peaks/_sub_agents/<sid>/artifacts/<rid>-<role>-<idx>.<ext>`
 *
 * See: `.peaks/memory/sub-agent-context-minimal-occupation.md` for the
 * full G7 rule.
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

export type ArtifactStatus = 'created' | 'finalized' | 'partial' | 'failed';

export interface ArtifactMeta {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
  readonly status: ArtifactStatus;
  /** Mandatory literal `false`. The type system rejects `true`. */
  readonly contentInlined: false;
  /** 1-2 sentence description, ≤ 200 chars. Allowed in main context. */
  readonly summary: string | null;
  /** ISO8601. */
  readonly writtenAt: string;
  /** Request id this artifact belongs to. */
  readonly rid: string;
  /** Sub-agent role string. */
  readonly role: string;
  /** Sequence number when same role is dispatched multiple times. */
  readonly idx: number;
}

export interface ContextImpact {
  readonly promptSize: number;
  readonly artifactSizes: readonly number[];
  readonly batchTotalSize: number;
  /** `high` if `batchTotalSize > 4MB` OR any `artifactSize > 1MB`. */
  readonly contextWarning: 'normal' | 'high' | 'critical';
}

const ARTIFACT_MAX_SIZE_BYTES = 1024 * 1024;       // 1MB
const BATCH_TOTAL_HIGH_BYTES = 4 * 1024 * 1024;    // 4MB

/**
 * Compute the sha256 hex digest of a file. Throws if the file does not
 * exist or is not readable. Caller is expected to handle ENOENT as
 * `code: 'ARTIFACT_NOT_FOUND'` and treat 0-byte files as `status: 'failed'`.
 */
export function computeSha256(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Build an `ArtifactMeta` from on-disk file. Computes size + sha256.
 *
 * `status` semantics:
 *   - `'created'`   — file exists, non-empty, sha256 succeeded
 *   - `'failed'`    — file is 0 bytes (R-2 / G7.4.e: do not silently succeed)
 *   - `'partial'`   — caller-provided (e.g. sub-agent reports unfinished work)
 *   - `'finalized'` — caller-provided (e.g. sub-agent reports complete)
 */
export function buildArtifactMeta(opts: {
  path: string;
  rid: string;
  role: string;
  idx: number;
  summary: string | null;
  status?: ArtifactStatus;
  /** Override sha256 / size (e.g. when caller already computed them). */
  precomputed?: { size: number; sha256: string };
  /** Override the writtenAt timestamp. */
  writtenAt?: string;
}): ArtifactMeta {
  let size: number;
  let sha256: string;
  let status: ArtifactStatus = opts.status ?? 'created';

  if (opts.precomputed) {
    size = opts.precomputed.size;
    sha256 = opts.precomputed.sha256;
  } else {
    const stat = statSync(opts.path);
    size = stat.size;
    if (size === 0) {
      // 0-byte artifact: cannot compute meaningful sha256; mark as failed.
      sha256 = '0'.repeat(64);
      status = 'failed';
    } else {
      sha256 = computeSha256(opts.path);
    }
  }

  const summary = opts.summary;
  if (summary !== null && summary.length > 200) {
    throw new Error(`ArtifactMeta summary must be ≤ 200 chars (got ${summary.length})`);
  }

  return {
    path: opts.path,
    size,
    sha256,
    status,
    contentInlined: false,
    summary,
    writtenAt: opts.writtenAt ?? new Date().toISOString(),
    rid: opts.rid,
    role: opts.role,
    idx: opts.idx
  };
}

/**
 * Build a `ContextImpact` from a prompt size + artifact sizes.
 * Computes `contextWarning` per the G7.3 rule:
 *   - `'critical'` if any artifact > ARTIFACT_MAX_SIZE_BYTES
 *   - `'high'`     if total > BATCH_TOTAL_HIGH_BYTES (4MB)
 *   - `'normal'`   otherwise
 */
export function buildContextImpact(opts: {
  promptSize: number;
  artifactSizes: readonly number[];
}): ContextImpact {
  const batchTotalSize = opts.promptSize + opts.artifactSizes.reduce((a, b) => a + b, 0);
  let contextWarning: ContextImpact['contextWarning'] = 'normal';
  if (opts.artifactSizes.some((s) => s > ARTIFACT_MAX_SIZE_BYTES)) {
    contextWarning = 'critical';
  } else if (batchTotalSize > BATCH_TOTAL_HIGH_BYTES) {
    contextWarning = 'high';
  }
  return {
    promptSize: opts.promptSize,
    artifactSizes: opts.artifactSizes,
    batchTotalSize,
    contextWarning
  };
}

export const ARTIFACT_LIMITS = {
  ARTIFACT_MAX_SIZE_BYTES,
  BATCH_TOTAL_HIGH_BYTES,
  ARTIFACT_SUMMARY_MAX_CHARS: 200
} as const;
