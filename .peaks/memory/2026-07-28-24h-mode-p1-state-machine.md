---
name: 24h-mode-p1-state-machine-2026-07-28
description: peaks-code 24h mode P1 路径完整实施提案 v2（re-revised by rd 2026-07-28） — 脑暴 reference-only bridge + 持久化 state machine + 4-level routing precedence + rid-020a/020b 双 rid 切片 + prose red-line lint
metadata:
  type: project
  createdAt: 2026-07-28
  revisedAt: 2026-07-28
  revision: v2 (re-revised after qa+self review — 6 blocker + 4 warning addressed)
---

# peaks-code 24h mode — P1 实施提案 v2（re-revised 2026-07-28）

> **状态**：re-revised proposal sediment，未实施，未派 sub-agent。
> **触发**：user 2026-07-28 选定 P1（不新建 skill，给 peaks-code 加 24h mode），核心约束是**先脑暴 → 用户确认 → 才进 24h 迭代**。
> **v2 变更**：根据 qa (`qa/requests/2026-07-28-rid-020-24h-mode-p1-review.md`) + self (`qa/requests/self-review-2026-07-28-rid-020.md`) 双 lens 反馈，6 blocker + 4 warning 全部 re-architected。
> **scope**：完整定义 P1 实施面（state machine / SKILL.md 章节 / CLI / peaks-solo 路由 / vitest / 2-slice rid 分解 / sediment 落点）。

## Why

user 决策（2026-07-28）：
- **不新建 skill**（避免 RL-8 张力 + 0 攻击面）。
- **24h 模式是 peaks-code 的 mode 变体**——加在 peaks-code SKILL.md 顶部新章节 + 新增 `peaks code run --24h` flag。
- **脑暴前置**——24h 不计成本 + 最大并发的迭代**必须**先经过 brainstorming skill 跑过 + 用户显式确认需求方向 + 风险已识别才进入。
- **蜂群模式拉满**——进 24h 模式后 sub-agent dispatch 永远 fan-out（不退化串行），auto-compact 阈值提前（24h 模式 0.85 / 0.95 partial 优化留 A-G）。

补全 3 个已有 sediment 的实施面：
- [[peaks-code-loop-skill-proposal-2026-07-28]] — 3 路径的元提案
- [[24h-trigger-and-decision-autonomy-2026-07-28]] — 5 触发 + 3 bucket
- [[24h-loop-audit-2026-07-28]] — 7 优化方向 A-G（与本提案正交，留给后续 rid）

## How to apply

### 1. 24h state machine（持久化 + 6 状态）

```
       ┌──────────────┐
       │  IDLE        │
       │ (peaks-code) │
       └──────┬───────┘
              │ user: "24h" / "通宵跑" / "不计成本"
              │   OR slice-list ≥ 30 / wall-clock ≥ 6h
              ▼
   ┌────────────────────┐
   │  BRAINSTORM        │ ←── reference-only bridge
   │  (reference-only)  │     3-gate stop condition
   │                    │     例外: T3 跑飞恢复 / T4 离线 resume 直接进 24H_ACTIVE
   └──────┬─────────────┘
          │ (intent/risks/AC ≥1) re-authored into rd/requests/<rid>.md
          ▼
   ┌────────────────────┐
   │  USER_CONFIRM      │ ←── AskUserQuestion: "需求已澄清 / 风险已识别 / 准备进 24h?"
   │  (B3 trigger)      │     T1/T2/T5 必经
   └──────┬─────────────┘
          │ 1. 进 24h
          ▼
   ┌────────────────────┐
   │  24H_ACTIVE        │ ←── fan-out 永开 / B1+B2 自决 / B3=AskUserQuestion
   │  (full-auto)       │     每 10min checkpoint via `peaks session checkpoint`
   └──────┬─────────────┘
          │ all slices done / user stop / B3 unresolvable
          ▼
   ┌────────────────────┐
   │  HANDOFF +         │ ←── emit-handoff + sediment
   │  SEDIMENT          │     `.peaks/memory/YYYY-MM-DD-<24h-job>-closure.md`
   └────────────────────┘
```

**新增 2 个状态**（F2 修复）：`WAITING_USER`（B3 fired, 持久化 attempts[decisionKey]）和 `HANDOFF`（user abort / 完成）。

**BRAINSTORM stop condition — 3-gate 必须全过**（F1 修复）：
1. **需求清晰** — user intent 段落 + out-of-scope 段落都写入 rd/requests/<rid>.md
2. **风险已识别** — risks 数组 ≥ 1 条（技术 / 业务 / 时间 / 成本任一分类）
3. **AC 草案 ≥ 1 条** — acDraft 数组非空（可量化优先）

任一 gate 未过 → brainstorm 继续；3-gate 全过 → 跳 USER_CONFIRM（不再 invoke writing-plans，不再 commit brainstorming design doc）。

**T3 / T4 例外（auto-24H_ACTIVE）**（F2 修复）：T3 跑飞恢复 / T4 离线用户 resume **不**经过 BRAINSTORM + USER_CONFIRM——直接进 `24H_ACTIVE` 状态，并 emit **单向 status-line 通知**（非 AskUserQuestion）：

```
[24h-mode-notify] auto-engaged: reason=T3|T4, active_slices=N, monotonic_guards=3+, ...
```

T3 / T4 的 USER_CONFIRM 由 LLM 在 24H_ACTIVE 期间的**首个 checkpoint（10min）**或**首个 B3 触发**时一次性提供（user 重连 / user 第一次在线即处理）。这是 "user 离线" 场景的正确行为——强制 USER_CONFIRM 会让 T4 永久卡 `WAITING_USER`。

**State enum + AttemptsMap**（F2 代码片段）：

```ts
type State =
  | 'IDLE'
  | 'BRAINSTORM'
  | 'USER_CONFIRM'
  | '24H_ACTIVE'
  | 'WAITING_USER'
  | 'HANDOFF';

type AttemptsMap = Map<string, number>;  // key = decisionKey (e.g. "B1.retry.sub-agent-X")

function fireB3(reason: string, attempts: AttemptsMap): void {
  const cur = attempts.get(reason) ?? 0;
  attempts.set(reason, cur + 1);
  if (cur + 1 >= 3) {
    throw new B3Escalation(reason, `B3 fired 3x non-converging: ${reason}`);
  }
  // 1st/2nd → continue; 3rd → escalate to user
}

// BRAINSTORM = reference-only bridge. Re-author intent/risks/AC into rd/requests/<rid>.md.
// Do NOT commit brainstorming design doc. Do NOT invoke writing-plans.
type BrainstormOutput = {
  intent: string;
  outOfScope: string[];
  risks: Array<{ category: 'tech' | 'biz' | 'time' | 'cost'; description: string }>;
  acDraft: string[];
};
function collectBrainstormOutput(skillOutput: string): BrainstormOutput {
  // ... re-author from skillOutput; persist to rd/requests/<rid>.md; do not commit
}
```

**B3 触发完整清单**（F2 修复 — 原 5 + 2 = 7 条）：

| # | 触发 | 类型 |
|---|---|---|
| 1 | prd_direction_change | LLM 决策（user 显式改 PRD 方向） |
| 2 | blocker_3_consecutive_slices | runtime 检测 |
| 3 | registry_affecting_failure | npm publish fail / 写错 dist-tag |
| 4 | destructive_irreversible_op | B1/B2 自决有 "破坏性 + 不可回滚" 嫌疑 |
| 5 | any_B1_B2_failure_3x_non_converging | attempts[decisionKey] ≥ 3 |
| 6 | `runtime_or_shared_version_mismatch` | peaks-loop-shared@expected vs peaks-loop@actual 不匹配 |
| 7 | `sub-agent_stale_5min_x3` | batch-heartbeat-poller 报 stale ≥ 3 次累计 |

**Persist 文件**（F2 修复）：`.peaks/_runtime/<sessionId>/24h-mode.json`

```jsonc
{
  "state": "24H_ACTIVE",
  "enteredAt": "2026-07-28T15:00:00Z",
  "enteredFrom": "T1",
  "activeSlices": ["rid-020a", "rid-020b"],
  "monotonicGuards": 0,
  "autoCompactCount": 0,
  "checkpoints": 6,
  "lastCheckpointAt": "2026-07-28T15:50:00Z",
  "attempts": {
    "B1.retry.sub-agent-rid-019": 1,
    "B2.sub-agent-strategy.choice-A": 1
  },
  "exitCondition": null
}
```

**退出 24h**：所有触发条件都不再满足（auto）| user 显式说停 | B3 unresolvable → `HANDOFF` → emit-handoff + sediment。

### 2. peaks-code SKILL.md 必加章节（修正插入点 + red-line grep）

**插入位置**（F5 修复）：在 `skills/peaks-code/SKILL.md` 中**行 43 `## Code-Change Red Line (BLOCKING — read before ANY tool call)` 标题之后**、**行 47 `## Peaks-Loop Superpowers 协作边界` 标题之前**插入。

> 说明：原 proposal §2 描述顺序有误（line 31 title vs line 43 red line 颠倒），本 v2 修正。

**章节文本**（S2 修复 — 已对 `peaks audit red-lines` grep list 做完整 lint）：

```markdown
## 24h mode (a.k.a. peaks-code-loop mental model)

> **不新建 skill**——24h mode 是 peaks-code 的 mode 变体（用户决策 2026-07-28）；
> peak-code SKILL.md §Scope RL-8 红线守住（不重写 11 步 runbook，只加 mode flag + 覆盖默认）。

### 触发条件（5 选 1 OR）

- T1 显式：`peaks code run --24h` 或 NL 关键字 "24h" / "通宵跑" / "不计成本" / "不停机"
- T2 规模：slice-list ≥ 30 **OR** estimated wall-clock ≥ 6h
- T3 跑飞恢复：monotonic-guard 触发 ≥3 次 + 仍有 ≥10 未跑
- T4 离线 resume：session 距今 ≥ 4h + 仍有未完 cycle
- T5 多业务并行：活跃 slice ≥ 3 + 跨度 ≥ 2 个 service 域

### 脑暴前置（reference-only bridge, mandatory gate）

除 T3 / T4 例外，T1 / T2 / T5 触发后必须经过 `superpowers:brainstorming` skill 跑过，**仅作为 reference material**：
- BRAINSTORM 节点**不** commit brainstorming design doc
- BRAINSTORM 节点**不** invoke writing-plans
- 3-gate stop condition：(a) 需求清晰 + (b) 风险已识别 + (c) AC 草案 ≥ 1 条
- 全部 re-authored into `.peaks/_runtime/<sessionId>/rd/requests/<rid>.md` 后，peaks-code 继续 at Step 3（sub-agent fan-out）

T1 / T2 / T5 触发后 `AskUserQuestion` 显式确认才进 24H_ACTIVE：
- "需求已澄清 / 风险已识别 / 准备进 24h?" → 进
- "改 PRD" → 回 brainstorm
- "退出" → 回 IDLE

### 24h 模式行为覆盖

- Step 0.8: isJob=true, strategy=rotating
- Step 2.5: --mode full-auto
- Sub-agent dispatch: 永远 fan-out，无 serial 退化
- Heartbeat: 每 30s, stale threshold 5min
- auto-compact：peaks-loop fires `peaks session auto-compact --execute` automatically on ≥0.85 pre-compact / ≥0.95 red-line zones (zero-pause contract v2.13.0); LLM 不触发, user 不操作
- 重试: 每 slice ≤3 次, 失败 3x 进 B3 user-required
- Checkpoint: 每 10min via `peaks session checkpoint`
- Status: 每 5min `peaks dashboard long-run --since 24h`

### 决策自主权（3 bucket）

- B1 基础设施轮转（auto-compact / monotonic-abort / heartbeat restart / context-spillover / DAG wave / ≤3 次重试）— **不问 user**
- B2 工程层选择（sub-agent 策略 / code-review lens / vitest subset / chunk size / mock vs real / backoff）— **不问 user**
- B3 必须 user（PRD 方向变更 / 3+ slice 阻塞 / registry-affecting 失败 / 破坏性+不可回滚 / B1/B2 失败 3x 不收敛 / runtime_or_shared_version_mismatch / sub-agent_stale_5min_x3）— **必须 AskUserQuestion**

### 退出 24h

- 所有触发条件都不再满足（自动退出）
- user 显式说停（"退出 24h" / "停" / "stop"）
- B3 unresolvable（user 决策"abort"）

退出后 emit-handoff + sediment 到 `.peaks/memory/YYYY-MM-DD-<24h-job>-closure.md`。

### NOT for 24h mode

- 短任务（slice-list < 5 且预估 < 1h）— 用 peaks-code 默认即可
- 非 code 域 — 走 peaks-content / peaks-doctor
- 严格 per-step user gate — peaks-code --mode strict
- 一次性 SOP — peaks-sop

### 关联

- [[24h-loop-audit-2026-07-28]] — 24h 优化方向 A-G（24h mode 启用后这些优化 ROI 更高）
- [[24h-trigger-and-decision-autonomy-2026-07-28]] — 5 触发 + 3 bucket 完整定义
- [[peaks-code-loop-skill-proposal-2026-07-28]] — 3 路径提案，本文件是 P1 实施面
- [[peaks-cli-24h-ai-programmer-positioning]] — 24h 定位根因
```

**路径示例统一为 `<sessionId>`**（F5 修复）：运行时路径占位符一律用 `<sessionId>`（不是 banned 缩写形式），本章内引用路径一律 `.peaks/_runtime/<sessionId>/...`。

**关联 runbook mirror**（F5 修复）：rid-020b 阶段同步编辑 `skills/peaks-code/references/runbook.md`，将 `peaks session 24h-mode --enable` / `--disable` / `--status` 新 CLI 用法 mirror 进 runbook.md。peaks-code/SKILL.md:165-169 明确要求 runbook 与 SKILL.md 同步。

**Red-line lint 验收**（S2 修复）：rid-020b 收尾必须执行 `peaks audit red-lines` + 红线字符串 grep（5 个 auto-compact 反模式字符串 + legacy 阈值 tier 描述），对重写后的 SKILL.md 章节文本，**两个都返回 0 匹配**。完整 grep 列表参考 `.peaks/memory/auto-compact-threshold-policy.md` §红线 / Anti-pattern。

### 3. CLI 设计

#### 3.1 `peaks code run --24h` flag（新 sub-command）

**重要**：当前 `src/cli/commands/code-commands.ts` 仅注册 `code` / `plan` sub-command（F4 修复路径），**不**直接编辑 code-commands.ts。新增独立文件 `src/cli/commands/code-run-command.ts`，由 code-commands.ts line 182 区域加 1 行 `registerCodeRunCommand(code, io)` 调用接入。

行为：
- 接收 → `peaks session 24h-mode --enable --reason "peaks code run --24h"`
- 走脑暴 reference-only bridge（除非 T3/T4 触发 → auto 24H_ACTIVE）
- 然后走 11 步 runbook

#### 3.2 `peaks session 24h-mode` 子命令（新）

```bash
peaks session 24h-mode --enable    # 显式开 + 输出现状
peaks session 24h-mode --disable   # 显式关 + emit-handoff
peaks session 24h-mode --status    # 输出现状 + 触发条件 + bucket 状态
peaks session 24h-mode --json      # machine-readable
```

背后是 `src/services/session/24h-mode-store.ts`（持久化到 `.peaks/_runtime/<sessionId>/24h-mode.json`）+ `24h-mode-decider.ts`（5 触发判断）。

#### 3.3 `peaks dashboard long-run --since 24h`（S1 修复 — 列入 rid-020b scope）

复用 `peaks dashboard`，加 `--since 24h` flag 输出 24h 模式专属指标：
- 24h 内 dispatch 数 / auto-compact 数 / monotonic 触发数 / sub-agent 失败数
- 当前活跃 slice / 队列长度 / 已用 wall-clock
- checkpoint 频率 / resume 次数

**实现位置**：`src/cli/commands/dashboard-long-run.ts`（新文件）+ register 在 peaks CLI 根 + 1 vitest 文件。参考 `src/cli/commands/project-commands.ts:17-26` 注册 `peaks project dashboard` 模式。

### 4. peaks-solo dispatcher 路由改写（4-level precedence — F3 修复）

peaks-solo 当前 24h 关键字不存在路由规则。**4-level precedence**（从最高到最低）：

```
1. Explicit peaks-* skill -> dispatch that exact leaf (HC-10)
   例: "/peaks-content 写一篇 ..."  → peaks-content 自身
2. Explicit peaks-code + 24h keyword -> peaks-code in 24h mode
   例: "/peaks-code 24h 通宵跑 rid-X"  → peaks-code 24H_ACTIVE
3. No explicit leaf + code-domain evidence + 24h keyword -> peaks-code 24h
   例: "帮我把 rid-X 跑完, 不计成本"（无显式 leaf, 但有 rid/代码词）→ peaks-code 24H_ACTIVE
4. Generic autonomy keywords alone -> normal triage (NEVER forced code routing)
   例: "auto-decide" / "让 LLM 决定" / "自己定"（无 code 域证据）→ peaks-solo normal triage
```

**特殊 case 处理**（F3 sub-finding 修复）：
- `/peaks-solo/.../auto-decide` → **回退到 peaks-solo 自身**（不强制 peaks-code 24h）；HC-10 explicit dispatcher
- `/peaks-content/.../24h` → peaks-content 自身 24h 模式（content 域无 11 步 runbook, 不入 peaks-code 24h）；若 content 也需 24h 模式, 后续 rid 设计
- `/peaks-doctor/.../24h` → peaks-doctor 自身（doctor 是只读审计, 不进 24h）

**peaks-solo SKILL.md 改动范围**（仅 rid-020b 编辑）：
- 顶部 `## 路由规则` 章节 加 4-level precedence 表（以上 1-4）
- 加 `### 24h 关键字` 子章节: "24h" / "通宵跑" / "通宵" / "夜跑" / "夜机" / "不计成本" / "不停机" / "不歇" / "到底" / "最大并发" / "蜂群拉满" / "fan-out" / "all-in"
- 加 special case: dispatcher + 24h / content + 24h / doctor + 24h 三条
- 加 v2.14.0 effective-date 与本提案关联

**peaks-solo/references/triage-decision-table.md 改动**（仅 rid-020b 编辑）：
- 新增行: 24h keyword row with 4-level precedence column
- 新增列: code-domain-evidence Y/N
- 新增 3 条 special-case 行

### 5. 4 个 vitest 文件清单（S4 修复 — B1xB3 组合 case 补齐）

| 文件 | 覆盖 |
|---|---|
| `tests/unit/session/24h-mode-store.test.ts` | 持久化（enable / disable / status / 跨 session 持久 / 边界 case） |
| `tests/unit/session/24h-mode-decider.test.ts` | 5 触发条件（每条 case + 组合 case + 退出条件）+ **B1xB3 3 组合 case** |
| `tests/unit/cli/session-24h-mode.test.ts` | `peaks session 24h-mode` CLI 子命令（4 个 flag + json 模式） |
| `tests/unit/cli/code-run-24h-flag.test.ts` | `peaks code run --24h` flag（接受 / 拒绝 / 走脑暴 / 跳过脑暴） |
| `tests/unit/cli/dashboard-long-run.test.ts` | `peaks dashboard long-run --since 24h`（3 个 case：since 解析 / 指标读取 / 边界） |

预估：~35 个 test cases，总 < 700 行。

**B1xB3 3 个组合 case**（S4 修复，必须补齐）：

```ts
// AC-T1: B1 retry attempts[decisionKey] = 1 -> continue, no B3
test('B1.retry first attempt does not fire B3', () => {
  const attempts: AttemptsMap = new Map();
  fireB3('B1.retry.sub-agent-X', attempts);  // first call
  expect(attempts.get('B1.retry.sub-agent-X')).toBe(1);
  // no B3Escalation, continue
});

// AC-T2: B1 retry attempts[decisionKey] = 3 -> fire B3 with reason
test('B1.retry third attempt fires B3Escalation', () => {
  const attempts: AttemptsMap = new Map();
  fireB3('B1.retry.sub-agent-X', attempts);
  fireB3('B1.retry.sub-agent-X', attempts);
  expect(() => fireB3('B1.retry.sub-agent-X', attempts))
    .toThrow(B3Escalation);
});

// AC-T3: B2 retry + B1 retry cross-key — verify attempts map is per-key, not global
test('B1 and B2 attempts are independent (per-key, not global)', () => {
  const attempts: AttemptsMap = new Map();
  fireB3('B1.retry.sub-agent-X', attempts);   // attempts['B1.retry...'] = 1
  fireB3('B2.sub-agent-strategy.A', attempts); // attempts['B2.sub-agent...'] = 1
  expect(attempts.size).toBe(2);
  expect(attempts.get('B1.retry.sub-agent-X')).toBe(1);
  expect(attempts.get('B2.sub-agent-strategy.A')).toBe(1);
});
```

### 6. 2-slice rd 实施计划（F4 + S5 修复 — 拆 rid-020a + rid-020b）

#### rid-020a: state machine + persistence + session CLI

**rid**：`2026-07-28-rid-020a-24h-mode-state-machine`
**type**：feature
**预估 wall-clock**：~半日（4-6h）
**scope**（5 source + 3 vitest）：

1. 新建 `src/services/session/24h-mode-store.ts`（~80 行 + 1 vitest）
2. 新建 `src/services/session/24h-mode-decider.ts`（~120 行 + 1 vitest）
3. 新建 `src/cli/session-24h-mode.ts`（~60 行 + 1 vitest）
4. （状态机 + 6 状态 + AttemptsMap + B3 触发清单 7 条 + persist 路径）
5. `peaks standards init --project . --dry-run` 验证

**AC list**（5-7 条）：
- AC-A1: 24h-mode-store 持久化跨 session 可读（24h-mode.json 在 .peaks/_runtime/<sessionId>/）
- AC-A2: 24h-mode-decider 5 触发条件全部 unit-test 通过
- AC-A3: 3-gate BRAINSTORM stop condition（intent/outOfScope/risks/acDraft）
- AC-A4: T3/T4 auto-24H_ACTIVE 路径（不强制 USER_CONFIRM，emit status-line 通知）
- AC-A5: B3 trigger 7 条全部 unit-test 通过（含 `runtime_or_shared_version_mismatch` + `sub-agent_stale_5min_x3`）
- AC-A6: B1xB3 组合 3 case 全部 unit-test 通过（AC-T1/AC-T2/AC-T3）
- AC-A7: `peaks session 24h-mode --enable/--disable/--status/--json` 4 个 flag 全部 CLI test 通过

**commit message**（S5 修复）：

```
feat(24h-mode): add state machine + persistence + session CLI (rid-020a)

- src/services/session/24h-mode-store.ts: persist 6-state machine + AttemptsMap
- src/services/session/24h-mode-decider.ts: 5 trigger conditions + 7 B3 reasons
- src/cli/session-24h-mode.ts: peaks session 24h-mode sub-command
- 3 vitest files: 24h-mode-store / 24h-mode-decider / session-24h-mode
- T3/T4 auto-24H_ACTIVE path; BRAINSTORM = reference-only bridge with 3-gate stop

Co-author: SquabbyZ sole author (peaks-loop red rule)
```

#### rid-020b: code-run sub-command + integration + SKILL.md chapter + peaks-solo routing

**rid**：`2026-07-28-rid-020b-24h-mode-integration`
**type**：feature
**预估 wall-clock**：~半日（4-6h）
**scope**（4 source + 2 vitest + 3 SKILL.md）：

1. 新建 `src/cli/commands/code-run-command.ts`（~120 行 + 1 vitest）
2. 改 `src/cli/commands/code-commands.ts` line 182 区域加 `registerCodeRunCommand(code, io)`（1 行）+ import 1 行
3. 新建 `src/cli/commands/dashboard-long-run.ts`（~80 行 + 1 vitest）
4. （register `dashboard long-run` 在 peaks CLI 根）
5. 改 `skills/peaks-code/SKILL.md`：在 line 43 `## Code-Change Red Line` 之后插入 `## 24h mode` 章节（约 90 行 markdown）
6. 改 `skills/peaks-code/references/runbook.md`：mirror 新 CLI 用法（`peaks session 24h-mode --enable/--disable/--status`、`peaks code run --24h`、`peaks dashboard long-run --since 24h`）
7. 改 `skills/peaks-solo/SKILL.md`：加 4-level precedence 表 + 24h keyword 子章节 + 3 special case
8. 改 `skills/peaks-solo/references/triage-decision-table.md`：24h keyword row + code-domain-evidence 列 + 3 special-case 行
9. `peaks standards init --project .` + `peaks audit red-lines` 验证（必须 0 red-line 匹配）
10. `peaks skill lint --category loop-engineering-readiness` 验证 peaks-code 仍合规
11. `peaks release precheck --project . --json` 验证
12. `pnpm exec vitest run tests/unit/session/24h-mode-*.test.ts tests/unit/cli/session-24h-mode.test.ts tests/unit/cli/code-run-24h-flag.test.ts tests/unit/cli/dashboard-long-run.test.ts`

**AC list**（5-7 条）：
- AC-B1: `peaks code run --24h` flag 接受 + 触发脑暴 gate + 跳过脑暴（T3/T4 路径）
- AC-B2: `peaks dashboard long-run --since 24h` 读取 24h-mode.json + 输出指标（dispatch / auto-compact / monotonic / sub-agent failure / checkpoint）
- AC-B3: peaks-code SKILL.md `## 24h mode` 章节插入位置正确（line 43 后, line 47 前）
- AC-B4: `peaks audit red-lines` 退出 0（5 个 forbidden 字符串 grep 返回 0 匹配）
- AC-B5: peaks-solo SKILL.md 4-level precedence 表 + 24h keyword 子章节落地
- AC-B6: peaks-solo/references/triage-decision-table.md 24h row + 3 special-case 行落地
- AC-B7: `peaks skill lint --category loop-engineering-readiness` 退出 0

**commit message**（S5 修复）：

```
feat(24h-mode): add code-run sub-command + SKILL.md chapter + peaks-solo routing (rid-020b)

- src/cli/commands/code-run-command.ts: peaks code run --24h sub-command
- src/cli/commands/code-commands.ts: 1-line registerCodeRunCommand call
- src/cli/commands/dashboard-long-run.ts: peaks dashboard long-run --since 24h
- 2 vitest files: code-run-24h-flag / dashboard-long-run
- skills/peaks-code/SKILL.md: ## 24h mode chapter at line 43 (after Code-Change Red Line)
- skills/peaks-code/references/runbook.md: mirror new CLI usage
- skills/peaks-solo/SKILL.md: 4-level precedence + 24h keyword + 3 special case
- skills/peaks-solo/references/triage-decision-table.md: 24h row + code-domain column

Co-author: SquabbyZ sole author (peaks-loop red rule)
```

**总估算**：2 commits, 2 rids, all source code change is in rid-020b; rid-020a is state-only。墙钟合计 ~1 工作日（half-day × 2）。

### 7. 风险与边界

- **风险 1**：brainstorming skill 是否已装——若未装，需要先 `peaks skill install brainstorming` 或在 sediment 提示 user 装。
- **风险 2**：peaks-solo 路由改写可能影响现有 routing 测试——需在 24h 关键字测试用例上**显式 assert 路由到 peaks-code**。
- **风险 3**：24h mode 持久化跨 session 行为——必须 vitest case 验证 `.peaks/_runtime/<sessionId>/24h-mode.json` 在 session 切换后仍能被读出。
- **风险 4**：auto-compact 阈值与 peaks-code 默认冲突——24h 模式通过 `peaks code run --24h` 单独走 24h-mode-decider，不影响 peaks-code 默认 0.85/0.95 路径。
- **风险 5**：A-G 7 个优化方向（[[24h-loop-audit-2026-07-28]]）与本提案的 24h mode 是**正交**的——本提案**不**做 A-G 实施，留给后续 rid。
- **风险 6**（S2 新增）：SKILL.md 章节 prose 红线——rid-020b 收尾必须执行 `peaks audit red-lines` + 5 个 forbidden 字符串 grep，**两个都返回 0 匹配**才允许 ship。

### 8. 验证清单（rid-020b ship gate）

- [ ] `peaks audit red-lines` 退出 0
- [ ] 5 forbidden auto-compact strings + legacy 阈值 tier grep `skills/peaks-code/SKILL.md` 返回 0 匹配（参考 `.peaks/memory/auto-compact-threshold-policy.md` §红线 / Anti-pattern）
- [ ] `peaks skill lint --category loop-engineering-readiness` 退出 0
- [ ] `peaks release precheck --project . --json` 退出 0
- [ ] `pnpm exec vitest run tests/unit/session/24h-mode-*.test.ts tests/unit/cli/session-24h-mode.test.ts tests/unit/cli/code-run-24h-flag.test.ts tests/unit/cli/dashboard-long-run.test.ts` 全绿
- [ ] peaks-solo routing 测试（4-level precedence + 3 special case）全绿

### 9. 受影响文件汇总（green-field diff 概览）

| 文件 | rid | 类型 | 行数估算 |
|---|---|---|---|
| `src/services/session/24h-mode-store.ts` | rid-020a | new | ~80 |
| `src/services/session/24h-mode-decider.ts` | rid-020a | new | ~120 |
| `src/cli/session-24h-mode.ts` | rid-020a | new | ~60 |
| `src/cli/commands/code-run-command.ts` | rid-020b | new | ~120 |
| `src/cli/commands/code-commands.ts` | rid-020b | edit (+2 lines) | +2 |
| `src/cli/commands/dashboard-long-run.ts` | rid-020b | new | ~80 |
| `skills/peaks-code/SKILL.md` | rid-020b | edit (+90 lines) | +90 |
| `skills/peaks-code/references/runbook.md` | rid-020b | edit | ~30 |
| `skills/peaks-solo/SKILL.md` | rid-020b | edit | ~30 |
| `skills/peaks-solo/references/triage-decision-table.md` | rid-020b | edit | ~15 |
| `tests/unit/session/24h-mode-store.test.ts` | rid-020a | new | ~150 |
| `tests/unit/session/24h-mode-decider.test.ts` | rid-020a | new | ~250 |
| `tests/unit/cli/session-24h-mode.test.ts` | rid-020a | new | ~150 |
| `tests/unit/cli/code-run-24h-flag.test.ts` | rid-020b | new | ~120 |
| `tests/unit/cli/dashboard-long-run.test.ts` | rid-020b | new | ~100 |

### 10. 验证基线（rid-020a → rid-020b 流转）

rid-020a ship 后必须满足：
- vitest 3 文件全绿
- `peaks standards init --project . --dry-run` 通过
- 无 lint / typecheck 错误

rid-020b ship 后必须满足 §8 全部验收。

### 11. Sediment 落点（S3 修复）

按 peaks-loop §Step 11 sediment 硬规则，**ship 后**（rid-020b 合并入 main 后）由 peaks-txt sub-agent 落盘 `.peaks/memory/2026-07-28-24h-mode-p1-shipped.md`，内容必须包含：

- rid-020a commit sha + rid-020b commit sha
- 9 个 source/edit 文件路径 + commit ref
- 5 个 vitest 文件 + 全绿输出（passed/total/skipped 数字）
- `peaks audit red-lines` 退出码 + 5 个 forbidden 字符串 grep 输出（必须全 0）
- `peaks skill lint --category loop-engineering-readiness` 退出码
- `peaks release precheck --project . --json` 退出码
- user-facing 触发关键词（5 类 T1-T5 + 24h keyword list）通过 `peaks skill search --keyword <kw>` 验证可达

**Sediment 不会写到本 proposal 文件**——本文件是 re-revised proposal，ship sediment 走独立文件。

## 关联

- [[peaks-code-loop-skill-proposal-2026-07-28]] — 3 路径提案（P1 / P2 / P3），本文件是 P1 实施面
- [[24h-trigger-and-decision-autonomy-2026-07-28]] — 5 触发 + 3 bucket 完整定义
- [[24h-loop-audit-2026-07-28]] — 7 优化方向 A-G（24h mode 启用后这些优化 ROI 更高）
- [[peaks-cli-24h-ai-programmer-positioning]] — 24h 定位根因
- [[peaks-code-to-peaks-code-rename-session-directive]] — "不计成本 / 不计时间"是本提案的用户授权
- [[human-nl-choice-only-tenet]] — B3 bucket 守住此元规则
- [[peaks-loop-is-enhancement-not-new-cli]] — 不引入新 CLI 动词（仅在 peaks-code / peaks session / peaks dashboard 现有命名空间下加 sub-command）
- [[auto-compact-threshold-policy]] — S2 prose red-line + 0.85 / 0.95 zones reference