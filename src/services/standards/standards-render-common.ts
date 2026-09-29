/**
 * `src/services/standards/standards-render-common.ts`
 *
 * Shared header renderer, code-review standards, and managed CLAUDE.md
 * index block extracted verbatim from `standards-render.ts` (wave 2,
 * file-size cap campaign) so the render module stays under the 300
 * raw-line cap. Mechanical move only; `renderHeader` was module-private
 * before the move and the other two renderers are re-exported from
 * `standards-render.ts` so importers keep the original path.
 */
import type { ProjectContext } from './project-context.js';
import type { StandardsLanguage } from './project-standards-service.js';

export function renderHeader(title: string): string {
  return [
    `# ${title}`,
    '',
    'Source: Peaks curated baseline; everything-claude-code reference: https://github.com/affaan-m/everything-claude-code',
    'Scope: project-local standards for peaks-rd, peaks-qa, and peaks-code workflow preflight.',
    ''
  ].join('\n');
}

export function renderCodeReview(ctx: ProjectContext): string {
  const baseRules = [
    '- Review diffs for correctness, maintainability, test coverage, and regression risk.',
    '- Treat missing tests for changed behavior as a blocker unless the change is documentation-only.',
    '- Verify code paths that handle filesystem, external APIs, credentials, user input, or generated artifacts.',
    '- peaks-qa must use this guidance as part of code workflow preflight and final verification.'
  ];
  const extra: string[] = [];
  const lib = ctx.componentLibrary.name;
  if (lib === 'antd' || lib === 'antd-pro') {
    extra.push(
      '- Block PRs that introduce a second component library (MUI/Chakra) alongside antd.'
    );
    extra.push('- Block PRs that import antd v3/v4 APIs in this v5 project, or vice versa.');
  }
  if (
    ctx.cssFrameworks.includes('tailwind') &&
    (lib === 'antd' || lib === 'antd-pro' || lib === 'mui')
  ) {
    extra.push(
      '- Flag Tailwind utility classes applied directly to component-library primitives; require component-library APIs instead.'
    );
  }
  if (ctx.legacySignals.length > 0) {
    extra.push(
      '- Verify new code in legacy modules preserves the existing patterns (see `.claude/rules/common/coding-style.md` "Project-specific rules").'
    );
  }
  const rules =
    extra.length > 0 ? [...baseRules, '', '## Project-specific review focus', ...extra] : baseRules;
  return `${renderHeader('Code Review Standards')}${rules.join('\n')}\n`;
}

export function renderManagedClaudeMdIndex(language: StandardsLanguage): string {
  return [
    '<!-- peaks-standards:index:start -->',
    '## Peaks Standards Index',
    '- Constitution: `CLAUDE.md` is the repository-wide constitution.',
    '- Local laws: `.peaks/standards/**` are project-local laws and are created only when missing.',
    '- Managed by: `peaks standards update`.',
    '- Managed files:',
    '  - `.peaks/standards/common/code-review.md`',
    '  - `.peaks/standards/common/coding-style.md`',
    '  - `.peaks/standards/common/security.md`',
    `  - .peaks/standards/${language}/coding-style.md`,
    '- Conflict note: keep the existing body unchanged and resolve any disagreement manually before the next standards update.',
    '<!-- peaks-standards:index:end -->',
    ''
  ].join('\n');
}
