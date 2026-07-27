/**
 * Check: dist CLI_VERSION matches source `package.json#version`
 * (`build:dist-version-matches-source`).
 *
 * Build-hygiene check that surfaces the silent-stale-CLI failure
 * mode where the user runs `npx peaks` / `node bin/peaks.js` after
 * `pnpm install` but before `pnpm build`. A missing dist/ is treated
 * as informational (fresh clone, not broken) so the check does not
 * flip the summary to red on a clean checkout.
 *
 * IMPORTANT: the on-disk path is `dist/shared/version.js` (NOT
 * `dist/src/shared/version.js`) because `tsconfig.build.json#rootDir
 * = "src"` trims the `src/` segment from emitted output.
 *
 * The pure compare helper is exported as `compareDistVersion` so
 * tests can drive the filesystem reads without monkey-patching
 * `process.cwd()`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getErrorMessage } from 'peaks-loop-shared/result';

import type { DistVersionComparison, DoctorCheck, DoctorCheckPlugin, DoctorContext } from '../types.js';

/**
 * Pure helper that compares the published dist `CLI_VERSION` against
 * the source-of-truth `package.json#version`. Default readers fail-
 * soft to `null` on missing/unreadable/malformed input. Exported so
 * tests can drive the filesystem reads without monkey-patching
 * `process.cwd()`.
 */
export function compareDistVersion(opts: {
  projectRoot: string;
  distVersionReader?: (root: string) => string | null;
  sourceVersionReader?: (root: string) => string | null;
}): DistVersionComparison {
  const distReader = opts.distVersionReader ?? defaultDistVersionReader;
  const sourceReader = opts.sourceVersionReader ?? defaultSourceVersionReader;
  const dist = safeRead(() => distReader(opts.projectRoot));
  const source = safeRead(() => sourceReader(opts.projectRoot)) ?? 'unknown';
  const distReadable = dist !== null;
  return {
    dist,
    source,
    match: distReadable && dist === source,
    distReadable
  };
}

function safeRead(reader: () => string | null): string | null {
  try {
    return reader();
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}

function defaultDistVersionReader(projectRoot: string): string | null {
  const distPath = join(projectRoot, 'dist', 'shared', 'version.js');
  if (!existsSync(distPath)) {
    return null;
  }
  const body = readFileSync(distPath, 'utf8');
  const match = /export\s+const\s+CLI_VERSION\s*=\s*["']([^"']+)["']/.exec(body);
  return match?.[1] ?? null;
}

function defaultSourceVersionReader(projectRoot: string): string | null {
  const pkgPath = join(projectRoot, 'package.json');
  if (!existsSync(pkgPath)) {
    return null;
  }
  const body = readFileSync(pkgPath, 'utf8');
  const parsed = JSON.parse(body) as { version?: unknown };
  return typeof parsed.version === 'string' ? parsed.version : null;
}

function defaultDistVersionProbe(projectRootResolver: () => string | null): DistVersionComparison {
  const projectRoot = projectRootResolver();
  if (projectRoot === null) {
    return { dist: null, source: 'unknown', match: false, distReadable: false };
  }
  return compareDistVersion({ projectRoot });
}

function run({ options, projectRootResolver }: DoctorContext): readonly DoctorCheck[] {
  const probe = options.distVersionProbe ?? (() => defaultDistVersionProbe(projectRootResolver));
  try {
    const result = probe();
    if (!result.distReadable) {
      return [{
        id: 'build:dist-version-matches-source',
        ok: true,
        message: `dist/ is not present; run \`pnpm build\` to populate dist/shared/version.js (source version ${result.source})`
      }];
    }
    if (result.match) {
      return [{
        id: 'build:dist-version-matches-source',
        ok: true,
        message: `dist/shared/version.js ships CLI_VERSION ${result.dist} matching source ${result.source}`
      }];
    }
    return [{
      id: 'build:dist-version-matches-source',
      ok: false,
      message: `dist/shared/version.js ships CLI_VERSION ${result.dist} but source ${result.source} is in src/shared/version.ts; run \`pnpm build\` to refresh dist/`
    }];
  } catch (error) {
    return [{
      id: 'build:dist-version-matches-source',
      ok: false,
      message: `dist version check failed: ${getErrorMessage(error)}`
    }];
  }
}

export const check: DoctorCheckPlugin = {
  name: 'dist-source-version',
  run
};