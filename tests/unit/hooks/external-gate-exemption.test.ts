/**
 * Slice emit-gateguard-exemption — Peaks declares its own PreToolUse gate
 * exemption to the THIRD-PARTY gate it does not own.
 *
 * Peaks' intent ("`.peaks/**` is not project source, so 'who imports this /
 * what schema' carries no signal") is already implemented for Peaks' own hooks
 * by slice 2.0.1-bug3. This slice expresses the same intent in the currency an
 * external gate reads: an `env` entry in the machine-local
 * `.claude/settings.local.json`. The external variable name is a third-party
 * detail, so it lives in exactly one adapter table
 * (`EXTERNAL_GATE_EXEMPT_ENV`); these cases pin that, the merge (never
 * clobber) behaviour, idempotency, and the machine-local-only rule.
 *
 * `VENDOR_KEY` is written out here on purpose: a contract test must hard-code
 * the third-party contract it is testing. Pinning "the literal appears exactly
 * once under src/" in the same file is what keeps that from becoming two
 * sources of truth.
 *
 * Style: BDD given/when/then per peaks-loop 4.0.11+ contract.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { withEnv } from '../_setup/io.js';
import {
  EXTERNAL_GATE_EXEMPT_ENV,
  withoutExternalGateExemptions,
  withExternalGateExemptions
} from '~/src/services/skills/hooks-codegate-superpowers';
import {
  applyHookInstall,
  planHookInstall,
  removeHookInstall
} from '~/src/services/skills/hooks-settings-service';
import {
  buildClaudeSettingsLocalJson,
  templateContentMatches
} from '~/src/services/workspace/claude-settings-template';
import { materializeClaudeSettingsLocal } from '~/src/services/workspace/workspace-claude-settings-materializer';

/**
 * The third-party variable the adapter table maps Peaks' workspace-tree
 * concept to. Hard-coded because it is the external contract under test.
 */
const VENDOR_KEY = 'GATEGUARD_EXEMPT_GLOBS';
const PEAKS_WORKSPACE_GLOB = '.peaks/**';
/** An unrelated `env` key a user might have set; must always survive. */
const UNRELATED_ENV_KEY = 'PEAKS_TEST_UNRELATED_ENV';

/** Repo root — this file lives at `<root>/tests/unit/hooks/`. */
const ROOT = join(__dirname, '..', '..', '..');

function readEnvObject(settingsPath: string): Record<string, string> {
  const parsed = JSON.parse(readFileSync(settingsPath, 'utf8')) as { env?: Record<string, string> };
  return parsed.env ?? {};
}

function readSettingsObject(settingsPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('behavior — Peaks declares its external fact-forcing gate exemption', () => {
  const tmpRoots: string[] = [];

  afterEach(() => {
    for (const root of tmpRoots) {
      try {
        if (existsSync(root)) rmSync(root, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
    tmpRoots.length = 0;
  });

  function makeTempProjectRoot(): string {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'peaks-ext-gate-'));
    tmpRoots.push(tmpRoot);
    return tmpRoot;
  }

  function localSettingsPath(projectRoot: string): string {
    return join(projectRoot, '.claude', 'settings.local.json');
  }

  function seedLocalSettings(projectRoot: string, value: unknown): void {
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    writeFileSync(localSettingsPath(projectRoot), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }

  it('when the source tree is scanned, should name the third-party variable exactly once', () => {
    // given: the vendor-specific name is a third-party detail that belongs in
    //        one adapter table, not scattered through the installer
    // when: every TypeScript file under src/ is searched for it
    const hits = listSourceFiles(join(ROOT, 'src'))
      .map((file) => ({ file, count: (readFileSync(file, 'utf8').match(new RegExp(VENDOR_KEY, 'g')) ?? []).length }))
      .filter((entry) => entry.count > 0);
    // then: there is exactly one site, and it is the adapter mapping
    expect(hits).toHaveLength(1);
    expect(hits[0]!.count).toBe(1);
    expect(hits[0]!.file.replaceAll('\\', '/')).toContain('services/skills/hooks-codegate-superpowers.ts');
    expect(EXTERNAL_GATE_EXEMPT_ENV[VENDOR_KEY]).toBe(PEAKS_WORKSPACE_GLOB);
  });

  it('when hooks install runs, should write the exemption to the machine-local file only', () => {
    // given: a fresh project root
    const tmpRoot = makeTempProjectRoot();
    // when: the peaks hooks are installed
    applyHookInstall('project', tmpRoot, { ide: 'claude-code' });
    // then: the entry lands in the gitignored local file …
    expect(readEnvObject(localSettingsPath(tmpRoot))[VENDOR_KEY]).toBe(PEAKS_WORKSPACE_GLOB);
    // … and the COMMITTED shared settings carry no third-party variable at all
    // (an `env` entry there would be pushed to every consumer of the project)
    expect(readSettingsObject(join(tmpRoot, '.claude', 'settings.json'))).not.toHaveProperty('env');
  });

  it('when the machine-local env already declares other trees, should union and preserve', () => {
    // given: a project whose settings.local.json was hand-edited — one of our
    //        variable plus an unrelated env key
    const tmpRoot = makeTempProjectRoot();
    seedLocalSettings(tmpRoot, { env: { [VENDOR_KEY]: 'tests/**', [UNRELATED_ENV_KEY]: 'keep-me' } });
    // when: the install runs
    applyHookInstall('project', tmpRoot, { ide: 'claude-code' });
    // then: the existing glob is EXTENDED (not replaced) and the unrelated
    //       env key survives untouched
    const env = readEnvObject(localSettingsPath(tmpRoot));
    expect(env[VENDOR_KEY]).toBe(`tests/**,${PEAKS_WORKSPACE_GLOB}`);
    expect(env[UNRELATED_ENV_KEY]).toBe('keep-me');
  });

  it('when hooks install runs twice, should not rewrite the file or churn its mtime', () => {
    // given: a project with the hooks already installed
    const tmpRoot = makeTempProjectRoot();
    const first = applyHookInstall('project', tmpRoot, { ide: 'claude-code' });
    const before = readFileSync(localSettingsPath(tmpRoot));
    const beforeMtime = statSync(localSettingsPath(tmpRoot)).mtimeMs;
    // when: the install is run again
    const second = applyHookInstall('project', tmpRoot, { ide: 'claude-code' });
    // then: the second pass reports nothing to do, leaves the bytes identical
    //       and does not touch the file (mtime unchanged)
    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(second.alreadyInstalled).toBe(true);
    expect(readFileSync(localSettingsPath(tmpRoot)).equals(before)).toBe(true);
    expect(statSync(localSettingsPath(tmpRoot)).mtimeMs).toBe(beforeMtime);
  });

  it('when an older-release install is present, should treat the missing exemption as not installed', () => {
    // given: a project whose hooks are on disk but whose env predates this
    //        slice (the upgrade path — a presence-only check would skip it)
    const tmpRoot = makeTempProjectRoot();
    applyHookInstall('project', tmpRoot, { ide: 'claude-code' });
    const settings = readSettingsObject(localSettingsPath(tmpRoot));
    delete settings.env;
    writeFileSync(localSettingsPath(tmpRoot), `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    // when: the install is planned and then run
    const plan = planHookInstall('project', tmpRoot, { ide: 'claude-code' });
    const result = applyHookInstall('project', tmpRoot, { ide: 'claude-code' });
    // then: both agree the file is incomplete, and the run repairs it
    expect(plan.alreadyInstalled).toBe(false);
    expect(result.applied).toBe(true);
    expect(readEnvObject(localSettingsPath(tmpRoot))[VENDOR_KEY]).toBe(PEAKS_WORKSPACE_GLOB);
  });

  it('when the exemption is written, should be visible to a spawned process', () => {
    // given: a project whose machine-local file the installer wrote
    const tmpRoot = makeTempProjectRoot();
    applyHookInstall('project', tmpRoot, { ide: 'claude-code' });
    const writtenEnv = readEnvObject(localSettingsPath(tmpRoot));
    // when: a child process is spawned with that file's env block applied —
    //        the variable is deleted from the parent env first, so the child
    //        can only have learned it from the file
    const base: NodeJS.ProcessEnv = { ...process.env };
    delete base[VENDOR_KEY];
    const child = spawnSync(process.execPath, ['-e', `process.stdout.write(String(process.env.${VENDOR_KEY}))`], {
      env: { ...base, ...writtenEnv },
      encoding: 'utf8'
    });
    // then: the subprocess reads the glob — the environment, not the file
    expect(child.status).toBe(0);
    expect(child.stdout).toBe(PEAKS_WORKSPACE_GLOB);
  });

  it('when hooks uninstall runs, should strip our glob and leave the user’s env intact', () => {
    // given: a project with the install applied over a hand-edited env
    const tmpRoot = makeTempProjectRoot();
    seedLocalSettings(tmpRoot, { env: { [VENDOR_KEY]: 'tests/**', [UNRELATED_ENV_KEY]: 'keep-me' } });
    applyHookInstall('project', tmpRoot, { ide: 'claude-code' });
    // when: the hooks are uninstalled
    removeHookInstall('project', tmpRoot, { ide: 'claude-code' });
    // then: exactly our glob is gone; the user's glob and key remain
    const env = readEnvObject(localSettingsPath(tmpRoot));
    expect(env[VENDOR_KEY]).toBe('tests/**');
    expect(env[UNRELATED_ENV_KEY]).toBe('keep-me');
  });

  it('when the last exemption is uninstalled, should drop the key and the env object', () => {
    // given: a project where our glob is the only env entry
    const tmpRoot = makeTempProjectRoot();
    applyHookInstall('project', tmpRoot, { ide: 'claude-code' });
    // when: the hooks are uninstalled
    removeHookInstall('project', tmpRoot, { ide: 'claude-code' });
    // then: no orphan field is left behind
    expect(readSettingsObject(localSettingsPath(tmpRoot))).not.toHaveProperty('env');
  });

  it('when the global install runs, should write the exemption to the user-level file', () => {
    // given: a throwaway HOME (the user-level settings file is machine-local
    //        by nature — it is never committed, so it is a safe target)
    const home = makeTempProjectRoot();
    withEnv('USERPROFILE', home);
    withEnv('HOME', home);
    // when: the global install runs
    applyHookInstall('global', undefined, { ide: 'claude-code' });
    // then: the entry is present at the user level, with no machine-local
    //       sibling involved
    expect(readEnvObject(join(home, '.claude', 'settings.json'))[VENDOR_KEY]).toBe(PEAKS_WORKSPACE_GLOB);
  });

  it('when the IDE is not Claude Code, should not write the third-party variable', () => {
    // given: a project using an IDE whose settings schema has no `env` key and
    //        whose hook surface the external Claude Code plugin never sees
    const tmpRoot = makeTempProjectRoot();
    // when: the hooks are installed for that IDE
    applyHookInstall('project', tmpRoot, { ide: 'trae' });
    // then: the third-party name is not propagated there
    expect(readSettingsObject(join(tmpRoot, '.trae', 'settings.json'))).not.toHaveProperty('env');
  });

  it('when the workspace-init template is built, should declare the exemption itself', () => {
    // given/when: the template that `peaks workspace init` materializes
    const template = buildClaudeSettingsLocalJson();
    // then: it carries the same row the installer merges, so the file's two
    //       writers cannot disagree
    expect(template.env[VENDOR_KEY]).toBe(PEAKS_WORKSPACE_GLOB);
  });

  it('when an older-release local file is refreshed, should add the exemption and converge', async () => {
    // given: a project whose local file has current hooks but predates the
    //        exemption (written by a release before this slice)
    const tmpRoot = makeTempProjectRoot();
    const { env: _omitted, ...preFeatureTemplate } = buildClaudeSettingsLocalJson();
    seedLocalSettings(tmpRoot, preFeatureTemplate);
    // when: `peaks workspace init` materializes the template
    const refreshed = await materializeClaudeSettingsLocal(tmpRoot, false);
    // then: the refresh adds the entry, and the next init has nothing to do
    expect(refreshed.action).toBe('refreshed');
    expect(readEnvObject(localSettingsPath(tmpRoot))[VENDOR_KEY]).toBe(PEAKS_WORKSPACE_GLOB);
    const second = await materializeClaudeSettingsLocal(tmpRoot, false);
    expect(second.action).toBe('already-current');
  });

  it('when a workspace-init refresh runs, should preserve the user’s own exemption globs', async () => {
    // given: a project whose local file declares an extra tree, plus hooks
    //        that have drifted from the current template (which is what makes
    //        the materializer rewrite at all)
    const tmpRoot = makeTempProjectRoot();
    const drifted = buildClaudeSettingsLocalJson();
    drifted.hooks.PreToolUse.push({
      matcher: 'Bash',
      hooks: [{ type: 'command', command: 'echo user-added' }]
    });
    drifted.env[VENDOR_KEY] = `tests/**,${PEAKS_WORKSPACE_GLOB}`;
    seedLocalSettings(tmpRoot, drifted);
    // when: the materializer refreshes the file
    const result = await materializeClaudeSettingsLocal(tmpRoot, false);
    // then: the refresh drops the drifted hook but NOT the user's exemption
    expect(result.action).toBe('refreshed');
    expect(readEnvObject(localSettingsPath(tmpRoot))[VENDOR_KEY]).toBe(`tests/**,${PEAKS_WORKSPACE_GLOB}`);
  });

  it('when the template comparator runs, should accept a superset env and reject a missing one', () => {
    // given: the serialized template, and an on-disk copy whose env declares
    //        one extra tree
    const generated = `${JSON.stringify(buildClaudeSettingsLocalJson(), null, 2)}\n`;
    const superset = buildClaudeSettingsLocalJson();
    superset.env[VENDOR_KEY] = `tests/**,${PEAKS_WORKSPACE_GLOB}`;
    // when/then: a superset is "already current" (no churn), a missing row is not
    expect(templateContentMatches(generated, JSON.stringify(superset))).toBe(true);
    const { env: _omitted, ...missing } = buildClaudeSettingsLocalJson();
    expect(templateContentMatches(generated, JSON.stringify(missing))).toBe(false);
  });

  it('when the pure merge helpers run, should be idempotent and side-effect free', () => {
    // given: a settings object with an unrelated env key
    const input: Record<string, unknown> = { env: { [UNRELATED_ENV_KEY]: 'keep-me' } };
    // when: the union is applied twice
    const once = withExternalGateExemptions(input);
    const twice = withExternalGateExemptions(once);
    // then: the second pass returns the SAME object (nothing to add) and the
    //       input was never mutated
    expect(twice).toBe(once);
    expect(input).toEqual({ env: { [UNRELATED_ENV_KEY]: 'keep-me' } });
    expect(once.env).toEqual({ [UNRELATED_ENV_KEY]: 'keep-me', [VENDOR_KEY]: PEAKS_WORKSPACE_GLOB });
    // and the inverse returns the original shape
    expect(withoutExternalGateExemptions(once)).toEqual({ env: { [UNRELATED_ENV_KEY]: 'keep-me' } });
  });
});
