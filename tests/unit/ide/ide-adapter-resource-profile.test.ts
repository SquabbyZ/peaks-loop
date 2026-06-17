import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { CLAUDE_CODE_ADAPTER } from '../../../src/services/ide/adapters/claude-code-adapter.js';
import { TRAE_ADAPTER } from '../../../src/services/ide/adapters/trae-adapter.js';
import {
  _resetAdaptersForTesting,
  listAdapterIds
} from '../../../src/services/ide/ide-registry.js';
import {
  detectAllResourceTargets,
  getSkillInstall,
  getStandardsProfile
} from '../../../src/services/ide/resource-profile.js';

afterEach(() => {
  _resetAdaptersForTesting();
});

describe('CLAUDE_CODE_ADAPTER — standardsProfile (slice #011)', () => {
  test('declares the Claude Code standards profile matching the legacy hardcoded path', () => {
    expect(CLAUDE_CODE_ADAPTER.standardsProfile).toBeDefined();
    expect(CLAUDE_CODE_ADAPTER.standardsProfile?.rootFile).toBe('CLAUDE.md');
    expect(CLAUDE_CODE_ADAPTER.standardsProfile?.rulesDir).toBe('.claude/rules');
    expect(CLAUDE_CODE_ADAPTER.standardsProfile?.rulesFileGlob).toBe('**/*.md');
    expect(CLAUDE_CODE_ADAPTER.standardsProfile?.autoLoaded).toBe(true);
    expect(CLAUDE_CODE_ADAPTER.standardsProfile?.format).toBe('markdown');
  });

  test('migrationHint is human-readable', () => {
    expect(CLAUDE_CODE_ADAPTER.standardsProfile?.migrationHint).toMatch(/CLAUDE\.md/);
    expect(CLAUDE_CODE_ADAPTER.standardsProfile?.migrationHint).toMatch(/\.claude\/rules/);
  });
});

describe('CLAUDE_CODE_ADAPTER — skillInstall (slice #011)', () => {
  test('declares the Claude Code skill install profile matching the legacy hardcoded path', () => {
    expect(CLAUDE_CODE_ADAPTER.skillInstall).toBeDefined();
    expect(CLAUDE_CODE_ADAPTER.skillInstall?.skillsDir).toBe(join(homedir(), '.claude', 'skills'));
    expect(CLAUDE_CODE_ADAPTER.skillInstall?.outputStylesDir).toBe(join(homedir(), '.claude', 'output-styles'));
    expect(CLAUDE_CODE_ADAPTER.skillInstall?.installStrategy).toBe('symlink');
    expect(CLAUDE_CODE_ADAPTER.skillInstall?.envVarOverride).toBe('PEAKS_CLAUDE_SKILLS_DIR');
  });

  test('skillsDir is the absolute path under the user homedir (resolves to a string)', () => {
    // The value is computed at module load time; assert it matches the resolved form
    // so a future refactor that broke the homedir() / join shape would fail this test.
    expect(CLAUDE_CODE_ADAPTER.skillInstall?.skillsDir).toBe(join(resolve(homedir()), '.claude', 'skills'));
  });
});

describe('TRAE_ADAPTER — standardsProfile + skillInstall (slice #011: UNVERIFIED)', () => {
  test('standardsProfile is undefined (Trae real-install dogfood is slice #012+)', () => {
    expect(TRAE_ADAPTER.standardsProfile).toBeUndefined();
  });

  test('skillInstall is undefined (Trae real-install dogfood is slice #012+)', () => {
    expect(TRAE_ADAPTER.skillInstall).toBeUndefined();
  });
});

describe('getStandardsProfile — single chokepoint accessor', () => {
  test('returns the Claude Code profile for claude-code', () => {
    const profile = getStandardsProfile('claude-code');
    expect(profile).not.toBeNull();
    expect(profile?.rootFile).toBe('CLAUDE.md');
    expect(profile?.rulesDir).toBe('.claude/rules');
  });

  test('returns null for trae (no profile declared; slice #011 fallback path)', () => {
    expect(getStandardsProfile('trae')).toBeNull();
  });

  test('returns null for cursor (UNVERIFIED — slice #012+ dogfood; slice #011 fallback path, AC16)', () => {
    // slice #12 (2.4.0): cursor is registered but standardsProfile is UNVERIFIED
    // (real Cursor install dogfood required). Returns null = fallback to
    // legacy Claude Code path with stderr warning. AC16 asserts postinstall
    // writes to ~/.claude/skills/ (legacy fallback).
    expect(getStandardsProfile('cursor')).toBeNull();
  });

  test('returns null for codex (UNVERIFIED — slice #013+ dogfood; slice #011 fallback path, AC16)', () => {
    expect(getStandardsProfile('codex')).toBeNull();
  });

  test('throws for an unregistered IDE (qoder, reserved for slice #3+)', () => {
    expect(() => getStandardsProfile('qoder' as 'qoder')).toThrow(/Unsupported IDE: qoder/);
  });
});

describe('getSkillInstall — single chokepoint accessor', () => {
  test('returns the Claude Code install profile for claude-code', () => {
    const profile = getSkillInstall('claude-code');
    expect(profile).not.toBeNull();
    expect(profile?.skillsDir).toBe(join(homedir(), '.claude', 'skills'));
    expect(profile?.outputStylesDir).toBe(join(homedir(), '.claude', 'output-styles'));
    expect(profile?.installStrategy).toBe('symlink');
  });

  test('returns null for trae (no profile declared; slice #011 fallback path)', () => {
    expect(getSkillInstall('trae')).toBeNull();
  });

  test('returns null for cursor (UNVERIFIED — slice #012+ dogfood; bundled skills fall back to ~/.claude/skills, AC16)', () => {
    // AC16: bundled-skills postinstall writes to ~/.claude/skills/ (legacy
    // Claude Code fallback) with stderr warning, NOT to ~/.cursor/skills/.
    expect(getSkillInstall('cursor')).toBeNull();
  });

  test('returns null for codex (UNVERIFIED — slice #013+ dogfood; bundled skills fall back to ~/.claude/skills, AC16)', () => {
    expect(getSkillInstall('codex')).toBeNull();
  });

  test('throws for an unregistered IDE (qoder, reserved for slice #3+)', () => {
    expect(() => getSkillInstall('qoder' as 'qoder')).toThrow(/Unsupported IDE: qoder/);
  });
});

describe('detectAllResourceTargets — enumerate all registered adapters', () => {
  test('returns at least the two registered adapters (claude-code + trae)', () => {
    const targets = detectAllResourceTargets();
    expect(targets.length).toBeGreaterThanOrEqual(2);
    const ids = targets.map((t) => t.ideId);
    expect(ids).toEqual(expect.arrayContaining(['claude-code', 'trae']));
  });

  test('enumerates in adapter insertion order', () => {
    const targets = detectAllResourceTargets();
    expect(targets[0]?.ideId).toBe('claude-code');
    expect(targets[1]?.ideId).toBe('trae');
  });

  test('every Claude Code entry has standardsProfile + skillInstall; every Trae entry has neither', () => {
    const targets = detectAllResourceTargets();
    const claude = targets.find((t) => t.ideId === 'claude-code');
    const trae = targets.find((t) => t.ideId === 'trae');
    expect(claude?.standardsProfile).not.toBeNull();
    expect(claude?.skillInstall).not.toBeNull();
    expect(trae?.standardsProfile).toBeNull();
    expect(trae?.skillInstall).toBeNull();
  });
});

describe('registry integration — adapter insertion order is preserved', () => {
  test('listAdapterIds returns claude-code then trae (in insertion order, before hermes + openclaw)', () => {
    const ids = listAdapterIds();
    expect(ids[0]).toBe('claude-code');
    expect(ids[1]).toBe('trae');
    expect(ids).toContain('hermes');
    expect(ids).toContain('openclaw');
  });
});
