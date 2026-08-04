---
name: 2026-08-04-cross-platform-path-utility-rule
description: peaks-loop 跨平台路径比较硬规则（2026-08-04 锁版）— 任何切片涉及 filesystem 路径比较必须复用 src/shared/path-utils.ts，禁止 === / 裸 realpathSync / 自写 replace
metadata:
  type: project
---

# peaks-loop 跨平台路径比较硬规则（2026-08-04 锁版）

**触发场景**：任何切片修改了 session binding 读取、artifact 路径比较、dispatch 记录路径、lease 路径、worktree 路径、container 路径——或任何"两个路径字符串是否指向同一物理目录"的判定。

**Why**：

`peaks-loop@4.0.9` 发布后，Windows Git Bash 下的 statusline 永远显示 `peaks empty`，但 macOS / Linux 用户看到正确的 skill name。根因是 `src/services/session/session-manager.ts:139-157` 的 `readSessionFile` 用 `data.projectRoot === projectRoot` 严格字符串相等，而 binding 写入时是反斜杠（`C:\Users\...`），CLI 传入时是正斜杠（`C:/Users/...`），Node 字符串语义下二者不等 → 返回 null → 4.0.8 的 fail-closed `PEAKS_SESSION_NOT_BOUND` 拦截 → presence marker 永远不写盘 → statusline 渲染 `peaks empty`。这个 bug 静默、不抛错、只在 Windows Git Bash 复现——是 fail-closed gate 与 Windows 路径形式不共存的产物。

更深一层：`src/services/session/session-binding-bridge.ts` 是 v2.18.0 拆出来的 bridge 文件，里面仍保留 `readSessionFile` / `writeSessionFile` 副本，rid-001 修了 manager 文件却没修 bridge，又埋了 B1（strict equal）/B2（不解大小写）/B3（落盘未规范化）三个同形 bug。

**How to apply**：

| 需求 | 必须用这个（禁止手写） |
|---|---|
| 比较两个 projectRoot 字符串 | `projectRootsMatch(stored, caller)` from `src/shared/path-utils.ts`（rid-002 上提） |
| 拿到稳定的真实路径 | `stableRealPath(p)` |
| 跨平台路径展示/比较忽略 `\` vs `/` | `normalizePath(p)` / `pathsEqual(a, b)` |
| 平台判断 | `isWindows` / `isMac` / `isLinux` from `src/shared/platform.ts` |
| child 是否在 parent 内 | `isInsidePath(child, parent)`（已平台无关） |

禁止模式（code-review 必拦）：

- `data.projectRoot === projectRoot` 或任何 binding 路径 / 用户输入 / 跨进程边界的 `===`
- 非 `path-utils` 模块内裸 `realpathSync(p)`（必须走 `stableRealPath`）
- 任何新代码里 `path.replace(/\\/g, '/')`——直接 `import { normalizePath } from '.../shared/path-utils.js'`
- 路径上手写 `.toLowerCase()`——`projectRootsMatch` 内部已用 `isWindows` 守卫；POSIX 折叠会让 `/tmp/Foo` 与 `/tmp/foo` 误判相等
- `--caller-id <id>` 出现在用户可见 hint——CLI 不支持该 flag，应用 `set PEAKS_CALLER_ID=<id> in the environment`

落地位置：`.peaks/standards/common/coding-style.md`（2026-08-04 新增 "Cross-platform path handling" 段），写完后 .peaks/standards 重新 apply 即对所有 LLM 立即生效。

**相关 commit**：
- `5ae2fa6d` rid-001 session-manager.ts 三处修复 + 9 case vitest
- `e8b467d8` rid-002 bridge 三处修复 + `projectRootsMatch` 上提到 `path-utils.ts` + 4 case vitest

**carry-forward**：
- rid-003 (TODO): `src/shared/path-safety.ts:14-17 normalizeForwardSlashes` 与 `path-utils.normalizePath` 完全重复，删一份
- rid-003 (TODO): `src/services/container/container-lease.ts:158` / `src/services/worktree/worktree-lease.ts:293` / `src/services/migrate-skill-name/migrate.ts:59` / `src/services/impact/impact-scan-service.ts:80,89,157` / `src/cli/commands/container-commands.ts:179` 共 6 处 `replace(/\\/g, '/')`，全部收口到 `path-utils.normalizePath`

**memory rule for future LLM**：

当任何切片涉及路径比较 / 路径规范化 / 跨平台路径相关代码时，第一动作是 `Read src/shared/path-utils.ts` 全文，**先**确认是否已有现成 utility，再决定是否扩展。禁止：
- 在新代码里 `import { realpathSync } from 'node:fs'` 然后直接调
- 在新代码里 `import { resolve } from 'node:path'` 然后手写规范化
- 复制 `path-utils.ts` 的 `projectRootsMatch` / `stableRealPath` / `normalizePath` 任一函数到其他文件

如果发现确实有现成 utility 未被使用——先 import 它；如果确实需要新 utility——加到 `path-utils.ts` 然后 import，不要就地实现。
