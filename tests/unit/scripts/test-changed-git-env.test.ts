/**
 * The push gate's suite must not inherit git's hook context.
 *
 * Rid `2026-10-05-prepush-git-env-leak`. `.husky/pre-push` runs `pnpm test:changed`, whose
 * trigger list sends this repo to the FULL unit suite; git exports `GIT_DIR` to every hook,
 * and dozens of tests build a scratch repo with `git init` in a temp dir and commit into it.
 * With `GIT_DIR` pointing at the host repository those commits land in the host: measured on
 * one pre-push run, 233 arms red across 50 files (the identical suite outside the hook: 0
 * red) and 169 commits titled `fixture` / `baseline` / `init` written onto the branch.
 * Exporting `GIT_DIR` alone takes `tests/unit/services/scan/file-size-scan.test.ts` from
 * 19/19 passed to 18 failed — that is the mechanism, at the size of one file.
 *
 * Dimensions:
 *   - behavior:    the scrub removes exactly the variables that relocate git's context,
 *                  and does not mutate the caller's env (the runner still needs it)
 *   - integration: the scrub is what the SUITE's child process actually receives, proven by
 *                  spawning a real child, and by reading the runner's source so the wiring
 *                  cannot be deleted while these arms keep passing
 *   - a11y:        omitted — this module prints nothing; the human-facing symptom was 233
 *                  false test failures, and the fix's evidence is the arms below
 *   - render:      omitted — no output shape
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/scripts/test-changed-git-env.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'a11y', reason: 'the module prints nothing; the symptom was false test failures' },
    { dim: 'render', reason: 'no output shape of its own' }
  ]
);

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const MODULE_URL = pathToFileURL(join(REPO_ROOT, 'scripts', 'git-hook-env.mjs')).href;
const RUNNER_REL = join('scripts', 'test-changed.mjs');

type GitHookEnvModule = {
  GIT_CONTEXT_VARS: readonly string[];
  scrubGitHookEnv(env?: Record<string, string | undefined>): Record<string, string | undefined>;
};

async function loadModule(): Promise<GitHookEnvModule> {
  return (await import(MODULE_URL)) as GitHookEnvModule;
}

/** A host environment with git's hook context injected, as a hook would see it. */
function hookEnv(): Record<string, string | undefined> {
  return {
    PATH: '/usr/bin',
    NODE_ENV: 'test',
    GIT_DIR: '/repo/.git/worktrees/peaks-loop',
    GIT_WORK_TREE: '/repo',
    GIT_INDEX_FILE: '/repo/.git/worktrees/peaks-loop/index',
    GIT_OBJECT_DIRECTORY: '/repo/.git/objects',
    GIT_COMMON_DIR: '/repo/.git',
    GIT_PREFIX: '',
    GIT_QUARANTINE_PATH: '/repo/.git/objects/quarantine',
    GIT_NAMESPACE: 'refs/ns',
    GIT_ALTERNATE_OBJECT_DIRECTORIES: '/repo/alternates',
    GIT_TRACE: '1'
  };
}

describe('Scenario: behavior — the scrub takes git away from the child, not the caller', () => {
  it('removes every variable that relocates git context, and keeps the rest', async () => {
    const mod = await loadModule();
    const scrubbed = mod.scrubGitHookEnv(hookEnv());
    for (const name of mod.GIT_CONTEXT_VARS) {
      expect(scrubbed[name], `${name} must not reach the suite`).toBeUndefined();
    }
    expect(scrubbed.PATH).toBe('/usr/bin');
    expect(scrubbed.NODE_ENV).toBe('test');
    // Not a blanket `GIT_*` wipe: `GIT_TRACE` is a user's own setting, and deleting
    // variables nobody asked about is how a fix makes the hooked run differ from a manual
    // one in a NEW way while solving the old way.
    expect(scrubbed.GIT_TRACE, 'GIT_TRACE is not git context — leave the operator alone').toBe('1');
  });

  it('does not mutate the env it is handed, because the runner still needs its own context', async () => {
    const mod = await loadModule();
    const source = hookEnv();
    mod.scrubGitHookEnv(source);
    expect(source.GIT_DIR, 'process.env-style mutation would break the runner own git calls').toBe(
      '/repo/.git/worktrees/peaks-loop'
    );
    expect(mod.scrubGitHookEnv(source)).not.toBe(source);
  });

  it('is one list in one module: the runner restates no variable name itself', async () => {
    const mod = await loadModule();
    expect(
      mod.GIT_CONTEXT_VARS.length,
      'a 2-item list would not cover a hook env'
    ).toBeGreaterThanOrEqual(6);
    expect(mod.GIT_CONTEXT_VARS).toContain('GIT_DIR');
    expect(mod.GIT_CONTEXT_VARS).toContain('GIT_INDEX_FILE');
    const source = readFileSync(join(REPO_ROOT, RUNNER_REL), 'utf8');
    for (const name of mod.GIT_CONTEXT_VARS) {
      expect(
        source.includes(`'${name}'`),
        `${RUNNER_REL} carries a second copy of ${name} — two lists, one drift`
      ).toBe(false);
    }
  });
});

describe('Scenario: integration — a real child process is what the gate spawns', () => {
  it('a child spawned with the scrubbed env reports no GIT_DIR, while its cwd still finds the repo', async () => {
    const mod = await loadModule();
    const probe = 'process.stdout.write(process.env.GIT_DIR === undefined ? "clean" : "leaked")';
    const withHook = spawnSync(process.execPath, ['-e', probe], {
      env: { ...process.env, GIT_DIR: resolve(REPO_ROOT, '.git') },
      encoding: 'utf8',
      windowsHide: true
    });
    expect(withHook.stdout, 'the probe must see the leak this file exists to stop').toBe('leaked');
    const scrubbed = spawnSync(process.execPath, ['-e', probe], {
      env: mod.scrubGitHookEnv({ ...process.env, GIT_DIR: resolve(REPO_ROOT, '.git') }),
      encoding: 'utf8',
      windowsHide: true
    });
    expect(scrubbed.stdout).toBe('clean');
  });

  it('the runner wires the scrub into the spawn that runs the suite, not just into the module', async () => {
    const source = readFileSync(join(REPO_ROOT, RUNNER_REL), 'utf8');
    expect(
      source.includes('./git-hook-env.mjs'),
      `${RUNNER_REL} no longer imports the scrubber — the gate is leaking again`
    ).toBe(true);
    // Every `spawn(` (the suite's path) must hand over the scrubbed env. `spawnSync(` is
    // the runner's OWN git calls, which must keep the context — so the guard is scoped to
    // the spawn that runs tests, and refuses to pass when the wiring is deleted.
    const spawnBlocks = source.match(/spawn\(cmd, args, \{[\s\S]{0,240}?\}\);/g) ?? [];
    expect(spawnBlocks.length, 'no suite spawn matches this pattern — the guard is vacuous').toBe(
      1
    );
    for (const block of spawnBlocks) {
      expect(
        block.includes('env: suiteEnv()'),
        `the suite spawn would inherit git's hook context:\n${block}`
      ).toBe(true);
    }
  });
});
