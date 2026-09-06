/**
 * Pure render / template functions extracted from
 * `project-standards-service.ts` (slice 2026-09-06-split-batch-b) so the
 * service stays under the 800-line cap. Behaviour-preserving verbatim move;
 * `export` keywords were added to the symbols the service still imports.
 */

import { buildToolLabel, componentLibraryLabel, cssFrameworkLabel, type ProjectContext } from './project-context.js';
import type { StandardsLanguage } from './project-standards-service.js';

function renderHeader(title: string): string {
  return [
    `# ${title}`,
    '',
    'Source: Peaks curated baseline; everything-claude-code reference: https://github.com/affaan-m/everything-claude-code',
    'Scope: project-local standards for peaks-rd, peaks-qa, and peaks-code workflow preflight.',
    ''
  ].join('\n');
}

function renderProjectStackSection(ctx: ProjectContext): string {
  if (!ctx.hasPackageJson) return '';
  const lines: string[] = ['## Detected project stack', ''];
  lines.push(`- Build tool: ${buildToolLabel(ctx.buildTool)}${ctx.buildConfigPath !== undefined ? ` (\`${ctx.buildConfigPath}\`)` : ''}`);
  lines.push(`- Component library: ${componentLibraryLabel(ctx.componentLibrary)}`);
  if (ctx.cssFrameworks.length > 0) {
    lines.push(`- CSS: ${ctx.cssFrameworks.map(cssFrameworkLabel).join(', ')}`);
  }
  if (ctx.stateManagement.length > 0) lines.push(`- State management: ${ctx.stateManagement.join(', ')}`);
  if (ctx.routing.length > 0) lines.push(`- Routing: ${ctx.routing.join(', ')}`);
  if (ctx.dataFetching.length > 0) lines.push(`- Data fetching: ${ctx.dataFetching.join(', ')}`);
  if (ctx.notableDeps.length > 0) lines.push(`- Notable deps: ${ctx.notableDeps.join(', ')}`);
  lines.push('');
  if (ctx.cssConflicts.length > 0) {
    lines.push('## CSS framework conflicts', '');
    for (const conflict of ctx.cssConflicts) lines.push(`- ${conflict}`);
    lines.push('');
  }
  if (ctx.legacySignals.length > 0) {
    lines.push('## Legacy constraints (preserve for new code in the same modules)', '');
    for (const signal of ctx.legacySignals) lines.push(`- ${signal}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function renderClaudeMd(language: StandardsLanguage, ctx: ProjectContext): string {
  const head = [
    '# Project Instructions',
    '',
    '> 🤖 AI 生成，请审阅',
    '',
    'This repository uses project-local Peaks standards. Existing repository conventions override generic generated guidance.',
    '',
    'Peaks workflow automation:',
    '- peaks-rd checks these standards before RD planning or implementation work.',
    '- peaks-qa checks code review and security guidance before verification work.',
    '- peaks-code summarizes RD and QA standards preflight before end-to-end code workflows.',
    '',
    'Rules:',
    '- Read `.peaks/standards/common/coding-style.md` before editing code.',
    '- Read `.peaks/standards/common/code-review.md` before reviewing changes.',
    '- Read `.peaks/standards/common/security.md` before touching filesystem, user input, external calls, auth, or secrets.',
    `- Read .peaks/standards/${language}/coding-style.md for language-specific standards when applicable.`,
    '',
    'Active Peaks-Loop skill presence: at the start of every response, run `peaks skill presence --json` to read the active skill marker. The CLI handles canonical-path resolution (`.peaks/_runtime/active-skill.json` with back-compat fallback to `.peaks/.active-skill.json`); do not read those files directly. When the response includes a valid skill name, display the compact status header: `Peaks-Loop Skill: <skill> | Peaks-Loop Gate: <gate> | Next: <one short action>`. Display the header on every turn while the CLI returns an active skill; omit when the CLI returns no active skill.'
  ].join('\n');
  const stack = renderProjectStackSection(ctx);
  return stack === '' ? head : `${head}\n${stack}`;
}

export function renderCommonCodingStyle(ctx: ProjectContext): string {
  const baseRules = [
    '- Prefer simple, readable code over clever abstractions.',
    '- Keep functions focused and files cohesive.',
    '- Use immutable updates unless a language-specific convention explicitly favors mutation.',
    '- Validate user input, external data, file paths, and configuration at system boundaries.',
    '- Preserve existing project conventions when they are stricter than this baseline.'
  ];
  const stackRules: string[] = [];
  const lib = ctx.componentLibrary.name;
  if (lib === 'antd' || lib === 'antd-pro') {
    const major = ctx.componentLibrary.majorVersion ?? '5';
    stackRules.push(`- Use existing antd v${major} components (\`Button\`, \`Form\`, \`Table\`, \`Modal\`, \`Select\`). Never mix antd v3/v4/v5 APIs.`);
    stackRules.push(`- Customize antd via \`theme.token\` / \`ConfigProvider\` / \`className\` / \`styles\`. Do NOT apply TailwindCSS utility classes directly to antd components.`);
    if (ctx.componentLibrary.hasProSuite === true) {
      stackRules.push('- Use `@ant-design/pro-components` (`ProTable`, `ProForm`, `ProLayout`) where the page is already pro-based — do not introduce a parallel non-pro table/form.');
    }
  }
  if (lib === 'mui') stackRules.push('- Style MUI via `sx`, `styled()`, and `theme`. Do NOT apply TailwindCSS utility classes directly to MUI components.');
  if (ctx.cssFrameworks.includes('tailwind') && (lib === 'antd' || lib === 'antd-pro' || lib === 'mui')) {
    stackRules.push('- TailwindCSS is for layout/utility only; component-library tokens own component styling.');
  }
  if (ctx.cssFrameworks.includes('less')) stackRules.push('- Less variables in `src/theme/*.less` (or equivalent) are the canonical design tokens — extend them, do not hardcode colors/spacing.');
  if (ctx.stateManagement.length > 0) stackRules.push(`- Follow the existing state library (${ctx.stateManagement.join(', ')}); do not introduce a competing state library.`);
  if (ctx.dataFetching.length > 0) stackRules.push(`- Reuse the existing data-fetching pattern (${ctx.dataFetching.join(', ')}) for new API calls.`);
  for (const signal of ctx.legacySignals) stackRules.push(`- ${signal}`);

  const rules = stackRules.length > 0 ? [...baseRules, '', '## Project-specific rules', ...stackRules] : baseRules;
  return `${renderHeader('Common Coding Standards')}${rules.join('\n')}\n`;
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
    extra.push('- Block PRs that introduce a second component library (MUI/Chakra) alongside antd.');
    extra.push('- Block PRs that import antd v3/v4 APIs in this v5 project, or vice versa.');
  }
  if (ctx.cssFrameworks.includes('tailwind') && (lib === 'antd' || lib === 'antd-pro' || lib === 'mui')) {
    extra.push('- Flag Tailwind utility classes applied directly to component-library primitives; require component-library APIs instead.');
  }
  if (ctx.legacySignals.length > 0) {
    extra.push('- Verify new code in legacy modules preserves the existing patterns (see `.claude/rules/common/coding-style.md` "Project-specific rules").');
  }
  const rules = extra.length > 0 ? [...baseRules, '', '## Project-specific review focus', ...extra] : baseRules;
  return `${renderHeader('Code Review Standards')}${rules.join('\n')}\n`;
}

export function renderSecurity(ctx: ProjectContext): string {
  const baseRules = [
    '- Never hardcode secrets, API keys, passwords, tokens, or credentials.',
    '- Do not send private code or secrets to external services without explicit user authorization.',
    '- Guard filesystem writes against path traversal, symlink, and junction escapes.',
    '- Require explicit confirmation for destructive actions, external state changes, and credential use.'
  ];
  const extra: string[] = [];
  if (ctx.buildTool === 'next') extra.push('- Validate request body / query / params at every API route boundary (`pages/api/**` or `app/api/**`).');
  if (ctx.dataFetching.length > 0) extra.push(`- Sanitize and validate API responses before rendering or persisting (current fetchers: ${ctx.dataFetching.join(', ')}).`);
  if (ctx.notableDeps.includes('monaco-editor') || ctx.notableDeps.includes('@monaco-editor/react')) {
    extra.push('- Monaco editor content is untrusted; never `eval` or `Function`-construct user-authored code without an explicit, reviewed sandbox.');
  }
  const rules = extra.length > 0 ? [...baseRules, '', '## Project-specific security focus', ...extra] : baseRules;
  return `${renderHeader('Security Review Standards')}${rules.join('\n')}\n`;
}

/**
 * UI library priority rule (effective 2026-08-01). Public so unit tests
 * can pin the contract without reaching through the plan builder.
 *
 * Returns the rule line, or `null` when the project has no detected
 * component library (in which case the rule is intentionally silent).
 */
export function renderUiLibraryPriorityRule(ctx: ProjectContext): string | null {
  const lib = ctx.componentLibrary.name;
  const UI_LIB_NAMES = [
    'antd', 'antd-pro', 'mui', 'shadcn',
    'chakra', 'element-plus', 'element-ui',
    'arco', 'tdesign', 'semi', 'nextui'
  ] as const;
  if (!UI_LIB_NAMES.includes(lib as (typeof UI_LIB_NAMES)[number])) {
    return null;
  }
  return `- UI library priority (peaks-loop, effective 2026-08-01): this project uses \`${lib}\`. Prefer the library's exported components over hand-rolled native DOM / HTML primitives. Native DOM is acceptable only for primitives the library does not ship; leave a one-line comment naming the library primitive that was unavailable. Library themes and tokens are the source of truth; do NOT introduce a parallel CSS framework or inline styles that fight the library.`;
}

export function renderLanguageCodingStyle(language: StandardsLanguage, ctx: ProjectContext): string {
  const languageName = language === 'generic' ? 'Generic' : language[0]!.toUpperCase() + language.slice(1);
  const typeSafetyRule = language === 'typescript' || language === 'javascript'
    ? '- Do not add new `any` types; use explicit domain types, generics, or `unknown` with narrowing.\n'
    : '';
  const baseRules = [
    `- Apply project-local conventions before generic ${language} guidance.`,
    `- Keep public APIs typed or documented according to ${language} ecosystem norms.`,
    typeSafetyRule.trim() !== '' ? typeSafetyRule.trim() : null,
    '- Prefer standard tooling and existing project scripts for formatting, linting, tests, and coverage.',
    `- peaks-rd must check this file before planning code changes in ${language} projects.`
  ].filter((line): line is string => line !== null);

  const extra: string[] = [];
  if ((language === 'typescript' || language === 'javascript') && (ctx.componentLibrary.name === 'antd' || ctx.componentLibrary.name === 'antd-pro')) {
    extra.push('- Type form values, table records, and API responses with named interfaces; do not rely on `Form.useForm()` inference for shared shapes.');
  }
  if ((language === 'typescript' || language === 'javascript') && ctx.dataFetching.includes('@tanstack/react-query')) {
    extra.push('- Declare query/mutation generics (`useQuery<TData, TError>`) so consumers get typed data.');
  }
  if ((language === 'typescript' || language === 'javascript') && ctx.buildTool === 'umi') {
    extra.push('- Use the project\'s existing service-layer pattern (`src/services/**`) for API calls; do not hand-roll `fetch` in components.');
  }
  // UI library priority (effective 2026-08-01). Applies to any project whose
  // scan identified one of the supported component libraries; the rule
  // is generated by the standards update so it ships to every downstream
  // project through `peaks standards init/update`.
  const uiRule = renderUiLibraryPriorityRule(ctx);
  if (uiRule !== null) extra.push(uiRule);
  const rules = extra.length > 0 ? [...baseRules, '', '## Project-specific rules', ...extra] : baseRules;
  return `${renderHeader(`${languageName} Coding Standards`)}${rules.join('\n')}\n`;
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

export function renderClaudeMdOneX(language: StandardsLanguage, ctx: ProjectContext): string {
  const head = [
    '# Project Instructions',
    '',
    '> 🤖 AI 生成，请审阅',
    '',
    'This repository uses project-local Peaks standards. Existing repository conventions override generic generated guidance.',
    '',
    'Peaks workflow automation:',
    '- peaks-rd checks these standards before RD planning or implementation work.',
    '- peaks-qa checks code review and security guidance before verification work.',
    '- peaks-code summarizes RD and QA standards preflight before end-to-end code workflows.',
    '',
    'Rules:',
    '- Read `.claude/rules/common/coding-style.md` before editing code.',
    '- Read `.claude/rules/common/code-review.md` before reviewing changes.',
    '- Read `.claude/rules/common/security.md` before touching filesystem, user input, external calls, auth, or secrets.',
    `- Read .claude/rules/${language}/coding-style.md for language-specific standards when applicable.`,
    '',
    'Active Peaks-Loop skill presence: at the start of every response, run `peaks skill presence --json` to read the active skill marker. The CLI handles canonical-path resolution (`.peaks/_runtime/active-skill.json` with back-compat fallback to `.peaks/.active-skill.json`); do not read those files directly. When the response includes a valid skill name, display the compact status header: `Peaks-Loop Skill: <skill> | Peaks-Loop Gate: <gate> | Next: <one short action>`. Display the header on every turn while the CLI returns an active skill; omit when the CLI returns no active skill.'
  ].join('\n');
  const stack = renderProjectStackSection(ctx);
  return stack === '' ? head : `${head}\n${stack}`;
}
