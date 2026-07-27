---
name: peaks-code-loop-skill-proposal-2026-07-28
description: 新 skill `peaks-code-loop` 提案（24h + 不计成本 + 最大并发 + LLM 自决迭代）；与 peaks-code 红线 RL-8 的张力分析；3 种实施路径
metadata:
  type: project
  createdAt: 2026-07-28
---

# `peaks-code-loop` Skill 提案（2026-07-28）

> **状态**：提案 sediment，未实施，未创建 skill，未派 sub-agent。
> **触发**：user 2026-07-28 提出"创建 peaks-code-loop skill — 24h + 不计成本 + 最大并发 + LLM 自决迭代"。
> **scope**：评估"是否应创建 / 怎么创建 / 跟 peaks-code 边界在哪"。

## Why

user 想用一个独立 skill 名称（`peaks-code-loop`）来表达"24h 长跑、不计成本、最大并发、LLM 自决迭代"这套工作模式。当前 peaks-code 是"code-domain long-task loop engineering orchestrator"（peak-code SKILL.md §Scope RL-8），**本身**就是 24h 编排器（[[peaks-cli-24h-ai-programmer-positioning]]）——所以这个新 skill 是 **peaks-code 的 mode 变体**（不是新领域）。

但 peak-code SKILL.md §Scope 明确写：

> Out of scope: research / content / product / medical / non-code domains. Each of those ships as an independent `peaks-*` skill that imports `.peaks/standards/loop-engineering-guidelines.md` and passes `peaks skill lint --category loop-engineering-readiness`. They are **not** subclasses or variants of `peaks-code`.
> Self-check: before any new peak-* capability is added here, ask "is this code-domain?" If the answer is no, the right move is a new `peaks-*` skill, not an extension of `peaks-code`.

→ 关键张力：**"新 code-domain skill" 必须不是 peaks-code 的 variant**。`peaks-code-loop` 在功能上 = peaks-code + 24h 模式默认开启——这**可能**被视为"variant"。

## How to apply

### 1. 3 种实施路径（请 user 选）

| 路径 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| **P1：peaks-code 内 mode 参数** | 不新建 skill；peaks-code SKILL.md 加一段 "24h mode (a.k.a. `peaks-code-loop` mental model)" 章节 + 加 `peaks code run --24h` 旗标 + `peaks session 24h-mode --enable` | 0 攻击面、0 RL-8 张力、0 新增 skill 注册；audit + sediment 沉淀直接消费 | user 拿不到独立 `/peaks-code-loop` 入口；trigger 关键字需要 SKILL.md 列出（"24h" / "通宵" / "不计成本" / "最大并发"） |
| **P2：独立 skill（松耦合）** | 新建 `~/.claude/skills/peaks-code-loop/SKILL.md` —— frontmatter 写 `domain: code` + `parent_skill: peaks-code` + `behavior_mode: 24h-uncapped`；运行时通过 `peaks session 24h-mode --enable` 把当前 session 切到 24h 模式后**所有 peaks-code 子流程继承 24h 默认** | user 有独立 `/peaks-code-loop` 入口、可以跟 `/peaks-code`（assisted / strict）**正交**并行；trigger 关键字更直接（"跑通宵" / "不停机" / "24h"） | 需过 `peaks skill lint --category loop-engineering-readiness`；需声明不**重新实现** peaks-code 的 11 步 runbook，只**配置 mode flag + 覆盖默认**；RL-8 张力需在 frontmatter `out_of_scope` 明确说"非 code-domain 走 peaks-content / peaks-doctor" |
| **P3：独立 skill（强耦合，引入 `peaks-loop-loop` 命名空间）** | 用 `peaks-loop-loop` 命名（强调"24h loop on top of peaks-loop"），是**元层 skill**——继承 peaks-code 但**不**走 11 步 runbook，而是直接 dispatch 大批 sub-agent swarm | 命名清晰，peaks-code + loop-loop 关系明确 | 实施复杂、需新 prompt-injection 协议；容易滑向"万能 orchestrator"陷阱；peaks-loop 红线 `peaks-loop-is-enhancement-not-new-cli` 反对再造一层 CLI |

**推荐 P2**（独立 skill + 24h 模式开关 + 复用 peaks-code 11 步 runbook）。理由：

- user 体验最好（独立入口 + 明确 trigger 关键字）。
- 实施面中等：~300 行 SKILL.md + 1 个 `--24h` flag 在 `peaks code run` + 1 个 `peaks session 24h-mode` CLI 子命令。
- 跟 RL-8 不直接冲突（只要 frontmatter 显式声明 `domain: code` + `parent_skill: peaks-code` + `out_of_scope: 非 code-domain 走 peaks-content / peaks-doctor`）。

### 2. `peaks-code-loop` SKILL.md 必填字段（按 peaks-* 家族约定）

```yaml
---
name: peaks-code-loop
description: |
  24h long-running code-development orchestrator for the Peaks-Loop skill family.
  Use when the user wants to run a code task 24h / overnight / unbounded / uncapped-cost
  with maximum concurrency and LLM-driven iterative decisions. Inherits peaks-code
  11-step runbook but enables 24h mode by default (5 triggers OR / 3 decision buckets
  per [[24h-trigger-and-decision-autonomy-2026-07-28]]).

  Triggers: "24h" / "通宵跑" / "不计成本" / "不停机" / "最大并发" / "auto-decide"
  / "let LLM decide" / "uncapped" / "until done".

  NOT for: short ad-hoc tasks (use /peaks-code) / non-code tasks (use /peaks-content
  or /peaks-doctor) / SOP authoring (use /peaks-sop) / explicit per-step user gates
  (use /peaks-code with --mode strict).

  Parent skill: peaks-code. This skill does NOT reimplement the 11-step runbook;
  it only configures 24h mode flag + override decision defaults per the 3-bucket
  model (B1 infra rotation / B2 engineering choice / B3 user-required).
metadata:
  type: orchestrator-variant
  domain: code
  parent_skill: peaks-code
  behavior_mode: 24h-uncapped
  supersedes: null
  red_lines: [RL-0, RL-1, RL-2, RL-3, RL-8, HC-7, HC-8, HC-9, HC-10, HC-11]
  decision_autonomy_ref: 2026-07-28-24h-trigger-and-decision-autonomy.md
  out_of_scope:
    - non-code tasks (use peaks-content / peaks-doctor)
    - SOP authoring (use peaks-sop)
    - assisted/strict mode (use peaks-code --mode assisted|strict)
---
```

### 3. 行为默认（写进 SKILL.md body）

```text
When /peaks-code-loop is invoked:

1. Auto-enable 24h mode via `peaks session 24h-mode --enable --reason "peaks-code-loop invocation"`.
2. Run peaks-code 11-step runbook with these overrides:
   - Step 0.8 (job-shape): default isJob=true with strategy='rotating'
   - Step 2.5 (mode): default --mode full-auto, override peaks-code default
   - Sub-agent dispatch: always fan-out, never serial fallback
   - Heartbeat: every 30s, stale threshold 5min
   - auto-compact thresholds: 0.70 pre-compact / 0.85 red-line (vs peaks-code default 0.85 / 0.95)
   - Retry: up to 3 retries per slice, then escalate to B3 user-required
3. B3 triggers fire AskUserQuestion only for: PRD direction change, 3+ slice blocker,
   registry-affecting failure, destructive+irreversible op, B1/B2 failure 3x non-converging.
4. Emit status to `peaks dashboard long-run --since 24h` every 5 min.
5. Session persist every 10 min via `peaks session checkpoint` (resume-capable).
6. On exit (all slices done / user stop / B3 unresolvable): emit handoff + sediment
   to `.peaks/memory/`.
```

### 4. 与 peaks-solo / peaks-resume / peaks-status 的关系

| Skill | 关系 | 边界 |
|---|---|---|
| **peaks-solo** (dispatcher) | 平级 | user 不指定时 peaks-solo 应**优选** peaks-code-loop（vs peaks-code）——因为 24h 模式是更激进的默认 |
| **peaks-resume** (resume primitive) | 复用 | peaks-code-loop 的断点恢复走 `peaks session resume` |
| **peaks-status** (status primitive) | 复用 | 24h 模式状态走 `peaks status --long-run`（新加 flag） |
| **peaks-code** (orchestrator) | 父级 | peaks-code-loop 复用 11 步 runbook，**不重新实现**；通过 `peaks session 24h-mode --enable` 让 peaks-code 的所有子流程继承 24h 默认 |
| **peaks-test / peaks-doctor** | 旁路 | 不变 |

### 5. 实施路径（如 user 选 P2）

| 步骤 | 输出 | 谁做 |
|---|---|---|
| 1 | 新建 `~/.claude/skills/peaks-code-loop/SKILL.md`（~300 行 + 上面 frontmatter） | user / skill-creator |
| 2 | 新建 `src/services/session/24h-mode-store.ts`（~80 行持久化） | peaks-rd 派发 |
| 3 | 新建 `src/services/session/24h-mode-decider.ts`（~120 行 5 触发判断） | peaks-rd 派发 |
| 4 | 新建 `src/cli/session-24h-mode.ts`（~60 行 sub-command 包装） | peaks-rd 派发 |
| 5 | 在 `src/cli/code-commands.ts` 给 `peaks code run` 加 `--24h` flag | peaks-rd 派发 |
| 6 | peaks-code SKILL.md 顶部加 "## 24h mode (a.k.a. peaks-code-loop mental model)" 章节（不破坏 RL-8） | peaks-rd 派发 |
| 7 | 3 个 vitest 文件（24h-mode-store / 24h-mode-decider / session-24h-mode CLI） | peaks-rd 派发 |
| 8 | `peaks skill lint --category loop-engineering-readiness` 验证新 skill | peaks-qa 派发 |
| 9 | `peaks standards init --project .` + `peaks audit red-lines` 验证 prose 红线 | peaks-qa 派发 |
| 10 | 1 个 rd slice（半天） + 1 个 qa slice（半天）+ 1 个 sc 提交（小时） | 多 slice 派发 |
| 11 | sediment 落 `.peaks/memory/2026-07-28-peaks-code-loop-skill-shipped.md` | peaks-txt 派发 |

预估：**2-3 个 rid**（24h-mode-store / 24h-mode-decider / skill-install） + **1 个 peaks-skill sync** + **1 个 peaks-skill lint** gate。

### 6. 风险与边界

- **风险 1**：RL-8 张力（"peaks-code variant"）——frontmatter `parent_skill: peaks-code` + `out_of_scope` 显式声明可缓解；`peaks skill lint` 会检这块。
- **风险 2**：`peaks-loop-is-enhancement-not-new-cli` 红线——`peaks-code-loop` 不引入新 CLI 动词，只 mode flag + 1 个 sub-command；安全。
- **风险 3**：`peaks-solo` 优先级——若 peaks-solo 仍默认派 `peaks-code`，peaks-code-loop 入口存在但不被 dispatcher 主动用——需要在 peaks-solo SKILL.md 加"24h 关键字 → peaks-code-loop"段。
- **风险 4**：24h mode 持久化冲突——peaks-code 已有 `peaks session *` CLI，**复用**而不是新增 `peaks 24h-mode`（避免违反 enhancement 红线）。

## 关联

- [[peaks-cli-24h-ai-programmer-positioning]] — 24h 定位（24h mode 默认开启的根因）
- [[peaks-loop-positioning-loop-engineering]] — 4-layer asset model（peaks-code-loop 是 Bee Asset mode parameter）
- [[peaks-code-to-peaks-code-rename-session-directive]] — "不计成本 / 不计时间"是本提案的用户授权
- [[24h-loop-audit-2026-07-28]] — 24h 执行面优化（A-G 7 个方向）
- [[24h-trigger-and-decision-autonomy-2026-07-28]] — 24h 决策面（5 触发 + 3 bucket）—— peaks-code-loop 直接消费此 sediment
- [[human-nl-choice-only-tenet]] — B3 bucket 守住此元规则
- [[peaks-loop-is-enhancement-not-new-cli]] — peaks-code-loop 不引入新 CLI 动词
- [[user-decision-2026-07-08-revive-peaks-solo-as-dispatcher]] — peaks-solo 优先级可能要重排
