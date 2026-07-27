---
name: auto-compact-threshold-policy
description: 优化 peaks-loop v2.13.0 auto-compact 契约 — ≥85% 显性告诉 user + LLM 跑 peaks session auto-compact --execute 完成后当前任务;>95% 必须立刻停下来用 peaks session auto-compact --execute 压缩
kind: feedback
createdAt: 2026-07-27
sessionId: 2026-07-26-session-0e9141
---

# peaks-loop auto-compact threshold policy (2026-07-27 user 校准)

## 触发条件 (binding)

| Context ratio 阈值 | LLM 行为 | 强制级别 |
|---|---|---|
| **< 0.85** | skip — LLM 继续工作,no action | 自由 |
| **0.85 ≤ ratio < 0.95** | 单向通知 user(status line 形式,不需要 user 回应/决策/acknowledgement) + LLM 跑 `peaks session auto-compact --execute` 压缩 *完成后当前任务* | **soft-mandatory** |
| **≥ 0.95** | 单向通知 user + 立刻停下来 + LLM 跑 `peaks session auto-compact --execute` 压缩 | **hard-mandatory** |

## Why

原 v2.13.0 zero-pause 契约说"auto-compact fires automatically at ≥0.85, the LLM does NOT prompt the user"。但 user 实操发现:

1. **≥85% 时不应打断当前任务** — LLM 正在做的 task 可能是 multi-step slice (RD/QA/impl),半途中断造成 loss of context,等当前 task 自然收尾再 compact 更高效
2. **>95% 时必须立刻停下来** — ratio ≥0.95 时 context 已经 overflow 风险极高,继续执行可能 hit auto-compact red-line (Karpathy §4 例外),损失巨大
3. **不应 prompt user 跑 /compact** — Human-NL-Choice-Only + peaks-loop 是 enhancement layer,LLM 是 operator;user 只 speak / pick,LLM 跑 peaks CLI

## How to apply

### ≥85% 阈值 (soft-mandatory, 完成后当前任务)

LLM 流程:
1. 检测到 ratio ≥0.85 (via harness strategic-compact hint 或 `peaks code context-now --enforce-job-mode` 返回 `action: 'auto-compact-now'`)
2. **不立即** compact — 先完成当前 turn 的任务(或本 slice 的 commit)
3. **单向通知 user** — response 中显示 status line (notification 形式,**不需要 user 回应/决策/acknowledgement**):
   > [context-notify] ratio=87% (≥85%),本 task 收尾后将自动 compact
4. 完成 task 后立即 compact:运行 `peaks session auto-compact --execute --project <path>`
5. **绝对不** AskUserQuestion 询问 user 是否 compact、是否继续、是否暂停 — LLM 自动决策

### >95% 阈值 (hard-mandatory, 立刻停下)

LLM 流程:
1. 检测到 ratio >0.95 (via `peaks code context-now --enforce-job-mode` 返回 `action: 'red-line'` 或 harness warning)
2. **立即停止** 正在执行的任何 task(包括 RD/QA dispatch in-flight,sub-agent output pending)
3. **不等 user 确认** — Karpathy §4 red-line exception:LLM 不能 opt out;user 不能 opt-out
4. **单向通知 user** — 一行 status,无问询:
   > [context-red-line] ratio=96% (≥95%),立即 compact
5. 立即 compact:运行 `peaks session auto-compact --execute --project <path>`
6. compact 后恢复 task 时,**优先 sed-resume 而非重做** — 用 `peaks resume` 读 checkpoint

## CLI 实际可用性 (caveat)

peaks 4.0.0-beta.37 当前注册了:
- ✅ `peaks session auto-compact-hook` (PreToolUse hook entrypoint, ratio ≥0.95 时 in-band spawn `claude --compact`)
- ❌ `peaks session auto-compact --execute` (直接命令在 4.0.0-beta.37 build 未注册,但 v2.13.0 契约 + peaks-code SKILL.md 引用此原语)

**Workaround for 4.0.0-beta.37:**
- 直接调用 `peaks session auto-compact-hook` (在 CLAUDE_CONTEXT_USAGE_PERCENT env var 已设的情况下)
- 或调用 harness `/compact` slash command (Karpathy §4 例外允许)
- 未来 peaks 版本应有原生 `peaks session auto-compact --execute` 注册

## Job mode 加成 (v3.1.2)

Job mode (multi-slice sequence) 下:
- ≥0.85 自动升级为 **MANDATORY** (不依赖 in-flight batch deferral)
- 即 Job mode 下 ≥85% 立即 compact,不等到本 task 完成
- 这是 v3.1.2 §4 的 binding 例外

## 红线 / Anti-pattern

以下行为视为 regression,**禁止**:

1. ❌ AskUserQuestion 询问 user 是否 compact / 是否继续 / 是否暂停 — LLM 自动决策,user 仅接收单向通知
2. ❌ prompt user 跑 `/compact` 或 `peaks session auto-compact` (Human-NL-Choice-Only 违反)
3. ❌ ratio ≥0.95 继续执行 task (Karpathy §4 例外违反)
4. ❌ ratio ≥0.85 时半途打断 multi-step task (本 sediment 校准的目标)
5. ❌ 写 prose 说"ask user to compact" / "user should run peaks session auto-compact manually" / "confirm before proceeding" (auto-compact regression marker)
6. ❌ legacy pre-v2.13.0 thresholds (mid / seventy-five / ninety percent tiers)

## 通知 vs AskUserQuestion 区分 (binding)

| 形式 | 触发 | user 角色 |
|---|---|---|
| **状态行通知** (LLM 输出文本) | ratio ≥0.85 / ≥0.95 | 接收者,无回应 |
| **AskUserQuestion** (LLM 调用工具) | 仅在 user-driven decision tree | 决策者,**必须响应** |

auto-compact 通知是**单向 status line**,**绝不**调用 AskUserQuestion。即 user 看到 `[context-notify]` 行后不需要回复、点击或确认任何东西,LLM 自动继续。

## 验证 (Karpathy §1)

- 读 peaks-code SKILL.md Step N+2 (zero-pause contract) + Step 0.8 §4 (Job mode ≥0.85 mandatory)
- 读 peaks-audit SKILL.md 中的 red-line enforcement layer
- 验证 `peaks code context-now --enforce-job-mode --json` 返回结构含 `action: 'ok' | 'soft-warn' | 'auto-compact-now' | 'red-line'`
- **本 sediment 是 v2.13.0 zero-pause 契约的 user 校准版**,softening 仅在 0.85-0.95 zone

## 关联 references

- [[peaks-code-runbook-4-0-0-beta-6-skill-md-d-001-d-002-d-003-d-010]] — peaks-code SKILL.md 引用了 v2.13.0 contract (sediment 可能 ghost,见 [[memory-md-ghost-sediment-finding]])
- peaks-code SKILL.md Step N+2 (auto-compact at warning line) — 原始契约来源
- peaks-code SKILL.md Step 0.8 §4 (Job mode ≥0.85 mandatory) — v3.1.2 加成来源
- Karpathy-guidelines §4 (goal-driven execution + red-line exception)