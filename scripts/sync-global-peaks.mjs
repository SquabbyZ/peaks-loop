#!/usr/bin/env node
// scripts/sync-global-peaks.mjs
//
// Fix-7 (2026-07-26): automate the PATH shadow sync. After pnpm build
// the working tree has a fresh dist/ + bin/, but the user-level
// /c/nvm4w/nodejs/node_modules/peaks-loop/ stays at the previously
// copied version (or an even older npm-global install). The CLI
// shadow caused L1.A/L1.G (peaks --version reports a different
// number from the working tree).
//
// This script copies the build artefacts from the local working tree
// into the global peaks-loop directory so `peaks` (PATH) resolves
// to the same version as `node ./bin/peaks.js` (local source).
//
// Usage:
//   node scripts/sync-global-peaks.mjs                  # sync to default global path
//   node scripts/sync-global-peaks.mjs --target <dir>    # sync to a custom directory
//
// After this, `peaks --version` should report the same as
// `node ./bin/peaks.js --version`.
//
// The script is idempotent and safe to run repeatedly. It does NOT
// touch npmjs.com registry — this is purely a local dev shortcut.

import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

// Default global peaks-loop directory — the npm-global install on this
// Windows host. Override via --target <dir> for other environments.
const args = process.argv.slice(2);
let targetArg = null;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--target' && i + 1 < args.length) {
    targetArg = args[i + 1];
    i += 1;
  } else if (args[i] === '--help' || args[i] === '-h') {
    process.stdout.write(
      'Usage: node scripts/sync-global-peaks.mjs [--target <global-peaks-dir>]\n' +
        '\n' +
        'Default target on Windows: C:/nvm4w/nodejs/node_modules/peaks-loop\n' +
        'Default target on POSIX:   /usr/local/lib/node_modules/peaks-loop\n'
    );
    process.exit(0);
  }
}

const isWin = platform() === 'win32';
const defaultTarget = isWin
  ? 'C:/nvm4w/nodejs/node_modules/peaks-loop'
  : '/usr/local/lib/node_modules/peaks-loop';
const target = targetArg !== null ? resolve(targetArg) : defaultTarget;

if (!existsSync(target)) {
  process.stderr.write(`Target directory does not exist: ${target}\n`);
  process.stderr.write(`Pass --target <dir> to specify an alternative location.\n`);
  process.exit(1);
}

// Verify the target looks like an existing peaks-loop install. If
// package.json is missing, refuse to copy rather than overwrite an
// unrelated directory.
const targetPkgPath = resolve(target, 'package.json');
if (!existsSync(targetPkgPath)) {
  process.stderr.write(
    `Target ${target} does not contain package.json — refusing to overwrite.\n` +
      `Pass --target <dir> if this is intentional.\n`
  );
  process.exit(1);
}

const targetPkg = JSON.parse(readFileSync(targetPkgPath, 'utf8'));
if (targetPkg.name !== 'peaks-loop') {
  process.stderr.write(
    `Target ${target} contains package.json#name='${targetPkg.name}', not 'peaks-loop'.\n` +
      `Refusing to overwrite.\n`
  );
  process.exit(1);
}

const sourceVersion = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8')).version;
const targetVersion = targetPkg.version;
process.stdout.write(
  `[sync-global-peaks] ${targetVersion} -> ${sourceVersion}\n` +
    `  from ${projectRoot}\n` +
    `  to   ${target}\n`
);

const copyTargets = [
  { src: 'package.json', dst: 'package.json' },
  { src: 'bin', dst: 'bin' },
  { src: 'dist', dst: 'dist' },
  { src: 'scripts', dst: 'scripts' },
  { src: 'agents', dst: 'agents' },
  { src: 'skills', dst: 'skills' },
  { src: 'output-styles', dst: 'output-styles' },
  { src: 'schemas', dst: 'schemas' },
  { src: 'examples', dst: 'examples' },
  { src: '.claude-plugin', dst: '.claude-plugin' }
];

for (const { src, dst } of copyTargets) {
  const srcPath = resolve(projectRoot, src);
  const dstPath = resolve(target, dst);
  if (!existsSync(srcPath)) continue;
  rmSync(dstPath, { recursive: true, force: true });
  cpSync(srcPath, dstPath, { recursive: true, force: true });
}

// Workspace subpackages. The local pnpm install puts them in
// node_modules/peaks-loop-<name>/; the global install has them at
// <target>/node_modules/peaks-loop-<name>/. We copy the directories
// we can find locally.
const localSubpackages = [
  'peaks-loop-shared',
  'peaks-loop-shared-channel',
  'peaks-loop-mut',
];
for (const pkg of localSubpackages) {
  const srcPath = resolve(projectRoot, 'node_modules', pkg);
  const dstPath = resolve(target, 'node_modules', pkg);
  if (!existsSync(srcPath)) continue;
  rmSync(dstPath, { recursive: true, force: true });
  cpSync(srcPath, dstPath, { recursive: true, force: true });
}

process.stdout.write(`[sync-global-peaks] done — peaks --version now reports ${sourceVersion}\n`);