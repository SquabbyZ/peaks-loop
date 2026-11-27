// src/services/release/version-precheck-layer-workspace.ts
//
// Layer D — workspaceLockstep. Moved out of the precheck service for the
// 300-raw-line cap, the same split the changeset layer took; the service
// re-exports it so the public name holds.

import { join } from 'node:path';
import {
  readPackageJson,
  SEMVER_RE,
  type LayerResult,
  type PrecheckOptions
} from './version-precheck-support.js';

type RootManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type DepLinkRead =
  | { readonly ok: true; readonly sharedDep: string }
  | { readonly ok: false; readonly result: LayerResult };

function readWorkspaceLink(rootPkg: RootManifest): DepLinkRead {
  const allDeps: Record<string, string> = {
    ...(rootPkg.dependencies ?? {}),
    ...(rootPkg.devDependencies ?? {})
  };
  const sharedDep = allDeps['peaks-loop-shared'];
  if (sharedDep === undefined) {
    return {
      ok: false,
      result: {
        status: 'blocker',
        message: 'peaks-loop-shared is not declared in root dependencies',
        remediation: 'add `"peaks-loop-shared": "workspace:*"` to root package.json#dependencies',
        observed: { sharedDep: null }
      }
    };
  }
  if (sharedDep !== 'workspace:*') {
    return {
      ok: false,
      result: {
        status: 'warning',
        message: `peaks-loop-shared is pinned to "${sharedDep}" instead of "workspace:*"`,
        remediation:
          'restore `"peaks-loop-shared": "workspace:*"` in root package.json to ensure ' +
          'the local dev link is preserved; published semver-pin regressions cause the CLI_VERSION drift class.',
        observed: { sharedDep }
      }
    };
  }
  return { ok: true, sharedDep };
}

export function runWorkspaceLockstep(opts: PrecheckOptions): LayerResult {
  const rootRead = readPackageJson<RootManifest>(
    join(opts.projectRoot, 'package.json'),
    'root package.json'
  );
  if (!rootRead.ok) {
    return {
      status: 'blocker',
      message: rootRead.message,
      remediation: rootRead.remediation,
      observed: { sharedDep: null }
    };
  }
  const link = readWorkspaceLink(rootRead.value);
  if (!link.ok) {
    return link.result;
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
      observed: { sharedDep: link.sharedDep, sharedVersion: null }
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
    observed: { sharedDep: link.sharedDep, sharedVersion }
  };
}
