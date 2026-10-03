/**
 * rid-010 — peaks release precheck (Phase 4 slice 1).
 *
 * Module path: src/services/release/version-precheck-service.ts
 * Mirrors publish.yml gate-cli-version §(A) — verified in code 2026-10-03, not
 * just per the old comment: `runRootVsShared` covers §(A)'s shared-dist check;
 * §(A′) (runtime RUNTIME_VERSION) has no layer here, and the §(B)
 * tarball-content gate (Layer 5 of the 5-layer root cause) stays CI-only —
 * AC-7 grep test pins publish.yml so §(B) cannot drift silently.
 *
 * 4-layer version precheck. Designed to run BEFORE `peaks release canary` so
 * developers catch CLI_VERSION lag / tag collision / changeset staged /
 * workspace drift without waiting for CI.
 *
 * Design contract:
 *   - Pure functions. NO `process.exitCode` mutation here (cli-helpers owns it).
 *   - All I/O parameterized via `projectRoot`.
 *   - Layer A and B are blockers by default; C and D are warnings (--strict
 *     upgrades them to blockers; hotfix path uses default warning).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  readPackageJson,
  readRootVersion,
  SEMVER_RE,
  upgrade,
  type LayerResult,
  type LayerStatus,
  type PrecheckEnvelope,
  type PrecheckOptions
} from './version-precheck-support.js';
import { runChangesetStaged } from './version-precheck-layer-changeset.js';

// Re-export shims (wave-5 split): the type layer and manifest readers moved
// verbatim to ./version-precheck-support.js and Layer C to
// ./version-precheck-layer-changeset.js; this path stays the public one
// (release-commands.ts, tests/unit/release/version-precheck-*.test.ts).
export type {
  LayerStatus,
  LayerResult,
  PrecheckOptions,
  PrecheckEnvelope
} from './version-precheck-support.js';
export { runChangesetStaged } from './version-precheck-layer-changeset.js';

function rollup(
  layers: PrecheckEnvelope['layers'],
  strict: boolean
): {
  ok: boolean;
  overall: LayerStatus;
} {
  const statuses = Object.values(layers).map((l) => l.status);
  if (statuses.includes('blocker')) {
    return { ok: false, overall: 'blocker' };
  }
  if (statuses.includes('warning')) {
    return { ok: true, overall: 'warning' };
  }
  return { ok: true, overall: 'ok' };
}

// ---------------------------------------------------------------------------
// Layer A — rootVsShared (mirrors publish.yml §(A) on-disk gate only)
// ---------------------------------------------------------------------------

export function runRootVsShared(opts: PrecheckOptions): LayerResult {
  const rootRead = readRootVersion(opts.projectRoot);
  if (!rootRead.ok) {
    return {
      status: 'blocker',
      message: rootRead.message,
      remediation: rootRead.remediation,
      observed: { rootVersion: null, sharedVersion: null }
    };
  }
  const rootVersion = rootRead.version;
  const sharedDist = join(opts.projectRoot, 'packages', 'peaks-loop-shared', 'dist', 'version.js');
  let sharedVersion: string | null = null;
  let distExists = false;
  try {
    const raw = readFileSync(sharedDist, 'utf8');
    // Quote-tolerant: the old double-quote-only regex blanked on prettier's
    // single-quoted emit (rid 2026-10-03-release-gate-quote-brittle).
    const match = raw.match(/CLI_VERSION\s*=\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`)/);
    const captured = match?.[1] ?? match?.[2] ?? match?.[3];
    if (captured !== undefined) {
      sharedVersion = captured;
    }
    distExists = true;
  } catch {
    distExists = false;
  }
  if (!distExists) {
    return {
      status: 'blocker',
      message: `peaks-loop-shared/dist/version.js is missing at ${sharedDist}`,
      remediation:
        'run `pnpm --filter peaks-loop-shared build` to regenerate dist/version.js; ' +
        'then re-run `peaks release precheck`',
      observed: { rootVersion, sharedVersion: null }
    };
  }
  if (sharedVersion === null) {
    return {
      status: 'blocker',
      message: `peaks-loop-shared/dist/version.js does not contain a parseable CLI_VERSION`,
      remediation:
        'inspect packages/peaks-loop-shared/dist/version.js; ensure CLI_VERSION is exported ' +
        'as a quoted string literal (single or double quotes both parse)',
      observed: { rootVersion, sharedVersion: null }
    };
  }
  if (sharedVersion !== rootVersion) {
    return {
      status: 'blocker',
      message: `peaks-loop root version (${rootVersion}) does not match peaks-loop-shared/dist/version.js CLI_VERSION (${sharedVersion})`,
      remediation:
        'bump packages/peaks-loop-shared/package.json#version to match root package.json#version, ' +
        'commit peaks-loop-shared@' +
        rootVersion +
        ', then re-run `peaks release precheck`',
      observed: { rootVersion, sharedVersion }
    };
  }
  return {
    status: 'ok',
    message: `peaks-loop root version matches peaks-loop-shared/dist/version.js CLI_VERSION`,
    remediation: '',
    observed: { rootVersion, sharedVersion }
  };
}

// ---------------------------------------------------------------------------
// Layer B — tagCollision (CLI-only; not in publish.yml today)
// ---------------------------------------------------------------------------

export function runTagCollision(opts: PrecheckOptions): LayerResult {
  const rootRead = readRootVersion(opts.projectRoot);
  if (!rootRead.ok) {
    // Fail closed: without a version there is no tag name to check, so this
    // layer cannot claim "safe to publish".
    return {
      status: 'blocker',
      message: rootRead.message,
      remediation: rootRead.remediation,
      observed: { tagName: null }
    };
  }
  const rootVersion = rootRead.version;
  const tagName = `v${rootVersion}`;
  // 2026-09-10: no shell. `git` is `git.exe` on Windows, so the wrapper bought
  // nothing — and it actively broke this layer, because `projectRoot` is an
  // ARGUMENT to git and a shell wraps the command line unescaped. On a project
  // whose path contains a space the shell split it, git exited 128
  // ("cannot change to '…'"), and the layer fell through to its
  // "git tag --list exited with code 128; layer skipped" WARNING — so a real
  // tag collision was reported as merely deferred. Reproduced on
  // `…\Temp\peaks space demo` with tag v9.9.9 present: warning (should be
  // blocker). It also emitted DEP0190 on every run, on every layer.
  const res = spawnSync('git', ['-C', opts.projectRoot, 'tag', '--list', tagName], {
    encoding: 'utf8',
    timeout: 5_000,
    windowsHide: true
  });
  if (res.error !== null && res.error !== undefined) {
    return {
      status: 'warning',
      message: `git invocation failed; tag-collision layer skipped (${res.error.message})`,
      remediation:
        'ensure `git` is on PATH (Git Bash ships git at C:\\Program Files\\Git\\bin\\git.exe)',
      observed: { tagName }
    };
  }
  if (res.status !== 0) {
    return {
      status: 'warning',
      message: `git tag --list exited with code ${res.status}; tag-collision layer skipped`,
      remediation:
        'inspect git configuration; precheck will defer to publish.yml gate for tag collision',
      observed: { tagName, stderr: res.stderr }
    };
  }
  const tagOutput = (res.stdout ?? '').trim();
  if (tagOutput.includes(tagName)) {
    return {
      status: 'blocker',
      message: `git tag ${tagName} already exists locally — publishing this version would fail at the registry step`,
      remediation: `delete the existing tag: \`git tag -d ${tagName}\` (or use \`peaks release hotfix <next-version>\` for an out-of-band release)`,
      observed: { tagName }
    };
  }
  return {
    status: 'ok',
    message: `git tag ${tagName} does not exist; safe to publish`,
    remediation: '',
    observed: { tagName }
  };
}

// ---------------------------------------------------------------------------
// Layer D — workspaceLockstep (CLI-only; not in publish.yml today)
// ---------------------------------------------------------------------------

export function runWorkspaceLockstep(opts: PrecheckOptions): LayerResult {
  const rootRead = readPackageJson<{
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>(join(opts.projectRoot, 'package.json'), 'root package.json');
  if (!rootRead.ok) {
    return {
      status: 'blocker',
      message: rootRead.message,
      remediation: rootRead.remediation,
      observed: { sharedDep: null }
    };
  }
  const rootPkg = rootRead.value;
  const allDeps: Record<string, string> = {
    ...(rootPkg.dependencies ?? {}),
    ...(rootPkg.devDependencies ?? {})
  };
  const sharedDep = allDeps['peaks-loop-shared'];
  if (sharedDep === undefined) {
    return {
      status: 'blocker',
      message: 'peaks-loop-shared is not declared in root dependencies',
      remediation: 'add `"peaks-loop-shared": "workspace:*"` to root package.json#dependencies',
      observed: { sharedDep: null }
    };
  }
  if (sharedDep !== 'workspace:*') {
    return {
      status: 'warning',
      message: `peaks-loop-shared is pinned to "${sharedDep}" instead of "workspace:*"`,
      remediation:
        'restore `"peaks-loop-shared": "workspace:*"` in root package.json to ensure ' +
        'the local dev link is preserved; published semver-pin regressions cause the CLI_VERSION drift class.',
      observed: { sharedDep }
    };
  }
  const sharedRead = readPackageJson<{ version?: string }>(
    join(opts.projectRoot, 'packages', 'peaks-loop-shared', 'package.json'),
    'packages/peaks-loop-shared/package.json'
  );
  if (!sharedRead.ok) {
    return {
      status: 'blocker',
      message: sharedRead.message,
      remediation: sharedRead.remediation,
      observed: { sharedDep, sharedVersion: null }
    };
  }
  const sharedVersion = sharedRead.value.version ?? '';
  if (!SEMVER_RE.test(sharedVersion)) {
    return {
      status: 'blocker',
      message: `peaks-loop-shared package.json#version is not a clean semver: "${sharedVersion}"`,
      remediation:
        'set packages/peaks-loop-shared/package.json#version to a clean semver (e.g. 0.0.18)',
      observed: { sharedVersion }
    };
  }
  return {
    status: 'ok',
    message: `peaks-loop-shared is workspace-linked; shared version "${sharedVersion}" is clean semver`,
    remediation: '',
    observed: { sharedDep, sharedVersion }
  };
}

// ---------------------------------------------------------------------------
// runAllLayers — orchestrator
// ---------------------------------------------------------------------------

export function runAllLayers(opts: PrecheckOptions): PrecheckEnvelope {
  const rootRead = readRootVersion(opts.projectRoot);
  const rootVersion = rootRead.ok ? rootRead.version : null;
  const strict = opts.strict === true;
  const layers: PrecheckEnvelope['layers'] = {
    rootVsShared: upgrade(runRootVsShared(opts), strict),
    tagCollision: upgrade(runTagCollision(opts), strict),
    changesetStaged: upgrade(runChangesetStaged(opts), strict),
    workspaceLockstep: upgrade(runWorkspaceLockstep(opts), strict)
  };
  const rolled = rollup(layers, strict);
  return {
    ok: rolled.ok,
    overall: rolled.overall,
    rootVersion,
    strict,
    snapshotAt: new Date().toISOString(),
    layers
  };
}
