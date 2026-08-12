/**
 * Slice 2026-08-12 best-practice-scan — output formatter.
 *
 * Renders the 8-row business-decision comparison table (per spec §5) plus
 * the 3-line footer (spec §5 footer + §7 ⚠️ gate). The formatter is the
 * single source of truth for the artifact's text shape; the standalone
 * template file at `src/templates/best-practice-scan.md` mirrors this
 * shape for human reference.
 *
 * Hard rules enforced here (defensive scans):
 *   - Forbidden words: 会爆 / 头疼 / 黑暗 / 崩
 *   - Forbidden developer-perspective phrases: 代码 50 行 / 学习曲线 / 你的难
 *   - Forbidden binary framing: MVP vs 长期
 *   - Forbidden project-stage judgment: MVP 项目
 *
 * The `★` recommendation marker is placed on the column header whose
 * `recommendation` value (A / B / C) matches `opts.recommendation`.
 */
import type { DocFragment } from './scan-orchestrator.js';

export type RecommendationChoice = 'A' | 'B' | 'C';

export type FormatOptions = {
  readonly intent: string;
  readonly language: string;
  readonly fragments: readonly DocFragment[];
  readonly recommendation: RecommendationChoice;
  readonly reasoning: string;
};

const ROW_LABELS = [
  '技术组合(通俗)',
  'peaks-code 估算',
  'user 看到',
  'user 操作',
  '业务影响(6 个月后)',
  '适用场景',
  '适用场景 (parallel)',
  'LLM 推荐'
] as const;

const FORBIDDEN_WORDS = ['会爆', '头疼', '黑暗', '崩'] as const;
const FORBIDDEN_PHRASES = ['代码 50 行', '学习曲线', '你的难'] as const;
const FORBIDDEN_BINARY = ['MVP vs 长期'] as const;
const FORBIDDEN_STAGE = ['MVP 项目'] as const;

function rowLabel(row: (typeof ROW_LABELS)[number]): string {
  return `| **${row}** | ... | ... | ... |`;
}

function recommendedColumnHeader(label: string, isRecommended: boolean): string {
  return isRecommended ? `**${label} ★**` : label;
}

export function formatOutputTable(opts: FormatOptions): string {
  const cols: ReadonlyArray<{ choice: RecommendationChoice; label: string; body: string }> = [
    {
      choice: 'A',
      label: recommendedColumnHeader('方案 A', opts.recommendation === 'A'),
      body: '面向长期维护,组件复用度高,适合多人协作。'
    },
    {
      choice: 'B',
      label: recommendedColumnHeader('方案 B', opts.recommendation === 'B'),
      body: '中等复杂度,上手快,适合迭代中的小团队。'
    },
    {
      choice: 'C',
      label: recommendedColumnHeader('方案 C', opts.recommendation === 'C'),
      body: '极简实现,适合一次性脚本或概念验证。'
    }
  ];

  const colA = cols[0];
  const colB = cols[1];
  const colC = cols[2];
  if (colA === undefined || colB === undefined || colC === undefined) {
    throw new Error('formatOutputTable: column triple must be present');
  }

  const head = `| ${ROW_LABELS[0]} | ${colA.label} | ${colB.label} | ${colC.label} |`;
  const sep = '| --- | --- | --- | --- |';

  const bodyRows: string[] = [];
  for (let i = 0; i < ROW_LABELS.length; i += 1) {
    const label = ROW_LABELS[i];
    if (label === undefined) continue;
    if (label === 'LLM 推荐') {
      const recCell = cols
        .map((c) => (c.choice === opts.recommendation ? `**${c.choice}**` : c.choice))
        .join(' / ');
      bodyRows.push(`| **${label}** | ${recCell} | ${recCell} | ${recCell} |`);
      continue;
    }
    if (label === '适用场景 (parallel)') {
      bodyRows.push(`| **${label}** | < 5 字段 + < 2 月就用掉 | 字段会增长 + 1 年+ 持续维护 | 灵活配置 + 长期演进 |`);
      continue;
    }
    bodyRows.push(rowLabel(label));
  }

  const reasoningBlock = `> **LLM 推理:** ${opts.reasoning}`;

  const footer = [
    '↩ 默认走方案 ' + opts.recommendation + ';觉得估错 / 推荐不对就告诉我。',
    '⚠️ 任何跟你真实业务不一样,改 — LLM 推荐可能错。',
    '📝 备注:user 体验在 2/3 个方案里几乎一致,差别在 6 个月后的维护成本和你的项目长期节奏。'
  ].join('\n');

  const meta = [
    `language: ${opts.language}`,
    `intent: ${opts.intent}`,
    `fragments: ${opts.fragments.length}`,
    `recommendation: ${opts.recommendation}`
  ].join(' | ');

  return [
    `# Best-Practice Scan — ${opts.intent}`,
    '',
    `> ${meta}`,
    '',
    reasoningBlock,
    '',
    head,
    sep,
    ...bodyRows,
    '',
    footer
  ].join('\n');
}

/**
 * Defensive scan: returns the list of forbidden-word / phrase hits
 * present in the rendered output. The catch-gate test calls this to
 * fail-loud if a future code change reintroduces a banned token.
 */
export function findForbiddenTokens(rendered: string): readonly string[] {
  const hits: string[] = [];
  for (const word of FORBIDDEN_WORDS) {
    if (rendered.includes(word)) hits.push(word);
  }
  for (const phrase of FORBIDDEN_PHRASES) {
    if (rendered.includes(phrase)) hits.push(phrase);
  }
  for (const binary of FORBIDDEN_BINARY) {
    if (rendered.includes(binary)) hits.push(binary);
  }
  for (const stage of FORBIDDEN_STAGE) {
    if (rendered.includes(stage)) hits.push(stage);
  }
  return hits;
}

export const __TEST__ = { ROW_LABELS, FORBIDDEN_WORDS, FORBIDDEN_PHRASES, FORBIDDEN_BINARY, FORBIDDEN_STAGE };