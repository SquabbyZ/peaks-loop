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
 * D-019 (2026-07-16): also copy the SkillHub SQLite migrations
 * (`src/services/skillhub/migrations/*.sql`) into dist/. Without this,
 * the published `peaks-loop` tarball ships an empty
 * `dist/services/skillhub/migrations/` and `openStateDb()` opens a
 * schema-less database, breaking any `peaks skill sediment <verb>`
 * on a fresh consumer install. Vitest tests still pass because they
 * use tsx + the source tree directly, but downstream npm consumers
 * see `no such table: bee_release` on the very first command.
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
    dest: join(packageRoot, 'dist/services/workspace/templates/project-scan'),
    extensions: ['.md']
  },
  {
    // D-019: SkillHub SQLite migrations must reach the published tarball
    // so `openStateDb()` can apply the schema on first run.
    src: join(packageRoot, 'src/services/skillhub/migrations'),
    dest: join(packageRoot, 'dist/services/skillhub/migrations'),
    extensions: ['.sql']
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