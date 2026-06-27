#!/usr/bin/env node
// v2.13.3 AC-2 — cross-platform prepublish dispatch.
//
// `package.json` -> `"prepublishOnly": "node scripts/prepublish-build.mjs"`
// delegates here. This script:
//   1. Reads the canonical version from package.json (single source
//      of truth — avoids the pre-2.13.4 hard-coded string drift).
//   2. Runs `pnpm run build` (which is sync-version + clean-dist + tsc).
//   3. Surfaces non-zero exits so npm aborts the publish.
//
// Karpathy §2 (Simplicity First): a single spawn, no retry logic.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
const version = packageJson.version ?? 'unknown';
if (typeof version !== 'string' || version.length === 0) {
  throw new Error('package.json version must be a non-empty string');
}

const isWindows = process.platform === 'win32';
const cmd = isWindows ? 'pnpm.cmd' : 'pnpm';
const args = ['run', 'build'];

console.log(`[prepublish-build] peaks-cli v${version} — running`, cmd, args.join(' '));
// On Windows, Node 22's spawnSync with .cmd shims requires explicit
// `shell: true` (otherwise EINVAL). On POSIX, this is a no-op. We pass
// it on both platforms — the safety net is cheap and idempotent.
const result = spawnSync(cmd, args, {
  stdio: 'inherit',
  shell: isWindows,
  cwd: new URL('..', import.meta.url).pathname
});
if (result.error) {
  console.error('[prepublish-build] spawn failed:', result.error.message);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(`[prepublish-build] build failed with exit code ${result.status}`);
  process.exit(result.status ?? 1);
}
console.log('[prepublish-build] build OK — proceeding to publish');