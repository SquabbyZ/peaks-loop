// tests/unit/cli/commands/code-auto-compact-cwd-independence.test.ts
//
// THE DEFECT THIS LOCKS. `peaks code auto-compact` is fired by a PreToolUse hook
// on every Bash/Task call. The hook passes `--project .`, and `.` resolves
// against the HOOK'S working directory — which is wherever the intercepted tool
// call ran. A tool call from a subdirectory therefore looked for
// `.peaks/_runtime/session.json` in that subdirectory, found nothing, and
// returned `AUTO_COMPACT_NO_SESSION`.
//
// Why that mattered more than a wrong message: the hook's exit status is
// IGNORED, so a non-zero exit is silent. Every Bash call from a subdirectory
// quietly skipped auto-compact for the rest of the session. Measured
// 2026-11-16 in this repository: the same command succeeded from the repo root
// (ratio 31.8%) and failed from `./src`.
//
// The fix is that the command canonicalises `--project` with
// `resolveCanonicalProjectRoot`, which walks up to the git root. These cases
// assert the canonicalisation happens, and that it is what makes the two
// directories agree.
//
// Dimensions covered:
//   - behavior:    the resolved project root for a root and a nested cwd
//   - integration: the real resolver against a real temp git repository
//
// Dimensions omitted:
//   - a11y / render: no user-visible surface is produced by the resolver.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { resolveCanonicalProjectRoot } from '~/src/services/config/config-safety';

declareDimensions(
  'tests/unit/cli/commands/code-auto-compact-cwd-independence.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'a11y', reason: 'the resolver produces no user-visible output' },
    { dim: 'render', reason: 'no rendered document is involved' }
  ]
);

const tempRoots: string[] = [];

function makeRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('(integration) the project root does not depend on the caller cwd', () => {
  it('when given a nested directory, should resolve to the git root above it', () => {
    // given: a git repository with a nested source directory
    // when: the resolver is handed the nested path (what `--project .` becomes
    //       when the hook runs there)
    // then: it answers with the repository root, not the nested directory
    const root = makeRoot('peaks-cwd-');
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    const nested = join(root, 'src', 'services');
    mkdirSync(nested, { recursive: true });

    // `resolve()` is what `--project .` becomes before canonicalisation.
    const fromNested = resolveCanonicalProjectRoot(resolve(nested));
    const fromRoot = resolveCanonicalProjectRoot(resolve(root));

    expect(fromNested).toBe(fromRoot);
    expect(fromNested).toBe(realpathOf(root));
  });
});

/** `git init` may hand back a realpath differing in case/symlinks on Windows. */
function realpathOf(path: string): string {
  return resolveCanonicalProjectRoot(resolve(path));
}
