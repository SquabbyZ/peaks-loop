<!-- peaks-memory:start -->
---
title: 2026-09-03 user feedback batch — codegraph 数据目录回根 + env 优先模型窗口识别（1M）
kind: lesson
date: 2026-09-03
session: 2026-09-03-session-d49394
rids: [rid-2026-09-03-codegraph-root, rid-2026-09-03-model-1m-detect]
commits: [c0721d3a, 7011e64c, 5289a9b3, 10ec36ad]
---

# codegraph 数据目录回根 + env 优先 1M 窗口识别

## 一句话总结

两个用户反馈 bugfix：① 把 codegraph 数据目录从 rid-CG-003 引入的 `.peaks/.codegraph/` **完全改回根 `.codegraph/`**（用户明确"完全回根，去掉 .peaks 路径"）；② peaks-loop 之前只从 transcript `message.model` 读模型名（无 `[1M]` 后缀）导致 1M 上下文模型被误判 200K，改为 **env 优先读模型名 + transcript 兜底**（`ANTHROPIC_MODEL=deepseek-v4-flash[1M]` 的 `[1M]` 后缀即命中 Claude Code 的 1M 约定）。

## 现象 / 根因

### Issue 1 — codegraph 目录位置
rid-CG-003（4.0.20，commit 0e3b1bed）把 `.peaks/.codegraph/` 设为 preferred managed location，根 `.codegraph/` 降级为 legacy fallback。用户认为这是过度设计：codegraph 应像上游默认一样放根目录 `.codegraph/`，`.peaks/` 只存 peaks-loop 自己的 runtime 状态。

### Issue 2 — 1M 上下文误判 200K
实测（本会话运行于 `deepseek-v4-flash[1M]`，真实 1M 窗口）：
- transcript `message.model` = `"deepseek-v4-flash"`（**不带** `[1M]` 后缀）
- env `ANTHROPIC_MODEL` / `ANTHROPIC_DEFAULT_*_MODEL` / `CLAUDE_CODE_SUBAGENT_MODEL` = `deepseek-v4-flash[1M]`（**带** `[1M]`）
- 探测链只从 transcript 读模型 → `modelContextWindowTokens("deepseek-v4-flash")` 不命中 `1m` → 200K
- 现场证据：`peaks code context-now` 返回 `capacityTokens: 200000, ratio: 0.54`（真实 ≈ 0.108），false soft-warn

## Fix 内容

- `codegraph-service.ts`：删除 `PREFERRED_CODEGRAPH_DIR` + `preferred|legacy|fresh-preferred` union；`CODEGRAPH_DIR_NAME='.codegraph'` 唯一；`resolveCodegraphProjectRoot` 纯路径数学返回 `{source:'root', codegraphDir:<root>/.codegraph, cwd:<root>}`；`defaultCodegraphInitGuard` 只探根。doctor messaging + types、`.gitignore`、3 测试文件同步。
- `claude-code-adapter.ts`：新增导出 `resolveClaudeModelFromEnv(env)`（优先级 `ANTHROPIC_MODEL` → `ANTHROPIC_DEFAULT_OPUS/SONNET/HAIKU/FABLE_MODEL` → `CLAUDE_CODE_SUBAGENT_MODEL`）；`readContextPercentFallback` 把 env 模型传入 `readClaudeTranscriptEstimate(outerSessionId, envModel?)`，window 从 env 模型优先解析、transcript `message.model` 兜底。`modelContextWindowTokens` 已有 `[1M]`/`[1m]` → 1M（小写 `includes('1m')`）。

## Lesson 1 — 探测源的模型名与"展示模型名"可能不一致

**现象**：Claude Code（及第三方如 deepseek）的 transcript 记录的是**裸 API model id**（`deepseek-v4-flash`），而 env / CLI 展示用 id **带上下文标记**（`deepseek-v4-flash[1M]`）。读错源 = 窗口误判。

**Why**：context window（200K vs 1M）不是模型 API id 的固有属性，是运行时/账号能开多大窗口的决定。transcript 不带这个信息，env 的 `[1M]` 后缀是唯一可靠信号。

**How to apply**：任何需要"当前模型上下文窗口"的探测，**优先 env 的模型标记，transcript 只做兜底**。vendor 专属 env 解析放 adapter（claude-code-adapter），vendor-neutral 承诺不被破坏。

## Lesson 2 — codegraph 数据目录应尊重上游默认根目录

**现象**：rid-CG-003 把 `.peaks/.codegraph/` 设为 preferred 是过度设计；用户要的是默认根目录语义。

**Why**：`.peaks/` 是 peaks-loop runtime 状态目录；codegraph 是第三方工具的数据（同 aider/cody），放 `.peaks/` 会混淆"谁的目录"。且向下游 npm consumer 传播了一个非默认路径约定，迁移成本高。

**How to apply**：集成第三方工具的数据目录时，默认跟随工具自身约定（根目录），除非有强 gitignore / 多工具冲突理由才收编进 `.peaks/`。改动前先问用户方向（本次用了 AskUserQuestion：完全回根 vs 保留回读兼容）。

## 验证证据
- QA（sub-agent）双 rid verdict = pass；42/42 codegraph scoped + 34/34 adapter+reader scoped
- full unit suite：110 files / 958 tests，仅 3 个 red-on-base 失败（dispatch vendor-registration + statusline stale-branch，source-under-test 与 HEAD 逐字节一致、与本改动无关）
- 本地 build 后 dogfood：`context-now` → `capacityTokens: 1000000, ratio: 0.187, verdict: ok`（修复前 200K/0.884 soft-warn）；codegraph 探根 `.codegraph/`、无 `.peaks/.codegraph`

## Red-line 遵守
- 无 `Co-Authored-By: Claude/Anthropic` trailer；SquabbyZ 唯一作者
- 编排器未直接 Edit/Write src/**；全部经 `peaks sub-agent dispatch rd` / `qa`

## Lesson 3 — 发版必须手工同步 `peaks-loop-internal-runtime/src/index.ts` 的 RUNTIME_VERSION + RUNTIME_NPM_VERSION

**现象**：4.0.28 首次发版 CI 失败（用户发现 Actions 报错）。根因：`scripts/bump-version.mjs` 只 bump 各 `package.json`，**不碰** `packages/peaks-loop-internal-runtime/src/index.ts`。该文件顶部的 `RUNTIME_VERSION = '4.0.27'` / `RUNTIME_NPM_VERSION = '0.0.12'` 需手工随 release commit 同步到 `'4.0.28'` / `'0.0.13'`。publish.yml `gate-cli-version` 的 (A) on-disk 段读 `src/index.ts` RUNTIME_VERSION 与 root version 比对 → drift → abort。

**Why**：4.0.27 release commit（9fa8ef06）当时手工包含了 index.ts 的 +4/−4 改动，我照 bump-version 的输出以为只改 package.json 即可，漏了它。CI gate 是 fail-closed 的 —— 它拦下了这次，但也意味着"照 bump-version.mjs 走一遍就 push"是不够的。

**How to apply**：每次发版在 `git commit --amend` 前跑一个 3-literal 一致性检查：
```bash
node -e "const p=require('./package.json'); console.log('root',p.version)"
grep -oE "RUNTIME_VERSION = '[^']+'" packages/peaks-loop-internal-runtime/src/index.ts
grep -oE "CLI_VERSION = \"[^\"]+\"" packages/peaks-loop-shared/src/version.ts
```
三者必须全等 root version；同时 `RUNTIME_NPM_VERSION` 要等于 internal-runtime package.json version。任何不匹配 → amend + re-tag + force-push（runbook rule 6，`.peaks/memory/2026-08-02-publish-runbook.md`）。**CI 的 ci.yml `pnpm/action-setup@v4` 步骤是 pre-existing 失败**（base 203208a 同样红，publish.yml 用 corepack 绕开，ci.yml 未修）——不是本次改动引入，不阻塞 publish。

## 反模式（不要做）
- 不要从 transcript 单独推断窗口 —— env 有 `[1M]` 时以 env 为准
- 不要把已回根的 codegraph 目录再搬回 `.peaks/`
- 不要把 env 专属模型解析放到 vendor-neutral 服务（如 auto-compact-reader.ts）里
- 不要以为 bump-version.mjs 输出全量覆盖版本面 —— `internal-runtime/src/index.ts` 的 RUNTIME_VERSION / RUNTIME_NPM_VERSION 需手工随 release commit 同步（本次 4.0.28 首轮 CI 失败的根因）
<!-- peaks-memory:end -->
