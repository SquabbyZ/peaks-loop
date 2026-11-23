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

/** Where the governance standard lives, relative to the project root. */
export const DESIGN_GOVERNANCE_RELATIVE_PATH = '.peaks/standards/common/design-governance.md';

/** The opening marker of the managed block. */
export const DESIGN_GOVERNANCE_START_MARKER = '<!-- peaks:design-governance:start -->';

/** The closing marker of the managed block. */
export const DESIGN_GOVERNANCE_END_MARKER = '<!-- peaks:design-governance:end -->';

export type DesignGovernanceStandardInput = {
  readonly projectRoot: string;
  /** The design directory relative to `projectRoot`, e.g. `design` or `web/design`. */
  readonly designRelPath: string;
};

/**
 * The marked governance body. Paths are the project's real design directory,
 * so a contract at `web/design` is described as `web/design/contract.md` rather
 * than a repo-root `design/` that does not exist.
 */
export function renderDesignGovernanceStandard(input: DesignGovernanceStandardInput): string {
  const design = input.designRelPath;
  return [
    DESIGN_GOVERNANCE_START_MARKER,
    '# Design governance (peaks-loop)',
    `- 设计真值：\`${design}/contract.md\` + \`${design}/tokens.json\`（唯一事实源）。`,
    `- 页面代码只能从 \`${design}/paved-road.json\` 的 \`componentEntrypoints\` 引组件；禁止直接引 UI 库（除非在 allow 列表）。`,
    '- 禁止 inline style、裸色值（hex/rgb/hsl）、Tailwind 任意值间距/字号，除非契约显式允许。',
    '- 交付前必须运行 `peaks design check --gate`；证据写入 `.peaks/_runtime/<sessionId>/design/check-<rid>.md`。',
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
