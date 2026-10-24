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

/**
 * The skill-presence / status-header contract every Peaks instruction file
 * carries.
 *
 * ONE source for the text: the AGENTS.md body renders it verbatim and
 * `peaks standards migrate` replaces the legacy heartbeat block with exactly
 * this paragraph — so a migrated file and a freshly generated one cannot
 * drift apart.
 *
 * THE HEADER IS FIVE SEGMENTS. `Peaks-Loop Skill | Peaks-Loop Role |
 * Peaks-Loop Gate | Peaks-Loop Context | Next` — the shape the response
 * contract in `.claude/output-styles/peaks-skill-swarm.md` publishes. Every
 * cell but `Next` is a MACHINE FACT read from one `peaks skill presence --json`
 * call: `data.skill`, `data.role`, `data.gate`, `data.context.ratioPct` and
 * `data.context.action`. The contract therefore names where each cell comes
 * from, because a cell the model fills in from its own judgement is not a
 * status header — it is prose with a header's punctuation.
 *
 * THE PATH IS THE CORRECTED ONE. `.peaks/_runtime/active-skill.json` and its
 * legacy sibling `.peaks/.active-skill.json` were removed from the presence
 * service in 4.0.11; the canonical projection is the session-scoped lease at
 * `.peaks/_runtime/<sessionId>/leases/presence-*.json`. The instruction is
 * "ask the CLI", because the CLI is what resolves the lease.
 */
export const PRESENCE_CONTRACT_TEXT =
  'Active Peaks-Loop skill presence: at the start of every response, run `peaks skill presence --json` to read the active skill marker. The CLI resolves the session-scoped presence lease at `.peaks/_runtime/<sessionId>/leases/presence-*.json`; do not read those files directly. When the response includes a valid skill name, display the compact status header: `Peaks-Loop Skill: <skill> | Peaks-Loop Role: <role> | Peaks-Loop Gate: <gate> | Peaks-Loop Context: <ratio%> (<zone>) | Next: <one short action>`. Copy `<role>` from the `data.role` field of that same read (`orchestrator` or `bee`; `null` for a skill outside both lists), and copy `<ratio%>` and `<zone>` from the `data.context.ratioPct` and `data.context.action` fields of that read — never judge the tier or estimate the context fill yourself. Display the header on every turn while the CLI returns an active skill; omit it when the CLI returns no active skill.';

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

/**
 * The managed standards block `peaks standards update` maintains.
 *
 * It names `AGENTS.md` as the constitution because that is where the body
 * lives now; `CLAUDE.md` imports it. The block is appended to whichever
 * constitution file the writer owns, so it must read correctly in both.
 *
 * `rulesRoot` is the directory the project's standards actually live in:
 * `.peaks/standards` for the 2.0 canonical layout, `.claude/rules` for a
 * project still carrying the 1.x tree. The block names FILES, so it must
 * name the ones that are really there.
 */
export function renderManagedStandardsIndex(
  language: StandardsLanguage,
  rulesRoot: string
): string {
  return [
    '<!-- peaks-standards:index:start -->',
    '## Peaks Standards Index',
    '- Constitution: `AGENTS.md` is the repository-wide constitution.',
    `- Local laws: \`${rulesRoot}/**\` are project-local laws and are created only when missing.`,
    '- Managed by: `peaks standards update`.',
    '- Managed files:',
    `  - \`${rulesRoot}/common/code-review.md\``,
    `  - \`${rulesRoot}/common/coding-style.md\``,
    `  - \`${rulesRoot}/common/security.md\``,
    `  - ${rulesRoot}/${language}/coding-style.md`,
    '- Conflict note: keep the existing body unchanged and resolve any disagreement manually before the next standards update.',
    '<!-- peaks-standards:index:end -->',
    ''
  ].join('\n');
}
