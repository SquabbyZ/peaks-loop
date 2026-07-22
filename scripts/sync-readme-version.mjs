#!/usr/bin/env node
/**
 * sync-readme-version.mjs — keep the README / README-en "Latest" /
 * "最新版本" row in lockstep with package.json#version after a release.
 *
 * The publish workflow calls this after auto-bump-version. The script
 * reads the new version from package.json and rewrites the version
 * label in the README's release-page link (which is the same
 * https://github.com/SquabbyZ/peaks-loop/releases URL — GitHub
 * renders the latest tag by default).
 *
 * The pattern replaced is the inline backtick-quoted version label
 * inside the first table cell of the "## Current status" /
 * "## 当前状态" section in both READMEs. The sed pattern tolerates
 * any 4.x.y prerelease suffix.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const newVersion = JSON.parse(
  readFileSync(resolve('package.json'), 'utf8'),
).version;

const PATTERN = /\[`4\.0\.0(?:-beta\.\d+)?`\]\(https:\/\/github\.com\/SquabbyZ\/peaks-loop\/releases\)/g;
const REPLACEMENT = `[\`${newVersion}\`](https://github.com/SquabbyZ/peaks-loop/releases)`;

let totalChanged = 0;
for (const f of ['README.md', 'README-en.md']) {
  const path = resolve(f);
  const before = readFileSync(path, 'utf8');
  const after = before.replace(PATTERN, REPLACEMENT);
  if (after !== before) {
    writeFileSync(path, after, 'utf8');
    const changed = (before.match(PATTERN) ?? []).length;
    totalChanged += changed;
    console.log(`[sync-readme-version] updated ${f} (${changed} occurrence(s)) -> ${newVersion}`);
  } else {
    console.log(`[sync-readme-version] no-op on ${f} (pattern not found)`);
  }
}

console.log(`[sync-readme-version] total ${totalChanged} occurrence(s) updated to ${newVersion}`);
