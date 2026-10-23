/**
 * Pure render / template functions extracted from
 * service stays under the 800-line cap. Behaviour-preserving verbatim move;
 * `export` keywords were added to the symbols the service still imports.
 */

import { type ProjectContext } from './project-context.js';
import type { StandardsLanguage } from './project-standards-service.js';
import { renderHeader } from './standards-render-common.js';

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
    stackRules.push(
      `- Use existing antd v${major} components (\`Button\`, \`Form\`, \`Table\`, \`Modal\`, \`Select\`). Never mix antd v3/v4/v5 APIs.`
    );
    stackRules.push(
      `- Customize antd via \`theme.token\` / \`ConfigProvider\` / \`className\` / \`styles\`. Do NOT apply TailwindCSS utility classes directly to antd components.`
    );
    if (ctx.componentLibrary.hasProSuite === true) {
      stackRules.push(
        '- Use `@ant-design/pro-components` (`ProTable`, `ProForm`, `ProLayout`) where the page is already pro-based — do not introduce a parallel non-pro table/form.'
      );
    }
  }
  if (lib === 'mui')
    stackRules.push(
      '- Style MUI via `sx`, `styled()`, and `theme`. Do NOT apply TailwindCSS utility classes directly to MUI components.'
    );
  if (
    ctx.cssFrameworks.includes('tailwind') &&
    (lib === 'antd' || lib === 'antd-pro' || lib === 'mui')
  ) {
    stackRules.push(
      '- TailwindCSS is for layout/utility only; component-library tokens own component styling.'
    );
  }
  if (ctx.cssFrameworks.includes('less'))
    stackRules.push(
      '- Less variables in `src/theme/*.less` (or equivalent) are the canonical design tokens — extend them, do not hardcode colors/spacing.'
    );
  if (ctx.stateManagement.length > 0)
    stackRules.push(
      `- Follow the existing state library (${ctx.stateManagement.join(', ')}); do not introduce a competing state library.`
    );
  if (ctx.dataFetching.length > 0)
    stackRules.push(
      `- Reuse the existing data-fetching pattern (${ctx.dataFetching.join(', ')}) for new API calls.`
    );
  for (const signal of ctx.legacySignals) stackRules.push(`- ${signal}`);

  const rules =
    stackRules.length > 0
      ? [...baseRules, '', '## Project-specific rules', ...stackRules]
      : baseRules;
  return `${renderHeader('Common Coding Standards')}${rules.join('\n')}\n`;
}

export function renderSecurity(ctx: ProjectContext): string {
  const baseRules = [
    '- Never hardcode secrets, API keys, passwords, tokens, or credentials.',
    '- Do not send private code or secrets to external services without explicit user authorization.',
    '- Guard filesystem writes against path traversal, symlink, and junction escapes.',
    '- Require explicit confirmation for destructive actions, external state changes, and credential use.'
  ];
  const extra: string[] = [];
  if (ctx.buildTool === 'next')
    extra.push(
      '- Validate request body / query / params at every API route boundary (`pages/api/**` or `app/api/**`).'
    );
  if (ctx.dataFetching.length > 0)
    extra.push(
      `- Sanitize and validate API responses before rendering or persisting (current fetchers: ${ctx.dataFetching.join(', ')}).`
    );
  if (
    ctx.notableDeps.includes('monaco-editor') ||
    ctx.notableDeps.includes('@monaco-editor/react')
  ) {
    extra.push(
      '- Monaco editor content is untrusted; never `eval` or `Function`-construct user-authored code without an explicit, reviewed sandbox.'
    );
  }
  const rules =
    extra.length > 0
      ? [...baseRules, '', '## Project-specific security focus', ...extra]
      : baseRules;
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
    'antd',
    'antd-pro',
    'mui',
    'shadcn',
    'chakra',
    'element-plus',
    'element-ui',
    'arco',
    'tdesign',
    'semi',
    'nextui'
  ] as const;
  if (!UI_LIB_NAMES.includes(lib as (typeof UI_LIB_NAMES)[number])) {
    return null;
  }
  return `- UI library priority (peaks-loop, effective 2026-08-01): this project uses \`${lib}\`. Prefer the library's exported components over hand-rolled native DOM / HTML primitives. Native DOM is acceptable only for primitives the library does not ship; leave a one-line comment naming the library primitive that was unavailable. Library themes and tokens are the source of truth; do NOT introduce a parallel CSS framework or inline styles that fight the library.`;
}

export function renderLanguageCodingStyle(
  language: StandardsLanguage,
  ctx: ProjectContext
): string {
  const languageName =
    language === 'generic' ? 'Generic' : language[0]!.toUpperCase() + language.slice(1);
  const typeSafetyRule =
    language === 'typescript' || language === 'javascript'
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
  if (
    (language === 'typescript' || language === 'javascript') &&
    (ctx.componentLibrary.name === 'antd' || ctx.componentLibrary.name === 'antd-pro')
  ) {
    extra.push(
      '- Type form values, table records, and API responses with named interfaces; do not rely on `Form.useForm()` inference for shared shapes.'
    );
  }
  if (
    (language === 'typescript' || language === 'javascript') &&
    ctx.dataFetching.includes('@tanstack/react-query')
  ) {
    extra.push(
      '- Declare query/mutation generics (`useQuery<TData, TError>`) so consumers get typed data.'
    );
  }
  if ((language === 'typescript' || language === 'javascript') && ctx.buildTool === 'umi') {
    extra.push(
      "- Use the project's existing service-layer pattern (`src/services/**`) for API calls; do not hand-roll `fetch` in components."
    );
  }
  // UI library priority (effective 2026-08-01). Applies to any project whose
  // scan identified one of the supported component libraries; the rule is
  // generated by the standards update so it ships to every downstream
  // project through `peaks standards init/update`.
  const uiRule = renderUiLibraryPriorityRule(ctx);
  if (uiRule !== null) extra.push(uiRule);
  const rules =
    extra.length > 0 ? [...baseRules, '', '## Project-specific rules', ...extra] : baseRules;
  return `${renderHeader(`${languageName} Coding Standards`)}${rules.join('\n')}\n`;
}

// `renderHeader` and `PRESENCE_CONTRACT_TEXT` live in standards-render-common.ts
// (imported above); `renderCodeReview` and `renderManagedStandardsIndex` are
// re-exported from there so importers keep using the same path.
export { renderCodeReview, renderManagedStandardsIndex } from './standards-render-common.js';
