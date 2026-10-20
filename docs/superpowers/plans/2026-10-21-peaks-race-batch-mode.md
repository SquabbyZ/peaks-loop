# peaks-race-code 批量模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **⚠️ peaks-loop bridge rule:** this plan is written in the `writing-plans` format as **reference material**. The **authoritative** plan is the peaks-rd PRD artifact at `.peaks/_runtime/2026-10-20-session-f7f45b/rd/requests/002-2026-10-21-race-batch-mode.md`. Execute via `peaks sub-agent dispatch rd`, **not** `superpowers:executing-plans` directly — peaks-rd is the only authoritative planner/executor pair.

**Goal:** 给 peaks-race-code 加一个批量模式：N 个互相独立的 bug（或小需求）走「并行只读诊断 → 定档 → 修复 → 一次统一验证」，把 N 次门禁墙钟变成 1 次。

**Architecture:** 四个阶段。阶段①并行派发 peaks-rd 子代理做**只读**诊断，产出根因 + 实测文件集；阶段②用实测文件集喂给既有的 `planFileOverlapWaves` 算冲突图定拓扑；阶段③带诊断结果修复（不重读仓库）；阶段④跑**与今天完全相同**的门禁一次。诊断并行是主要收益来源（不碰 code-gate、无写冲突、共享前缀命中缓存）。上下文安全靠新增的批量进度产物落盘 + 压缩点选在阶段边界。

**Tech Stack:** TypeScript 5.7 / Node ≥24 / pnpm 10.11 / vitest 4.1.10（**硬锁，禁止升 5.x**）/ commander 12.1 / zod 4.6.7。

**Spec:** `docs/superpowers/specs/2026-10-21-peaks-race-batch-mode-design.md`

**Plan:** `docs/superpowers/plans/2026-10-21-peaks-race-batch-mode.md`

**✅ Probe results (2026-10-21, already measured):** `docs/superpowers/plans/2026-10-21-race-batch-probe-results.md`
- **Probe A = A-1（放行）**：Task 子代理**继承父会话的 `CLAUDE_CODE_SESSION_ID`**，与租约 owner 相同 ⇒ 身份解析成立 ⇒ `peaks-race-code` 租约下 `src/` 放行。**Task 3 只走分支 A-1。**
- **Probe B = B-2（探针有盲区，且比预期严重）**：production CLI 恒传 `graphs: []` ⇒ `probeInFlightBatch` 恒返回 false ⇒ **D6.e 的 deferral 在 production 是死代码**。⇒ **Task 6 是硬前置**（`progress.json` 的 `phase` 是唯一能表达"有批次在飞"的信号），且压缩点**必须**是阶段边界。
- **本仓库没装 `peaks code-gate`**（只装了 `gate-step-08` / `gate enforce` / `auto-compact`）⇒ A-1 测的是身份解析，**不是**装好的拒绝。Task 3 验收须在**装了 code-gate 的项目**里复跑一次。

### Task 4 的机制已端到端验证（2026-10-21）

在派 Task 4 之前实测了它依赖的那条链，**确认它可行**（不是纸面推断）：

```bash
$ npx --package @alibaba-group/open-code-review@1.13.1 -- \
    ocr delegate rule "src/services/hooks/pre-tool-code-gate.ts" --format json
{
  "schema_version": "1",
  "groups": [{
    "group_id": 1,
    "source": "system",
    "pattern": "**/*.{ts,js,tsx,jsx,mjs,cjs}",
    "files": ["src/services/hooks/pre-tool-code-gate.ts"],
    "rule": "#### Obvious Typos or Spelling Errors\n- ...\n#### Dead Code\n- ...\n#### Code Quality Checks\n- **Duplicate Code**: ...\n..."
  }]
}
```

⇒ **路径列表单独使用即可，不需要 git range**；返回的是**按 pattern 分组的规则文本**，无 key、无 LLM 调用。
⇒ `buildDelegateRuleArgs(paths, {})` 产出的 argv 是
`["--package","@alibaba-group/open-code-review@1.13.1","--","ocr","delegate","rule","<path>","--format","json"]`
（实测，不是读代码推的）。

⚠️ **注意规则文本的长度** —— 上面这一条 TS 规则就有 ~2 KB。**注入 prompt 时要按文件集聚合**（同一个 pattern 的规则只写一次），否则 N 个文件 × 2 KB 会把修复 prompt 撑爆。⇒ Task 4 的实现必须**按 pattern 分组去重**。

---

### 派发给子代理的提示词形状（Task 6 实测得出，后续 task 照此写）

Task 6 的第一版提示词把「门禁契约」整段放在最前面，附 7 个产物路径和各自的 marker 清单。
**子代理把契约当成了任务主体** —— 前 70 分钟它在读 `judged-declaration.ts`、
`artifact-contract-block.ts`、`security-audit detect`，**四个实现文件一个没写**。

⇒ **给子代理的提示词必须遵守三条**：

1. **产物清单压到一行**，并且明确标注「**最后做**」；否则子代理会先去满足清单。
2. **写清楚工作目录**（worktree 的绝对路径）；Task 6 的子代理在主树与 worktree 之间来回跑，
   因为提示词只说「用 worktree」没说「在哪」。
3. **把已知的门禁陷阱写成禁令**，而不是让子代理自己撞出来。Task 6 撞了两次：
   - 空 `catch {}` → `silentWarningEmptyCatch` 60→61，基线棘轮**拒绝写入**（这是对的）
   - prettier 未格式化 → `prettierUnformatted` 0→1，同样被棘轮拒绝

   ⇒ 提示词里直接写「**不要空 catch 块**」+「**提交前跑 prettier**」，
   比让它自己撞一次再修快得多。

**已验证有效的形状**：先说「读计划的 Task N 节 → 只实现 Task N」，再给「Task 6 已经合进 main，
你消费这些文件」清单，再给「怎么工作」（先写失败测试 / scoped 测试 / 不要空 catch / 800 行 / prettier），
最后才是「产物最后做，有时间才做」和「报告 ≤40 行」。

### 派发时省上下文的做法

`peaks sub-agent dispatch` 的 envelope **含完整 prompt（约 20 KB）**，直接打印会灌满编排器窗口。
⇒ 用 `.tmp/dispatch.mjs` 派发：envelope 落盘到文件，只回 `batchId` / `promptSize` /
`dispatchRecordPath` / `prompt` 前 300 字符。**后续 task 全部走这条路。**

---

## Global Constraints

- **提交信息不得含任何 AI 署名 trailer**（`Co-Authored-By: Claude` / `Anthropic` / `MiniMax` 全部禁止）。SquabbyZ（`601709253@qq.com`）是唯一作者。机械支撑：`tests/unit/standards/no-ai-co-author-trailer.test.ts`（**detect-not-prevent**，补救是改历史）。
- **vitest 锁在 `^4.1.10`** —— 用户指令禁止升 5.x。
- **Node `>= 24.0.0`**。**pnpm `10.11.0`**。**commander `^12.1.0`**。**zod `^4.6.7`**。
- **文件行数上限 800**（`peaks scan file-size`，Karpathy §2）。新增文件超限即失败。
- **文件路径一律 POSIX 化**（`normalizePath`，`src/shared/path-utils.ts`）。Windows 上 `src\a.ts` 与 `src/a.ts` 是**两个不同文件**（§U-c）。
- **不改** `HARD_BLOCKED_PATH_FAMILIES`（`src/services/hooks/pre-tool-code-gate.ts:32`）。
- **不改** 压缩的 0.80 / 0.85 / 0.95 三档阈值。
- **不改** peaks-code 的 11 步工序、Gate A–G、transition 状态机。
- **单任务路径零成本**：N=1 时批量模式**完全不走**（不诊断、不预读、不定档）。
- **所有新提示文案必须走 `buildContextVerdict`**（`src/cli/commands/core/skill-context-verdict.ts:32`），否则既绕过 `tests/unit/cli/skill-presence-loop-hygiene.test.ts` 的守卫又破坏零停顿契约。
- **不得把 `.peaks/<date-*>/` 或 `.peaks/_runtime/<date-*>/` 建在 `.peaks/` 顶层**；session 产物只在 `.peaks/_runtime/<sessionId>/` 下。
- **禁止 `git push` / `git tag` / `npm publish`** —— 这 5 个动作即使在 full-auto 也必须用户显式确认（`peaks commit-boundary-actions`）。
- **`peaks sub-agent dispatch` 不得从 orchestrator 的 shell 直接调用** —— 它是 LLM 组合的 CLI 原语；LLM 侧读 `data.toolCall` 再用 IDE 的 Task 工具执行。

## Review Focus

最可能咬到使用者的五个输入/失败模式，按可能性排序。每一行都有对应的测试，落在拥有该代码的 task 里。

1. **Windows 路径分隔符**：诊断产出的文件集里混着 `src\a.ts` 与 `src/a.ts` ⇒ 波次规划器判成两个不同文件 ⇒ **整个写冲突检测失效**，两个 agent 同时改同一个文件。测试：`tests/unit/services/batch/batch-progress-store.test.ts`
2. **批量模式在 N=1 时**多走了一步（诊断/预读/定档）⇒ 单任务路径变慢、行为变了。测试：`tests/unit/services/batch/batch-entry.test.ts`
3. **压缩落在阶段①与②之间**：编排器窗口里的「哪几项诊断完了」如果只在上下文里，压缩一次批量进度就退回"重新诊断"。测试：`tests/unit/services/batch/batch-progress-recovery.test.ts`
4. **阶段边界提示文案变成「建议你现在压缩」** ⇒ 把压缩甩给用户，违反零停顿契约。测试：`tests/unit/services/batch/batch-verify.test.ts`（新增）+ `tests/unit/cli/skill-presence-loop-hygiene.test.ts`（**已存在，扩展它**）
5. **诊断 agent 预测的文件集与实际改动不符**（说改 A 实际改了 A+B）⇒ 文件 B 的写冲突没被检测到。测试：`tests/unit/services/batch/batch-diagnosis.test.ts`

---

## Task 0: 两个 probe —— 先测，再定后面的形状

> ✅ **已完成（2026-10-21）。** 结论：**A-1（放行）** + **B-2（探针有盲区，D6.e 在 production 是死代码）**。
> 完整记录：`docs/superpowers/plans/2026-10-21-race-batch-probe-results.md`
> **本 task 保留在计划里作为存档与回归锚点** —— 下面的测试仍然要写（它们把结论钉成可执行断言），但**不再阻塞**后续 task。
> **Task 3 只走分支 A-1**（Step 5 分支被删，Step 6 升为唯一路径）。

**Files:**
- Create: `tests/unit/services/batch/probe-driver-resolution.test.ts`
- Create: `tests/unit/services/batch/probe-compact-interrupt.test.ts`
- Create: `docs/superpowers/plans/2026-10-21-race-batch-probe-results.md` ✅ **已创建**

**Interfaces:**
- Consumes: `decideGateAction(tool, input, driver)`（`src/services/hooks/pre-tool-code-gate.ts:97`）；`resolveActiveSkillForCaller(projectRoot, {callerId})`（`src/services/audit/enforcers/active-skill-resolver.ts:68`）；`hasLeaseForCaller(projectRoot, callerId)`（同文件 `:234`）
- Produces: `docs/superpowers/plans/2026-10-21-race-batch-probe-results.md` —— 一节「Probe A 结论」一节「Probe B 结论」，每节含：复算命令、原始输出、结论、以及**结论对 Task 3 写法的影响**

- [ ] **Step 1: 写 Probe A 的失败测试 —— race presence 下能否放行硬阻断家族**

```ts
// tests/unit/services/batch/probe-driver-resolution.test.ts
import { describe, expect, it } from 'vitest';
import { decideGateAction } from '../../../src/services/hooks/pre-tool-code-gate.js';

describe('probe A: driver resolution under a race-code presence lease', () => {
  it('allows src/ when the resolved driver is exactly peaks-race-code', () => {
    const verdict = decideGateAction('Edit', { file_path: 'src/a.ts' }, 'peaks-race-code');
    expect(verdict).toEqual({ action: 'allow' });
  });

  it('denies src/ when the driver resolves to nothing (the null case)', () => {
    const verdict = decideGateAction('Edit', { file_path: 'src/a.ts' }, null);
    expect(verdict.action).toBe('deny');
  });

  it('denies src/ for a sibling lane name — the match is whole-string', () => {
    const verdict = decideGateAction('Edit', { file_path: 'src/a.ts' }, 'peaks-race-code-batch');
    expect(verdict.action).toBe('deny');
  });
});
```

- [ ] **Step 2: 跑测试确认它测的是真行为**

Run: `npx vitest run tests/unit/services/batch/probe-driver-resolution.test.ts`
Expected: PASS（3 个用例都过 —— 这三个断言描述的是**既有**行为，本步是把它钉住）

- [ ] **Step 3: 实测 Probe A —— 一个 Task 子代理的 caller id 能不能拿到租约**

这是**实测**，不是推理。做法：

```bash
# 1) 看当前租约的 callerId（本 session 的）
node node_modules/tsx/dist/cli.mjs src/cli/index.ts skill presence --json
# 记下 data.outerSessionId —— 它就是 lease 的 callerId

# 2) 起一个 Task 子代理（用任何角色），让它回报自己的 caller id
#    在子代理的 prompt 里让它运行：
#      node node_modules/tsx/dist/cli.mjs src/cli/index.ts skill presence --json
#    并把 data.outerSessionId 报回来

# 3) 比对两个 caller id
```

记录到 probe 文档，三种结论之一：

| 观察 | 结论 | 对 Task 3 的影响 |
|---|---|---|
| 子代理的 caller id **等于**租约 owner | **A-1：放行** | Task 3 直接排 N' 个 peaks-rd 子代理 |
| 子代理的 caller id **不等于** owner | **A-2：不放行** | Task 3 的修复阶段**留在主窗口**（退回 Slice 1/2 形态）；并行化另立 slice |
| 子代理**拿不到** presence | **A-3：身份不可解析** | 同 A-2，且需在 Task 3 里显式记录「driver 不可解析 ⇒ 保守 deny」 |

> ⚠️ **不要跳过这步去改代码。** 设计文档 §U-a 已记：代码读出来的推理**自相矛盾**（`hasLeaseForCaller` 要求租约所有者，但 peaks-code 的 RD 子代理今天确实在改 `src/`）。实测是唯一能定论的证据。

- [ ] **Step 4: 写 Probe B 的失败测试 —— 压缩会不会打断在飞的诊断 agent**

```ts
// tests/unit/services/batch/probe-compact-interrupt.test.ts
import { describe, expect, it } from 'vitest';
import { evaluateAutoCompactDecision } from '../../../src/services/code/auto-compact-decision.js';

describe('probe B: compaction decision while a diagnostic fan-out is in flight', () => {
  it('defers at the pre-compact tier when a batch is in flight', () => {
    const d = evaluateAutoCompactDecision({ ratio: 0.9, inFlightBatch: true });
    expect(d.shouldCompact).toBe(false);
    expect(d.reason).toBe('in-flight-batch');
  });

  it('does NOT defer at the red line — the harness is asked now', () => {
    const d = evaluateAutoCompactDecision({ ratio: 0.96, inFlightBatch: true });
    expect(d.shouldCompact).toBe(true);
    expect(d.reason).toBe('red-line');
  });
});
```

- [ ] **Step 5: 跑测试确认它测的是真行为**

Run: `npx vitest run tests/unit/services/batch/probe-compact-interrupt.test.ts`
Expected: PASS（描述的是既有行为）

- [ ] **Step 6: 实测 Probe B —— 图探针看不见诊断 fan-out 吗**

设计文档 §7A.3 缺口 1 说：`hasInFlightBatch` 由**工作流图探针**给出，而诊断 fan-out **不是**图节点 ⇒ 探针看不见它。

实测方法：

```bash
# 在一个诊断 fan-out 正在跑的时候（Task 1 之后才有），跑：
node node_modules/tsx/dist/cli.mjs src/cli/index.ts code context-now --project . --json
# 记下 ratio 与 action
# 再直接问图探针：
node node_modules/tsx/dist/cli.mjs src/cli/index.ts sub-agent wave-plan --slices-json '[]' --json
```

记录三种结论之一：

| 观察 | 结论 | 对 Task 3/Task 6 的影响 |
|---|---|---|
| 探针**能**看到诊断 fan-out | **B-1：探针够用** | Task 6 不需要额外的 in-flight 信号 |
| 探针**看不见** | **B-2：探针有盲区** | Task 6 必须自己提供 batch-in-flight 信号（`progress.json` 的 `phase` 就是那个信号）|
| 压缩在 fan-out 中途**真的打断了** agent | **B-3：确证打断** | 压缩点**只能**选阶段边界（①→② / ③→④），且 Task 6 的进度落盘变成**硬前置** |

> **B-2 和 B-3 指向同一个动作**：`progress.json` 的 `phase` 字段既是恢复依据，也是 in-flight 信号。**这让 Task 6 从"锦上添花"变成"不可省"** —— 无论 B 的结论如何，Task 6 都要做。

- [ ] **Step 7: 写 probe 结果文档**

`docs/superpowers/plans/2026-10-21-race-batch-probe-results.md`：

```markdown
# Race batch mode — probe results (2026-10-21)

## Probe A: driver resolution under a race-code presence lease
- 结论: A-1 | A-2 | A-3
- 复算命令: <实际跑的命令>
- 原始输出: <粘贴>
- 对 Task 3 的影响: <照抄 Step 3 的表>

## Probe B: compaction vs. an in-flight diagnostic fan-out
- 结论: B-1 | B-2 | B-3
- 复算命令: <实际跑的命令>
- 原始输出: <粘贴>
- 对 Task 3 / Task 6 的影响: <照抄 Step 6 的表>
```

- [ ] **Step 8: 提交**

```bash
git add tests/unit/services/batch/probe-driver-resolution.test.ts \
        tests/unit/services/batch/probe-compact-interrupt.test.ts \
        docs/superpowers/plans/2026-10-21-race-batch-probe-results.md
git commit -m "test(batch): probe the two questions that decide the batch topology"
```

---

## Task 6: 批量进度落盘（上下文监控的地基）

> **用户裁决 2026-10-21：独立 slice。** 且它**必须**在 Task 3 之前 —— 无论 Probe B 的结论如何，压缩一次批量进度都不能丢。

**Files:**
- Create: `src/services/batch/batch-progress-types.ts`
- Create: `src/services/batch/batch-progress-store.ts`
- Test: `tests/unit/services/batch/batch-progress-store.test.ts`
- Test: `tests/unit/services/batch/batch-progress-recovery.test.ts`

**Interfaces:**
- Consumes: `getSessionDir(projectRoot, sessionId)`（`src/services/session/getSessionDir.ts`）；`normalizePath`（`src/shared/path-utils.ts`）
- Produces:
  - `BatchItemStatus = 'pending' | 'diagnosed' | 'fixed' | 'verified'`
  - `BatchPhase = 'diagnosis' | 'topology' | 'fix' | 'verify' | 'done'`
  - `BatchProgress`（见下）
  - `readBatchProgress(projectRoot: string, sessionId: string, batchId: string): BatchProgress | null`
  - `writeBatchProgress(projectRoot: string, sessionId: string, progress: BatchProgress): void`
  - `appendBatchItem(projectRoot: string, sessionId: string, batchId: string, item: BatchItem): void` —— **逐项追加**，不是整体覆盖
  - `normalizeFileSet(files: readonly string[]): readonly string[]` —— POSIX 化 + 去重 + 排序

- [ ] **Step 1: 写失败测试 —— 文件集规范化（Review Focus #1）**

```ts
// tests/unit/services/batch/batch-progress-store.test.ts
import { describe, expect, it } from 'vitest';
import { normalizeFileSet } from '../../../src/services/batch/batch-progress-store.js';

describe('batch file-set normalization', () => {
  it('treats a backslash path and a slash path as the same file', () => {
    expect(normalizeFileSet(['src\\a.ts', 'src/a.ts'])).toEqual(['src/a.ts']);
  });

  it('strips a leading ./ so it matches the bare path', () => {
    expect(normalizeFileSet(['./src/a.ts'])).toEqual(['src/a.ts']);
  });

  it('drops empty entries and sorts', () => {
    expect(normalizeFileSet(['src/b.ts', '', 'src/a.ts'])).toEqual(['src/a.ts', 'src/b.ts']);
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `npx vitest run tests/unit/services/batch/batch-progress-store.test.ts`
Expected: FAIL —— `normalizeFileSet` 不存在（module not found）

- [ ] **Step 3: 实现 `normalizeFileSet`**

```ts
// src/services/batch/batch-progress-store.ts
import { normalizePath } from '../../shared/path-utils.js';

export function normalizeFileSet(files: readonly string[]): readonly string[] {
  const set = new Set<string>();
  for (const raw of files) {
    if (typeof raw !== 'string') continue;
    const posix = normalizePath(raw).replace(/^\.\//, '');
    if (posix.length > 0) set.add(posix);
  }
  return [...set].sort();
}
```

- [ ] **Step 4: 跑测试确认它通过**

Run: `npx vitest run tests/unit/services/batch/batch-progress-store.test.ts`
Expected: PASS

- [ ] **Step 5: 写失败测试 —— 逐项追加而不是整体覆盖**

```ts
// 追加到 tests/unit/services/batch/batch-progress-store.test.ts
import { appendBatchItem, readBatchProgress, writeBatchProgress } from '../../../src/services/batch/batch-progress-store.js';

describe('batch progress store', () => {
  it('appends one item without losing the previous items', () => {
    writeBatchProgress(root, sid, { batchId: 'b1', phase: 'diagnosis', items: [] });
    appendBatchItem(root, sid, 'b1', { id: 'i1', label: 'bug A', status: 'diagnosed', files: ['src/a.ts'] });
    appendBatchItem(root, sid, 'b1', { id: 'i2', label: 'bug B', status: 'diagnosed', files: ['src/b.ts'] });
    const p = readBatchProgress(root, sid, 'b1');
    expect(p?.items.map(i => i.id)).toEqual(['i1', 'i2']);
  });

  it('records the phase so it can act as the in-flight signal', () => {
    // 写一个 phase='diagnosis' 的进度，读回来断言 phase 相同
  });
});
```

- [ ] **Step 6: 跑测试确认它失败**

Run: `npx vitest run tests/unit/services/batch/batch-progress-store.test.ts`
Expected: FAIL —— `appendBatchItem` / `writeBatchProgress` 未实现

- [ ] **Step 7: 实现 store**

```ts
// src/services/batch/batch-progress-types.ts
export type BatchItemStatus = 'pending' | 'diagnosed' | 'fixed' | 'verified';
export type BatchPhase = 'diagnosis' | 'topology' | 'fix' | 'verify' | 'done';

export interface BatchItem {
  readonly id: string;
  readonly label: string;
  readonly status: BatchItemStatus;
  readonly files: readonly string[];
  readonly riskSurface?: number;
  readonly diagnosedAt?: string;
  readonly fixedAt?: string;
}

export interface BatchProgress {
  readonly batchId: string;
  readonly phase: BatchPhase;
  readonly items: readonly BatchItem[];
  readonly topology?: unknown;
  readonly updatedAt: string;
}
```

```ts
// src/services/batch/batch-progress-store.ts
// 路径：<sessionDir>/batch/<batchId>/progress.json
// 写：tmp 文件 + renameSync（原子，避免读到半个文件 —— 与 pilot-gate-store 同一手法）
// 追加：读 → 合并 → 原子写
// batchId 必须过安全路径检查（防路径穿越）
```

- [ ] **Step 8: 跑测试确认它通过**

Run: `npx vitest run tests/unit/services/batch/batch-progress-store.test.ts`
Expected: PASS

- [ ] **Step 9: 写失败测试 —— 压缩后从盘上恢复（Review Focus #3）**

```ts
// tests/unit/services/batch/batch-progress-recovery.test.ts
import { describe, expect, it } from 'vitest';

describe('batch progress survives a compaction', () => {
  it('recovers which items are diagnosed from disk, not from context', () => {
    // 模拟：写 3 项诊断进度 → 清掉一切"上下文"（这里就是新读一遍）
    // → 断言读回来的 items 仍是 3 项，且 status 正确
  });

  it('does not re-run diagnosis for items already marked diagnosed', () => {
    // 断言恢复逻辑只把 status==='pending' 的项放进待诊断列表
  });
});
```

- [ ] **Step 10: 跑测试确认它失败，然后实现恢复函数**

```ts
// src/services/batch/batch-recovery.ts
export function pendingItems(progress: BatchProgress): readonly BatchItem[] {
  return progress.items.filter(i => i.status === 'pending');
}
export function diagnosedItems(progress: BatchProgress): readonly BatchItem[] {
  return progress.items.filter(i => i.status === 'diagnosed' || i.status === 'fixed' || i.status === 'verified');
}
```

Run: `npx vitest run tests/unit/services/batch/batch-progress-recovery.test.ts`
Expected: FAIL → 实现后 PASS

- [ ] **Step 11: 提交**

```bash
git add src/services/batch/ tests/unit/services/batch/
git commit -m "feat(batch): persist batch progress so a compaction cannot lose it"
```

---

## Task 1: 批量模式骨架 + 诊断并行

**Files:**
- Create: `src/services/batch/batch-entry.ts`
- Create: `src/services/batch/batch-diagnosis.ts`
- Create: `src/cli/commands/batch-commands.ts`
- Test: `tests/unit/services/batch/batch-entry.test.ts`
- Test: `tests/unit/services/batch/batch-diagnosis.test.ts`

**Interfaces:**
- Consumes: `planFileOverlapWaves(slices)`（`src/services/dispatch/file-overlap-wave-planner.ts:74`）；`normalizeFileSet`（Task 6）；`appendBatchItem` / `writeBatchProgress`（Task 6）；`BatchItem`（Task 6 的 `batch-progress-types.ts`）
- Produces:
  - `decideBatchMode(itemCount: number): 'single' | 'batch'` —— **N=1 ⇒ 'single'**（Review Focus #2）
  - `planBatchTopology(items: readonly BatchItem[]): FileOverlapWavePlan` —— 调 `planFileOverlapWaves`，输入用 `normalizeFileSet` 过的文件集
  - `buildDiagnosisPrompt(item: {id: string; label: string; symptom: string}): string` —— 只读诊断 prompt
  - `peaks batch diagnose --rid <rid> --project <repo> --json`（新 CLI）

- [ ] **Step 1: 写失败测试 —— N=1 不进批量（Review Focus #2）**

```ts
// tests/unit/services/batch/batch-entry.test.ts
import { describe, expect, it } from 'vitest';
import { decideBatchMode } from '../../../src/services/batch/batch-entry.js';

describe('batch mode entry', () => {
  it('stays on the single-task path for one item', () => {
    expect(decideBatchMode(1)).toBe('single');
  });
  it('enters batch mode for two or more items', () => {
    expect(decideBatchMode(2)).toBe('batch');
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `npx vitest run tests/unit/services/batch/batch-entry.test.ts`
Expected: FAIL —— `decideBatchMode` 不存在

- [ ] **Step 3: 实现 `decideBatchMode`**

```ts
// src/services/batch/batch-entry.ts
export function decideBatchMode(itemCount: number): 'single' | 'batch' {
  return itemCount >= 2 ? 'batch' : 'single';
}
```

- [ ] **Step 4: 跑测试确认它通过**

Run: `npx vitest run tests/unit/services/batch/batch-entry.test.ts`
Expected: PASS

- [ ] **Step 5: 写失败测试 —— 诊断 fan-out 是只读的，且用实测文件集定拓扑**

```ts
// tests/unit/services/batch/batch-diagnosis.test.ts
import { describe, expect, it } from 'vitest';
import { planBatchTopology } from '../../../src/services/batch/batch-diagnosis.js';

describe('batch topology from measured file sets', () => {
  it('puts two items with disjoint files in the same wave', () => {
    const plan = planBatchTopology([
      { id: 'i1', label: 'a', status: 'diagnosed', files: ['src/a.ts'] },
      { id: 'i2', label: 'b', status: 'diagnosed', files: ['src/b.ts'] }
    ]);
    expect(plan.waves[0]?.slices).toEqual(['i1', 'i2']);
  });

  it('defers an item that collides on a file, naming the collision', () => {
    const plan = planBatchTopology([
      { id: 'i1', label: 'a', status: 'diagnosed', files: ['src/a.ts'] },
      { id: 'i2', label: 'b', status: 'diagnosed', files: ['src/a.ts'] }
    ]);
    expect(plan.waves.length).toBe(2);
    expect(plan.waves[1]?.deferred[0]?.collidingFile).toBe('src/a.ts');
  });

  it('treats a Windows path and a slash path as the SAME file', () => {
    // 这是 Review Focus #1 —— 不规范化就会判成不相交，两个 agent 同时改一个文件
    const plan = planBatchTopology([
      { id: 'i1', label: 'a', status: 'diagnosed', files: ['src\\a.ts'] },
      { id: 'i2', label: 'b', status: 'diagnosed', files: ['src/a.ts'] }
    ]);
    expect(plan.waves.length).toBe(2);
  });
});
```

- [ ] **Step 6: 跑测试确认它失败**

Run: `npx vitest run tests/unit/services/batch/batch-diagnosis.test.ts`
Expected: FAIL —— `planBatchTopology` 不存在

- [ ] **Step 7: 实现 `planBatchTopology`**

```ts
// src/services/batch/batch-diagnosis.ts
import { planFileOverlapWaves, type FileOverlapWavePlan } from '../dispatch/file-overlap-wave-planner.js';
import { normalizeFileSet } from './batch-progress-store.js';

export function planBatchTopology(items: readonly BatchItem[]): FileOverlapWavePlan {
  const descriptors = items.map(i => ({ id: i.id, files: normalizeFileSet(i.files) }));
  return planFileOverlapWaves(descriptors);
}
```

- [ ] **Step 8: 跑测试确认它通过**

Run: `npx vitest run tests/unit/services/batch/batch-diagnosis.test.ts`
Expected: PASS

- [ ] **Step 9: 写诊断 fan-out 的只读约束测试**

```ts
// 追加到 tests/unit/services/batch/batch-diagnosis.test.ts
describe('batch diagnosis fan-out is read-only', () => {
  it('builds a prompt that forbids Edit/Write/MultiEdit', () => {
    const prompt = buildDiagnosisPrompt({ id: 'i1', label: 'fix null check', symptom: 'x is null' });
    expect(prompt).toContain('只读');
    expect(prompt).toMatch(/MUST NOT.*(Edit|Write|MultiEdit)/);
  });

  it('asks the diagnostician to report the files it expects to change', () => {
    const prompt = buildDiagnosisPrompt({ id: 'i1', label: 'x', symptom: 'y' });
    expect(prompt).toContain('files');
  });
});
```

- [ ] **Step 10: 实现 `buildDiagnosisPrompt`**

要求（逐条对应）：
- 明确 **只读**：禁止 Edit / Write / MultiEdit
- 产出四段：**根因** / **预计文件集** / **风险面命中**（7 条里命中哪条）/ **修复草图**
- 复用 `buildDispatchSystemPrompt`（`src/services/context/build-dispatch-system-prompt.ts:240`）做前缀，**不重写前缀**

- [ ] **Step 11: 跑测试确认它通过**

Run: `npx vitest run tests/unit/services/batch/batch-diagnosis.test.ts`
Expected: PASS

- [ ] **Step 12: 接线 CLI**

`peaks batch diagnose --rid <rid> --project <repo> --json` —— 派发 N 个 peaks-rd 子代理（**dry-run envelope 形态**，与 `peaks sub-agent dispatch` 一致：CLI 产出 `toolCall`，由 LLM 执行），并把每项的诊断结果写进 Task 6 的 `progress.json`。

- [ ] **Step 13: 提交**

```bash
git add src/services/batch/ src/cli/commands/batch-commands.ts tests/unit/services/batch/
git commit -m "feat(batch): diagnose N independent items in parallel, read-only"
```

---

## Task 2: 统一验证（一次门禁）

**Files:**
- Create: `src/services/batch/batch-verify.ts`
- Test: `tests/unit/services/batch/batch-verify.test.ts`

**Interfaces:**
- Consumes: `decideBatchMode`（Task 1）；`readBatchProgress`（Task 6）
- Produces:
  - `BATCH_ACCEPTANCE_GATE = ['test', 'tsc', 'lint'] as const` —— **与今天 race-code 的验收门逐字相同**
  - `runBatchVerification(projectRoot: string, sessionId: string, batchId: string): BatchVerificationResult`
  - `BatchVerificationResult = { gate: 'pass' | 'fail' | 'blocked'; checks: readonly {name: string; ok: boolean; detail: string}[]; attribution: 'integration' | 'single-item' | 'unknown' }`

- [ ] **Step 1: 写失败测试 —— 门禁与今天逐字相同**

```ts
// tests/unit/services/batch/batch-verify.test.ts
import { describe, expect, it } from 'vitest';
import { BATCH_ACCEPTANCE_GATE } from '../../../src/services/batch/batch-verify.js';

describe('batch verification gate', () => {
  it('runs exactly test + tsc + lint — same as the single-task lane', () => {
    expect(BATCH_ACCEPTANCE_GATE).toEqual(['test', 'tsc', 'lint']);
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `npx vitest run tests/unit/services/batch/batch-verify.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现常量与 runner**

```ts
// src/services/batch/batch-verify.ts
export const BATCH_ACCEPTANCE_GATE = ['test', 'tsc', 'lint'] as const;
```

`runBatchVerification` 依次跑三项，**每项跑一次**（不是每项 bug 跑一次）。返回 `attribution`：
- 三项全绿 ⇒ `'pass'`，`attribution: 'integration'`
- 任一项红，且**所有单项的 scoped test 都绿** ⇒ `attribution: 'integration'`（问题在跨项整合）
- 任一项红，且有单项 scoped test 红 ⇒ `attribution: 'single-item'`，并在 `detail` 里点名是哪一项

> **归因的前提**：阶段③每个 bug 修完立刻跑 scoped test（`references/micro-cycle.md`）。**没有那一步，统一验证红了就分不清是单项坏了还是整合坏了。** ⇒ Task 3 必须保证 scoped test 在位。

- [ ] **Step 3b: 验收 —— 阶段①中途压缩，断言诊断 agent 未被打断**

**为什么这是必须的**：Probe B = B-2 证明 **production 的 deferral 是死代码**（`code-auto-compact-command.ts:84` 恒传 `graphs: []`）⇒ **压缩不会因为「有批次在飞」而自动推迟**。

⇒ 压缩点**必须**是阶段边界（①→② / ③→④），不能是阶段中途。

**验收方法**：在阶段①进行中（诊断 agent 在跑）手动触发一次压缩，断言
1. 诊断 agent **未被打断**（其产物仍完整）
2. 批量进度**从 `progress.json` 恢复**，不退回"重新诊断"

> ⚠️ 这条必须**在 24h 模式下测** —— 24h/partial 的 auto-fire 阈值是 **0.70**，比标准模式的 0.80 更早触发；用标准模式测的是更宽松的阈值。

- [ ] **Step 3c: 记录 D6.e 失效这条缺陷（不在本 slice 修）**

`code-auto-compact-command.ts:84` 的 `graphs: []` 使 D6.e deferral 在 production 整体失效。**修它需要 production 调用点真正加载工作流图** —— 那是独立缺陷，**不在本 spec 范围**。

**处置**：记入 `.peaks/docs/backlog.md`（一个条目，带实测证据），**不在本 slice 顺手修** —— 顺手修会扩大 scope，且它影响的是既有 peaks-code 路径的行为。

- [ ] **Step 4: 跑测试确认它通过**

Run: `npx vitest run tests/unit/services/batch/batch-verify.test.ts`
Expected: PASS

- [ ] **Step 5: 写阶段边界的压缩提示测试（Review Focus #4）**

```ts
// 追加到 tests/unit/services/batch/batch-verify.test.ts
describe('phase-boundary compaction notice', () => {
  it('states that the system is compacting, never that the user should', () => {
    const text = buildPhaseBoundaryNotice({ done: 5, total: 5 }).toLowerCase();
    expect(text).not.toContain('ask the user to compact');
    expect(text).not.toContain('user should run');
    expect(text).toContain('正在压缩');
  });
});
```

- [ ] **Step 6: 实现 `buildPhaseBoundaryNotice`**

**必须走 `buildContextVerdict`**（`src/cli/commands/core/skill-context-verdict.ts:32`），不要自己拼字符串。措辞：`诊断完成（N/M 项）；正在压缩 —— 恢复成本最低的时点，进度已落盘`。

- [ ] **Step 7: 跑测试确认它通过**

Run: `npx vitest run tests/unit/services/batch/batch-verify.test.ts`
Expected: PASS

- [ ] **Step 8: 跑既有红线守卫，确认没破坏零停顿契约**

Run: `npx vitest run tests/unit/cli/skill-presence-loop-hygiene.test.ts`
Expected: PASS（既有测试仍绿）

- [ ] **Step 9: 提交**

```bash
git add src/services/batch/batch-verify.ts tests/unit/services/batch/batch-verify.test.ts
git commit -m "feat(batch): verify the whole batch once against the unchanged gate"
```

---

## Task 3: 修复阶段（拓扑按 Probe A 的结论定）

> **这一步的写法取决于 Task 0 的 Probe A 结论。** 两种分支都在下面给出。

**Files:**
- Create: `src/services/batch/batch-fix.ts`
- Test: `tests/unit/services/batch/batch-fix.test.ts`
- Test: `tests/unit/services/batch/batch-fix-scoped-test.test.ts`

**Interfaces:**
- Consumes: `planBatchTopology`（Task 1）；`appendBatchItem`（Task 6）；`buildDispatchSystemPrompt`（复用）
- Produces: `runBatchFix(...)` —— 返回每项的修复结果与 scoped test 结果

- [ ] **Step 1: 写失败测试 —— 每个 bug 修完立刻跑 scoped test**

```ts
// tests/unit/services/batch/batch-fix-scoped-test.test.ts
describe('per-item scoped test after each fix', () => {
  it('runs the item\'s own test file before marking it fixed', () => {
    // 断言：修复一项 ⇒ 立刻跑该项的 scoped test ⇒ 只有绿了才 appendBatchItem(status:'fixed')
  });

  it('does not mark an item fixed when its scoped test is red', () => {
    // 断言：scoped test 红 ⇒ status 保持 'diagnosed'，且结果里带上失败信息
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `npx vitest run tests/unit/services/batch/batch-fix-scoped-test.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 scoped-test 门（这一步在两个分支里都一样）**

修复一项 → 跑该项的 scoped test → 绿了才 `appendBatchItem(status: 'fixed')`。

**这是统一验证能做归因的前提**（Task 2 的 `attribution` 字段依赖它）。

- [ ] **Step 4: 跑测试确认它通过**

Run: `npx vitest run tests/unit/services/batch/batch-fix-scoped-test.test.ts`
Expected: PASS

- [ ] **Step 5: 修复派子代理**（Probe A = A-1，这是唯一分支）

按波次排 N' 个 peaks-rd 子代理，每个带**①的诊断结果**（不重读仓库）。

**硬约束**：
- **每个子代理必须拿到自己那一项的诊断**，不是整批的
- **必须带规范清单**（Task 4 产出 ⇒ **Task 3 依赖 Task 4**）
- **并发 agent 必须各自不同的 rid** —— 工作树分支名由 rid 派生，重名会 `git worktree add -b` 失败
- **工作树隔离**：每个 agent 一个 `peaks worktree spawn --rid <rid> --role rd --purpose <text>`，合并由**父会话**做（子代理不得自己 merge —— `LIFECYCLE_RULES` 明令禁止）
- **前置条件**：批量模式开始前，presence 租约的 skill 必须是 `peaks-race-code`（否则 driver 解析出 `peaks-code` ⇒ `src/` 被 deny）
  ```bash
  peaks skill presence:set peaks-race-code --project . --mode <mode> --gate <gate>
  ```

- [ ] **Step 6: 跑测试确认它通过**

Run: `npx vitest run tests/unit/services/batch/batch-fix.test.ts`
Expected: PASS

- [ ] **Step 7: 验收 —— 在装了 code-gate 的项目里复跑 A-1**

本仓库**没有装** `peaks code-gate`（只装了 `gate-step-08` / `gate enforce` / `auto-compact`），所以 A-1 在这里测的是**身份解析**，不是**装好的拒绝**。

**验收要求**：在一个装了 `peaks hooks install`（因而带 `code-gate` entry）的项目里复跑一次 —— 派一个 Task 子代理改一个 `src/` 文件，断言**没被 deny**。

若此处被 deny ⇒ 回到 probe 结论 A-2（修复留主窗口），并把新证据补进 `2026-10-21-race-batch-probe-results.md`。

- [ ] **Step 8: 提交**

```bash
git add src/services/batch/batch-fix.ts tests/unit/services/batch/
git commit -m "feat(batch): fix each diagnosed item against its own scoped test"
```

---

## Task 4: 规范预读（项目无关 · 语言无关）

> **复用 OCR 的 delegate 机制，不造新的 lint 引擎。** 设计文档 §5：三层来源（L1 项目自己的规矩 / L2 OCR 的语言评审标准 / L3 ECC 的策展规则集），缺一不可。

**Files:**
- Create: `src/services/lint/rule-pre-read.ts`
- Modify: `src/cli/commands/lint-commands.ts`（加 `rules` 子命令）
- Test: `tests/unit/services/lint/rule-pre-read.test.ts`

**Interfaces:**
- Consumes: `buildDelegateRuleArgs(paths, range)`（`src/services/lint/ocr-18-delegate-payload.ts:63`）；`parseDelegateRules(stdout)`（同文件 `:224`）；`languageForPath`（`src/services/lint/ocr-18-language-routing.ts:115`）
- Produces:
  - `detectProjectLintTools(projectRoot: string): readonly ProjectLintTool[]` —— 探测项目**自己声明**了什么（读 `package.json` scripts、`Makefile`、`pyproject.toml`、`go.mod`、CI 配置）。**不做语言分叉**
  - `readEffectiveRules(projectRoot: string, files: readonly string[]): RuleSet` —— 对给定文件集，取三层来源的生效规则
  - `peaks lint rules --files <file...> --project <repo> --json`

- [ ] **Step 1: 写失败测试 —— 项目没声明 lint 工具时明说，不静默跳过**

```ts
// tests/unit/services/lint/rule-pre-read.test.ts
describe('project lint tool detection', () => {
  it('reports an empty tool list with an explicit reason, not silence', () => {
    const result = detectProjectLintTools(emptyProjectRoot);
    expect(result.tools).toEqual([]);
    expect(result.reason).toBe('no lint tool declared by this project');
  });
});
```

> **这一条是本仓反复吃过的教训**（`a-count-cannot-distinguish-zero-findings-from-never-ran`）：**零和"没跑过"必须是两个不同的东西。**

- [ ] **Step 2: 跑测试确认它失败**

Run: `npx vitest run tests/unit/services/lint/rule-pre-read.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现探测 + 三层读取**

```ts
// src/services/lint/rule-pre-read.ts
export type RuleLayer = 'project' | 'language' | 'curated';

export interface EffectiveRule {
  readonly layer: RuleLayer;
  readonly source: string;      // 'eslint' | 'ocr' | 'ecc:typescript' | ...
  readonly pattern: string;
  readonly rule: string;
}

export interface RuleSet {
  readonly files: readonly string[];
  readonly rules: readonly EffectiveRule[];
  readonly detectedTools: readonly string[];
  readonly reason: string;      // 探测不到时是显式理由
}
```

`readEffectiveRules` 三层：
1. **L1 项目自己的**：调项目自己的工具（ESLint 用 `--print-config <file>`；stylelint 用对应物）
2. **L2 语言评审标准**：`buildDelegateRuleArgs(files, {})` —— `rangeArgs` 在 `from`/`to`/`commit` 未给时不产出 flag（`src/services/lint/ocr-multilang-adapter.ts:86`），所以**路径列表可单独使用**
3. **L3 策展规则集**：ECC `rules/<lang>/`，语言由 `languageForPath` 判定

- [ ] **Step 4: 跑测试确认它通过**

Run: `npx vitest run tests/unit/services/lint/rule-pre-read.test.ts`
Expected: PASS

- [ ] **Step 5: 写失败测试 —— 无 provider 时 OCR delegate 仍能出规则**

```ts
it('produces deterministic rule text with no API key and no LLM call', () => {
  // 用一个假的 argv runner 断言：delegate rule 的输出被 parse 成 groups，
  // 每组带 pattern + rule 文本，且不读任何 key
});
```

- [ ] **Step 6: 跑测试确认它通过**

Run: `npx vitest run tests/unit/services/lint/rule-pre-read.test.ts`
Expected: PASS

- [ ] **Step 7: 接线 CLI `peaks lint rules`**

```bash
peaks lint rules --files src/a.ts src/b.ts --project . --json
```

输出：每个文件生效的规则清单（每条标注 L1/L2/L3 来源）。

- [ ] **Step 8: 提交**

```bash
git add src/services/lint/rule-pre-read.ts src/cli/commands/lint-commands.ts tests/unit/services/lint/rule-pre-read.test.ts
git commit -m "feat(lint): read a project's effective rules for a given file set"
```

---

## Task 5: micro-cycle 加 lint 腿

**Files:**
- Modify: `skills/peaks-code/references/micro-cycle.md`（**共享文件** —— 两条 lane 都读它）
- Test: `tests/unit/skills/micro-cycle-lint-leg.test.ts`

**Interfaces:**
- Consumes: `peaks lint check --scope <path> --json`（既有 Gate B5 入口）
- Produces: `micro-cycle.md` 的循环多一条 lint 腿；一个测试断言该腿存在且在测试腿之后

- [ ] **Step 1: 写失败测试 —— 循环里有 lint 腿，且位置在测试腿之后**

```ts
// tests/unit/skills/micro-cycle-lint-leg.test.ts
describe('micro-cycle lint leg', () => {
  it('runs the scoped lint check after the local test re-scan', () => {
    const text = readFileSync('skills/peaks-code/references/micro-cycle.md', 'utf8');
    const testIdx = text.indexOf('局部回扫');
    const lintIdx = text.indexOf('peaks lint check');
    expect(lintIdx).toBeGreaterThan(-1);
    expect(lintIdx).toBeGreaterThan(testIdx);
  });

  it('says a red lint is fixed in the same context, not at commit time', () => {
    const text = readFileSync('skills/peaks-code/references/micro-cycle.md', 'utf8');
    expect(text).toMatch(/同一上下文|同一个上下文/);
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `npx vitest run tests/unit/skills/micro-cycle-lint-leg.test.ts`
Expected: FAIL —— 文件里还没有 lint 腿

- [ ] **Step 3: 在 `micro-cycle.md` 的循环里加第 6 步**

在现有「5. 局部回扫」之后加：

```markdown
### 6. lint 腿 —— 写完立刻查，不要等提交时

```bash
npx peaks lint check --scope <刚改的文件> --json
```

**红了就在这个上下文里改**（同一轮 micro-cycle 内），不要留到 pre-commit / pre-push ——
那时上下文已经换了，返工成本是这里的十倍以上。
```

- [ ] **Step 4: 跑测试确认它通过**

Run: `npx vitest run tests/unit/skills/micro-cycle-lint-leg.test.ts`
Expected: PASS

- [ ] **Step 5: 跑共享文件的既有守卫，确认没破坏**

Run: `npx vitest run tests/unit/skills/`
Expected: PASS

> ⚠️ `micro-cycle.md` 是**共享文件**（`skills/peaks-code/references/` 下，两条 lane 都读它）。既有的单源守卫 `tests/unit/standards/fast-lane-norm-single-source.test.ts` **只扫 `fast-lane-norm.md`**，不扫 `micro-cycle.md` —— 但 `tests/unit/skills/` 下的守卫会扫全树，所以改完必须跑整个目录。

- [ ] **Step 6: 提交**

```bash
git add skills/peaks-code/references/micro-cycle.md tests/unit/skills/micro-cycle-lint-leg.test.ts
git commit -m "feat(rd): add a lint leg to the micro-cycle so a violation is fixed in place"
```

---

## Task 7: 批量模式的 skill 表面（用户唯一看得见的入口）

> **为什么必须有这个 task**：前六个 task 全在造机制，但**没有一个碰 `skills/peaks-race-code/SKILL.md`** —— 而那才是用户 `/peaks-race-code` 时真正读到的东西。没有它，批量模式**没有任何用户可见的入口**，而 lane 的「什么算批量 / 什么时候走批量 / 风险面怎么判」仍然只存在于本计划里。
> **缺陷来源**：初稿把「机制」和「表面」当成了同一件事。机制是 `src/services/batch/**`，表面是 SKILL.md —— 两者都要。

**Files:**
- Modify: `skills/peaks-race-code/SKILL.md`
- Test: `tests/unit/skills/race-batch-mode-surface.test.ts`

**Interfaces:**
- Consumes: `decideBatchMode`（Task 1）；`planBatchTopology`（Task 1）；`BATCH_ACCEPTANCE_GATE`（Task 2）
- Produces: `skills/peaks-race-code/SKILL.md` 里的一节「批量模式」，含 loop-hygiene 块（**必须逐字节相同**）

- [ ] **Step 1: 写失败测试 —— SKILL.md 必须声明批量模式的触发与边界**

```ts
// tests/unit/skills/race-batch-mode-surface.test.ts
describe('race-code SKILL.md declares the batch mode', () => {
  it('states when batch mode engages', () => {
    const text = readFileSync('skills/peaks-race-code/SKILL.md', 'utf8');
    expect(text).toContain('批量');
  });

  it('states that the single-task path is unchanged', () => {
    const text = readFileSync('skills/peaks-race-code/SKILL.md', 'utf8');
    expect(text).toMatch(/单个|单任务|N=1/);
  });

  it('keeps the loop-hygiene block byte-identical', () => {
    // 复用既有守卫的读法：loop-hygiene-block.test.ts 已遍历全树比对，
    // 这里只断言本文件含该块的标题，且 tests/unit/skills/ 全绿即成立
    const text = readFileSync('skills/peaks-race-code/SKILL.md', 'utf8');
    expect(text).toContain('Peaks-Loop Skill:');
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `npx vitest run tests/unit/services/../skills/race-batch-mode-surface.test.ts`
Expected: FAIL —— SKILL.md 里还没有「批量」这一节

- [ ] **Step 3: 在 `skills/peaks-race-code/SKILL.md` 里加「批量模式」一节**

必须写清四件事（**每一条都有机制支撑，不写没有实现支撑的话**）：

1. **什么时候进批量**：用户一次给出 ≥2 个互相独立的 bug 或小需求。N=1 时**完全走今天这条路**（不诊断、不预读、不定档）。
2. **四个阶段**：并行只读诊断 → 定档 → 修复 → 一次统一验证。
3. **诊断阶段严格只读**：禁止 Edit / Write / MultiEdit。
4. **风险面仍然逐项判**：命中 7 条风险面里任何一条的项**踢出批量**，走单任务流程（`fast-lane-norm.md` §2 是权威清单，不要复述它 —— 指向它）。

⚠️ **不要在 SKILL.md 里复述 `fast-lane-norm.md` 的风险面清单** —— 那是 `fast-lane-norm-single-source.test.ts` 守卫的**单源**约束。指向它，不要复制。

⚠️ **不要改 loop-hygiene 块**（22 份逐字节相同 + 一个测试钉住）。本节写在它**之后**。

- [ ] **Step 4: 跑测试确认它通过**

Run: `npx vitest run tests/unit/skills/`
Expected: PASS（含 loop-hygiene 全树守卫 —— 改了 SKILL.md 就必须跑整个目录）

- [ ] **Step 5: 提交**

```bash
git add skills/peaks-race-code/SKILL.md tests/unit/skills/race-batch-mode-surface.test.ts
git commit -m "feat(race): declare the batch mode on the lane's user-facing surface"
```

---

## Self-Review

**1. Spec coverage** —— 逐节对：

| Spec 节 | 覆盖它的 task |
|---|---|
| §1 不变量 1（批量是加法，N=1 零成本） | Task 1 Step 1（`decideBatchMode(1) === 'single'`）|
| §1 不变量 2（阶段①严格只读） | Task 1 Step 9（prompt 禁 Edit/Write/MultiEdit）|
| §1 不变量 3（门禁严格度不降） | Task 2 Step 1（`BATCH_ACCEPTANCE_GATE` 逐字相同）|
| §1 不变量 4（peaks-code 行为不变） | 全局约束（不改 11 步 / Gate A–G）|
| §3.1 阶段①诊断 | Task 1 |
| §3.2 阶段②定档 | Task 1 Step 5–7（`planBatchTopology`）|
| §3.3 阶段③修复 | Task 3 |
| §3.4 阶段④统一验证 | Task 2 |
| §4 Slice 1/2/3/4/5/6 | Task 1 / 2 / 3 / 4 / 5 / 6 |
| **用户可见入口**（用户 `/peaks-race-code` 读到的） | **Task 7**（`skills/peaks-race-code/SKILL.md`）—— 初稿漏了，机制做完了但用户看不见 |
| §4.1 driver probe | Task 0 Step 3 |
| §5 规范预读（三层） | Task 4 |
| §5.4 micro-cycle lint 腿 | Task 5 |
| §6 共享部分切分 | Task 5（共享文件）+ Task 4（peaks-rd 受益）|
| §7 token/缓存 | Task 1 Step 12（复用既有 composer，不改前缀）|
| §7A 设计 A（进度落盘） | Task 6 |
| §7A 设计 B（压缩点） | Task 0 Step 6 + Task 2 Step 5 |
| §7A 设计 C（提醒措辞） | Task 2 Step 5–6 |
| §7A.3 缺口 1（探针盲区） | Task 0 Step 6（Probe B）|
| §7A.3 缺口 2（压缩丢进度） | Task 6 Step 9 |
| §8 U-a（driver） | Task 0 Step 3 |
| §8 U-c（路径规范化） | Task 6 Step 1 + Task 1 Step 5 |
| §8 U-h（压缩打断） | Task 0 Step 6 |
| §8 U-j（提醒措辞守卫） | Task 2 Step 8 |

**缺口**：§7.2 的 token 前后计量对比（U-e）**没有独立 task**。⇒ 它是 **Task 1 的验收项**（不是新 task）：Slice 1 交付后跑一次前后 `cache_read_input_tokens` 对比，写进 Task 1 的交付记录。

**另一个缺口（本轮自审发现）**：**初稿没有任何 task 改 `skills/peaks-race-code/SKILL.md`** —— 那是用户 `/peaks-race-code` 时唯一读到的文件。机制做完而表面没做，等于批量模式没有用户可见的入口。⇒ 已补 **Task 7**（自审时补的，不是原计划的）。

**2. Step scan** —— 每一步都只让实现者写**一件**可判定的事。没有 "TBD"、没有 "加适当的校验"、没有签名与测试已经决定的函数体。Task 0 的 Step 3 / 6 是**实测步骤**，产出是一份文档而不是代码 —— 这是有意的（设计文档 §U-a / §U-h 明确要求实测而非推理）。

**3. Type consistency** —— 跨 task 的一致性已核对：
- `normalizeFileSet` 在 Task 6 定义、Task 1 Step 7 消费 —— 名字一致
- `planBatchTopology` 在 Task 1 定义、Task 3 消费 —— 一致
- `appendBatchItem` / `readBatchProgress` 在 Task 6 定义、Task 1/2/3 消费 —— 一致
- `BatchItem` / `BatchProgress` / `BatchPhase` / `BatchItemStatus` 全在 Task 6 的 `batch-progress-types.ts` 定义 —— **Task 1 的 Step 5 测试用到 `BatchItem`，它必须在 Task 6 之后写** ⇒ **执行顺序必须是 Task 6 → Task 1**，本计划的 task 编号不是执行顺序

⇒ **这一点必须写进执行说明**：依赖顺序是 **Task 0 → Task 6 → Task 1 → Task 2 → Task 3 → Task 4 → Task 5**。Task 3 的分支 A-1 还额外依赖 Task 4（规范清单要注入修复 prompt）。

**4. Review Focus** —— 五行都有对应的测试：
1. 路径分隔符 → Task 6 Step 1 + Task 1 Step 5（第三个用例）✅
2. N=1 零成本 → Task 1 Step 1 ✅
3. 压缩丢进度 → Task 6 Step 9 ✅
4. 提醒措辞 → Task 2 Step 5 + Step 8 ✅
5. 文件集预测不准 → Task 1 Step 5（第二个用例：collision 被 defer）+ Task 3 Step 5/6（工作树隔离兜底）✅

**5. Proportion** —— 计划 7 个 task（含 2 个 probe），约 620 行。spec 约 590 行。比例合理：没有把代码抄进计划（每处给签名 + 断言 + 精确值），没有一行是"实现者自己决定"的东西。

---

## Execution Order

```
Task 0 (两个 probe)  ✅ 已完成
  └─> Task 6 (进度落盘)        ✅ 已完成
        └─> Task 1 (骨架+诊断并行)      🔄 在飞
              ├─> Task 2 (统一验证)
              ├─> Task 4 (规范预读)      ✅ 已完成
              │     └─> Task 3 (修复阶段)
              ├─> Task 7 (SKILL.md 用户表面) ✅ 已完成
              ├─> Task 5 (micro-cycle lint 腿) ✅ 已完成
              └─> Task 8 (上下文监控)     ← 用户 2026-10-21 追加，见 spec §7A.8
```

**Task 0 的结论会改变 Task 3 的写法**（不是内容）。Task 0 不做完后不要开 Task 3。

**Task 8 与批量机制正交**（改的是编排器的报告消费方式 + 压缩时机/文案），且**对 peaks-code 本身也有价值** —— 任何多子代理场景都少占编排器窗口。
