# Observability Evidence & Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 peaks-loop 的技能与门禁行为从"看不见"变成"看得见"，并让"通过"这个指标不再掩盖"靠跳过检查换来的通过"。

**Architecture:** 观测事件流是唯一的真相源，本计划只做两件事 —— **(1) 让事件不丢信息**（缺件清单、门禁判定）、**(2) 让事件能被看见**（正确的作用域、近失率、卡点榜、遵守率）。不改任何门禁的语义、阈值或放行条件；不碰 `evolution_evaluation` 表（那是 S3/S4 的事）。事件 schema **只加字段、不升版本号**（见 Global Constraints）。

**Tech Stack:** TypeScript (Node 22+, ESM, `.js` import specifiers)、zod、node:sqlite、commander、vitest。

**Spec:** `docs/superpowers/specs/2026-10-26-self-evolution-observability-loop-design.md` —— 读 **§0**（大白话）、**§1.6**（为什么近失率是头号产出）、**§2.2 / §2.3**（S1/S2 的设计）、**§4**（切片判据）。§1.5（外部调研）与本计划无关，实施时不必读。

**Scope note:** 本计划覆盖 spec 的 **S1（除 tool-trace）+ S2**。S3/S4 的计划在闸1 通过、拿到真实近失数据之后再写 —— spec §7.2 第 6 条已经写明"A1 的第一批候选现在无法预判"。tool-trace（S1.7）单独成计划。

---

## Global Constraints

这些是**每个任务都隐含适用**的项目级要求。

1. **文件大小天花板**：`src/` 与 `packages/` 新文件 **≤300 原始行**；`tests/` **≤500 原始行**（`src/services/scan/file-size-policy.ts`：`FILE_SIZE_CAP_DEFAULT = 300`、`FILE_SIZE_CAP_TESTS = 500`）。既有超限文件不得再增长。
2. **lint 棘轮**（`.peaks/lint/gate-baseline.json` 的 `ceilings`）：改动后 `eslintFindings ≤ 1670`、`eslintErrors ≤ 553`、`fileSizeOverCap ≤ 77`、`fileSizeExcessLines ≤ 21825`、`commentNarrativeLines ≤ 21`、`tscErrors = 0`。新文件必须是 **0 findings**。
3. **`src/**` 注释里不得出现 `rid-` 前缀的文件名** —— `commentNarrativeLines` 棘轮会把任何 `rid-` 字样算作叙述行。需要引用证据时写在 `tests/**` 里。
4. **提交消息不得含任何 AI 署名 trailer**（AGENTS.md 红线，由 `tests/unit/standards/no-ai-co-author-trailer.test.ts` 强制）。作者唯一：`SquabbyZ`。
5. **不得在 `.peaks/` 顶层创建日期戳目录**。会话产物只能落在 `.peaks/_runtime/<sessionId>/`。
6. **事件写入是 fire-and-forget**：`emitObservabilityEvent` 的契约是"永不抛出"。任何新的 emitter 必须吞掉所有异常，不得改变这个契约。
7. **schema 只加字段、不升版本号。** `ObservabilityEventSchema.schemaVersion` 是 `z.literal(1)`，而 `readObservabilityEvents` 用 `safeParse` **跳过**版本不匹配的记录 —— 升到 2 会让全部历史事件静默消失。新字段一律 optional，`detail` 已经是 `z.record(z.string(), z.unknown())`，多余键天然兼容。
8. **`pnpm lint` 只覆盖 `src/` 与 `packages/`**，`tests/` 的 eslint 错误 CI 看不见 —— 提交前手工跑一次 `npx eslint tests/`。
9. **不读运行时的私有 transcript**（如 Claude Code 的 `~/.claude/projects/`）。轨迹从 peaks-loop 自己的 hook 层来。
10. **不搬运外部代码。** 只借设计思想，实现自己写（AGENTS.md：外部仓库未经明确批准不得执行或安装）。

---

## Review Focus

以下是 spec 暗示、但任何任务的测试都可能漏掉的输入类与失效模式。**每一行都必须在它所属的任务里有对应测试。**

1. **一条 v1 历史事件在 schema 加字段后仍必须可读** —— `readObservabilityEvents` 用 `safeParse` 逐行跳过不匹配的记录，字段加错类型会让整段历史静默消失，表现为"没有数据"。
2. **发射器抛异常时，调用方的返回值不能变** —— 事件写入是 fire-and-forget；`emitObservabilityEvent` 失败时 `written: false`，但**门禁与状态迁移的判定结果必须与事件写入完全无关**。
3. **归属推导表遇到新增的 artifact 目录时不得静默返回 null** —— 否则新 prereq 类型的失败会消失在热点榜里，看起来像"没问题"。
4. **`ownerSkill` 推导必须对 `<rid>` 占位符路径生效** —— prereq 表里的路径是 `audit/security-<rid>.md`，不是具体文件名。
5. **近失判定必须区分"门禁被跳过且从未评估"与"门禁评估过并通过"** —— 后者是正常流程，误判成近失会让指标虚高到无意义。
6. **作用域为空的查询结果必须显式说明"别处有数据"，不能返回 0 了事** —— 正是这个假象让 1533 条事件看起来像不存在。

---

## File Structure

**新建**

| 路径 | 职责 |
|---|---|
| `src/services/observability/owner-skill-map.ts` | prereq 路径 → 拥有该 artifact 的技能 |
| `src/services/artifacts/prerequisite-path-census.ts` | 枚举 prereq 表里的每一条路径（供防腐测试用） |
| `src/services/observability/retro-attribution.ts` | v1 事件 → `inferred` / `ambiguous` 归属 |
| `src/services/artifacts/rd-gate-event.ts` | 门禁判定的事件发射器 |
| `src/services/observability/near-miss.ts` | 近失判定与近失率计算 |
| `src/services/observability/hotspots.ts` | 按 ownerSkill 聚合的卡点榜 |
| `src/services/observability/compliance-spec.ts` | ComplianceSpec 的类型与载入 |
| `src/services/observability/compliance-judge.ts` | 确定性遵守率判定 |
| `src/services/observability/compliance-specs/peaks-rd.spec.ts` | `peaks-rd` 的试点合规规范 |
| `src/services/observability/compliance-specs/peaks-race-code.spec.ts` | `peaks-race-code` 的试点合规规范 |
| `src/services/observability/session-metric-rows.ts` | per-session 聚合指标行的写入与读取 |
| `src/cli/commands/observability-commands-near-miss.ts` | `peaks observability near-miss` 的命令实现 |
| `src/cli/commands/observability-commands-hotspots.ts` | `peaks observability hotspots` 的命令实现 |

**修改**

| 路径 | 改什么 |
|---|---|
| `src/services/observability/observability-schema.ts` | `OBSERVABILITY_CATEGORIES` 增加 `'gate'` |
| `src/services/observability/observability-service.ts` | 新增 `emitGateEvent` |
| `src/services/artifacts/artifact-prerequisites.ts` | `const PREREQUISITES_BY_TYPE` → `export const`（**净增 0 行**） |
| `src/services/artifacts/prerequisite-transition-event.ts` | `detail` 增加 `missing[]` |
| `src/services/artifacts/rd-transition-gates.ts` | 每个门禁判定点发一条 `gate` 事件 |
| `src/services/observability/aggregation.ts` | `aggregateStatus` 增加 `stalledCount`，并保证三类计数之和 == `totalSlices` |
| `src/cli/commands/observability-commands.ts` | 注册 `near-miss` / `hotspots` 两个子命令 |
| `src/cli/commands/observability-commands-queries.ts` | `resolveSessionId` 支持"全部会话"；空结果加 warning |
| `src/services/observability/report-formatter.ts` | 报告增加"近失"与"卡点"两节 |

**新建测试**

`tests/unit/services/observability/` 下：`owner-skill-map.test.ts`、`retro-attribution.test.ts`、`gate-event-emission.test.ts`、`near-miss.test.ts`、`hotspots.test.ts`、`compliance-judge.test.ts`、`session-metric-rows.test.ts`、`missing-detail-emission.test.ts`。
`tests/unit/cli/` 下：`observability-scope.test.ts`。

---

### Task 1: owner-skill 推导表 + 缺件清单落地

**Files:**
- Create: `src/services/observability/owner-skill-map.ts`
- Create: `src/services/artifacts/prerequisite-path-census.ts`
- Modify: `src/services/artifacts/artifact-prerequisites.ts`（`const PREREQUISITES_BY_TYPE` → `export const`，净增 0 行）
- Modify: `src/services/artifacts/prerequisite-transition-event.ts`
- Test: `tests/unit/services/observability/owner-skill-map.test.ts`
- Test: `tests/unit/services/observability/missing-detail-emission.test.ts`

**Interfaces:**
- Consumes: 无（第一个任务）
- Produces:
  ```ts
  // src/services/observability/owner-skill-map.ts
  export type OwnerSkillEntry = { readonly prefix: string; readonly skill: string };
  export const OWNER_SKILL_ENTRIES: readonly OwnerSkillEntry[];
  export function ownerSkillForPath(path: string): string | null;

  // src/services/artifacts/prerequisite-path-census.ts
  export function allPrerequisitePaths(): readonly string[];
  ```
  `detail.missing[]` 的元素形状（写进事件 detail，不是独立类型）：
  ```ts
  { path: string; description: string; kind: 'absent' | 'body'; ownerSkill: string | null }
  ```

- [ ] **Step 1: 写失败的测试 —— 推导表覆盖 prereq 表里的每一条路径**

`tests/unit/services/observability/owner-skill-map.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { allPrerequisitePaths } from '../../../src/services/artifacts/prerequisite-path-census.js';
import { ownerSkillForPath } from '../../../src/services/observability/owner-skill-map.js';

describe('ownerSkillForPath', () => {
  it('resolves the known artifact directories', () => {
    expect(ownerSkillForPath('rd/bug-analysis-<rid>.md')).toBe('peaks-rd');
    expect(ownerSkillForPath('qa/test-cases/<rid>.md')).toBe('peaks-qa');
    expect(ownerSkillForPath('audit/security-<rid>.md')).toBe('peaks-security-audit');
    expect(ownerSkillForPath('audit/perf-<rid>.md')).toBe('peaks-perf-audit');
  });

  it('returns null for an unknown directory instead of guessing', () => {
    expect(ownerSkillForPath('nope/whatever.md')).toBeNull();
  });

  it('covers EVERY path in the prereq table', () => {
    const paths = allPrerequisitePaths();
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      expect(ownerSkillForPath(p), `no ownerSkill for ${p}`).not.toBeNull();
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/services/observability/owner-skill-map.test.ts`
Expected: FAIL —— `Cannot find module '.../owner-skill-map.js'`（模块还不存在）

- [ ] **Step 3: 实现 `owner-skill-map.ts`**

创建 `src/services/observability/owner-skill-map.ts`：

```ts
const OWNER_SKILL_ENTRIES: readonly OwnerSkillEntry[] = [
  { prefix: 'audit/security-', skill: 'peaks-security-audit' },
  { prefix: 'audit/perf-', skill: 'peaks-perf-audit' },
  { prefix: 'prd/', skill: 'peaks-prd' },
  { prefix: 'ui/', skill: 'peaks-ui' },
  { prefix: 'rd/', skill: 'peaks-rd' },
  { prefix: 'qa/', skill: 'peaks-qa' },
  { prefix: 'sc/', skill: 'peaks-sc' }
];
```

`ownerSkillForPath(path)`：**按 `prefix` 长度降序**取第一个命中（这样 `audit/security-` 胜过任何 `audit/` 前缀）；无命中返回 `null`。

> **注意两件事**：
> 1. 表里**故意没有** `audit/` 这条兜底 —— `audit/` 下既有 security 又有 perf，落到它意味着归属不明。如果 Step 1 的第三个用例因为某条 `audit/xxx-<rid>.md` 路径失败，说明有第三种 audit artifact：**按实际路径加一条更长的前缀条目**，不要加 `audit/` 兜底。
> 2. **角色只有五个** —— `RequestArtifactRole = 'prd' | 'ui' | 'rd' | 'qa' | 'sc'`（`src/services/artifacts/artifact-templates.ts:19`）。**没有 `txt`**（txt 角色不产出 artifact）。表里不要加 `txt/`。

- [ ] **Step 4: 实现 `prerequisite-path-census.ts`**

先在 `src/services/artifacts/artifact-prerequisites.ts` 把第 442 行的 `const PREREQUISITES_BY_TYPE` 改成 `export const PREREQUISITES_BY_TYPE`（**不新增行**）。

再创建 `src/services/artifacts/prerequisite-path-census.ts`：

```ts
import { PREREQUISITES_BY_TYPE } from './artifact-prerequisites.js';

export function allPrerequisitePaths(): readonly string[] {
  const out = new Set<string>();
  for (const table of Object.values(PREREQUISITES_BY_TYPE)) {
    for (const reqs of Object.values(table)) {
      for (const req of reqs) out.add(req.relativePath);
    }
  }
  return [...out].sort();
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/unit/services/observability/owner-skill-map.test.ts`
Expected: PASS —— 三个用例全绿。若第三个用例失败，按 Step 3 的说明补映射条目。

- [ ] **Step 6: 写失败的测试 —— 事件 detail 带上缺件清单**

`tests/unit/services/observability/missing-detail-emission.test.ts`：构造一个 `checkPrerequisites` 的结果（含 2 个缺件、一个 `kind: 'absent'`、一个 `kind: 'body'`），调用 `emitPrereqTransitionEvent`，然后读回该 session 的 `slices.jsonl`，断言那条 `slice-transition` 事件的 `detail.missing` 里有 2 项、每项带 `path` / `description` / `kind` / `ownerSkill`，且 `detail.missingCount === 2`。

（该测试需要写入 `.peaks/_runtime/<sid>/metrics/slices.jsonl`。复用仓库内既有的观测测试写法 —— 参照 `tests/unit/services/observability/results-baseline.test.ts` 里的 session 目录搭建方式。）

- [ ] **Step 7: 跑测试确认失败**

Run: `npx vitest run tests/unit/services/observability/missing-detail-emission.test.ts`
Expected: FAIL —— `detail.missing` 是 `undefined`

- [ ] **Step 8: 改 `prerequisite-transition-event.ts`**

在 `detail` 对象里，把 `missingCount: opts.result.missing.length` 之后加上：

```ts
missing: opts.result.missing.map((m) => ({
  path: m.path,
  description: m.description,
  kind: m.kind,
  ownerSkill: ownerSkillForPath(m.path)
}))
```

并在文件顶部 `import { ownerSkillForPath } from '../observability/owner-skill-map.js';`。

> **不发射顶层 `ownerSkill`** —— 归属是逐缺件的，聚合是读取时的职责。spec §2.2 S1.1 里那句"缺失项的聚合归属（单数时为其一）"以本步为准。

- [ ] **Step 9: 跑测试确认通过**

Run: `npx vitest run tests/unit/services/observability/missing-detail-emission.test.ts`
Expected: PASS

- [ ] **Step 10: 跑 Task 1 全部测试 + lint**

Run: `npx vitest run tests/unit/services/observability/owner-skill-map.test.ts tests/unit/services/observability/missing-detail-emission.test.ts && npx eslint src/services/observability/owner-skill-map.ts src/services/artifacts/prerequisite-path-census.ts src/services/artifacts/prerequisite-transition-event.ts tests/unit/services/observability/owner-skill-map.test.ts tests/unit/services/observability/missing-detail-emission.test.ts`
Expected: 全部 PASS，eslint 0 findings

- [ ] **Step 11: 提交**

```bash
git add src/services/observability/owner-skill-map.ts src/services/artifacts/prerequisite-path-census.ts src/services/artifacts/artifact-prerequisites.ts src/services/artifacts/prerequisite-transition-event.ts tests/unit/services/observability/owner-skill-map.test.ts tests/unit/services/observability/missing-detail-emission.test.ts
git commit -m "feat(observability): keep the missing-artifact list instead of its length"
```

---

### Task 2: 历史事件的追认

**Files:**
- Create: `src/services/observability/retro-attribution.ts`
- Test: `tests/unit/services/observability/retro-attribution.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `ownerSkillForPath` 与 `allPrerequisitePaths`；`getPrerequisitesFor(role, newState, requestType)`（`src/services/artifacts/artifact-prerequisites.ts:478`，已导出）
- 类型导入路径（已核实）：
  - `RequestArtifactRole`（`'prd' | 'ui' | 'rd' | 'qa' | 'sc'`）→ `src/services/artifacts/artifact-templates.ts:19`（也由 `request-artifact-service.ts:45` 再导出）
  - `RequestArtifactState` → `src/services/artifacts/request-artifact-state-helpers.ts:5`
  - `RequestType` → `src/services/artifacts/artifact-prerequisites.ts:20`
- Produces:
  ```ts
  export type AttributionConfidence = 'exact' | 'inferred' | 'ambiguous';
  export type RetroAttribution = {
    readonly confidence: AttributionConfidence;
    readonly candidates: ReadonlyArray<{ path: string; ownerSkill: string | null }>;
  };
  export function attributeV1Failure(opts: {
    readonly artifactRole: RequestArtifactRole;
    readonly newState: RequestArtifactState;
    readonly requestType: RequestType;
    readonly missingCount: number;
  }): RetroAttribution;
  ```
  `exact` 只会由前向 v1.1 事件给出；本函数的返回**最高只能是 `inferred`**。

- [ ] **Step 1: 写失败的测试**

`tests/unit/services/observability/retro-attribution.test.ts`：

```ts
describe('attributeV1Failure', () => {
  it('returns inferred with the single candidate when the prereq list has one entry', () => { ... });
  it('returns ambiguous when the prereq list has several entries and one is missing', () => { ... });
  it('never returns exact', () => { ... });
  it('returns ambiguous when missingCount does not match the prereq list length', () => { ... });
});
```

用例里挑一个 `(artifactRole, newState, requestType)` 组合，使 `getPrerequisitesFor` 返回恰好 1 条 —— 先在测试里用 `getPrerequisitesFor` 自己算出长度来挑，不要硬编码猜。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/services/observability/retro-attribution.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现 `retro-attribution.ts`**

规则（与 spec §2.2 S1.6 的表一致）：

| 条件 | confidence | candidates |
|---|---|---|
| `missingCount === prereqs.length` | `inferred` | 全部 prereq |
| `missingCount === 1 && prereqs.length === 1` | `inferred` | 那一条 |
| `missingCount === 1 && prereqs.length > 1` | `ambiguous` | 全部 prereq |
| `0 < missingCount < prereqs.length` | `ambiguous` | 全部 prereq |
| `prereqs.length === 0` | `ambiguous` | 空数组 |

**永远不返回 `exact`** —— 追认用的是今天的 prereq 表，历史事件发生在过去的表版本下。函数上方写一行注释说明这件事。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/services/observability/retro-attribution.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/services/observability/retro-attribution.ts tests/unit/services/observability/retro-attribution.test.ts
git commit -m "feat(observability): attribute the historical prereq failures without inventing them"
```

---

### Task 3: 门禁判定事件化

**Files:**
- Create: `src/services/artifacts/rd-gate-event.ts`
- Modify: `src/services/artifacts/rd-transition-gates.ts`
- Modify: `src/services/observability/observability-schema.ts`
- Modify: `src/services/observability/observability-service.ts`
- Test: `tests/unit/services/observability/gate-event-emission.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `ownerSkillForPath`（不需要，本任务不涉及归属）
- Produces:
  ```ts
  // src/services/artifacts/rd-gate-event.ts
  export type RdGateId = 'file-size-ratchet' | 'declared-type-corroboration' | 'claim-table';
  export type RdGateOutcome = 'pass' | 'block' | 'bypass';
  export function emitRdGateEvent(opts: {
    readonly projectRoot: string;
    readonly sessionId: string;
    readonly sliceRid: string;
    readonly gateId: RdGateId;
    readonly phase: RdGatePhase;
    readonly outcome: RdGateOutcome;
    readonly violationKind?: 'source-touched' | 'source-unclaimed' | 'diff-unavailable';
    readonly reason?: string;
  }): void;

  // src/services/observability/observability-service.ts（新增）
  export function emitGateEvent(opts: {
    readonly projectRoot: string;
    readonly sessionId: string;
    readonly sliceRid: string;
    readonly gateId: string;
    readonly phase: string;
    readonly outcome: 'pass' | 'block' | 'bypass';
    readonly violationKind?: string;
    readonly reason?: string;
  }): void;
  ```
  `ObservabilityEvent.category` 新增 `'gate'`；`detail` 形状：
  ```ts
  { gateId: string; phase: string; outcome: 'pass'|'block'|'bypass'; violationKind?: string; reason?: string }
  ```

- [ ] **Step 1: 写失败的测试**

`tests/unit/services/observability/gate-event-emission.test.ts`：
1. `emitGateEvent` 写出后，session 的 `slices.jsonl` 里有一条 `category === 'gate'` 的事件，`detail` 含 `gateId` / `phase` / `outcome`。
2. **`emitGateEvent` 在 session id 非法时不得抛出**（复用 `observability-service.ts` 里 `tryMetricsFilePath` 的既有失败路径）。
3. **发射器抛异常时调用方结果不变** —— 直接对 `emitObservabilityEvent` 的失败路径做一次"写入失败后 `written === false`"的断言。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/services/observability/gate-event-emission.test.ts`
Expected: FAIL —— `emitGateEvent` 不存在

- [ ] **Step 3: 加 category 与发射器**

- `src/services/observability/observability-schema.ts`：在 `OBSERVABILITY_CATEGORIES` 数组里增加 `'gate'`（**放在数组末尾**，避免改动已有下标）。
- `src/services/observability/observability-service.ts`：新增 `emitGateEvent`，实现与 `emitCycleEvent` **完全同构** —— 构造 `ObservabilityEvent` 后交给 `emitObservabilityEvent`，**不新增任何 try/catch**（`emitObservabilityEvent` 自己永不抛出）。

- [ ] **Step 4: 实现 `rd-gate-event.ts`**

薄封装：把 `opts` 映射成 `emitGateEvent` 的参数并调用。**不吞异常之外做任何事** —— 但要保证 `emitRdGateEvent` 自己永不抛出（包一层 try/catch 吞掉一切）。

- [ ] **Step 5: 在 `rd-transition-gates.ts` 的判定点发事件**

`runRdTransitionGates`（`src/services/artifacts/rd-transition-gates.ts:186`）已经拿到了 `projectRoot` / `sessionId` / `requestId` / `phase`，**不需要改调用方**。

在它的三个判定点各加一次发射：

| 门禁 id | 判定点 | outcome |
|---|---|---|
| `file-size-ratchet` | `options.phase === 'implemented'` 分支里的 `scanFileSize` | `pass` / `block` |
| `declared-type-corroboration` | 类型佐证判定处 | `pass` / `block` |
| `claim-table` | `RdGateViolation` 产生处（`source-touched` / `source-unclaimed` / `diff-unavailable`） | `pass` / `block` |

**`allowIncomplete` 提前返回的那条路径**：发 `outcome: 'bypass'`，`reason` 用现成的 `rdGatesBypassNote(options.phase)` 返回值。

**`block` 事件必须在 `throw` 之前发出** —— 抛了就永远发不出"这个门禁拦下了一次"的记录。

> **`rd-transition-gates.ts` 已 223 行，上限 300。** 本步新增的行数（import 1 行 + 每次发射 1–4 行 × 约 5 处）必须控制在 **≤ 70 行净增**内。若超，把发射逻辑挪进新文件 `rd-gate-event.ts` 并让 `rd-transition-gates.ts` 只调用它。

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run tests/unit/services/observability/gate-event-emission.test.ts`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add src/services/artifacts/rd-gate-event.ts src/services/artifacts/rd-transition-gates.ts src/services/observability/observability-schema.ts src/services/observability/observability-service.ts tests/unit/services/observability/gate-event-emission.test.ts
git commit -m "feat(observability): let the gate layer speak for itself"
```

---

### Task 4: 作用域修正与计数自洽

**Files:**
- Modify: `src/cli/commands/observability-commands-queries.ts`
- Modify: `src/cli/commands/observability-commands.ts`
- Modify: `src/services/observability/aggregation.ts`
- Test: `tests/unit/cli/observability-scope.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  ```ts
  // src/services/observability/aggregation.ts
  export type StatusAggregate = {
    // 既有字段不变，新增：
    readonly stalledCount: number;
  };
  ```
  语义：`successCount + failCount + stalledCount === totalSlices`。
  - `successCount` = `rollup.success === true` 的 slice 数（既有语义，不变）
  - `failCount` = `finalState ∈ TERMINAL_FAIL_STATES` 的 slice 数（既有语义，不变）
  - `stalledCount` = `finalState !== null` 且既不在成功终态、也不在 `TERMINAL_FAIL_STATES` 里的 slice 数 —— **卡在 `qa-handoff` 这种非终态的 slice**

  ```ts
  // src/cli/commands/observability-commands-queries.ts
  export function resolveSessionId(
    optionSession: string | undefined,
    projectRoot: string,
    allSessions: boolean
  ): string | undefined;
  ```
  `allSessions === true` 时返回 `undefined`（表示"读全部"）；否则既有行为不变。

- [ ] **Step 1: 写失败的测试**

`tests/unit/cli/observability-scope.test.ts`：

1. **作用域**：在临时项目根下造两个 session，各写几条事件；`--all-sessions` 时 `totalEvents` 等于两个 session 之和；不带该 flag 时只看 canonical session。
2. **计数自洽**：喂一批事件（含一个最终停在 `qa-handoff` 的 slice），断言 `successCount + failCount + stalledCount === totalSlices`，且 `stalledCount === 1`。
3. **空结果不装死**：作用域内 0 事件、别处有事件时，信封的 `warnings` 里必须出现一条指明"其他 N 个 session 共 M 条事件，使用 `--all-sessions`"。
4. **Review Focus 第 1 条 —— v1 历史事件仍可读**：手写一条 **Task 1 之前形状**的旧事件（`schemaVersion: 1`、`detail` 里只有 `artifactRole` / `to` / `prereqOk` / `missingCount`，**没有 `missing`**），写进 `slices.jsonl`，用 `readObservabilityEvents` 读回，断言它**仍然被读出**（不是被 `safeParse` 静默跳过）。这条测试是"历史 1533 条不丢"的最小版本。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/cli/observability-scope.test.ts`
Expected: FAIL —— `--all-sessions` 不被识别；`stalledCount` 不存在

- [ ] **Step 3: 改 `resolveSessionId` 与命令注册**

- `observability-commands-queries.ts`：`resolveSessionId` 增加第三参数 `allSessions: boolean`；`allSessions` 为真时直接 `return undefined`。
- `observability-commands.ts`：`status` / `slices` / `fanout` / `report` 四个子命令各加 `--all-sessions` 选项，语义与既有的 `repair-cycles --all-sessions` **完全一致**（该选项已存在，照抄它的描述文案与传参方式）。
- `runStatus` / `runSlices` / `runFanout` / `runReport` 在作用域内事件为 0 而全局有事件时，往 `ok(...)` 的 `warnings` 里加一条。

> `observability-commands.ts` 已有 **2 条 eslint baseline**，`observability-commands-queries.ts` 是 0 条。加代码后必须仍是 ≤2 / ≤0，否则要先把该文件的 findings 降到 0 再加。

- [ ] **Step 4: 改 `aggregateStatus`**

在 `src/services/observability/aggregation.ts` 的 `aggregateStatus` 里加 `stalledCount` 计算，并在返回对象里带上。判定"成功终态"用**既有**的成功判定（`rollup.success`），判定"失败终态"用既有的 `TERMINAL_FAIL_STATES`；两者都不是且 `finalState !== null` 的，就是 stalled。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/unit/cli/observability-scope.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/cli/commands/observability-commands-queries.ts src/cli/commands/observability-commands.ts src/services/observability/aggregation.ts tests/unit/cli/observability-scope.test.ts
git commit -m "fix(observability): the queries were scoped to one session and counted no stalls"
```

---

### Task 5: 近失判定与 `peaks observability near-miss`

**Files:**
- Create: `src/services/observability/near-miss.ts`
- Create: `src/cli/commands/observability-commands-near-miss.ts`
- Modify: `src/cli/commands/observability-commands.ts`
- Test: `tests/unit/services/observability/near-miss.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `gate` 事件；Task 1 的 `missing[]`；既有 `slice-transition` 事件
- Produces:
  ```ts
  // src/services/observability/near-miss.ts
  export type NearMissReason = 'gate-never-evaluated' | 'tool-blocked' | 'prereq-skipped';
  export type NearMissRecord = {
    readonly sliceRid: string;
    readonly reasons: ReadonlyArray<NearMissReason>;
    readonly evidence: ReadonlyArray<{ readonly sessionId: string; readonly ts: string }>;
  };
  export type NearMissReport = {
    readonly nearMissRate: number;      // 近失 slice 数 / 通过 slice 数；分母为 0 时为 0
    readonly passedSliceCount: number;
    readonly nearMissSliceCount: number;
    readonly records: ReadonlyArray<NearMissRecord>;
  };
  export function computeNearMiss(events: readonly ObservabilityEvent[]): NearMissReport;
  ```

- [ ] **Step 1: 写失败的测试**

`tests/unit/services/observability/near-miss.test.ts`，覆盖 **Review Focus 第 5 条**：

1. **门禁被跳过且从未评估** → 近失。构造：slice A 有一个 `gate` 事件 `outcome: 'bypass'`、`gateId: 'file-size-ratchet'`，且**没有**任何同 `gateId` 的 `pass`/`block` 事件；slice 最终到 `verdict-issued` 且 QA 判 pass → 记为近失，reason 含 `'gate-never-evaluated'`。
2. **门禁评估过并通过 → 不是近失**。构造：同 `gateId` 有一个 `outcome: 'pass'` 的事件 → **不得**判为近失（这是 Review Focus 第 5 条）。
3. **prereq 失败后仍然到达 `verdict-issued`** → 近失，reason 含 `'prereq-skipped'`。
4. **`near-miss-rate` 的分母是"通过的 slice 数"**；分母为 0 时 `nearMissRate === 0`。
5. **非通过 slice 不进分母也不进近失**。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/services/observability/near-miss.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现 `near-miss.ts`**

判定逻辑（严格按 spec §2.3 S2.3 的三条）：

- **通过的 slice**：最终 `finalState === 'verdict-issued'`。**注意**：本仓库没有独立的"QA 判定 pass"事件 —— 判定"通过"就用"到达了 `verdict-issued`"这一既有事实，与 `aggregateSlices` 的 `success` 判定保持一致（**复用同一个判定，不要另立一套**）。
- 近失的三条来源：
  1. `gate-never-evaluated`：该 slice 内存在 `gate` 事件 `outcome === 'bypass'`，且该 `gateId` 在该 slice 内**没有**任何 `outcome === 'pass'` 或 `'block'` 的事件
  2. `tool-blocked`：存在 `tool-trace` 事件 `outcome === 'block'`（**本计划不产出 tool-trace，该分支先留空并写注释说明**，S1.7 落地后接上）
  3. `prereq-skipped`：存在 `slice-transition` 事件 `prereqOk === false`，随后该 slice 仍到达 `verdict-issued`

- [ ] **Step 4: 写失败测试（CLI 层）**

在 `tests/unit/cli/observability-scope.test.ts` 里加一组：跑 `peaks observability near-miss --project <tmp> --all-sessions --json`，断言信封 `data.nearMissRate` 存在、`data.records` 是数组。

- [ ] **Step 5: 实现 CLI 子命令**

- 新建 `src/cli/commands/observability-commands-near-miss.ts`，导出 `runNearMiss(io, options)`。**照抄 `observability-commands-queries.ts` 里 `runStatus` 的骨架**：`resolveProjectRoot` → 读事件 → 计算 → `printResult(io, ok('observability.near-miss', {...}, warnings), options.json)`。
- 在 `observability-commands.ts` 注册：
  ```ts
  addJsonOption(
    observability
      .command('near-miss')
      .description('...')
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
      .option('--session <sessionId>', 'scope to one session (defaults to the canonical session binding)')
      .option('--all-sessions', 'measure the whole recorded history of the project instead of the canonical session binding')
  ).action((options) => { runNearMiss(io, options); });
  ```

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run tests/unit/services/observability/near-miss.test.ts tests/unit/cli/observability-scope.test.ts`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add src/services/observability/near-miss.ts src/cli/commands/observability-commands-near-miss.ts src/cli/commands/observability-commands.ts tests/unit/services/observability/near-miss.test.ts tests/unit/cli/observability-scope.test.ts
git commit -m "feat(observability): count the passes that were bought by skipping a gate"
```

---

### Task 6: 卡点榜 `peaks observability hotspots`

**Files:**
- Create: `src/services/observability/hotspots.ts`
- Create: `src/cli/commands/observability-commands-hotspots.ts`
- Modify: `src/cli/commands/observability-commands.ts`
- Test: `tests/unit/services/observability/hotspots.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `missing[].ownerSkill`；Task 2 的追认
- Produces:
  ```ts
  export type HotspotRow = {
    readonly ownerSkill: string;
    readonly artifact: string;          // 去掉 <rid> 的路径模板
    readonly kind: 'absent' | 'body';
    readonly confidence: AttributionConfidence;
    readonly count: number;
    readonly sessions: number;
    readonly firstSeen: string;
    readonly lastSeen: string;
    readonly evidence: ReadonlyArray<{ readonly sessionId: string; readonly ts: string }>;
  };
  export function aggregateHotspots(events: readonly ObservabilityEvent[]): HotspotRow[];
  ```
  排序：`count` 降序；同 `count` 时 `exact` 在 `inferred` 前、`inferred` 在 `ambiguous` 前。

- [ ] **Step 1: 写失败的测试**

`tests/unit/services/observability/hotspots.test.ts`：
1. 两个缺同一 artifact 的事件聚成一行，`count === 2`、`sessions === 2`（不同 session）。
2. `ownerSkill` 来自 `missing[].ownerSkill`。
3. `artifact` 去掉 `<rid>` 占位符。
4. 排序：`count` 大的在前；同 count 时 `exact` 在 `ambiguous` 前。
5. **`ownerSkill` 为 `null` 的缺件不产生行**（Review Focus 第 3 条 —— 未知归属不得静默消失，而是**在结果里单列一组 `ownerSkill: null`**，让新增 artifact 目录立刻可见）。

> 第 5 条的取舍：spec 说"不得静默返回 null"。本计划的处理是**不丢弃，而是归入 `ownerSkill: null` 的行**，让防腐测试（Task 1 的第 3 个用例）在 CI 里红。**若你更希望直接丢弃，改这一条并同步更新 Task 1 的防腐测试 —— 但不要既丢弃又不报警。**

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/services/observability/hotspots.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现 `hotspots.ts`**

聚合键：`(ownerSkill, artifact, kind, confidence)`。`sessions` 取出现该键的**不同 sessionId 数量**。

- [ ] **Step 4: 实现 CLI 子命令**

新建 `src/cli/commands/observability-commands-hotspots.ts`，导出 `runHotspots(io, options)`，骨架同 Task 5 的 `runNearMiss`。注册 `hotspots` 子命令，选项与 `near-miss` 一致（`--project` / `--session` / `--all-sessions` / `--json`）。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/unit/services/observability/hotspots.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/services/observability/hotspots.ts src/cli/commands/observability-commands-hotspots.ts src/cli/commands/observability-commands.ts tests/unit/services/observability/hotspots.test.ts
git commit -m "feat(observability): rank the artifacts the skills keep missing"
```

---

### Task 7: 报告增加"近失"与"卡点"两节

**Files:**
- Modify: `src/services/observability/report-formatter.ts`
- Modify: `src/cli/commands/observability-commands.ts`
- Test: `tests/unit/services/observability/report-formatter.test.ts`（新建）

**Interfaces:**
- Consumes: Task 5 的 `computeNearMiss`；Task 6 的 `aggregateHotspots`
- Produces: `renderObservabilityReport` 的入参增加两个可选字段：
  ```ts
  readonly nearMiss?: NearMissReport;
  readonly hotspots?: readonly HotspotRow[];
  ```
  缺省时**不渲染这两节**（保持既有调用方行为不变）。

- [ ] **Step 1: 写失败的测试**

`tests/unit/services/observability/report-formatter.test.ts`（新建）：
1. 传入 `nearMiss` 时，markdown 里出现"近失"字样与 `nearMissRate` 的数值。
2. 传入 `hotspots` 时，markdown 里出现卡点表，且**排在"近失"之后**。
3. **不传这两个字段时，markdown 与改动前逐字相同**（回归保护）。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/services/observability/report-formatter.test.ts`
Expected: FAIL —— 入参类型不接受这两个字段

- [ ] **Step 3: 实现**

在 `renderObservabilityReport` 里，**"近失"节插在现有"status summary"之后、"Slices"之前**；"卡点"节插在"Slices"之后、"Fanout"之前。两节都按 `nearMiss` / `hotspots` 是否提供来决定渲染。

`report-formatter.ts` 现有 **2 条 eslint baseline**，上限不变；文件行数上限 300。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/services/observability/report-formatter.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/services/observability/report-formatter.ts src/cli/commands/observability-commands.ts tests/unit/services/observability/report-formatter.test.ts
git commit -m "feat(observability): the report leads with the passes that skipped a gate"
```

---

### Task 8: ComplianceSpec 与确定性遵守率（试点 `peaks-rd` + `peaks-race-code`）

**Files:**
- Create: `src/services/observability/compliance-spec.ts`
- Create: `src/services/observability/compliance-judge.ts`
- Create: `src/services/observability/compliance-specs/peaks-rd.spec.ts`
- Create: `src/services/observability/compliance-specs/peaks-race-code.spec.ts`
- Test: `tests/unit/services/observability/compliance-judge.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `allPrerequisitePaths`；`getPrerequisitesFor`
- Produces:
  ```ts
  // src/services/observability/compliance-spec.ts
  export type ComplianceStep = {
    readonly id: string;
    readonly description: string;
    readonly required: boolean;
    readonly ownerSkill: string;
    /** 确定性检查：该步骤"被执行"的判据。 */
    readonly verify: { readonly artifactExists: string };
    /** 可选：必须在此步骤之后。 */
    readonly afterStep?: string;
  };
  export type ComplianceSpec = {
    readonly id: string;
    readonly source: string;          // 例如 'skills/bee/peaks-rd/SKILL.md#step-4'
    readonly owner: string;
    readonly steps: readonly ComplianceStep[];
  };
  export type StepResult = {
    readonly stepId: string;
    readonly executed: boolean;
    readonly failureReason?: string;
  };
  export type ComplianceResult = {
    readonly specId: string;
    readonly steps: readonly StepResult[];
    readonly complianceRate: number;   // required 步骤的 executed 比例
  };
  export function judgeCompliance(
    spec: ComplianceSpec,
    exists: (artifactPath: string) => boolean
  ): ComplianceResult;
  ```

- [ ] **Step 1: 写失败的测试**

`tests/unit/services/observability/compliance-judge.test.ts`：
1. 全部 required 步骤的 artifact 都在 → `complianceRate === 1`。
2. 缺一个 required 步骤 → `complianceRate` 相应下降，且该步骤 `executed === false` 且 `failureReason` 非空。
3. **optional 步骤不进入分母**。
4. **`afterStep` 约束**：被依赖的步骤未执行时，依赖它的步骤**不得**判为 executed（防止"靠一个失败的先决步骤拿到通过"）。
5. **每个 spec 的每条 `verify.artifactExists` 路径必须能在 prereq 表里找到对应**（防止 spec 与契约脱节）。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/services/observability/compliance-judge.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现 `compliance-judge.ts`**

纯函数，**不碰文件系统** —— 文件是否存在由传入的 `exists` 回调决定（便于测试）。`afterStep` 约束用**后序修正**实现：先按顺序判定，若某步骤的 `afterStep` 指向的步骤 `executed === false`，则把它降级为 `executed: false` 并写明 `failureReason`，重复直到不再变化。

- [ ] **Step 4: 写两个试点 spec**

- `peaks-rd.spec.ts`：从 `skills/bee/peaks-rd/SKILL.md` 里挑 **3–5 个 required 步骤**，每步的 `verify.artifactExists` 指向该技能负责的真实 artifact（如 `audit/security-<rid>.md`、rd 的代码评审 artifact、rd 的 handoff artifact）。
- `peaks-race-code.spec.ts`：从 `skills/peaks-race-code/SKILL.md` 挑 **2–4 个 required 步骤**（它最轻，见效快）。

**步骤的 `id` 与 `description` 必须对应 SKILL.md 里真实存在的步骤**，不得臆造。写之前先读这两个 SKILL.md。

**每条 `verify.artifactExists` 必须是 prereq 表里出现过的路径**（或明确标注为"尚未进契约"的路径 —— 那本身是一条待修的契约缺口，写进 spec 的注释里）。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/unit/services/observability/compliance-judge.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/services/observability/compliance-spec.ts src/services/observability/compliance-judge.ts src/services/observability/compliance-specs/peaks-rd.spec.ts src/services/observability/compliance-specs/peaks-race-code.spec.ts tests/unit/services/observability/compliance-judge.test.ts
git commit -m "feat(observability): judge the two pilot skills against their own contract"
```

---

### Task 9: per-session 指标行落盘

**Files:**
- Create: `src/services/observability/session-metric-rows.ts`
- Test: `tests/unit/services/observability/session-metric-rows.test.ts`

**Interfaces:**
- Consumes: Task 5 的 `computeNearMiss`；Task 6 的 `aggregateHotspots`；Task 8 的 `judgeCompliance`
- Produces:
  ```ts
  export const SESSION_METRIC_ROWS_RELATIVE_PATH = '.peaks/observability/sessions/<sessionId>.json';
  export type SessionMetricRow = {
    readonly schemaVersion: 1;
    readonly sessionId: string;
    readonly generatedAt: string;
    readonly nearMissRate: number;
    readonly passedSliceCount: number;
    readonly nearMissSliceCount: number;
    readonly hotspotCount: number;
    readonly skillsBlobSha?: string;
  };
  export function buildSessionMetricRow(opts: {
    readonly sessionId: string;
    readonly events: readonly ObservabilityEvent[];
    readonly skillsBlobSha?: string;
  }): SessionMetricRow;
  export function writeSessionMetricRow(projectRoot: string, row: SessionMetricRow): void;
  export function readSessionMetricRow(projectRoot: string, sessionId: string): SessionMetricRow | null;
  /** 读出 `skills/` 目录树的 git blob sha（技能版本标识）。 */
  export function readSkillsBlobSha(projectRoot: string): string | undefined;
  ```
  落盘路径：`.peaks/observability/sessions/<sessionId>.json`（**非下划线目录 = 受版本控制的真相源**，与 `.peaks/_runtime/` 的临时产物区分开）。

  `skillsBlobSha` 记的是 **`skills/` 目录树**的 git blob sha（`git rev-parse HEAD:skills`），用来把"某次失败发生在 SKILL.md 的哪个版本"钉住。读不出来（不是 git 仓库 / 没有 `skills/` 目录）时返回 `undefined`，**不得抛异常**。

- [ ] **Step 1: 写失败的测试**

`tests/unit/services/observability/session-metric-rows.test.ts`：
1. `buildSessionMetricRow` 对一组事件算出正确的 `nearMissRate` 与计数。
2. `writeSessionMetricRow` 后 `readSessionMetricRow` 读回**逐字段相等**。
3. **写盘是原子的**（先写临时文件再 rename）—— 断言中途失败不会留下半截 JSON。
4. **路径正确**：文件落在 `.peaks/observability/sessions/<sessionId>.json`，**不是** `.peaks/_runtime/`。
5. `readSkillsBlobSha` 在一个临时 git 仓库（有 `skills/` 目录且已提交）上返回一个 40 位的 hex；在**非 git 目录**上返回 `undefined` 且**不抛异常**。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/services/observability/session-metric-rows.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现**

复用 `src/services/observability/jsonl-store.ts` 的原子写思路（参考 `src/services/skills/presence-lease-store.ts` 的 `writeAtomic`：`writeFileSync(tmp)` + `renameSync`）。

**`readSkillsBlobSha`**：用 `child_process.execFileSync('git', ['rev-parse', 'HEAD:skills'], { cwd: projectRoot })`，把 stdout 去空白。**整个函数包 try/catch，任何失败都返回 `undefined`** —— 不是 git 仓库、没有 `skills/` 目录、git 不在 PATH，都必须是安静的空值。

**脱敏**：本步骤落盘的只有聚合计数与路径，**不含 `reason` 自由文本、不含工具输入输出** —— 因此**不需要**走 `src/services/log/redact.ts`。若后续要在行里放证据指针，**只放 `(sessionId, ts)`，不放原文**。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/unit/services/observability/session-metric-rows.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/services/observability/session-metric-rows.ts tests/unit/services/observability/session-metric-rows.test.ts
git commit -m "feat(observability): keep the per-session numbers where a later run can compare them"
```

---

### Task 10: 哑 category 清算

**Files:**
- Modify: `src/services/observability/observability-schema.ts`（只加注释）
- Create: `.peaks/docs/observability-category-audit.md`

**Interfaces:**
- Consumes: 无
- Produces: 一份记录文档，逐个 category 写明"有 emitter / 触发条件 / 在已记录历史中是否触发过"。

- [ ] **Step 1: 列出全部 10 个 category 的 emitter 位置与触发条件**

逐个查证并填表（已知的起点：`cycle` / `token-usage` / `monotonic-trigger` 在 `src/services/observability/observability-service.ts`；`mode-gate` 在 `src/cli/commands/code-mode-gate-should-pause-envelope.ts`；`context-trigger` 在 `src/cli/commands/context-check-command.ts`；`post-compact` 在 `src/services/code/post-compact-detector.ts`；`slice-transition` 在 `src/services/artifacts/prerequisite-transition-event.ts`；`dispatch` / `lease` 也在 observability-service）。

- [ ] **Step 2: 对每个在已记录历史里从未触发的 category，给出结论**

三种终态之一：**① 条件触发**（写明条件）、**② 补接线**（说明在哪个流程里补）、**③ 从 enum 删除**。

> **本任务不得真的删除任何 category** —— 删除会改变既有事件的读法。本任务只产出结论文档；实施删除留给单独的、经过闸1 的切片。

- [ ] **Step 3: 写文档 + 在 schema 里加注释**

`.peaks/docs/observability-category-audit.md`：一张表（category / emitter 位置 / 触发条件 / 历史是否触发 / 结论）。

在 `observability-schema.ts` 的 `OBSERVABILITY_CATEGORIES` 上方加一段注释，指明这份审计文档的位置与"每个 category 必须能说出它的触发条件"这条不变式。

- [ ] **Step 4: 提交**

```bash
git add src/services/observability/observability-schema.ts .peaks/docs/observability-category-audit.md
git commit -m "docs(observability): every declared category now names its trigger"
```

---

### Task 11: 闸1 —— 用真实历史验证

**Files:**
- Modify: `docs/superpowers/specs/2026-10-26-self-evolution-observability-loop-design.md`（在 §2.4 记录闸1 的实测结果）
- Test: `tests/unit/services/observability/hotspots.test.ts`（补一个用真实历史形状的用例）

**Interfaces:**
- Consumes: Task 1–10 的全部产出
- Produces: 闸1 的实测记录

- [ ] **Step 1: 跑真实的 near-miss 与 hotspots**

```bash
node node_modules/tsx/dist/cli.mjs src/cli/index.ts observability near-miss --project . --all-sessions --json > .peaks/_runtime/tmp-near-miss.json
node node_modules/tsx/dist/cli.mjs src/cli/index.ts observability hotspots --project . --all-sessions --json > .peaks/_runtime/tmp-hotspots.json
```

（输出写到 `.peaks/_runtime/` 下 —— 那是 gitignored 的临时区；**不要**写到 bash 的 `/tmp`，本机 bash 与 node 对 `/tmp` 的路径解析不一致。用完删掉这两个文件。）

- [ ] **Step 2: 核对闸1 的三条判据**

1. `hotspots` 的输出里**至少有一条** `count ≥ 1`、`evidence` 非空、`ownerSkill` 能解析到一个**真实存在的 SKILL.md 路径**（`skills/bee/<ownerSkill>/SKILL.md` 或 `skills/<ownerSkill>/SKILL.md`）。
2. `near-miss` 能报出**非零**的近失数或明确的 0（0 也是有效答案，但必须是因为真的没有，而不是因为读不到）。
3. **历史事件没有被丢弃**：`peaks observability status --project . --all-sessions` 的 `totalEvents` **≥ 1533**。若小于 1533，说明 Task 1/3 的 schema 改动破坏了旧记录的读法 —— **这是 Review Focus 第 1 条**，必须先修。

- [ ] **Step 3: 把实测结果写进 spec §2.4**

记录：近失率、近失清单前几条、卡点榜前五条、`totalEvents` 的实测值、以及**追认出的 inferred / ambiguous 占比**（spec §2.2 S1.6 要求的实测数字）。

- [ ] **Step 4: 提交**

```bash
git add docs/superpowers/specs/2026-10-26-self-evolution-observability-loop-design.md tests/unit/services/observability/hotspots.test.ts
git commit -m "docs(observability): the gate is open, with the numbers that opened it"
```

---

## 完成定义

本计划完成时，以下**全部**为真：

- [ ] `peaks observability near-miss --all-sessions` 报出近失率与清单
- [ ] `peaks observability hotspots --all-sessions` 报出卡点榜，且每行的 `ownerSkill` 指向真实存在的 SKILL.md
- [ ] `peaks observability status --all-sessions` 的 `totalEvents` ≥ 1533（历史没丢）
- [ ] `status` 的 `successCount + failCount + stalledCount === totalSlices`
- [ ] `peaks observability report` 开头是"近失"节，其后是"卡点"节
- [ ] 两个试点技能（`peaks-rd` / `peaks-race-code`）的遵守率由**确定性检查**算出，不依赖 LLM judge
- [ ] `pnpm test:unit` 全绿
- [ ] `pnpm lint` 不让任何 ceiling 上升；`npx eslint tests/` 无新增 findings
- [ ] 全部提交不含任何 AI 署名 trailer

**然后**：闸1 通过 → 用真实的近失数据回答 spec §7.2 第 6 条（第一个该被提升为 hook 的步骤是谁）→ 写 S3/S4 的计划 → 再碰 `evolution_evaluation` 表。
