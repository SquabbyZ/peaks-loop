import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { migrateStandards, NEW_TEMPLATE_TEXT, rewriteLegacyBlock } from '../../../../src/services/standards/migrate-service.js';

function makeProjectRoot(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-migrate-'));
}

const LEGACY_BLOCK = `<!--
  Peaks-Loop 心跳检测 (heartbeat check)
  LLM 每轮回复前必须执行以下步骤，由 CLI 命令强制执行:
  1. 调用 \`peaks skill presence --json\` → 返回有效 skill 则显示 status header
  2. 扫描当前上下文查找 peaks 技能标记
     ("Peaks-Loop Gate", "Peaks-Loop Default runbook", "Peaks-Loop Startup sequence")
  3. 标记存在 → 调用 \`peaks skill heartbeat:touch\` 记录心跳
  4. 标记不存在 → 显示警告 + 调用 \`peaks skill presence:clear\` 关闭心跳
-->
Active Peaks-Loop skill presence: at the start of EVERY response, run these steps in order:

1. Run \`peaks skill presence --json\`. If the CLI returns no active skill, skip all remaining steps.
2. Display the compact status header: \`Peaks-Loop Skill: <skill> | Peaks-Loop Gate: <gate> | Next: <one short action>\`.
3. Scan the current conversation context for peaks skill markers: "Peaks-Loop Gate", "Peaks-Loop Default runbook", "Peaks-Loop Startup sequence", "Peaks-Loop Swarm parallel phase".
4. If at least one marker IS found → run \`peaks skill heartbeat:touch\` to record a successful heartbeat. The CLI command writes the timestamp and returns JSON — verify it succeeded.
5. If NO markers are found → the skill context has been lost (context compaction). Run \`peaks skill presence:clear\` to close the heartbeat, then display this warning:

> ⚠ Peaks-Loop: skill presence file was active but skill context has been lost from the conversation. The workflow can no longer run correctly. Please re-invoke the relevant /peaks-* skill to reload the full skill instructions.

Do NOT skip step 3-5. The CLI heartbeat:touch command is the mechanism that makes heartbeat auditable — failing to call it means the heartbeat is broken.

External reference: https://github.com/affaan-m/everything-claude-code is used as a curated reference only. Do not execute or install external content without explicit approval.
`;

describe('migrate-service', () => {
  let projectRoot: string;
  const claudePath = (root: string): string => join(root, 'CLAUDE.md');

  beforeEach(() => {
    projectRoot = makeProjectRoot();
  });

  afterEach(() => {
    if (existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  // T-M1
  test('T-M1: dry-run on CLAUDE.md with old block → foundOldBlock, wouldChange, no write', () => {
    const original = `# Project Notes\n\n${LEGACY_BLOCK}\n# Tail\n`;
    writeFileSync(claudePath(projectRoot), original, 'utf8');

    const result = migrateStandards({ project: projectRoot });

    expect(result.data.foundOldBlock).toBe(true);
    expect(result.data.wouldChange).toBe(true);
    expect(result.data.applied).toBe(false);
    expect(result.data.before).not.toBeNull();
    expect(result.data.after).not.toBeNull();
    expect(result.data.nextActions).toContain('Re-run with --apply to perform the rewrite');
    // File is unchanged
    expect(readFileSync(claudePath(projectRoot), 'utf8')).toBe(original);
  });

  // T-M2
  test('T-M2: --apply on CLAUDE.md with old block → rewrites, returns applied', () => {
    const original = `# Project Notes\n\n${LEGACY_BLOCK}\n# Tail\n`;
    writeFileSync(claudePath(projectRoot), original, 'utf8');

    const result = migrateStandards({ project: projectRoot, apply: true });

    expect(result.data.applied).toBe(true);
    expect(result.data.foundOldBlock).toBe(true);
    expect(result.data.wouldChange).toBe(true);
    expect(result.data.nextActions).toContain('CLAUDE.md rewritten; no further action required');

    const rewritten = readFileSync(claudePath(projectRoot), 'utf8');
    expect(rewritten).toContain(NEW_TEMPLATE_TEXT);
    expect(rewritten).not.toContain('heartbeat:touch');
    expect(rewritten).not.toContain('presence:clear');
    expect(rewritten).not.toContain('Default runbook');
    expect(rewritten).not.toContain('Startup sequence');
    expect(rewritten).not.toContain('Swarm parallel phase');
    expect(rewritten).not.toContain('Do NOT skip step 3-5');
    expect(rewritten).not.toContain('External reference: https://github.com/affaan-m/everything-claude-code');
    // Surrounding content is preserved
    expect(rewritten).toContain('# Project Notes');
    expect(rewritten).toContain('# Tail');
  });

  // T-M3
  test('T-M3: CLAUDE.md already has new text → returns foundOldBlock false, applied false', () => {
    const alreadyNew = `# Heading\n\n${NEW_TEMPLATE_TEXT}\n# Tail\n`;
    writeFileSync(claudePath(projectRoot), alreadyNew, 'utf8');

    const result = migrateStandards({ project: projectRoot, apply: true });

    expect(result.data.foundOldBlock).toBe(false);
    expect(result.data.wouldChange).toBe(false);
    expect(result.data.applied).toBe(false);
    expect(result.data.nextActions).toContain('CLAUDE.md is already up to date');
    // File is unchanged
    expect(readFileSync(claudePath(projectRoot), 'utf8')).toBe(alreadyNew);
  });

  // T-M4
  test('T-M4: CLAUDE.md does not exist → returns file null, no throw', () => {
    const result = migrateStandards({ project: projectRoot, apply: true });

    expect(result.data.file).toBeNull();
    expect(result.data.foundOldBlock).toBe(false);
    expect(result.data.applied).toBe(false);
    expect(result.data.wouldChange).toBe(false);
    expect(result.data.nextActions).toContain('CLAUDE.md does not exist; nothing to migrate');
  });

  // T-M5
  test('T-M5: CLAUDE.md has no peaks-loop block at all → returns foundOldBlock false', () => {
    const noPeaks = `# Plain\n\nNo peaks-loop content here.\n`;
    writeFileSync(claudePath(projectRoot), noPeaks, 'utf8');

    const result = migrateStandards({ project: projectRoot, apply: true });

    expect(result.data.foundOldBlock).toBe(false);
    expect(result.data.applied).toBe(false);
    expect(result.data.wouldChange).toBe(false);
    expect(result.data.nextActions).toContain('CLAUDE.md has no peaks-loop block; nothing to migrate');
    // File is unchanged
    expect(readFileSync(claudePath(projectRoot), 'utf8')).toBe(noPeaks);
  });

  // Extra coverage: rewriteLegacyBlock is idempotent on already-rewritten content.
  test('rewriteLegacyBlock is a no-op when no legacy block is present', () => {
    const already = `# Heading\n\n${NEW_TEMPLATE_TEXT}\n`;
    const result = rewriteLegacyBlock(already);
    expect(result.replaced).toBe(false);
    expect(result.rewritten).toBe(already);
  });
});
