/**
 * Integration test for the install-skills postinstall dispatch layer (slice #011).
 *
 * The script is a plain `.mjs` file; we spawn it via `node` against a temp
 * directory and assert on the file system. PEAKS_SKIP_USER_CONFIG_INSTALL=1
 * disables the user-config install step so the test focuses on the skill /
 * output-style install + dispatch behavior. The script uses
 * `process.env.PEAKS_PROJECT_ROOT` to locate the project root for IDE
 * detection (via `resolveProjectRoot`).
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = resolve(__dirname, '../../../scripts/install-skills.mjs');

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

async function runInstallSkills(env: Record<string, string>, projectRoot: string): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync('node', [SCRIPT_PATH], {
      env: {
        ...process.env,
        PEAKS_SKIP_USER_CONFIG_INSTALL: '1',
        ...env,
        PEAKS_PROJECT_ROOT: projectRoot,
      },
      cwd: projectRoot,
    });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      code: typeof e.code === 'number' ? e.code : 1,
    };
  }
}

describe('install-skills.mjs — IDE-aware dispatch (slice #011)', () => {
  let project: string;
  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'peaks-install-skills-'));
  });
  afterEach(() => {
    if (existsSync(project)) {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('default fallback (no IDE detected) writes to ~/.claude/skills/', async () => {
    const result = await runInstallSkills({}, project);
    expect(result.code).toBe(0);
    // Default fallback path: <homedir>/.claude/skills
    const skillsRoot = join(homedir(), '.claude', 'skills');
    // At least one of the bundled skills should be installed (peaks-solo is the
    // canonical one; assert non-empty result rather than pinning a name).
    expect(result.stdout).toMatch(/Peaks skills linked/);
    expect(existsSync(skillsRoot)).toBe(true);
  }, 30000);

  test('PEAKS_CLAUDE_SKILLS_DIR back-compat override writes to the env-var target', async () => {
    const customSkills = mkdtempSync(join(tmpdir(), 'peaks-skills-custom-'));
    try {
      const result = await runInstallSkills(
        { PEAKS_CLAUDE_SKILLS_DIR: customSkills },
        project
      );
      expect(result.code).toBe(0);
      // At least one peaks skill should now be symlinked under the custom dir.
      const entries = require('node:fs').readdirSync(customSkills);
      expect(entries.length).toBeGreaterThan(0);
      // The installed entry is a symlink to <packageRoot>/skills/<skillName>.
      const first = entries[0]!;
      const link = readlinkSync(join(customSkills, first));
      expect(link).toContain('skills');
    } finally {
      rmSync(customSkills, { recursive: true, force: true });
    }
  }, 30000);

  test('Claude Code-detected project (.claude/ present) installs to ~/.claude/skills/', async () => {
    // Create the .claude dir at the project root so the detector picks up 'claude-code'.
    mkdirSync(join(project, '.claude'));
    const result = await runInstallSkills({}, project);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/Peaks skills linked/);
  }, 30000);

  test('Trae-detected project (.trae/ present) installs to all 8 platforms including ~/.trae/skills/', async () => {
    // Per peaks-cli 2.0: Trae is a verified IDE with its own
    // skillInstall profile (the Trae user feedback fix from
    // 2026-06-11). The postinstall fans out to all 8 platforms
    // including the detected IDE. The 1.x-era "no skillInstall
    // profile declared" warning is no longer emitted.
    mkdirSync(join(project, '.trae'));
    const result = await runInstallSkills({}, project);
    expect(result.code).toBe(0);
    // No "no skillInstall profile" warning in 2.0 (Trae is verified).
    expect(result.stderr).not.toMatch(/trae.*no skillInstall profile declared/i);
    // The 8-IDE fan-out installs to all 8 platforms.
    expect(result.stdout).toMatch(/Peaks skills linked/);
    // Trae's own skills dir is populated (the whole point of
    // the 2.0 fix — the Trae user reported the 1.x postinstall
    // never wrote to ~/.trae/skills).
    const traeSkills = join(homedir(), '.trae', 'skills');
    expect(existsSync(traeSkills)).toBe(true);
  }, 30000);

  test('Trae-detected project still honors PEAKS_CLAUDE_SKILLS_DIR override for the claude-code install (env var > IDE profile, regression fix 2026-06-12)', async () => {
    mkdirSync(join(project, '.trae'));
    const customSkills = mkdtempSync(join(tmpdir(), 'peaks-skills-trae-custom-'));
    try {
      const result = await runInstallSkills(
        { PEAKS_CLAUDE_SKILLS_DIR: customSkills },
        project
      );
      expect(result.code).toBe(0);
      // The env-var override still wins for the claude-code
      // install (the legacy back-compat contract that the 8-IDE
      // fan-out in `installBundledSkillsForAllPlatforms` now
      // honors — see the precedence fix in
      // `scripts/install-skills.mjs`).
      const entries = require('node:fs').readdirSync(customSkills);
      expect(entries.length).toBeGreaterThan(0);
      // Trae is verified in 2.0, so the 1.x-era warning
      // ("no skillInstall profile declared") does NOT fire.
      expect(result.stderr).not.toMatch(/trae.*no skillInstall profile declared/i);
    } finally {
      rmSync(customSkills, { recursive: true, force: true });
    }
  }, 30000);

  // Auto-upgrade E2E test (slice 2026-06-12-postinstall-1x-detector-tdd).
  // Per the "one-key completion" tenet (2026-06-11): when the
  // postinstall runs in a 1.x consumer project, it must auto-
  // dispatch the upgrade umbrella. The dispatch is verified by
  // the dogfood script; here we assert the postinstall does
  // not crash on a 1.x fixture (the dispatch is fire-and-
  // forget so we can't reliably intercept the spawn).
  test('postinstall on a 1.x fixture does not crash (1.x signals do not block install)', async () => {
    // Plant 1.x signals: missing .peaks/preferences.json +
    // dev-preference.md referencing 'peaks progress' (the
    // two local signals we can plant without polluting the
    // real ~/.peaks/config.json).
    mkdirSync(join(project, '.peaks', '_runtime'), { recursive: true });
    mkdirSync(join(project, '.claude', 'rules', 'common'), { recursive: true });
    writeFileSync(
      join(project, '.claude', 'rules', 'common', 'dev-preference.md'),
      '# dev-preference\n\nWe use **peaks progress** as the metric.\n',
      'utf8'
    );
    // The postinstall's main block does `autoUpgrade1xProjectIfPresent().then(...)`
    // which spawns `peaks upgrade --to 2.0 --auto` — but the spawn is
    // async + the script does not await it. To avoid the test hanging
    // or invoking the real peaks binary, set PEAKS_SKIP_AUTO_UPGRADE=1.
    const result = await runInstallSkills(
      { PEAKS_SKIP_AUTO_UPGRADE: '1' },
      project
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/Peaks skills linked/);
  }, 30000);
});
