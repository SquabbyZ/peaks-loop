#!/usr/bin/env node
/**
 * copy-templates.mjs — copy bundled non-JS template assets into dist/
 * after `tsc` runs. Required by slice 2026-07-15-project-scan-bootstrap
 * (PRD G4b / R1 / QA BLOCKER): `tsc` only emits .js / .d.ts, so the
 * audit/business markdown templates at
 * `src/services/workspace/templates/project-scan/*.md` are absent
 * from `dist/`. Downstream `npm install peaks-loop` consumers would
 * therefore only get the dynamically-generated `project-scan.md` and
 * the 4 audit/business templates would silently be missing.
 *
 * Idempotent: safe to run multiple times. Run after `tsc` in `build`.
 */
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {string} srcDir absolute source directory
 * @param {string} destDir absolute destination directory (created if absent)
 * @param {readonly string[]} extensions file extensions to copy (lowercase, with leading dot)
 */
function copyTree(srcDir, destDir, extensions) {
  if (!statSync(srcDir, { throwIfNoEntry: false })) return;
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyTree(srcPath, destPath, extensions);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = entry.name.toLowerCase().slice(entry.name.lastIndexOf('.'));
    if (!extensions.includes(ext)) continue;
    copyFileSync(srcPath, destPath);
  }
}

const targets = [
  {
    src: join(packageRoot, 'src/services/workspace/templates/project-scan'),
    dest: join(packageRoot, 'dist/src/services/workspace/templates/project-scan'),
    extensions: ['.md']
  }
];

let totalCopied = 0;
for (const { src, dest, extensions } of targets) {
  const before = statSync(dest, { throwIfNoEntry: false })
    ? readdirSync(dest).length
    : 0;
  copyTree(src, dest, extensions);
  const after = readdirSync(dest).length;
  const added = after - before;
  totalCopied += added;
  process.stdout.write(
    `copy-templates: ${src.replace(packageRoot + '/', '')} -> ${dest.replace(packageRoot + '/', '')} (+${added} files)\n`
  );
}

process.stdout.write(`copy-templates: done (${totalCopied} files copied)\n`);