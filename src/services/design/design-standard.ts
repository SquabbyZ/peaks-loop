/**
 * The project-local design governance standard.
 *
 * WHY A STANDALONE FILE, NOT A LINE IN `coding-style.md`. `peaks standards
 * init/update` only ever writes a rules file that is ABSENT — an existing
 * `coding-style.md` is reported as `existing` and left alone — so injecting
 * prose into that renderer would never reach a downstream project that already
 * has one. A file of its own has the opposite property: `design init` writes
 * it, `design uninit` deletes it, and the two live and die with the contract.
 *
 * The marked block is what makes the write idempotent: a second run REPLACES
 * the block instead of appending a duplicate, so the file never grows a second
 * governance section.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { assertSafeDesignWritePath } from './contract-writer.js';

/** Where the governance standard lives, relative to the project root. */
export const DESIGN_GOVERNANCE_RELATIVE_PATH = '.peaks/standards/common/design-governance.md';

/** The opening marker of the managed block. */
export const DESIGN_GOVERNANCE_START_MARKER = '<!-- peaks:design-governance:start -->';

/** The closing marker of the managed block. */
export const DESIGN_GOVERNANCE_END_MARKER = '<!-- peaks:design-governance:end -->';

/**
 * `design/exemplars/README.md`. It sits beside the screenshots so the redaction
 * rule is in front of whoever registers one, and it is written once — a user
 * edit is never overwritten.
 */
export const DESIGN_EXEMPLARS_README = `# Design exemplars

Registration is a file convention: \`design/exemplars/<archetype>/\` holds \`meta.json\` (route, source file, screenshot path, generated time), the exemplar source \`<name>.tsx\`, and its screenshot \`<name>.png\`.

Only redacted or synthetic screenshots may be committed; never a screenshot carrying real customer data.

Runtime screenshots and visual-regression baselines live under \`.peaks/_runtime/<sessionId>/design/\` and are gitignored.
`;

export type DesignGovernanceStandardInput = {
  readonly projectRoot: string;
  /** The design directory relative to `projectRoot`, e.g. `design` or `web/design`. */
  readonly designRelPath: string;
};

/**
 * Wrap `value` in a markdown code span that survives a backtick inside it.
 *
 * A directory name is not under the governance writer's control, so a backtick
 * in it must not be able to close the span and inject prose into a file agents
 * are told to read: the fence grows past the longest backtick run in the value.
 */
function codeSpan(value: string): string {
  const longest = (value.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = '`'.repeat(longest + 1);
  return `${fence}${value}${fence}`;
}

/**
 * The marked governance body. Paths are the project's real design directory,
 * so a contract at `web/design` is described as `web/design/contract.md` rather
 * than a repo-root `design/` that does not exist.
 *
 * The delivery line names the S1 diagnostic honestly: `--gate` is S3, so
 * telling a downstream agent to run it would point at an unknown option.
 */
export function renderDesignGovernanceStandard(input: DesignGovernanceStandardInput): string {
  const design = input.designRelPath;
  return [
    DESIGN_GOVERNANCE_START_MARKER,
    '# Design governance (peaks-loop)',
    `- 设计真值：${codeSpan(`${design}/contract.md`)} + ${codeSpan(`${design}/tokens.json`)}（唯一事实源）。`,
    `- 页面代码只能从 ${codeSpan(`${design}/paved-road.json`)} 的 ${codeSpan('componentEntrypoints')} 引组件；禁止直接引 UI 库（除非在 allow 列表）。`,
    '- 禁止 inline style、裸色值（hex/rgb/hsl）、Tailwind 任意值间距/字号，除非契约显式允许。',
    `- S1 的诊断是 ${codeSpan('peaks design check --allow-source-only --accept-note "<用户原话>"')}；${codeSpan('--gate')} 门禁在 S3 提供，证据写入 ${codeSpan('.peaks/_runtime/<sessionId>/design/check-<rid>.md')}。`,
    `- 黄金范例登记是文件约定：${codeSpan(`${design}/exemplars/<archetype>/`)} 下放 ${codeSpan('meta.json')}、${codeSpan('<name>.tsx')}、${codeSpan('<name>.png')}；截图只允许脱敏或合成（见 ${codeSpan(`${design}/exemplars/README.md`)}），runtime 截图与 baseline 一律 gitignored。`,
    DESIGN_GOVERNANCE_END_MARKER
  ].join('\n');
}

/**
 * Replace the marked block when it exists, append it otherwise.
 *
 * A file holding only one of the two markers (an interrupted write) is spliced
 * from its start marker to the end of the file, so a damaged file cannot end up
 * with two blocks.
 */
function spliceBlock(existing: string, block: string): string {
  const start = existing.indexOf(DESIGN_GOVERNANCE_START_MARKER);
  if (start !== -1) {
    const end = existing.indexOf(DESIGN_GOVERNANCE_END_MARKER, start);
    const tail = end === -1 ? '' : existing.slice(end + DESIGN_GOVERNANCE_END_MARKER.length);
    return `${existing.slice(0, start)}${block}${tail}`;
  }
  if (existing.trim() === '') return `${block}\n`;
  return `${existing.trimEnd()}\n\n${block}\n`;
}

/**
 * Write the governance standard, creating its parent directories.
 *
 * `written` is `false` when the file already carries exactly this block — an
 * unchanged file is not rewritten, so a repeated `design init` leaves its
 * mtime alone.
 */
export async function writeDesignGovernanceStandard(
  input: DesignGovernanceStandardInput
): Promise<{ written: boolean; path: string }> {
  const filePath = resolve(input.projectRoot, DESIGN_GOVERNANCE_RELATIVE_PATH);
  assertSafeDesignWritePath(filePath, input.projectRoot);
  const existing = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
  const next = spliceBlock(existing, renderDesignGovernanceStandard(input));
  if (next === existing) return { written: false, path: filePath };
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, next, 'utf8');
  return { written: true, path: filePath };
}

/**
 * Delete the governance standard when it is present.
 *
 * A missing file is not an error: `design uninit` runs on projects that may
 * never have adopted the standard.
 */
export async function removeDesignGovernanceStandard(
  projectRoot: string
): Promise<{ removed: boolean; path: string }> {
  const filePath = resolve(projectRoot, DESIGN_GOVERNANCE_RELATIVE_PATH);
  if (!existsSync(filePath)) return { removed: false, path: filePath };
  rmSync(filePath);
  return { removed: true, path: filePath };
}
