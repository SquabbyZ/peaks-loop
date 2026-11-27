// src/services/release/version-precheck-support.ts
//
// Wave-5 class-A hoist (rid 2026-10-01-wave5-w5-3-compact-release): the type
// layer and the manifest readers moved VERBATIM out of
// `version-precheck-service.ts` (:28-132 at the split) for the 300-raw-line
// cap. The parent re-exports the four public types so
// './version-precheck-service.js' keeps resolving them
// (release-commands.ts, tests/unit/release/...).

import { existsSync, readFileSync, readdirSync, type Dirent } from 'node:fs';
import { join } from 'node:path';

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
  /** Registry base URL for `registryPublished`; defaults to `https://registry.npmjs.org`. */
  readonly registryUrl?: string;
  /**
   * The tag under release already exists remotely (a tag-triggered publish), so
   * `tagCollision` seeing `v<rootVersion>` is expected rather than a collision.
   */
  readonly tagAlreadyPushed?: boolean;
}

export interface PrecheckEnvelope {
  readonly ok: boolean;
  readonly overall: LayerStatus;
  /** `null` when the root `package.json` is missing or unreadable — see `rootVsShared`. */
  readonly rootVersion: string | null;
  readonly strict: boolean;
  readonly snapshotAt: string;
  readonly layers: {
    readonly rootVsShared: LayerResult;
    readonly tagCollision: LayerResult;
    readonly changesetStaged: LayerResult;
    readonly workspaceLockstep: LayerResult;
    readonly registryPublished: LayerResult;
    readonly packageVersionBumped: LayerResult;
  };
}

export const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function upgrade(result: LayerResult, strict: boolean | undefined): LayerResult {
  if (strict === true && result.status === 'warning') {
    return {
      ...result,
      status: 'blocker',
      remediation: `${result.remediation} (strict mode: warning promoted to blocker)`
    };
  }
  return result;
}

/**
 * Outcome of reading a `package.json`. Never throws: an unreadable root manifest
 * is an ordinary precheck blocker, not an unhandled CLI error. Before this, a
 * project without `package.json` made `peaks release canary` crash with
 * `{ command: "cli", code: "UNHANDLED_ERROR" }` instead of a `PRECHECK_BLOCKER`
 * naming the missing file.
 */
export type PackageJsonRead<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string; readonly remediation: string };

/** Read + parse a JSON manifest, mapping both failure modes onto a blocker description. */
export function readPackageJson<T>(path: string, label: string): PackageJsonRead<T> {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return {
      ok: false,
      message: `${label} is missing or unreadable at ${path}`,
      remediation: `run \`peaks release precheck\` from a project root that has a readable ${label}`
    };
  }
  try {
    return { ok: true, value: JSON.parse(raw) as T };
  } catch {
    return {
      ok: false,
      message: `${label} at ${path} is not valid JSON`,
      remediation: `fix the ${label} syntax; \`peaks release precheck\` cannot gate a version it cannot parse`
    };
  }
}

export type RootVersionRead =
  | { readonly ok: true; readonly version: string }
  | { readonly ok: false; readonly message: string; readonly remediation: string };

/**
 * One package `release-pack.mjs` publishes. `manifest` is the repo-relative
 * POSIX path (`package.json` for the root), so the same string addresses both
 * the working tree and `git show <tag>:<manifest>`.
 */
export type PublishablePackage = {
  readonly name: string;
  readonly version: string;
  readonly manifest: string;
};

export type PublishablePackagesRead =
  | { readonly ok: true; readonly packages: readonly PublishablePackage[] }
  | { readonly ok: false; readonly message: string; readonly remediation: string };

type ManifestSpec = { readonly name?: unknown; readonly version?: unknown };

function toPublishable(manifest: string, spec: ManifestSpec): PublishablePackage | undefined {
  if (typeof spec.name !== 'string' || spec.name.length === 0) {
    return undefined;
  }
  return {
    name: spec.name,
    version: typeof spec.version === 'string' ? spec.version : '',
    manifest
  };
}

function candidateManifests(projectRoot: string): readonly string[] {
  let entries: Dirent[] = [];
  try {
    entries = readdirSync(join(projectRoot, 'packages'), { withFileTypes: true });
  } catch {
    entries = [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => `packages/${entry.name}/package.json`)
    .filter((manifest) => existsSync(join(projectRoot, manifest)));
}

/** Enumerate root + `packages/<dir>/package.json` the way the release packer discovers them. */
export function listPublishablePackages(projectRoot: string): PublishablePackagesRead {
  const rootRead = readPackageJson<ManifestSpec>(
    join(projectRoot, 'package.json'),
    'root package.json'
  );
  if (!rootRead.ok) {
    return rootRead;
  }
  const packages: PublishablePackage[] = [];
  const rootPackage = toPublishable('package.json', rootRead.value);
  if (rootPackage !== undefined) {
    packages.push(rootPackage);
  }
  for (const manifest of candidateManifests(projectRoot)) {
    const read = readPackageJson<ManifestSpec>(join(projectRoot, manifest), manifest);
    if (!read.ok) {
      return read;
    }
    const pkg = toPublishable(manifest, read.value);
    if (pkg !== undefined) {
      packages.push(pkg);
    }
  }
  return { ok: true, packages };
}

export function readRootVersion(projectRoot: string): RootVersionRead {
  const path = join(projectRoot, 'package.json');
  const read = readPackageJson<{ version?: string }>(path, 'root package.json');
  if (!read.ok) {
    return read;
  }
  const pkg = read.value;
  if (typeof pkg.version !== 'string' || !SEMVER_RE.test(pkg.version)) {
    return {
      ok: false,
      message: `invalid root package.json#version: ${JSON.stringify(pkg.version)}`,
      remediation:
        'set root package.json#version to a clean semver (e.g. 4.0.0) before running `peaks release precheck`'
    };
  }
  return { ok: true, version: pkg.version };
}
