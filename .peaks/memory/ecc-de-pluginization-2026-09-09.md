---
name: ecc-de-pluginization-2026-09-09
description: ECC 去插件化（~/.peaks 物化 + 缓存后备）并修好从未真正跑通的动态获取（415/404/名称错位）
metadata:
  type: project
  node_type: memory
  originSessionId: 90742f29-4074-4c14-acd7-2984851a606f
  modified: 2026-09-08T17:49:08.643Z
---

# ECC 去插件化 + 动态获取修复（2026-09-09）

**Date:** 2026-09-09（session 2026-09-07-session-245530）· commit `cb65237f`

## 用户诉求

"有些能力借助 ECC、部分动态获取、有些还要用户装" → 全部改成动态获取，避免新开发机因没装 ECC 而降级。并要求增强 ECC 结合。

## 根因：**"动态获取"从来没真正跑通**（三层都坏）

1. **`peaks ecc install` 三个下载路径全挂**（GitHub 完全可达，是代码问题）：
   - 资产名 `ecc.tar.gz` 在 v2.2.0 release 里不存在 → 404
   - 回退到 GitHub `tarball_url` 时发 `accept: application/octet-stream` → **415**（该端点要 `application/vnd.github+json`）
   - release 里没有 `.tgz`/`.tar.gz` 资产 → 无第三跳
   - 仓库已改名 `affaan-m/everything-claude-code` → `affaan-m/ECC`
2. **原生插件 id 两段都错**：契约写 `everything-claude-code:code-review`，实际插件名是 **`ecc`**、agent 名是 **`code-reviewer`** → 即使装了插件也匹配不上。
3. **物化文件名错位**：桥接/契约硬编码 `code-review.md`，上游实际是 `code-reviewer.md` → `ready-via-cache` 永不触发。单测没抓到，因为 fixture 用了同一个错名。

## 修复

- **物化到 `~/.peaks/agents/ecc/`**（peaks 自有目录），**永不写 `~/.claude/`**。
- **缓存后备路径**：插件缺失 → 确保缓存 → 把物化指令注入通用子代理 → 同一个 bridge 渲染。新增 `detectEcc` 状态 `ready-via-cache`。
- **按真实名解析**：`resolveMaterializedAgentName(['code-reviewer','code-review'])` + 确定性回退。
- **原生 id 改 `ecc:code-reviewer`**（导出 `DEFAULT_NATIVE_ECC_AGENT_ID`）。
- 下载链改为 `tarball_url → 资产 → PRD url`，accept 头修正；tar 根目录剥离改为按形状（codeload 与 api 前缀不同）。
- 顺带：`getInstalledCapabilityIds` 从写死 `[]` 改为真实检测；`peaks shadcn init` 实现为 `npx --package shadcn@4.21.0` 动态包装；清掉 AgentShield 3 处残留；**彻底移除 understand-anything 集成**。

## 实测证据

`peaks ecc install` exit 0（13m52s，网络慢）→ `~/.peaks/agents/ecc/` **69 文件**（68 agent + manifest）、`ecc ls`/`show code-reviewer` 正常、`~/.claude/agents/` 无新增。全量 **124 files / 1057 passed**（原 119/1014）、tsc clean。

## Lesson 1 — "已经动态化了" 必须端到端验证，不能只看单测

**现象**：单测全绿，但真实环境 `peaks ecc install` 从未成功过。

**Why**：单测用 fixture 名字（`code-review.md`），与上游真实名（`code-reviewer.md`）不一致 → 测试把 bug 固化成了"正确"。同理，下载链的单测 mock 了 fetch，永远看不到 415。

**How to apply**：涉及外部获取的改动，验收必须包含**一次真实的端到端调用**（真网络 + 真上游），并核对产物的**真实文件名/内容**，不能只跑 mock 单测。

## Lesson 2 — 硬编码的外部标识会随上游改名腐烂

本次上游同时改了：仓库名、插件名、agent 名。三处硬编码全部失效，且**失效是静默的**（降级到 fallback，不报错）。

**How to apply**：外部 repo/plugin/agent id 一律抽成具名常量 + 写清来源与改名历史；能按"形状/候选列表"解析的，不要钉死单一字符串；降级路径要有可观测信号（本次新增 `ready-via-cache` 状态）。

## Lesson 3 — peaks-loop 的产物一律落 `~/.peaks/`，永不写 `~/.claude/`

用户明确要求（2026-09-09）：物化目标放 `~/.peaks/` 而不是 `~/.claude/`。

**Why**：`~/.peaks/` 是 peaks-loop 自有的目录，写进去是"自己管自己"；`~/.claude/` 是 IDE 的领地，写入等于替别的工具改配置，版本/格式/清理责任都不在我们这边。

**How to apply**：任何 peaks-loop 生成/缓存的用户级产物 → `~/.peaks/<kind>/`。这条应视为项目级规则。

## 反模式（不要做）

- 不要只跑 mock 单测就宣布"动态获取修好了"——必须真网络端到端验一次。
- 不要把 peaks-loop 产物写进 `~/.claude/`。
- 不要钉死外部 agent 文件名（上游用 `*-reviewer` 命名）。
- 不要在下载 fallback 链里对 `api.github.com/.../tarball/...` 发 `application/octet-stream`。

相关：[[codegraph-dangling-marker-autorefresh-fix]] · [[ci-green-restoration-2026-09-08]]
