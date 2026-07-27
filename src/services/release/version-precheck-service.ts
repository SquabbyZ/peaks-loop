/**
 * rid-010 — peaks release precheck (Phase 4 slice 1).
 *
 * Module path: src/services/release/version-precheck-service.ts
 * Mirror of publish.yml gate-cli-version step §(A). The §(B) tarball-content gate
 * (Layer 5 of the 5-layer root cause) stays CI-only — AC-7 grep test pins
 * publish.yml so §(B) cannot drift silently.
 *
 * 4-layer version precheck mirroring publish.yml gate-cli-version step. Designed
 * to run BEFORE `peaks release canary` so developers catch CLI_VERSION lag /
 * tag collision / changeset staged / workspace drift without waiting for CI.
 *
 * Mirrors the §(A) on-disk gate from publish.yml. The §(B) tarball-content gate
 * (Layer 5 of the 5-layer root cause) stays CI-only — AC-7 grep test pins
 * publish.yml so §(B) cannot drift silently.
 *
 * Design contract:
 *   - Pure functions. NO `process.exitCode` mutation here (cli-helpers owns it).
 *   - All I/O parameterized via `projectRoot`.
 *   - Layer A and B are blockers by default; C and D are warnings (--strict
 *     upgrades them to blockers; hotfix path uses default warning).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LayerStatus = 'ok' | 'warning' | 'blocker';

export interface LayerResult {
  readonly status: LayerStatus;
  readonly message: string;
  readonly remediation: string;
  readonly observed?: Readonly<Record<string, unknown>>;
}

export interface PrecheckOptions {
  readonly projectRoot: string;
  readonly strict?: boolean;
}

export interface PrecheckEnvelope {
  readonly ok: boolean;
  readonly overall: LayerStatus;
  readonly rootVersion: string;
  readonly strict: boolean;
  readonly snapshotAt: string;
  readonly layers: {
    readonly rootVsShared: LayerResult;
    readonly tagCollision: LayerResult;
    readonly changesetStaged: LayerResult;
    readonly workspaceLockstep: LayerResult;
  };
}

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function upgrade(result: LayerResult, strict: boolean | undefined): LayerResult {
  if (strict === true && result.status === 'warning') {
    return {
      ...result,
      status: 'blocker',
      remediation: `${result.remediation} (strict mode: warning promoted to blocker)`
    };
  }
  return result;
}

function readRootVersion(projectRoot: string): string {
  const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
    version?: string;
  };
  if (typeof pkg.version !== 'string' || !SEMVER_RE.test(pkg.version)) {
    throw new Error(`invalid root package.json#version: ${JSON.stringify(pkg.version)}`);
  }
  return pkg.version;
}

function rollup(layers: PrecheckEnvelope['layers'], strict: boolean): {
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
  const rootVersion = readRootVersion(opts.projectRoot);
  const sharedDist = join(
    opts.projectRoot,
    'packages',
    'peaks-loop-shared',
    'dist',
    'version.js'
  );
  let sharedVersion: string | null = null;
  let distExists = false;
  try {
    const raw = readFileSync(sharedDist, 'utf8');
    const match = raw.match(/CLI_VERSION\s*=\s*"([^"]+)"/);
    if (match && match[1] !== undefined) {
      sharedVersion = match[1];
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
        'inspect packages/peaks-loop-shared/dist/version.js; ensure CLI_VERSION = "<semver>" is exported',
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
  const rootVersion = readRootVersion(opts.projectRoot);
  const tagName = `v${rootVersion}`;
  // Windows shell wrapping convention: 5 prior occurrences in tests/unit/release/.
  const res = spawnSync('git', ['-C', opts.projectRoot, 'tag', '--list', tagName], {
    shell: process.platform === 'win32',
    encoding: 'utf8',
    timeout: 5_000
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
      remediation: 'inspect git configuration; precheck will defer to publish.yml gate for tag collision',
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
// Layer C — changesetStaged (mirrors publish.yml gate-changeset step)
// ---------------------------------------------------------------------------

export function runChangesetStaged(opts: PrecheckOptions): LayerResult {
  const changesetDir = join(opts.projectRoot, '.changeset');
  let files: string[] = [];
  try {
    files = readdirSync(changesetDir);
  } catch {
    return {
      status: 'ok',
      message: '.changeset/ directory is absent — no changeset is staged',
      remediation: '',
      observed: { stagedFiles: [] }
    };
  }
  const staged = files.filter((f) => f.endsWith('.md') && f !== 'README.md');
  if (staged.length === 0) {
    return {
      status: 'ok',
      message: '.changeset/ has no staged *.md files',
      remediation: '',
      observed: { stagedFiles: [] }
    };
  }
  return {
    status: 'warning',
    message: `.changeset/ has ${staged.length} staged change(s): ${staged.join(', ')}`,
    remediation:
      'publish.yml gate-changeset will BLOCK publish with these staged files. ' +
      'Either: (a) run `peaks changeset publish` to drain the staged changesets, ' +
      '(b) move them out of .changeset/, or (c) re-run with --strict to enforce blocker exit here.',
    observed: { stagedFiles: staged }
  };
}

// ---------------------------------------------------------------------------
// Layer D — workspaceLockstep (CLI-only; not in publish.yml today)
// ---------------------------------------------------------------------------

export function runWorkspaceLockstep(opts: PrecheckOptions): LayerResult {
  const rootPkgRaw = readFileSync(join(opts.projectRoot, 'package.json'), 'utf8');
  const rootPkg = JSON.parse(rootPkgRaw) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const allDeps: Record<string, string> = {
    ...(rootPkg.dependencies ?? {}),
    ...(rootPkg.devDependencies ?? {})
  };
  const sharedDep = allDeps['peaks-loop-shared'];
  if (sharedDep === undefined) {
    return {
      status: 'blocker',
      message: 'peaks-loop-shared is not declared in root dependencies',
      remediation:
        'add `"peaks-loop-shared": "workspace:*"` to root package.json#dependencies',
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
  const sharedPkgRaw = readFileSync(
    join(opts.projectRoot, 'packages', 'peaks-loop-shared', 'package.json'),
    'utf8'
  );
  const sharedPkg = JSON.parse(sharedPkgRaw) as { version?: string };
  const sharedVersion = sharedPkg.version ?? '';
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
  const rootVersion = readRootVersion(opts.projectRoot);
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