/**
 * Artifact boundary helpers for peaks-loop.
 *
 * Slice rid-009:
 *   - sub-slice 1: change-id validation (`validateChangeId`).
 *   - sub-slice 2: artifact path planning (`planArtifactPath` + `isPathInsideArtifactRoot` re-export).
 *   - sub-slice 3: workspace-unavailable response (`buildWorkspaceUnavailable`).
 *
 * The colocated single-file layout avoids creating two competing path-safety
 * layers — `src/shared/path-safety.ts` already owns the primitive
 * `isPathInsideArtifactRoot` which we re-export unchanged.
 *
 * Conventions:
 *   - `Result<T, E>` is hand-rolled in this file (no `neverthrow` dep).
 *   - All errors are typed unions — no thrown exceptions for validation.
 *   - The change-id format mirrors the pre-existing
 *     `[A-Za-z0-9][A-Za-z0-9._-]*` regex used by
 *     `openspec-validate-service.ts` so the refactor (task 3) preserves
 *     the exact error message byte-for-byte.
 *   - Path planning uses `posix.normalize` to keep semantics stable across
 *     win32/posix runners; JSON output always uses `/`.
 */

import { posix, relative, resolve, isAbsolute as nodeIsAbsolute } from 'node:path';

import { isPathInsideArtifactRoot as _isPathInsideArtifactRoot } from '../../shared/path-safety.js';
import { normalizePath } from '../../shared/path-utils.js';

export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok;
}

export type ChangeIdError =
  | { code: 'change-id-empty'; message: string }
  | { code: 'change-id-format'; message: string }
  | { code: 'change-id-reserved'; message: string };

export type BoundaryError =
  | ChangeIdError
  | { code: 'workspace-unconfigured'; message: string }
  | { code: 'path-outside-artifact-root'; path: string; root: string; message: string }
  | { code: 'unsafe-path-input'; message: string };

const CHANGE_ID_FORMAT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Validate a change-id string. Returns a typed `Result`; the error code
 * distinguishes "empty" / "format" / "reserved" so callers can branch on
 * the cause without re-parsing the message.
 *
 * Acceptance contract (rid-009 §3.3.1, task 1):
 *   - accepts `[A-Za-z0-9][A-Za-z0-9._-]*` (existing regex semantics)
 *   - rejects empty string with `change-id-empty`
 *   - rejects `.` and `..` with `change-id-reserved`
 *   - rejects everything else that does not match the regex with
 *     `change-id-format`
 *
 * The format-error message is byte-for-byte identical to the pre-refactor
 * string produced at `openspec-validate-service.ts:55` so existing
 * `OpenSpecValidationIssue` consumers do not break.
 */
export function validateChangeId(id: string): Result<{ changeId: string }, ChangeIdError> {
  if (id === '') {
    return err({ code: 'change-id-empty', message: 'changeId is empty' });
  }

  if (id === '.' || id === '..') {
    return err({ code: 'change-id-reserved', message: `changeId ${id} is reserved` });
  }

  if (id.startsWith('.') || id.endsWith('.')) {
    return err({
      code: 'change-id-format',
      message: `changeId ${id} does not match [A-Za-z0-9][A-Za-z0-9._-]*`
    });
  }

  if (!CHANGE_ID_FORMAT_PATTERN.test(id)) {
    return err({
      code: 'change-id-format',
      message: `changeId ${id} does not match [A-Za-z0-9][A-Za-z0-9._-]*`
    });
  }

  return ok({ changeId: id });
}

/**
 * Re-export of `src/shared/path-safety.ts#isPathInsideArtifactRoot`.
 *
 * Single source of truth: the primitive is owned by `src/shared/path-safety.ts`;
 * this module owns the *domain* helpers (change-id + path planner) that consume
 * the primitive. Tests in `tests/unit/services/openspec/artifact-boundary.test.ts`
 * exercise the RE-EXPORT wiring; the primitive's own correctness is covered by
 * its native test file.
 */
export { _isPathInsideArtifactRoot as isPathInsideArtifactRoot };

/**
 * Input for `planArtifactPath`. The caller MUST supply `changeId`, `workspaceRoot`,
 * `role`, and `requestId`. Exactly one of `absolutePath` or `relativePath` may be
 * supplied; if neither is supplied, a default template `"<changeId>/<role>/<requestId>"`
 * is used. `template` overrides the default placeholder substitution when both
 * `absolutePath` and `relativePath` are absent.
 */
export type PlanArtifactPathInput = {
  changeId: string;
  workspaceRoot: string;
  role: string;
  requestId: string;
  absolutePath?: string;
  relativePath?: string;
  template?: string;
};

export type PlanArtifactPathOutput = {
  absolutePath: string;
  relativePath: string;
  jsonSafeRelativePath: string;
};

const DEFAULT_TEMPLATE = '<changeId>/<role>/<requestId>';

function interpolateTemplate(template: string, changeId: string, role: string, requestId: string): string {
  return template
    .replaceAll('<changeId>', changeId)
    .replaceAll('<role>', role)
    .replaceAll('<requestId>', requestId);
}

/**
 * Plan an artifact-relative path under the configured Peaks artifact workspace.
 *
 * Semantics (rid-009 §3.3.2, tasks 5–9):
 *   - Backslashes in the candidate path are normalized to forward slashes for
 *     JSON safety; empty segments (`foo//bar`) are collapsed by `posix.normalize`.
 *   - If the resolved absolute path is NOT contained under `workspaceRoot`
 *     (per `isPathInsideArtifactRoot`), returns
 *     `BoundaryError.path-outside-artifact-root` — NO silent fallback to cwd.
 *   - JSON output (`jsonSafeRelativePath`) ALWAYS uses `/` so it round-trips
 *     cleanly through `JSON.stringify` on Windows.
 *
 * Path math only — this helper never touches the filesystem, so it is fully
 * hermetic and safe to call on paths that do not exist yet.
 */
export function planArtifactPath(
  input: PlanArtifactPathInput
): Result<PlanArtifactPathOutput, BoundaryError> {
  const workspaceRoot = input.workspaceRoot;
  const candidateRaw =
    input.absolutePath !== undefined
      ? input.absolutePath
      : input.relativePath !== undefined
        ? input.relativePath
        : interpolateTemplate(input.template ?? DEFAULT_TEMPLATE, input.changeId, input.role, input.requestId);

  // Always normalize separators to forward-slashes for the JSON-safe output,
  // then run posix.normalize so empty segments (foo//bar) and `..` segments
  // collapse to canonical form.
  const forwardSlashed = normalizePath(candidateRaw);
  const normalized = posix.normalize(forwardSlashed);

  // Resolve against workspaceRoot. If the candidate is already absolute,
  // posix.normalize preserves the leading `/`; `resolve` keeps it absolute
  // without prepending workspaceRoot (Node's path.resolve treats absolute
  // candidates as already-resolved).
  const absolutePath = nodeIsAbsolute(normalized)
    ? resolve(normalized)
    : resolve(workspaceRoot, normalized);

  if (!_isPathInsideArtifactRoot(absolutePath, workspaceRoot)) {
    return err({
      code: 'path-outside-artifact-root',
      path: absolutePath,
      root: workspaceRoot,
      message: `path "${absolutePath}" resolves outside artifact root "${workspaceRoot}"`
    });
  }

  const relativePath = relative(workspaceRoot, absolutePath);
  const jsonSafeRelativePath = normalizePath(relativePath);

  return ok({ absolutePath, relativePath, jsonSafeRelativePath });
}

export type WorkspaceUnavailableResponse = {
  ok: false;
  mode: 'preview-only' | 'blocked';
  reason: 'artifact-workspace-unavailable';
  nextActions: string[];
};

const WORKSPACE_UNAVAILABLE_NEXT_ACTIONS = [
  'Configure artifact workspace by describing where Peaks should store artifacts.'
];

/**
 * Build the explicit response used when no artifact workspace is configured.
 * The next action is static natural language so callers can surface remediation
 * without requiring the user to type a CLI command or hand-author data.
 */
export function buildWorkspaceUnavailable(input: {
  mode: WorkspaceUnavailableResponse['mode'];
}): WorkspaceUnavailableResponse {
  return {
    ok: false,
    mode: input.mode,
    reason: 'artifact-workspace-unavailable',
    nextActions: [...WORKSPACE_UNAVAILABLE_NEXT_ACTIONS]
  };
}

