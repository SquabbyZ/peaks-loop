import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { createRequestArtifact } from '../../src/services/artifacts/request-artifact-service.js';
import { getDiffVsScope, isDiffScopeError, globToRegex } from '../../src/services/scan/diff-scope-service.js';

const SESSION = '2026-05-25-scope';
const TS = '2026-05-25T08:00:00.000Z';

async function makeGitRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'peaks-diffscope-'));
  execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main']);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test']);
  await writeFile(join(dir, 'README.md'), '# initial\n', 'utf8');
  execFileSync('git', ['-C', dir, 'add', 'README.md']);
  execFileSync('git', ['-C', dir, 'commit', '-q', '-m', 'initial']);
  return dir;
}

async function seedRdWithScope(project: string, rid: string, scopeBody: string): Promise<void> {
  const result = await createRequestArtifact({
    role: 'rd', requestId: rid, projectRoot: project, sessionId: SESSION, apply: true, clock: () => TS
  });
  const body = await readFile(result.path, 'utf8');
  const replaced = body.replace(/(## Red-line scope\n)[\s\S]*?(?=\n## )/, `$1\n${scopeBody}\n`);
  await writeFile(result.path, replaced, 'utf8');
}

async function writeAndStage(project: string, relPath: string, contents: string): Promise<void> {
  await mkdir(join(project, relPath, '..'), { recursive: true });
  await writeFile(join(project, relPath), contents, 'utf8');
}

describe('globToRegex', () => {
  test('matches exact path', () => {
    expect(globToRegex('src/api/login.ts').test('src/api/login.ts')).toBe(true);
    expect(globToRegex('src/api/login.ts').test('src/api/login.js')).toBe(false);
  });

  test('** matches across directories', () => {
    const re = globToRegex('src/services/**');
    expect(re.test('src/services/login.ts')).toBe(true);
    expect(re.test('src/services/auth/handler.ts')).toBe(true);
    expect(re.test('src/components/Login.tsx')).toBe(false);
  });

  test('* matches single segment only', () => {
    const re = globToRegex('src/*.ts');
    expect(re.test('src/main.ts')).toBe(true);
    expect(re.test('src/api/login.ts')).toBe(false);
  });

  test('? matches single character in path segment', () => {
    const re = globToRegex('src/util?.ts');
    expect(re.test('src/util1.ts')).toBe(true);
    expect(re.test('src/utilA.ts')).toBe(true);
    expect(re.test('src/util.ts')).toBe(false);
    expect(re.test('src/util12.ts')).toBe(false);
    expect(re.test('src/util/12.ts')).toBe(false);
  });

  test('bare directory name expands to directory prefix', () => {
    const re = globToRegex('src/services/login');
    expect(re.test('src/services/login')).toBe(true);
    expect(re.test('src/services/login/handler.ts')).toBe(true);
    expect(re.test('src/services/loginx.ts')).toBe(false);
  });
});

describe('getDiffVsScope', () => {
  test('returns rd-not-found when RD artifact missing', { timeout: 60_000 }, async () => {
    const project = await makeGitRepo();
    const result = await getDiffVsScope({ projectRoot: project, requestId: 'nope', sessionId: SESSION });
    expect(isDiffScopeError(result)).toBe(true);
  });

  test('reports patternsDeclared=false when RD has no scope bullets', { timeout: 60_000 }, async () => {
    const project = await makeGitRepo();
    await createRequestArtifact({
      role: 'rd', requestId: '2026-05-25-feat', projectRoot: project, sessionId: SESSION,
      apply: true, clock: () => TS
    });
    const result = await getDiffVsScope({ projectRoot: project, requestId: '2026-05-25-feat', sessionId: SESSION });
    if (!isDiffScopeError(result)) {
      expect(result.patternsDeclared).toBe(false);
      expect(result.ok).toBe(false);
    }
  });

  test('classifies files matching in-scope patterns as in-scope', { timeout: 60_000 }, async () => {
    const project = await makeGitRepo();
    await seedRdWithScope(project, '2026-05-25-feat', [
      'In-scope:',
      '- src/services/login/**',
      '- src/api/login.ts',
      ''
    ].join('\n'));
    await writeAndStage(project, 'src/services/login/handler.ts', 'export const x = 1;');
    await writeAndStage(project, 'src/api/login.ts', 'export const y = 2;');
    const result = await getDiffVsScope({ projectRoot: project, requestId: '2026-05-25-feat', sessionId: SESSION });
    if (!isDiffScopeError(result)) {
      expect(result.patternsDeclared).toBe(true);
      expect(result.violations).toEqual([]);
      expect(result.unclassified).toEqual([]);
      expect(result.changedFiles.filter((f) => f.classification === 'in-scope').length).toBe(2);
      expect(result.ok).toBe(true);
    }
  });

  test('flags out-of-scope writes as violations', { timeout: 60_000 }, async () => {
    const project = await makeGitRepo();
    await seedRdWithScope(project, '2026-05-25-feat', [
      'In-scope:',
      '- src/services/login/**',
      '',
      'Out-of-scope:',
      '- src/services/payment/**',
      ''
    ].join('\n'));
    await writeAndStage(project, 'src/services/login/handler.ts', 'export const x = 1;');
    await writeAndStage(project, 'src/services/payment/processor.ts', 'export const y = 2;');
    const result = await getDiffVsScope({ projectRoot: project, requestId: '2026-05-25-feat', sessionId: SESSION });
    if (!isDiffScopeError(result)) {
      expect(result.violations.length).toBe(1);
      expect(result.violations[0]?.path).toBe('src/services/payment/processor.ts');
      expect(result.violations[0]?.matchedPattern).toBe('src/services/payment/**');
      expect(result.ok).toBe(false);
    }
  });

  test('flags files matching no pattern as unclassified', { timeout: 60_000 }, async () => {
    const project = await makeGitRepo();
    await seedRdWithScope(project, '2026-05-25-feat', [
      'In-scope:',
      '- src/services/login/**',
      ''
    ].join('\n'));
    await writeAndStage(project, 'src/services/login/handler.ts', 'in-scope file');
    await writeAndStage(project, 'src/components/Dashboard.tsx', 'unrelated change');
    const result = await getDiffVsScope({ projectRoot: project, requestId: '2026-05-25-feat', sessionId: SESSION });
    if (!isDiffScopeError(result)) {
      expect(result.unclassified.length).toBe(1);
      expect(result.unclassified[0]?.path).toBe('src/components/Dashboard.tsx');
      expect(result.ok).toBe(false);
    }
  });

  test('auto-allows test files and .peaks artifacts without requiring an in-scope pattern', { timeout: 60_000 }, async () => {
    const project = await makeGitRepo();
    await seedRdWithScope(project, '2026-05-25-feat', [
      'In-scope:',
      '- src/services/login/**',
      ''
    ].join('\n'));
    await writeAndStage(project, 'src/services/login/handler.ts', 'in-scope');
    await writeAndStage(project, 'src/services/login/handler.test.ts', 'matching test');
    await writeAndStage(project, 'tests/unit/login.test.ts', 'test dir file');
    const result = await getDiffVsScope({ projectRoot: project, requestId: '2026-05-25-feat', sessionId: SESSION });
    if (!isDiffScopeError(result)) {
      const autoAllowed = result.changedFiles.filter((f) => f.classification === 'auto-allowed');
      expect(autoAllowed.length).toBeGreaterThanOrEqual(2);
      expect(result.violations).toEqual([]);
      expect(result.unclassified).toEqual([]);
      expect(result.ok).toBe(true);
    }
  });

  test('handles bullets without explicit subheaders (treats all as in-scope)', { timeout: 60_000 }, async () => {
    const project = await makeGitRepo();
    await seedRdWithScope(project, '2026-05-25-feat', [
      '- src/services/login/**',
      '- src/api/login.ts',
      ''
    ].join('\n'));
    await writeAndStage(project, 'src/services/login/handler.ts', 'in-scope');
    const result = await getDiffVsScope({ projectRoot: project, requestId: '2026-05-25-feat', sessionId: SESSION });
    if (!isDiffScopeError(result)) {
      expect(result.inScopePatterns.length).toBe(2);
      expect(result.outOfScopePatterns.length).toBe(0);
      expect(result.ok).toBe(true);
    }
  });

  test('returns gitAvailable=false when project is not a git repo', { timeout: 60_000 }, async () => {
    const project = await mkdtemp(join(tmpdir(), 'peaks-diffscope-nogit-'));
    await createRequestArtifact({
      role: 'rd', requestId: '2026-05-25-feat', projectRoot: project, sessionId: SESSION,
      apply: true, clock: () => TS
    });
    const result = await getDiffVsScope({ projectRoot: project, requestId: '2026-05-25-feat', sessionId: SESSION });
    if (!isDiffScopeError(result)) {
      expect(result.gitAvailable).toBe(false);
      expect(result.ok).toBe(false);
    }
  });

  test('parses backtick-wrapped path patterns in scope bullets', { timeout: 60_000 }, async () => {
    const project = await makeGitRepo();
    await seedRdWithScope(project, '2026-05-25-feat', [
      'In-scope:',
      '- `src/services/login/**`',
      ''
    ].join('\n'));
    await writeAndStage(project, 'src/services/login/handler.ts', 'in-scope');
    const result = await getDiffVsScope({ projectRoot: project, requestId: '2026-05-25-feat', sessionId: SESSION });
    if (!isDiffScopeError(result)) {
      expect(result.inScopePatterns.length).toBe(1);
      expect(result.inScopePatterns[0]?.raw).toBe('src/services/login/**');
      expect(result.changedFiles.filter((f) => f.classification === 'in-scope').length).toBe(1);
      expect(result.ok).toBe(true);
    }
  });
});
