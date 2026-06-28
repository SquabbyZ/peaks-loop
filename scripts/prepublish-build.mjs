#!/usr/bin/env node
// v2.14.1 — cross-platform prepublish dispatch.
//
// `package.json` -> `"prepublishOnly": "node scripts/prepublish-build.mjs"`
// delegates here. This script:
//   1. Reads the canonical version from package.json (single source
//      of truth — avoids the pre-2.13.4 hard-coded string drift).
//   2. Runs `pnpm run build` (which is sync-version + clean-dist + tsc).
//   3. Falls back to `prepublish-build.ps1` on Windows when the direct
//      `pnpm` execFile path fails (proven dogfood path for Node 22 +
//      Windows native where `spawnSync` + `shell: true` hits ENOENT).
//   4. Surfaces non-zero exits so npm aborts the publish.
//
// Karpathy §2 (Simplicity First): one execFile + one optional ps1
// fallback. No retry loop.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';

const packageJsonPath = resolve(projectRoot, 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version ?? 'unknown';
if (typeof version !== 'string' || version.length === 0) {
  throw new Error('package.json version must be a non-empty string');
}

console.log(`[prepublish-build] peaks-cli v${version} — running pnpm run build`);

// Primary path: execFile (no shell). This avoids the Node 22 + Windows
// `spawnSync cmd.exe ENOENT` regression that hit v2.13.4 partial fix
// (`shell: isWindows`). PATH-aware lookup via execFile's automatic
// `node_modules/.bin` + PATH walk.
try {
  execFileSync('pnpm', ['run', 'build'], { stdio: 'inherit', cwd: projectRoot });
} catch (primaryErr) {
  if (!isWindows) {
    // POSIX: no fallback. Surface the failure.
    console.error('[prepublish-build] spawn failed:', primaryErr?.message ?? primaryErr);
    process.exit(1);
  }
  // Windows fallback: delegate to the .ps1 variant (proven dogfood —
  // shipped in v2.13.3 as the cross-platform counterpart).
  const ps1 = join(projectRoot, 'scripts', 'prepublish-build.ps1');
  if (!existsSync(ps1)) {
    console.error('[prepublish-build] spawn failed:', primaryErr?.message ?? primaryErr);
    console.error(`[prepublish-build] fallback not found: ${ps1}`);
    process.exit(1);
  }
  console.log('[prepublish-build] falling back to .ps1 variant');
  try {
    execFileSync(
      'powershell',
      ['-ExecutionPolicy', 'Bypass', '-File', ps1],
      { stdio: 'inherit', cwd: projectRoot },
    );
  } catch (fallbackErr) {
    console.error('[prepublish-build] .ps1 fallback failed:', fallbackErr?.message ?? fallbackErr);
    process.exit(1);
  }
}

console.log('[prepublish-build] build OK — proceeding to publish');
