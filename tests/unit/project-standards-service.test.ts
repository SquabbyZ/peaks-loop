import { existsSync, mkdirSync, mkdtempSync, rmSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { createProjectStandardsInitPlan, createProjectStandardsUpdatePlan, executeProjectStandardsInit, executeProjectStandardsUpdate, summarizeProjectStandardsInitResult, summarizeProjectStandardsUpdateResult } from '../../src/services/standards/project-standards-service.js';

function createProjectRoot(prefix = 'peaks-standards-project-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function canCreateFileSymlink(): boolean {
  const root = createProjectRoot('peaks-standards-symlink-capability-');
  const source = join(root, 'source.md');
  const target = join(root, 'target.md');
  try {
    writeFileSync(source, '# Source\n', 'utf8');
    symlinkSync(source, target);
    return true;
  } catch {
    return false;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('project standards service', () => {
  test('plans project-local standards writes without mutating the repository', () => {
    const projectRoot = createProjectRoot();
    writeFileSync(join(projectRoot, 'tsconfig.json'), '{}', 'utf8');

    const plan = createProjectStandardsInitPlan({ projectRoot });

    expect(plan.apply).toBe(false);
    expect(plan.language).toBe('typescript');
    expect(plan.source.sourceId).toBe('everything-claude-code');
    expect(plan.plannedWrites.map((write) => write.relativePath)).toEqual([
      'CLAUDE.md',
      '.claude/rules/common/code-review.md',
      '.claude/rules/common/coding-style.md',
      '.claude/rules/common/security.md',
      '.claude/rules/typescript/coding-style.md'
    ]);
    expect(plan.plannedWrites.every((write) => write.status === 'planned')).toBe(true);
    expect(existsSync(join(projectRoot, 'CLAUDE.md'))).toBe(false);
    expect(plan.skillPreflight.appliesTo).toEqual(['peaks-rd', 'peaks-qa', 'peaks-solo']);
    expect(plan.plannedWrites.find((write) => write.relativePath === '.claude/rules/typescript/coding-style.md')?.content).toContain('Do not add new `any` types');
    expect(plan.skillPreflight.summary).toContain('自动 preflight');
  });

  test('applies only missing standards files and preserves existing project standards', () => {
    const projectRoot = createProjectRoot();
    mkdirSync(join(projectRoot, '.claude', 'rules', 'common'), { recursive: true });
    writeFileSync(join(projectRoot, 'package.json'), '{}', 'utf8');
    writeFileSync(join(projectRoot, '.claude', 'rules', 'common', 'coding-style.md'), 'existing standard', 'utf8');

    const result = executeProjectStandardsInit({ projectRoot, language: 'javascript', apply: true });
    const summary = summarizeProjectStandardsInitResult(result);

    expect(result.language).toBe('javascript');
    expect(readFileSync(join(projectRoot, '.claude', 'rules', 'common', 'coding-style.md'), 'utf8')).toBe('existing standard');
    expect(result.plannedWrites.find((write) => write.relativePath === '.claude/rules/common/coding-style.md')?.status).toBe('existing');
    expect(summary.writtenFiles.map((file) => file.replaceAll('\\', '/'))).toEqual([
      'CLAUDE.md',
      '.claude/rules/common/code-review.md',
      '.claude/rules/common/security.md',
      '.claude/rules/javascript/coding-style.md'
    ]);
    expect(summary.skippedFiles).toEqual(['.claude/rules/common/coding-style.md']);
    expect(readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8')).toContain('peaks-rd');
    expect(readFileSync(join(projectRoot, '.claude', 'rules', 'common', 'code-review.md'), 'utf8')).toContain('everything-claude-code');
  });

  test('updates existing CLAUDE.md by appending a managed index and writing missing rules', () => {
    const projectRoot = createProjectRoot('peaks-standards-update-');
    writeFileSync(join(projectRoot, 'CLAUDE.md'), '# Existing Instructions\n\nKeep this body.\n', 'utf8');
    writeFileSync(join(projectRoot, 'tsconfig.json'), '{}', 'utf8');

    const plan = createProjectStandardsUpdatePlan({ projectRoot });

    expect(plan.claudeMd.status).toBe('appended');
    expect(plan.claudeMd.content).toContain('# Existing Instructions');
    expect(plan.claudeMd.content).toContain('<!-- peaks-standards:index:start -->');

    const result = executeProjectStandardsUpdate({ projectRoot, apply: true });
    const summary = summarizeProjectStandardsUpdateResult(result);

    expect(readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8')).toContain('Keep this body.');
    expect(readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8')).toContain('<!-- peaks-standards:index:start -->');
    expect(summary.claudeMd.status).toBe('appended');
    expect(summary.appendedFiles).toEqual(['CLAUDE.md']);
    expect(summary.writtenFiles.map((file) => file.replaceAll('\\\\', '/'))).toEqual([
      '.claude/rules/common/code-review.md',
      '.claude/rules/common/coding-style.md',
      '.claude/rules/common/security.md',
      '.claude/rules/typescript/coding-style.md'
    ]);
    expect(summary.plannedWrites.find((write) => write.relativePath === 'CLAUDE.md')?.status).toBe('appended');
    expect(readFileSync(join(projectRoot, '.claude', 'rules', 'common', 'security.md'), 'utf8')).toContain('Guard filesystem writes');
  });

  test('keeps dry-run update statuses planned and does not write files', () => {
    const projectRoot = createProjectRoot('peaks-standards-update-dry-run-');
    writeFileSync(join(projectRoot, 'tsconfig.json'), '{}', 'utf8');

    const result = executeProjectStandardsUpdate({ projectRoot });
    const summary = summarizeProjectStandardsUpdateResult(result);

    expect(summary.apply).toBe(false);
    expect(summary.claudeMd.status).toBe('planned');
    expect(summary.plannedWrites.find((write) => write.relativePath === 'CLAUDE.md')?.status).toBe('planned');
    expect(summary.writtenFiles).toEqual([]);
    expect(summary.appendedFiles).toEqual([]);
    expect(existsSync(join(projectRoot, 'CLAUDE.md'))).toBe(false);
  });

  test('rejects unsafe update targets before writing missing standards rules', () => {
    const projectRoot = createProjectRoot('peaks-standards-update-unsafe-target-');
    const outsideRoot = createProjectRoot('peaks-standards-update-outside-target-');
    mkdirSync(join(projectRoot, '.claude', 'rules'), { recursive: true });
    symlinkSync(outsideRoot, join(projectRoot, '.claude', 'rules', 'typescript'), 'junction');

    expect(() => executeProjectStandardsUpdate({ projectRoot, language: 'typescript', apply: true })).toThrow('Project standards write target must stay inside the project root');
    expect(existsSync(join(projectRoot, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(projectRoot, '.claude', 'rules', 'common'))).toBe(false);
  });

  test('does not duplicate an existing managed standards index', () => {
    const projectRoot = createProjectRoot('peaks-standards-update-existing-');
    writeFileSync(join(projectRoot, 'tsconfig.json'), '{}', 'utf8');
    const firstResult = executeProjectStandardsUpdate({ projectRoot, apply: true });
    const firstContent = readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8');

    const secondResult = executeProjectStandardsUpdate({ projectRoot, apply: true });
    const secondSummary = summarizeProjectStandardsUpdateResult(secondResult);

    expect(readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8')).toBe(firstContent);
    expect(firstResult.writtenFiles).toContain('CLAUDE.md');
    expect(secondSummary.claudeMd.status).toBe('existing');
    expect(secondSummary.appendedFiles).toEqual([]);
    expect(secondSummary.writtenFiles).toEqual([]);
  });

  test('flags drifted managed standards blocks for manual review', () => {
    const projectRoot = createProjectRoot('peaks-standards-update-review-');
    writeFileSync(join(projectRoot, 'tsconfig.json'), '{}', 'utf8');
    executeProjectStandardsUpdate({ projectRoot, apply: true });
    const driftedContent = readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8').replace('## Peaks Standards Index', '## Drifted Peaks Standards Index');
    writeFileSync(join(projectRoot, 'CLAUDE.md'), driftedContent, 'utf8');

    const plan = createProjectStandardsUpdatePlan({ projectRoot });
    const result = executeProjectStandardsUpdate({ projectRoot, apply: true });
    const summary = summarizeProjectStandardsUpdateResult(result);

    expect(plan.claudeMd.status).toBe('review');
    expect(plan.claudeMd.reviewSuggestions).toEqual(['Existing CLAUDE.md already has a managed standards block. Review the managed block manually before changing it.']);
    expect(summary.claudeMd.status).toBe('review');
    expect(summary.reviewSuggestions).toEqual(['Existing CLAUDE.md already has a managed standards block. Review the managed block manually before changing it.']);
    expect(summary.appendedFiles).toEqual([]);
  });

  test('detects common project languages and falls back to generic standards', () => {
    const javascriptRoot = createProjectRoot('peaks-standards-javascript-');
    const pythonRoot = createProjectRoot('peaks-standards-python-');
    const goRoot = createProjectRoot('peaks-standards-go-');
    const rustRoot = createProjectRoot('peaks-standards-rust-');
    const genericRoot = createProjectRoot('peaks-standards-generic-');
    writeFileSync(join(javascriptRoot, 'package.json'), '{}', 'utf8');
    writeFileSync(join(pythonRoot, 'pyproject.toml'), '', 'utf8');
    writeFileSync(join(goRoot, 'go.mod'), '', 'utf8');
    writeFileSync(join(rustRoot, 'Cargo.toml'), '', 'utf8');

    expect(createProjectStandardsInitPlan({ projectRoot: javascriptRoot }).language).toBe('javascript');
    expect(createProjectStandardsInitPlan({ projectRoot: pythonRoot }).language).toBe('python');
    expect(createProjectStandardsInitPlan({ projectRoot: goRoot }).language).toBe('go');
    expect(createProjectStandardsInitPlan({ projectRoot: rustRoot }).language).toBe('rust');
    expect(createProjectStandardsInitPlan({ projectRoot: genericRoot }).language).toBe('generic');
  });

  test('rejects invalid language values and unsafe standards directories', () => {
    const invalidLanguageRoot = createProjectRoot('peaks-standards-invalid-language-');
    const unsafeProjectRoot = createProjectRoot();
    const nestedUnsafeProjectRoot = createProjectRoot('peaks-standards-nested-unsafe-');
    const outsideRoot = createProjectRoot('peaks-standards-outside-');
    const nestedOutsideRoot = createProjectRoot('peaks-standards-nested-outside-');
    symlinkSync(outsideRoot, join(unsafeProjectRoot, '.claude'), 'junction');
    mkdirSync(join(nestedUnsafeProjectRoot, '.claude', 'rules'), { recursive: true });
    symlinkSync(nestedOutsideRoot, join(nestedUnsafeProjectRoot, '.claude', 'rules', 'common'), 'junction');

    const unsafeClaudeProjectRoot = createProjectRoot('peaks-standards-unsafe-claude-');
    const outsideClaudeRoot = createProjectRoot('peaks-standards-outside-claude-');
    mkdirSync(join(outsideClaudeRoot, '.claude'), { recursive: true });
    writeFileSync(join(outsideClaudeRoot, '.claude', 'CLAUDE.md'), '# Outside\n', 'utf8');
    symlinkSync(join(outsideClaudeRoot, '.claude'), join(unsafeClaudeProjectRoot, '.claude'), 'junction');

    expect(() => createProjectStandardsInitPlan({ projectRoot: invalidLanguageRoot, language: 'type/script' })).toThrow('Unsupported standards language');
    expect(() => createProjectStandardsInitPlan({ projectRoot: unsafeProjectRoot, language: 'typescript' })).toThrow('Project standards directory must stay inside the project root');
    expect(() => executeProjectStandardsInit({ projectRoot: nestedUnsafeProjectRoot, language: 'typescript', apply: true })).toThrow('Project standards write target must stay inside the project root');
    expect(existsSync(join(nestedUnsafeProjectRoot, 'CLAUDE.md'))).toBe(false);
    expect(() => createProjectStandardsUpdatePlan({ projectRoot: unsafeClaudeProjectRoot, language: 'typescript' })).toThrow('Project standards directory must stay inside the project root');
  });

  test.skipIf(!canCreateFileSymlink())('rejects symlinked CLAUDE.md files during standards update planning', () => {
    const projectRoot = createProjectRoot('peaks-standards-unsafe-claude-md-');
    const outsideRoot = createProjectRoot('peaks-standards-outside-claude-md-');
    writeFileSync(join(outsideRoot, 'CLAUDE.md'), '# Linked\n', 'utf8');
    symlinkSync(join(outsideRoot, 'CLAUDE.md'), join(projectRoot, 'CLAUDE.md'));

    expect(() => createProjectStandardsUpdatePlan({ projectRoot, language: 'typescript' })).toThrow('Project standards CLAUDE.md must stay inside the project root');
  });
});
