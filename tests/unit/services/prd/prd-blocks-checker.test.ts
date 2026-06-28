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
