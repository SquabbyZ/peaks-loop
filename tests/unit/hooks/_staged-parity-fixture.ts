// tests/unit/hooks/_staged-parity-fixture.ts
//
// The scaffolding `staged-parity-gate.test.ts` drives, moved out of it for the tests
// file-size cap (500 raw lines) — the arms themselves stay in the suite, so this file
// holds no assertion about the leg.
//
// WHY THE ARMS DRIVE A REAL REPOSITORY. The defect the leg exists for is "the index and
// the worktree disagree", and the shapes that make that true — a path staged then
// deleted, one added and then removed from disk, one staged as deleted while still on
// disk, a rename, a CRLF file git stores as LF — are all DEFINED BY GIT, not by the
// module. A stub `run()` would pin the module's view of git, which is exactly the belief
// under test.

import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The pure module's shape, declared here: it is plain `.mjs`, and `allowJs` is
 *  off, so a static import would be an untyped TS7016 and would take the repo's
 *  zero-error tsc ceiling with it. */
export type Side =
  | { kind: 'bytes'; oid: string; bytes: Buffer }
  | { kind: 'missing' }
  | { kind: 'uncomparable'; reason: string };
export type Outcome = {
  path: string;
  status: 'parity' | 'divergence' | 'uncomparable';
  detail?: string;
};
export type Decide = {
  EXEMPT_ENV: string;
  compareStagedPath: (path: string, staged: Side, worktree: Side) => Outcome;
  decideStagedParity: (input: {
    outcomes: readonly Outcome[];
    allowToken?: string | undefined;
    scopeNote: string;
  }) => { exitCode: number; lines: string[] };
};

export const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
export const HOOK = join(ROOT, '.husky', 'peaks-gate-staged-parity.mjs');
export const DECIDE_SRC = join(ROOT, '.husky', 'staged-parity', 'decide.mjs');
export const decide = (await import(pathToFileURL(DECIDE_SRC).href)) as Decide;

/** A minimal verdict reader: the exit code plus every line, wherever it printed. */
export type LegRun = { status: number | null; out: string };

const roots: string[] = [];

/** Ask `endTempRoots` to delete this throwaway directory after the test. */
export function tempRoot(path: string): string {
  roots.push(path);
  return path;
}

/** Forget every throwaway directory this module made — the suite calls it per test. */
export function endTempRoots(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}

/**
 * The ambient environment minus the token. Inherited, a stray
 * `PEAKS_ALLOW_STAGED_DIVERGENCE` in the developer's shell would turn every
 * refusal arm green and nobody would notice.
 */
export function cleanEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = { ...process.env };
  delete base[decide.EXEMPT_ENV];
  return { ...base, ...extra };
}

export function runLeg(cwd: string, env: NodeJS.ProcessEnv = {}): LegRun {
  const result = spawnSync(process.execPath, [HOOK], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    env: cleanEnv(env)
  });
  if (result.error) throw result.error;
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

export function mustGit(root: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr ?? ''}`);
  }
  return result.stdout ?? '';
}

export function write(root: string, rel: string, text: string): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

/** A throwaway repo configured the way THIS one is: `core.autocrlf=true` plus the
 *  `.gitattributes` pin. A worktree file written with CRLF is STORED as LF, so its disk
 *  bytes can never equal its staged blob's bytes — while git itself calls the file
 *  clean. A leg that compares raw bytes refuses that tree and can only be escaped by
 *  rewriting the file or by the token, which teaches `--no-verify`. */
export function makeCrlfRepo(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'peaks-staged-parity-crlf-')));
  roots.push(root);
  mustGit(root, ['init', '-q', '.']);
  mustGit(root, ['config', 'user.email', 'test@example.com']);
  mustGit(root, ['config', 'user.name', 'Staged Parity Test']);
  mustGit(root, ['config', 'core.autocrlf', 'true']);
  mustGit(root, ['config', 'commit.gpgsign', 'false']);
  write(root, '.gitattributes', '* text=auto eol=lf\n');
  write(root, 'keep.txt', 'keep\n');
  mustGit(root, ['add', '.']);
  mustGit(root, ['commit', '-qm', 'init']);
  return root;
}

/** A throwaway repo with `core.autocrlf false`, for the arms where the disk bytes and
 *  the blob bytes do happen to agree. */
export function makeRepo(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'peaks-staged-parity-')));
  roots.push(root);
  mustGit(root, ['init', '-q', '.']);
  mustGit(root, ['config', 'user.email', 'test@example.com']);
  mustGit(root, ['config', 'user.name', 'Staged Parity Test']);
  mustGit(root, ['config', 'core.autocrlf', 'false']);
  mustGit(root, ['config', 'commit.gpgsign', 'false']);
  write(root, 'a.txt', 'one\ntwo\n');
  write(root, 'keep.txt', 'keep\n');
  mustGit(root, ['add', '.']);
  mustGit(root, ['commit', '-qm', 'init']);
  return root;
}

/** A staged modification of `a.txt` whose worktree copy drifted afterwards. */
export function stageThenEdit(root: string): void {
  write(root, 'a.txt', 'one\ntwo\nSTAGED\n');
  mustGit(root, ['add', 'a.txt']);
  write(root, 'a.txt', 'one\ntwo\nSTAGED\nAND THE REPAIR\n');
}

/** The bytes git holds for a path in the index, and the bytes on disk. */
export function bothSides(root: string, path: string): { staged: Buffer; worktree: Buffer } {
  const staged = spawnSync('git', ['show', `:${path}`], { cwd: root, windowsHide: true });
  if (staged.status !== 0) throw new Error(`git show :${path} failed`);
  return { staged: staged.stdout, worktree: readFileSync(join(root, path)) };
}

/** Run a SOURCE-MUTATED copy of the leg as the hook, in `cwd`. The hook reaches its
 *  sibling modules through `../.husky/staged-parity/…` — the reason those specifiers are
 *  spelled the long way — so a temp tree shaped `<tmp>/.husky/…` is enough to swap the
 *  module it loads. Every sibling is copied verbatim and the mutated one over its copy: a
 *  mutant tree missing a sibling would fail as a crash, and a crash is not the outcome
 *  the arms using this measure. */
export function runMutantLeg(cwd: string, mutate: (source: string) => string): LegRun {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'peaks-staged-parity-hook-')));
  roots.push(dir);
  mkdirSync(join(dir, '.husky', 'staged-parity'), { recursive: true });
  writeFileSync(join(dir, '.husky', 'peaks-gate-staged-parity.mjs'), readFileSync(HOOK));
  for (const name of readdirSync(dirname(DECIDE_SRC))) {
    writeFileSync(
      join(dir, '.husky', 'staged-parity', name),
      readFileSync(join(dirname(DECIDE_SRC), name))
    );
  }
  const source = readFileSync(DECIDE_SRC, 'utf8');
  const mutated = mutate(source);
  if (mutated === source) throw new Error('the mutation changed nothing, so the arm cannot fail');
  writeFileSync(join(dir, '.husky', 'staged-parity', 'decide.mjs'), mutated);
  const result = spawnSync(
    process.execPath,
    [join(dir, '.husky', 'peaks-gate-staged-parity.mjs')],
    {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      env: cleanEnv()
    }
  );
  if (result.error) throw result.error;
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}
