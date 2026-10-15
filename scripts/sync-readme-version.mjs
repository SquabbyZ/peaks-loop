#!/usr/bin/env node
/**
 * sync-readme-version.mjs — keep the README / README-en version claims in
 * lockstep with package.json#version after a release.
 *
 * The publish workflow calls this after a version bump. Two surfaces per
 * file carry the current version:
 *
 *   1. the "最新版本" / "Latest" row, and
 *   2. the "当前状态 · X" / "Status · shipping X" status heading.
 *
 * The script reads the new version from package.json and rewrites the
 * version label — and only the version label — inside the row:
 *
 *   | **最新版本** | [![npm](…)](https://www.npmjs.com/package/peaks-loop) — 4.0.32(2026-09-08) |
 *   | **Latest**   | [![npm](…)](https://www.npmjs.com/package/peaks-loop) — 4.0.17 (2026-08-07) |
 *
 * The two files disagree on the spacing before the date; the pattern
 * accepts either shape and the replacement preserves whichever spacing
 * each file already uses.
 *
 * The heading rewrite replaces the version token in the status heading
 * (`## 当前状态 · 4.0.32` / `## Status · shipping 4.0.17`). It anchors on
 * `^## ` plus the literal heading word, so it cannot reach the `### `
 * evolution heading or any table row.
 *
 * Either surface that does not match is a FAILURE (exit 1), not a no-op.
 * The previous revision hardcoded `4\.0\.0` and described a backtick-link
 * shape the READMEs no longer use, so it reported "no-op (pattern not
 * found)" and exited 0 while the rows rotted two releases behind. If the
 * README layout changes again, publish must stop rather than ship a stale
 * version claim.
 *
 * The date is taken from the release's own CHANGELOG.md heading
 * (`## 4.0.37 — 2026-09-10`). With no such heading the row's existing
 * date is kept and a warning is printed — the script never invents one.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TARGETS = ['README.md', 'README-en.md'];

const newVersion = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version;

// Row anchor: the "最新版本" / "Latest" cell's badge, the em-dash, then the
// bare version. Groups are (1) everything up to and including the `— `,
// (2) the version — a general semver, never a literal — and (3) the optional
// `(YYYY-MM-DD)` decoration captured whole, so its leading spacing survives.
const ROW =
  /(\| \*\*(?:最新版本|Latest)\*\*[^|]*\|[^|]*— )(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)([ \t]*\(\d{4}-\d{2}-\d{2}\))?/g;

// Heading anchor: a `## ` line whose heading word is the status heading, then
// the version. `^## ` cannot match `### `, so the evolution sub-heading is out
// of reach, and a table row never starts with a heading at all. `[^\n]*?` is
// non-greedy, so the first semver-shaped token on the line is the one replaced.
const HEADING = /(^## (?:当前状态|Status)[^\n]*?)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/gm;

/** Release date for `version`, read from `## <version> — <date>` in CHANGELOG.md. */
function releaseDate(version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    const changelog = readFileSync(resolve('CHANGELOG.md'), 'utf8');
    return changelog.match(new RegExp(`^## ${escaped} — (\\d{4}-\\d{2}-\\d{2})`, 'm'))?.[1] ?? null;
  } catch {
    return null;
  }
}

const newDate = releaseDate(newVersion);
if (newDate === null) {
  console.error(
    `[sync-readme-version] warn: no '## ${newVersion} — <date>' heading in CHANGELOG.md; ` +
      "keeping each README row's existing date."
  );
}

function rewriteRow(_match, prefix, _version, deco) {
  const tail =
    deco === undefined || newDate === null
      ? (deco ?? '')
      : deco.replace(/\d{4}-\d{2}-\d{2}/, newDate);
  return `${prefix}${newVersion}${tail}`;
}

function rewriteHeading(_match, prefix) {
  return `${prefix}${newVersion}`;
}

let totalChanged = 0;
const missingRow = [];
const missingHeading = [];

for (const f of TARGETS) {
  const path = resolve(f);
  const before = readFileSync(path, 'utf8');

  const rows = (before.match(ROW) ?? []).length;
  if (rows === 0) {
    // The layout changed under us. Leave the file alone entirely rather than
    // half-edit a document whose expected shape is gone.
    missingRow.push(f);
    continue;
  }

  const headings = (before.match(HEADING) ?? []).length;
  if (headings === 0) missingHeading.push(f);

  const after = before.replace(ROW, rewriteRow).replace(HEADING, rewriteHeading);
  const matched = rows + headings;
  if (after === before) {
    console.log(
      `[sync-readme-version] ${f} already in sync (${matched} occurrence(s) matched) -> ${newVersion}`
    );
    continue;
  }
  writeFileSync(path, after, 'utf8');
  totalChanged += matched;
  console.log(
    `[sync-readme-version] updated ${f} (${matched} occurrence(s)) -> ${newVersion}`
  );
}

if (missingRow.length > 0) {
  console.error(
    `[sync-readme-version] ERROR: version row not found in ${missingRow.join(', ')}. ` +
      'Expected README.md "| **最新版本** | … — <version>(<date>) |" or ' +
      'README-en.md "| **Latest** | … — <version> (<date>) |". ' +
      'The README layout changed and this script can no longer sync it — ' +
      'fix the pattern or the row. Refusing to exit 0 with a stale version row.'
  );
  process.exit(1);
}

if (missingHeading.length > 0) {
  console.error(
    `[sync-readme-version] ERROR: status heading not found in ${missingHeading.join(', ')}. ` +
      'Expected README.md "## 当前状态 · <version>" or ' +
      'README-en.md "## Status · shipping <version>". ' +
      'The README layout changed and this script can no longer sync it — ' +
      'fix the pattern or the heading. Refusing to exit 0 with a stale version claim.'
  );
  process.exit(1);
}

console.log(`[sync-readme-version] total ${totalChanged} occurrence(s) updated to ${newVersion}`);
