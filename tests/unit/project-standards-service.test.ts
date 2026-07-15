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
      '.peaks/standards/common/code-review.md',
      '.peaks/standards/common/coding-style.md',
      '.peaks/standards/common/security.md',
      '.peaks/standards/typescript/coding-style.md'
    ]);
    expect(plan.plannedWrites.every((write) => write.status === 'planned')).toBe(true);
    expect(existsSync(join(projectRoot, 'CLAUDE.md'))).toBe(false);
    expect(plan.skillPreflight.appliesTo).toEqual(['peaks-rd', 'peaks-qa', 'peaks-code']);
    expect(plan.plannedWrites.find((write) => write.relativePath === '.peaks/standards/typescript/coding-style.md')?.content).toContain('Do not add new `any` types');
    expect(plan.skillPreflight.summary).toContain('自动 preflight');
  });

  test('on a new project, init scaffolds the 2.0 canonical .peaks/standards/ tree (regression: slice 2026-07-15-missing-standards-on-fresh-project)', () => {
    // Bug premise: a consumer project that has never had peaks-loop
    // installed should still receive the 2.0 canonical standards
    // tree at .peaks/standards/ — the previous behaviour only
    // wrote the legacy .claude/rules/ tree, leaving the project
    // without 2.0 red lines.
    const projectRoot = createProjectRoot('peaks-standards-fresh-');
    writeFileSync(join(projectRoot, 'tsconfig.json'), '{}', 'utf8');

    const plan = createProjectStandardsInitPlan({ projectRoot });
    expect(plan.plannedWrites.map((write) => write.relativePath)).toEqual([
      'CLAUDE.md',
      '.peaks/standards/common/code-review.md',
      '.peaks/standards/common/coding-style.md',
      '.peaks/standards/common/security.md',
      '.peaks/standards/typescript/coding-style.md'
    ]);

    const result = executeProjectStandardsInit({ projectRoot, apply: true });
    expect(result.writtenFiles).toEqual([
      'CLAUDE.md',
      '.peaks/standards/common/code-review.md',
      '.peaks/standards/common/coding-style.md',
      '.peaks/standards/common/security.md',
      '.peaks/standards/typescript/coding-style.md'
    ]);
    expect(readFileSync(join(projectRoot, '.peaks', 'standards', 'common', 'coding-style.md'), 'utf8')).toContain('Peaks curated baseline');
    expect(readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8')).toContain('.peaks/standards/common/coding-style.md');
    // Legacy 1.x tree must NOT be silently created on a fresh project.
    expect(existsSync(join(projectRoot, '.claude', 'rules'))).toBe(false);
  });

  test('on a project with thick 1.x .claude/rules/, init preserves the legacy tree (does not silently overwrite to 2.0)', () => {
    // 1.x install footprint: a thick .claude/rules/ tree with
    // body content (NOT a 2-line pointer). The user must run
    // `peaks standards migrate --from-claude-rules` to converge
    // to 2.0; init must not silently rewrite their existing rules.
    const projectRoot = createProjectRoot('peaks-standards-thick-1x-');
    mkdirSync(join(projectRoot, '.claude', 'rules', 'common'), { recursive: true });
    writeFileSync(join(projectRoot, '.claude', 'rules', 'common', 'coding-style.md'), '# 1.x body\n', 'utf8');
    writeFileSync(join(projectRoot, 'tsconfig.json'), '{}', 'utf8');

    const plan = createProjectStandardsInitPlan({ projectRoot });
    // Thick 1.x → falls back to legacy layout; .peaks/standards/ NOT touched.
    expect(plan.plannedWrites.map((write) => write.relativePath)).toEqual([
      'CLAUDE.md',
      '.claude/rules/common/code-review.md',
      '.claude/rules/common/coding-style.md',
      '.claude/rules/common/security.md',
      '.claude/rules/typescript/coding-style.md'
    ]);

    const result = executeProjectStandardsInit({ projectRoot, apply: true });
    // Existing 1.x body preserved verbatim.
    expect(readFileSync(join(projectRoot, '.claude', 'rules', 'common', 'coding-style.md'), 'utf8')).toBe('# 1.x body\n');
    // Missing legacy files filled in via the legacy template path.
    expect(existsSync(join(projectRoot, '.claude', 'rules', 'common', 'code-review.md'))).toBe(true);
    expect(result.plannedWrites.find((write) => write.relativePath === '.claude/rules/common/coding-style.md')?.status).toBe('existing');
    expect(result.plannedWrites.find((write) => write.relativePath === '.claude/rules/common/code-review.md')?.status).toBe('written');
    // 2.0 path was NOT materialised on a thick 1.x project.
    expect(existsSync(join(projectRoot, '.peaks', 'standards'))).toBe(false);
  });

  test('applies only missing standards files and preserves existing project standards', () => {
    const projectRoot = createProjectRoot();
    mkdirSync(join(projectRoot, '.peaks', 'standards', 'common'), { recursive: true });
    writeFileSync(join(projectRoot, 'package.json'), '{}', 'utf8');
    writeFileSync(join(projectRoot, '.peaks', 'standards', 'common', 'coding-style.md'), 'existing standard', 'utf8');

    const result = executeProjectStandardsInit({ projectRoot, language: 'javascript', apply: true });
    const summary = summarizeProjectStandardsInitResult(result);

    expect(result.language).toBe('javascript');
    expect(readFileSync(join(projectRoot, '.peaks', 'standards', 'common', 'coding-style.md'), 'utf8')).toBe('existing standard');
    expect(result.plannedWrites.find((write) => write.relativePath === '.peaks/standards/common/coding-style.md')?.status).toBe('existing');
    expect(summary.writtenFiles.map((file) => file.replaceAll('\\', '/'))).toEqual([
      'CLAUDE.md',
      '.peaks/standards/common/code-review.md',
      '.peaks/standards/common/security.md',
      '.peaks/standards/javascript/coding-style.md'
    ]);
    expect(summary.skippedFiles).toEqual(['.peaks/standards/common/coding-style.md']);
    expect(readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8')).toContain('peaks-rd');
    expect(readFileSync(join(projectRoot, '.peaks', 'standards', 'common', 'code-review.md'), 'utf8')).toContain('everything-claude-code');
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
      '.peaks/standards/common/code-review.md',
      '.peaks/standards/common/coding-style.md',
      '.peaks/standards/common/security.md',
      '.peaks/standards/typescript/coding-style.md'
    ]);
    expect(summary.plannedWrites.find((write) => write.relativePath === 'CLAUDE.md')?.status).toBe('appended');
    expect(readFileSync(join(projectRoot, '.peaks', 'standards', 'common', 'security.md'), 'utf8')).toContain('Guard filesystem writes');
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
    mkdirSync(join(projectRoot, '.peaks', 'standards'), { recursive: true });
    symlinkSync(outsideRoot, join(projectRoot, '.peaks', 'standards', 'typescript'), 'junction');

    expect(() => executeProjectStandardsUpdate({ projectRoot, language: 'typescript', apply: true })).toThrow('Project standards write target must stay inside the project root');
    expect(existsSync(join(projectRoot, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(projectRoot, '.peaks', 'standards', 'common'))).toBe(false);
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
    symlinkSync(outsideRoot, join(unsafeProjectRoot, '.peaks'), 'junction');
    mkdirSync(join(nestedUnsafeProjectRoot, '.peaks', 'standards'), { recursive: true });
    symlinkSync(nestedOutsideRoot, join(nestedUnsafeProjectRoot, '.peaks', 'standards', 'common'), 'junction');

    const unsafeClaudeProjectRoot = createProjectRoot('peaks-standards-unsafe-claude-');
    const outsideClaudeRoot = createProjectRoot('peaks-standards-outside-claude-');
    mkdirSync(join(outsideClaudeRoot, '.peaks', 'standards'), { recursive: true });
    writeFileSync(join(outsideClaudeRoot, '.peaks', 'standards', 'CLAUDE.md'), '# Outside\n', 'utf8');
    mkdirSync(join(unsafeClaudeProjectRoot, '.peaks'), { recursive: true });
    symlinkSync(join(outsideClaudeRoot, '.peaks', 'standards'), join(unsafeClaudeProjectRoot, '.peaks', 'standards'), 'junction');

    expect(() => createProjectStandardsInitPlan({ projectRoot: invalidLanguageRoot, language: 'type/script' })).toThrow('Unsupported standards language');
    expect(() => createProjectStandardsInitPlan({ projectRoot: unsafeProjectRoot, language: 'typescript' })).toThrow('Project standards directory must stay inside the project root');
    expect(() => executeProjectStandardsInit({ projectRoot: nestedUnsafeProjectRoot, language: 'typescript', apply: true })).toThrow('Project standards write target must stay inside the project root');
    expect(existsSync(join(nestedUnsafeProjectRoot, 'CLAUDE.md'))).toBe(false);
    expect(() => createProjectStandardsUpdatePlan({ projectRoot: unsafeClaudeProjectRoot, language: 'typescript' })).toThrow('Project standards directory must stay inside the project root');
  });

  test('rejects directory-linked CLAUDE.md targets during standards update planning', () => {
    const projectRoot = createProjectRoot('peaks-standards-unsafe-claude-md-dir-');
    const outsideRoot = createProjectRoot('peaks-standards-outside-claude-md-dir-');
    symlinkSync(outsideRoot, join(projectRoot, 'CLAUDE.md'), 'junction');

    expect(() => createProjectStandardsUpdatePlan({ projectRoot, language: 'typescript' })).toThrow('Project standards CLAUDE.md must stay inside the project root');
  });

  test.skipIf(!canCreateFileSymlink())('rejects symlinked CLAUDE.md files during standards update planning', () => {
    const projectRoot = createProjectRoot('peaks-standards-unsafe-claude-md-');
    const outsideRoot = createProjectRoot('peaks-standards-outside-claude-md-');
    writeFileSync(join(outsideRoot, 'CLAUDE.md'), '# Linked\n', 'utf8');
    symlinkSync(join(outsideRoot, 'CLAUDE.md'), join(projectRoot, 'CLAUDE.md'));

    expect(() => createProjectStandardsUpdatePlan({ projectRoot, language: 'typescript' })).toThrow('Project standards CLAUDE.md must stay inside the project root');
  });

  test('interpolates detected stack into CLAUDE.md and rules for antd + Umi + Tailwind projects', () => {
    const projectRoot = createProjectRoot('peaks-standards-stack-antd-');
    writeFileSync(join(projectRoot, 'tsconfig.json'), '{}', 'utf8');
    writeFileSync(join(projectRoot, '.umirc.ts'), 'export default {};\n', 'utf8');
    writeFileSync(
      join(projectRoot, 'package.json'),
      JSON.stringify({
        dependencies: {
          antd: '^5.12.0',
          '@ant-design/pro-components': '^2.0.0',
          '@umijs/max': '^4.0.0',
          ahooks: '^3.7.0',
          tailwindcss: '^3.4.0',
          less: '^4.2.0',
          'monaco-editor': '^0.45.0',
          '@tanstack/react-query': '^5.0.0'
        },
        devDependencies: {
          moment: '^2.29.0'
        }
      }),
      'utf8'
    );

    const result = executeProjectStandardsInit({ projectRoot, apply: true });
    const claudeMd = readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8');
    const codingStyle = readFileSync(join(projectRoot, '.peaks', 'standards', 'common', 'coding-style.md'), 'utf8');
    const codeReview = readFileSync(join(projectRoot, '.peaks', 'standards', 'common', 'code-review.md'), 'utf8');
    const security = readFileSync(join(projectRoot, '.peaks', 'standards', 'common', 'security.md'), 'utf8');
    const tsStyle = readFileSync(join(projectRoot, '.peaks', 'standards', 'typescript', 'coding-style.md'), 'utf8');

    expect(result.writtenFiles).toContain('CLAUDE.md');
    // CLAUDE.md surfaces detected stack
    expect(claudeMd).toContain('## Detected project stack');
    expect(claudeMd).toContain('Build tool: Umi');
    expect(claudeMd).toContain('Ant Design + Ant Design Pro v5');
    expect(claudeMd).toContain('TailwindCSS');
    expect(claudeMd).toContain('ahooks');
    expect(claudeMd).toContain('## CSS framework conflicts');
    expect(claudeMd).toContain('Tailwind preflight');
    expect(claudeMd).toContain('## Legacy constraints');
    expect(claudeMd).toContain('moment');
    // Data fetching surfaces @tanstack/react-query in CLAUDE.md
    expect(claudeMd).toContain('@tanstack/react-query');

    // Coding style file carries project-specific rules
    expect(codingStyle).toContain('## Project-specific rules');
    expect(codingStyle).toContain('antd v5');
    expect(codingStyle).toContain('Do NOT apply TailwindCSS utility classes directly to antd components');
    expect(codingStyle).toContain('@ant-design/pro-components');

    // Code review picks up antd / Tailwind conflicts
    expect(codeReview).toContain('Block PRs that introduce a second component library');
    expect(codeReview).toContain('Tailwind utility classes applied directly to component-library primitives');

    // Security picks up Monaco
    expect(security).toContain('Monaco editor content is untrusted');

    // TypeScript file mentions service-layer pattern and react-query typing rule
    expect(tsStyle).toContain('src/services/**');
    expect(tsStyle).toContain('useQuery<TData, TError>');
  });
});

  test('detects element-plus component library', () => {
    const projectRoot = createProjectRoot('peaks-standards-elplus-');
    writeFileSync(join(projectRoot, 'tsconfig.json'), '{}', 'utf8');
    writeFileSync(join(projectRoot, 'vite.config.ts'), 'export default {};\n', 'utf8');
    writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({
      dependencies: {
        'element-plus': '^2.5.0',
        vue: '^3.4.0'
      }
    }), 'utf8');

    const result = executeProjectStandardsInit({ projectRoot, apply: true });
    const claudeMd = readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8');
    expect(result.writtenFiles).toContain('CLAUDE.md');
    expect(claudeMd).toContain('Element Plus');
    rmSync(projectRoot, { recursive: true, force: true });
  });

  test('detects chakra-ui component library', () => {
    const projectRoot = createProjectRoot('peaks-standards-chakra-');
    writeFileSync(join(projectRoot, 'tsconfig.json'), '{}', 'utf8');
    writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({
      dependencies: {
        '@chakra-ui/react': '^2.8.0',
        react: '^18.0.0'
      }
    }), 'utf8');

    const result = executeProjectStandardsInit({ projectRoot, apply: true });
    const claudeMd = readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toContain('Chakra UI');
    rmSync(projectRoot, { recursive: true, force: true });
  });

  test('detects vant component library for mobile projects', () => {
    const projectRoot = createProjectRoot('peaks-standards-vant-');
    writeFileSync(join(projectRoot, 'tsconfig.json'), '{}', 'utf8');
    writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({
      dependencies: {
        vant: '^4.8.0',
        vue: '^3.4.0'
      }
    }), 'utf8');

    const result = executeProjectStandardsInit({ projectRoot, apply: true });
    const claudeMd = readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toContain('Vant');
    rmSync(projectRoot, { recursive: true, force: true });
  });

  test('detects arco-design component library', () => {
    const projectRoot = createProjectRoot('peaks-standards-arco-');
    writeFileSync(join(projectRoot, 'tsconfig.json'), '{}', 'utf8');
    writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({
      dependencies: { '@arco-design/web-react': '^2.60.0', react: '^18.0.0' }
    }), 'utf8');
    executeProjectStandardsInit({ projectRoot, apply: true });
    const claudeMd = readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toContain('Arco Design');
    rmSync(projectRoot, { recursive: true, force: true });
  });

  test('detects tdesign component library', () => {
    const projectRoot = createProjectRoot('peaks-standards-td-');
    writeFileSync(join(projectRoot, 'tsconfig.json'), '{}', 'utf8');
    writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({
      dependencies: { 'tdesign-react': '^1.7.0', react: '^18.0.0' }
    }), 'utf8');
    executeProjectStandardsInit({ projectRoot, apply: true });
    const claudeMd = readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toContain('TDesign');
    rmSync(projectRoot, { recursive: true, force: true });
  });

  test('detects semi-design component library', () => {
    const projectRoot = createProjectRoot('peaks-standards-semi-');
    writeFileSync(join(projectRoot, 'tsconfig.json'), '{}', 'utf8');
    writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({
      dependencies: { '@douyinfe/semi-ui': '^2.50.0', react: '^18.0.0' }
    }), 'utf8');
    executeProjectStandardsInit({ projectRoot, apply: true });
    const claudeMd = readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toContain('Semi Design');
    rmSync(projectRoot, { recursive: true, force: true });
  });

  test('detects nextui component library', () => {
    const projectRoot = createProjectRoot('peaks-standards-nextui-');
    writeFileSync(join(projectRoot, 'tsconfig.json'), '{}', 'utf8');
    writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({
      dependencies: { '@nextui-org/react': '^2.4.0', react: '^18.0.0' }
    }), 'utf8');
    executeProjectStandardsInit({ projectRoot, apply: true });
    const claudeMd = readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toContain('NextUI');
    rmSync(projectRoot, { recursive: true, force: true });
  });

  // T-028-1: slice 028 — the consumer-facing CLAUDE.md template
  // must not leak heartbeat-touch / presence:clear LLM instructions
  // or the everything-claude-code external reference.
  test('T-028-1: rendered head section drops heartbeat text and references peaks skill presence', () => {
    const projectRoot = createProjectRoot('peaks-standards-slice-028-');
    writeFileSync(join(projectRoot, 'tsconfig.json'), '{}', 'utf8');
    const result = executeProjectStandardsInit({ projectRoot, apply: true });
    expect(result.writtenFiles).toContain('CLAUDE.md');
    const claudeMd = readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8');

    // Forbidden legacy strings
    expect(claudeMd).not.toContain('heartbeat:touch');
    expect(claudeMd).not.toContain('presence:clear');
    expect(claudeMd).not.toContain('everything-claude-code');
    expect(claudeMd).not.toContain('Default runbook');
    expect(claudeMd).not.toContain('Startup sequence');
    expect(claudeMd).not.toContain('Swarm parallel phase');
    expect(claudeMd).not.toContain('Do NOT skip step');
    expect(claudeMd).not.toContain('<!-- Peaks-Loop 心跳检测');

    // Required new-shape markers
    expect(claudeMd).toContain('peaks skill presence --json');
    expect(claudeMd).toContain('Peaks-Loop Skill: <skill>');

    rmSync(projectRoot, { recursive: true, force: true });
  });
