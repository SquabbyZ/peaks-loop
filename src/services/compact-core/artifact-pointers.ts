/**
 * Phase 2 Task 2.4 — artifact pointer validation + project-boundary guard.
 *
 * Wraps the bare `ArtifactPointer` Zod schema (capsule-types §7.1) with
 * the realpath + SHA-256 + project-containment contract design §16
 * demands. Two public entry points:
 *
 *   - `createArtifactPointer({ projectRoot, path, summary, kind? })`
 *     resolves both realpaths, computes SHA-256 over the canonicalized
 *     file bytes, and returns a populated `ArtifactPointer`. Throws
 *     `ArtifactPointerError` (with `code`) on any runtime rejection.
 *
 *   - `verifyArtifactPointer({ projectRoot, pointer })` recomputes both
 *     realpaths + SHA-256 and asserts containment + equality. Used by
 *     the resume / dispatch path before any side effect is taken on a
 *     persisted `ArtifactPointer`.
 *
 * Rejection surfaces (matches the brief):
 *
 *   `ArtifactPointerError.code`
 *     - `NOT_FOUND`        realpath could not be resolved (ENOENT)
 *                          or the file is empty/missing.
 *     - `HASH_MISMATCH`    SHA-256 over current bytes != pointer.sha256.
 *     - `OUTSIDE_PROJECT`  canonical realpath escapes the canonical
 *                          project root (handles absolute escapes and
 *                          symlink / junction / reparse escapes).
 *     - `EMPTY_PATH`       the literal path was empty before resolve.
 *     - `SUMMARY_TOO_LONG` summary exceeded 256 chars.
 *
 *   Input-validation surface (thrown as a plain `Error` whose message
 *   starts with one of the prefixes below, so the slice can branch on
 *   a stable surface without leaking extra codes into the I/O class):
 *     - `ARTIFACT_FORBIDDEN_SUMMARY` summary contains any of the
 *       Phase 1 forbidden substrings (secret / transcript / capsule /
 *       conversation), lower-cased comparison.
 *     - `ARTIFACT_UNKNOWN_KIND` `kind` is present but not in the
 *       canonical set (`memo | doc | log | snapshot | spec`).
 *
 * The read step uses `O_NOFOLLOW` so a symlink swap at the pointed
 * path cannot redirect the verifier to a tampered target mid-flight.
 * The containment step uses `realpathSync` so Windows junctions /
 * reparse points (which `lstat(...).isSymbolicLink()` returns FALSE
 * for) are detected.
 */
import { createHash } from 'node:crypto';
import { closeSync, constants, openSync, readFileSync, realpathSync } from 'node:fs';
import type { ArtifactPointer } from './capsule-types.js';

export const ARTIFACT_POINTER_SUMMARY_MAX = 256;

/** Canonical `kind` set exposed for downstream validation. */
export const ARTIFACT_POINTER_KINDS = ['memo', 'doc', 'log', 'snapshot', 'spec'] as const;
export type ArtifactPointerKind = (typeof ARTIFACT_POINTER_KINDS)[number];

const KIND_SET: ReadonlySet<string> = new Set(ARTIFACT_POINTER_KINDS);

/** Phase 1 forbidden-substring set (design §15). Lower-cased comparison. */
const FORBIDDEN_SUMMARY_SUBSTRINGS = [
  'secret',
  'transcript',
  'capsule',
  'conversation'
] as const;

export type ArtifactPointerErrorCode =
  | 'NOT_FOUND'
  | 'HASH_MISMATCH'
  | 'OUTSIDE_PROJECT'
  | 'EMPTY_PATH'
  | 'SUMMARY_TOO_LONG';

export class ArtifactPointerError extends Error {
  readonly code: ArtifactPointerErrorCode;
  constructor(code: ArtifactPointerErrorCode, message: string) {
    super(message);
    this.name = 'ArtifactPointerError';
    this.code = code;
  }
}

export interface CreateArtifactPointerInput {
  readonly projectRoot: string;
  readonly path: string;
  readonly summary: string;
  readonly kind?: ArtifactPointerKind;
}

export interface VerifyArtifactPointerInput {
  readonly projectRoot: string;
  readonly pointer: ArtifactPointer;
}

/**
 * Build an `ArtifactPointer` by resolving the project root + artifact
 * path via `realpath`, computing SHA-256 over the bytes, and asserting
 * containment + summary constraints.
 *
 * No mutation of the file system. Idempotent: calling twice on the
 * same unchanged bytes returns pointers with the same SHA-256.
 */
export function createArtifactPointer(input: CreateArtifactPointerInput): ArtifactPointer {
  if (!input || typeof input !== 'object') {
    throw new ArtifactPointerError('EMPTY_PATH', 'createArtifactPointer: input is required');
  }
  if (typeof input.projectRoot !== 'string' || input.projectRoot.length === 0) {
    throw new ArtifactPointerError('EMPTY_PATH', 'createArtifactPointer: projectRoot is required');
  }
  if (typeof input.path !== 'string' || input.path.length === 0) {
    throw new ArtifactPointerError('EMPTY_PATH', 'createArtifactPointer: path must be a non-empty string');
  }
  validateSummary(input.summary);
  if (input.kind !== undefined && !KIND_SET.has(input.kind)) {
    throw new Error(
      `ARTIFACT_UNKNOWN_KIND: kind "${input.kind}" must be one of ${ARTIFACT_POINTER_KINDS.join(' | ')}`
    );
  }

  const canonicalProjectRoot = safeRealpath(input.projectRoot);
  const canonicalArtifact = safeRealpath(input.path, 'NOT_FOUND');
  assertInside(canonicalArtifact, canonicalProjectRoot, input.path);

  const bytes = readNoFollow(input.path);
  const digest = createHash('sha256').update(bytes).digest('hex');

  const pointer: ArtifactPointer =
    input.kind !== undefined
      ? {
          path: canonicalArtifact,
          sha256: digest,
          summary: input.summary,
          kind: input.kind
        }
      : {
          path: canonicalArtifact,
          sha256: digest,
          summary: input.summary
        };
  return pointer;
}

/**
 * Recompute both realpaths + SHA-256 and assert the artifact still sits
 * inside the canonical project root and the bytes still hash to the
 * recorded digest. Throws `ArtifactPointerError` on the first mismatch.
 */
export function verifyArtifactPointer(input: VerifyArtifactPointerInput): void {
  if (!input || typeof input !== 'object') {
    throw new ArtifactPointerError('EMPTY_PATH', 'verifyArtifactPointer: input is required');
  }
  if (typeof input.projectRoot !== 'string' || input.projectRoot.length === 0) {
    throw new ArtifactPointerError('EMPTY_PATH', 'verifyArtifactPointer: projectRoot is required');
  }
  const pointer = input.pointer;
  if (!pointer || typeof pointer !== 'object') {
    throw new ArtifactPointerError('EMPTY_PATH', 'verifyArtifactPointer: pointer is required');
  }
  if (typeof pointer.path !== 'string' || pointer.path.length === 0) {
    throw new ArtifactPointerError('EMPTY_PATH', 'verifyArtifactPointer: pointer.path must be a non-empty string');
  }
  if (typeof pointer.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(pointer.sha256)) {
    throw new ArtifactPointerError('HASH_MISMATCH', 'verifyArtifactPointer: pointer.sha256 must be 64 lowercase hex chars');
  }
  validateSummary(pointer.summary);

  const canonicalProjectRoot = safeRealpath(input.projectRoot);
  const canonicalArtifact = safeRealpath(pointer.path, 'NOT_FOUND');
  assertInside(canonicalArtifact, canonicalProjectRoot, pointer.path);

  const bytes = readNoFollow(pointer.path);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== pointer.sha256) {
    throw new ArtifactPointerError(
      'HASH_MISMATCH',
      `verifyArtifactPointer: SHA-256 mismatch at ${pointer.path} (expected ${pointer.sha256}, got ${digest})`
    );
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function validateSummary(summary: unknown): asserts summary is string {
  if (typeof summary !== 'string') {
    throw new ArtifactPointerError('SUMMARY_TOO_LONG', 'summary must be a string');
  }
  if (summary.length > ARTIFACT_POINTER_SUMMARY_MAX) {
    throw new ArtifactPointerError(
      'SUMMARY_TOO_LONG',
      `summary length ${summary.length} exceeds max ${ARTIFACT_POINTER_SUMMARY_MAX}`
    );
  }
  const lower = summary.toLowerCase();
  for (const forbidden of FORBIDDEN_SUMMARY_SUBSTRINGS) {
    if (lower.includes(forbidden)) {
      throw new Error(
        `ARTIFACT_FORBIDDEN_SUMMARY: summary contains forbidden substring "${forbidden}"`
      );
    }
  }
}

/**
 * `realpathSync` wrapper that converts an ENOENT into the supplied code.
 * Any other error (permission, etc.) bubbles up unchanged — those are
 * environment failures, not the "file genuinely missing" case the
 * brief calls out.
 */
function safeRealpath(p: string, missingCode: 'NOT_FOUND' | 'EMPTY_PATH' = 'EMPTY_PATH'): string {
  try {
    return realpathSync(p);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err && err.code === 'ENOENT') {
      throw new ArtifactPointerError(missingCode, `path not found: ${p}`);
    }
    throw new ArtifactPointerError(missingCode, `failed to resolve ${p}: ${err.message}`);
  }
}

function assertInside(canonicalChild: string, canonicalParent: string, original: string): void {
  if (!isSameOrNested(canonicalChild, canonicalParent)) {
    throw new ArtifactPointerError(
      'OUTSIDE_PROJECT',
      `refusing to operate outside project root: ${original} (resolved: ${canonicalChild}, project: ${canonicalParent})`
    );
  }
}

/**
 * Compare two canonical, platform-normalized paths. Returns true when
 * `child === parent` or `child` is nested inside `parent`. Mirrors the
 * helper in `attempt-schema.ts` so the two containment checks agree on
 * Windows vs POSIX separator semantics.
 */
function isSameOrNested(child: string, parent: string): boolean {
  if (child === parent) return true;
  const sep = parent.includes('\\') ? '\\' : '/';
  const prefix = parent.endsWith(sep) ? parent : parent + sep;
  return child.startsWith(prefix);
}

/**
 * Open the file with `O_NOFOLLOW` and read its full contents. The
 * no-follow flag refuses to traverse a symlink at the pointed path;
 * combined with the realpath-based containment check above, this
 * blocks a TOCTOU symlink swap between the realpath resolve and the
 * byte read.
 */
function readNoFollow(filePath: string): Buffer {
  const fd = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}