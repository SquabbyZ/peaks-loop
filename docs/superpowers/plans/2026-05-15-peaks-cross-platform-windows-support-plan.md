# Peaks CLI 跨平台 Windows 支持实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Peaks CLI 在 Windows/macOS/Linux 上行为一致，修复 symlink、路径分隔符、shell 硬编码等问题。

**Architecture:** 新增 `platform.ts`、`path-utils.ts`、`fs-utils.ts` 三个跨平台工具模块，修复 `process.ts`，更新测试使用跨平台工具。

**Tech Stack:** TypeScript, Node.js, Vitest

---

## 文件结构

```
src/shared/
├── platform.ts      # 新增 - 平台检测
├── path-utils.ts   # 新增 - 跨平台路径工具
├── fs-utils.ts     # 新增 - symlink 跨平台封装
├── process.ts      # 修改 - shell 路径修复
tests/unit/
├── artifact-setup.test.ts  # 修改 - 使用跨平台工具
└── sc-service.test.ts       # 修改 - 使用跨平台工具
```

---

## 任务 1: 创建 platform.ts

**Files:**
- Create: `src/shared/platform.ts`
- Test: `tests/unit/platform.test.ts` (新建)

- [ ] **Step 1: 写 platform.ts 测试**

```typescript
import { describe, expect, test } from 'vitest';
import { platform, isWindows, isMac, isLinux } from '../../src/shared/platform.js';

describe('platform detection', () => {
  test('platform is one of supported values', () => {
    expect(['win32', 'darwin', 'linux']).toContain(platform);
  });

  test('isWindows is boolean', () => {
    expect(typeof isWindows).toBe('boolean');
  });

  test('isMac is boolean', () => {
    expect(typeof isMac).toBe('boolean');
  });

  test('isLinux is boolean', () => {
    expect(typeof isLinux).toBe('boolean');
  });

  test('only one platform is true', () => {
    const platforms = [isWindows, isMac, isLinux];
    expect(platforms.filter(Boolean)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm test -- tests/unit/platform.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: 实现 platform.ts**

```typescript
export type Platform = 'win32' | 'darwin' | 'linux';

function detectPlatform(): Platform {
  const p = process.platform;
  if (p === 'win32') return 'win32';
  if (p === 'darwin') return 'darwin';
  return 'linux';
}

export const platform: Platform = detectPlatform();
export const isWindows = platform === 'win32';
export const isMac = platform === 'darwin';
export const isLinux = platform === 'linux';
```

- [ ] **Step 4: 运行测试验证通过**

Run: `pnpm test -- tests/unit/platform.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/shared/platform.ts tests/unit/platform.test.ts
git commit -m "feat: add platform detection module for cross-platform support"
```

---

## 任务 2: 创建 path-utils.ts

**Files:**
- Create: `src/shared/path-utils.ts`
- Test: `tests/unit/path-utils.test.ts` (新建)

- [ ] **Step 1: 写 path-utils.ts 测试**

```typescript
import { describe, expect, test } from 'vitest';
import { normalizePath, pathsEqual, localPath, getTempDir } from '../../src/shared/path-utils.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('normalizePath', () => {
  test('converts backslashes to forward slashes', () => {
    expect(normalizePath('C:\\Users\\foo')).toBe('C:/Users/foo');
  });

  test('keeps forward slashes unchanged', () => {
    expect(normalizePath('/home/foo')).toBe('/home/foo');
  });
});

describe('pathsEqual', () => {
  test('returns true for same paths', () => {
    expect(pathsEqual('/foo/bar', '/foo/bar')).toBe(true);
  });

  test('returns true for paths with different separators', () => {
    expect(pathsEqual('/foo/bar', '\\foo\\bar')).toBe(true);
  });

  test('returns false for different paths', () => {
    expect(pathsEqual('/foo/bar', '/foo/baz')).toBe(false);
  });
});

describe('localPath', () => {
  test('converts to backslashes on Windows', () => {
    const result = localPath('C:/Users/foo');
    expect(result).toBe('C:\\Users\\foo');
  });
});

describe('getTempDir', () => {
  test('returns temp directory', () => {
    const temp = getTempDir();
    expect(temp).toBeTruthy();
    expect(temp.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm test -- tests/unit/path-utils.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 path-utils.ts**

```typescript
import { isWindows } from './platform.js';

export const SEP = isWindows ? '\\' : '/';

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

export function pathsEqual(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}

export function localPath(p: string): string {
  return isWindows ? p.replace(/\//g, '\\') : p;
}

export function getTempDir(): string {
  return process.env.TEMP ?? process.env.TMP ??
    (isWindows ? 'C:\\Temp' : '/tmp');
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `pnpm test -- tests/unit/path-utils.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/shared/path-utils.ts tests/unit/path-utils.test.ts
git commit -m "feat: add cross-platform path utilities"
```

---

## 任务 3: 创建 fs-utils.ts

**Files:**
- Create: `src/shared/fs-utils.ts`
- Test: `tests/unit/fs-utils.test.ts` (新建)

- [ ] **Step 1: 写 fs-utils.ts 测试**

```typescript
import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import { createSymlinkSync, readSymlinkTarget } from '../../src/shared/fs-utils.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

describe('createSymlinkSync', () => {
  const testDir = join(process.env.TEMP ?? '/tmp', `fs-utils-test-${Date.now()}`);
  beforeEach(() => mkdirSync(testDir, { recursive: true }));
  afterEach(() => {
    try { rmSync(testDir, { recursive: true }); } catch { /* ignore */ }
  });

  test('creates symlink on unix or junction on windows', () => {
    const target = join(testDir, 'target.txt');
    const link = join(testDir, 'link.txt');
    writeFileSync(target, 'content', 'utf-8');
    createSymlinkSync(target, link);
    expect(readSymlinkTarget(link)).toBeTruthy();
  });
});

describe('readSymlinkTarget', () => {
  test('returns null for non-existent path', () => {
    expect(readSymlinkTarget('/non/existent')).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm test -- tests/unit/fs-utils.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 fs-utils.ts**

```typescript
import { isWindows } from './platform.js';
import { symlinkSync as nodeSymlinkSync, readlinkSync } from 'node:fs';

export function createSymlinkSync(target: string, linkPath: string): void {
  if (isWindows) {
    nodeSymlinkSync(target, linkPath, 'junction');
  } else {
    nodeSymlinkSync(target, linkPath);
  }
}

export function readSymlinkTarget(linkPath: string): string | null {
  try {
    return readlinkSync(linkPath);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `pnpm test -- tests/unit/fs-utils.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/shared/fs-utils.ts tests/unit/fs-utils.test.ts
git commit -m "feat: add cross-platform fs utilities with symlink support"
```

---

## 任务 4: 修复 process.ts

**Files:**
- Modify: `src/shared/process.ts:1-12`

- [ ] **Step 1: 读取当前 process.ts 内容**

Run: `cat src/shared/process.ts`

- [ ] **Step 2: 修改 process.ts 添加平台检测**

```typescript
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { isWindows } from './platform.js';

const execAsync = promisify(exec);

export async function execCommand(command: string, args: string[], options?: { cwd?: string }): Promise<string> {
  const shell = isWindows ? 'cmd.exe' : '/bin/zsh';
  const { stdout } = await execAsync(`${command} ${args.join(' ')}`, {
    cwd: options?.cwd,
    shell
  });
  return stdout.trim();
}
```

- [ ] **Step 3: 运行完整测试验证**

Run: `pnpm test`
Expected: 之前失败的 5 个测试现在应该减少或通过

- [ ] **Step 4: 提交**

```bash
git add src/shared/process.ts
git commit -m "fix: use platform-appropriate shell in execCommand"
```

---

## 任务 5: 更新 artifact-setup.test.ts

**Files:**
- Modify: `tests/unit/artifact-setup.test.ts:1-75`

- [ ] **Step 1: 读取当前测试文件**

- [ ] **Step 2: 修改测试使用跨平台工具**

```typescript
// 添加导入
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathsEqual } from '../../src/shared/path-utils.js';
import { isWindows } from '../../src/shared/platform.js';
import { createSymlinkSync } from '../../src/shared/fs-utils.js';

// 修改 test('reports configured workspace and artifact repo details')
test('reports configured workspace and artifact repo details', () => {
  const testRoot = join(tmpdir(), `peaks-test-${Date.now()}`);
  currentWorkspace = {
    workspaceId: 'ws-artifacts',
    name: 'Artifacts Workspace',
    rootPath: testRoot,
    artifactRepo: { provider: 'github', owner: 'acme', name: 'peaks-artifacts' },
    installedCapabilityIds: []
  };

  const setup = createGuidedArtifactSetup();

  expect(setup.validationResult.workspaceExists).toBe(true);
  expect(setup.validationResult.gitAvailable).toBe(true);
  expect(setup.workspaceId).toBe('ws-artifacts');
  expect(setup.workspacePath).toBe(testRoot);
  expect(setup.provider).toBe('github');
  expect(setup.repoOwner).toBe('acme');
  expect(setup.repoName).toBe('peaks-artifacts');
  expect(pathsEqual(setup.localPath, join(testRoot, '.peaks-artifacts'))).toBe(true);
  expect(setup.remoteUrl).toBe('https://github.com/acme/peaks-artifacts.git');
});

// 修改 test('detects token and common SSH key names')
test('detects token and common SSH key names without CommonJS require', () => {
  const home = join(tmpdir(), `peaks-home-${Date.now()}`);
  mkdirSync(join(home, '.ssh'), { recursive: true });
  writeFileSync(join(home, '.ssh', 'id_ed25519'), 'test-key', 'utf-8');
  vi.stubEnv('HOME', home);
  vi.stubEnv('GH_TOKEN', 'test-token');

  const setup = createGuidedArtifactSetup();

  expect(existsSync(join(home, '.ssh', 'id_ed25519'))).toBe(true);
  expect(setup.validationResult.ghTokenAvailable).toBe(true);
  expect(setup.validationResult.sshKeyAvailable).toBe(true);
});
```

- [ ] **Step 3: 运行测试验证**

Run: `pnpm test -- tests/unit/artifact-setup.test.ts`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add tests/unit/artifact-setup.test.ts
git commit -m "test: use cross-platform path utilities in artifact-setup tests"
```

---

## 任务 6: 更新 sc-service.test.ts

**Files:**
- Modify: `tests/unit/sc-service.test.ts`

- [ ] **Step 1: 添加导入并更新 symlink 相关测试**

```typescript
// 在文件顶部添加导入
import { pathsEqual, normalizePath } from '../../src/shared/path-utils.js';
import { createSymlinkSync } from '../../src/shared/fs-utils.js';
import { isWindows } from '../../src/shared/platform.js';

// 修改 symlink 测试 (行 154-161)
// 替换: symlinkSync(join('changes', '2026-05-15-symlink-change'), join(peaksPath, 'current-change'));
// 为:
if (isWindows) {
  // Windows 上 junction 需要绝对路径
  const targetAbs = join(workspace.rootPath, 'changes', '2026-05-15-symlink-change');
  const linkAbs = join(peaksPath, 'current-change');
  createSymlinkSync(targetAbs, linkAbs);
} else {
  symlinkSync(join('changes', '2026-05-15-symlink-change'), join(peaksPath, 'current-change'));
}

// 类似修改行 167 的测试

// 修改行 202 路径比较
// 之前: expect(missing.missingArtifacts).toContain('product/prd.md');
// 之后: 路径已经在 localPath 格式，需要用 normalizePath 比较
const missingPaths = missing.missingArtifacts.map(normalizePath);
expect(missingPaths).toContain('product/prd.md');

// 修改行 224 路径比较
// 之前: expect(githubImpact.syncPointers.localPath).toBe(`${(currentWorkspace as WorkspaceConfig).rootPath}/.peaks-artifacts`);
// 之后:
const workspaceRoot = (currentWorkspace as WorkspaceConfig).rootPath;
expect(pathsEqual(githubImpact.syncPointers.localPath, join(workspaceRoot, '.peaks-artifacts'))).toBe(true);
```

- [ ] **Step 2: 运行测试验证**

Run: `pnpm test -- tests/unit/sc-service.test.ts`
Expected: PASS（或 symlink 相关测试平台感知跳过）

- [ ] **Step 3: 提交**

```bash
git add tests/unit/sc-service.test.ts
git commit -m "test: use cross-platform utilities in sc-service tests"
```

---

## 任务 7: 验证完整测试套件

- [ ] **Step 1: 运行完整测试**

Run: `pnpm test`
Expected: 所有测试通过

- [ ] **Step 2: 运行覆盖率检查**

Run: `pnpm test:coverage`
Expected: 覆盖率 >= 95%

- [ ] **Step 3: 运行 typecheck**

Run: `pnpm typecheck`
Expected: 无错误

- [ ] **Step 4: 最终提交**

```bash
git add -A
git commit -m "feat: complete cross-platform Windows support for Peaks CLI"
```

---

## 验证清单

- [ ] 所有新增模块有对应测试
- [ ] 测试使用 `tmpdir()` 替代硬编码路径
- [ ] 路径比较使用 `pathsEqual()` 忽略分隔符差异
- [ ] Symlink 使用 `createSymlinkSync()` 跨平台封装
- [ ] Shell 使用 `isWindows ? 'cmd.exe' : '/bin/zsh'`
- [ ] `pnpm test` 全部通过
- [ ] `pnpm typecheck` 无错误
- [ ] `pnpm test:coverage` 覆盖率 >= 95%