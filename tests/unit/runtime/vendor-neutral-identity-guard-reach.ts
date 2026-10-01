// tests/unit/runtime/vendor-neutral-identity-guard-reach.ts
//
// The REACH half of `vendor-neutral-identity-guard.test.ts`, moved VERBATIM into
// this sibling for the C wave 7 file-size split (rid
// 2026-10-01-c-wave7-excess-w7-4). THIS FILE OWNS WHAT THE GUARD WALKS:
// `SCAN_ROOTS` names the roots and the extensions, `listFilesRecursively` is the
// walk, and `scanProject` (in `vendor-neutral-identity-guard-shapes.ts`) parses
// every file the walk returns and runs all four checks over it. Neither the list
// nor the walk filters what it enumerates. Any edit that drops a root, an
// extension, or a name from `EXCLUDED_DIR_NAMES` narrows what the guard proves
// while every assertion in the four test files stays green — the failure mode
// lint-gate §4b row 2 and §4c record, and the reason the reach now lives in
// exactly one file: there is one place to look, and one place to check.
//
// MEASURED, NOT ASSUMED (2026-10-01, the day of the split): this walk returned
// 932 files before it and 944 after — the 12 added are `src/services/final-review/*`
// siblings another leaf created in the same worktree, and ZERO files left the set.
// The hit lists the guard reads back were identical across the split (20 registry
// consumers, 12 identity comparisons, 5 id values, 2 settings paths, 1 verb
// literal), which is the only kind of proof that a moved file did not narrow the
// reach: a count alone cannot tell "the new root was walked" from "some other file
// made up the number", so the comparison was made over the file NAMES. The
// anti-silence case in `vendor-neutral-identity-guard.test.ts` pins both roots by
// name and the debt census pins `scripts/` by comparison count, so a root that
// silently vanished fails a test instead of reporting clean.

import { readdirSync, type Dirent } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import * as ts from 'typescript';

const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');
const SRC_ROOT = join(PROJECT_ROOT, 'src');

/** POSIX-normalised path relative to the project root. */
function relativeToRoot(absolutePath: string): string {
  return absolutePath
    .slice(PROJECT_ROOT.length + 1)
    .split(sep)
    .join('/');
}

/**
 * Directories the walk never enters. `dist/**` is GENERATED and every id in
 * it is a copy of one in `src/`, so scanning it would double-count every hit;
 * `node_modules` is not ours. Dot-directories (`.git`, `.peaks`, …) are
 * skipped by name prefix.
 */
const EXCLUDED_DIR_NAMES: ReadonlySet<string> = new Set(['node_modules', 'dist', 'coverage']);

/**
 * Every file under `dir` whose name ends with one of `extensions`, recursively.
 * `fs`, not a shell — `execSync('find …')` on this project's Windows CI runs
 * `find.exe`, a different program.
 *
 * One file at a time, each independent of the others: the walk returns the
 * complete list before anything is parsed, so a single unparseable file can
 * never decide whether the remaining files are seen.
 */
function listFilesRecursively(
  dir: string,
  extensions: readonly string[],
  out: string[] = []
): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // A root that does not exist contributes nothing rather than aborting the
    // walk — the anti-silence test pins what was actually reached, so a
    // missing root fails there instead of passing quietly here.
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(entry.name) || entry.name.startsWith('.')) continue;
      listFilesRecursively(full, extensions, out);
    } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * The roots the scan walks, and the extensions each admits.
 *
 * `scripts/**` is here because it SHIPS — `package.json#files` lists
 * `scripts/install-skills.mjs` — and it held two live `ideId === 'claude-code'`
 * decisions that a `src/**`-only walk could not see even in principle (the
 * limit this replaces, formerly limit 4). Those two are pinned as debt below,
 * not fixed: making them adapter-driven would also enable the env-var
 * override for the six other platforms whose profile declares one, i.e. a
 * behaviour change to a published script's documented contract. Visibility
 * plus a ratchet is the honest step; the behaviour change is not this slice's.
 *
 * `.mjs` / `.cjs` / `.js` are parsed as JavaScript (`ScriptKind.JS`), which
 * the TypeScript parser supports natively — no new dependency.
 *
 * A root that contributes zero files cannot hide: the debt entry below pins
 * two comparison sites by exact count, so a `scripts/` walk that silently
 * stopped working fails that test rather than reporting clean.
 */
const SCAN_ROOTS: readonly { readonly root: string; readonly extensions: readonly string[] }[] = [
  // `.js` is here although `src/` holds no `.js` file today. It was added for
  // `src/services/hooks/write-gate.js`, a SHIPPED PreToolUse hook that sat
  // outside every shape of this guard purely because of its extension; slice
  // 2026-09-15-s10-misc-cleanup deleted that file (an installed handler that
  // abstained on every path — the installation was the defect), so the
  // extension now has no subject and matches zero files. Kept deliberately: the
  // blind spot was the CLASS, not the one file, and retiring an extension the
  // day its last file leaves means the next file of that extension is unguarded
  // until someone re-adds it — which is precisely how this root came to exist.
  // This is the only root here whose subject count is zero, and that is stated
  // rather than papered over.
  // There is also no `.tsx`/`.jsx`/`.mts`/`.cts` under `src/` today (limit 4).
  { root: join(PROJECT_ROOT, 'src'), extensions: ['.ts', '.js'] },
  { root: join(PROJECT_ROOT, 'scripts'), extensions: ['.mjs', '.cjs', '.js'] }
];

function scriptKindFor(absolutePath: string): ts.ScriptKind {
  return /\.(mjs|cjs|js)$/.test(absolutePath) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
}

function parseSourceFile(absolutePath: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    absolutePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(absolutePath)
  );
}

export {
  PROJECT_ROOT,
  SRC_ROOT,
  SCAN_ROOTS,
  listFilesRecursively,
  parseSourceFile,
  relativeToRoot
};
