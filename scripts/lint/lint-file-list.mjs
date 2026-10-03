#!/usr/bin/env node
/**
 * ONE source of truth for "which files does this repo's lint measure?".
 *
 * WHY THIS MODULE EXISTS (measured 2026-09-29, whole repo, 1298 in-scope files)
 * ----------------------------------------------------------------------------
 * `package.json#scripts.lint` used to be
 *     eslint --config config/eslint/.peaks-rules.cjs --ext .ts src tests packages
 * while the authoritative invocation is `.husky/peaks-gate.mjs` -> `runEslint()`:
 * an EXPLICIT file list from `git ls-files`, filtered to the published scope and
 * passed with `--no-ignore`. Two divergences, both measured:
 *   1. the script never passed `scripts/**`, where 73 eslint findings live;
 *   2. `--ext .ts` excludes .mts/.cts/.mjs/.cjs/.js files the gate counts.
 * So `pnpm lint` showed a developer a STRICTLY SMALLER number than the number
 * the push is judged by — the repo's recurring defect shape, a cheap
 * approximation of the real property. This module is the list both of them use.
 *
 * The scope rule is not invented here: `scope.dirs` is read from the published
 * baseline, exactly the way the gate reads it, and the extensions are the seven
 * `.husky/peaks-gate.mjs` used to key its own `CODE_EXT` regex on (the same seven,
 * spelled as a list, are published under `scope.extensions` in that baseline).
 * Slice a5 (2026-09-29) wired `.husky/peaks-gate.mjs` to import this module, so
 * the gate has no copy of the rule left; `tests/unit/lint/lint-file-list-parity.test.ts`
 * runs the gate's own `repo` mode and compares the count it reports against the
 * published rule, so a re-weakened filter goes red instead of printing
 * `ceilings held`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  .split('\\')
  .join('/');

const BASELINE_PATH = resolve(ROOT, '.peaks/lint/gate-baseline.json');

/**
 * The seven extensions this list admits, and the seven published in
 * `scope.extensions`. The parity test fails until the two spellings agree, which
 * is the point. Since slice a5 the gate has no third spelling to keep in step: it
 * imports this array, so a new extension is added here and in the baseline.
 */
export const EXTENSIONS = ['ts', 'tsx', 'mts', 'cts', 'mjs', 'cjs', 'js'];

/**
 * True when a path carries one of the seven code extensions — the extension half
 * of the scope rule, on its own so the gate can name the files it DROPPED for
 * directory reasons (rid `2026-10-03-w10-rescope-a`, H2: a code file outside the
 * enforced scope must be exempted OUT LOUD, and a `.md` in the change set is not
 * part of that sentence — it was never a candidate for any leg).
 */
export const hasLintExtension = (p) => new RegExp(`\\.(${EXTENSIONS.join('|')})$`).test(p);

/** The scope directories of the published rule — the same source the gate reads. */
export function scopeDirs() {
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).scope.dirs;
}

/** Every tracked file, as forward-slash paths relative to the repo root. */
export function trackedFiles() {
  // `git ls-files` reads the INDEX, so it lists exactly the files a push carries
  // — untracked scratch files cannot inflate the number, deleted-but-unstaged
  // ones cannot silently shrink it (they stay, because they stay in the index).
  return execFileSync('git', ['ls-files'], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true
  })
    .trim()
    .split('\n');
}

/**
 * The published rule applied to a list of paths. Pure, and deliberately exported
 * on its own: the control arm of the parity test weakens THIS call (one dir
 * dropped, one extension dropped) to show the guard can see its own weakening.
 */
export function filterScopeFiles(paths, dirs, extensions) {
  const codeExt = new RegExp(`\\.(${extensions.join('|')})$`);
  return paths.filter((p) => codeExt.test(p) && dirs.some((d) => p.startsWith(`${d}/`)));
}

/** The in-scope file set: what `pnpm lint` lints and what the gate measures. */
export function lintFileList() {
  return filterScopeFiles(trackedFiles(), scopeDirs(), EXTENSIONS);
}
