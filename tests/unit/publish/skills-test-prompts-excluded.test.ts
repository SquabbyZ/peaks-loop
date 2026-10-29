// tests/unit/publish/skills-test-prompts-excluded.test.ts
//
// WHY. The published tarball is built by `pnpm pack` — `scripts/release-pack.mjs`
// packs every workspace package with pnpm (pnpm rewrites `workspace:*` to exact
// version pins) and then `npm publish`es the resulting `.tgz`. The manifest used
// to say `skills/**` and then subtract two paths with `!`. That subtraction is
// real under npm (npm 11's npm-packlist honours a negation) and INERT under
// pnpm (pnpm 10.11.0 ships npm-packlist 5.1.3, where an include beats a
// negation). Measured on the pre-fix tree:
//
//   npm  pack  -> 2959 files, 1 fixture  (the `test_prompts.json` spelling)
//   pnpm pack  -> 2966 files, 8 fixtures (both spellings)
//
// so the 4.1.24 tarball carried all eight, and the `npm pack --dry-run` list a
// contributor reads to check "what will ship" disagreed with what ships by
// exactly seven files. A fixture is not a secret, but one of them embeds a
// developer's local path, and the published package carried it.
//
// WHAT IS ASSERTED. The ARTIFACT, never the manifest. The real tarball each
// packer produces is packed, listed and inspected:
//
//   1. neither packer's tarball contains a test-prompt fixture;
//   2. every tracked file under `skills/` that is not a fixture IS in the
//      tarball — the exclusion must not have eaten anything else;
//   3. the two packers agree on the `skills/` subtree — the divergence that let
//      the defect hide is itself part of the defect.
//
// WHY NOT ASSERT ON A STRING. `expect(packageJson.files).toContain(...)` is the
// shape that let this through: the manifest could carry the right words and
// the tarball could still carry the files. The only measurement that speaks
// about the tarball is a tarball.
//
// A MISSING PACKER IS A FAILURE, NOT A SKIP. If `pnpm` or `tar` is not on the
// PATH, `execFileSync` throws and this file goes red. A guard that reports
// "allowed" because it ran nothing is worse than no guard.
//
// WINDOWS. Every `execFileSync` here carries `windowsHide: true`: the repo
// convention (enforced by `tests/unit/spawn-windows-hide-guard.test.ts`) is
// that every `child_process` call site hides its console window, because a
// spawn without the flag flashes a blank `cmd.exe` at the user on Windows.
// The four call sites below are the packers, `tar` and `git`.
//
// THE PACKERS ARE NOT SPAWNED BY BARE NAME. A Windows Node install ships
// `npm.cmd` and `pnpm.cmd`, and Node cannot spawn either of them without a
// shell: `execFileSync('npm.cmd', …)` fails EINVAL (Node refuses a batch
// file unless `shell: true`), and the BARE `npm` fails ENOENT, because the
// PATH search does not treat a `.cmd` as a candidate — measured: with only a
// `pnpm.cmd` on PATH, `execFileSync('pnpm', …)` is ENOENT. That is why this
// file was green on a developer machine — an `npm.exe`/`pnpm.exe` shim
// happened to be on PATH there, an artefact of that machine rather than a
// property of the platform — and red on the Windows CI runner.
//
// `shell: true` IS NOT THE REPAIR. The shell re-parses the command line and
// splits any argument containing a space; the pack destination lives under
// the OS temp dir, which on a developer machine is
// `C:\Users\<Name With Space>\AppData\Local\Temp\…`. That is the exact
// failure AC-10 documents in `tests/integration/release-precheck.test.ts`
// (git exited 128 on a `-C <projectRoot>` argument the shell split in two).
// So each packer's own JS entry is resolved and run through the SAME node —
// the shape `src/services/lint/npx-resolver.ts` and
// `scripts/_release-shared.mjs` already use for the shipped artifact.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The node that runs this test — its own installation owns npm and pnpm. */
const nodeBin = process.execPath;

/**
 * How to run a packer: the executable to spawn, plus the arguments that
 * precede the packer's own argv.
 */
type PackerCommand = {
  readonly command: string;
  readonly prefixArgs: readonly string[];
};

/**
 * Resolve the npm CLI on this platform.
 *
 * On POSIX the bare `npm` is a real executable and stays the command. On
 * Windows npm is a `.cmd` shim next to `node.exe`, so npm's own JS entry
 * (`<node>/node_modules/npm/bin/npm-cli.js`) is resolved and run through
 * `process.execPath` — no shell, so no argument is ever re-parsed.
 */
function resolveNpmCommand(): PackerCommand {
  if (process.platform !== 'win32') return { command: 'npm', prefixArgs: [] };
  const cli = [
    join(dirname(nodeBin), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(nodeBin), '..', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ].find((candidate) => existsSync(candidate));
  // No entry found: keep the bare name. It fails loudly (ENOENT) instead of
  // skipping the pack — a guard that reports "allowed" because it ran
  // nothing is worse than no guard.
  if (cli === undefined) return { command: 'npm', prefixArgs: [] };
  return { command: nodeBin, prefixArgs: [cli] };
}

/**
 * Resolve the pnpm CLI on this platform — the same shim bypass as npm, with
 * the two Windows shapes of a pnpm install:
 *
 *   1. installed globally next to node (`npm i -g pnpm`): the JS entry is at
 *      `<node>/node_modules/pnpm/bin/pnpm.{mjs,cjs}`;
 *   2. managed by corepack (`corepack enable` + `corepack prepare`, which is
 *      exactly what `.github/workflows/ci.yml` does): there is NO pnpm
 *      package next to node, and pnpm is reached by running corepack
 *      itself — `node <corepack.js> pnpm …`. corepack resolves the version
 *      from `package.json#packageManager` (`pnpm@10.11.0`), which is the
 *      version CI prepared, so the packer that runs is the pinned one.
 */
function resolvePnpmCommand(): PackerCommand {
  if (process.platform !== 'win32') return { command: 'pnpm', prefixArgs: [] };
  const entry = [
    join(dirname(nodeBin), 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'),
    join(dirname(nodeBin), 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'),
    join(dirname(nodeBin), '..', 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
  ].find((candidate) => existsSync(candidate));
  if (entry !== undefined) return { command: nodeBin, prefixArgs: [entry] };
  const corepack = join(dirname(nodeBin), 'node_modules', 'corepack', 'dist', 'corepack.js');
  if (existsSync(corepack)) return { command: nodeBin, prefixArgs: [corepack, 'pnpm'] };
  return { command: 'pnpm', prefixArgs: [] };
}

/** A fixture is either spelling of the per-skill prompt file. */
const FIXTURE = /test[-_]prompts\.json$/;

/** Pack the tree with `packer` into `dest` and return the tarball path. */
function pack(packer: 'npm' | 'pnpm', dest: string): string {
  if (packer === 'pnpm') {
    const { command, prefixArgs } = resolvePnpmCommand();
    // `pnpm pack` has no `--ignore-scripts` flag; the env var is the way to
    // keep `prepack` (the full build) out of a unit test. The build writes
    // `dist/`, which no assertion here looks at.
    execFileSync(command, [...prefixArgs, 'pack', '--pack-destination', dest], {
      cwd: projectRoot,
      env: { ...process.env, npm_config_ignore_scripts: 'true' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
  } else {
    const { command, prefixArgs } = resolveNpmCommand();
    execFileSync(command, [...prefixArgs, 'pack', '--ignore-scripts', '--pack-destination', dest], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
  }
  const tarballs = readdirSync(dest).filter((name) => name.endsWith('.tgz'));
  const [tarball] = tarballs;
  if (tarballs.length !== 1 || tarball === undefined) {
    throw new Error(`expected exactly one tarball in ${dest}, found ${tarballs.length}`);
  }
  return join(dest, tarball);
}

/**
 * The file list inside a tarball. `tar` is invoked with a RELATIVE name and
 * the tarball's own directory as the working directory: GNU tar misreads a
 * Windows backslash path as a remote-host spec, and an absolute POSIX path
 * is not a Windows path, so a relative name is the one spelling both accept.
 */
function tarballEntries(tarball: string): string[] {
  const listed = execFileSync('tar', ['-tzf', basename(tarball)], {
    cwd: dirname(tarball),
    encoding: 'utf8',
    windowsHide: true
  });
  return listed
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^package\//, ''));
}

/** Every file git tracks under `skills/`. */
function trackedSkillsFiles(): string[] {
  const listed = execFileSync('git', ['ls-files', 'skills'], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  return listed.split(/\r?\n/).filter((line) => line.length > 0);
}

let workDir = '';
let npmEntries: string[] = [];
let pnpmEntries: string[] = [];
let tracked: string[] = [];

describe('Scenario: behavior — the tarball that ships carries no test-prompt fixture', () => {
  beforeAll(() => {
    // given: this working tree, and a scratch directory outside it
    // when: both packers pack it, and both tarballs are listed
    // then: the lists exist — a packer that failed throws before this point
    workDir = mkdtempSync(join(tmpdir(), 'peaks-pack-'));
    npmEntries = tarballEntries(pack('npm', workDir));
    pnpmEntries = tarballEntries(pack('pnpm', workDir));
    tracked = trackedSkillsFiles();
  }, 300_000);

  afterAll(() => {
    if (workDir.length > 0) rmSync(workDir, { recursive: true, force: true });
  });

  it('when pnpm packs the tree, should ship no test-prompt fixture', () => {
    // given: the real tarball `pnpm pack` produces — the one that is published
    // when: its entries are inspected
    // then: not one of them is a test-prompt fixture
    const fixtures = pnpmEntries.filter((entry) => FIXTURE.test(entry));
    expect(fixtures, `test-prompt fixtures in the pnpm tarball:\n${fixtures.join('\n')}`).toEqual(
      []
    );
  });

  it('when npm packs the tree, should ship no test-prompt fixture', () => {
    // given: the real tarball `npm pack` produces — the one contributors inspect
    // when: its entries are inspected
    // then: not one of them is a test-prompt fixture
    const fixtures = npmEntries.filter((entry) => FIXTURE.test(entry));
    expect(fixtures, `test-prompt fixtures in the npm tarball:\n${fixtures.join('\n')}`).toEqual(
      []
    );
  });

  it('when the skills subtree is compared across packers, should be the same set of files', () => {
    // given: the `skills/` entries of both tarballs
    // when: they are compared
    // then: they are identical — the seven-file divergence is what hid the defect
    const npmSkills = npmEntries.filter((entry) => entry.startsWith('skills/')).sort();
    const pnpmSkills = pnpmEntries.filter((entry) => entry.startsWith('skills/')).sort();
    const onlyNpm = npmSkills.filter((entry) => !pnpmSkills.includes(entry));
    const onlyPnpm = pnpmSkills.filter((entry) => !npmSkills.includes(entry));
    expect(
      { onlyNpm, onlyPnpm },
      'npm and pnpm disagree about the published skills/ subtree'
    ).toEqual({ onlyNpm: [], onlyPnpm: [] });
  });

  it('when every tracked skills file is listed, should be in the tarball unless it is a fixture', () => {
    // given: the files git tracks under `skills/`
    // when: they are matched against the published tarball
    // then: everything but the fixtures is there — the exclusion eats nothing else
    const shipped = new Set(pnpmEntries);
    const missing = tracked.filter((file) => !FIXTURE.test(file) && !shipped.has(file));
    expect(
      missing,
      `tracked skills/ files missing from the pnpm tarball:\n${missing.join('\n')}`
    ).toEqual([]);
  });
});

describe('Scenario: behavior — the negations in the manifest remove their targets', () => {
  it('when the manifest names a negated path, should not be in either tarball', () => {
    // given: the negation entries the shipped `package.json#files` carries
    // when: the target of each negation is looked for in both tarballs
    // then: none of them is in either tarball
    const manifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      files: string[];
    };
    const targets = manifest.files
      .filter((entry) => entry.startsWith('!'))
      .map((entry) => entry.slice(entry.lastIndexOf('/') + 1));
    const shipped = [...npmEntries, ...pnpmEntries].map((entry) => basename(entry));
    expect(targets.length, 'the manifest carries no negation to check').toBeGreaterThan(0);
    expect(
      targets.filter((target) => shipped.includes(target)),
      `negated targets present in a tarball: ${targets.join(', ')}`
    ).toEqual([]);
  });

  it('when the skills are listed in the tarball, should still be all of them', () => {
    // given: the `SKILL.md` files git tracks under `skills/`
    // when: the ones in the published tarball are counted
    // then: every one of them is there — the exclusion ate no skill
    const trackedSkills = tracked.filter((file) => file.endsWith('SKILL.md'));
    const shipped = pnpmEntries.filter((entry) => entry.endsWith('SKILL.md'));
    expect(shipped.length, 'the published tarball carries fewer SKILL.md files').toBe(
      trackedSkills.length
    );
    expect(shipped, 'skills/peaks-code/SKILL.md is missing').toContain(
      'skills/peaks-code/SKILL.md'
    );
  });
});
