---
name: 2026-06-28-session-75d5f0-compaction-1
description: session 75d5f0 auto-compact checkpoint — v2.14.0 + v2.14.1 + v2.14.2(partial) ship 完。用户说"自己 auto compact" — 把今天的关键决策 + 未完成事项压缩到这里，下个 session 直接读这条 + 链上其他 memory。
metadata:
  type: project
---

# session 75d5f0 — auto-compact checkpoint（2026-06-28 ~11:50）

**触发**: 用户说"自己 auto compact"——按 v2.13.0 auto-compact 设计（85% pre-compact + 95% red-line），本 session 已 ship 2 个 release + 5 切片 RD + 3 step tilde 整理，对话历史 ~14 美元，达到压缩点。

## 1. 今天 ship 的版本（按时间顺序）

| Commit | Version | 内容 |
|---|---|---|
| `5a29d5d` | v2.14.0 | anti-fake-green hardening — 5 mechanical gates (G1-G5) |
| `f89ba75` | v2.14.0 (sub) | slice-c G3 prose-only ratio 6.04% → 0.00% |
| `433a679` | **v2.14.1** | prepublish Windows ENOENT fix + .npmrc template |

**未 ship**: v2.14.2 (P3+P4 cleanup) — **blocked**（见 §3）。

`main` 分支已经 ahead origin 5 个 commit；user 已 `npm publish` v2.14.1（全局 + 本地 `peaks --version` 都是 2.14.1）。

## 2. 关键决策（5 条 user-given rules，今天确立）

1. **full-auto mode 边界 = commit only**——RD/QA 全程 Solo fork Agent 跑，但 push / tag / npm publish 都是 user-only。
2. **Solo fork Agent，不让用户在 IDE 跑 Task toolCall**——之前我犯过错，记忆已写进 `2026-06-28-full-auto-boundary.md`。
3. **G4 第三方 reviewer 用 `~/.peaks/config.json.reviewer` 配置**——不是 CLI flag（user 给的方案）。
4. **`~/.peaks/config.json.providers.minimax.model` 是合法字段**——schema 里就是有的（`ProviderModelConfig.model?: ExecutionModelId`），不是 dead config。我之前推断错。
5. **P3 peaks-companion skill 是 DEAD（SKILL 有，CLI 无）**——但 P3 也需要 user 同意才能删（涉及 skill 删除），没做完。

## 3. P3 + P4 当前状态（BLOCKED on user 决定）

| # | 真相 | 状态 |
|---|---|---|
| **P3** | peaks-companion skill（skills/peaks-companion/SKILL.md）是 dead——SKILL 描述 `peaks companion status/install/setup/start` CLI，但 `peaks --help` 无 companion entry，`src/services/companion/` 不存在。**有 1 个 test 文件会 fail**：`tests/unit/skills/peaks-companion.test.ts`（8 cases SKILL 内容 + 1 case CLI help-text） | ⏳ blocked：等 user 决定删 skill + 修 test，还是复活 CLI |
| **P4** | `~/.peaks/config.json.providers.minimax.model: "minimax-2.7"` 是**合法 config**——`ProviderModelConfig = { model?: ExecutionModelId; baseUrl?: string; apiKey?: string }`。`ExecutionModelId` 是 union type 含 `minimax-2.7`。但 schema 注释 line 105 写 `@deprecated Moved to ~/.peaks/providers.json (provider-service.ts)`——说明 provider 配置应该走 `~/.peaks/providers.json`（已删），不是 `config.json.providers` | ⏳ blocked：等 user 决定是把 `minimax` 从 `config.json` 移到 `providers.json`，还是接受现状 |

## 4. 全局配置现状（v2.14.1 ship 后）

```
~/.peaks/                              ~2.6 MB
├── config.json         423 B   version="2.14.1" ✅（auto-bump）
├── workspaces.json      73 B
├── companion/          空目录（P3 dead skill 的占位）
├── logs/               
│   ├── peaks-loop-2026-06-28.log      ← 当前 session log
│   └── archive/2026-Q2/               ← 7 个旧 log 归档
└── workspaces/         空目录
```

**user-global `~/.npmrc`** 仍有 `https_proxy` 下划线字段（npm 11.x warning，npm 12 会 error）——user-only 边界，user 自己决定什么时候删。

## 5. P1-P4 关闭状态

| # | 问题 | 状态 |
|---|---|---|
| P1 | `config.json.version` drift | ✅ FIXED（v2.14.0 session + auto-bump 到 v2.14.1） |
| P2 | log 累积 2.4 MB | ✅ ARCHIVED（2026-Q2/） |
| P3 | companion dead skill | ⏳ BLOCKED（等 user 决定） |
| P4 | minimax silent dead config | ⏳ BLOCKED（schema 验证 model 合法；user 决定保留还是迁移到 providers.json） |

## 6. 未 ship 的 2 个独立工作

| 工作 | 状态 | 起点 |
|---|---|---|
| **`feature/800-line-cap-refactor`** 分支（`75b9800`） | ⏳ 未评估 | merge base 是 v2.9.0（14 commit behind main）；diff 是 450 文件 / 6761 insertions / **42579 deletions**——后者可能误删 slice tests。需要新 slice 评估 + rebase 冲突。 |
| **npmrc `https_proxy` warning** | ⏳ user-only | user 跑 `npm config delete https_proxy` 即可（user-global config） |

## 7. 下次 session 起点

按对话流，应该直接问 user：

```
1. v2.14.2 要不要 ship？
   - P3 删 dead skill + 修 peaks-companion.test.ts（~10 LOC test update + skill 删除 + CHANGELOG + version 2.14.1 → 2.14.2）
   - P4 是否把 minimax 从 config.json.providers 迁移到 providers.json（user 决定保留还是迁移）
2. feature/800-line-cap-refactor 分支要不要收？
   - 评估 42579 行删除是否包含 main 重要 slice 测试
   - 决定合 / rebase / drop
3. npmrc https_proxy 警告消不消？
   - user-only 边界，user 自己跑 `npm config delete https_proxy`
```

## 8. 关键 memory 链接（下次 session 必读）

- [[2026-06-28-session-75d5f0-familiarization]] — 项目结构熟悉
- [[2026-06-28-full-auto-boundary]] — full-auto mode 边界 = commit only（最重要）
- [[2026-06-28-tilde-peaks-inventory]] — `~/.peaks/` 现状 + P1-P4
- `v2-14-0-anti-fake-green-hardening.md` — v2.14.0 ship state（已写）
- `v2-14-1-prepublish-fix.md` — 待写（如果 user 想要 ship state）
- `2026-06-28-v2-14-1-prepublish-enoent.md` — 类似（看 RD sub-agent 是否写过）

## Why

session 75d5f0 跑了 ~3 小时，ship 了 2 个 release + 评估 1 个 partial release，对话历史 ~14 美元。auto-compact 是 v2.13.0 的设计意图（peaks-loop 自己的 auto-compact 设计），user 说"自己 auto compact" 触发本 checkpoint。

## How to apply

下次开新 session，**先读这个 memory**，再读 [[2026-06-28-full-auto-boundary]]，然后按 §7 的 user-question 模板开头。不需要重读对话历史。