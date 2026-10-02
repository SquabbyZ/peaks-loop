#!/usr/bin/env node
// scripts/lint/file-size-census-hooks.ts
//
// The hooks half of the census envelope: the `.husky/` scope, counted under the
// same policy as the main scope and reported as its own block so it can have its
// own ceiling rows. Split out of `file-size-census.ts` because that file is a
// measured, capped file in `scripts/` (cap 300 raw lines) and this scope is ~90 of
// them; the census stays the entry point and this module stays the only place the
// hooks enumeration exists.
//
// WHY THIS SCOPE WAS INVISIBLE (backlog §2.32, rid 2026-10-02-hooks-size-rows).
// `.husky` is not in `FILE_SIZE_SCOPE_DIRS`, so the files that implement the
// file-size ceiling were measured by nothing: `peaks-gate.mjs` grew to 1004 raw
// lines today while `fileSizeOverCap` — the row that would have seen it — cannot
// see a path outside its four directories. Its own rows, seeded from this block,
// are what turn that growth into a ceiling that may only go DOWN.
//
// ONE UNIT, ONE POLICY, SAME RULE AS THE MAIN CENSUS. The cap, the directories,
// the extensions and the meaning of "line" come from
// `src/services/scan/file-size-policy.ts`; restating any of them here recreates the
// defect `tests/unit/standards/file-size-cap.test.ts` exists to report.
//
// SCOPE IS `git ls-files`, not a walk — the same deliberate choice the main census
// makes, for the same reason: it is the set a push carries, so an untracked scratch
// file cannot inflate the row and a deleted-but-staged one cannot silently shrink
// it. `tests/unit/lint/file-size-hooks-gate-leg.test.ts` cross-measures the same set
// by walking, which is where that walk belongs.
//
// FAIL CLOSED ON AN ABSENT SCOPE. `assertHooksScopeExists` refuses to count a
// directory that is not there. Without it, deleting `.husky/` would report
// `overCap: 0, excessLines: 0` — the exact shape of debt cleared — and the row would
// descend to zero on the strength of a directory nobody measured.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  FILE_SIZE_LINE_CONVENTION,
  FILE_SIZE_SCOPE_EXTENSIONS,
  HOOKS_FILE_SIZE_SCOPE_DIRS,
  countRawLines,
  hooksFileSizeCaps,
  isHooksMeasuredFile
} from '../../src/services/scan/file-size-policy.js';

/** How this block names its own whole-scope enumeration, for the gate to bind against. */
export const HOOKS_WHOLE_SCOPE_SOURCE = 'git ls-files <hooks dirs>';

/** How this block names a caller-supplied file list, which is not the row. */
export const HOOKS_EXPLICIT_SOURCE = 'explicit paths (caller-supplied)';

/** One hooks file over its cap, the cap that decided it, and the lines over it. */
type HooksEntry = {
  file: string;
  lines: number;
  cap: number;
  excess: number;
};

/**
 * Refuse to count a hooks scope that does not exist. Checked before enumeration
 * because `git ls-files -- <missing dir>` answers with an EMPTY LIST and exit 0,
 * which is indistinguishable from a scope that measured clean.
 */
export function assertHooksScopeExists(root: string): void {
  const dirs = HOOKS_FILE_SIZE_SCOPE_DIRS as readonly string[];
  if (dirs.length === 0) {
    throw new Error(
      'the hooks scope declares no directories — refusing to report a hooks row of 0 ' +
        'for a scope that measures nothing'
    );
  }
  for (const dir of dirs) {
    if (!existsSync(join(root, dir))) {
      throw new Error(
        `the hooks scope names ${dir}/, which does not exist under this project root — ` +
          'refusing to report a hooks row of 0 for a directory that is gone'
      );
    }
  }
}

/** Every tracked hooks-scope file, as POSIX repo-relative paths. */
export function hooksTrackedFiles(root: string): string[] {
  assertHooksScopeExists(root);
  const raw = execFileSync('git', ['ls-files', '--', ...HOOKS_FILE_SIZE_SCOPE_DIRS], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true
  });
  return raw
    .split('\n')
    .filter((line) => line !== '')
    .filter((file) => isHooksMeasuredFile(file));
}

/** The entry for one file, or null when it is at or under the hooks cap. */
function hooksOverCapEntry(root: string, file: string): HooksEntry | null {
  const lines = countRawLines(readFileSync(join(root, file), 'utf8'));
  const cap = hooksFileSizeCaps().hooksCap;
  return lines <= cap ? null : { file, lines, cap, excess: lines - cap };
}

/**
 * The hooks block of the census envelope, mirroring the shape the two main rows
 * already carry: the two numbers, the scope that produced them, the cap, the unit,
 * and the over-cap list itself.
 *
 * `explicit` is the caller's own answer to "did you hand me a file list?". A named
 * list is measured the same way and reported under the explicit source, so the leg
 * can disclaim it instead of letting a one-file subset vouch for a whole-tree row
 * (repair cycle F1, applied to the second scope on the day it was created).
 */
export function hooksCensusOf(root: string, files: readonly string[], explicit: boolean) {
  if (!explicit) assertHooksScopeExists(root);
  const entries: HooksEntry[] = [];
  let excessLines = 0;
  for (const file of files) {
    const entry = hooksOverCapEntry(root, file);
    if (entry !== null) {
      entries.push(entry);
      excessLines += entry.excess;
    }
  }
  return {
    overCap: entries.length,
    excessLines,
    scope: {
      source: explicit ? HOOKS_EXPLICIT_SOURCE : HOOKS_WHOLE_SCOPE_SOURCE,
      dirs: HOOKS_FILE_SIZE_SCOPE_DIRS,
      extensions: FILE_SIZE_SCOPE_EXTENSIONS,
      countedFiles: files.length
    },
    caps: hooksFileSizeCaps(),
    convention: FILE_SIZE_LINE_CONVENTION,
    files: entries.sort((a, b) => b.excess - a.excess || a.file.localeCompare(b.file))
  };
}
