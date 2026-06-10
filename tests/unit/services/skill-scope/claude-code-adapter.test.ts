import { describe, it, expect, test, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { ClaudeCodeSkillScope } from '../../../../src/services/skill-scope/adapters/claude-code.js';
import type { ScopeConfig } from '../../../../src/services/skill-scope/types.js';

const PEAKS = [
  'peaks-solo', 'peaks-rd', 'peaks-qa', 'peaks-prd', 'peaks-sc',
  'peaks-sop', 'peaks-txt', 'peaks-ui', 'peaks-ide', 'peaks-solo-resume',
  'peaks-solo-status', 'peaks-solo-test',
];

function fakeConfig(): ScopeConfig {
  return {
    generatedAt: '2026-06-10T00:00:00.000Z',
    ide: 'claude-code',
    strict: true,
    allowlist: PEAKS,
    denylist: [],
    skills: [],
    signals: {
      hasPackageJson: true,
      isTypeScript: true,
      isTypeScriptESM: true,
      isReact: false,
      isVue: false,
      isSvelte: false,
      isNext: false,
      isNestJS: false,
      isExpress: false,
      isFastify: false,
      isPostgres: false,
      isMysql: false,
      isMongo: false,
      isRedis: false,
      isDocker: false,
      isK8s: false,
      isCommander: true,
      isCodegraph: true,
      isHeadroom: true,
      isPython: false,
      nodeEngineMajor: 20,
      topExtensions: ['.ts'],
      hasFileExtension: { ts: true },
    },
  };
}

describe('ClaudeCodeSkillScope adapter (AC3, AC5, AC6, AC7, AC10, AC11)', () => {
  let projectRoot: string;
  let adapter: ClaudeCodeSkillScope;
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'peaks-cc-scope-'));
    adapter = new ClaudeCodeSkillScope({ projectRoot });
  });
  afterEach(() => { rmSync(projectRoot, { recursive: true, force: true }); });

  test('TC-CC-1: applyScope writes .claude/settings.local.json with permissions.allow/deny', async () => {
    const result = await adapter.applyScope({
      allowlist: ['peaks-solo', 'tdd-guide'],
      denylist: ['kotlin-patterns', 'react-components'],
      strict: true,
      projectRoot,
      sourceConfig: fakeConfig(),
      shadowFallback: false,
    });
    expect(result.ok).toBe(true);
    const settingsPath = join(projectRoot, '.claude', 'settings.local.json');
    expect(existsSync(settingsPath)).toBe(true);
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    expect(settings.permissions.allow).toEqual(
      expect.arrayContaining(['Skill(peaks-solo)', 'Skill(tdd-guide)']),
    );
    expect(settings.permissions.deny).toEqual(
      expect.arrayContaining(['Skill(kotlin-patterns)', 'Skill(react-components)']),
    );
  });

  test('TC-CC-2: applyScope preserves existing settings.local.json non-permissions fields', async () => {
    mkdirSync(join(projectRoot, '.claude'), { recursive: true });
    const existing = {
      theme: 'dark',
      env: { FOO: 'bar' },
      permissions: { allow: ['Skill(existing)'] },
    };
    writeFileSync(
      join(projectRoot, '.claude', 'settings.local.json'),
      JSON.stringify(existing),
    );
    await adapter.applyScope({
      allowlist: ['peaks-solo'],
      denylist: ['kotlin-patterns'],
      strict: true,
      projectRoot,
      sourceConfig: fakeConfig(),
      shadowFallback: false,
    });
    const after = JSON.parse(
      readFileSync(join(projectRoot, '.claude', 'settings.local.json'), 'utf-8'),
    );
    expect(after.theme).toBe('dark');
    expect(after.env).toEqual({ FOO: 'bar' });
    expect(after.permissions.allow).toEqual(
      expect.arrayContaining(['Skill(existing)', 'Skill(peaks-solo)']),
    );
    expect(after.permissions.deny).toEqual(
      expect.arrayContaining(['Skill(kotlin-patterns)']),
    );
  });

  test('TC-CC-3: --shadow-fallback writes shadow stubs at .claude/skills/[name]/SKILL.md', async () => {
    await adapter.applyScope({
      allowlist: ['peaks-solo'],
      denylist: ['kotlin-patterns', 'react-components'],
      strict: true,
      projectRoot,
      sourceConfig: fakeConfig(),
      shadowFallback: true,
    });
    for (const name of ['kotlin-patterns', 'react-components']) {
      const stub = join(projectRoot, '.claude', 'skills', name, 'SKILL.md');
      expect(existsSync(stub), `missing shadow stub: ${stub}`).toBe(true);
    }
  });

  test('TC-CC-4: shadow stub frontmatter includes _peaks_scope_disabled: true (R6)', async () => {
    await adapter.applyScope({
      allowlist: ['peaks-solo'],
      denylist: ['kotlin-patterns'],
      strict: true,
      projectRoot,
      sourceConfig: fakeConfig(),
      shadowFallback: true,
    });
    const stub = readFileSync(
      join(projectRoot, '.claude', 'skills', 'kotlin-patterns', 'SKILL.md'),
      'utf-8',
    );
    expect(stub).toMatch(/^---\n/);
    expect(stub).toMatch(/_peaks_scope_disabled:\s*true/);
  });

  test('TC-CC-5: showScope reads back the applied config (allowlist + denylist + ide)', async () => {
    await adapter.applyScope({
      allowlist: ['peaks-solo', 'tdd-guide'],
      denylist: ['kotlin-patterns'],
      strict: true,
      projectRoot,
      sourceConfig: fakeConfig(),
      shadowFallback: false,
    });
    const shown = await adapter.showScope(projectRoot);
    expect(shown.ide).toBe('claude-code');
    const native = shown.native as { permissions: { allow: string[]; deny: string[] } };
    expect(native.permissions.allow).toEqual(
      expect.arrayContaining(['Skill(peaks-solo)', 'Skill(tdd-guide)']),
    );
    expect(native.permissions.deny).toEqual(
      expect.arrayContaining(['Skill(kotlin-patterns)']),
    );
  });

  test('TC-CC-6: resetScope removes .claude/settings.local.json and shadow stubs', async () => {
    await adapter.applyScope({
      allowlist: ['peaks-solo'],
      denylist: ['kotlin-patterns'],
      strict: true,
      projectRoot,
      sourceConfig: fakeConfig(),
      shadowFallback: true,
    });
    expect(existsSync(join(projectRoot, '.claude', 'settings.local.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.claude', 'skills', 'kotlin-patterns', 'SKILL.md'))).toBe(true);
    const removed = await adapter.resetScope({ projectRoot });
    expect(existsSync(join(projectRoot, '.claude', 'settings.local.json'))).toBe(false);
    expect(existsSync(join(projectRoot, '.claude', 'skills', 'kotlin-patterns', 'SKILL.md'))).toBe(false);
    expect(removed.removedFiles).toEqual(
      expect.arrayContaining([join(projectRoot, '.claude', 'settings.local.json')]),
    );
  });

  test('TC-CC-7: peaks-* family NEVER appears in permissions.deny (G6 hard constraint)', async () => {
    await adapter.applyScope({
      allowlist: ['peaks-solo'],
      denylist: ['kotlin-patterns', 'react-components'],
      strict: true,
      projectRoot,
      sourceConfig: fakeConfig(),
      shadowFallback: false,
    });
    const result2 = await adapter.applyScope({
      allowlist: ['peaks-solo'],
      denylist: [...PEAKS, 'kotlin-patterns'],
      strict: true,
      projectRoot,
      sourceConfig: fakeConfig(),
      shadowFallback: false,
    });
    const settings = JSON.parse(
      readFileSync(join(projectRoot, '.claude', 'settings.local.json'), 'utf-8'),
    );
    const deny: string[] = settings.permissions.deny ?? [];
    for (const peak of PEAKS) {
      expect(
        deny.some(d => d === `Skill(${peak})` || d === peak),
        `peaks-* must never be in deny: ${peak}`,
      ).toBe(false);
    }
    expect(result2.strippedFromDenylist).toEqual(
      expect.arrayContaining(PEAKS),
    );
  });

  test('TC-CC-8: idempotent — applyScope called twice with same args produces same settings.local.json', async () => {
    const args = {
      allowlist: ['peaks-solo', 'tdd-guide'],
      denylist: ['kotlin-patterns', 'react-components'],
      strict: true,
      projectRoot,
      sourceConfig: fakeConfig(),
      shadowFallback: false,
    };
    await adapter.applyScope(args);
    const first = readFileSync(
      join(projectRoot, '.claude', 'settings.local.json'),
      'utf-8',
    );
    await adapter.applyScope(args);
    const second = readFileSync(
      join(projectRoot, '.claude', 'settings.local.json'),
      'utf-8',
    );
    expect(second).toBe(first);
  });

  test('TC-CC-9: applyScope returns NOT_SUPPORTED-shaped error on malformed input', async () => {
    const r = await adapter.applyScope({
      allowlist: [],
      denylist: ['kotlin-patterns'],
      strict: false,
      projectRoot,
      sourceConfig: fakeConfig(),
      shadowFallback: false,
    });
    expect(r).toHaveProperty('ok');
  });
});