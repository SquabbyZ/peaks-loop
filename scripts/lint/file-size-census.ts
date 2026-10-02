#!/usr/bin/env node
// scripts/lint/file-size-census.ts
//
// The whole-tree count behind the `fileSizeOverCap` ratchet row: every file the
// file-size policy covers, measured in the policy's unit, reported as a JSON
// envelope on stdout. Run it through tsx, because the caps it measures against
// live in a `.ts` module:
//
//   node node_modules/tsx/dist/cli.mjs scripts/lint/file-size-census.ts --json
//
// WHY A SEPARATE TOOL (rid 2026-09-30-cap-unify-01). `.husky/peaks-gate.mjs` and
// `.husky/peaks-gate-baseline.mjs` are plain `.mjs` and cannot import a `.ts`
// policy module, so the census is the one thing that does. Both gate paths spawn
// THIS and read the number off its envelope — the same posture the two
// silent-warning legs take toward `scripts/lint/silent-warning-detector.mjs`, for
// the same reason: a ceiling that was typed in is a ceiling nobody measured, and
// that is the failure 3db079d3 and ebee68ce just fixed in the build guard.
//
// ONE UNIT, ONE POLICY, TWO SCOPES. The caps, the dirs, the extensions and the
// meaning of "line" all come from `src/services/scan/file-size-policy.ts`. Restating
// any of them here would recreate the defect this slice removes, so
// `tests/unit/standards/file-size-cap.test.ts` walks the filesystem on its own
// and fails when a second copy appears. The envelope carries the main scope at the
// top level and the `.husky/` scope in a `hooks` block of the same shape
// (`file-size-census-hooks.ts`) — two rows for two populations that share no
// directory, not one number for a union nobody decided.
//
// SCOPE IS `git ls-files`, not a walk. Deliberate: it is the set the gate lints
// and the set a push carries, so an untracked scratch file cannot inflate the row
// and a deleted-but-staged one cannot silently shrink it. The guard test
// cross-measures the same set by walking — that is where the walk belongs: to
// prove the list, not to be it.
//
// Exit codes: 0 when nothing exceeds its cap, 1 when something does. The
// envelope is complete either way — this tool counts, it does not gate. A run
// that cannot enumerate or read its scope crashes with NO envelope on stdout,
// which is what the two callers fail closed on.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FILE_SIZE_LINE_CONVENTION,
  FILE_SIZE_SCOPE_DIRS,
  FILE_SIZE_SCOPE_EXTENSIONS,
  countRawLines,
  fileSizeCapFor,
  fileSizeCaps,
  fileSizeScopeBucket,
  hooksFileSizeCaps,
  isHooksMeasuredFile,
  isPolicyMeasuredFile,
  normalizePolicyPath
} from '../../src/services/scan/file-size-policy.js';
import { hooksCensusOf, hooksTrackedFiles } from './file-size-census-hooks.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** How the envelope names the two files behind the number. */
const POLICY_MODULE = 'src/services/scan/file-size-policy.ts';
const CENSUS_TOOL = normalizePolicyPath(relative(REPO_ROOT, fileURLToPath(import.meta.url)));

/** One over-cap file, the cap that decided it, and the lines over that cap. */
type CensusEntry = {
  file: string;
  lines: number;
  cap: number;
  excess: number;
};

/** The policy's scope as the envelope reports it. */
type CensusBucket = {
  files: number;
  excessLines: number;
};

/** The second scope's block, as `file-size-census-hooks.ts` measures it. */
type HooksEnvelope = ReturnType<typeof hooksCensusOf>;

/**
 * Every tracked file inside the policy's scope, as POSIX repo-relative paths —
 * the same enumeration `pnpm lint` and the gate's `repo` mode run over.
 *
 * The filter is `isPolicyMeasuredFile`, the same predicate `file-size-scan.ts`
 * uses, so the row and the diff scan cannot each have their own idea of what the
 * policy covers (F3 of the repair cycle). `git ls-files` already limits the list
 * to the scope dirs; restating that here is what keeps the extension half from
 * being the only thing applied.
 */
function scopedTrackedFiles(): string[] {
  const raw = execFileSync('git', ['ls-files', '--', ...FILE_SIZE_SCOPE_DIRS], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    windowsHide: true
  });
  return raw
    .split('\n')
    .filter((line) => line !== '')
    .filter((file) => isPolicyMeasuredFile(file));
}

/**
 * A caller-supplied path — absolute or repo-relative, either separator — as a
 * POSIX path this tool can read. The gate leg's control arms use it to hand in
 * ONE scratch over-cap file from OS tmp instead of the whole scope, so a test can
 * watch the row go red without writing into the repo and poisoning a regeneration.
 */
function toRepoRelative(path: string): string {
  const posix = normalizePolicyPath(path);
  const rel = normalizePolicyPath(relative(REPO_ROOT, resolve(REPO_ROOT, posix)));
  return rel === '' || rel.startsWith('..') ? posix : rel;
}

function overCapEntry(file: string): CensusEntry | null {
  const lines = countRawLines(readFileSync(resolve(REPO_ROOT, file), 'utf8'));
  const cap = fileSizeCapFor(file);
  return lines <= cap ? null : { file, lines, cap, excess: lines - cap };
}

/** The envelope: counts, per-bucket totals, and the over-cap list itself. */
function censusOf(files: readonly string[], source: string, hooks: HooksEnvelope) {
  const entries: CensusEntry[] = [];
  for (const file of files) {
    const entry = overCapEntry(file);
    if (entry !== null) entries.push(entry);
  }

  const buckets = new Map<string, CensusBucket>();
  let excessLines = 0;
  for (const entry of entries) {
    const bucket = fileSizeScopeBucket(entry.file);
    const current = buckets.get(bucket) ?? { files: 0, excessLines: 0 };
    current.files += 1;
    current.excessLines += entry.excess;
    buckets.set(bucket, current);
    excessLines += entry.excess;
  }

  // Every policy dir is a key even at zero, so `scripts: 0` is visible as a
  // measured zero rather than mistakable for "not counted".
  const byDir: Record<string, CensusBucket> = {};
  for (const dir of FILE_SIZE_SCOPE_DIRS)
    byDir[dir] = buckets.get(dir) ?? { files: 0, excessLines: 0 };
  for (const [bucket, totals] of buckets) {
    if (byDir[bucket] === undefined) byDir[bucket] = totals;
  }

  return {
    tool: CENSUS_TOOL,
    policyModule: POLICY_MODULE,
    convention: FILE_SIZE_LINE_CONVENTION,
    caps: fileSizeCaps(),
    scope: {
      source,
      dirs: FILE_SIZE_SCOPE_DIRS,
      extensions: FILE_SIZE_SCOPE_EXTENSIONS,
      countedFiles: files.length
    },
    overCap: entries.length,
    excessLines,
    byDir,
    files: entries.sort((a, b) => b.excess - a.excess || a.file.localeCompare(b.file)),
    // THE SECOND SCOPE, IN ITS OWN BLOCK (§2.32). Not a fifth `byDir` bucket: the
    // main rows count four directories and the hooks rows count one, and a bucket
    // that mixed them would let `.husky/` growth move `fileSizeOverCap` — which is
    // the re-decision the monotonicity guard exists to refuse.
    hooks
  };
}

/**
 * Fail closed if the policy resolves to nothing usable. A cap that is not a
 * positive integer makes every file read as "under cap", and the envelope would
 * report `overCap: 0` — the exact shape of a number that was never measured, and
 * the one thing a seeding generator must not copy. The line probe guards the same
 * thing on the other axis: 174 files counted by `split('\n')` is not 174 files
 * counted by `wc -l`, and the difference is invisible in the count itself.
 */
function assertPolicyResolves(): void {
  const caps = fileSizeCaps();
  const capValues = [
    caps.defaultCap,
    caps.testsCap,
    fileSizeCapFor('src/x.ts'),
    hooksFileSizeCaps().hooksCap
  ];
  for (const cap of capValues) {
    if (!Number.isInteger(cap) || cap <= 0) {
      throw new Error(
        `file-size policy resolved to no usable cap (${String(cap)}) — refusing to count`
      );
    }
  }
  if (countRawLines('a\nb') !== 2) {
    throw new Error('the policy no longer counts lines as split-newlines — refusing to count');
  }
}

/**
 * `--json` is accepted for symmetry with the silent-warning detector; the
 * envelope is the only output either way. Any other argument narrows the scan to
 * the named files.
 */
function main(): number {
  assertPolicyResolves();
  const argv = process.argv.slice(2);
  const explicit = argv.some((arg) => !arg.startsWith('--'));
  const paths = argv.filter((arg) => !arg.startsWith('--')).map(toRepoRelative);
  const files = explicit ? paths : scopedTrackedFiles();
  // The two scopes enumerate separately and filter through their own predicate, so
  // a file can be counted by one block and not the other — which is the whole reason
  // this is a second pair of rows rather than a fifth directory in the first scope.
  const hooksFiles = explicit
    ? paths.filter((file) => isHooksMeasuredFile(file))
    : hooksTrackedFiles(REPO_ROOT);
  const hooks = hooksCensusOf(REPO_ROOT, hooksFiles, explicit);
  const source = explicit ? 'explicit paths (caller-supplied)' : 'git ls-files <policy dirs>';
  const envelope = censusOf(files, source, hooks);
  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
  // Exit 1 for EITHER scope: a census that reported 0 and exited 0 while the guard
  // itself had grown past its cap is the invisibility §2.32 was filed for.
  return envelope.overCap === 0 && envelope.hooks.overCap === 0 ? 0 : 1;
}

process.exitCode = main();
