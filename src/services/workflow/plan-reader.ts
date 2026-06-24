/**
 * `peaks workflow plan read` — slice 025 (Security + Perf Plan/Result split).
 *
 * Returns the envelope `{ exists, path, hash, refreshedAt }` for the
 * session-scoped security-test-plan or perf-baseline plan. The hash is
 * computed on the **normalized** body (sections sorted, blank lines
 * collapsed) so it is independent of cosmetic re-ordering; mtime is
 * surfaced as ISO-8601.
 *
 * Back-compat: when the BACK_COMPAT_FLAG env var is "1" and the
 * legacy path (`.peaks/_runtime/<planFile>` at the project root) exists but
 * the canonical session path does not, the reader falls back to the
 * legacy path and reports `source: "legacy"`.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fail, ok, type ResultEnvelope } from '../../shared/result.js';
import { getSessionDir } from '../session/getSessionDir.js';

export type PlanType = 'security' | 'perf';

/** Back-compat env-var. When set to "1", fall back to legacy paths. */
export const BACK_COMPAT_FLAG = 'PEAKS_PLAN_LEGACY_FALLBACK';

/** F-1 (slice 025 security): canonical session-id shape. */
export const SESSION_ID_PATTERN = /^\d{4}-\d{2}-\d{2}-[a-z][a-z0-9-]*[a-z0-9]$/;

export interface ReadPlanArgs {
  readonly type: PlanType;
  readonly project: string;
  readonly sessionId: string;
}

export interface ReadPlanData {
  readonly type: PlanType;
  readonly exists: boolean;
  readonly path: string;
  readonly hash: string | null;
  readonly refreshedAt: string | null;
  /** `'canonical' | 'legacy' | 'missing'` — surfaced to the slice workflow
   * so it can warn the user about a back-compat fallback. */
  readonly source: 'canonical' | 'legacy' | 'missing';
}

const PLAN_FILE: Record<PlanType, string> = {
  security: 'security-test-plan.md',
  perf: 'perf-baseline.md'
};

/**
 * Normalize a markdown body for hashing. Sections sorted, blank lines
 * collapsed, leading/trailing whitespace stripped. Hash is sha256[0:12].
 */
export function normalizePlanBody(body: string): string {
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.sort().join('\n');
}

/** Compute the deterministic plan hash on a normalized body. */
export function hashNormalizedBody(body: string): string {
  const normalized = normalizePlanBody(body);
  return createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 12);
}

function canonicalPath(args: { projectRoot: string; sessionId: string; type: PlanType }): string {
  return join(getSessionDir(args.projectRoot, args.sessionId), 'qa', PLAN_FILE[args.type]);
}

function legacyPath(args: { projectRoot: string; type: PlanType }): string {
  return join(args.projectRoot, '.peaks', PLAN_FILE[args.type]);
}

/** Build the data envelope for a path that exists. */
function buildData(args: {
  type: PlanType;
  path: string;
  source: ReadPlanData['source'];
}): ReadPlanData {
  const stats = statSync(args.path);
  return {
    type: args.type,
    exists: true,
    path: args.path,
    hash: hashNormalizedBody(readFileSync(args.path, 'utf8')),
    refreshedAt: stats.mtime.toISOString(),
    source: args.source
  };
}

/**
 * F-2 (slice 025 security): resolve symlinks and confirm the real path
 * still lives under the expected base directory. A canonical path
 * may itself be a symlink (or a directory in the path chain may be),
 * which would let a malicious or accidental symlink escape the
 * `.peaks/_runtime/<sessionId>/` containment. We reject anything
 * whose real path falls outside the expected base.
 *
 * The caller passes the expected base:
 *   - session dir for canonical reads (`.peaks/_runtime/<sid>/qa/...`)
 *   - project root for legacy back-compat reads (`.peaks/_runtime/<planFile>`)
 */
function assertContained(args: {
  expectedBase: string;
  path: string;
}): { ok: true; real: string } | { ok: false; code: 'SYMLINK_ESCAPE'; message: string } {
  let real: string;
  try {
    real = realpathSync(args.path);
  } catch {
    // If realpath fails (e.g. broken symlink), treat as escape — never
    // return "ok" without a verified real path.
    return {
      ok: false,
      code: 'SYMLINK_ESCAPE',
      message: `resolved path escapes base directory: cannot resolve ${args.path}`
    };
  }
  // Slice 2026-06-13-repair-pre-existing-test-failures: realpath the
  // expectedBase too. On macOS the OS exposes /tmp and
  // /var/folders/... as symlinks to /private/tmp and
  // /private/var/folders/.... `mkdtempSync` returns the unresolved
  // form; the file inside resolves through the symlink. Without
  // symmetric realpath on both sides, the prefix check incorrectly
  // rejects a file that is genuinely inside the base directory.
  // Falls back to the raw expectedBase when the base itself does
  // not yet exist (e.g. the canonical session dir before first
  // write), preserving the pre-fix behavior for that case.
  let expectedPrefix: string;
  try {
    expectedPrefix = join(realpathSync(args.expectedBase), sep);
  } catch {
    expectedPrefix = join(args.expectedBase, sep);
  }
  if (!real.startsWith(expectedPrefix)) {
    return {
      ok: false,
      code: 'SYMLINK_ESCAPE',
      message: `resolved path escapes base directory: ${real} is not under ${expectedPrefix}`
    };
  }
  return { ok: true, real };
}

export function readPlan(args: ReadPlanArgs): ResultEnvelope<ReadPlanData> {
  // F-1 (slice 025 security): reject path-traversal payloads before any
  // filesystem call. The CLI also validates, but the service is the
  // authoritative gate — every caller (CLI, skill, integration test)
  // benefits from the same rejection shape.
  if (!SESSION_ID_PATTERN.test(args.sessionId)) {
    return fail('workflow.plan.read', 'INVALID_SESSION_ID', 'session id must match YYYY-MM-DD-slug pattern', {
      type: args.type,
      exists: false,
      path: '',
      hash: null,
      refreshedAt: null,
      source: 'missing'
    } satisfies ReadPlanData);
  }
  const canonical = canonicalPath({ projectRoot: args.project, sessionId: args.sessionId, type: args.type });
  if (existsSync(canonical)) {
    const guard = assertContained({
      expectedBase: getSessionDir(args.project, args.sessionId),
      path: canonical
    });
    if (!guard.ok) {
      return fail('workflow.plan.read', guard.code, guard.message, {
        type: args.type,
        exists: false,
        path: canonical,
        hash: null,
        refreshedAt: null,
        source: 'missing'
      } satisfies ReadPlanData);
    }
    return ok('workflow.plan.read', buildData({ type: args.type, path: canonical, source: 'canonical' }));
  }
  const legacy = legacyPath({ projectRoot: args.project, type: args.type });
  const backCompatEnabled = process.env[BACK_COMPAT_FLAG] === '1';
  if (backCompatEnabled && existsSync(legacy)) {
    const guard = assertContained({
      expectedBase: args.project,
      path: legacy
    });
    if (!guard.ok) {
      return fail('workflow.plan.read', guard.code, guard.message, {
        type: args.type,
        exists: false,
        path: legacy,
        hash: null,
        refreshedAt: null,
        source: 'missing'
      } satisfies ReadPlanData);
    }
    return ok('workflow.plan.read', buildData({ type: args.type, path: legacy, source: 'legacy' }));
  }
  return ok('workflow.plan.read', {
    type: args.type,
    exists: false,
    path: canonical,
    hash: null,
    refreshedAt: null,
    source: 'missing'
  } satisfies ReadPlanData);
}
