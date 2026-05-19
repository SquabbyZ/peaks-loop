# Peaks CLI 跨平台 Windows 支持设计

**日期：** 2026-05-15
**状态：** 设计完成

## 背景

Peaks CLI 最初在 macOS 开发，现需支持 Windows 环境。当前代码存在以下跨平台问题：

1. **硬编码 Unix 路径** — 测试中使用 `/tmp/...`，在 Windows 上不存在
2. **Windows Symlink 限制** — `symlinkSync` 在 Windows 上需要管理员权限或开发者模式
3. **路径分隔符不统一** — 代码和测试混用 `/` 和 `\`
4. **Shell 硬编码** — `process.ts` 中 `shell: '/bin/zsh'` 在 Windows 上不可用

## 设计目标

- 所有功能在 Windows/macOS/Linux 上行为一致
- 测试在所有平台上通过（或平台感知跳过）
- 不因平台问题影响用户使用

## 架构

### 新增文件

```
src/shared/
├── platform.ts      # 平台检测 (win32/darwin/linux)
├── path-utils.ts    # 跨平台路径工具
├── fs-utils.ts      # symlink 等 fs 操作的跨平台封装
```

### 现有文件修改

```
src/shared/process.ts  # shell 路径修复
tests/**/*.test.ts      # 使用跨平台工具重写
```

## 模块设计

### platform.ts

```typescript
export type Platform = 'win32' | 'darwin' | 'linux';

export const platform: Platform = detectPlatform();
export const isWindows = platform === 'win32';
export const isMac = platform === 'darwin';
export const isLinux = platform === 'linux';
```

### path-utils.ts

```typescript
import { isWindows } from './platform.js';

export const SEP = isWindows ? '\\' : '/';

export function normalizePath(p: string): string {
  // 统一转换为 / 分隔符，便于比较
  return p.replace(/\\/g, '/');
}

export function pathsEqual(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}

export function localPath(p: string): string {
  // 转换回本地分隔符
  return isWindows ? p.replace(/\//g, '\\') : p;
}

export function getTempDir(): string {
  return process.env.TEMP ?? process.env.TMP ??
    (isWindows ? 'C:\\Temp' : '/tmp');
}
```

### fs-utils.ts

```typescript
import { isWindows } from './platform.js';
import { symlinkSync as nodeSymlinkSync } from 'node:fs';

export function createSymlinkSync(target: string, linkPath: string): void {
  if (isWindows) {
    // Windows: 使用 junction，不需要管理员权限
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

### process.ts 修复

```typescript
import { isWindows } from './platform.js';

export async function execCommand(command: string, args: string[], options?: { cwd?: string }): Promise<string> {
  const shell = isWindows ? 'cmd.exe' : '/bin/zsh';
  const { stdout } = await execAsync(`${command} ${args.join(' ')}`, {
    cwd: options?.cwd,
    shell
  });
  return stdout.trim();
}
```

## 测试更新

### 路径比较策略

**之前：**
```typescript
expect(setup.localPath).toBe('/tmp/ws-artifacts/.peaks-artifacts');
```

**之后：**
```typescript
import { normalizePath, pathsEqual } from '../../src/shared/path-utils.js';
import { tmpdir } from 'node:os';

expect(pathsEqual(setup.localPath, join(tmpdir(), 'ws-artifacts', '.peaks-artifacts'))).toBe(true);
```

### Symlink 测试策略

```typescript
import { createSymlinkSync } from '../../src/shared/fs-utils.js';

// 使用跨平台封装替代直接 symlinkSync
createSymlinkSync(target, link);
```

### Windows 特定处理

```typescript
import { isWindows } from '../../src/shared/platform.js';

if (isWindows) {
  // Windows 特定处理或跳过
}
```

## 测试覆盖矩阵

| 测试文件 | 问题 | 修复方案 |
|---------|------|---------|
| artifact-setup.test.ts:57 | 硬编码 `/tmp` | `tmpdir()` + `pathsEqual` |
| sc-service.test.ts:158,167 | symlink EPERM | `createSymlinkSync` |
| sc-service.test.ts:202 | `product/prd.md` | `normalizePath` 比较 |
| sc-service.test.ts:224,237 | 路径分隔符 | `pathsEqual` |

## 实现顺序

1. `src/shared/platform.ts` — 平台检测基础
2. `src/shared/path-utils.ts` — 路径工具
3. `src/shared/fs-utils.ts` — fs 跨平台封装
4. `src/shared/process.ts` — shell 修复
5. 测试文件更新 — 使用新工具
6. 验证所有测试通过

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| junction 与 symlink 行为差异 | junction 只用于目录，测试环境使用临时目录 |
| Windows 长路径限制 | 使用 `\\?\` 前缀或保持在 260 字符内 |
| CI Windows 环境配置 | GitHub Actions 支持 windows-latest runner |