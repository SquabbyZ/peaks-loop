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
import { existsSync, mkdirSync, mkdtempSync, readlinkSync, rmSync } from 'node:fs';
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

  test('Trae-detected project (.trae/ present) emits stderr fallback warning + still installs to ~/.claude/skills/', async () => {
    // Create the .trae dir at the project root so the detector picks up 'trae'.
    mkdirSync(join(project, '.trae'));
    const result = await runInstallSkills({}, project);
    expect(result.code).toBe(0);
    // The fallback warning surfaces the UNVERIFIED status.
    expect(result.stderr).toMatch(/trae.*no skillInstall profile declared/i);
    // Despite the fallback, the script still installs (legacy Claude Code path).
    expect(result.stdout).toMatch(/Peaks skills linked/);
  }, 30000);

  test('Trae-detected project still honors PEAKS_CLAUDE_SKILLS_DIR override (env var > IDE profile)', async () => {
    mkdirSync(join(project, '.trae'));
    const customSkills = mkdtempSync(join(tmpdir(), 'peaks-skills-trae-custom-'));
    try {
      const result = await runInstallSkills(
        { PEAKS_CLAUDE_SKILLS_DIR: customSkills },
        project
      );
      expect(result.code).toBe(0);
      // The env-var override still wins (legacy back-compat contract).
      const entries = require('node:fs').readdirSync(customSkills);
      expect(entries.length).toBeGreaterThan(0);
      // The fallback warning still surfaces (Trae has no profile declared).
      expect(result.stderr).toMatch(/trae.*no skillInstall profile declared/i);
    } finally {
      rmSync(customSkills, { recursive: true, force: true });
    }
  }, 30000);
});
