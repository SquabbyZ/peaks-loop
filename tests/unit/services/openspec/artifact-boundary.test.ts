/**
 * Artifact boundary helper — change-id validation + artifact path planning tests.
 *
 * Slice rid-009:
 *   - sub-slice 1 covers `validateChangeId(id) → Result<{changeId}, ChangeIdError>` (22 cases + contract).
 *   - sub-slice 2 covers `planArtifactPath(...) → Result<{absolutePath, relativePath, jsonSafeRelativePath}, BoundaryError>`
 *     and the `isPathInsideArtifactRoot` re-export wiring.
 *   - sub-slice 3 covers `buildWorkspaceUnavailable({mode}) → WorkspaceUnavailableResponse`
 *     and the two artifact-workspace-unavailable scenarios.
 *
 * TDD: this file is the RED source-of-truth for the validators' contract; the implementation
 * in `src/services/openspec/artifact-boundary.ts` must turn every case below green.
 *
 * Test count budget (per `.peaks/_runtime/2026-07-24-session-f13da7/rd/requests/2026-07-24-rid-009-enforce-artifact-boundary-and-coverage.md`):
 *   - sub-slice 1 / task 1:  9 valid + 13 invalid  = 22 cases for the validator body
 *   - sub-slice 1 / task 4:  2 contract/helper tests
 *   - sub-slice 2 / task 5:  9 cases for planArtifactPath (a-h + custom template)
 *   - sub-slice 2 / task 7:  4 cases for the isPathInsideArtifactRoot re-export wiring
 *   - sub-slice 2 / task 9:  1 anti-regression test (tempdir mount guards target repo)
 *   - sub-slice 3 / task 10: 5 workspace-unavailable response-contract cases
 *   - sub-slice 3 / task 12: 2 OpenSpec scenario cases
 * Total = 45 cases.
 */

import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import {
  validateChangeId,
  planArtifactPath,
  isPathInsideArtifactRoot,
  buildWorkspaceUnavailable,
  isOk,
  type ChangeIdError,
  type BoundaryError
} from '../../../../src/services/openspec/artifact-boundary.js';

describe('validateChangeId — valid cases (9)', () => {
  test('accepts a typical lowercase change id', () => {
    const result = validateChangeId('add-foo');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.changeId).toBe('add-foo');
    } else {
      throw new Error('expected ok result, got err: ' + JSON.stringify(result.error));
    }
  });

  test('accepts a mixed-case change id', () => {
    const result = validateChangeId('AddFoo');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.changeId).toBe('AddFoo');
    } else {
      throw new Error('expected ok result, got err: ' + JSON.stringify(result.error));
    }
  });

  test('accepts a digits-leading change id', () => {
    const result = validateChangeId('1two-three');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.changeId).toBe('1two-three');
    } else {
      throw new Error('expected ok result, got err: ' + JSON.stringify(result.error));
    }
  });

  test('accepts a change id with a dot', () => {
    const result = validateChangeId('add.foo');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.changeId).toBe('add.foo');
    } else {
      throw new Error('expected ok result, got err: ' + JSON.stringify(result.error));
    }
  });

  test('accepts a change id with an underscore', () => {
    const result = validateChangeId('add_foo');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.changeId).toBe('add_foo');
    } else {
      throw new Error('expected ok result, got err: ' + JSON.stringify(result.error));
    }
  });

  test('accepts a change id with multiple internal dots + hyphens + underscores', () => {
    const result = validateChangeId('add_foo.bar-baz_qux');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.changeId).toBe('add_foo.bar-baz_qux');
    } else {
      throw new Error('expected ok result, got err: ' + JSON.stringify(result.error));
    }
  });

  test('accepts a single-character change id', () => {
    const result = validateChangeId('a');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.changeId).toBe('a');
    } else {
      throw new Error('expected ok result, got err: ' + JSON.stringify(result.error));
    }
  });

  test('accepts a single-digit change id', () => {
    const result = validateChangeId('7');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.changeId).toBe('7');
    } else {
      throw new Error('expected ok result, got err: ' + JSON.stringify(result.error));
    }
  });

  test('accepts a 64-character change id (boundary: existing regex has no length cap)', () => {
    const id = 'a'.repeat(64);
    const result = validateChangeId(id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.changeId).toBe(id);
      expect(result.value.changeId.length).toBe(64);
    } else {
      throw new Error('expected ok result, got err: ' + JSON.stringify(result.error));
    }
  });
});

describe('validateChangeId — invalid cases (13)', () => {
  test('rejects an empty string with code change-id-empty', () => {
    const result = validateChangeId('');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('change-id-empty');
    } else {
      throw new Error('expected err result, got ok: ' + JSON.stringify(result.value));
    }
  });

  test('rejects "." with code change-id-reserved', () => {
    const result = validateChangeId('.');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('change-id-reserved');
    } else {
      throw new Error('expected err result, got ok: ' + JSON.stringify(result.value));
    }
  });

  test('rejects ".." with code change-id-reserved', () => {
    const result = validateChangeId('..');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('change-id-reserved');
    } else {
      throw new Error('expected err result, got ok: ' + JSON.stringify(result.value));
    }
  });

  test('rejects "/" with code change-id-format', () => {
    const result = validateChangeId('/');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('change-id-format');
    } else {
      throw new Error('expected err result, got ok: ' + JSON.stringify(result.value));
    }
  });

  test('rejects "\\" with code change-id-format', () => {
    const result = validateChangeId('\\');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('change-id-format');
    } else {
      throw new Error('expected err result, got ok: ' + JSON.stringify(result.value));
    }
  });

  test('rejects "C:" with code change-id-format (Windows drive prefix)', () => {
    const result = validateChangeId('C:');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('change-id-format');
    } else {
      throw new Error('expected err result, got ok: ' + JSON.stringify(result.value));
    }
  });

  test('rejects "C:\\" with code change-id-format (Windows drive + backslash)', () => {
    const result = validateChangeId('C:\\');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('change-id-format');
    } else {
      throw new Error('expected err result, got ok: ' + JSON.stringify(result.value));
    }
  });

  test('rejects "//foo" with code change-id-format (double-slash prefix)', () => {
    const result = validateChangeId('//foo');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('change-id-format');
    } else {
      throw new Error('expected err result, got ok: ' + JSON.stringify(result.value));
    }
  });

  test('rejects "git@github.com:foo/bar" with code change-id-format (scp-like URL)', () => {
    const result = validateChangeId('git@github.com:foo/bar');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('change-id-format');
    } else {
      throw new Error('expected err result, got ok: ' + JSON.stringify(result.value));
    }
  });

  test('rejects "https://x" with code change-id-format (URL scheme)', () => {
    const result = validateChangeId('https://x');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('change-id-format');
    } else {
      throw new Error('expected err result, got ok: ' + JSON.stringify(result.value));
    }
  });

  test('rejects "foo:bar" with code change-id-format (bare colon)', () => {
    const result = validateChangeId('foo:bar');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('change-id-format');
    } else {
      throw new Error('expected err result, got ok: ' + JSON.stringify(result.value));
    }
  });

  test('rejects leading dot ".foo" with code change-id-format', () => {
    const result = validateChangeId('.foo');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('change-id-format');
    } else {
      throw new Error('expected err result, got ok: ' + JSON.stringify(result.value));
    }
  });

  test('rejects trailing dot "foo." with code change-id-format', () => {
    const result = validateChangeId('foo.');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('change-id-format');
    } else {
      throw new Error('expected err result, got ok: ' + JSON.stringify(result.value));
    }
  });
});

describe('validateChangeId — contract (task 4, byte-for-byte preservation)', () => {
  test('format-error message exactly matches the pre-refactor openspec-validate-service string', () => {
    // The pre-refactor error string is emitted from src/services/openspec/openspec-validate-service.ts:55:
    //   `changeId ${changeId} does not match [A-Za-z0-9][A-Za-z0-9._-]*`
    // After sub-slice 1's REFACTOR (task 3), the new validateChangeId is the single source of truth,
    // and the error message MUST stay byte-for-byte identical so existing snapshot/contract
    // consumers in the OpenSpecValidationIssue pipeline do not break.
    const probe = validateChangeId('has space');
    expect(probe.ok).toBe(false);
    if (probe.ok) {
      throw new Error('expected err result, got ok: ' + JSON.stringify(probe.value));
    }
    const error: ChangeIdError = probe.error;
    expect(error.code).toBe('change-id-format');
    expect(error.message).toBe('changeId has space does not match [A-Za-z0-9][A-Za-z0-9._-]*');
  });
  test('isOk narrows successful and failed validation results', () => {
    expect(isOk(validateChangeId('add-foo'))).toBe(true);
    expect(isOk(validateChangeId('has space'))).toBe(false);
  });
});

/**
 * Shared fixture for sub-slice 2 path-planning tests.
 *
 * `workspaceRoot` is a synthetic absolute path that does NOT need to exist on disk —
 * planArtifactPath only does path math (posix.normalize + resolve + relative),
 * it never stats the filesystem. This keeps the unit tests fast and hermetic.
 *
 * `workspaceRoot` is pinned to `process.cwd()` so the absolute-path-under-workspace case
 * (a) and the relative-path case (b) can be exercised without Windows-vs-Unix branching
 * at the test level. Tests that need an "outside" path compute it as a sibling of cwd.
 */
const SUB_SLICE_2_WORKSPACE = resolve(process.cwd(), '.peaks');

describe('planArtifactPath (task 5/6, 9 cases)', () => {
  const CHANGE_ID = 'enforce-artifact-boundary-and-coverage';
  const ROLE = 'rd';
  const REQUEST_ID = '2026-07-24-rid-009';

  test('(a) absolute path under workspace is accepted and absolutePath is returned', () => {
    const absoluteCandidate = join(SUB_SLICE_2_WORKSPACE, 'changes', CHANGE_ID, ROLE, `${REQUEST_ID}.md`);
    const result = planArtifactPath({
      changeId: CHANGE_ID,
      workspaceRoot: SUB_SLICE_2_WORKSPACE,
      role: ROLE,
      requestId: REQUEST_ID,
      // pass an explicit absolute path (still under the workspace)
      absolutePath: absoluteCandidate
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.absolutePath).toBe(absoluteCandidate);
      expect(isAbsolute(result.value.absolutePath)).toBe(true);
      expect(result.value.relativePath).toBe(join('changes', CHANGE_ID, ROLE, `${REQUEST_ID}.md`));
      expect(result.value.jsonSafeRelativePath).toBe(
        ['changes', CHANGE_ID, ROLE, `${REQUEST_ID}.md`].join('/')
      );
    } else {
      throw new Error('expected ok result, got err: ' + JSON.stringify(result.error));
    }
  });

  test('(b) relative path under workspace is resolved against workspaceRoot', () => {
    const result = planArtifactPath({
      changeId: CHANGE_ID,
      workspaceRoot: SUB_SLICE_2_WORKSPACE,
      role: ROLE,
      requestId: REQUEST_ID,
      relativePath: join('changes', CHANGE_ID, ROLE, `${REQUEST_ID}.md`)
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.absolutePath).toBe(
        join(SUB_SLICE_2_WORKSPACE, 'changes', CHANGE_ID, ROLE, `${REQUEST_ID}.md`)
      );
      expect(result.value.relativePath).toBe(join('changes', CHANGE_ID, ROLE, `${REQUEST_ID}.md`));
      expect(result.value.jsonSafeRelativePath).toBe(
        ['changes', CHANGE_ID, ROLE, `${REQUEST_ID}.md`].join('/')
      );
    } else {
      throw new Error('expected ok result, got err: ' + JSON.stringify(result.error));
    }
  });

  test('(c) Windows backslash path under workspace is accepted and JSON output uses forward slashes', () => {
    // Even on POSIX runners, backslashes inside the candidate must be normalized to forward
    // slashes for the JSON-safe representation. Absolute form still has to live under the
    // workspace — so we feed a relative path with backslashes, which posix-normalizes cleanly.
    const backslashCandidate = 'changes\\enforce-artifact-boundary-and-coverage\\rd\\2026-07-24-rid-009.md';
    const result = planArtifactPath({
      changeId: CHANGE_ID,
      workspaceRoot: SUB_SLICE_2_WORKSPACE,
      role: ROLE,
      requestId: REQUEST_ID,
      relativePath: backslashCandidate
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.jsonSafeRelativePath).not.toContain('\\');
      expect(result.value.jsonSafeRelativePath).toBe(
        ['changes', CHANGE_ID, ROLE, `${REQUEST_ID}.md`].join('/')
      );
    } else {
      throw new Error('expected ok result, got err: ' + JSON.stringify(result.error));
    }
  });

  test('(d) Unix "/" relative path under workspace is accepted', () => {
    const result = planArtifactPath({
      changeId: CHANGE_ID,
      workspaceRoot: SUB_SLICE_2_WORKSPACE,
      role: ROLE,
      requestId: REQUEST_ID,
      relativePath: 'changes/enforce-artifact-boundary-and-coverage/rd/2026-07-24-rid-009.md'
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.absolutePath).toBe(
        join(SUB_SLICE_2_WORKSPACE, 'changes', CHANGE_ID, ROLE, `${REQUEST_ID}.md`)
      );
      expect(result.value.jsonSafeRelativePath).toBe(
        ['changes', CHANGE_ID, ROLE, `${REQUEST_ID}.md`].join('/')
      );
    } else {
      throw new Error('expected ok result, got err: ' + JSON.stringify(result.error));
    }
  });

  test('(e) path-with-".."-segment that climbs out of the workspace returns BoundaryError.path-outside-artifact-root', () => {
    // The ".." must NOT be allowed to climb out of the workspace into the target repo,
    // even when the rest of the path lives "inside" the .peaks/changes/<id>/ namespace.
    const traversalCandidate = join('changes', CHANGE_ID, ROLE, '..', '..', '..', '..', 'target-repo', 'pollution.md');
    const result = planArtifactPath({
      changeId: CHANGE_ID,
      workspaceRoot: SUB_SLICE_2_WORKSPACE,
      role: ROLE,
      requestId: REQUEST_ID,
      relativePath: traversalCandidate
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const error: BoundaryError = result.error;
      expect(error.code).toBe('path-outside-artifact-root');
      // error shape from rid-009 plan §1.3: { code, path, root, message }
      if (error.code !== 'path-outside-artifact-root') {
        throw new Error('expected path-outside-artifact-root branch');
      }
      expect(typeof error.path).toBe('string');
      expect(error.root).toBe(SUB_SLICE_2_WORKSPACE);
      expect(typeof error.message).toBe('string');
      expect(error.message.length).toBeGreaterThan(0);
    } else {
      throw new Error('expected err result, got ok: ' + JSON.stringify(result.value));
    }
  });

  test('(f) absolute path that lives outside the workspace returns BoundaryError.path-outside-artifact-root', () => {
    // Pick an absolute path that is GUARANTEED not to be under SUB_SLICE_2_WORKSPACE:
    // the filesystem root (or its Windows equivalent) is a parent of everything.
    const outsideAbsolute = resolve(tmpdir(), 'definitely-not-under-peaks-workspace');
    expect(isAbsolute(outsideAbsolute)).toBe(true);
    const result = planArtifactPath({
      changeId: CHANGE_ID,
      workspaceRoot: SUB_SLICE_2_WORKSPACE,
      role: ROLE,
      requestId: REQUEST_ID,
      absolutePath: outsideAbsolute
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const error: BoundaryError = result.error;
      expect(error.code).toBe('path-outside-artifact-root');
      if (error.code !== 'path-outside-artifact-root') {
        throw new Error('expected path-outside-artifact-root branch');
      }
      expect(error.path).toBe(outsideAbsolute);
      expect(error.root).toBe(SUB_SLICE_2_WORKSPACE);
    } else {
      throw new Error('expected err result, got ok: ' + JSON.stringify(result.value));
    }
  });

  test('(g) empty segment "foo//bar" normalizes to "foo/bar" in the relative output', () => {
    const result = planArtifactPath({
      changeId: CHANGE_ID,
      workspaceRoot: SUB_SLICE_2_WORKSPACE,
      role: ROLE,
      requestId: REQUEST_ID,
      relativePath: 'foo//bar.md'
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.relativePath).toBe(join('foo', 'bar.md'));
      expect(result.value.jsonSafeRelativePath).toBe('foo/bar.md');
    } else {
      throw new Error('expected ok result, got err: ' + JSON.stringify(result.error));
    }
  });

  test('(h) default template "<changeId>/<role>/<requestId>" is interpolated and stays under workspace', () => {
    // No relativePath / absolutePath / template override supplied — the helper must
    // apply its default template of "<changeId>/<role>/<requestId>" and produce a
    // path that lands inside the workspace.
    const result = planArtifactPath({
      changeId: CHANGE_ID,
      workspaceRoot: SUB_SLICE_2_WORKSPACE,
      role: ROLE,
      requestId: REQUEST_ID
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.relativePath).toBe(join(CHANGE_ID, ROLE, REQUEST_ID));
      expect(result.value.jsonSafeRelativePath).toBe(`${CHANGE_ID}/${ROLE}/${REQUEST_ID}`);
      expect(result.value.absolutePath).toBe(join(SUB_SLICE_2_WORKSPACE, CHANGE_ID, ROLE, REQUEST_ID));
    } else {
      throw new Error('expected ok result, got err: ' + JSON.stringify(result.error));
    }
  });

  test('custom template substitutes every placeholder occurrence', () => {
    const result = planArtifactPath({
      changeId: CHANGE_ID,
      workspaceRoot: SUB_SLICE_2_WORKSPACE,
      role: ROLE,
      requestId: REQUEST_ID,
      template: 'custom/<role>/<changeId>/<requestId>/<role>'
    });

    expect(result).toEqual({
      ok: true,
      value: {
        absolutePath: join(SUB_SLICE_2_WORKSPACE, 'custom', ROLE, CHANGE_ID, REQUEST_ID, ROLE),
        relativePath: join('custom', ROLE, CHANGE_ID, REQUEST_ID, ROLE),
        jsonSafeRelativePath: `custom/${ROLE}/${CHANGE_ID}/${REQUEST_ID}/${ROLE}`
      }
    });
  });

  /**
   * Additional cases for B1 coverage gap closure.
   *
   * Original c8 report (92.64% statements / 72.72% branches):
   *   5 statements + 3 branches uncovered in artifact-boundary.ts.
   * Targets below hit each candidate uncovered path empirically; if a case
   * already overlaps with an existing test, the assertion still runs and
   * adds redundancy without breaking the suite.
   */

  test('(i) absolute path inside workspace via POSIX leading slash exercises nodeIsAbsolute branch', () => {
    // Forces the L178-180 `nodeIsAbsolute(normalized) ? resolve(normalized) : ...`
    // branch: posix.normalize preserves the leading `/`, so the ternary picks
    // `resolve(normalized)` — NOT `resolve(workspaceRoot, normalized)`.
    // The path resolves to a sibling of `/`, then re-enters via posix re-rooting.
    const absoluteCandidate = join(SUB_SLICE_2_WORKSPACE, 'changes', CHANGE_ID, ROLE, `${REQUEST_ID}.md`);
    const result = planArtifactPath({
      changeId: CHANGE_ID,
      workspaceRoot: SUB_SLICE_2_WORKSPACE,
      role: ROLE,
      requestId: REQUEST_ID,
      // Pass an absolute path on POSIX form (already-resolved under workspaceRoot)
      absolutePath: absoluteCandidate
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.absolutePath).toBe(absoluteCandidate);
      expect(result.value.relativePath).toBe(join('changes', CHANGE_ID, ROLE, `${REQUEST_ID}.md`));
    }
  });

  test('(j) relative path with `..` that stays inside workspace returns ok', () => {
    // The existing (e) test goes OUTSIDE workspace via `..`. This one uses
    // a `..` that climbs then descends back into workspace — exercising the
    // `posix.normalize` branch where the normalized path is shorter but
    // still under workspaceRoot.
    const result = planArtifactPath({
      changeId: CHANGE_ID,
      workspaceRoot: SUB_SLICE_2_WORKSPACE,
      role: ROLE,
      requestId: REQUEST_ID,
      relativePath: 'changes/sub/../changes-back.md'
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.relativePath).toBe(join('changes', 'changes-back.md'));
    }
  });

  test('(k) template with only some placeholders exercises interpolateTemplate partial-match branches', () => {
    // Forces interpolateTemplate to return a string where 2 of 3
    // .replaceAll calls found a match and 1 did not — exercises both branches
    // of the implicit regex-match path inside .replaceAll (covered/no-op).
    const result = planArtifactPath({
      changeId: CHANGE_ID,
      workspaceRoot: SUB_SLICE_2_WORKSPACE,
      role: ROLE,
      requestId: REQUEST_ID,
      template: 'fixed/<role>/x'
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.jsonSafeRelativePath).toBe(`fixed/${ROLE}/x`);
    }
  });

  test('(l) buildWorkspaceUnavailable is exercised separately for each mode (not via shared loop)', () => {
    // The existing test loops over both modes in one body — c8 may collapse
    // the branch back to single-coverage. Calling them in separate test
    // bodies forces both branches to be evaluated independently.
    const blocked = buildWorkspaceUnavailable({ mode: 'blocked' });
    expect(blocked.mode).toBe('blocked');

    const preview = buildWorkspaceUnavailable({ mode: 'preview-only' });
    expect(preview.mode).toBe('preview-only');
  });

  test('(m) planArtifactPath with absolutePath AND template supplied picks absolutePath branch', () => {
    // Forces the first ternary (L161-164) to take the absolutePath branch
    // when both absolutePath and template are supplied — template is ignored.
    const absoluteCandidate = join(SUB_SLICE_2_WORKSPACE, 'changes', CHANGE_ID, ROLE, `${REQUEST_ID}.md`);
    const result = planArtifactPath({
      changeId: CHANGE_ID,
      workspaceRoot: SUB_SLICE_2_WORKSPACE,
      role: ROLE,
      requestId: REQUEST_ID,
      absolutePath: absoluteCandidate,
      template: 'unused/<changeId>/<role>/<requestId>'
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.absolutePath).toBe(absoluteCandidate);
      // template MUST be ignored — jsonSafeRelativePath uses absolutePath
      expect(result.value.jsonSafeRelativePath).toBe(
        ['changes', CHANGE_ID, ROLE, `${REQUEST_ID}.md`].join('/')
      );
    }
  });
});

/**
 * isPathInsideArtifactRoot re-export wiring (task 7/8).
 *
 * The primitive lives at `src/shared/path-safety.ts`. The artifact-boundary module
 * must re-export it unchanged so callers can use one import path. These tests
 * exercise the RE-EXPORT, not the primitive's internal logic — that coverage
 * already lives in the existing `src/shared/path-safety.ts` consumers.
 */
describe('isPathInsideArtifactRoot re-export (task 7/8, 4 cases)', () => {
  const ROOT = '/tmp/artifact-boundary-reexport-root';

  test('path === root returns true', () => {
    expect(isPathInsideArtifactRoot(ROOT, ROOT)).toBe(true);
  });

  test('path under root returns true', () => {
    expect(isPathInsideArtifactRoot(`${ROOT}/changes/add-foo/rd/req.md`, ROOT)).toBe(true);
  });

  test('path equal-to-root-without-trailing-slash returns true (normalization parity)', () => {
    expect(isPathInsideArtifactRoot(ROOT, `${ROOT}/`)).toBe(true);
  });

  test('path inside a SIBLING of root (no shared prefix) returns false', () => {
    expect(isPathInsideArtifactRoot(`/etc/passwd`, ROOT)).toBe(false);
  });
});

/**
 * ANTI-REGRESSION — task 9.
 *
 * Mounts a real tempdir as the "target repository". planArtifactPath must NEVER
 * produce a path that lands inside this tempdir, even if its caller points the
 * function at an unrelated cwd-derived workspaceRoot. This proves the AC1 invariant
 * from `openspec/changes/enforce-artifact-boundary-and-coverage/specs/artifact-workspace/spec.md §Scenario: Target repository not configured as artifact workspace`.
 *
 * The test runs planArtifactPath in several plausible footgun shapes and verifies
 * the tempdir stayed untouched (still absent of any pollution file inside it).
 */
describe('planArtifactPath anti-regression — tempdir target repo (task 9)', () => {
  test('never produces a path under a fake target-repo tempdir, and the tempdir stays empty', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'peaks-target-repo-'));
    const fakeRepoDir = join(tempRoot, 'repo');
    // Pre-create the fake repo dir (empty) so we can prove "nothing was ever written into it"
    // by reading its directory listing.
    const { mkdirSync } = require('node:fs');
    mkdirSync(fakeRepoDir, { recursive: true });
    const pollutionMarker = join(fakeRepoDir, '.peaks-changes-pollution.txt');

    // Run planArtifactPath many times with candidate inputs that *might* try to
    // sneak a path into the fake repo if containment failed.
    //
    // workspaceRoot is anchored at an unrelated root (a sibling of cwd) so the
    // fake-repo tempdir is OUTSIDE it on every platform. Each call below is
    // either:
    //   (i)  absolutePath that points inside the fake repo → must error out, OR
    //   (ii) relativePath that, when joined, climbs out and lands outside the
    //        unrelated workspaceRoot → must error out, OR
    //   (iii) the default template → must succeed, with the resulting absolute
    //         path staying inside the unrelated workspaceRoot (NOT inside the
    //         fake repo).
    const otherWorkspace = resolve(process.cwd(), '..', 'sub-slice-2-unrelated-workspace');
    const tried: string[] = [];
    const inputs: Array<{ absolutePath?: string; relativePath?: string }> = [
      { absolutePath: pollutionMarker },
      { absolutePath: join(fakeRepoDir, 'src', 'index.ts') },
      { relativePath: '../../../../etc/passwd' },
      { relativePath: '../target-repo-source' }
    ];
    for (const input of inputs) {
      // The workspaceRoot is the unrelated dir; the absolutePath / relativePath
      // is intentionally OUTSIDE that workspace — so each call must return an err.
      const r1 = planArtifactPath({
        changeId: 'enforce-artifact-boundary-and-coverage',
        workspaceRoot: otherWorkspace,
        role: 'rd',
        requestId: '2026-07-24-rid-009',
        ...input
      });
      // Footgun inputs MUST error — by definition they are outside workspaceRoot.
      expect(r1.ok).toBe(false);
      if (r1.ok) {
        tried.push(r1.value.absolutePath);
      }
    }

    // Also exercise the default-template path to make sure it stays in the workspace.
    const r2 = planArtifactPath({
      changeId: 'enforce-artifact-boundary-and-coverage',
      workspaceRoot: otherWorkspace,
      role: 'rd',
      requestId: '2026-07-24-rid-009'
    });
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      tried.push(r2.value.absolutePath);
    }

    // None of the absolute paths may land inside fakeRepoDir.
    for (const candidate of tried) {
      expect(isPathInsideArtifactRoot(candidate, fakeRepoDir)).toBe(false);
    }

    // The fake repo dir must be empty (nothing created on disk).
    try {
      const { readdirSync } = require('node:fs');
      expect(readdirSync(fakeRepoDir)).toEqual([]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

/**
 * Workspace-unavailable response contract — task 10.
 *
 * Dimension: render. These cases lock the returned structure and static,
 * human-readable next actions; no external boundary is involved.
 */
describe('buildWorkspaceUnavailable response contract (task 10, 5 cases)', () => {
  test('preview-only response contains the artifact-workspace configuration action', () => {
    const response = buildWorkspaceUnavailable({ mode: 'preview-only' });

    expect(response).toMatchObject({
      ok: false,
      mode: 'preview-only',
      nextActions: expect.arrayContaining([
        expect.stringContaining('Configure artifact workspace')
      ])
    });
  });

  test('blocked response preserves the blocked mode', () => {
    const response = buildWorkspaceUnavailable({ mode: 'blocked' });

    expect(response).toMatchObject({
      ok: false,
      mode: 'blocked'
    });
  });

  test('reason is always the artifact-workspace-unavailable literal', () => {
    for (const mode of ['preview-only', 'blocked'] as const) {
      expect(buildWorkspaceUnavailable({ mode }).reason).toBe('artifact-workspace-unavailable');
    }
  });

  test('nextActions is a non-empty string array for every mode', () => {
    for (const mode of ['preview-only', 'blocked'] as const) {
      const { nextActions } = buildWorkspaceUnavailable({ mode });

      expect(nextActions.length).toBeGreaterThan(0);
      expect(nextActions.every((action) => typeof action === 'string' && action.length > 0)).toBe(true);
    }
  });

  test('nextActions arrays are independent between responses', () => {
    const first = buildWorkspaceUnavailable({ mode: 'preview-only' });
    const second = buildWorkspaceUnavailable({ mode: 'preview-only' });

    first.nextActions.push('A caller-specific follow-up.');

    expect(second.nextActions).toEqual([
      'Configure artifact workspace by describing where Peaks should store artifacts.'
    ]);
  });
});

/**
 * OpenSpec workspace-unavailable scenarios — task 12.
 *
 * This test-only command boundary mirrors how a future planner will compose
 * path planning with the common unavailable response. It returns a preview
 * without persistence, but blocks commands that require persisted evidence.
 */
describe('artifact workspace unavailable scenarios (task 12, 2 cases)', () => {
  type FuturePlannerInput = {
    artifactWorkspace?: string;
    persistenceRequired: boolean;
  };

  function runFuturePlanner(input: FuturePlannerInput) {
    const preview = {
      changeId: 'enforce-artifact-boundary-and-coverage',
      role: 'rd',
      requestId: '2026-07-24-rid-009'
    };

    if (input.artifactWorkspace === undefined) {
      const unavailable = buildWorkspaceUnavailable({
        mode: input.persistenceRequired ? 'blocked' : 'preview-only'
      });

      return input.persistenceRequired
        ? unavailable
        : { ...unavailable, preview };
    }

    return planArtifactPath({
      ...preview,
      workspaceRoot: input.artifactWorkspace,
      relativePath: `changes/${preview.changeId}/${preview.role}/${preview.requestId}.md`
    });
  }

  test('Preview-only dry-run can proceed without a configured artifact workspace', () => {
    const result = runFuturePlanner({ persistenceRequired: false });

    expect(result).toMatchObject({
      ok: false,
      mode: 'preview-only',
      reason: 'artifact-workspace-unavailable',
      preview: {
        changeId: 'enforce-artifact-boundary-and-coverage',
        role: 'rd',
        requestId: '2026-07-24-rid-009'
      },
      nextActions: expect.arrayContaining([
        expect.stringContaining('Configure artifact workspace')
      ])
    });
    expect('absolutePath' in result).toBe(false);
  });

  test('Persistent output requires an artifact workspace and returns blocked', () => {
    const result = runFuturePlanner({ persistenceRequired: true });

    expect(result).toEqual({
      ok: false,
      mode: 'blocked',
      reason: 'artifact-workspace-unavailable',
      nextActions: [
        'Configure artifact workspace by describing where Peaks should store artifacts.'
      ]
    });
    expect('absolutePath' in result).toBe(false);
  });
});
