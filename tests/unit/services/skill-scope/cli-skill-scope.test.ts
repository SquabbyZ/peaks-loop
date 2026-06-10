import { describe, it, expect, test, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runSkillScopeCommand } from '../../../../src/cli/commands/skill-scope-commands.js';

const PEAKS = [
  'peaks-solo', 'peaks-rd', 'peaks-qa', 'peaks-prd', 'peaks-sc',
  'peaks-sop', 'peaks-txt', 'peaks-ui', 'peaks-ide', 'peaks-solo-resume',
  'peaks-solo-status', 'peaks-solo-test',
];

const SAMPLE_SKILLS = [
  ...PEAKS,
  'tdd-guide', 'coding-standards', 'karpathy-guidelines',
  'continuous-learning', 'code-tour', 'agent-harness-construction',
  'security-review', 'code-review',
  'kotlin-patterns', 'python-patterns', 'java-coding-standards',
  'rust-patterns', 'golang-patterns', 'ruby-patterns',
  'swiftui-patterns', 'csharp-testing', 'cpp-coding-standards',
  'react-components', 'vercel-react-best-practices', 'vue-patterns',
  'svelte-patterns', 'nextjs-patterns',
  'nestjs-best-practices', 'nestjs-patterns', 'nestjs-expert',
  'fastify-best-practices', 'express-patterns',
  'postgres', 'postgres-patterns', 'postgres-drizzle', 'clickhouse-io',
  'mysql-patterns', 'mongo-patterns', 'redis-patterns',
];

function writeTsCli(dir: string): void {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'ts-cli', type: 'module',
    dependencies: { commander: '^12.0.0' },
    devDependencies: { typescript: '^5.0.0', vitest: '^2.0.0' },
    engines: { node: '>=20' },
  }));
  writeFileSync(join(dir, 'tsconfig.json'), '{}');
}

function writeFakeInstalledSkills(home: string, names: string[]): void {
  const skillsBase = join(home, '.claude', 'skills');
  for (const name of names) {
    const skillDir = join(skillsBase, name);
    mkdirSync(skillDir, { recursive: true });
    const desc = name.startsWith('vercel-react-') ? 'Vercel React best practices'
      : name.startsWith('react-') ? 'React UI components'
      : name.startsWith('peaks-') ? 'peaks-cli skill family'
      : name.startsWith('tdd-') ? 'Test-driven development guide'
      : name.startsWith('coding-') ? 'Coding standards'
      : name.startsWith('karpathy-') ? 'Karpathy LLM training guidelines'
      : name.startsWith('continuous-') ? 'Continuous learning'
      : name.startsWith('code-tour') ? 'Codebase tour'
      : name.startsWith('agent-harness') ? 'Agent harness construction'
      : name.startsWith('security-') ? 'Security review'
      : name.startsWith('code-review') ? 'Code review best practices'
      : name.startsWith('kotlin-') ? 'Kotlin patterns'
      : name.startsWith('python-') ? 'Python patterns'
      : name.startsWith('java-') ? 'Java coding standards'
      : name.startsWith('rust-') ? 'Rust patterns'
      : name.startsWith('golang-') ? 'Go patterns'
      : name.startsWith('ruby-') ? 'Ruby patterns'
      : name.startsWith('swiftui-') ? 'SwiftUI patterns'
      : name.startsWith('csharp-') ? 'C# testing'
      : name.startsWith('cpp-') ? 'C++ standards'
      : name.startsWith('vue-') ? 'Vue UI components'
      : name.startsWith('svelte-') ? 'Svelte UI components'
      : name.startsWith('nextjs-') ? 'Next.js framework'
      : name.startsWith('nestjs-') ? 'NestJS backend'
      : name.startsWith('fastify-') ? 'Fastify backend'
      : name.startsWith('express-') ? 'Express backend'
      : name.startsWith('postgres') ? 'PostgreSQL patterns'
      : name.startsWith('mysql') ? 'MySQL patterns'
      : name.startsWith('mongo') ? 'MongoDB patterns'
      : name.startsWith('redis') ? 'Redis patterns'
      : name.startsWith('clickhouse') ? 'ClickHouse patterns'
      : 'general purpose skill';
    writeFileSync(join(skillDir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${desc}\n---\n# ${name}\n`);
  }
}

describe('peaks skill scope CLI (AC1, AC3, AC6, AC7, AC8, AC10, AC11)', () => {
  let projectRoot: string;
  let home: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'peaks-scope-cli-'));
    home = mkdtempSync(join(tmpdir(), 'peaks-home-'));
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    writeFakeInstalledSkills(home, SAMPLE_SKILLS);
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  test('TC-CLI-1: --detect is idempotent and side-effect-free', async () => {
    writeTsCli(projectRoot);
    const r1 = await runSkillScopeCommand({
      subcommand: 'detect', project: projectRoot, json: true,
    });
    const r2 = await runSkillScopeCommand({
      subcommand: 'detect', project: projectRoot, json: true,
    });
    expect(r1.exitCode).toBe(0);
    expect(r2.exitCode).toBe(0);
    expect(JSON.stringify(r2.envelope)).toBe(JSON.stringify(r1.envelope));
    expect(existsSync(join(projectRoot, '.peaks', 'scope', 'skills.json'))).toBe(false);
  });

  test('TC-CLI-2: --apply writes both .peaks/scope/skills.json AND .claude/settings.local.json', async () => {
    writeTsCli(projectRoot);
    const r = await runSkillScopeCommand({
      subcommand: 'apply', project: projectRoot, strict: true, ide: 'claude-code',
    });
    expect(r.exitCode).toBe(0);
    const sot = join(projectRoot, '.peaks', 'scope', 'skills.json');
    expect(existsSync(sot)).toBe(true);
    const settings = join(projectRoot, '.claude', 'settings.local.json');
    expect(existsSync(settings)).toBe(true);
  });

  test('TC-CLI-2b: --apply rolls back both files on partial failure (atomicity)', async () => {
    writeTsCli(projectRoot);
    const r = await runSkillScopeCommand({
      subcommand: 'apply',
      project: projectRoot,
      strict: true,
      ide: 'trae',
      simulateSourceOfTruthWriteFailure: true,
    });
    expect(r.exitCode).not.toBe(0);
    const sot = join(projectRoot, '.peaks', 'scope', 'skills.json');
    const settings = join(projectRoot, '.claude', 'settings.local.json');
    expect(existsSync(sot)).toBe(false);
    expect(existsSync(settings)).toBe(false);
  });

  test('TC-CLI-3: --strict excludes borderline from allowlist', async () => {
    writeTsCli(projectRoot);
    const r = await runSkillScopeCommand({
      subcommand: 'apply', project: projectRoot, strict: true, ide: 'claude-code',
    });
    const sot = JSON.parse(readFileSync(join(projectRoot, '.peaks', 'scope', 'skills.json'), 'utf-8'));
    expect(sot.strict).toBe(true);
    const detected = await runSkillScopeCommand({
      subcommand: 'detect', project: projectRoot, json: true,
    });
    const borderlineNames = (detected.envelope!.data as { skills: Array<{ name: string; relevance: string }> })
      .skills
      .filter(s => s.relevance === 'borderline')
      .map(s => s.name);
    for (const name of borderlineNames) {
      expect(sot.allowlist, `borderline ${name} should not be in --strict allowlist`).not.toContain(name);
    }
  });

  test('TC-CLI-4: --loose includes borderline in allowlist (default mode)', async () => {
    writeTsCli(projectRoot);
    const r = await runSkillScopeCommand({
      subcommand: 'apply', project: projectRoot, strict: false, ide: 'claude-code',
    });
    const sot = JSON.parse(readFileSync(join(projectRoot, '.peaks', 'scope', 'skills.json'), 'utf-8'));
    expect(sot.strict).toBe(false);
    const detected = await runSkillScopeCommand({
      subcommand: 'detect', project: projectRoot, json: true,
    });
    const borderlineNames = (detected.envelope!.data as { skills: Array<{ name: string; relevance: string }> })
      .skills
      .filter(s => s.relevance === 'borderline')
      .map(s => s.name);
    for (const name of borderlineNames) {
      expect(sot.allowlist, `borderline ${name} should be in --loose allowlist`).toContain(name);
    }
  });

  test('TC-CLI-5: --show reads .peaks/scope/skills.json and prints allowlist + denylist + ide + signals', async () => {
    writeTsCli(projectRoot);
    await runSkillScopeCommand({
      subcommand: 'apply', project: projectRoot, strict: true, ide: 'claude-code',
    });
    const r = await runSkillScopeCommand({
      subcommand: 'show', project: projectRoot, json: true,
    });
    expect(r.exitCode).toBe(0);
    const data = r.envelope!.data as { ide: string; source: { allowlist: string[] }; native: unknown };
    expect(data.ide).toBe('claude-code');
    expect(data.source).not.toBeNull();
    expect(data.source.allowlist).toEqual(expect.any(Array));
    expect(data.native).not.toBeNull();
  });

  test('TC-CLI-6: --reset removes both .peaks/scope/skills.json and .claude/settings.local.json', async () => {
    writeTsCli(projectRoot);
    await runSkillScopeCommand({
      subcommand: 'apply', project: projectRoot, strict: true, ide: 'claude-code',
    });
    const sot = join(projectRoot, '.peaks', 'scope', 'skills.json');
    const settings = join(projectRoot, '.claude', 'settings.local.json');
    expect(existsSync(sot)).toBe(true);
    expect(existsSync(settings)).toBe(true);
    const r = await runSkillScopeCommand({
      subcommand: 'reset', project: projectRoot,
    });
    expect(r.exitCode).toBe(0);
    expect(existsSync(sot)).toBe(false);
    expect(existsSync(settings)).toBe(false);
    expect(r.stdout).toMatch(/removed|reset/i);
    // Path may be either forward-slash or backslash depending on OS.
    expect(r.stdout).toMatch(/\.peaks[\/\\]scope[\/\\]skills\.json/);
    expect(r.stdout).toMatch(/\.claude[\/\\]settings\.local\.json/);
  });

  test('TC-CLI-7: --json envelope shape is consistent across detect/apply/show/reset', async () => {
    writeTsCli(projectRoot);
    const detect = await runSkillScopeCommand({ subcommand: 'detect', project: projectRoot, json: true });
    const apply = await runSkillScopeCommand({ subcommand: 'apply', project: projectRoot, strict: true, ide: 'claude-code', json: true });
    const show = await runSkillScopeCommand({ subcommand: 'show', project: projectRoot, json: true });
    const reset = await runSkillScopeCommand({ subcommand: 'reset', project: projectRoot, json: true });
    for (const r of [detect, apply, show, reset]) {
      expect(r.exitCode).toBe(0);
      expect(r.envelope).toBeDefined();
      expect(typeof r.envelope).toBe('object');
    }
  });

  test('TC-CLI-1b: --detect JSON envelope size ≤ 100KB (AC1 hard limit)', async () => {
    writeTsCli(projectRoot);
    const r = await runSkillScopeCommand({
      subcommand: 'detect', project: projectRoot, json: true,
    });
    const json = JSON.stringify(r.envelope);
    const size = Buffer.byteLength(json, 'utf-8');
    expect(size, `envelope must be ≤ 100KB (got ${size} bytes)`).toBeLessThanOrEqual(100 * 1024);
    const data = r.envelope!.data as { counts: { relevant: number; borderline: number; irrelevant: number }; skills: unknown[] };
    expect(data.counts.relevant + data.counts.borderline + data.counts.irrelevant).toBe(data.skills.length);
  });

  test('TC-CLI-8: peaks-* family ALWAYS in allowlist, NEVER in denylist, even with --strict', async () => {
    writeTsCli(projectRoot);
    const r = await runSkillScopeCommand({
      subcommand: 'apply', project: projectRoot, strict: true, ide: 'claude-code',
    });
    expect(r.exitCode).toBe(0);
    const sot = JSON.parse(readFileSync(join(projectRoot, '.peaks', 'scope', 'skills.json'), 'utf-8'));
    for (const peak of PEAKS) {
      expect(sot.allowlist, `${peak} must be in allowlist per G6`).toContain(peak);
      expect(sot.denylist, `${peak} must NOT be in denylist per G6`).not.toContain(peak);
    }
    const settings = JSON.parse(readFileSync(join(projectRoot, '.claude', 'settings.local.json'), 'utf-8'));
    const deny: string[] = settings.permissions.deny ?? [];
    for (const peak of PEAKS) {
      expect(deny, `${peak} must not appear in Claude Code permissions.deny`).not.toContain(`Skill(${peak})`);
    }
  });

  test('TC-CLI-9: stub adapter --apply exits non-zero but writes .peaks/scope/skills.json', async () => {
    writeTsCli(projectRoot);
    const r = await runSkillScopeCommand({
      subcommand: 'apply', project: projectRoot, strict: true, ide: 'trae',
    });
    expect(r.exitCode).not.toBe(0);
    const sot = join(projectRoot, '.peaks', 'scope', 'skills.json');
    expect(existsSync(sot), 'source-of-truth must be written even when adapter returns NOT_SUPPORTED').toBe(true);
    expect(r.stderr).toMatch(/NOT_SUPPORTED|not yet researched|follow-up/i);
  });

  test('TC-CLI-10: --ide <name> overrides IDE auto-detection (R3)', async () => {
    writeTsCli(projectRoot);
    const r = await runSkillScopeCommand({
      subcommand: 'apply', project: projectRoot, strict: true, ide: 'trae',
    });
    // The source-of-truth should report the chosen ide (not the detected one).
    const sot = JSON.parse(readFileSync(join(projectRoot, '.peaks', 'scope', 'skills.json'), 'utf-8'));
    expect(sot.ide).toBe('trae');
  });

  test('TC-CLI-11: --apply re-adds peaks-* to allowlist if missing (G6 enforcement layer)', async () => {
    writeTsCli(projectRoot);
    await runSkillScopeCommand({
      subcommand: 'apply', project: projectRoot, strict: true, ide: 'claude-code',
      overrideAllowlist: ['only-this-one'],
    });
    const sot = JSON.parse(readFileSync(join(projectRoot, '.peaks', 'scope', 'skills.json'), 'utf-8'));
    for (const peak of PEAKS) {
      expect(sot.allowlist, `${peak} must be re-added by CLI even if upstream dropped it`).toContain(peak);
    }
  });
});