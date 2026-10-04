// tests/unit/lint/_file-size-hooks-fixture.ts
//
// The fixture harness behind the two `.husky/` hooks-row guard files
// (`file-size-hooks-gate-leg.test.ts`, `file-size-hooks-seeding.test.ts`), the same
// division `tests/unit/standards/_file-size-cap-scan.ts` uses: machinery here, the
// scenarios in the collected files.
//
// WHY A FIXTURE REPOSITORY AT ALL. Every arm these files need — the hooks rows
// refusing to rise, the two scopes staying blind to each other, the input binding
// tripping on a re-decided hooks cap — is a run of the REAL gate against a ceiling
// the REAL generator wrote. Today the published `.peaks/lint/gate-baseline.json`
// carries no hooks rows at all, so the real leg refuses to speak for them until the
// orchestrator's seeding run lands (correctly: `missingFileSizeCeilings` fails closed
// on all four keys). A guard whose arms only run after somebody regenerates the
// artifact is a guard that cannot be watched going red, so these arms build a
// repository under OS tmp, copy the real gate / leg / generator / census / policy
// modules into it, and let the real measurement path seed the real rows. The shape is
// `tests/unit/lint/baseline-monotonicity-seeding.test.ts`'s, with the census NOT
// stubbed: `node_modules/tsx` here is a forwarder to the repository's real tsx, and
// the census that answers the gate is the file the gate actually spawns.
//
// WHAT IS STUBBED, AND WHY THAT IS NOT THE POINT
//   - eslint and tsc: the generator spawns them; the file-size leg does not. Their
//     fixtures answer with the empty report, so the eslint/tsc rows are the
//     fixture's own zeroes.
//   - the silent-warning detector: same reason.
//   - NOT stubbed: the census, the policy module, both file-size legs, the
//     monotonicity comparison, the artifact write, and `check` — every one of those is
//     the file the real repository runs, copied byte-for-byte.
//
// NOTHING IS WRITTEN INTO THE REPOSITORY (backlog §2.31). Each instance lives under
// `mkdtempSync(join(tmpdir(), …))` and is removed by the collected file's `afterAll`.

import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  FILE_SIZE_CAP_DEFAULT,
  FILE_SIZE_CAP_HOOKS,
  FILE_SIZE_SCOPE_DIRS,
  FILE_SIZE_SCOPE_EXTENSIONS,
  HOOKS_FILE_SIZE_SCOPE_DIRS,
  countRawLines,
  isHooksMeasuredFile
} from '../../../src/services/scan/file-size-policy.js';
import { REPO_ROOT } from '../standards/_file-size-cap-scan.js';
import { type HooksWalk, type OverCapEntry, walkHooksScope } from './_file-size-hooks-walk.js';

/** The real tsx the fixture's forwarder hands its argv to. */
const REAL_TSX = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const MAX_BUFFER = 64 * 1024 * 1024;

/** The rows these guards speak about. */
export const HOOKS_OVER_CAP_ROW = 'file-size hooks over cap';
export const HOOKS_OVER_CAP_KEY = 'fileSizeHooksOverCap';
export const HOOKS_EXCESS_ROW = 'file-size hooks excess lines';
export const HOOKS_EXCESS_KEY = 'fileSizeHooksExcessLines';

/** The two main rows, watched only to prove they do NOT move. */
export const MAIN_OVER_CAP_ROW = 'file-size over cap';
export const MAIN_EXCESS_ROW = 'file-size excess lines';
export const MAIN_OVER_CAP_KEY = 'fileSizeOverCap';
export const MAIN_EXCESS_KEY = 'fileSizeExcessLines';

const ARTIFACT_REL = join('.peaks', 'lint', 'gate-baseline.json');
const GATE_REL = join('.husky', 'peaks-gate.mjs');
const GENERATOR_REL = join('.husky', 'peaks-gate-baseline.mjs');
const POLICY_REL = join('src', 'services', 'scan', 'file-size-policy.ts');
const CENSUS_REL = join('scripts', 'lint', 'file-size-census.ts');

/**
 * Every `.husky/` module the gate is made of, by WALKING the source tree under the
 * census's OWN hooks-scope rule (`isHooksMeasuredFile`), so the fixture stages
 * whatever the gate is made of and cannot go stale the way the fixed list this
 * replaces did. That list named `.husky/peaks-gate.mjs`, `-baseline.mjs`,
 * `-file-size.mjs` and `-baseline-monotonic.mjs` by hand; the day the gate's regions
 * moved to `.husky/gate/*.mjs` (rid `2026-10-02-wave9-gate-entry-split`) the fixture's
 * copy of the ENTRY alone died at load inside the temp repo —
 * `ERR_MODULE_NOT_FOUND: …\.husky\gate\changed.mjs`, the same shape as the wave-7
 * parity incident. A hard-coded name list is a second copy of the tree; a walk is
 * the tree. `file-size-hooks-gate-leg.test.ts` carries the plant arm (a module added
 * under `.husky/gate/` grows the staged set with no edit here) and the inverse.
 */
export function hooksScopeFilesUnder(root: string): string[] {
  const out: string[] = [];
  const scan = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel2 = rel === '' ? entry.name : `${rel}/${entry.name}`;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) scan(abs, rel2);
      else if (entry.isFile() && isHooksMeasuredFile(rel2)) out.push(rel2);
    }
  };
  for (const dir of HOOKS_FILE_SIZE_SCOPE_DIRS) {
    const abs = join(root, dir);
    if (existsSync(abs)) scan(abs, dir);
  }
  return out.sort();
}

/** The non-`.husky/` half of what the fixture runs byte-for-byte from the repository. */
const RUNTIME_FILES = [
  CENSUS_REL,
  join('scripts', 'lint', 'file-size-census-hooks.ts'),
  POLICY_REL,
  join('scripts', 'lint', 'lint-file-list.mjs')
];

/**
 * Everything the fixture runs byte-for-byte from the repository, in one walked set.
 * Exported so `gate-module-staging.test.ts` can assert it covers every module the gate
 * is made of: a fixture that stages less than the entry imports dies at load, and that
 * is the failure this list used to cause.
 */
export const FIXTURE_COPIED_FILES = [...hooksScopeFilesUnder(REPO_ROOT), ...RUNTIME_FILES];

const ESLINT_STUB = "process.stdout.write('[]\\n');\n";
const TSC_STUB = "process.stdout.write('');\n";
const DETECTOR_STUB =
  "const p = process.argv.slice(2).filter((a) => !a.startsWith('-'));\nconsole.log(JSON.stringify({ scannedFiles: p.length || 1, byRule: { 'catch-return-null': 0, 'empty-catch': 0 } }));\n";
/**
 * The comment-hygiene detector, stubbed the same way — and it MUST be a stub, not a
 * copy: the real tool is `.ts` and imports `src/services/comments/*`, none of which the
 * fixture stages, so copying the tool alone dies at load (measured: 75 arms failed with
 * `ERR_MODULE_NOT_FOUND … comment-hygiene-detector.ts`).
 *
 * The stub echoes the population back exactly (`scannedFiles == askedFiles == argv`), so
 * the leg's equality refusal still works as a testable branch, and it reports zero debt:
 * a fixture that planted comment debt would have to plant the classifier too, and every
 * arm here is about populations and ceilings, not about the rules.
 */
const CH_DETECTOR_STUB =
  "const p = process.argv.slice(2).filter((a) => !a.startsWith('-'));\n" +
  "console.log(JSON.stringify({ schemaVersion: 1, scopeSource: 'explicit paths (caller-supplied)', " +
  'scannedFiles: p.length, askedFiles: p.length, commentLines: 0, deadReferences: 0, narrative: 0 }));\n';

/**
 * A forwarder, not a stub: the fixture's `node_modules/tsx` runs the repository's
 * real tsx with the same argv and the same cwd, so the census that answers the gate
 * is the real census measuring the fixture tree.
 */
function tsxForwarder(): string {
  return [
    "import { spawnSync } from 'node:child_process';",
    `const real = ${JSON.stringify(REAL_TSX)};`,
    'const r = spawnSync(process.execPath, [real, ...process.argv.slice(2)], {',
    '  cwd: process.cwd(),',
    "  stdio: 'inherit',",
    '  windowsHide: true',
    '});',
    'process.exit(r.status ?? 1);',
    ''
  ].join('\n');
}

const PRETTIER_PACKAGE =
  '{"name":"prettier","version":"0.0.0-fixture","type":"module","exports":{".":"./index.mjs"}}\n';

/** The fixture's prettier is the repository's real one, so the verdict is real. */
function prettierShim(): string {
  const real = pathToFileURL(join(REPO_ROOT, 'node_modules', 'prettier', 'index.mjs')).href;
  return `export { default } from '${real}';\nexport * from '${real}';\n`;
}

/** Source whose split-newline count is EXACTLY `lines` (the policy's unit). */
export function fileOf(lines: number): string {
  return `${Array.from({ length: Math.max(lines - 1, 1) }, () => 'x').join('\n')}\n`;
}

/**
 * One hooks-scope file, and the shape of the independent reading. They live in
 * `_file-size-hooks-walk.ts` — this harness is a capped file under `tests/`, and the
 * walk is the one part of the slice that must not sit in the same file as the machinery
 * it cross-measures. Re-exported from here so the arms keep ONE harness import.
 */
export { walkHooksScope, type HooksWalk, type OverCapEntry } from './_file-size-hooks-walk.js';

export type HooksBlock = {
  overCap: number;
  excessLines: number;
  scope: {
    source: string;
    dirs: readonly string[];
    extensions: readonly string[];
    countedFiles: number;
  };
  caps: { hooksCap: number };
  convention: string;
  files: OverCapEntry[];
};

export type FixtureEnvelope = {
  overCap: number;
  excessLines: number;
  scope: { source: string; countedFiles: number; dirs: readonly string[] };
  files: OverCapEntry[];
  hooks: HooksBlock;
};

export type FixtureRun = { code: number; out: string };

export type FixtureArtifact = {
  ceilings: Record<string, number>;
  fileSizePolicyInputs?: Record<string, unknown>;
  fileSizeLineConvention?: string;
  fileSizeHooksLineConvention?: string;
};

const GIT_NEUTRAL = Object.entries({
  'user.name': 'peaks-fixture',
  'user.email': 'peaks-fixture@invalid.invalid',
  'commit.gpgsign': 'false',
  'core.hooksPath': '.git/hooks',
  'core.autocrlf': 'false'
}).flatMap(([key, value]) => ['-c', `${key}=${value}`]);

/**
 * One isolated fixture repository. Instances are independent because vitest runs
 * collected files in parallel, so each file builds its own and removes it in
 * `afterAll`.
 */
export function createFixture(name: string) {
  const root = mkdtempSync(join(tmpdir(), `peaks-${name}-`));
  const artifact = join(root, ARTIFACT_REL);

  const git = (args: readonly string[]): string =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  const write = (rel: string, text: string): string => {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text, 'utf8');
    return abs;
  };
  const read = (rel: string): string => readFileSync(join(root, rel), 'utf8');

  const spawn = (argv: readonly string[]): FixtureRun => {
    const r = spawnSync(process.execPath, argv, {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: MAX_BUFFER
    });
    if (r.error !== undefined) throw r.error;
    return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };

  /**
   * The census with its exit code and both streams, for the arms that need the
   * failure shape: a census that cannot read its scope crashes with NO envelope,
   * and "the row is 0" must never be what that looks like. A local function, not an
   * object method, so `census()` below can call it without naming a fixture object
   * that does not exist yet inside its own literal.
   */
  const censusRaw = (): { status: number; stdout: string; stderr: string } => {
    const r = spawnSync(
      process.execPath,
      [join('node_modules', 'tsx', 'dist', 'cli.mjs'), CENSUS_REL, '--json'],
      { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: MAX_BUFFER }
    );
    if (r.error !== undefined) throw r.error;
    return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };

  const declaredPrettier = (
    JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      prettier: Record<string, unknown>;
    }
  ).prettier;
  write(
    'package.json',
    `${JSON.stringify(
      { name: `peaks-${name}-fixture`, version: '0.0.0', prettier: declaredPrettier },
      null,
      2
    )}\n`
  );
  for (const rel of FIXTURE_COPIED_FILES) copyFileSync(join(REPO_ROOT, rel), write(rel, ''));
  // The fixture's own guards: one hooks-scope file two lines over cap, one under it,
  // and one main-scope file three lines over cap. Every arm derives its expectation
  // from a measurement, so these sizes are never restated downstream.
  write(join('.husky', 'hooks-big.mjs'), fileOf(FILE_SIZE_CAP_HOOKS + 2));
  write(join('.husky', 'hooks-small.mjs'), 'export const small = 1;\n');
  write('src/big-main.ts', fileOf(FILE_SIZE_CAP_DEFAULT + 3));
  write('src/tidy.ts', 'export const tidy = 1;\n');
  write(join('scripts/lint', 'silent-warning-detector.mjs'), DETECTOR_STUB);
  write(join('scripts/lint', 'comment-hygiene-detector.ts'), CH_DETECTOR_STUB);
  write(join('node_modules/eslint/bin', 'eslint.js'), ESLINT_STUB);
  write(join('node_modules/typescript/bin', 'tsc'), TSC_STUB);
  write(join('node_modules/tsx/dist', 'cli.mjs'), tsxForwarder());
  write('node_modules/prettier/package.json', PRETTIER_PACKAGE);
  write('node_modules/prettier/index.mjs', prettierShim());
  git(['init', '-q']);
  git(['add', '-A']);
  git([...GIT_NEUTRAL, 'commit', '-q', '-m', 'fixture: guards, hooks files, no artifact in HEAD']);

  return {
    root,
    artifactPath: artifact,
    cleanup(): void {
      rmSync(root, { recursive: true, force: true });
    },
    read,
    write,
    /** The real gate's file-size leg, in the fixture, against the fixture's ceilings. */
    runGate(args: readonly string[] = []): FixtureRun {
      return spawn([GATE_REL, 'file-size', ...args]);
    },
    /** The real generator, in the fixture. `--seed` opts in where HEAD carries none. */
    runGenerator(args: readonly string[] = []): FixtureRun {
      return spawn([GENERATOR_REL, ...args]);
    },
    /** The real census, in the fixture, spawned the way the leg spawns it. */
    census(): FixtureEnvelope {
      const run = censusRaw();
      // Exit 1 means the census FOUND over-cap files; the envelope is still on
      // stdout — the same shape the leg reads (`peaks-gate-file-size.mjs`).
      if (run.status !== 0 && run.status !== 1) {
        throw new Error(`fixture census exited ${String(run.status)}: ${run.stderr}`);
      }
      return JSON.parse(run.stdout) as FixtureEnvelope;
    },
    censusRaw,
    /** Move the fixture's `.husky` aside and hand it back, for the absent-scope arm. */
    withHooksDirAbsent<T>(body: () => T): T {
      const abs = join(root, '.husky');
      const aside = join(root, '.husky-held-aside');
      renameSync(abs, aside);
      try {
        return body();
      } finally {
        renameSync(aside, abs);
      }
    },
    /** Index and commit whatever is on disk, so the census's scope sees it. */
    commitAll(message: string): void {
      git(['add', '-A']);
      git([...GIT_NEUTRAL, 'commit', '-q', '-m', message]);
    },
    /** Add an over-cap hooks file and index it, the way a growth commit would. */
    addHooksFile(rel: string, lines: number): string {
      const abs = write(join('.husky', rel), fileOf(lines));
      git(['add', '--', join('.husky', rel)]);
      return abs;
    },
    /** Take a hooks file out of the census's scope: unlink, then stage the deletion. */
    removeHooksFile(rel: string): void {
      rmSync(join(root, '.husky', rel), { force: true });
      git(['add', '-A', '--', join('.husky', rel)]);
    },
    /**
     * Unlink a file the census never saw, with no trace in the index. `git add -A`
     * would STAGE it, and a staged file is inside the scope — which is the opposite
     * of what an untracked-scratch arm means to leave behind.
     */
    unlinkHooksFile(rel: string): void {
      rmSync(join(root, '.husky', rel), { force: true });
    },
    /** Add an over-cap main-scope file and index it: the other half of H4. */
    addMainFile(rel: string, lines: number): string {
      const abs = write(rel, fileOf(lines));
      git(['add', '--', rel]);
      return abs;
    },
    /** Take a main-scope file out of the census's scope again. */
    removeMainFile(rel: string): void {
      rmSync(join(root, rel), { force: true });
      git(['add', '-A', '--', rel]);
    },
    /** Grow an existing hooks file by `n` raw lines — one growth event, one row. */
    growHooksFile(rel: string, n: number): void {
      const abs = join(root, '.husky', rel);
      writeFileSync(abs, fileOf(countRawLines(readFileSync(abs, 'utf8')) + n), 'utf8');
    },
    /** Replace the fixture's copy of the policy module (the H5 re-decision arm). */
    patchPolicy(edit: (text: string) => string): void {
      const before = read(POLICY_REL);
      const next = edit(before);
      if (next === before) {
        throw new Error(`the policy patch matched nothing in ${POLICY_REL}`);
      }
      write(POLICY_REL, next);
    },
    /** The policy module's current text, for an arm that has to put it back. */
    policyText(): string {
      return read(POLICY_REL);
    },
    /** Rewrite the artifact in the working copy (drop a row, move a recorded input). */
    writeArtifact(document: Record<string, unknown>): void {
      write(ARTIFACT_REL, `${JSON.stringify(document, null, 2)}\n`);
    },
    /** The WHOLE artifact document, so an arm can change one field and keep the rest. */
    artifactDocument(): Record<string, unknown> {
      return JSON.parse(readFileSync(artifact, 'utf8')) as Record<string, unknown>;
    },
    artifact(): FixtureArtifact {
      return JSON.parse(readFileSync(artifact, 'utf8')) as FixtureArtifact;
    },
    /**
     * The independent walk, over THIS fixture's tree — `walkHooksScope` with the
     * instance's own root, kept as a method so an arm can re-read the same scope the
     * census just read without naming the fixture twice.
     */
    walkHooks(): HooksWalk {
      return walkHooksScope(root);
    },
    /** The fixture's hooks-scope file set by walking, for the membership arm. */
    hooksScopeFiles(): string[] {
      return hooksScopeFilesUnder(root);
    }
  };
}

export type Fixture = ReturnType<typeof createFixture>;

/** The census's spelling of the hooks scope's whole-scope enumeration. */
export const HOOKS_WHOLE_SCOPE_SOURCE = 'git ls-files <hooks dirs>';

/** The published artifact's path — read, never written, by these guards. */
export const PUBLISHED_ARTIFACT = join(REPO_ROOT, '.peaks', 'lint', 'gate-baseline.json');

/**
 * The REAL census, over the REAL tree — the same spawn the real leg makes. Kept apart
 * from `fixture.census()` because the arms that read it are the ones that compare the
 * published artifact, and the two must not share a helper that could be tuned.
 */
export function realCensus(): FixtureEnvelope {
  const r = spawnSync(
    process.execPath,
    [join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), CENSUS_REL, '--json'],
    { cwd: REPO_ROOT, encoding: 'utf8', windowsHide: true, maxBuffer: MAX_BUFFER }
  );
  if (r.error !== undefined) throw r.error;
  if (r.status !== 0 && r.status !== 1) {
    throw new Error(`the repository census exited ${String(r.status)}: ${r.stderr ?? ''}`);
  }
  return JSON.parse(String(r.stdout)) as FixtureEnvelope;
}

/**
 * The two hooks ceilings in the published artifact. They do not exist until the
 * orchestrator's seeding run lands — and this throws rather than defaulting to 0,
 * because a row that reads as "no ceiling" is the state the leg refuses to speak in.
 */
export function publishedHooksCeilings(): { overCap: number; excessLines: number } {
  const ceilings = (
    JSON.parse(readFileSync(PUBLISHED_ARTIFACT, 'utf8')) as { ceilings: Record<string, unknown> }
  ).ceilings;
  const of = (key: string): number => {
    const value = ceilings[key];
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new Error(
        `the published baseline has no integer ceiling at "${key}" — the two hooks rows ` +
          'are seeded by a run of node .husky/peaks-gate-baseline.mjs, which the orchestrator ' +
          'performs at convergence'
      );
    }
    return value;
  };
  return { overCap: of(HOOKS_OVER_CAP_KEY), excessLines: of(HOOKS_EXCESS_KEY) };
}

/** The published main ceilings, which THIS slice may not move. */
export function publishedMainCeilings(): { overCap: number; excessLines: number } {
  const ceilings = (
    JSON.parse(readFileSync(PUBLISHED_ARTIFACT, 'utf8')) as { ceilings: Record<string, unknown> }
  ).ceilings;
  const of = (key: string): number => {
    const value = ceilings[key];
    if (typeof value !== 'number') throw new Error(`no ceiling at "${key}"`);
    return value;
  };
  return { overCap: of(MAIN_OVER_CAP_KEY), excessLines: of(MAIN_EXCESS_KEY) };
}

/** The row the leg prints, read back off its output: mark, actual, ceiling. */
export function rowFor(
  out: string,
  label: string
): { mark: string; actual: number; ceiling: number } {
  const hit = new RegExp(`^\\s+(✓|✗)\\s+${label}\\s+(\\d+)\\s+\\(ceiling (\\d+)\\)`, 'm').exec(out);
  if (hit === null) throw new Error(`no '${label}' row in the leg output:\n${out}`);
  return { mark: hit[1] ?? '?', actual: Number(hit[2]), ceiling: Number(hit[3]) };
}

/** The extension universe, as a mutable-array-free copy for fixture inputs. */
export const SCOPE_EXTENSIONS: readonly string[] = FILE_SIZE_SCOPE_EXTENSIONS;

/**
 * The main scope's four MEASUREMENT-UNIVERSE directories, for arms that name what
 * must NOT move. NO LONGER A COPY (rid `2026-10-03-w10-rescope-a`, item 8): the
 * list comes from the policy module the fixture already imports; the `.mjs`
 * mirror of it (`MEASURED_DIRS` in `.husky/lint-scope.mjs`) is compared to that
 * policy by `tests/unit/lint/lint-scope-rule.test.ts`.
 */
export const MAIN_SCOPE_DIRS = FILE_SIZE_SCOPE_DIRS;
