// tests/unit/ide/install-skills-postinstall-convergence.test.ts
//
// S6 (2026-09-15) — D9 / D10 / D11 / D12: the postinstall stops guessing which
// tools the user has.
//
// WHAT WAS WRONG (diagnosis 3.20):
//   D9  — `install-skills.mjs` ran `mkdirSync(targetRoot, {recursive:true})`
//         for ALL 10 profiles, so `npm i -g peaks-loop` created `~/.hermes`,
//         `~/.openclaw`, `~/.qoder`, `~/.tongyi-lingma` and `~/.zcode` in the
//         home of a user who has never installed those tools. Measured
//         before/after against a throwaway $HOME: 10 directories → 1.
//   D10 — three different dispatch strategies in one file (skills fan out to
//         every present platform, agents to the present ones that also declare
//         `agentsDir`, output styles to the ONE auto-detected IDE). Now written
//         down next to the strategies themselves.
//   D11 — `installProjectConfig` was dead: defined, exported, zero call sites.
//   D12 — `hermes` and `openclaw` had install profiles but no entry in
//         `IDE_DETECTION_DIRS`, so nothing could ever detect them.
//
// HOW THIS FILE AVOIDS TOUCHING THE REAL $HOME. The profiles are derived from
// `homedir()` at MODULE LOAD, so a static import would bake in the developer's
// real home — and this suite would then create and read real `~/.trae`,
// `~/.hermes`, … on every machine that ran it. Instead `$HOME` is repointed at
// a throwaway directory at COLLECTION time and the module is imported once, at
// top level, AFTER that. `beforeEach` then empties the throwaway home so each
// case starts from "the user has no tools", and the real environment is
// restored in `afterAll`.
//
// Dimensions covered:
//   - behavior:    which platforms get a directory, and which do not
//   - integration: the real module against a real (throwaway-home) filesystem
//   - render:      OMITTED — a build script; its user-visible output is the
//                  postinstall stdout, not exercised here
//   - a11y:        OMITTED — no human-facing text

import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../_setup/tmp-workspace.js';

declareDimensions(
  'tests/unit/ide/install-skills-postinstall-convergence.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'build script; postinstall stdout is not asserted here' },
    { dim: 'a11y', reason: 'no human-facing text' },
  ],
);

const FAKE_HOME = mkdtempSync(join(tmpdir(), 'peaks-fake-home-'));
const previousUserProfile = process.env.USERPROFILE;
const previousHome = process.env.HOME;
process.env.USERPROFILE = FAKE_HOME;
process.env.HOME = FAKE_HOME;

afterAll(() => {
  if (previousUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = previousUserProfile;
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  rmSync(FAKE_HOME, { recursive: true, force: true });
});

/** Tool homes this file may create inside the throwaway home. */
const TOOL_HOME_DIRS = ['.claude', '.trae', '.trae-cn', '.codex', '.cursor', '.qoder', '.tongyi-lingma', '.zcode', '.hermes', '.openclaw'];

beforeEach(() => {
  for (const dir of TOOL_HOME_DIRS) {
    rmSync(join(FAKE_HOME, dir), { recursive: true, force: true });
  }
});

const mod = (await import('../../../scripts/install-skills.mjs')) as unknown as {
  IDE_DETECTION_DIRS: ReadonlyArray<{ id: string; dir: string }>;
  IDE_SKILL_INSTALL_PROFILES: Record<string, { skillsDir: string; agentsDir?: string }>;
  installBundledSkills: (options: Record<string, unknown>) => { installed: string[] };
  installBundledSkillsForAllPlatforms: (options?: Record<string, unknown>) => Array<{ ideId: string }>;
  installBundledAgentsForAllPlatforms: (options?: Record<string, unknown>) => Array<{ ideId: string }>;
};

const getWs = withTmpWorkspacePerTest('peaks-postinstall-');

/** A project root with no IDE marker directories of its own. */
function bareProject(root: string): string {
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  return project;
}

describe('Scenario: behavior — postinstall platform selection', () => {
  it('D12: every install profile has a detection entry, so detection and installation agree', () => {
    const detectionIds = new Set(mod.IDE_DETECTION_DIRS.map((entry) => entry.id));
    const orphans = Object.keys(mod.IDE_SKILL_INSTALL_PROFILES).filter((ideId) => !detectionIds.has(ideId));
    // Before the fix this was exactly ['hermes', 'openclaw']: reachable only by
    // the every-platform fan-out, i.e. installed for users who do not have the
    // tool and detectable for nobody.
    expect(orphans).toEqual([]);
  });

  it('D11: `installProjectConfig` is gone — no dead export left behind', () => {
    expect('installProjectConfig' in (mod as unknown as Record<string, unknown>)).toBe(false);
  });

  it('D9: with NO detected IDE and an empty $HOME, only claude-code is installed for', () => {
    const ws = getWs();
    const perPlatform = mod.installBundledSkillsForAllPlatforms({ projectRoot: bareProject(ws.path) });
    expect(perPlatform.map((p) => p.ideId)).toEqual(['claude-code']);
    // The point of D9, stated as a filesystem fact: the other nine tool homes
    // were NOT created.
    for (const dir of TOOL_HOME_DIRS.filter((d) => d !== '.claude')) {
      expect(existsSync(join(FAKE_HOME, dir))).toBe(false);
    }
    expect(existsSync(join(FAKE_HOME, '.claude', 'skills'))).toBe(true);
  });

  it('D9: a tool present in the PROJECT is still installed for (the 2026-06-11 Trae fix holds)', () => {
    const ws = getWs();
    const project = bareProject(ws.path);
    mkdirSync(join(project, '.trae'), { recursive: true });

    const ids = mod.installBundledSkillsForAllPlatforms({ projectRoot: project }).map((p) => p.ideId).sort();
    expect(ids).toEqual(['claude-code', 'trae']);
    expect(existsSync(join(FAKE_HOME, '.trae', 'skills'))).toBe(true);
  });

  it('D9: a tool present only via its HOME directory is also installed for', () => {
    const ws = getWs();
    mkdirSync(join(FAKE_HOME, '.hermes'), { recursive: true });

    const ids = mod
      .installBundledSkillsForAllPlatforms({ projectRoot: bareProject(ws.path) })
      .map((p) => p.ideId)
      .sort();
    expect(ids).toEqual(['claude-code', 'hermes']);
    expect(existsSync(join(FAKE_HOME, '.openclaw'))).toBe(false);
  });

  it('D9: the agent fan-out is gated by presence too, and still intersected with `agentsDir`', () => {
    const ws = getWs();
    const project = bareProject(ws.path);
    mkdirSync(join(project, '.trae'), { recursive: true });
    mkdirSync(join(project, '.qoder'), { recursive: true });

    const ids = mod.installBundledAgentsForAllPlatforms({ projectRoot: project }).map((p) => p.ideId).sort();
    // qoder is present but declares no sub-agent loader, so it is absent;
    // nothing that is NOT present appears at all.
    expect(ids).toEqual(['claude-code', 'trae']);
    expect(existsSync(join(FAKE_HOME, '.qoder'))).toBe(false);
  });

  it('D9: an explicit target/ideId still bypasses the presence gate (1.x env-var back-compat)', () => {
    const ws = getWs();
    const target = join(ws.path, 'explicit-skills');

    // `qoder` is neither detected in a project nor present in $HOME, but an
    // explicit target is a caller telling us which platform it means — the
    // contract `PEAKS_*_SKILLS_DIR` and the integration suite depend on.
    const direct = mod.installBundledSkills({ ideId: 'qoder', targetRoot: target });
    expect(direct.installed.length).toBeGreaterThan(0);
    expect(existsSync(target)).toBe(true);
  });
});
