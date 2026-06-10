import { describe, it, expect, test, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { detectSkillScope } from '../../../../src/services/skill-scope/detect.js';
import type { ProjectSignals, SkillScopeRecord } from '../../../../src/services/skill-scope/types.js';

const PEAKS_FAMILY = [
  'peaks-solo', 'peaks-rd', 'peaks-qa', 'peaks-prd', 'peaks-sc',
  'peaks-sop', 'peaks-txt', 'peaks-ui', 'peaks-ide', 'peaks-solo-resume',
  'peaks-solo-status', 'peaks-solo-test',
];

const GENERIC_AI_SKILLS = [
  'tdd-guide', 'coding-standards', 'karpathy-guidelines',
  'continuous-learning', 'code-tour', 'agent-harness-construction',
  'security-review', 'code-review',
];

const NON_TS_LANGUAGE_FAMILIES = [
  'kotlin-patterns', 'python-patterns', 'java-coding-standards',
  'rust-patterns', 'golang-patterns', 'ruby-patterns',
  'swiftui-patterns', 'csharp-testing', 'cpp-coding-standards',
];

const FRONTEND_FAMILIES = [
  'react-components', 'vercel-react-best-practices', 'vue-patterns',
  'svelte-patterns', 'nextjs-patterns',
];

const BACKEND_FAMILIES = [
  'nestjs-best-practices', 'nestjs-patterns', 'nestjs-expert',
  'fastify-best-practices', 'express-patterns',
];

const DATA_FAMILIES = [
  'postgres', 'postgres-patterns', 'postgres-drizzle', 'clickhouse-io',
  'mysql-patterns', 'mongo-patterns', 'redis-patterns',
];

function writeFixture(dir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
}

function writeTsCliFixture(dir: string): void {
  writeFixture(dir, {
    'package.json': JSON.stringify({
      name: 'ts-cli', type: 'module',
      dependencies: { commander: '^12.0.0', tsx: '^4.0.0' },
      devDependencies: {
        vitest: '^2.0.0', typescript: '^5.0.0',
        '@colbymchenry/codegraph': '^1.0.0', 'headroom-ai': '^1.0.0',
      },
      engines: { node: '>=20' },
    }),
    'tsconfig.json': JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'NodeNext' },
    }),
  });
}

function writeInstalledSkills(dir: string, names: string[]): void {
  // Build a fake installed-skills tree under <tmp>/skills.
  for (const name of names) {
    const skillDir = join(dir, 'skills', name);
    mkdirSync(skillDir, { recursive: true });
    const desc = name.startsWith('vercel-react-') ? 'Vercel React best practices'
      : name.startsWith('react-') ? 'React UI components and patterns'
      : name.startsWith('vue-') ? 'Vue UI components and patterns'
      : name.startsWith('svelte-') ? 'Svelte UI components and patterns'
      : name.startsWith('nextjs-') ? 'Next.js full-stack React framework'
      : name.startsWith('nestjs-') ? 'NestJS backend framework'
      : name.startsWith('express-') ? 'Express backend framework patterns'
      : name.startsWith('fastify-') ? 'Fastify backend framework patterns'
      : name.startsWith('postgres') ? 'PostgreSQL database patterns'
      : name.startsWith('mysql') ? 'MySQL database patterns'
      : name.startsWith('mongo') ? 'MongoDB database patterns'
      : name.startsWith('redis') ? 'Redis cache patterns'
      : name.startsWith('python-') ? 'Python patterns and idioms'
      : name.startsWith('kotlin-') ? 'Kotlin patterns'
      : name.startsWith('java-') ? 'Java coding standards'
      : name.startsWith('rust-') ? 'Rust patterns'
      : name.startsWith('golang-') ? 'Go patterns'
      : name.startsWith('ruby-') ? 'Ruby patterns'
      : name.startsWith('swiftui-') ? 'SwiftUI patterns'
      : name.startsWith('csharp-') ? 'C# testing patterns'
      : name.startsWith('cpp-') ? 'C++ coding standards'
      : name.startsWith('karpathy-') ? 'Karpathy LLM training guidelines'
      : name.startsWith('tdd-') ? 'Test-driven development guide'
      : name.startsWith('coding-') ? 'Coding standards and style guide'
      : name.startsWith('continuous-') ? 'Continuous learning and improvement'
      : name.startsWith('code-tour') ? 'Codebase tour and orientation'
      : name.startsWith('agent-harness') ? 'Agent harness construction'
      : name.startsWith('security-') ? 'Security review for code'
      : name.startsWith('code-review') ? 'Code review best practices'
      : name.startsWith('peaks-') ? 'peaks-cli skill family'
      : 'general purpose skill';
    writeFileSync(join(skillDir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${desc}\n---\n# ${name}\n`);
  }
}

describe('peaks skill scope — detect (AC1, AC2, AC11)', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'peaks-scope-'));
    writeInstalledSkills(tmpDir, [
      ...PEAKS_FAMILY,
      ...GENERIC_AI_SKILLS,
      ...NON_TS_LANGUAGE_FAMILIES,
      ...FRONTEND_FAMILIES,
      ...BACKEND_FAMILIES,
      ...DATA_FAMILIES,
    ]);
  });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  test('TC-DETECT-1: TS-CLI — peaks-* family all 12 marked relevant (G6 hard constraint)', async () => {
    writeTsCliFixture(tmpDir);
    const result = await detectSkillScope({
      projectRoot: tmpDir,
      installedSkillsPath: join(tmpDir, 'skills'),
    });
    for (const name of PEAKS_FAMILY) {
      const s = result.skills.find((x: SkillScopeRecord) => x.name === name);
      expect(s, `missing peaks-* family member: ${name}`).toBeDefined();
      expect(s!.relevance, `${name} should be relevant per G6`).toBe('relevant');
    }
  });

  test('TC-DETECT-2: TS-CLI — generic AI-engineering skills relevant', async () => {
    writeTsCliFixture(tmpDir);
    const result = await detectSkillScope({
      projectRoot: tmpDir,
      installedSkillsPath: join(tmpDir, 'skills'),
    });
    for (const name of GENERIC_AI_SKILLS) {
      const s = result.skills.find((x: SkillScopeRecord) => x.name === name);
      expect(s, `missing generic skill: ${name}`).toBeDefined();
      expect(s!.relevance, `${name} should be relevant for a TS CLI`).toBe('relevant');
      expect(s!.reasons.length).toBeGreaterThan(0);
    }
  });

  test('TC-DETECT-3: TS-CLI — non-TS language families irrelevant', async () => {
    writeTsCliFixture(tmpDir);
    const result = await detectSkillScope({
      projectRoot: tmpDir,
      installedSkillsPath: join(tmpDir, 'skills'),
    });
    for (const name of NON_TS_LANGUAGE_FAMILIES) {
      const s = result.skills.find((x: SkillScopeRecord) => x.name === name);
      expect(s, `missing non-TS skill: ${name}`).toBeDefined();
      expect(s!.relevance, `${name} should be irrelevant for a TS CLI`).toBe('irrelevant');
    }
  });

  test('TC-DETECT-4: TS-CLI — React/Vue/Svelte/Next.js families irrelevant', async () => {
    writeTsCliFixture(tmpDir);
    const result = await detectSkillScope({
      projectRoot: tmpDir,
      installedSkillsPath: join(tmpDir, 'skills'),
    });
    for (const name of FRONTEND_FAMILIES) {
      const s = result.skills.find((x: SkillScopeRecord) => x.name === name);
      expect(s).toBeDefined();
      expect(s!.relevance, `${name} should be irrelevant for a backend-only TS CLI`).toBe('irrelevant');
    }
  });

  test('TC-DETECT-5: TS-CLI — NestJS/Express/Fastify families irrelevant', async () => {
    writeTsCliFixture(tmpDir);
    const result = await detectSkillScope({
      projectRoot: tmpDir,
      installedSkillsPath: join(tmpDir, 'skills'),
    });
    for (const name of BACKEND_FAMILIES) {
      const s = result.skills.find((x: SkillScopeRecord) => x.name === name);
      expect(s).toBeDefined();
      expect(s!.relevance, `${name} should be irrelevant for peaks-cli`).toBe('irrelevant');
    }
  });

  test('TC-DETECT-6: TS-CLI — Postgres/MySQL/Mongo/Redis families irrelevant', async () => {
    writeTsCliFixture(tmpDir);
    const result = await detectSkillScope({
      projectRoot: tmpDir,
      installedSkillsPath: join(tmpDir, 'skills'),
    });
    for (const name of DATA_FAMILIES) {
      const s = result.skills.find((x: SkillScopeRecord) => x.name === name);
      expect(s).toBeDefined();
      expect(s!.relevance, `${name} should be irrelevant for a CLI with no DB`).toBe('irrelevant');
    }
  });

  test('TC-DETECT-7: TS-React — react-components / vercel-react-best-practices relevant', async () => {
    writeFixture(tmpDir, {
      'package.json': JSON.stringify({
        name: 'ts-react', type: 'module',
        dependencies: {
          react: '^18.0.0', 'react-dom': '^18.0.0',
          next: '^14.0.0',
        },
        devDependencies: { typescript: '^5.0.0', vitest: '^2.0.0' },
      }),
      'tsconfig.json': '{}',
      'next.config.js': 'module.exports = {};',
    });
    const result = await detectSkillScope({
      projectRoot: tmpDir,
      installedSkillsPath: join(tmpDir, 'skills'),
    });
    const react = result.skills.find((s: SkillScopeRecord) => s.name === 'react-components');
    const vercel = result.skills.find((s: SkillScopeRecord) => s.name === 'vercel-react-best-practices');
    expect(react?.relevance).toBe('relevant');
    expect(vercel?.relevance).toBe('relevant');
    const nest = result.skills.find((s: SkillScopeRecord) => s.name === 'nestjs-patterns');
    expect(nest?.relevance).toBe('irrelevant');
  });

  test('TC-DETECT-8: Python project — peaks-* family STILL relevant (G6 hard constraint)', async () => {
    writeFixture(tmpDir, {
      'pyproject.toml': '[project]\nname = "py-tool"\n',
      'requirements.txt': 'fastapi==0.100.0\n',
      'main.py': 'print("hello")\n',
    });
    const result = await detectSkillScope({
      projectRoot: tmpDir,
      installedSkillsPath: join(tmpDir, 'skills'),
    });
    for (const name of PEAKS_FAMILY) {
      const s = result.skills.find((x: SkillScopeRecord) => x.name === name);
      expect(s).toBeDefined();
      expect(s!.relevance, `peaks-* must always be relevant — ${name} violated G6`).toBe('relevant');
    }
    // python patterns should be relevant in a python project
    const py = result.skills.find((s: SkillScopeRecord) => s.name === 'python-patterns');
    expect(py?.relevance).toBe('relevant');
  });

  test('TC-DETECT-9: full-stack TS-React-Express — both react-components and express-patterns relevant', async () => {
    writeFixture(tmpDir, {
      'package.json': JSON.stringify({
        name: 'fullstack', type: 'module',
        dependencies: {
          react: '^18.0.0', 'react-dom': '^18.0.0',
          express: '^4.18.0',
        },
        devDependencies: { typescript: '^5.0.0', vitest: '^2.0.0' },
      }),
      'tsconfig.json': '{}',
    });
    const result = await detectSkillScope({
      projectRoot: tmpDir,
      installedSkillsPath: join(tmpDir, 'skills'),
    });
    expect(result.skills.find((s: SkillScopeRecord) => s.name === 'react-components')?.relevance).toBe('relevant');
    expect(result.skills.find((s: SkillScopeRecord) => s.name === 'express-patterns')?.relevance).toBe('relevant');
    expect(result.skills.find((s: SkillScopeRecord) => s.name === 'rust-patterns')?.relevance).toBe('irrelevant');
  });

  test('TC-DETECT-10: file-tree signals — .swift / .kt / .py / .go presence detected in src/', async () => {
    writeFixture(tmpDir, {
      'package.json': JSON.stringify({ name: 'multi' }),
      'tsconfig.json': '{}',
      'src/main.ts': 'export {};\n',
      'src/legacy.swift': 'import Foundation\n',
      'src/jvm.kt': 'class A\n',
      'scripts/scrape.py': 'print(1)\n',
      'cmd/cli.go': 'package main\n',
    });
    const result = await detectSkillScope({
      projectRoot: tmpDir,
      installedSkillsPath: join(tmpDir, 'skills'),
    });
    const sig: ProjectSignals = result.projectSignals;
    expect(sig.hasFileExtension?.swift ?? sig.hasFileExtension?.['swift']).toBeTruthy();
    expect(sig.hasFileExtension?.kt ?? sig.hasFileExtension?.['kt']).toBeTruthy();
    expect(sig.hasFileExtension?.py ?? sig.hasFileExtension?.['py']).toBeTruthy();
    expect(sig.hasFileExtension?.go ?? sig.hasFileExtension?.['go']).toBeTruthy();
  });

  test('TC-DETECT-11: idempotent — two --detect invocations on same projectRoot produce identical output', async () => {
    writeTsCliFixture(tmpDir);
    const a = await detectSkillScope({ projectRoot: tmpDir, installedSkillsPath: join(tmpDir, 'skills') });
    const b = await detectSkillScope({ projectRoot: tmpDir, installedSkillsPath: join(tmpDir, 'skills') });
    expect(b.counts).toEqual(a.counts);
    for (const sa of a.skills) {
      const sb = b.skills.find(x => x.name === sa.name);
      expect(sb?.relevance).toBe(sa.relevance);
    }
  });

  test('TC-DETECT-12: --detect is side-effect-free — no files written in tmpDir', async () => {
    writeTsCliFixture(tmpDir);
    detectSkillScope({ projectRoot: tmpDir, installedSkillsPath: join(tmpDir, 'skills') });
    detectSkillScope({ projectRoot: tmpDir, installedSkillsPath: join(tmpDir, 'skills') });
    // Only the fixture files should be at the projectRoot level (not inside src).
    const entries = readdirSync(tmpDir) as string[];
    expect(entries).toContain('package.json');
    expect(entries).toContain('tsconfig.json');
    expect(entries).toContain('skills');
    // Specifically: no .peaks/scope/ directory
    expect(existsSync(join(tmpDir, '.peaks'))).toBe(false);
  });

  test('TC-DETECT-13: --detect returns JSON envelope with detectedIde, projectSignals, skills, counts', async () => {
    writeTsCliFixture(tmpDir);
    const r = await detectSkillScope({ projectRoot: tmpDir, installedSkillsPath: join(tmpDir, 'skills') });
    expect(r).toMatchObject({
      projectSignals: expect.objectContaining({ isTypeScript: true }),
      skills: expect.any(Array),
      counts: expect.objectContaining({
        relevant: expect.any(Number),
        borderline: expect.any(Number),
        irrelevant: expect.any(Number),
      }),
    });
    const sum = r.counts.relevant + r.counts.borderline + r.counts.irrelevant;
    expect(sum).toBe(r.skills.length);
    for (const s of r.skills) {
      expect(s).toMatchObject({
        name: expect.any(String),
        kind: expect.any(String),
        relevance: expect.stringMatching(/^(relevant|borderline|irrelevant)$/),
        reasons: expect.any(Array),
      });
    }
  });
});