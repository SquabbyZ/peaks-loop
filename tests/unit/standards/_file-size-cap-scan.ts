// tests/unit/standards/_file-size-cap-scan.ts
//
// The scan library behind `tests/unit/standards/file-size-cap.test.ts` — the
// same division `tests/unit/standards/_vitest-worker-cap-scan.ts` uses: the
// machinery lives here, the collected scenario module keeps every case.
//
// WHAT THIS GUARD HOLDS OPEN (rid 2026-09-30-cap-unify-01). The repo wrote one
// file-size policy twice, in two units: eslint `max-lines: 400` effective and a
// raw `DEFAULT_FILE_SIZE_THRESHOLD = 800` in `src/services/scan/file-size-scan.ts`.
// The policy is now one module, `src/services/scan/file-size-policy.ts`, and a
// gate row (`fileSizeOverCap`) ratchets the whole-tree count. The rot that
// produced the two-copy state was nobody observing the copies against each other,
// so this library carries NO list of files and NO copy of a cap: it WALKS the
// filesystem, counts with the policy's own functions, spawns the census tool, and
// reports the file that drifted.
//
// THREE INDEPENDENT READINGS OF ONE NUMBER, which is what makes the seeded
// ceiling checkable rather than asserted:
//   walk     — this library's recursion over the filesystem, capped by the policy
//   tool     — `scripts/lint/file-size-census.ts`, run as the gate runs it (tsx,
//              `git ls-files` over the policy's dirs), reading its JSON envelope
//   artifact — the ceiling published in `.peaks/lint/gate-baseline.json`
// They share the policy module (deliberately — it is the thing under test) but
// not the enumeration, and the artifact was written by a generator that can only
// copy what the tool reported.

import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';

import {
  FILE_SIZE_CAP_DEFAULT,
  FILE_SIZE_CAP_TESTS,
  FILE_SIZE_LINE_CONVENTION,
  FILE_SIZE_SCOPE_DIRS,
  countRawLines,
  fileSizeCapFor,
  fileSizeCaps,
  hasPolicyExtension,
  isPolicyMeasuredFile
} from '../../../src/services/scan/file-size-policy.js';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The one module allowed to define a cap. */
export const POLICY_MODULE_PATH = 'src/services/scan/file-size-policy.ts';

/** The tool the gate and the baseline generator both spawn. */
export const CENSUS_TOOL_PATH = 'scripts/lint/file-size-census.ts';
export const TSX_CLI_PATH = 'node_modules/tsx/dist/cli.mjs';

/** `.peaks/lint/gate-baseline.json` — the published artifact, not a copy of it. */
export const BASELINE_PATH = join(REPO_ROOT, '.peaks', 'lint', 'gate-baseline.json');

/** Baseline directory a walk must not enter: build output and dependencies. */
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'coverage']);

/**
 * Names that CLAIM to be a line cap. Anything in scope carrying one of these with
 * a numeric initializer outside the policy module is a second copy of the policy
 * — including the historical spelling `DEFAULT_FILE_SIZE_THRESHOLD`, which is how
 * the 800 came back.
 */
export const CAP_NAME =
  /^(DEFAULT_FILE_SIZE|FILE_SIZE_CAP|FILE_SIZE_LINE|SIZE_CAP_|LINE_CAP|MAX_LINES)/;

/** A file whose name says it enforces the file-size cap must READ the policy. */
const CAP_ENFORCING_NAME = /file-size|size-cap/;

/** The module every such file must import, as a basename without extension. */
const POLICY_MODULE = /^file-size-policy$/;

export type Finding = {
  readonly file: string;
  readonly reason: string;
};

export type OverCapEntry = {
  readonly file: string;
  readonly lines: number;
  readonly cap: number;
};

/** The envelope `scripts/lint/file-size-census.ts --json` writes on stdout. */
export type CensusEnvelope = {
  readonly tool: string;
  readonly policyModule: string;
  readonly convention: string;
  readonly caps: { readonly defaultCap: number; readonly testsCap: number };
  readonly scope: {
    readonly source: string;
    readonly dirs: readonly string[];
    readonly extensions: readonly string[];
    readonly countedFiles: number;
  };
  readonly overCap: number;
  readonly excessLines: number;
  readonly byDir: Readonly<Record<string, { files: number; excessLines: number }>>;
  readonly files: readonly OverCapEntry[];
};

// ---------------------------------------------------------------------------
// enumeration: the walk, and the git set it is cross-measured against
// ---------------------------------------------------------------------------

/**
 * Every code file under `absDir`, as POSIX paths relative to that directory.
 * Dot-directories are skipped: `.peaks/_runtime/**` keeps snapshots of past
 * sessions, and a copy of a source file in one is history, not the live tree.
 */
export function listCodeFiles(relRoot: string, absDir: string, out: string[]): string[] {
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const rel = relRoot === '' ? entry.name : `${relRoot}/${entry.name}`;
    const abs = join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      listCodeFiles(rel, abs, out);
    } else if (entry.isFile() && hasPolicyExtension(rel)) {
      out.push(rel);
    }
  }
  return out;
}

/** The policy's scope applied to a filesystem walk of `root`. */
export function walkScopedFiles(root: string): string[] {
  return listCodeFiles('', root, []).filter((file) => isPolicyMeasuredFile(file));
}

/**
 * The same scope read through a second mechanism that shares no recursion with
 * the walk: git's index plus the untracked-and-not-ignored pair, so a file added
 * by this very slice is visible to both arms.
 */
export function gitScopedFiles(root: string): string[] {
  const raw = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true
  });
  return raw
    .split('\n')
    .filter((line) => line !== '')
    .filter((file) => isPolicyMeasuredFile(file));
}

/**
 * The TRACKED scope, the way the census enumerates it — `git ls-files` over the
 * policy's directories, filtered by the policy's own predicate. Separate from
 * `gitScopedFiles` because the artifact can only describe a committed file: an
 * untracked scratch file is not a missing baseline entry.
 *
 * This is the set the F4 coverage guard walks: every file the row counts must
 * also have a per-file entry in `.peaks/lint/gate-baseline.json`, or that artifact
 * is stale on the axis the gate's per-file legs read.
 */
export function censusCountedFiles(root: string): string[] {
  const raw = execFileSync('git', ['ls-files', '--', ...FILE_SIZE_SCOPE_DIRS], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true
  });
  return raw
    .split('\n')
    .filter((line) => line !== '')
    .filter((file) => isPolicyMeasuredFile(file));
}

// ---------------------------------------------------------------------------
// the count: walk + policy
// ---------------------------------------------------------------------------

/** Files over the policy cap, measured by reading each one and counting lines
 *  the way the policy says a line is counted. */
export function overCapFromWalk(root: string, files?: readonly string[]): OverCapEntry[] {
  const scoped = files ?? walkScopedFiles(root);
  const entries: OverCapEntry[] = [];
  for (const file of scoped) {
    const lines = countRawLines(readFileSync(join(root, file), 'utf8'));
    const cap = fileSizeCapFor(file);
    if (lines > cap) entries.push({ file, lines, cap });
  }
  return entries;
}

/**
 * Spawn the census the way the gate spawns it, and hand back both its exit code
 * and its envelope. A census that could not START throws — on this host a
 * `spawn UNKNOWN` or an allocation failure has to surface as a broken test, never
 * as a `0` that reads like a clean census.
 */
export function censusRun(extraArgs: readonly string[] = []): {
  status: number;
  envelope: CensusEnvelope;
} {
  const result = spawnSync('node', [TSX_CLI_PATH, CENSUS_TOOL_PATH, '--json', ...extraArgs], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error !== undefined) throw result.error;
  return {
    status: result.status ?? -1,
    envelope: JSON.parse(result.stdout) as CensusEnvelope
  };
}

/** The envelope alone, for the arms that only need the numbers. */
export function runCensus(extraArgs: readonly string[] = []): CensusEnvelope {
  return censusRun(extraArgs).envelope;
}

// ---------------------------------------------------------------------------
// the two-copy detector
// ---------------------------------------------------------------------------

/** The basename of a module specifier, minus any ESM or TS extension. */
export function moduleBasename(specifier: string): string {
  const segments = specifier.split(/[\\/]/);
  const last = segments[segments.length - 1] ?? specifier;
  return last.replace(/\.[cm]?[jt]s$/, '');
}

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
}

/** Top-level `const NAME = <number>` where NAME claims to be a line cap. */
function capDeclarations(source: ts.SourceFile): string[] {
  const found: string[] = [];
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !CAP_NAME.test(declaration.name.text)) continue;
      if (declaration.initializer !== undefined && ts.isNumericLiteral(declaration.initializer)) {
        found.push(declaration.name.text);
      }
    }
  }
  return found;
}

/** Does this file read the policy module at all, however it imports it? */
function importsPolicy(source: ts.SourceFile): boolean {
  return source.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      POLICY_MODULE.test(moduleBasename(statement.moduleSpecifier.text))
  );
}

/**
 * FINDING 1 — a second copy of a cap. A numeric constant named like a line cap
 * anywhere in scope except the policy module. This is the shape that came back
 * as `DEFAULT_FILE_SIZE_THRESHOLD = 800`, and the reason the number can never be
 * re-typed into a consumer: it would be reported by name.
 */
export function capCopyFindings(root: string, files?: readonly string[]): Finding[] {
  const scoped = files ?? walkScopedFiles(root);
  const findings: Finding[] = [];
  for (const file of scoped) {
    if (file === POLICY_MODULE_PATH) continue;
    const names = capDeclarations(parse(file, readFileSync(join(root, file), 'utf8')));
    if (names.length === 0) continue;
    findings.push({
      file,
      reason: `defines ${names.join(', ')} as a number — a second copy of the cap. \`fileSizeCapFor\` from \`${POLICY_MODULE_PATH}\` is the only source`
    });
  }
  return findings;
}

/**
 * FINDING 2 — a file-size enforcer that never reads the policy. The file set is
 * the walk filtered by NAME, not a hand-maintained list: a new `file-size-*`
 * module that hard-codes its own threshold is caught by both arms, and one that
 * computes it some other way is caught here.
 */
export function policyWiringFindings(root: string, files?: readonly string[]): Finding[] {
  const scoped = files ?? walkScopedFiles(root);
  const findings: Finding[] = [];
  for (const file of scoped) {
    if (file === POLICY_MODULE_PATH) continue;
    const base = file.split('/').pop() ?? file;
    if (!CAP_ENFORCING_NAME.test(base)) continue;
    if (importsPolicy(parse(file, readFileSync(join(root, file), 'utf8')))) continue;
    findings.push({
      file,
      reason: `a file-size-cap file that does not import \`${POLICY_MODULE_PATH}\`, so whatever it enforces is not the policy`
    });
  }
  return findings;
}

/** The failure text: a bare rule name is useless when the tree has 1400 files. */
export function describeFindings(findings: readonly Finding[], rule: string): string {
  if (findings.length === 0) return '';
  return `${findings.length} file(s) break the file-size policy rule "${rule}":\n${findings
    .map((f) => `  - ${f.file}: ${f.reason}`)
    .join('\n')}\nCaps live in ${POLICY_MODULE_PATH} (see \`peaks scan file-size --help\`).`;
}

/**
 * A fixture tree under OS tmp — never inside `src/` or `tests/`, because a
 * fixture the other gates enumerate would move the very census this guard
 * measures (the lesson `tests/unit/lint/silent-warning-gate-leg.test.ts` records).
 */
export function withFixtureTree(
  files: Readonly<Record<string, string>>,
  body: (root: string) => void
): void {
  const root = mkdtempSync(join(tmpdir(), 'peaks-file-size-cap-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      const full = join(root, name);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, 'utf8');
    }
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * A file that over the policy cap by construction: one more line than the cap a
 * caller names, as repo-relative POSIX path. Used by the gate-leg arms, which
 * hand the gate a scratch path rather than writing into the repo.
 */
export function overCapFixture(cap: number = FILE_SIZE_CAP_DEFAULT): string {
  return Array.from({ length: cap + 1 }, () => 'x').join('\n');
}

/** The policy as the test sees it, so every assertion names the source of truth. */
export const POLICY = {
  defaultCap: FILE_SIZE_CAP_DEFAULT,
  testsCap: FILE_SIZE_CAP_TESTS,
  convention: FILE_SIZE_LINE_CONVENTION,
  caps: fileSizeCaps()
};

// ── the gate as a MODULE SET ──────────────────────────────────────────────────
//
// WHY THIS EXISTS (rid 2026-10-02-wave9-gate-entry-split). `.husky/peaks-gate.mjs`
// reached 1019 raw lines — over the very cap its own hooks row measures — and its
// regions now live in `.husky/gate/*.mjs`. Several guards, here and in
// `tests/unit/lint/`, read the gate's SOURCE TEXT to pin a WIRING fact ("the leg
// reaches the shared census module", "one census feeds every row"). A pin that
// names ONE FILE goes red for the right reason when the symbol it pins moves into
// a sibling; leaving the string in the entry to soothe the pin would be the §2.28
// defect wearing the opposite hat. So a pin pools the module SET instead: this
// library walks `.husky/gate/`, reads every module, and the symbol must appear
// SOMEWHERE in the set — which `file-size-cap.test.ts`'s plant arm (a symbol in
// exactly one sibling, found) and inverse arm (the symbol nowhere, red) keep from
// being a claim. NO list of gate module names exists in this file, so the day slice
// 2 or 3 adds or removes a sibling, nothing here has to be edited.

/** The gate's entry, repo-relative: the one path every spawn site uses. */
export const GATE_ENTRY_REL = join('.husky', 'peaks-gate.mjs');

/** The directory the gate's regions moved into, repo-relative. */
export const GATE_DIR_REL = join('.husky', 'gate');

/** Every module the gate is made of — the entry plus `.husky/gate/*.mjs`, WALKED. */
export function gateModulePaths(root: string = REPO_ROOT): string[] {
  const dir = join(root, GATE_DIR_REL);
  const peers = existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs'))
        .map((entry) => join(GATE_DIR_REL, entry.name))
    : [];
  return [GATE_ENTRY_REL, ...peers.sort()];
}

/** The TEXT of the whole set, in a stable order, with a marker between modules. */
export function gateModuleText(root: string = REPO_ROOT): string {
  return gateModulePaths(root)
    .map((file) => readFileSync(join(root, file), 'utf8'))
    .join('\n// ─── gate module break ───\n');
}

/**
 * THE GENERATOR'S MODULE SET (rid `2026-10-02-wave9-generator-split`).
 *
 * Same problem, same rule: the generator was 799 raw lines of straight-line script and
 * its regions are now `.husky/baseline/*.mjs`, so a pin that read the ENTRY alone would
 * pin a file that no longer speaks. `gateModulePaths` above is the precedent this
 * follows, and it reuses `listCodeFiles` rather than adding a second recursion. The
 * spellings here are FORWARD-SLASH, because the set composes with `hooksScopeFilesUnder`
 * (the fixtures' staging walk) and a `join()`-built path here would silently compare
 * false against it — the Windows trap that cost slice 2 seven arms.
 */
export const GENERATOR_ENTRY_REL = '.husky/peaks-gate-baseline.mjs';
export const GENERATOR_DIR_REL = '.husky/baseline/';
/** The last assembled ceiling row followed by the object's closing `};`. */
export const CEILINGS_TAIL_ANCHOR = /fileSizeExcessLines: size\.env\.excessLines\r?\n[ \t]*\};/;

/** The generator entry plus every walked `.husky/baseline/` sibling, entry first. */
export function generatorModulePathsUnder(root: string): string[] {
  const husky = join(root, '.husky');
  const walked = existsSync(husky)
    ? listCodeFiles('', husky, []).map((rel) => `.husky/${rel}`)
    : [];
  const set = walked.filter(
    (rel) => rel === GENERATOR_ENTRY_REL || rel.startsWith(GENERATOR_DIR_REL)
  );
  return [GENERATOR_ENTRY_REL, ...set.filter((rel) => rel !== GENERATOR_ENTRY_REL).sort()];
}

/** The pooled TEXT of that set — what a pin about the generator SET must read. */
export function generatorModuleTextUnder(root: string): string {
  return generatorModulePathsUnder(root)
    .map((rel) => readFileSync(join(root, rel), 'utf8'))
    .join('\n// ─── generator module break ───\n');
}

/**
 * The ONE module that assembles the last ceiling row — the file a caller must PATCH to
 * add a row, found by the row's own anchor and never by a name. Zero holders is stale
 * (a reader aimed at a file that no longer holds the rows) and two is the second-copy
 * defect, so both throw.
 */
export function generatorCeilingsFileUnder(root: string): string {
  const hits = generatorModulePathsUnder(root).filter((rel) =>
    CEILINGS_TAIL_ANCHOR.test(readFileSync(join(root, rel), 'utf8'))
  );
  const [holder] = hits;
  if (hits.length !== 1 || holder === undefined) {
    throw new Error(
      `the assembled ceiling rows must live in exactly one module of the generator set ` +
        `— found ${hits.length} (${hits.join(', ') || 'none'}) under ${root}`
    );
  }
  return holder;
}

/**
 * THE FILE-SIZE LEG'S MODULE SET (rid `2026-10-02-wave9-file-size-split`).
 *
 * Same problem, same rule. `.husky/peaks-gate-file-size.mjs` reached 411 raw lines —
 * over the very hooks cap it measures — and its exported functions are now
 * `.husky/file-size/*.mjs` behind a re-exporting entry at the unchanged path. A pin
 * that read the ENTRY alone would pin a file that no longer holds the string: the
 * ceiling keys, labels and scope-source now live in `constants.mjs`, and
 * `CONTROL ARM` in the print module. So a pin pools the SET instead. It reuses
 * `listCodeFiles` (no name list, entry-first, forward-slashed to compose with
 * `hooksScopeFilesUnder`) exactly like `generatorModulePathsUnder` above, so the day
 * a slice 4 sibling is added or removed nothing here has to be edited.
 */
export const FILE_SIZE_ENTRY_REL = '.husky/peaks-gate-file-size.mjs';
export const FILE_SIZE_DIR_REL = '.husky/file-size/';

/** The file-size entry plus every walked `.husky/file-size/` sibling, entry first. */
export function fileSizeModulePaths(root: string): string[] {
  const husky = join(root, '.husky');
  const walked = existsSync(husky)
    ? listCodeFiles('', husky, []).map((rel) => `.husky/${rel}`)
    : [];
  const set = walked.filter(
    (rel) => rel === FILE_SIZE_ENTRY_REL || rel.startsWith(FILE_SIZE_DIR_REL)
  );
  return [FILE_SIZE_ENTRY_REL, ...set.filter((rel) => rel !== FILE_SIZE_ENTRY_REL).sort()];
}

/** The pooled TEXT of that set — what a pin about the file-size SET must read. */
export function fileSizeModuleText(root: string): string {
  return fileSizeModulePaths(root)
    .map((rel) => readFileSync(join(root, rel), 'utf8'))
    .join('\n// ─── file-size module break ───\n');
}
