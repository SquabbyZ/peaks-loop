/**
 * v2.15.0 follow-up — G3 tests: prd 4 必填块 checker.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkPrdBlocks, findPrdArtifact, detectForkProject } from '../../../../src/services/prd/prd-blocks-checker.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'peaks-prd-test-'));
});

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

function writePrdArtifact(dir: string, body: string): string {
  const requestsDir = join(dir, '.peaks', '_runtime', 'prd', 'requests');
  mkdirSync(requestsDir, { recursive: true });
  const file = join(requestsDir, 'test-rid.md');
  writeFileSync(file, body, 'utf8');
  return file;
}

describe('findPrdArtifact', () => {
  it('finds the artifact in the standard layout', () => {
    const file = writePrdArtifact(tmpDir, '# PRD\n');
    expect(findPrdArtifact(tmpDir, 'test-rid')).toBe(file);
  });
  it('returns null when no artifact exists', () => {
    expect(findPrdArtifact(tmpDir, 'nope')).toBeNull();
  });
});

describe('detectForkProject', () => {
  it('returns true when .peaks/fork-state.json exists', () => {
    const path = join(tmpDir, '.peaks');
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'fork-state.json'), '{}', 'utf8');
    expect(detectForkProject(tmpDir)).toBe(true);
  });
  it('returns false when no fork state file exists', () => {
    expect(detectForkProject(tmpDir)).toBe(false);
  });
});

describe('checkPrdBlocks — block detection', () => {
  it('reports all 4 blocks missing when artifact is empty', () => {
    writePrdArtifact(tmpDir, '# PRD Title\n\njust a title.');
    const report = checkPrdBlocks(tmpDir, 'test-rid');
    expect(report.findings).toHaveLength(4);
    expect(report.findings[0]?.present).toBe(false);
    expect(report.findings[3]?.present).toBe(false);
    expect(report.ok).toBe(false);
  });

  it('detects 业务场景 block with substantive content', () => {
    const content = `# PRD

## 业务场景

目标用户: 企业 IT 管理员 + 普通员工 + 第三方开发者。
业务流程: 用户注册 → 邀请 → 角色分配 → 资源访问。
性能预期: 100 并发。
业务禁区: 越权访问、数据跨租户泄漏。
`;
    writePrdArtifact(tmpDir, content);
    const report = checkPrdBlocks(tmpDir, 'test-rid');
    const b1 = report.findings[0]!;
    expect(b1.present).toBe(true);
    expect(b1.issues.length).toBe(0);
  });

  it('flags 业务场景 block missing 业务禁区 sub-section', () => {
    const content = `# PRD

## 业务场景

目标用户: 企业 IT 管理员。业务流程: 注册 → 邀请。
`;
    writePrdArtifact(tmpDir, content);
    const report = checkPrdBlocks(tmpDir, 'test-rid');
    const b1 = report.findings[0]!;
    expect(b1.present).toBe(true);
    expect(b1.issues.some((i) => i.includes('业务禁区'))).toBe(true);
  });

  it('flags a block whose content is too short', () => {
    const content = `# PRD

## 边界 case

todo.
`;
    writePrdArtifact(tmpDir, content);
    const report = checkPrdBlocks(tmpDir, 'test-rid');
    const b2 = report.findings[1]!;
    expect(b2.present).toBe(true);
    expect(b2.issues.some((i) => i.includes('too short'))).toBe(true);
  });

  it('block 4 (上游基线) is NOT required when not a fork project', () => {
    const content = `# PRD

## 业务场景

目标用户: 企业 IT 管理员。业务流程: 注册 → 邀请 → 角色分配。性能: 100 并发。业务禁区: 越权。

## 边界 case

无权限 / 越权 / 跨租户 / 数据迁移兼容 / 错误提示 / 空加载失败状态。多角色 / 多租户 / 越权场景。数据迁移兼容。

## UI 装配意图

页面模式: 列表 / 详情 / 表单 / 抽屉 / 弹窗 / 卡片。关键交互: 搜索 / 过滤 / 排序 / 批量操作 / 拖拽。信息密度: 紧凑(数据后台)。
`;
    writePrdArtifact(tmpDir, content);
    const report = checkPrdBlocks(tmpDir, 'test-rid');
    expect(report.isFork).toBe(false);
    const b4 = report.findings[3]!;
    expect(b4.required).toBe(false);
    expect(b4.issues.length).toBe(0); // not required → no error
    expect(report.ok).toBe(true);
  });

  it('block 4 (上游基线) IS required when project is a fork', () => {
    const content = `# PRD

## 业务场景

目标用户: 企业 IT 管理员。业务流程: 注册 → 邀请 → 角色分配。性能: 100 并发。业务禁区: 越权。

## 边界 case

无权限 / 越权 / 跨租户 / 数据迁移兼容 / 错误提示 / 空加载失败状态。

## UI 装配意图

页面模式: 列表/详情/表单/抽屉。关键交互: 搜索/过滤/排序。信息密度: 紧凑。
`;
    writePrdArtifact(tmpDir, content);
    // Mark as fork.
    mkdirSync(join(tmpDir, '.peaks'), { recursive: true });
    writeFileSync(join(tmpDir, '.peaks', 'fork-state.json'), '{}', 'utf8');
    const report = checkPrdBlocks(tmpDir, 'test-rid');
    expect(report.isFork).toBe(true);
    const b4 = report.findings[3]!;
    expect(b4.required).toBe(true);
    expect(b4.issues.some((i) => i.includes('Missing required block'))).toBe(true);
    expect(report.ok).toBe(false);
  });

  it('passes all blocks when content is well-formed and not a fork', () => {
    const content = `# PRD

## 业务场景

目标用户: 企业 IT 管理员 + 普通员工。
业务流程: 注册 → 邀请 → 角色分配。
性能预期: 100 并发。
业务禁区: 越权访问 / 跨租户泄漏。

## 边界 case

无权限访问 / 越权 / 跨租户 / 数据迁移兼容 / 错误提示 / 空状态 / 加载状态 / 失败状态。

## UI 装配意图

页面模式: 列表 / 详情 / 表单 / 抽屉 / 弹窗 / 卡片。
关键交互: 搜索 / 过滤 / 排序 / 批量操作。
信息密度: 紧凑(数据后台)。
`;
    writePrdArtifact(tmpDir, content);
    const report = checkPrdBlocks(tmpDir, 'test-rid');
    expect(report.ok).toBe(true);
  });
});

describe('checkPrdBlocks — artifact not found', () => {
  it('returns findings for all 4 blocks with "artifact not found" issues', () => {
    const report = checkPrdBlocks(tmpDir, 'nonexistent');
    expect(report.artifactPath).toBe('(not found)');
    expect(report.findings).toHaveLength(4);
    const b1 = report.findings[0]!;
    expect(b1.issues.some((i) => i.includes('artifact not found'))).toBe(true);
  });
});

// =================================================================
// v2.18.1 PATCH (bug #6) — `peaks prd check-blocks` `ReferenceError:
// require is not defined` regression guard.
//
// Root cause: `findPrdArtifact` used `require('node:fs')` mid-file in
// the ESM runtime (package.json `type: module`). When the runtime
// branch was reached (no first-candidate match), Node threw
// `ReferenceError: require is not defined` at the CLI level instead
// of returning null.
//
// Acceptance criteria:
//   - `checkPrdBlocks` runs to completion in ESM (no throw).
//   - `findPrdArtifact` returns null (not throw) when no artifact
//     exists under either the first candidate OR any session-dir
//     fallback.
//   - The runtime scan path no longer references `require`.
// =================================================================

describe('checkPrdBlocks — v2.18.1 bug #6 (require is not defined)', () => {
  it('AC #6.1 — well-formed PRD handoff passes all 4 mandatory blocks', () => {
    const content = `# PRD v2.18.1

## 业务场景

目标用户: 企业 IT 管理员 + 普通员工 + 第三方开发者。
业务流程: 用户注册 → 邀请 → 角色分配 → 资源访问。
性能预期: 100 并发用户、50 RPS 列表查询。
业务禁区: 越权访问、数据跨租户泄漏、PII 明文导出。

## 边界 case

无权限访问 / 越权 / 跨租户 / 数据迁移兼容 / 错误提示 / 空加载失败状态。多角色 / 多租户 / 越权场景。数据迁移兼容。空字符串 / 极端输入。

## UI 装配意图

页面模式: 列表 / 详情 / 表单 / 抽屉 / 弹窗 / 卡片。
关键交互: 搜索 / 过滤 / 排序 / 批量操作 / 拖拽。
信息密度: 紧凑(数据后台)。
`;
    writePrdArtifact(tmpDir, content);
    const report = checkPrdBlocks(tmpDir, 'test-rid');
    expect(report.ok).toBe(true);
    expect(report.findings).toHaveLength(4);
    for (const finding of report.findings) {
      expect(finding.issues).toEqual([]);
    }
    // JSON envelope shape AC: every required block present.
    const blocks: Record<string, string> = {};
    for (const f of report.findings) blocks[f.name] = f.issues.length === 0 ? 'pass' : 'fail';
    expect(blocks['业务场景']).toBe('pass');
    expect(blocks['边界 case']).toBe('pass');
    expect(blocks['UI 装配意图']).toBe('pass');
  });

  it('AC #6.2 — missing 业务场景 block fails with a clear, actionable issue (no ReferenceError)', () => {
    const content = `# PRD v2.18.1

## 边界 case

无权限 / 越权 / 跨租户 / 极端输入 / 空字符串 / 错误处理 / 加载失败 / 数据迁移兼容 / 异常输入。

## UI 装配意图

页面模式: 列表 / 详情 / 表单 / 抽屉 / 弹窗 / 卡片。
关键交互: 搜索 / 过滤 / 排序 / 批量操作 / 拖拽。
信息密度: 紧凑(数据后台)。
`;
    writePrdArtifact(tmpDir, content);
    // The fix must let this call return a structured report instead of
    // throwing ReferenceError at the ESM module level.
    const report = checkPrdBlocks(tmpDir, 'test-rid');
    expect(report.ok).toBe(false);
    const b1 = report.findings[0]!;
    expect(b1.name).toBe('业务场景');
    expect(b1.present).toBe(false);
    expect(b1.issues.some((i) => i.includes('Missing required block'))).toBe(true);
    expect(b1.issues.some((i) => i.includes('业务场景'))).toBe(true);
  });

  it('AC #6.3 — JSON envelope shape for the pass case contains { ok, blocks }', () => {
    const content = `# PRD v2.18.1

## 业务场景

目标用户: 企业 IT 管理员 + 普通员工。
业务流程: 注册 → 邀请 → 角色分配。
性能预期: 100 并发。
业务禁区: 越权访问 / 数据跨租户泄漏。

## 边界 case

无权限 / 越权 / 跨租户 / 极端输入 / 空字符串 / 错误处理 / 加载失败 / 数据迁移兼容 / 异常输入。

## UI 装配意图

页面模式: 列表 / 详情 / 表单 / 抽屉 / 弹窗 / 卡片。
关键交互: 搜索 / 过滤 / 排序 / 批量操作。
信息密度: 紧凑。
`;
    writePrdArtifact(tmpDir, content);
    const report = checkPrdBlocks(tmpDir, 'test-rid');
    const envelope = { ok: report.ok, blocks: Object.fromEntries(report.findings.map((f) => [f.name, f.issues.length === 0 ? 'pass' : 'fail'])) };
    expect(envelope.ok).toBe(true);
    expect(envelope.blocks['业务场景']).toBe('pass');
    expect(envelope.blocks['边界 case']).toBe('pass');
    expect(envelope.blocks['UI 装配意图']).toBe('pass');
  });

  it('AC #6.4 — findPrdArtifact returns null (no throw) when only session-axis dir exists with no matching artifact', () => {
    // Pre-create a session-axis dir but with no matching artifact. The
    // runtime scan path (the one that previously used `require('node:fs')`)
    // must execute without throwing ReferenceError in ESM.
    const sessionDir = join(tmpDir, '.peaks', '_runtime', '2026-06-29-session-9cac8e');
    mkdirSync(join(sessionDir, 'prd', 'requests'), { recursive: true });
    // No matching rid.md in the session dir.
    expect(() => findPrdArtifact(tmpDir, 'no-such-rid')).not.toThrow();
    expect(findPrdArtifact(tmpDir, 'no-such-rid')).toBeNull();
  });
});
