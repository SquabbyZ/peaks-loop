/**
 * The `techStack` snapshot a project scan records, derived from the project's
 * own `package.json` plus its lockfile sentinels.
 *
 * WHY IT IS DERIVED AND NOT WRITTEN AS A LITERAL. The create path used to
 * hard-code `techStack: {}` and a `Language | TypeScript (best-effort — re-confirm
 * via package.json devDeps)` table row, so the FIRST write was already
 * uninformative and a refresh had nothing better to say. Every value here is read
 * from the project, which is what makes a refresh worth running.
 *
 * Split out of `project-scan-field-refresh.ts` to stay under the `src/**`
 * 300-line cap; the refresh path imports `deriveTechStack` from here.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

import { tryParseJson } from '../../shared/json-parse.js';

/** A derived build script longer than this is truncated in the snapshot. */
const BUILD_TOOL_MAX = 100;

/**
 * The `package.json` keys this derivation reads, and nothing more.
 * `looseObject` on purpose: a manifest carries far more than this reader
 * consumes, and validation is not licence to reject the rest of the file.
 */
const packageManifestSchema = z.looseObject({
  packageManager: z.string().optional(),
  engines: z.looseObject({ node: z.string().optional() }).optional(),
  scripts: z.looseObject({ build: z.string().optional() }).optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional()
});

type PackageManifest = z.infer<typeof packageManifestSchema>;

/** Lockfiles in precedence order — the first one present names the manager. */
const LOCKFILE_PACKAGE_MANAGERS: ReadonlyArray<readonly [string, string]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['package-lock.json', 'npm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun']
];

function readManifestText(manifestPath: string): string | undefined {
  let text: string | undefined;
  try {
    text = readFileSync(manifestPath, 'utf8');
  } catch {
    text = undefined;
  }
  return text;
}

function readManifest(projectRoot: string): PackageManifest | null {
  const manifestPath = join(projectRoot, 'package.json');
  if (!existsSync(manifestPath)) return null;
  // A malformed — or unreadable — manifest is a soft signal, not a failure:
  // `scanLibraries` already reports it as a warning, and the snapshot degrades to
  // the fields that need no manifest rather than failing the whole refresh.
  // Measured 2026-11-16: an unreadable `package.json` (e.g. a directory of that
  // name) threw EISDIR out of `peaks project context`, which is an everyday
  // command and must not fail over a scan snapshot nobody asked for.
  const raw = readManifestText(manifestPath);
  if (raw === undefined) return null;
  const parsed = tryParseJson(raw, packageManifestSchema);
  return parsed.ok ? parsed.value : null;
}

function detectLanguage(projectRoot: string, manifest: PackageManifest | null): string {
  const declaresTypeScript =
    manifest?.devDependencies?.['typescript'] !== undefined ||
    manifest?.dependencies?.['typescript'] !== undefined;
  return declaresTypeScript || existsSync(join(projectRoot, 'tsconfig.json'))
    ? 'typescript'
    : 'javascript';
}

function detectPackageManager(projectRoot: string, manifest: PackageManifest | null): string {
  const declared = manifest?.packageManager;
  if (declared !== undefined) return declared;
  for (const [lockfile, packageManager] of LOCKFILE_PACKAGE_MANAGERS) {
    if (existsSync(join(projectRoot, lockfile))) return packageManager;
  }
  return 'unknown';
}

/** `node>=24.0.0 (active v24.12.0)` — the floor from `engines`, plus the
 *  runtime the snapshot was taken on. */
function detectRuntime(manifest: PackageManifest | null): string {
  const active = process.versions.node;
  const floor = manifest?.engines?.node;
  return floor === undefined ? `node v${active}` : `node${floor} (active v${active})`;
}

function detectBuildTool(manifest: PackageManifest | null): string | null {
  const build = manifest?.scripts?.build;
  if (build === undefined) return null;
  return build.length <= BUILD_TOOL_MAX ? build : `${build.slice(0, BUILD_TOOL_MAX)}…`;
}

/**
 * True when the derived value is a TRUNCATED build script — a value that records
 * "there is a build script, and it starts like this", not what the build is.
 *
 * WHY THIS MATTERS. `buildTool` is the one derived key a project owner
 * realistically rewrites: a hand-written `tsc -p tsconfig.build.json` says what
 * the build IS, while the derived value is the raw `scripts.build` cut at 100
 * chars. Measured 2026-11-16 on this repository: a refresh replaced that owner
 * line with
 * `node ./scripts/sync-version.mjs && node ./scripts/clean-dist.mjs && pnpm -r --filter "./packages/*" …`.
 * A truncated value is strictly LESS informative than the line it would replace,
 * so it yields to whatever is on disk.
 */
function isTruncated(buildTool: string): boolean {
  return buildTool.length > BUILD_TOOL_MAX;
}

/** The `techStack` snapshot, derived from `package.json` + lockfile sentinels. */
export function deriveTechStack(projectRoot: string): Record<string, string> {
  const manifest = readManifest(projectRoot);
  const techStack: Record<string, string> = {
    language: detectLanguage(projectRoot, manifest),
    packageManager: detectPackageManager(projectRoot, manifest),
    runtime: detectRuntime(manifest)
  };
  const buildTool = detectBuildTool(manifest);
  if (buildTool !== null) techStack['buildTool'] = buildTool;
  return techStack;
}

/**
 * Every key `deriveTechStack` can ever emit. A key in this set that the current
 * derivation did not produce is STALE — the machine fact it recorded has gone
 * away — and must not be carried over. This is the second half of the merge:
 * without it, a project that deletes its `scripts.build` would have the old
 * `buildTool` rewritten back on every refresh, forever, from a machine value
 * that no longer has a source.
 */
const DERIVED_KEYS: ReadonlySet<string> = new Set([
  'language',
  'packageManager',
  'runtime',
  'buildTool'
]);

/**
 * Merge a freshly derived snapshot into the one already on disk.
 *
 * WHY A REFRESH MERGES. `techStack` is the one managed field whose values a
 * human also edits: a project owner routinely adds a row the derivation knows
 * nothing about (`lintTool`, a pinned-version note), and rewrites `buildTool`
 * into something more useful than the raw script. Rewriting the map wholesale
 * would silently undo that on the next `peaks project context` — the same class
 * of sediment loss the refresh exists to prevent on every other field.
 *
 * The rule, stated so it can be checked against the code:
 *   - a key the derivation produces → the derived value wins, EXCEPT when that
 *     value is a truncated build script and the file already carries a fuller
 *     one (`isTruncated` above: less information must not displace more);
 *   - a key the derivation CAN produce but did not → dropped (it is stale, not
 *     sediment — see DERIVED_KEYS);
 *   - any other key → carried over untouched (the derivation has no opinion).
 */
export function mergeTechStack(
  existing: Readonly<Record<string, string>>,
  derived: Readonly<Record<string, string>>
): Record<string, string> {
  const carried = Object.fromEntries(
    Object.entries(existing).filter(([key]) => !DERIVED_KEYS.has(key))
  );
  const onDiskBuildTool = existing['buildTool'];
  const derivedBuildTool = derived['buildTool'];
  const keepsOwnerBuildTool =
    onDiskBuildTool !== undefined &&
    derivedBuildTool !== undefined &&
    isTruncated(derivedBuildTool) &&
    onDiskBuildTool !== derivedBuildTool;
  if (!keepsOwnerBuildTool) return { ...carried, ...derived };
  return { ...carried, ...derived, buildTool: onDiskBuildTool };
}
