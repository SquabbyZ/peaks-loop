# peaks-cli 上下文构建 + 三阶段审计 整改 — Design Spec

- **Date**: 2026-06-21
- **Status**: Brainstorming complete, awaiting spec review
- **Owner**: peaks-solo → peaks-rd → peaks-qa → peaks-txt
- **Targets**: peaks-cli v2.8.0 → v3.0.0 (新增 `peaks-context` / `peaks-mut` / `peaks-state-lock`)
- **Related**:
  - 用户 PRD: `C:\Users\smallMark\Desktop\plan.md`(peaks-cli 2.0 愿景完整版)
  - PRD Section 4.1(上下文构建模块)、4.2(三阶段强门禁)、4.9(全局状态锁)
  - PRD Section 1.1(二)(测试幻觉)、Section 7 阶段二(变异测试 + 断言有效性)
  - 当前 peaks-cli v2.8.0,11 个 skill + CLI + 跨 IDE
  - `.peaks/memory/custom-sop-and-gate-metering.md`(SOP 商业化已锁决策,本设计正交)
  - `.peaks/memory/rd-gstack-dry-run.md`(RD 子代理 dry-run 纪律,本设计继承)

---

## 1. Problem Statement

用户在脑暴中提出 3 个表层痛点,根因是同一个架构缺陷:

### 1.1 三个表层痛点(用户原话)

| # | 痛点原话 | PRD 对应章节 | 当前 peaks-cli 状态 |
|---|---|---|---|
| **#1** | "上下文是提示词堆砌" | PRD §4.1 上下文构建模块 | LLM 凭 SKILL.md 提示词自主读 package.json / git / memory,无版本标签,无结构化 metadata,LLM 用训练数据代替项目事实 |
| **#2** | "没有同一目标独立上下文的审计 agent" | PRD §4.2 三阶段强门禁 + §4.9 全局状态锁 | peaks-rd → peaks-qa 串行传递上下文,共享 worldview,QA 跟着 RD 走 → 无审计独立性,无阶段隔离,无 sig 链 |
| **#3** | "harness 解决不了的测试假绿" | PRD §1.1(二) 测试幻觉 + §4.2 验收审计 + §7 阶段二 | peaks-qa = vitest 通过 + coverage 数字,无变异测试,无断言有效性扫描,`toBeDefined()` / `toBeTruthy()` 满天飞 |

### 1.2 根因 (Root Cause)

> **"上下文 = 字符串,阶段 = 串行,审计 = LLM 自查"**

三个痛点都从这同一个根因长出来:
- **字符串上下文** → 无法注入版本标签 / 冲突摘要 → 问题 #1
- **串行阶段** → 上下文传递 → QA 失去独立性 → 问题 #2
- **LLM 自查** → 看不见 `toBeDefined()` 这种"零信息断言" → 问题 #3

### 1.3 关键张力 (User-articulated)

> "SOP 形式门禁这些已有能力不能被新架构吃掉。"

已锁定的能力(SOP / 8 个不动 skill / 跨 IDE 注册 / Gate A2-A3-A4-D / project memory)必须保留。本设计**只新增 + 局部重构**,不替换任何已有能力。

---

## 2. Design Philosophy

### 2.1 对齐 PRD 6 哲学

| PRD 哲学 | 本设计落地 |
|---|---|
| 哲学一 黑盒即工具 | 审计裁决 100% 由 CLI 计算(peaks-context / peaks-mut / peaks-state-lock),LLM 只输出建议 |
| 哲学二 决策权下沉 | gate 谓词 = AST metric + 变异杀灭率 + 断言 AST 比例,**不是 LLM 的 toBeDefined()** |
| 哲学三 外星智能驯化 | peaks-mut 的"无效断言 AST 扫描" + peaks-context 的"版本标签"是核心武器 |
| 哲学四 成本感知熔断 | 复用现有 peaks-qa 的 repair loop 3-cycle cap,扩展到 peaks-mut / peaks-context 的重试预算 |
| 哲学五 语言无关 + 供应商解耦 | peaks-context DocRetriever 按 lockfile 解析(TS/Python/Go/Java/Rust);peaks-mut 工具按语言选(stryker/mutmut/go-mutesting) |
| 哲学六 场景感知执法 | 与 PRD §4.5 project-context.yaml 兼容;本设计不引入新的 scenario 配置,但所有新 gate 默认 opt-in + per-project config |

### 2.2 三条 Karpathy 准则继承

| 准则 | 在本设计的体现 |
|---|---|
| #1 Think Before Coding | 本 spec 是产物(已脑暴 5 轮 + 用户审) |
| #2 Simplicity First | 单切片 ≤800 行纪律继承(`peaks slice check` 全绿) |
| #3 Surgical Changes | 8 个 skill 不动;只改 peaks-rd / peaks-qa 内部 + 加 3 个新 actor |

### 2.3 关键设计原则 (Hard Constraints)

| # | 原则 | 不遵守的后果 |
|---|---|---|
| H1 | **CLI 强制采集** > LLM 自主读 | 回到堆砌 |
| H2 | **版本锁定** > LLM 训练数据 | 6.x 写进 5.x 项目 |
| H3 | **结构化 metadata** > 裸字符串 | LLM 无法做相对异常检测 |
| H4 | **每阶段独立 context** > 共享 worldview | 审计合谋 |
| H5 | **跨阶段 sig 链** > 隐式传递 | 改完代码不重测就过 |
| H6 | **CLI 计算裁决** > LLM 主观终裁 | gate 被绕过 |
| H7 | **现有能力不动** > 一致性重写 | 撕裂已有用户基础 |
| H8 | **审计轨迹落盘** > 一次性 in-memory | 无外部合规审计可调阅 |

---

## 3. Target Architecture (终态)

### 3.1 架构图

```
                  peaks-solo (orchestrator, 不变)
                              │
                              ▼
              peaks-context (新 CLI 模块, PRD §4.1)
              ┌──────────────────────────────────┐
              │  Collector ─→ DocRetriever ─→   │
              │     │             │             │
              │     ▼             ▼             │
              │  Tokenizer (non-mutating meta)  │
              │     │                            │
              │     ▼                            │
              │  Renderer (versioned + tagged)   │
              └──────────────────────────────────┘
                              │
              ┌───────────────┼───────────────────────┐
              ▼               ▼                       ▼
    peaks-rd              peaks-mut             peaks-qa
    ┌─────────┐         ┌─────────┐           ┌─────────┐
    │战略审计  │         │测试质量  │           │验收审计  │
    │(根因)   │         │(假绿拦截)│           │(变异 +  │
    │         │         │         │           │ 断言)  │
    │战术审计  │         │独立 context:│       │         │
    │(AST 硬门)│         │test+src+   │       │独立 context:│
    │         │         │assertion   │       │test+src+   │
    └─────────┘         │AST         │       │coverage    │
         │              └─────────┘           └─────────┘
         │                    │                      │
         └────────────────────┴──────────────────────┘
                              │
                              ▼
              peaks-state-lock (新 CLI 原语, PRD §4.9)
              ┌──────────────────────────────────┐
              │  ANALYSIS.lock  → STRAT.sig      │
              │  IMPLEMENT.lock → TACT.sig       │
              │  MUTATION.lock  → MUT.sig        │
              │  QA.lock        → ACCEPT.sig     │
              │  (file lock + sha256 chain)      │
              └──────────────────────────────────┘
```

### 3.2 Actor 职责矩阵(终态)

| Actor | 输入 | 输出 | 上下文范围 | 不可越界 |
|---|---|---|---|---|
| **peaks-context** | request goal + repo path | `context.json`(versioned + tagged) | **只读**,不消费任何下游 actor 产物 | LLM 不可绕开 doc retrieval |
| **peaks-rd/战略** | goal + context.json(意图子集) | `strategy.md` + `STRAT.sig` | 只读 goal + context 意图区 | 不读 RD/战术/qa 产物 |
| **peaks-rd/战术** | STRAT.sig + context.json(实现子集) | `impl.json` + `TACT.sig` | 只读 goal + STRAT + context 实现区 | 不读 peaks-qa / peaks-mut 产物 |
| **peaks-mut** | TACT.sig + context.json(测试子集) | `mut-report.json` + `MUT.sig` | 只读 test files + source under test | 不读战略/战术 |
| **peaks-qa** | TACT.sig + MUT.sig + context.json(测试子集) | `qa-report.json` + `ACCEPT.sig` | 只读 goal + TACT + mut | 不读战略;**仍保留** Gate A2/A3/A4/D |
| **peaks-state-lock** | 阶段切换请求 | 锁文件 + sig 校验 | 跨 actor 协调 | 任何 actor 读到非自己阶段产物 → 报错 |

### 3.3 场景走读:`peaks-solo 给登录页加 OAuth 回调`

| Step | 触发 | 关键动作 | 用户感知 |
|---|---|---|---|
| 1 | 用户敲 `peaks-solo` | `peaks context build --goal "..." --audience peaks-rd` | 看不到 |
| 2 | 上下文就绪 | peaks-rd/战略:读 context.json 意图区,问根因 | AskUserQuestion #1(callback URL 从哪来) |
| 3 | STRAT.sig | peaks-rd/战术:写代码,CLI 跑 AST 硬门禁比对 oauth-client@2.4.0 API | 看不到(自动修复) |
| 4 | TACT.sig | peaks-mut:跑 Stryker + 断言 AST | AskUserQuestion #2(假绿时不达标选项) |
| 5 | MUT.sig | peaks-qa:跑 slice check + Gate A2/A3/A4/D + sig 链校验 | 看不到 |
| 6 | ACCEPT.sig | peaks-solo 解锁 merge,完整 audit-trail 落盘 | 可选 AskUserQuestion #3(成本提示) |

---

## 4. Component Design

### 4.1 `peaks-context` CLI 接口

#### 命令表面

```bash
peaks context build    # collect → retrieve → tokenize → render (最常用)
peaks context collect
peaks context retrieve
peaks context tokenize
peaks context render   # 支持 --audience 切换
peaks context inspect  # 人读摘要
peaks context validate # 校验 schema + sig
peaks context schema   # 输出 JSON Schema
```

#### `peaks context build` 参数

| 参数 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `--goal` | ✓ | — | 用户原始请求 |
| `--project` | ✓ | cwd | 扫描根 |
| `--audience` | | `all` | `peaks-rd` / `peaks-qa` / `peaks-mut` / `all` |
| `--deps-mode` | | `locked` | `locked`(强制按 lockfile) / `latest`(escape hatch,RISKY_WARNING) |
| `--doc-budget-tokens` | | `8000` | 超出截断 |
| `--out` | | `.peaks/_runtime/<sid>/context.json` | — |
| `--json` | | `false` | 机器读 |

#### `context.json` Schema (v1.0)

关键字段:

```typescript
interface ContextJson {
  version: "1.0";                  // schema 版本
  goal: string;
  generatedAt: string;             // ISO8601
  sha256: string;                  // 文件 hash,给 sig 链用

  collector: {
    files: Array<{ path: string; kind: "source"|"test"|"config"|"doc"; lines: number; hash: string }>;
    gitStatus: { branch: string; lastCommit: string; dirty: boolean };
    memoryEntries: Array<{ path: string; title: string; relevanceScore: number; excerptHash: string }>;
    deps: Record<string, { version: string; source: "package.json"|"pnpm-lock.yaml"|"yarn.lock"; resolved: string }>;
  };

  docRetriever: {
    fetchedDocs: Array<{ dep: string; version: string; source: "local-cache"|"remote-fetch"; url?: string; fetchedAt: string; contentHash: string; sections: Array<{ title: string; tokenEstimate: number; excerpt: string }>; stale: boolean }>;
    skipped: Array<{ dep: string; reason: "unconfigured"|"network_error"|"version_unknown" }>;
  };

  tokenizer: {
    metadata: Array<{ id: string; kind: "doc"|"code"|"memory"|"git"; version?: string; blastRadius: string[]; conflictScore: number; timeDecayScore: number; tags: string[] }>;
  };

  renderer: { audience: "peaks-rd"|"peaks-qa"|"peaks-mut"|"all"; renderedAt: string; sizeBytes: number; truncated: boolean; truncatedReason?: "doc_budget_exceeded"|"section_count_exceeded" };
}
```

**关键设计点**:
- `memoryEntries` 只存 hash,**不存全文**(防 LLM 偷看历史决策)
- `deps` 字段锁版本 — DocRetriever 必须严格匹配,否则 fail
- `docRetriever.skipped` 显式记录"不知道"比"假装拉到了"更诚实

#### 错误处理

| 错误 | 行为 | Exit |
|---|---|---|
| `package.json` 缺失 | 硬失败 | 2 |
| 锁定版本缺失 | 硬失败(不允许 `--deps-mode latest` 替代) | 2 |
| 远程失败 + 无缓存 | 软失败,写入 `skipped`,RD 收 RISKY_WARNING | 0 + warning |
| 远程失败 + 有缓存 | 用缓存,标 `stale=true` | 0 + warning |
| 缓存版本不匹配 | 硬失败,提示 `--refresh` | 2 |
| Tokenizer 输入非法 | 硬失败 + schema 错误位置 | 3 |
| Renderer 超 budget | 截断 + `truncated=true` | 0 + warning |

**原则**:**版本相关错误硬失败**;**网络/资源软失败**。

#### 关键测试

- **跨版本隔离**(核心承诺):给定 antd@5.21.0 deps,context.json 里 antd 文档摘要**绝对不能含** `Form.item` 这种 6.x API。一挂核心承诺就破。
- 跨 IDE 一致性:同一 fixtures 在 Claude Code / Trae 跑,context.json diff 应为空。

### 4.2 `peaks-mut` 设计

#### CLI 表面(新 skill,11 → 12)

```bash
peaks mut run     # 完整审计
peaks mut mutants # 只变异
peaks mut asserts # 只断言 AST
peaks mut report  # 人读最近一份
```

#### `mut-report.json` Schema

```typescript
interface MutReportJson {
  version: "1.0";
  sha256: string;
  generatedAt: string;
  inputSig: string;                 // TACT.sig,确保上游未变

  mutation: {
    tool: "stryker"|"mutmut"|"go-mutesting";
    mutantsTotal: number;
    mutantsKilled: number;
    mutantsSurvived: number;
    mutantsTimeout: number;
    killRate: number;
    byFile: Array<{ file: string; killRate: number; survived: Array<{ line: number; mutation: string; survivedBecause: string }> }>;
  };

  assertions: {
    totalAssertions: number;
    weakAssertions: number;
    weakRate: number;
    weakPatterns: Array<{ pattern: "toBeDefined"|"toBeTruthy"|"toEqual-self"|"expect-anything"; count: number; examples: Array<{ file: string; line: number; code: string }> }>;
  };

  thresholds: { mutationKillRateMin: 0.80; weakAssertionRateMax: 0.05; passed: boolean };

  followups: Array<{ file: string; issue: "low_kill_rate"|"high_weak_assertions"; severity: "soft"|"hard"; suggestion: string }>;
}
```

**关键设计**:
- 变异工具按语言选:TS=Stryker,Python=mutmut,Go=go-mutesting。v1 只发 Stryker,其他语言留接口。
- weak pattern 5 类:`toBeDefined()` / `toBeTruthy()` / `toEqual(x)` 自身相等 / `expect.anything()` / `expect(x).toBe(x)`。
- 两套阈值:kill_rate 软门禁(可走 AskUserQuestion 放行),weak_rate 硬门禁(默认拒收)。
- 独立 context:audience=peaks-mut 看不到 RD 设计意图。

### 4.3 `peaks-rd/战术` (战术审计) 设计

> **R1-W3 整合**:本节是新加的"战术审计"专章,把散落在 §3.2 / §3.3 / Phase 3 AC-2 与 H6 / H8 中的战术子阶段要求集中到一处,使 `tactical-stage.ts` / `impl.ts` 等实现可以指向单一权威位置。

#### 4.3.1 角色定位

`peaks-rd/战术` 是 `peaks-rd` 的子阶段,在 `peaks-rd/战略` 产出 STRAT.sig 之后运行。它负责:

1. 读 STRAT.sig + context.json(`audience=peaks-rd`)
2. 写实现代码(改 source files)
3. 跑 **AST 硬门禁**(peaks-context 提供 API 白名单,CLI 比对)
4. AST gate 通过 → 写 `impl.json` + 算 `TACT.sig`(含 STRAT.sig hash)
5. AST gate 不通过 → **硬失败**,LLM 必须自修后重跑(由 §3.3 场景走读 step 3 可见,失败对用户不可见、由 LLM 自动修复)

#### 4.3.2 Hard Constraints 直接绑定

| 约束 | 在战术阶段的体现 |
|---|---|
| **H6 (CLI 裁决 > LLM 主观终裁)** | AST 门禁由 `runAstGate` 计算并拒绝,LLM 没有兜底裁决权 — 写 `impl.json` 之前必须 AST gate 返回 0 violations |
| **H8 (审计轨迹落盘)** | `TACT.inputSig` **必须等于** `STRAT.sha256` 上游 — 由 `tactical-stage.ts` 中 `STRAT_SIG_REGISTRY` 按 `dirname(out)` 强制;不允许任何 64-hex 字符串伪装成上游 STRAT |
| **§3.2 不可读未来阶段** | 战术阶段不读 peaks-qa / peaks-mut 产物,只读 goal + STRAT + context |
| **§3.3 场景走读** | OAuth 回调例:STRAT.sig 已写 → 战术改 LoginForm.tsx → CLI 跑 AST 比对 `oauth-client@2.4.0` API 白名单(不识别的 `unknownApi` 直接拒) |

#### 4.3.3 输入/输出契约

**输入** (`RunTacticalInput`):
```typescript
{
  project: string;                  // project root (用于 AST 门禁扫描)
  changedFiles: ReadonlyArray<string>;
  inputSig: string;                 // === STRAT.sha256 (H8 chain)
  context: AstGateContext;          // peaks-context 输出,含 deps + docSummaries
  out: string;                      // impl.json 目标路径
}
```

**输出** (`ImplOutput`):
```typescript
{
  version: "1.0";
  sha256: string;                   // TACT.sig
  generatedAt: string;
  inputSig: string;                 // 严格透传 === STRAT.sha256
  changedFiles: ReadonlyArray<string>;
  externalApiCalls: ReadonlyArray<ExternalApiCall>;
  astGate: AstGateResult;
}
```

#### 4.3.4 错误语义(由 §3.3 step 3 + H6 锁定)

| 触发条件 | 行为 |
|---|---|
| AST gate 有 violations | `runTacticalStage` throw `<reason from runAstGate>` — `impl.json` **不写** |
| `inputSig !== STRAT_SIG_REGISTRY.get(projectDir)` | `runTacticalStage` throw `STRAT.sig chain broken: ...` — H8 forgery defense |
| `STRAT_SIG_REGISTRY` 未注册该 projectDir | 同上 throw(覆盖"未上游"伪造场景) |

**实现锚点**:`src/services/rd/tactical-stage.ts`(`runTacticalStage` + `STRAT_SIG_REGISTRY` + `STRAT_SIG_CHAIN_INVARIANT`),`src/services/rd/impl.ts`(`writeImpl` + `ImplOutputSchema`)。

#### 4.3.5 与其他组件的关系

- 上游:`peaks-rd/战略` 必须先跑(`runStrategicStage` → `registerStratSig(dirname(out), sha256)`)
- 下游:`peaks-mut` 读 TACT.sig + 测试子集 context
- 旁路:`peaks-qa` 通过 `peaks-state-lock verify` 校验 sig 链不断裂

---

### 4.4 `peaks-state-lock` 设计

#### CLI 表面(CLI 原语,非 skill)

```bash
peaks state lock   --stage <stage> --in <file>
peaks state unlock --stage <stage>
peaks state verify --all
peaks state inspect --stage <stage>
peaks state status
```

#### 阶段 + Sig 链

```
ANALYSIS          peaks-rd/战略    → STRAT.sig
IMPLEMENTATION    peaks-rd/战术    → TACT.sig (含 STRAT.sig hash)
MUTATION          peaks-mut       → MUT.sig  (含 TACT.sig hash)
ACCEPTANCE        peaks-qa        → ACCEPT.sig (含 STRAT+TACT+MUT sig hash)
```

#### 文件布局

```
.peaks/_runtime/<sid>/state/
  ANALYSIS.lock     IMPLEMENTATION.lock     MUTATION.lock     ACCEPTANCE.lock
  STRAT.sig         TACT.sig                MUT.sig           ACCEPT.sig
```

#### 关键不变量

| 维度 | 规则 |
|---|---|
| 跨阶段读 | 阶段 X 只能读 ≤ X 阶段产物。读未来 → `BLOCKED: cannot read <stage> before reaching it` |
| sig 校验 | 阶段 X 启动时校验所有上游 sig 完整 → 不完整 BLOCKED |
| 锁 TTL | 30 min,过期自动释放 |
| sig 写入 | 原子(temp + rename) |
| sig 链 | ACCEPT.sig 输入包含所有上游 sig 的 sha256 链式 |

---

## 5. 4-Phase Implementation Plan

**路径选择**:用户选 B(增量交付,终态全量)。每 phase 独立 shippable,最终对齐 PRD 全部架构。

### Phase 1: `peaks-context` 上线

| AC | 内容 |
|---|---|
| AC-1 | `peaks context build` 跑通真实 package.json → 产出 context.json |
| AC-2 | **跨版本隔离测试通过**:antd@5.21.0 deps → context.json 绝无 6.x API |
| AC-3 | peaks-rd / peaks-qa 透明接入(老用户无感) |
| AC-4 | 单测覆盖率 ≥ 80% on Collector / DocRetriever / Tokenizer / Renderer |
| AC-5 | 跨 IDE 一致性(Claude Code / Trae 同一 fixtures diff 为空) |
| **不破坏** | 11 个 skill 不动 / SOP 正交 / 跨 IDE 注册不变 |

### Phase 2: `peaks-mut` 上线

| AC | 内容 |
|---|---|
| AC-1 | Stryker 集成(其他语言留接口) |
| AC-2 | 断言 AST 识别 5 种 weak pattern |
| AC-3 | peaks-qa 接入 mut-report 触发 AskUserQuestion |
| AC-4 | kill_rate < 80% 或 weak_rate > 5% 自动触发 |
| AC-5 | 单测覆盖 ≥ 80% |
| **不破坏** | peaks-qa Gate A2/A3/A4/D 全部保留 |

### Phase 3: `peaks-rd` 拆战略 + 战术

| AC | 内容 |
|---|---|
| AC-1 | 战略子阶段产出 STRAT.sig |
| AC-2 | 战术子阶段跑 AST 硬门禁 + 产 TACT.sig |
| AC-3 | 战略失败硬阻断战术(不靠 LLM 自查) |
| AC-4 | Karpathy 4 准则在两子阶段都注入 |
| **不破坏** | peaks-rd 对外接口不变 |

### Phase 4: `peaks-state-lock` + `peaks-qa` 验收化

| AC | 内容 |
|---|---|
| AC-1 | state CLI 完整(lock/unlock/verify/inspect/status) |
| AC-2 | peaks-qa 读 sig 链 → ACCEPT.sig |
| AC-3 | 跨阶段读保护(读未来阶段报错) |
| AC-4 | sig 链断裂 → 拒绝 merge |
| AC-5 | 端到端集成测试 |
| **不破坏** | peaks-qa 对外接口不变 |

### 5.1 实施顺序的工程理由

- Phase 1 基础设施(context.json 是后续所有阶段的输入)
- Phase 2 独立审计(peaks-mut 不依赖 state-lock,但需要 context.json 的 mut 视图)
- Phase 3 拆 RD(此时 STRAT/TACT sig 概念已落地,但还没 lock 强制)
- Phase 4 全局协调(元层,放最后避免早锁影响迭代)

### 5.2 整路不变量(必须保持)

1. 老用户敲 `peaks-solo X` 体感与 v2.8.0 几乎一致(仅多 1-2 个 AskUserQuestion)
2. 任何 phase 都可独立 shippable,不破坏其他 phase
3. peaks-context 的"跨版本隔离"测试一旦写好,**永不能挂**

---

## 6. Compatibility Analysis

### 6.1 已有能力 — 不动 / 改动 / 新增

| 已有能力 | 状态 | 理由 |
|---|---|---|
| `peaks-solo` orchestrator | 🟢 不动 | 只调度表多 3 个 actor |
| 其他 8 个 skill(prd/sc/txt/sop/doctor/ide/companion) | 🟢 不动 | 不在改造范围 |
| SOP 形式门禁 | 🟢 不动(正交) | SOP = 用户声明式;新 gate = CLI 内置代码式 |
| 跨 IDE 注册 | 🟢 不动 | 新 actor 复用同一注册机制 |
| `.peaks/memory/*.md` | 🟢 不动 | 新决策继续落这里 |
| Karpathy 4 准则注入 | 🟢 不动 | peaks-mut 同样注入 |
| `peaks slice check` | 🟢 不动 | phase 边界仍跑;state-lock sig 校验可加进 |
| `peaks-rd` 对外接口 | 🟡 内部重构 | 多战略+战术两子阶段 |
| `peaks-qa` 对外接口 | 🟡 内部重构 | 读 mut-report 触发 AskUserQuestion |
| `peaks-rd` 内部分发 | 🟢 不动(派发机制) | 只是分阶段执行 |

### 6.2 新增(纯增量)

| Actor | 类型 | 触发方式 |
|---|---|---|
| `peaks-context` | CLI 模块 | RD/QA/mut 启动前自动 |
| `peaks-mut` | 新 skill(11→12) | peaks-qa 流程子阶段 |
| `peaks-state-lock` | CLI 原语 | 阶段切换自动 |

### 6.3 SOP 与新架构的边界

```
SOP gates (用户声明式 simple predicate):
  - "package.json 必须有 build 脚本"
  - "src/ 不许出现 console.log"
  - "pre-commit 必须 exit 0"

新架构 gates (CLI 内置 sophisticated):
  - AST 比对版本 API 摘要     ← peaks-context 注入,RD 战术触发
  - 变异杀灭率 ≥ 80%           ← peaks-mut 触发
  - 无效断言比例 ≤ 5%          ← peaks-mut AST 触发
  - 跨阶段 sig 哈希链一致     ← peaks-state-lock 触发
```

**两者并存**。SOP 适合项目级硬约定,新架构适合工程级硬指标。SOP 商业化路线(custom-sop-and-gate-metering 已锁决策)不受影响。

### 6.4 peaks-qa 的 Gate A2/A3/A4/D 保留

| Gate | 在新架构 | 是否保留 |
|---|---|---|
| A2 功能性 | peaks-qa 验收子阶段 | ✅ 保留 |
| A3 安全 | peaks-qa 验收子阶段 | ✅ 保留 |
| A4 性能 | peaks-qa 验收子阶段 | ✅ 保留 |
| D 浏览器 E2E | peaks-qa 验收子阶段(如有 frontend) | ✅ 保留 |
| **新加:** 测试质量 | 读 peaks-mut 输出 | 🆕 新增 |
| **新加:** sig 链校验 | peaks-state-lock 触发 | 🆕 新增 |

---

## 7. Testing Strategy

### 7.1 单元测试

| 模块 | 覆盖目标 | 关键用例 |
|---|---|---|
| Collector | 扫文件 / 解析 lockfile / 匹配 memory | 空 repo / 多 lockfile / 损坏 JSON |
| DocRetriever | 锁定版本匹配 / 缓存命中 / stale | 同 dep 不同 version / 网络 down / 缓存过期 |
| Tokenizer | metadata 加得对 / conflictScore 算得对 | 同 API 多源 / 老 memory / 跨版本冲突 |
| Renderer | audience 过滤 / 截断 / sizeBytes | 大 doc + 小 budget |
| MutRunner | Stryker 集成 / kill rate 算得对 | 100% 测试 / 0% 测试 / 混合 |
| AssertScanner | 5 种 weak pattern AST | 仅 toBeDefined / 混合 / 0 弱断言 |
| StateLock | lock/unlock/sig 链 | 跨阶段读 / sig 链断裂 / TTL 过期 |

### 7.2 集成测试

- `peaks context build` 真实 package.json → context.json 完整
- end-to-end:用户说一句话 → 完整 sig 链(STRAT → TACT → MUT → ACCEPT)

### 7.3 关键承诺测试

- **跨版本隔离**(核心):antd@5.21.0 deps → context.json 绝无 6.x API
- **跨阶段隔离**:peaks-mut context 看不到 strategy.md / impl.json
- **sig 链断裂**:任何一环 hash 不匹配 → ACCEPT.sig 写不出

### 7.4 Snapshot 测试

- `context.json` schema 稳定:破坏性变更需手动 ack
- `mut-report.json` schema 稳定

### 7.5 跨 IDE 一致性

- 同一 fixtures 在 Claude Code / Trae / Cursor 跑,产物 diff 应为空

### 7.6 覆盖率门槛

- 单模块 ≥ 80%(继承 peaks-cli 既有标准)
- 关键承诺测试 100% pass(0 容忍)

---

## 8. Non-Goals (YAGNI)

明确**不做**的事,避免范围蔓延:

| 不做 | 理由 |
|---|---|
| 自研变异测试引擎 | Stryker/mutmut/go-mutesting 已成熟 |
| 自研 AST 解析器 | 用 TypeScript Compiler API / tree-sitter |
| 全 5 种语言的 v1 一次发 | TS/JS v1,其他语言留接口 |
| 把 SOP 形式门禁替换成新 gate | 正交共存,SOP 商业化不动 |
| 改写 peaks-solo orchestrator 内部 | solo 只调度表加 actor,自身不动 |
| 改写 8 个不动 skill | 范围控制 |
| 引入新 CLI 配置语法 | 复用现有 `--flag` + JSON Schema 模式 |
| 自建文档镜像 | 复用 Context7 / 本地缓存,不强求新基础设施 |
| 在新架构里塞 LLM-as-judge 兜底 | H6 原则禁止 |
| 把 LLM 自查当 fail-safe | 信任 CLI 计算 |

---

## 9. Open Questions

> 待用户/团队 review 时确认。

| # | 问题 | 默认决策(若不答) |
|---|---|---|
| Q1 | 是否引入 `project-context.yaml`(PRD §4.5)在本设计里? | 否,留后续 slice |
| Q2 | peaks-context 的本地文档缓存格式? | Markdown + 索引 JSON |
| Q3 | Stryker 配置文件如何与 peaks-cli 集成? | 复用 `stryker.conf.js`,peaks-mut 调用 |
| Q4 | 跨阶段读保护是否要可禁用? | 默认开,`peaks state unlock --force` 可破 |
| Q5 | peaks-mut 的弱断言阈值 5% / kill rate 80% 是否可配置? | 是,放 `peaks-mut.config.json` |
| Q6 | context.json 大小上限? | 默认 100 KB,Renderer 截断 |
| Q7 | 是否要支持 context.json 的 git-track? | 否,放 `.peaks/_runtime/` gitignored |
| Q8 | sig 链断裂时是否提供"重建 sig"工具? | 是,`peaks state verify --rebuild` |

---

## 10. References

- 用户 PRD: `C:\Users\smallMark\Desktop\plan.md`
- PRD §4.1 上下文构建模块
- PRD §4.2 三阶段强门禁(战略/战术/验收)
- PRD §4.9 全局状态锁
- PRD §1.1(二) 测试幻觉
- PRD §7 阶段二(变异测试 + 断言有效性)
- 前置 spec: `docs/superpowers/specs/2026-06-11-peaks-cli-l1-l2-l3-redesign.md`
- 前置 spec: `docs/superpowers/specs/2026-06-10-fuzzy-matching-design.md`
- 项目记忆: `.peaks/memory/custom-sop-and-gate-metering.md`(SOP 商业化)
- 项目记忆: `.peaks/memory/rd-gstack-dry-run.md`(RD dry-run 纪律)
- 当前 v2.8.0 源代码:`src/cli/`、`src/services/`、`skills/`
- Karpathy 4 准则:`andrej-karpathy-skills:karpathy-guidelines`