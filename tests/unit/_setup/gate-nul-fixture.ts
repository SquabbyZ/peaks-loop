// tests/unit/_setup/gate-nul-fixture.ts
//
// THE FIXTURES FOR THE PUSH GATE'S DIFF INPUT FORMAT (`git diff --name-status -z`), extracted so
// the two test files that need them share ONE definition of the paths, the scratch repositories
// and HEAD's parser. They live in `_setup/` because vitest collects only `tests/unit/**/*.test.ts`
// — this module is scaffolding, never a suite.
//
// EVERY STREAM HERE IS REAL `git diff` OUTPUT, never a hand-written string. A hand-written fixture
// encodes the author's BELIEF about the format, and this repository has paid for that belief once
// already (`a-fixture-that-forces-failure-by-file-mode-is-platform-scoped`): a fixture that cannot
// be wrong about the format cannot be right about it either. So `buildPathFixture` commits real
// files, mutates them, and quotes git's own bytes back out — quoted and NUL-separated both, from
// the same diff, which is what makes the quoted form usable as the control.
//
// PLATFORM NOTE, STATED RATHER THAN HIDDEN. A NEWLINE is legal in git's index but not in a Win32
// filename, so `buildNewlineFixture` stages that path from a blob with `core.protectNTFS=false`
// (set in the scratch repository only, never in the operator's config). On a host that refuses
// even that, the fixture THROWS — it does not silently skip, because a skipped arm reads exactly
// like a passing one.

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect } from 'vitest';

import { createScratchGitRepo, type ScratchGitRepo } from './scratch-git-repo.js';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const MODULE_REL = 'scripts/test-changed-classify.mjs';
const MODULE_URL = pathToFileURL(join(REPO_ROOT, MODULE_REL)).href;
const HOOK_ENV_URL = pathToFileURL(join(REPO_ROOT, 'scripts', 'git-hook-env.mjs')).href;

const SCRATCH = mkdtempSync(join(tmpdir(), 'peaks-gate-nul-'));

/** Remove the scratch directory the planted-module copies are written into. */
export function disposeFixtureScratch(): void {
  rmSync(SCRATCH, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// the paths the fixtures put in the diff. Each names the byte class `-z` exists for:
// NON_ASCII_REL carries bytes above ASCII AND a space; NEWLINE_REL carries the one byte no
// line-oriented format can hold. The rest are ordinary, so a failure names a class, not a lump.
// ---------------------------------------------------------------------------

export const NON_ASCII_REL = 'src/services/中文 name.ts';
export const NEWLINE_REL = 'src/services/new\nline.ts';
export const PLAIN_REL = 'src/services/plain.ts';
export const ADDED_REL = 'src/services/added.ts';
export const RENAME_FROM_REL = 'src/alpha/old.ts';
export const RENAME_TO_REL = 'src/beta/new.ts';
export const COPY_FROM_REL = 'src/alpha/copy-source.ts';
export const COPY_TO_REL = 'src/gamma/copy-target.ts';

/** The 3 UTF-8 bytes of `中` followed by the 3 of `文` — what "byte-for-byte" has to mean here. */
export const CJK_BYTES = Buffer.from([0xe4, 0xb8, 0xad, 0xe6, 0x96, 0x87]);

export type Entry = { status?: string; path?: string };
export type ParsedEntry = { status: string; path: string };
export type Plan = {
  mode: 'full' | 'none' | 'subset';
  paths: string[];
  code: string;
  reasons: string[];
};

export type ClassifyModule = {
  STANDARDS_GUARD_PATH: string;
  classifyChanged(entries: readonly Entry[], options?: { baselineContentMoved?: boolean }): Plan;
  parseNameStatus(stdout: string): ParsedEntry[];
};

/** The shipped classifier, through `pathToFileURL` — the `.mjs` carries no `.d.mts` on purpose. */
export async function loadClassifyModule(): Promise<ClassifyModule> {
  return (await import(MODULE_URL)) as ClassifyModule;
}

/**
 * git's hook context is what makes a fixture commit land in the HOST repository, so every fixture
 * here runs under the gate's own scrubber rather than a second copy of the variable list.
 */
export async function scrubbedEnv(): Promise<NodeJS.ProcessEnv> {
  const mod = (await import(HOOK_ENV_URL)) as {
    scrubGitHookEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
  };
  return mod.scrubGitHookEnv({ ...process.env });
}

/**
 * One git command in a fixture. A refusal THROWS — a fixture that did not run must never read as
 * a pass — and `input` carries a blob for the path classes Windows cannot create on disk.
 */
export function gitAt(
  cwd: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  input?: string
): string {
  const res = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env,
    input,
    windowsHide: true
  });
  if (res.error !== undefined && res.error !== null) {
    throw new Error(
      `nul-paths fixture: \`git ${args.join(' ')}\` did not run: ${res.error.message}`
    );
  }
  if (res.status !== 0) {
    throw new Error(
      `nul-paths fixture: \`git ${args.join(' ')}\` failed: ${(res.stderr ?? '').trim()}`
    );
  }
  return res.stdout ?? '';
}

/**
 * HEAD's `parseNameStatus`: the algorithm from the commit this change replaced — tab-separated,
 * one line per record, `core.quotePath` quoting left intact. The ONE difference from that file is
 * `columns[0] ?? ''`, and it cannot fire: the `length < 2` guard above it already rules out the
 * undefined case, so this stays a faithful stand-in on every input either parser can be handed.
 *
 * It is BOTH the control (called directly, to reproduce the quoted path the gate used to hand
 * back) and the plant's replacement text — `toString()` is spliced over the shipped function in
 * `loadPlantedParser` — so the control and the plant cannot end up describing two parsers.
 */
export function preFixParse(stdout: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  for (const line of (stdout ?? '').split(/\r?\n/)) {
    const columns = line.split('\t').filter((column) => column.trim() !== '');
    if (columns.length < 2) continue;
    const status = (columns[0] ?? '').trim().charAt(0).toUpperCase();
    for (const path of columns.slice(1)) entries.push({ status, path: path.trim() });
  }
  return entries;
}

/** The shipped module with `parseNameStatus` swapped for HEAD's. THROWS if the splice missed. */
export async function loadPlantedParser(): Promise<ClassifyModule> {
  const source = readFileSync(join(REPO_ROOT, MODULE_REL), 'utf8');
  const shipped = /export function parseNameStatus\(stdout\) \{[\s\S]*?\n\}/;
  expect(source.match(shipped)?.length, `${MODULE_REL} no longer declares parseNameStatus`).toBe(1);
  const replacement = preFixParse
    .toString()
    .replace('function preFixParse(', 'export function parseNameStatus(');
  const planted = source.replace(shipped, replacement);
  expect(planted, 'the splice must really change the module').not.toBe(source);
  const target = join(mkdtempSync(join(SCRATCH, 'planted-parser-')), 'test-changed-classify.mjs');
  writeFileSync(target, planted, 'utf8');
  return (await import(pathToFileURL(target).href)) as ClassifyModule;
}

// ---------------------------------------------------------------------------
// fixture 1 — every record shape, quoted and NUL-separated, from ONE real diff
// ---------------------------------------------------------------------------

export type PathFixture = {
  repo: ScratchGitRepo;
  nulStdout: string;
  /** The same diff WITHOUT `-z`: the C-quoted feed this change exists to stop handing the gate. */
  quotedStdout: string;
  /** The same diff with `-C --find-copies`, so a real `C100` record is in the feed. */
  copyStdout: string;
};

export async function buildPathFixture(): Promise<PathFixture> {
  const env = await scrubbedEnv();
  const repo = createScratchGitRepo('peaks-nul-paths-');
  const git = (args: readonly string[], input?: string): string =>
    gitAt(repo.path, args, env, input);

  git(['config', 'core.autocrlf', 'false']);
  for (const dir of ['src/services', 'src/alpha']) {
    mkdirSync(join(repo.path, dir), { recursive: true });
  }
  writeFileSync(join(repo.path, NON_ASCII_REL), 'base\n', 'utf8');
  writeFileSync(join(repo.path, PLAIN_REL), 'base\n', 'utf8');
  writeFileSync(join(repo.path, RENAME_FROM_REL), 'export const x = 1;\nexport const y = 2;\n');
  writeFileSync(join(repo.path, COPY_FROM_REL), 'export const copied = 1;\n', 'utf8');
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'nul-paths base']);

  // the mutations, staged so `--cached` — what the runner reads — sees every status letter
  writeFileSync(join(repo.path, NON_ASCII_REL), 'changed\n', 'utf8');
  writeFileSync(join(repo.path, ADDED_REL), 'added\n', 'utf8');
  rmSync(join(repo.path, PLAIN_REL));
  for (const dir of ['src/beta', 'src/gamma']) mkdirSync(join(repo.path, dir), { recursive: true });
  renameSync(join(repo.path, RENAME_FROM_REL), join(repo.path, RENAME_TO_REL));
  // byte-identical to its source, which is what `-C --find-copies` looks for
  copyFileSync(join(repo.path, COPY_FROM_REL), join(repo.path, COPY_TO_REL));
  git(['add', '-A']);

  const nulStdout = git(['diff', '--name-status', '-z', '--cached', 'HEAD']);
  const quotedStdout = git(['diff', '--name-status', '--cached', 'HEAD']);
  const copyStdout = git([
    'diff',
    '-C',
    '--find-copies',
    '--name-status',
    '-z',
    '--cached',
    'HEAD'
  ]);

  // The fixture must be a scratch repo and not the host one: under a git hook, an unscrubbed
  // fixture can commit into the repository it is measuring, and then every number here is a
  // number about the wrong tree.
  const top = git(['rev-parse', '--show-toplevel']).trim();
  expect(resolve(top), 'the fixture must be the scratch repo, not the host').toBe(
    resolve(repo.path)
  );
  return { repo, nulStdout, quotedStdout, copyStdout };
}

// ---------------------------------------------------------------------------
// fixture 2 — the one path class the worktree cannot hold on Windows
// ---------------------------------------------------------------------------

export type NewlineFixture = { stdout: string };

export async function buildNewlineFixture(): Promise<NewlineFixture> {
  const env = await scrubbedEnv();
  const repo = createScratchGitRepo('peaks-nul-newline-');
  try {
    // A newline is legal in git's INDEX; a Win32 filename may not carry a control byte, so the
    // path is staged from a blob instead of written to disk. `protectNTFS=false` is what lets
    // `update-index` accept it — a scratch repo's own config, never the operator's.
    gitAt(repo.path, ['config', 'core.protectNTFS', 'false'], env);
    const blob = gitAt(repo.path, ['hash-object', '-w', '--stdin'], env, 'staged only\n').trim();
    gitAt(
      repo.path,
      ['update-index', '--add', '--cacheinfo', `100644,${blob},${NEWLINE_REL}`],
      env
    );
    return { stdout: gitAt(repo.path, ['diff', '--name-status', '-z', '--cached', 'HEAD'], env) };
  } finally {
    repo.dispose();
  }
}

// ---------------------------------------------------------------------------
// fixture 3 — the gate's own runner, in a scratch repo, driven end to end
// ---------------------------------------------------------------------------

export const STUB_VITEST_MARKER = '[fixture-vitest] spawned';
/** The runner spawns a LOCAL vitest entry; this stub makes that spawn cheap and observable. */
export const STUB_VITEST = `process.stderr.write('${STUB_VITEST_MARKER} ' + process.argv.slice(2).join(' ') + '\\n');\nprocess.exit(0);\n`;

const GATE_SCRIPTS = ['test-changed.mjs', 'test-changed-classify.mjs', 'git-hook-env.mjs'] as const;
/** Both `-z` arguments, spelled as source — the token the call-site plant removes. */
export const RUNNER_Z_ARG = "'--name-status', '-z',";

export type GateFixture = { repo: ScratchGitRepo; env: NodeJS.ProcessEnv };
export type GateRun = { status: number | null; stderr: string };

/**
 * A scratch repository holding the gate's own scripts, one non-ASCII path changed in the WORKTREE,
 * and a stub vitest. `plantHeadCallSites` copies the runner with both `-z` arguments removed, so
 * the call-site half of this change is falsifiable end to end.
 */
export async function buildGateFixture(plantHeadCallSites = false): Promise<GateFixture> {
  const env = await scrubbedEnv();
  const repo = createScratchGitRepo(plantHeadCallSites ? 'peaks-nul-planted-' : 'peaks-nul-e2e-');
  gitAt(repo.path, ['config', 'core.autocrlf', 'false'], env);

  mkdirSync(join(repo.path, 'scripts'), { recursive: true });
  for (const name of GATE_SCRIPTS) {
    const source = readFileSync(join(REPO_ROOT, 'scripts', name), 'utf8');
    const planted =
      plantHeadCallSites && name === 'test-changed.mjs'
        ? source.replaceAll(RUNNER_Z_ARG, "'--name-status',")
        : source;
    if (planted !== source) {
      expect(
        source.match(/'--name-status', '-z',/g)?.length,
        'the plant removes two `-z` arguments; a different count means it is no longer a plant'
      ).toBe(2);
    }
    writeFileSync(join(repo.path, 'scripts', name), planted, 'utf8');
  }

  mkdirSync(join(repo.path, 'node_modules', 'vitest'), { recursive: true });
  writeFileSync(join(repo.path, 'node_modules', 'vitest', 'vitest.mjs'), STUB_VITEST, 'utf8');
  mkdirSync(dirname(join(repo.path, NON_ASCII_REL)), { recursive: true });
  mkdirSync(join(repo.path, 'tests', 'unit', 'services'), { recursive: true });
  writeFileSync(join(repo.path, NON_ASCII_REL), 'before\n', 'utf8');
  writeFileSync(join(repo.path, 'tests/unit/services/x.test.ts'), 'export {};\n', 'utf8');
  gitAt(repo.path, ['add', '-A'], env);
  gitAt(repo.path, ['commit', '--quiet', '-m', 'nul e2e base'], env);

  // the whole change under test: one modified path, above ASCII, in a space-bearing name
  writeFileSync(join(repo.path, NON_ASCII_REL), 'after\n', 'utf8');
  return { repo, env };
}

/** Run the gate's OWN runner in the fixture; return its exit code and everything it printed. */
export function runGate(fixture: GateFixture): GateRun {
  const res = spawnSync(
    process.execPath,
    [join(fixture.repo.path, 'scripts', 'test-changed.mjs'), '--', 'HEAD'],
    {
      cwd: fixture.repo.path,
      env: fixture.env,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 120_000
    }
  );
  if (res.error !== undefined && res.error !== null) {
    throw new Error(`the gate runner did not run: ${res.error.message}`);
  }
  return { status: res.status, stderr: res.stderr ?? '' };
}
