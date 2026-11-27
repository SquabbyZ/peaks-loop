// src/services/release/version-precheck-layer-bumped.ts
//
// Layer F — packageVersionBumped. Every manifest `release-pack.mjs` publishes
// must carry a version strictly greater than the same manifest at the previous
// release tag; a root-only bump re-publishes the subpackages unchanged.

import { spawnSync } from 'node:child_process';
import {
  listPublishablePackages,
  readRootVersion,
  SEMVER_RE,
  type LayerResult,
  type PrecheckOptions,
  type PublishablePackage
} from './version-precheck-support.js';

const TAG_RE = /^v(\d+\.\d+\.\d+)$/;

export type BumpedStatus = 'bumped' | 'not-bumped' | 'new' | 'unknown';

export type BumpedObserved = {
  readonly name: string;
  readonly manifest: string;
  readonly previousVersion: string;
  readonly version: string;
  readonly status: BumpedStatus;
};

type GitRun = { readonly ok: boolean; readonly stdout: string; readonly stderr: string };

function git(cwd: string, args: readonly string[]): GitRun {
  const res = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true
  });
  if (res.error !== undefined && res.error !== null) {
    return { ok: false, stdout: '', stderr: res.error.message };
  }
  return {
    ok: res.status === 0,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? ''
  };
}

const CORE_PARTS = 3;

function withoutBuild(version: string): string {
  return version.split('+')[0] ?? '';
}

function coreNumbers(version: string): number[] {
  return (withoutBuild(version).split('-')[0] ?? '')
    .split('.')
    .map((part) => Number.parseInt(part, 10));
}

function prerelease(version: string): string {
  const text = withoutBuild(version);
  const dash = text.indexOf('-');
  return dash === -1 ? '' : text.slice(dash + 1);
}

/** Semver ordering on the numeric core; a prerelease sorts before its release. */
export function compareSemver(a: string, b: string): number {
  const left = coreNumbers(a);
  const right = coreNumbers(b);
  for (let index = 0; index < CORE_PARTS; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  const leftPre = prerelease(a);
  const rightPre = prerelease(b);
  if (leftPre === rightPre) {
    return 0;
  }
  if (leftPre === '') {
    return 1;
  }
  if (rightPre === '') {
    return -1;
  }
  return leftPre < rightPre ? -1 : 1;
}

type PreviousTagRead = {
  readonly ok: boolean;
  readonly stderr: string;
  readonly tag: string;
  readonly tagsVisible: number;
};

function previousReleaseTag(projectRoot: string, currentVersion: string): PreviousTagRead {
  const listed = git(projectRoot, ['tag', '--list']);
  if (!listed.ok) {
    return { ok: false, stderr: listed.stderr, tag: '', tagsVisible: 0 };
  }
  const tags = listed.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const candidates = tags
    .map((line) => TAG_RE.exec(line))
    .map((match) => (match === null ? '' : (match[1] ?? '')))
    .filter((version) => version !== '' && compareSemver(version, currentVersion) < 0)
    .sort((a, b) => compareSemver(b, a));
  return {
    ok: true,
    stderr: '',
    tag: candidates[0] === undefined ? '' : `v${candidates[0]}`,
    tagsVisible: tags.length
  };
}

type AtTag =
  | { readonly kind: 'present'; readonly version: string }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable' };

function inspectAtTag(projectRoot: string, tag: string, manifest: string): AtTag {
  const listed = git(projectRoot, ['ls-tree', tag, '--', manifest]);
  if (!listed.ok) {
    return { kind: 'unreadable' };
  }
  if (listed.stdout.trim() === '') {
    return { kind: 'absent' };
  }
  const shown = git(projectRoot, ['show', `${tag}:${manifest}`]);
  if (!shown.ok) {
    return { kind: 'unreadable' };
  }
  try {
    const parsed = JSON.parse(shown.stdout) as { version?: unknown };
    if (typeof parsed.version !== 'string' || !SEMVER_RE.test(parsed.version)) {
      return { kind: 'unreadable' };
    }
    return { kind: 'present', version: parsed.version };
  } catch {
    return { kind: 'unreadable' };
  }
}

function compareAtTag(projectRoot: string, tag: string, pkg: PublishablePackage): BumpedObserved {
  const atTag = inspectAtTag(projectRoot, tag, pkg.manifest);
  const base = { name: pkg.name, manifest: pkg.manifest, version: pkg.version };
  if (atTag.kind === 'absent') {
    return { ...base, previousVersion: '', status: 'new' };
  }
  if (atTag.kind === 'unreadable' || !SEMVER_RE.test(pkg.version)) {
    return {
      ...base,
      previousVersion: atTag.kind === 'present' ? atTag.version : '',
      status: 'unknown'
    };
  }
  return {
    ...base,
    previousVersion: atTag.version,
    status: compareSemver(pkg.version, atTag.version) > 0 ? 'bumped' : 'not-bumped'
  };
}

function summarize(rows: readonly BumpedObserved[], tag: string): LayerResult {
  const observed = { previousTag: tag, packages: rows };
  const stale = rows.filter((row) => row.status === 'not-bumped');
  if (stale.length > 0) {
    return {
      status: 'blocker',
      message:
        `not bumped since ${tag}: ` +
        stale
          .map((row) => `${row.name} ${row.previousVersion} -> ${row.version} (not bumped)`)
          .join(', '),
      remediation:
        `bump each named manifest above its ${tag} version (and every dependent's ` +
        'pin) before tagging; bumping the root package.json alone re-publishes the subpackages ' +
        'at an already-published version',
      observed
    };
  }
  const unknown = rows.filter((row) => row.status === 'unknown');
  if (unknown.length > 0) {
    return {
      status: 'warning',
      message:
        `could not compare ${unknown.map((row) => row.name).join(', ')} against ${tag} ` +
        '(the manifest could not be read at that tag, or its version is not clean semver) — ' +
        'NOT treated as safe to publish',
      remediation: 'set every published manifest version to a clean semver, then re-run precheck',
      observed
    };
  }
  const fresh = rows.filter((row) => row.status === 'new');
  return {
    status: 'ok',
    message:
      `${rows.length - fresh.length} package(s) bumped above ${tag}` +
      (fresh.length === 0 ? '' : `; ${fresh.map((row) => row.name).join(', ')} did not exist yet`),
    remediation: '',
    observed
  };
}

export function runPackageVersionBumped(opts: PrecheckOptions): LayerResult {
  const rootRead = readRootVersion(opts.projectRoot);
  if (!rootRead.ok) {
    return { status: 'blocker', message: rootRead.message, remediation: rootRead.remediation };
  }
  const listed = listPublishablePackages(opts.projectRoot);
  if (!listed.ok) {
    return { status: 'blocker', message: listed.message, remediation: listed.remediation };
  }
  const previous = previousReleaseTag(opts.projectRoot, rootRead.version);
  if (!previous.ok) {
    return {
      status: 'warning',
      message:
        `git tag --list failed (${previous.stderr.trim()}); version-bump layer skipped — ` +
        'NOT treated as safe to publish',
      remediation:
        'ensure `git` is on PATH and the project is a git checkout with its release tags fetched',
      observed: { previousTag: '', tagsVisible: previous.tagsVisible, packages: [] }
    };
  }
  if (previous.tag === '') {
    return {
      status: 'warning',
      message:
        `no release tag below v${rootRead.version} is visible (${previous.tagsVisible} tag(s) ` +
        'visible in this checkout), so no published package can be proven bumped above its ' +
        'previous release — NOT treated as safe to publish',
      remediation:
        'fetch the release tags (`git fetch --tags --unshallow`, or check out with ' +
        'fetch-depth: 0) and re-run; `--strict` (the CI mode) turns an unprovable ' +
        'version-bump check into a blocker',
      observed: { previousTag: '', tagsVisible: previous.tagsVisible, packages: [] }
    };
  }
  return summarize(
    listed.packages.map((pkg) => compareAtTag(opts.projectRoot, previous.tag, pkg)),
    previous.tag
  );
}
