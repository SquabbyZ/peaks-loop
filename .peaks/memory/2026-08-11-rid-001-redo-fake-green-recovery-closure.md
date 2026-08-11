<!-- peaks-memory:start -->
---
title: rid-001 redo fake-green recovery closure — 9 文件 commit landed e8fb5ed9
kind: lesson
date: 2026-08-11
session: 2026-08-11-session-476090
session-continued-from: 2026-08-11-session-7f7f78
rids: [rid-001, rid-001-revision]
commits: [e8fb5ed9]
related: [[2026-08-11-dogfood-4-0-20-cli-wiring-and-vendor-detect-defects]], [[2026-08-11-detached-architecture-feedback-in-shell-background]]
---

# rid-001 redo closure — fake-green recovery 完整 cycle

> **优先级**：项目级 hard lesson。任何 "新增 CLI 表面" slice 都必须按本 sediment 的 anti-fake-green + RD repair discipline 走。

## 一句话总结

4.0.20 SHIPPED 时 rid-001 CLI seam 是死代码；rd-001 redo 在 user 授权丢 stash 重做后，从 RD 4 子任务 → RD repair 2 surgical fix → QA cycle 1 fail → QA cycle 2 pass → SC 出 commit message → 1 atomic commit `e8fb5ed9`（9 文件 / SquabbyZ sole-author / 无 AI trailer）。

## Timeline（关键节点）

| 时间 (UTC) | 事件 | 出处 |
|---|---|---|
| 2026-08-10 21:30Z | 4.0.20 SHIPPED to npm（commit `fde6b9f6`），但 vendor-detect + dispatch --mode detached 是死代码 | git log |
| 2026-08-11 00:15Z | session 7f7f78 启动，"技能路径解析与codegraph项目优化"；RD 子代理写 rd artifact 声称 5/5 reachability PASS | `.peaks/_runtime/2026-08-11-session-7f7f78/rd/requests/001-rid-001.md` |
| 2026-08-11 01:18Z | session 7f7f78 中断（user 反馈 "刚才的 session 意外中断"） | session summary |
| 2026-08-11 02:37Z | session 476090 启动（outer session id `abf2ef2f...`），fresh skill presence | session.json |
| 2026-08-11 02:51Z | peaks-code presence:set mode=swarm gate=rd-qa-handoff | CLI |
| 2026-08-11 03:00Z | user 授权 git-stash-mutating，drop stash@{1}（4 src + version bump）+ stash@{0}（2 单测 fix） | worktree-gate |
| 2026-08-11 ~03:05Z | RD redo 子代理 dispatch（general-purpose + read peaks-rd SKILL.md + 4 子任务 explicit） | sub-agent |
| 2026-08-11 ~03:20Z | RD redo 完成；rd artifact `.peaks/_runtime/2026-08-11-session-476090/rd/requests/001-rid-001-revision.md` 写完 | sub-agent |
| 2026-08-11 ~03:25Z | QA cycle 1 子代理 dispatch | sub-agent |
| 2026-08-11 ~03:32Z | **QA cycle 1 verdict=fail**：command 9 unhandled ENOENT（pre-existing in detached.ts:50）+ version bump 违例 | sub-agent |
| 2026-08-11 ~03:35Z | RD repair cycle 1 dispatch（2 surgical fix） | sub-agent |
| 2026-08-11 ~03:42Z | RD repair 完成（version 还原 + `process.on('uncaughtException')` 替代 `child.on('error')`） | sub-agent |
| 2026-08-11 ~03:45Z | QA cycle 2 子代理 dispatch | sub-agent |
| 2026-08-11 ~03:55Z | **QA cycle 2 verdict=pass**（10/10 + 5/5 红线 + leak 检测 0 + 回归 3/3 PASS） | sub-agent |
| 2026-08-11 ~04:00Z | SC 子代理 dispatch 出 commit boundary + commit message | sub-agent |
| 2026-08-11 ~04:05Z | SC 完成；commit message 5 红线 PASS；9 文件清单 | sub-agent |
| 2026-08-11 03:38Z+0800 | **commit landed**：`e8fb5ed992ed2c29cbd986c90b79147ee35feeed` SquabbyZ sole-author，9 files / 436 ins / 21 del | git log |

## 4 个 Lesson（must apply future）

### Lesson 1 — fake-green at RD layer 也能发生（**最关键**）

**现象**：rd-001 的 rd artifact 写"5/5 reachability tests PASS"，但 5 个 integration 测试文件从未落盘到 working tree。RD 阶段也 fake-green —— 不是只有 QA 才能 fake-green。

**根因**：
- RD 子代理 "described but not exist"：写完 rd artifact 后没 grep working tree 确认测试文件真存在
- `git ls-files tests/integration/*-reachability.test.ts` 是 anti-fake-green gate，**必须** RD 自验时跑

**Why**：
- fake-green 在任何层（RD/QA/test）都是 silent failure：单测绿、build 绿、rd artifact 写"已完成"，用户 `peaks vendor-detect --json` 仍 `Unknown command`
- 反 fake-green 不能只看 exit code；要看 working tree 上文件真的在
- "describe in artifact" ≠ "implement on disk"

**How to apply**：
- 任何 slice 包含"新增文件"或"修改文件"，RD artifact 必须有 §On-Disk Evidence 章节，含 `git ls-files <files>` verbatim 输出 + `git status --short <files>` verbatim 输出
- 5 红线 / 9 必跑 / 验收命令，必须包含 `git ls-files` 验证落地
- 未来 sub-agent prompt 模板强制 frontmatter `must_ls_files: <glob>` 字段

### Lesson 2 — RD repair cycle discipline (3-cycle cap)

**现象**：QA cycle 1 fail 后自动进 RD repair cycle 1；QA cycle 2 pass → 出 commit。完整 cycle 1=RD → 2=QA → 3=repair → 4=QA → 5=SC → 6=commit。

**Why**：
- peaks-code Mandatory Auto-proceed 规则：QA 失败 ≤ 3 cycle 即 block
- 这次只用了 1 repair cycle（最小）就 pass，证明 RD 写得很扎实 + QA verdict 框架清晰
- 关键：QA verdict 不能"照搬 RD 报告"——必须独立跑 9 必跑命令

**How to apply**：
- 任何 sub-agent dispatch prompt 必须包含 "你必须独立验证 RD 的所有 claim，不照搬 RD 报告"
- QA 必须实际跑每条命令 + 捕获 exit code + stdout/stderr verbatim
- 9 必跑 / 10 必跑 / 5 红线这种数字化的验收 framework 比"PRD §X"更可审计

### Lesson 3 — uncaughtException vs child.on('error') 妥协

**现象**：RD repair cycle 1 在 `src/cli/commands/sub-agent/detached.ts` 加 `process.on('uncaughtException')` handler 吞 ENOENT；不是首选的 `child.on('error')`。

**Why 妥协**：
- ChildProcess 由 `peaks-loop-internal-runtime/src/process-supervisor.ts:31` 创建
- `DispatchResult` interface 不暴露 child 引用
- 修 detached.ts 这一层看不到 child = 不能直接 `child.on('error')`
- 改 DispatchResult 是 runtime package 的修改（**out of scope** per rid-001 红线）
- 用 `process.on('uncaughtException')` 是 pragmatic 妥协：addListener + removeListener 对称 + try/finally + 50ms settle

**How to apply**：
- 这是 **technical debt**，SC handoff 已标 F1 follow-up
- 未来 slice：`expand DispatchResult` 暴露 child → `detached.ts` 改回 `child.on('error')`
- uncaughtException 是全局 handler，吞所有 uncaught 异常；即使加 narrow filter 也比 child.on('error') 风险面大
- 当下可接受（QA cycle 2 leak 检测：100-iteration simulation 0 listener leak），但不持久化接受

### Lesson 4 — SquabbyZ sole-author 红线在 SC 层 enforce

**现象**：SC 子代理出 commit message 时，red-line audit 5 条全 grep/diff verbatim 验证（"Co-Authored-By: Claude/Anthropic" / emoji / 引用 detached feedback / Generated with Claude Code / Author 覆盖），全部 EXIT=1。

**Why**：
- 项目级 hard rule 写在 `.peaks/memory/redline-no-claude-co-author.md`
- commit message 一旦 push 就永久 record，每个字必须审
- SC 层做最后一道 enforcement，**不是** RD/QA 阶段 enforce
- 5 红线 verbatim grep 是最低门槛

**How to apply**：
- 任何 SC dispatch prompt 必须含 5 条红线 verbatim + 要求 grep 实际 EXIT=1
- git config user.name / user.email 必须在 SC artifact §Author Identity Check 章节 verbatim 引用
- commit message 主体不能含 author override 行（依赖 git config 继承）

## 反模式（**不要做**）

1. **不要** `git add -A` 或 `git add .` —— 会把 .peaks/memory/*.md（sediment 文件）一起 stage 进去，污染 commit
2. **不要** 在 commit message 里给 RD/QA agent 任何 credit —— SquabbyZ sole-author
3. **不要** 跳过 QA 直接 commit —— fake-green 风险
4. **不要** 在 RD artifact 写 "测试 PASS" 但没真跑 —— Lesson 1 的 fake-green
5. **不要** 用 `process.on('uncaughtException')` 作为长期方案 —— Lesson 3 的技术债

## Sediment 关联

- [[2026-08-11-dogfood-4-0-20-cli-wiring-and-vendor-detect-defects]] — 同 session 发现的 3 个缺陷（CLI 死代码 / vendor-detect Windows ENOENT / bee 命名空间）
- [[2026-08-11-detached-architecture-feedback-in-shell-background]] — user 反馈 detached 架构该是 in-shell bg 不是 new powershell（**未**进 rid-001 commit；F2 future slice）
- [[peaks-code-runbook-4-0-0-beta-10-skill-md-cli-d-004-d-005-d-006]] — peaks-code SKILL.md 与实际 CLI 多处偏离（本 cycle 未触发但同源风险）

## Follow-up 列表（不进本 slice scope）

- **F1**：扩 `DispatchResult` 暴露 ChildProcess；`detached.ts` 改 `child.on('error')`；需要 runtime package 修改（out of rid-001 scope）
- **F2**：detached architecture 全面 revision（in-shell background subprocess 而非 OS-detached）；参考 `[[2026-08-11-detached-architecture-feedback-in-shell-background]]`
- **F3**：vendor-detect 在 Windows 上 ENOENT 真 fix；改用 `where claude` + PATHEXT 解析，不用 `shell: true`（`shell: true` 有命令注入面）；见 `2026-08-11-dogfood-*.md` 缺陷 2
- **F4**：pre-existing test rot（dispatch-isolation-lifecycle 3 fail / sub-agent-dispatch-e2e 3 fail / dispatcher-flow 1 fail）单独 slice 修
- **F5**：peak-code 子代理 dispatch 模板加 `must_ls_files` frontmatter 字段（Lesson 1 应用）

<!-- peaks-memory:end -->