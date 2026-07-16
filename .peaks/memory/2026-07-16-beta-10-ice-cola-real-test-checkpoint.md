---
name: 2026-07-16-beta-10-ice-cola-real-test-checkpoint
description: 4.0.0-beta.10 ice-cola 现场实测 0/27 AC 通过 + 用户决策"实现 3 切片后 publish" + rotating job 启动 + peaks-prd sub-agent 已在跑
metadata:
  type: project
  date: 2026-07-16
  sessionId: 2026-07-16-session-019b0b
  parentSessionId: 2026-07-15-session-87a173
  jobId: 2026-07-16-cli-surface-cleanup-impl
  sliceCount: 3
  acTested: 27
  acPassed: 0
---

# 4.0.0-beta.10 ice-cola 实测 + implement job 启动 — checkpoint

**日期:** 2026-07-16
**会话:** 2026-07-16-session-019b0b (ice-cola 锚定, parent=2026-07-15-session-87a173 peaks-loop 主仓)
**jobId:** 2026-07-16-cli-surface-cleanup-impl
**状态:** PRD v3 sub-agent dispatch 已发,RD/QA/Slice 2/3 待后续 rotating cycle

## 实测一句话结论

**4.0.0-beta.10 当前 main 分支 = 27/27 AC 全 FAIL**。
CHANGELOG 自标 "PRE-IMPLEMENTATION" 是诚实的:bump 版本号 + 写合同 + verify-pipeline 9/9 pass,**但 3 切片实现代码 0 行落地**。

## 关键证据(实测,非推断)

| 检查 | 实测 |
|---|---|
| `peaks minimax-worker --help` | exit 0, 打印完整 help |
| `peaks worker minimax --help` | exit 0, 打印完整 help |
| `peaks config provider minimax set --help` | exit 0, 打印完整 help |
| `grep -rni minimax src/` | 30+ 行匹配 |
| `peaks --help` 含 minimax-worker | 含 |
| `peaks --help` 10 个 hidden 角色 | 全部可见 (prd/qa/sc/audit/code-review/perf-audit/security-audit/upgrade/agent/code) |
| `peaks agent --help` | 还在,文案是旧 Option A subprocess 语义 |
| `peaks ecc install --help` | 命令不存在, fallback 到 `peaks --help` 全文 |
| `src/cli/commands/agent-commands.ts` | 存在 (应删除) |
| `src/cli/commands/ecc-commands.ts` | 不存在 (应新建) |
| `src/services/agent/ecc-cache-service.ts` | 不存在 (应新建) |
| `minimax-2.7` 字面量 | `rd-service.ts:25` + `workflow-router-service.ts:296` 还在 |

## 用户决策 (2026-07-16, AskUserQuestion)

**Q1 publish 路径:** "实现 3 切片后 publish (Recommended)"
**Q2 实现模式:** "full-auto (Recommended)"
**结论:** 走最诚实路径,3 切片串行 1→2→3 实现,每步 commit + 跑 27 AC,最后 publish beta.10。

## peaks-code 启动记录

1. `peaks workspace init --project ice-cola` → sessionId `2026-07-16-session-019b0b` (ice-cola), rotated from `2026-07-15-session-c598ef`
2. `peaks session info --active --json` → active binding = `2026-07-15-session-87a173` (peaks-loop 主仓, 因为 peaks job init 在 peaks-loop 项目下跑)
3. `peaks job init --job-id 2026-07-16-cli-surface-cleanup-impl --slice-list "slice-1-del-minimax-worker,slice-2-hide-role-skills,slice-3-on-demand-ecc" --main-loop-strategy rotating --parallelism-hint serial --exit-policy strict`
4. `peaks skill presence:set peaks-code --mode full-auto --gate step-2`
5. `peaks session title "2026-07-15-session-87a173" "cli-surface-cleanup-impl 3-slice"` (D-002 fix: sid is positional, no --project)
6. **PRD v3 sub-agent dispatch**: agentId `a75edebc91c3c11b1`, target `.peaks/_runtime/2026-07-15-session-87a173/prd/requests/002-cli-surface-cleanup-v3-impl.md`

## Why this matters (How to apply)

### 1. Ice-cola 实测暴露的 4 个新增风险(已纳入 PRD v3)

1. **3-slice merge order 1→2→3 是硬约束**,不是建议。Slice 3 flip `peaks agent` 默认行为,必须等 Slice 2 先 hide `peaks agent`,否则用户看到"不存在于 --help 里却有了新行为"的命令。
2. **Slice 3 cache dir 权限**:Unix `chmod 0700`, Windows ACL。RD plan 没写,PRD v3 补。
3. **LLM context budget**:`peaks ecc show <name>` 一次性把整个 SKILL.md 灌给 LLM 风险爆 context。需要 `--section` / `--max-lines` flag。
4. **affaan-m/ECC agents/*.md YAML frontmatter 假设**:上游若改成纯 markdown,`listCachedAgents` 要 fallback 到文件名解析。

### 2. CLI 漂移 D-002 复发(本次实测再次踩中)

`peaks session title --session-id <sid> --project <path>` 报 `unknown option --project`。
**Fix:** sid 是 positional,不要 `--session-id` flag;`--project` 不是合法 flag。
**已 sediment:** `.peaks/memory/peaks-code-runbook-4-0-0-beta-6-skill-md-cli-d-001-d-002-d-003-d-010.md`,本次再次踩中说明 sediment 没装进肌肉记忆,需要每次新 session 先扫一遍。

### 3. `peaks sub-agent dispatch` CLI 的实际签名跟 SKILL.md 描述有差

SKILL.md 写 `--role / --task / --karpathy / --caller-id / --job-id / --slice-id`,实测只有:
- `<role>` positional
- `--prompt` (无 --task)
- 无 `--karpathy`(要 append 到 --prompt)
- 无 `--caller-id`(用父 session 的 sid 注入)
- 无 `--job-id` / `--slice-id`(不在 CLI 层)
- `--request-id` 是唯一 request 维度 flag

且 CLI 是 **dry-run** —— "the LLM executes the returned toolCall in its own environment"。主 LLM 必须用 Agent 工具实际 dispatch。

**How to apply:** 简单场景(单 sub-agent)直接用 Agent 工具,绕开 `peaks sub-agent dispatch` CLI 复杂性,只在 fan-out / 跨 batch 协作时才用 CLI。

### 4. ice-cola pnpm file: link 是双刃剑

ice-cola `node_modules/peaks-loop` 直链 peaks-loop 主仓源码。改 peaks-loop src → 重跑 `peaks <cmd>` 立即看到(<1s 反馈)。
但任何 peaks-loop `package.json` `version` 字段改动需要 `pnpm install` 重新 link ice-cola。

## Rotating job 节奏(下次会话 resume)

| Step | 当前会话 | 下次 rotating 会话 1 | 下次 rotating 会话 2 | 下次 rotating 会话 3 |
|---|---|---|---|---|
| Job 状态 | done=0/3, Slice 1 in progress | done=0/3 → 1/3 | done=1/3 → 2/3 | done=2/3 → 3/3 |
| 任务 | dispatch PRD v3 (跑中) | RD Slice 1 touchlist + test plan → QA 7 AC → commit + checkpoint | Slice 2 全 cycle | Slice 3 全 cycle + peaks-final-review + publish |

每个 rotating 周期 = 1 slice = prd→rd→qa→commit→checkpoint。`--main-loop-strategy rotating` 让 peaks-code 自动在 slice 完成后 rotate 主会话。

## 关键文件位置(下次 resume 用)

| 文件 | 路径 |
|---|---|
| 实测报告 (本次) | `ice-cola/.peaks/_runtime/2026-07-16-session-019b0b/txt/2026-07-16-beta.10-ice-cola-real-test.md` |
| PRD v3 (in flight) | `peaks-loop/.peaks/_runtime/2026-07-15-session-87a173/prd/requests/002-cli-surface-cleanup-v3-impl.md` |
| PRD v2 (existing) | `peaks-loop/.peaks/_runtime/2026-07-15-session-87a173/prd/requests/001-cli-surface-cleanup-and-on-demand-ecc.md` |
| Sediment (existing) | `peaks-loop/.peaks/memory/cli-cleanup-on-demand-ecc-design-2026-07-16.md` |
| Release runbook | `peaks-loop/docs/release/4.0.0-beta.10.md` |
| Job state | `peaks-loop/.peaks/_runtime/2026-07-15-session-87a173/job/2026-07-16-cli-surface-cleanup-impl/state.json` |
| Session binding (active) | `peaks-loop/.peaks/_runtime/session.json` → sessionId `2026-07-15-session-87a173` |
| ice-cola binding | `ice-cola/.peaks/_runtime/session.json` → sessionId `2026-07-16-session-019b0b` |

## 下次 peaks-code 启动时要做的 4 件事

1. **读 PRD v3** (`.peaks/_runtime/.../prd/requests/002-cli-surface-cleanup-v3-impl.md`) 拿到最新设计
2. **dispatch peaks-rd** for Slice 1 touchlist + test plan
3. **dispatch peaks-qa** for Slice 1 7 AC verification
4. **git commit + `peaks job checkpoint --slice-id slice-1-del-minimax-worker --state done`** 然后 rotate

如果想 fresh 而不是 resume,在 peaks-loop 项目下跑 `peaks workspace init --no-rotate-on-outer-mismatch` 强制新 sid(但会 orphan job,需要先 `peaks job status --job-id 2026-07-16-cli-surface-cleanup-impl` 确认状态)。

## 相关 memory

- [[cli-cleanup-on-demand-ecc-design-2026-07-16]] — 3-slice 设计 sediment (事实 1-5)
- [[peaks-code-runbook-4-0-0-beta-6-skill-md-cli-d-001-d-002-d-003-d-010]] — CLI 漂移 sediment (D-001/002/003/010)
- [[peaks-code-consumer-project-smoke-test-ice-cola]] — 2026-07-05 ice-cola 实测 (早场全绿 + 晚场 CLI 锁死)
- [[peaks-loop-24h-ai-programmer-positioning]] — user = 业务/产品审阅者
- [[human-nl-choice-only-tenet]] — user 不敲 CLI
---

## UPDATE 2026-07-16 17:48 UTC — Long-run mode active

**User directive (2026-07-16, 17:48 UTC):** "按照长任务来做吧,不考虑成本,选择你来决定就行,我先睡觉了"

**Long-run mode protocol:**
- User has explicitly delegated full-auto long-task execution to peaks-code rotating job mode
- Per user hard rule from [[peaks-code-to-peaks-code-rename-session-directive]]: 一次到位 / 不计成本 / 不计时间 / 禁假绿 / 禁偷懒 / 存量迁移 LLM 做
- No mid-flight AskUserQuestion unless truly user-only decision (per [[human-nl-choice-only-tenet]])
- Periodic checkpoint every 20 tool calls; main loop rotates at each slice boundary

**PRD v3 status (2026-07-16):**
- Written: `peaks-loop/.peaks/_runtime/2026-07-15-session-87a173/prd/requests/002-cli-surface-cleanup-v3-impl.md`
- sha256: `08bbbbcff78c583f70283b107577adf2c50225346bd4bccc72e330806001f9e5`
- Status: ✅ accepted, transition to rd-handoff pending (prd state machine: draft | confirmed-by-user | handed-off | blocked)

**RD sub-agent dispatched (2026-07-16 17:48 UTC):**
- agentId: `aa4860c64a41ba68c`
- Target output: Slice 1 del-minimax-worker touchlist + test plan + risk list
- Expected location: `peaks-loop/.peaks/_runtime/2026-07-15-session-87a173/rd/requests/2026-07-15-cli-surface-cleanup.md` (update existing) OR `peaks-loop/.peaks/_runtime/2026-07-15-session-87a173/rd/tech-doc-slice-1.md` (new)

**Periodic checkpoint:** `peaks-loop/.peaks/_runtime/2026-07-15-session-87a173/checkpoints/2026-07-15T17-48-30-573Z.json` (retained=3)

**Next rotating session responsibilities:**
1. Verify RD touchlist is complete + karpathy-compliant
2. Dispatch peaks-qa sub-agent → verify AC1.1..AC1.7 mechanically
3. If QA green → trigger implementer (human or LLM with file edit rights) to apply touchlist
4. Implementer commit + `peaks job checkpoint --slice-id slice-1-del-minimax-worker --state done --commit-sha <sha>`
5. Rotate to Slice 2 cycle
