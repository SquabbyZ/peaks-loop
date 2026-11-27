// src/services/release/version-precheck-layer-registry.ts
//
// Layer E — registryPublished. The release packer publishes every manifest
// `listPublishablePackages` returns, so a version already on npm fails the
// publish with "cannot publish over the previously published versions".

import { spawnSync } from 'node:child_process';
import {
  listPublishablePackages,
  SEMVER_RE,
  type LayerResult,
  type PrecheckOptions,
  type PublishablePackage
} from './version-precheck-support.js';

export const DEFAULT_REGISTRY_URL = 'https://registry.npmjs.org';

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const PROBE_TIMEOUT_MS = 8_000;
const PROBE_SPAWN_TIMEOUT_MS = 20_000;

/** Runs in a child so the layer stays synchronous like its siblings. */
const PROBE_SCRIPT = [
  'const urls = JSON.parse(process.argv[1]);',
  'const codes = await Promise.all(urls.map(async (url) => {',
  '  try {',
  '    const res = await fetch(url, { signal: AbortSignal.timeout(' + PROBE_TIMEOUT_MS + ') });',
  '    return res.status;',
  '  } catch (err) {',
  '    return -1;',
  '  }',
  '}));',
  'process.stdout.write(JSON.stringify(codes));'
].join('\n');

export type RegistryStatus = 'published' | 'absent' | 'unknown';

export type RegistryObserved = {
  readonly name: string;
  readonly version: string;
  readonly manifest: string;
  readonly status: RegistryStatus;
};

function probeStatuses(urls: readonly string[]): RegistryStatus[] {
  const unknown = urls.map((): RegistryStatus => 'unknown');
  if (urls.length === 0) {
    return unknown;
  }
  const res = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', PROBE_SCRIPT, JSON.stringify(urls)],
    { encoding: 'utf8', timeout: PROBE_SPAWN_TIMEOUT_MS, windowsHide: true }
  );
  if (res.error !== undefined && res.error !== null) {
    return unknown;
  }
  if (res.status !== 0) {
    return unknown;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    return unknown;
  }
  if (!Array.isArray(parsed) || parsed.length !== urls.length) {
    return unknown;
  }
  return parsed.map((code: unknown): RegistryStatus => {
    if (code === HTTP_OK) {
      return 'published';
    }
    return code === HTTP_NOT_FOUND ? 'absent' : 'unknown';
  });
}

function describe(row: RegistryObserved): string {
  return `${row.name}@${row.version} (manifest: ${row.manifest})`;
}

function buildRows(
  packages: readonly PublishablePackage[],
  registryUrl: string
): RegistryObserved[] {
  const checkable = packages.filter((pkg) => SEMVER_RE.test(pkg.version));
  const statuses = probeStatuses(
    checkable.map(
      (pkg) => `${registryUrl}/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}`
    )
  );
  return packages.map((pkg): RegistryObserved => {
    const index = checkable.findIndex((candidate) => candidate.manifest === pkg.manifest);
    return {
      name: pkg.name,
      version: pkg.version,
      manifest: pkg.manifest,
      status: index === -1 ? 'unknown' : (statuses[index] ?? 'unknown')
    };
  });
}

function summarize(rows: readonly RegistryObserved[], registryUrl: string): LayerResult {
  const observed = { registryUrl, packages: rows };
  const published = rows.filter((row) => row.status === 'published');
  if (published.length > 0) {
    return {
      status: 'blocker',
      message:
        `already published on ${registryUrl}: ${published.map(describe).join(', ')} — ` +
        'the release would be refused with "cannot publish over the previously published versions"',
      remediation:
        'bump the version in each named manifest before tagging (a root-only bump leaves the ' +
        'subpackages on an already-published version); `peaks release hotfix <next-version>` ' +
        'covers the out-of-band path',
      observed
    };
  }
  const unchecked = rows.filter((row) => row.status === 'unknown');
  if (unchecked.length > 0) {
    return {
      status: 'warning',
      message:
        `could not confirm ${unchecked.map(describe).join(', ')} against ${registryUrl} ` +
        '(network failure or a response other than 200/404) — NOT treated as safe to publish',
      remediation:
        're-run `peaks release precheck` when the registry is reachable; `--strict` (the CI ' +
        'mode) turns an unverifiable registry check into a blocker',
      observed
    };
  }
  return {
    status: 'ok',
    message: `${rows.length} package manifest(s) are not yet published on ${registryUrl}`,
    remediation: '',
    observed
  };
}

export function runRegistryPublished(opts: PrecheckOptions): LayerResult {
  const registryUrl = (opts.registryUrl ?? DEFAULT_REGISTRY_URL).replace(/\/+$/, '');
  const listed = listPublishablePackages(opts.projectRoot);
  if (!listed.ok) {
    return {
      status: 'blocker',
      message: listed.message,
      remediation: listed.remediation,
      observed: { registryUrl, packages: [] }
    };
  }
  return summarize(buildRows(listed.packages, registryUrl), registryUrl);
}
