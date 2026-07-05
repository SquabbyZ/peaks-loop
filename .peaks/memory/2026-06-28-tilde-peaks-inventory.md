---
name: 2026-06-28-tilde-peaks-inventory
description: 2026-06-28 session 对 ~/.peaks/ 的盘点 + 保守档清理结果 + 未修的 4 类问题（doctor version drift / log 累积 / cc-connect 空壳 / companion dir）。下个 session 想"接着整理"时直接读这个。
metadata:
  type: project
---

# `~/.peaks/` 盘点 + 保守档清理（2026-06-28 session 75d5f0）

**触发**: 用户在 v2.14.0 anti-fake-green PRD 完成后让 peaks-code "顺手整理下 `C:\Users\smallMark\.peaks`"。
**执行档**: 保守档（A 方案）——只删 3 项死残留，不覆盖任何运行时配置，不动 log。

## 1. 清理前 vs 清理后

### 删除项

| 项 | 类别 | 原因 | 何时重建 |
|---|---|---|---|
| `~/.peaks/workspaces/invalid-artifact/` (12 文件) | 死残留 | `resume-untrusted-workspace` v2.13.0 之前路径的 PR D/RD swarm 实验残留；`workspaces.json.workspaces: []` 已不引用 | 不会自动重建 |
| `~/.peaks/companion/cc-connect.log` (0 字节) | 空壳 | peaks-companion 启动时应写 cc-connect bridge，但 0 字节说明从来没成功写入 | 下次 `peaks-companion` 启动会自己写 |
| `~/.peaks/providers.json` (v2.0.0, 99 B) | 冗余 | v2.0 老 schema；`config.json.providers` 已是 source of truth | 不会自动重建 |
| `~/.peaks/workspaces/invalid-artifact/` × 2 (Step 1, 6 文件) | re-生成残留 | v2.14.0 ship 期间重新生成；实质还是 v2.13.4 已知问题 | 会再次重建（同 sid） |

### 改动项（保守档 + 激进档）

| 项 | 类别 | 改动 | 验证 |
|---|---|---|---|
| `config.json.version` (激进档 A-5) | version drift | `2.13.0` → `2.14.0` | doctor.test.ts **50/50 passed**（之前 5 个 failure 修复） |
| `logs/peaks-loop-2026-06-2{1..7}.log` (激进档 A-6) | log 累积 | 移到 `logs/archive/2026-Q2/` | `ls -R ~/.peaks/logs/` 显示归档结构 + 06-28 保留在 root |

### 保留项（用户运行时配置，**永远不要自动覆盖**）

- `~/.peaks/config.json` (423 B, version=**2.14.0**) —— 主配置
- `~/.peaks/workspaces.json` (73 B) —— peaks-loop 启动 schema 校验依赖
- `~/.peaks/logs/peaks-loop-2026-06-28.log` —— 当前 session 日志，保持可访问

## 2. **未修的 4 类问题**（下个 session 继续整理时直接读这里）

| # | 问题 | 影响 | 修复路径 | 状态 |
|---|---|---|---|---|
| **P1** | ~~`config.json.version: "2.13.0"` vs 当前 ship `2.13.4-beta.1`~~ | doctor.test.ts × 5 version-mismatch failures | 已 bump 到 `"2.14.0"` → doctor 50/50 pass | ✅ FIXED (2026-06-28 11:19) |
| **P2** | ~~`logs/peaks-loop-2026-06-2{1..7}.log` 共 2.4 MB~~ | 默认 7 天保留是设计行为；磁盘不紧可不清理 | 已移到 `logs/archive/2026-Q2/` | ✅ ARCHIVED (2026-06-28 11:19) |
| **P3** | `companion/` 目录保持空；cc-connect bridge 写不出 | peaks-companion 启动 bridge 应写 cc-connect.log，但目录一直为空 | 跑一次 `peaks companion start` 写一次再 ls -la 看大小；若 0 字节说明 bridge 没挂上 → 查 `src/services/companion/cc-connect-bridge.ts` | ⚠️ CONFIRMED-BRIDGE-BROKEN (跨多次 session 仍未写) |
| **P4** | `config.json.providers.minimax.model: "minimax-2.7"` | 可能跟 doctor version drift 一起出现 failure | 跟 P1 一起验，doctor 5 个 failure 是否同源 → **已同源验证**：doctor 50/50 pass，证明 P4 不是 doctor 测试失败根因 | ⏳ PENDING（model 字段暂不主动改，等用户确认） |

## 3. 当前 `~/.peaks/` 结构（Step 1+2+3 后）

```
~/.peaks/                              ~2.6 MB（du -sh）
├── config.json         423 B   ← version="2.14.0" ✅
├── workspaces.json      73 B
├── companion/                  ← 空目录（P3 bridge 仍未写）
├── logs/                       ← 1 个当前 log + 7 个归档
│   ├── peaks-loop-2026-06-28.log   148K  ← 当前 session
│   └── archive/
│       └── 2026-Q2/                ← 7 个归档 log（2.3 MB）
│           ├── peaks-loop-2026-06-21.log    96K
│           ├── peaks-loop-2026-06-22.log   176K
│           ├── peaks-loop-2026-06-23.log   148K
│           ├── peaks-loop-2026-06-24.log   624K
│           ├── peaks-loop-2026-06-25.log   780K
│           ├── peaks-loop-2026-06-26.log   260K
│           └── peaks-loop-2026-06-27.log   328K
└── workspaces/                  ← 空目录（invalid-artifact 已删；下次 init sid=resume-untrusted-workspace 会再生）
```

## 4. 关键约束

- **`config.json.version` 永远不要在无人 review 时改**——它影响 doctor.test.ts / peaks-companion / peaks-doctor CLI 的 version-mismatch 校验；改错会引入新的 false-green。
- **`workspaces.json.workspaces` 即使是 `[]` 也不能删**——schema 校验要求字段存在。
- **`logs/` 不要在用户没确认时清理**——log 是排错唯一证据。
- **`~/.peaks/` 是全局配置，不归 peaks-loop 仓库管**——任何清理都不会被 `git status` 看到，但会被 `peaks-companion` / `peaks-doctor` 启动时读取。

## Why

2026-06-28 这次清理本想顺势把 doctor version 也修了，但你明确说 "后续我会开新的 session 再着重整理"。把 P1-P4 列在这里，下个 session 直接读这个 memory 就能续上。

## How to apply

下次用户说 "接着整理 `~/.peaks`" → 直接读这个 memory → 走激进档（A-5 + A-6），按 P1 → P3 → P4 → P2 顺序处理。每次处理完更新本 memory 的"清理前 vs 清理后"表 + "当前结构"图。

## 5. Step 1+2+3 整理结果 (2 days later, 2026-06-28 11:19)

**触发**: 用户在 v2.14.0 ship 后开启新 session 75d5f0 授权 Step 1+2+3 全档执行。Solo full-auto mode — 不留任何给用户。

### 时间戳

- **T0** (session 启动) — `peaks skill presence --json` 读 active skill marker → peaks-code 活跃
- **T1 (11:18)** — Step 1 完成：`rm -rf ~/.peaks/workspaces/invalid-artifact/` → 6 文件删除
- **T2 (11:19)** — Step 2 完成：`config.json.version: 2.13.0 → 2.14.0`；`pnpm vitest run tests/unit/doctor.test.ts` → **50/50 passed**
- **T3 (11:19)** — Step 3 完成：`mv 7 logs → ~/.peaks/logs/archive/2026-Q2/`；06-28 留 root

### Before / After 磁盘占用

| 路径 | Before | After | Δ |
|---|---|---|---|
| `~/.peaks/` total (du -sh) | 2.6M | 2.6M | 0 (move 不释放) |
| `~/.peaks/workspaces/invalid-artifact/` | 6 文件 / nested dirs | 0 (deleted) | -6 |
| `~/.peaks/logs/` root count | 8 files | 1 file (06-28) | -7 |
| `~/.peaks/logs/archive/2026-Q2/` | (none) | 7 files | +7 |
| `~/.peaks/config.json` size | 423 B | 423 B | 0 (只改 1 字段) |
| `~/.peaks/config.json.version` | `"2.13.0"` | `"2.14.0"` | bumped |

### 验证命令与输出

```bash
# Step 1
$ ls -la ~/.peaks/workspaces/
total 4
drwxr-xr-x ... .
drwxr-xr-x ... ..
# (empty)

# Step 2
$ cat ~/.peaks/config.json | grep version
  "version": "2.14.0",

$ cd "C:/Users/smallMark/Desktop/peaks-loop" && pnpm vitest run tests/unit/doctor.test.ts 2>&1 | tail -5
 Test Files  1 passed (1)
      Tests  50 passed (50)
   Duration  1.32s

# Step 3
$ ls -R ~/.peaks/logs/
peaks-loop-2026-06-28.log
archive/2026-Q2/:
peaks-loop-2026-06-21.log  peaks-loop-2026-06-22.log  peaks-loop-2026-06-23.log
peaks-loop-2026-06-24.log  peaks-loop-2026-06-25.log  peaks-loop-2026-06-26.log
peaks-loop-2026-06-27.log
```

### Envelope

`.peaks/_runtime/2026-06-28-session-75d5f0/dispatch/contracts/tilde-peaks-cleanup-step123.json` — `status: "ok"`。

## 6. Invalid-artifact 重生机制

`~/.peaks/workspaces/invalid-artifact/` 不是"清掉就完了"——它在 v2.14.0 ship 期间再次重生（mtime 09:41），证明这是 peaks-loop workspace init 的预期行为，不是 stale residue。

**触发条件**：`peaks workspace init --change-id <id>` 中 `<id>` 解析为 `resume-untrusted-workspace` 这个 sid 时，会在 `~/.peaks/workspaces/<id>/` 下铺出 `.peaks/_runtime/change/<sid>/{prd,rd/swarm,...}` 的脚手架。如果 init 中途出错或 sid 异常，这个目录会留下半成品——但 `workspaces.json.workspaces` 不引用它，所以是孤儿。

**v2.13.4 known issue vs v2.14.0**：CHANGELOG v2.13.4 记的是 "solo mode gate + verify-pipeline canonical path + auto-compact main target"。invalid-artifact 重生跟 v2.13.4 没有直接因果关系——它是从 v2.13.0 之前就存在的 workspace init 路径副作用，v2.14.0 没修也没加重。**这不是 v2.14.0 regression**。

**下次预测**：下次 `peaks workspace init --change-id resume-untrusted-workspace`（任何 session）会再次铺出这个目录。如果用户想彻底解决，需要在 `src/commands/workspace/init.ts` 中加清理钩子：检测 `~/.peaks/workspaces/<id>/.peaks/_runtime/change/<sid>/` 是否存在但 `workspaces.json.workspaces` 没引用 → 自动删除。这是 P5 候选修复项，**不在 Step 1+2+3 范围**。

**当前决策**：每次 v2.14.0+ session 结束顺手 `rm -rf` 即可，因为内容都是空的（resumed session 落盘半成品从不完整）。如果某次发现 invalid-artifact 非空 → 可能是真实 workspace 残留 → 删前要 cross-check `workspaces.json.workspaces` 数组是否真的有这个 sid。
