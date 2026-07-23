# Auto Compact 强保证控制面设计

> 状态：用户已于 2026-07-23 批准，可进入实施计划  
> 日期：2026-07-23  
> 范围：Peaks-Loop 在主流 AI CLI 上的自动上下文压缩、进度呈现、验证和无感接续

## 1. 背景与现状结论

Peaks-Loop 当前的 auto compact 不是单一实现，而是两套部分重叠的系统：

1. `peaks compact *`：公开的 strategic-compact 命令族，主要负责建议和 checkpoint；
2. `peaks code context-now` / `peaks code auto-compact`：隐藏的自动压缩控制面，负责阈值判断、checkpoint、intent 和 hook 安装。

当前实现存在三个阻断性问题：

- **LLM 被要求调用不存在的命令。** 多处 SKILL、runbook、运行时 `next` 字段要求执行 `peaks session auto-compact --execute`，但实际注册的是隐藏命令 `peaks code auto-compact`；后者也没有 `--execute` 参数。
- **外部子进程不等于当前会话内 compact。** `peaks session auto-compact-hook` 通过 `spawn('claude', ['--compact'])` 启动子进程。`claude --compact` 不是 Claude Code 官方 CLI 参数，且没有可靠证据表明子进程能够改写父级 TUI 的当前上下文。
- **核心存在 vendor 泄漏。** 当前 hook、dispatcher 和 adapter 链路硬编码 Claude Code 行为，其他 AI CLI 没有等价能力，违反 Peaks-Loop 的 Vendor-Neutral 红线。

此外，当前测试主要证明命令文本、hook 配置或子进程启动路径存在，没有证明：

- 当前宿主会话真的完成了 compact；
- context 使用量真的下降；
- 同一 TUI 内无感恢复；
- 用户看到了真实压缩进度；
- 非 Claude Code 宿主能够接入。

因此，本设计不是修正一个命令别名，而是重建 auto compact 的能力边界和强保证语义。

## 2. 用户确认的产品约束

### 2.1 两层执行策略

1. 当前宿主暴露可调用的原生 compact 能力时，优先使用宿主能力；
2. 宿主没有原生 compact，或原生 compact 执行后验证失败时，使用 Peaks-Loop fallback compact。

### 2.2 强保证

Auto compact 成功不能由以下任何单一信号证明：

- CLI 返回码为 0；
- hook 写入成功；
- 子进程成功启动；
- checkpoint 文件存在；
- compact intent 已记录。

成功必须表示：

1. 当前工作已经进入经验证的低上下文状态；
2. 用户仍位于同一个宿主 TUI / 窗口；
3. 同一目标、session、job、request、任务进度和 gate 连续；
4. 用户无需确认、复制上下文、重开终端或补充信息；
5. compact 期间可看到类似 Claude Code 原生体验的进度条；
6. compact 完成后自动执行唯一的下一动作。

### 2.3 Vendor-Neutral 红线

核心编排不得先识别“这是 Claude Code / Z-Code / Codex”，再进入 vendor 分支。

核心只消费能力合同。禁止在 compact 核心中出现：

- `if (vendor === 'claude-code')` 一类分支；
- `claude --compact`、`zcode ...` 等 vendor 动词；
- 由 vendor 名称推断 `/compact` 一定可执行；
- 通过键盘、stdin、终端焦点或伪造用户输入注入 `/compact`；
- 为新 AI CLI 修改 compact 状态机。

Claude Code 和 Z-Code 的 `/compact` 只是已观察到的能力样本，不是硬编码依据。

### 2.4 Peaks-Loop 的产品边界

Peaks-Loop 仍是现有 AI runtime 上的增强层，不创建新的 AI REPL，不接管 shell prompt，也不以自己的 TUI 替代宿主。

Peaks-Loop 可以拥有：

- compact 控制协议；
- fallback 摘要算法；
- checkpoint 和 capsule；
- 状态机、阈值、验证与恢复逻辑。

宿主侧必须提供当前 TUI 内的执行端口，才能完成：

- 原地上下文替换；
- 同界面进度渲染；
- 当前 runner 的恢复；
- 对宿主内部 compact 结果的观察。

## 3. 方案比较与决策

### 3.1 方案 A：宿主内置桥接 + Peaks Compact Protocol（采用）

Peaks-Loop 定义统一的 compact 协议。每种 AI CLI 通过插件、extension、官方 SDK、原生 hook 或其他受支持的 in-process 集成方式实现该协议。

优点：

- 能够留在同一 TUI；
- 能够展示真实进度；
- 能够执行原地上下文替换；
- 能够观察完成事件并验证；
- 核心保持 vendor-neutral；
- 新宿主通过增加 bridge 接入，不修改状态机。

代价：

- 每类宿主需要一个经过验证的能力提供者；
- 纯外部 CLI 无法凭空获得父级 TUI 控制权；
- 主流宿主需要逐个完成能力认证。

### 3.2 方案 B：外部 sidecar 启动后续 runner（仅安全降级，不作为强保证）

Peaks-Loop 可以生成 capsule 并启动新的 AI CLI runner。这能够实现逻辑接续，但通常无法保证同一 TUI、原滚动历史、输入焦点和原地进度条。

因此，该路径不得标记为 `seamless` 或 `strong-guarantee`。它只能作为未来显式授权的降级级别；本次强保证流程不自动使用它。

### 3.3 方案 C：猜测 `/compact` 并模拟输入（拒绝）

通过 stdin、键盘注入、终端焦点或子进程猜测 `/compact`，具有不可验证、易误输入、依赖终端实现、破坏 vendor-neutral 等问题，禁止采用。

## 4. 总体架构

### 4.1 Host Integration Plane

运行在当前 AI CLI 宿主内部，负责：

- 声明当前会话的真实能力；
- 调用当前会话内的原生 compact；
- 渲染 compact 进度；
- 在当前 TUI 中使用 Peaks capsule 原地替换上下文；
- 发出 compact 生命周期事件；
- 测量 compact 后的 context；
- 在相同 UI 中恢复当前任务。

它只翻译宿主能力，不拥有阈值、路径选择或 compact 策略。

### 4.2 Compact Control Plane

Vendor-neutral 核心，负责：

- context 压力判断；
- capability 协商；
- 状态机和阶段切换；
- native / fallback 路径选择；
- checkpoint；
- 进度事件的统一语义；
- 超时、失败、重试和回滚；
- compact 后验证；
- resume token 和幂等；
- 审计记录。

### 4.3 Peaks Fallback Engine

当原生 compact 不存在或验证失败时，生成有界的 convergence capsule。它负责压缩 Peaks-Loop 管理的工作语义，不直接操作宿主界面。

### 4.4 Host Compact Bridge

建议的最小合同：

```ts
interface HostCompactBridge {
  probe(input: ProbeInput): Promise<CapabilityProfile>
  invokeNative(input: NativeCompactRequest): AsyncIterable<CompactEvent>
  replaceWithCapsule(input: CapsuleReplacementRequest): AsyncIterable<CompactEvent>
  measureContext(input: MeasureContextRequest): Promise<ContextMeasurement>
  resume(input: ResumeRequest): Promise<ResumeReceipt>
}
```

能力配置：

```ts
interface CapabilityProfile {
  readonly schemaVersion: 1
  readonly contextMeasurement: 'exact' | 'estimated' | 'none'
  readonly nativeCompact: 'invoke-and-observe' | 'invoke-only' | 'none'
  readonly contextReplacement: 'in-place' | 'none'
  readonly progressSurface: 'native' | 'host-rendered' | 'none'
  readonly continuation: 'same-ui' | 'new-ui' | 'none'
  readonly completionSignal: 'event-with-measurement' | 'remeasure' | 'none'
  readonly rollbackSupport: 'transactional' | 'snapshot-restore' | 'none'
  readonly capabilityEpoch: string
}
```

`CapabilityProfile` 不包含 vendor 名称作为决策字段。来源可以是 runtime handshake、官方 SDK capability、插件注册或经过认证的 adapter，但核心只读取能力值。`new-ui` 仅用于识别可选的 `safe-handoff` 降级能力，永远不能通过强保证准入。每次 compact attempt 都必须重新 probe；`capabilityEpoch` 用于拒绝执行期间发生能力变更的陈旧 bridge。

### 4.5 规范性请求与回执类型

```ts
interface ProbeInput {
  readonly sessionId: string
  readonly attemptId: string
}

interface NativeCompactRequest {
  readonly sessionId: string
  readonly attemptId: string
  readonly pathGeneration: number
  readonly targetRatio: number
}

interface CapsuleReplacementRequest {
  readonly sessionId: string
  readonly attemptId: string
  readonly pathGeneration: number
  readonly capsule: ConvergenceCapsule
  readonly rollbackRequired: true
}

interface MeasureContextRequest {
  readonly sessionId: string
  readonly attemptId: string
}

interface ResumeRequest {
  readonly sessionId: string
  readonly attemptId: string
  readonly pathGeneration: number
  readonly continuationToken: string
  readonly nextAction: NextAction
}

interface ResumeReceipt {
  readonly attemptId: string
  readonly pathGeneration: number
  readonly continuationTokenDigest: string
  readonly sameUi: true
  readonly resumedAt: string
}
```

`continuationTokenDigest` 必须等于 coordinator 使用项目本地密钥对 continuation token 计算的 digest；原 token 不写入长期日志。

## 5. 强保证准入规则

### 5.1 Native 路径

只有同时满足下列条件才可使用：

- `nativeCompact === 'invoke-and-observe'`；
- `progressSurface !== 'none'`；
- `continuation === 'same-ui'`；
- `completionSignal !== 'none'`；
- 若 completion signal 来自事件，该事件必须携带可信的 pre/post measurement。

`invoke-only` 不足以构成强保证，因为成功发起不能证明 compact 完成。

### 5.2 Peaks fallback 路径

只有同时满足下列条件才可使用：

- `contextReplacement === 'in-place'`；
- `progressSurface !== 'none'`；
- `continuation === 'same-ui'`；
- `rollbackSupport !== 'none'`；
- `contextMeasurement !== 'none'`，或 `completionSignal === 'event-with-measurement'` 且 provider 已通过 `certified-strong` 认证。

Peaks fallback 的压缩内容由 Peaks 生成，但宿主 bridge 必须在当前 TUI 中完成原地替换。

### 5.3 不满足准入条件

两条路径都不满足时：

- 返回 `AUTO_COMPACT_UNSUPPORTED_STRONG_GUARANTEE`；
- 保存 checkpoint 和诊断证据；
- 不启动新窗口冒充无感；
- 不要求用户输入 CLI 命令；
- 由上层 LLM 用自然语言说明当前宿主缺少哪项能力，并提供自然语言选择。

## 6. 状态机与数据流

### 6.1 状态

```text
idle
  → probing
  → preparing
  → checkpointing
  → native-compacting | fallback-summarizing
  → replacing
  → verifying
  → resuming
  → completed

任意执行态 → recovering → retrying | rolled-back | blocked
```

### 6.2 正常路径

1. Context monitor 发出 `pressure-crossed`；
2. Coordinator 获取会话级 `CapabilityProfile`；
3. 冻结当前唯一 next action，生成 `compactAttemptId`；
4. 写 pre-compact checkpoint；
5. 能力满足 native 准入时执行 native compact；
6. 否则能力满足 fallback 准入时生成 capsule 并请求原地替换；
7. Host bridge 持续发出进度事件；
8. 完成后重新测量 context 或消费可信 completion receipt；
9. 校验 session / job / request / gate / next action 连续性；
10. 使用 resume token 恢复；
11. 只有恢复成功才把 attempt 标记为 `completed`。

### 6.3 原生执行失败后的 fallback

Native 路径出现以下任一情况时切换 fallback：

- invocation 被宿主拒绝；
- completion 超时；
- 收到失败事件；
- compact 后 context 未显著下降；
- continuation receipt 不匹配当前 attempt。

切换前保留同一个 `compactAttemptId`，增加 `pathGeneration`，避免把 fallback 误判为第二次独立 compact。每次 native/fallback 路径切换以及每次 fallback capsule 重新生成都必须递增 `pathGeneration`；completion receipt 和 resume request 必须携带同一代次。

## 7. Peaks Convergence Capsule

Capsule 是 fallback 的核心产物，必须有明确上限和完整性校验。

```ts
interface ConvergenceCapsule {
  readonly schemaVersion: 1
  readonly capsuleId: string
  readonly compactAttemptId: string
  readonly sourceSessionId: string
  readonly goal: ApprovedGoal
  readonly mode: WorkflowMode
  readonly activeJob: JobCursor | null
  readonly activeRequest: RequestCursor | null
  readonly completedGates: readonly GateReceipt[]
  readonly activeTasks: readonly TaskSnapshot[]
  readonly decisions: readonly DecisionRecord[]
  readonly openQuestions: readonly OpenQuestion[]
  readonly failureHistory: readonly FailureRecord[]
  readonly artifactIndex: readonly ArtifactPointer[]
  readonly nextAction: NextAction
  readonly idempotency: IdempotencyEnvelope
  readonly sourceContextMeasurement: ContextMeasurement
  readonly digest: string
}
```

约束：

- Capsule 只内联继续执行所需的最小语义；大产物只保留路径、hash、摘要和按需读取规则；
- 必须只有一个 authoritative `nextAction`；
- 所有可重复 side effect 必须携带 idempotency key；key 由 `sessionId + attemptId + pathGeneration + sideEffectName + sourceContentHash` 生成，作用域为当前 session，并保留到 attempt journal 封存；
- Capsule 超过预算时按以下顺序裁剪：先移除 failure history 的重复细节，再把 artifact index 降为指针，再截断非当前路径的旧 decision；目标、模式、active job/request、completed gates、blocker、当前任务和 next action 永不裁剪；
- digest 校验失败时禁止替换上下文；
- 原 checkpoint 始终保留，可用于回滚。

### 7.1 Capsule 子类型最小合同

```ts
type WorkflowMode = 'full-auto' | 'assisted' | 'strict' | 'swarm'

interface ApprovedGoal { readonly id: string; readonly statement: string; readonly digest: string }
interface JobCursor { readonly jobId: string; readonly sliceIndex: number; readonly totalSlices: number }
interface RequestCursor { readonly requestId: string; readonly state: string; readonly role: string }
interface GateReceipt { readonly gate: string; readonly passedAt: string; readonly evidenceDigest: string }
interface TaskSnapshot { readonly taskId: string; readonly state: string; readonly summary: string }
interface DecisionRecord { readonly id: string; readonly summary: string; readonly decidedAt: string }
interface OpenQuestion { readonly id: string; readonly question: string; readonly blocking: boolean }
interface FailureRecord { readonly code: string; readonly summary: string; readonly retryCount: number }
interface ArtifactPointer { readonly path: string; readonly sha256: string; readonly summary: string }
interface NextAction { readonly id: string; readonly kind: string; readonly summary: string; readonly sideEffect: boolean }
interface IdempotencyEnvelope { readonly scope: string; readonly sealedKeys: readonly string[] }
interface ContextMeasurement { readonly ratio: number; readonly source: string; readonly measuredAt: string }
```

## 8. 进度条协议

### 8.1 统一事件

```ts
type CompactEvent =
  | { type: 'started'; attemptId: string; path: 'native' | 'fallback' }
  | { type: 'stage'; stage: CompactStage; label: string }
  | { type: 'progress'; completed: number; total: number; unit: 'work' }
  | { type: 'detail'; message: string }
  | { type: 'completed'; receipt: CompactCompletionReceipt }
  | { type: 'failed'; code: string; recoverable: boolean }
```

阶段固定为：

1. `preparing`；
2. `checkpointing`；
3. `summarizing`；
4. `replacing`；
5. `verifying`；
6. `resuming`。

### 8.2 进度语义

压缩工作通常无法准确映射到 token 百分比，因此进度条使用单调的 work-unit 模型，不伪造精确 token 进度：

- 每个阶段拥有固定权重；
- 已完成阶段不可回退；
- 当前阶段可报告子工作单元；
- 未知子进度时显示阶段型 indeterminate 动画；
- `100%` 仅在 verification 和 resume 均完成后出现。

### 8.3 渲染责任

- 宿主有 native progress surface 时，bridge 映射 Peaks 事件到原生进度组件；
- 宿主允许 host-rendered surface 时，由 bridge 在同一 TUI 中渲染；
- 核心不输出 ANSI TUI，也不假设终端布局；
- 无进度 surface 的宿主不满足强保证。

建议的用户可见文案：

```text
Compacting context  ███████████░░░░  72%
Summarizing decisions and active work…
```

用户不需要进行任何操作。

## 9. 验证协议

### 9.1 CompactCompletionReceipt

```ts
interface CompactCompletionReceipt {
  readonly attemptId: string
  readonly pathGeneration: number
  readonly path: 'native' | 'fallback'
  readonly sameUi: true
  readonly before: ContextMeasurement
  readonly after: ContextMeasurement
  readonly completionSource: 'host-event' | 'remeasure'
  readonly continuationToken: string
  readonly completedAt: string
}
```

### 9.2 成功条件

必须全部通过：

- receipt 的 attempt ID 与当前 attempt 一致；
- `sameUi === true`；
- after measurement 满足 `after.ratio < min(before.ratio * 0.70, 0.60)`；
- capsule / native summary digest 可追溯；
- resume receipt 与 continuation token 一致；
- 同一 Peaks session / job / request 未被重置；
- next action 没有重复执行。

默认目标建议：compact 后 context ratio 小于 `0.60`。具体阈值作为 Peaks 策略配置，不由 bridge 决定。

### 9.3 信号不足

- 只有 completion event、没有独立 measurement：仅当 provider 已通过 `certified-strong`，且事件自身携带宿主可信的 pre/post measurement 时才可通过；
- 只有可重测 measurement、没有 completion event：允许通过 remeasure 轮询验证；
- 两者都没有：不满足强保证。

## 10. 错误处理、恢复与回滚

### 10.1 错误类别

- `CAPABILITY_UNAVAILABLE`：宿主缺少强保证所需能力；
- `NATIVE_INVOKE_FAILED`：原生 compact 未启动；
- `NATIVE_FAILED_EVENT`：宿主报告原生 compact 执行失败；
- `COMPACT_TIMEOUT`：未在期限内收到完成信号；
- `CONTEXT_NOT_REDUCED`：执行后 context 未下降；
- `CAPSULE_INVALID`：fallback capsule 校验失败；
- `IN_PLACE_REPLACE_FAILED`：宿主无法原地替换；
- `CONTINUITY_MISMATCH`：session / job / request / next action 不连续；
- `RESUME_FAILED`：compact 完成但自动恢复失败。

### 10.2 自动恢复规则

- Native 可恢复错误：自动切换 fallback 一次；
- Fallback 生成错误：从 checkpoint 重新生成一次；
- 原地替换失败：使用宿主事务性 rollback 恢复旧上下文；
- 验证失败：不执行 next action，保留当前 TUI；递增当前 attempt 的 `verificationFailureCount`，未达到 3 次时按本节规则恢复或重试；
- Resume 失败：允许使用同一 continuation token 重试，幂等地恢复；
- Coordinator 在 dispatch side effect 前查询 attempt journal；已封存的同 idempotency key 必须拒绝再次执行；
- 不允许 native / fallback 无限互相切换。

### 10.3 三次验证失败熔断与人工 compact 兜底

`verificationFailureCount` 以 `sessionId + compactAttemptId` 为作用域，native、fallback 和 resume 后复测产生的验证失败都累计在同一计数器中；进程重启不能清零。仅一次完整通过 §9 的强保证验证才能清零。

当连续 3 次不满足验证要求时，必须立即熔断：

- 返回 `AUTO_COMPACT_VERIFICATION_CIRCUIT_OPEN`；
- 取消所有自动重试、定时器和待执行 compact dispatch；
- 封存诊断证据、attempt journal、capsule 和最后一个可恢复 checkpoint；
- 不执行 next action，不启动新 runner，不再调用模型生成新的 capsule；
- `peaks compact status` 暴露计数、最后失败原因和熔断状态；
- 同一 session 在收到人工 compact 完成信号前不得开始新的 auto-compact attempt，防止换 attempt ID 绕过计数。

人工兜底采用用户确认的两级交互：

1. **优先自然语言多选。** 在当前 TUI 显示“手动压缩当前会话”选项；若 host bridge 能把该自然语言选择映射为宿主原生 compact，则由 bridge 执行，用户不输入命令。
2. **宿主无法映射时，提示宿主原生操作。** LLM 用自然语言说明需要用户使用当前 AI CLI 自带的 compact 操作。Core 不硬编码 `/compact` 或任何 vendor 命令；bridge 可以从宿主 capability metadata 提供受验证的显示提示。该步骤是验证熔断后的安全例外，不改变正常流程的 Human-NL-Choice-Only 红线。

人工 compact 后，Peaks 只执行一次观察性验证：

- 收到宿主 completion event 或下一次 context measurement 后运行 §9；
- 验证通过则关闭熔断、清零计数并从 authoritative next action 恢复；
- 验证仍失败则保持 blocked，不再次自动 compact，也不反复提示用户，从而停止无效 token 消耗。

### 10.4 其他重试耗尽

Native 到 fallback 最多切换一次；fallback capsule 最多重新生成一次；resume 最多幂等重试一次。任一路径先触发三次验证失败时以 §10.3 熔断为准；其他重试耗尽后：

- 返回 `AUTO_COMPACT_EXHAUSTED`；
- 封存诊断证据和最后一个可恢复 checkpoint；
- 不再自动重试，不启动新 runner；
- `peaks compact status` 暴露 blocked 原因；
- LLM 用自然语言解释，并只在存在已注册 `safe-handoff` 且用户策略允许降级时提供自然语言多选。

### 10.5 Attempt journal 与崩溃恢复

Attempt journal 固定写入 `.peaks/_runtime/<sessionId>/compact-attempts/<attemptId>.journal.json`，符合两轴 runtime 路径约束，不创建顶层日期目录。每个阶段完成后原子更新 journal。宿主或 Peaks 进程重启后，根据最后一个持久化阶段执行：

- compact 前：恢复原任务；
- replacing 中：查询 bridge transaction；
- verifying 中：重新测量；
- resuming 中：使用相同 token 幂等重试；
- completed：不得再次 compact 或重复 next action。

## 11. LLM 与用户交互面

### 11.1 公开 LLM 原语

当前隐藏且漂移的多个命令应收敛为一个可发现、vendor-neutral 的公开入口。概念合同为：

```text
peaks compact auto --project <path> [--dry-run] [--target-ratio <0..1>] [--json]
```

- 默认模式无提示地执行 probe、checkpoint、路径选择、compact、验证和恢复；
- `--dry-run` 只返回 capability profile、准入判定和计划路径，不产生副作用；
- `--target-ratio` 默认 `0.60`，只能收紧或显式覆盖恢复目标；
- 不提供 vendor、binary、slash-command、`--execute` 或绕过验证的参数。

它负责 probe、checkpoint、路径选择、执行、验证和恢复，不要求 LLM 拼接 vendor 参数，也不要求用户输入任何 CLI。

配套只读状态入口：

```text
peaks compact status
peaks compact capabilities
```

这些是 LLM 代用户调用的底层原语，不构成用户需要学习的新 CLI 交互面。

### 11.2 用户交互

正常 auto compact：

- 不提问；
- 只显示同一 TUI 内的进度；
- 完成后继续执行。

无法满足强保证但尚未触发验证熔断：

- 不要求用户运行命令；
- LLM 用自然语言解释宿主缺失的能力；
- 若存在可选的降级路径，通过自然语言多选询问；
- 未经确认不打开新窗口或新 runner。

连续 3 次验证失败并触发 §10.3 熔断：

- 优先提供“手动压缩当前会话”的自然语言多选，由 host bridge 映射到宿主原生 compact；
- bridge 无法映射时，允许一次性提示用户使用当前宿主自带的 compact 操作；该提示来自经过验证的 capability metadata，core 不包含 `/compact` 或 vendor 命令；
- 提示后停止所有自动 compact 和模型重试，只等待完成事件或 context measurement；
- 人工验证仍失败时保持 blocked，不重复提示。

## 12. Adapter / Bridge 接入模型

### 12.1 核心注册

Bridge 通过 capability provider 注册。核心选择满足合同的 provider，不按 vendor 名称分支。

```ts
interface CompactCapabilityProvider {
  readonly protocolVersion: 1
  canAttach(session: HostSessionDescriptor): Promise<boolean>
  createBridge(session: HostSessionDescriptor): Promise<HostCompactBridge>
}
```

### 12.2 主流 AI CLI 适配

“适配主流 AI CLI”表示：

- 为每个宿主实现或集成 capability provider；
- 通过一致的 conformance suite；
- 新增 provider 时 compact core 零修改；
- 未经真实验证的命令和 hook 不得声明 capability；
- `/compact` 只有在宿主通过 handshake 声明为当前会话可调用能力时才可使用。

### 12.3 认证等级

| 等级 | 必须通过的合同测试 | 自动执行策略 |
|---|---|---|
| `certified-strong` | 能力真实、当前会话调用、同 UI、进度、原地替换、rollback、before/after 验证、幂等 resume 全部通过 | 允许 native 和 fallback 自动执行 |
| `native-only` | 能力真实、当前会话 native 调用、同 UI、进度、completion measurement、resume 通过 | 只允许 native 自动执行 |
| `safe-handoff` | 能力真实、capsule 完整性与新 UI continuation 通过 | 永不自动执行；必须自然语言多选确认 |
| `unsupported` | 仅能 probe / checkpoint，或合同测试失败 | 阻断并报告缺失能力 |

认证结果由 conformance runner 输出带 digest 的本地 manifest，默认路径为 `.peaks/runtime/compact-providers.json`。Manifest 只记录 provider ID、protocol version、capability hash、认证等级、测试证据 digest 和有效期，不记录 vendor 命令。未出现在有效 manifest 中的 provider 不得被加载为可执行 bridge。

生产默认只自动执行 `certified-strong`，以及符合 native 强保证准入的 `native-only` provider。

## 13. 迁移现有实现

### 13.1 合并控制面

| 现有 surface | 当前问题 | 统一入口后的处理 |
|---|---|---|
| `peaks compact suggest/recommend/survival/dry-run/force` | 与自动控制面使用不同信号和语义 | 只保留兼容别名，转发 `peaks compact auto/status/capabilities` 并提示弃用 |
| `peaks code context-now` | 隐藏命令，文案还引用不存在的 `peaks context now` | 转发 `peaks compact status` |
| `peaks code auto-compact` | 隐藏，完整编排入口不可发现 | 转发 `peaks compact auto`；旧 `--force` 测试缝不进入公开 API |
| `peaks code post-compact-detect` | 恢复逻辑与执行分离 | 纳入 coordinator 的 `verifying → resuming` 阶段 |
| `peaks runtime compact` | 与 compact 控制面竞争，按 adapter ID 调用 | 转发 capability provider，不接受 core vendor 分支 |
| `peaks session auto-compact-hook` | 硬编码 `claude --compact` 且不能证明作用于父会话 | 删除执行职责；若保留临时别名，只返回 unsupported/deprecation，不 spawn |
| `peaks session auto-compact --execute` | 从未存在，却被文档和运行时要求调用 | 全部替换为 `peaks compact auto`；不得添加这个错误别名 |
| `peaks code auto-compact --execute` | `--execute` 从未注册 | 文档全部修复；不得静默忽略未知参数 |

保留兼容别名时，别名只转发到统一 coordinator，并返回弃用提示。所有内部 next action 必须引用真实存在、可发现的入口。

### 13.2 删除不可靠声明

- 删除 `claude --compact` 能压缩父级当前 runner 的声明；
- 删除外部 shell spawn 等于 ide-native 的表述；
- 删除不存在的 `peaks session auto-compact --execute`；
- 删除不存在的 `peaks context now`；
- 删除 core 中的 Claude Code 特判；
- 不再将 hook 写入成功视为 compact 成功。

### 13.3 保留可复用资产

- checkpoint 存储；
- context threshold 常量（统一后）；
- auto-decisions / attempt journal 概念；
- post-compact resume 检测中的 session 连续性逻辑；
- adapter registry 框架；
- 项目级 session / job / request 状态。

## 14. 测试策略

### 14.1 单元测试

- CapabilityProfile 决策矩阵；
- native / fallback 准入规则；
- 状态机所有合法与非法转换；
- capsule 预算、裁剪、digest 和唯一 next action；
- progress 单调性与 100% 约束；
- timeout、重试、fallback 和 rollback；
- attempt / resume 幂等；
- context before / after 验证；
- 核心 vendor 字符串静态红线：`src/services/compact-core/**` 中禁止 `claude`、`claude-code`、`zcode`、`codex`、`copilot`、`cursor`、`trae`、`/compact` 以及 vendor 条件分支；仅协议测试 fixture 可出现这些字符串。

### 14.2 合同测试

每个 bridge 必须运行同一 conformance suite：

- 能力声明真实；
- 原生 compact 可在当前会话执行；
- 进度事件顺序正确；
- fallback 可原地替换；
- same UI receipt 可信；
- compact 后 context 下降；
- resume 不丢任务且不重复 side effect；
- 崩溃点恢复正确。

### 14.3 真实宿主 E2E

Mock 不能证明强保证。每个 `certified-strong` provider 必须在真实 AI CLI TUI 中验证：

1. 构造接近阈值的长会话；
2. 触发 auto compact；
3. 观察同一界面的进度条；
4. 证明没有新窗口或新 TUI；
5. 获取 compact completion / measurement；
6. 证明 context 降至目标值；
7. 自动继续预定 next action；
8. 验证用户无需输入；
9. 验证一次性 side effect 没有重复；
10. 保存脱敏的测试证据。

### 14.4 回归测试

- SKILL 和 runbook 中出现的每条 CLI 都执行 `--help` / command registration 测试；
- 运行时 `next` 字段中的命令必须由测试真实执行；
- 任何 adapter 声明的能力都必须有 conformance test；
- 禁止只对消息字符串或 hook JSON 做成功断言。

## 15. 可观测性

每次 attempt 记录：

- attempt ID / session ID；
- capability profile hash；
- 选择路径和理由；
- before / after measurement；
- 各阶段耗时；
- fallback 原因；
- progress event 序列摘要；
- completion / resume receipt；
- rollback 或 blocked 原因。

记录不得包含原始对话全文、secret 或敏感 capsule 内容。Capsule 只存于项目授权的本地运行时目录。

## 16. 安全要求

- 不模拟键盘输入或终端焦点；
- 不向未知宿主进程注入命令；
- 不从 PATH 猜测“同名 binary 就是当前宿主”；
- bridge 必须验证 session attachment，禁止操作其他会话；
- capsule 写入使用已有路径边界和 symlink / junction 防护；
- 进程切换与 rollback 使用不可伪造的 continuation token；
- 外部 provider 不得读取 capsule 原文，除非宿主执行合同明确需要且已授权；
- compact 日志默认脱敏。

## 17. 非目标

本设计不：

- 创建 Peaks 自己的 TUI 或 REPL；
- 保证无法提供 in-process bridge 的宿主也能同界面 compact；
- 使用终端自动化模拟 `/compact`；
- 以新窗口逻辑接续冒充同界面无感；
- 为每个 vendor 在核心添加条件分支；
- 规定具体宿主插件技术栈；
- 改变 Human-NL-Choice-Only 与 Two-Forms-Only 产品规则。

## 18. 分阶段交付建议

### Phase 1：统一控制面与诚实语义

- 定位现有 `src/services/runtime/`、`src/services/ide/` 和 `src/services/adapter/` registry 的职责重叠，建立唯一 `compact-provider-registry`；
- 建立 capability contract 和 coordinator；
- 新增可复用的 compact conformance testkit（Vitest runner + JSON evidence schema + CI certification gate）；
- 修复不存在的 CLI 与文档漂移；
- 合并重叠入口；
- 去除 `claude --compact` 强保证声明；
- 建立 attempt journal、验证和 blocked 语义。

### Phase 2：Peaks Fallback Engine

- 定义并实现 capsule；
- 预算、digest、幂等和恢复；
- progress protocol；
- 模拟 bridge 下的完整 fallback 测试。

### Phase 3：首个真实宿主 bridge

- 选择一个真正提供当前 TUI in-process 能力的宿主；
- 完成 native + fallback + progress + same-ui E2E；
- 达到 `certified-strong`。

### Phase 4：主流 AI CLI provider 扩展

- 按真实能力逐个接入；
- 复用 conformance suite；
- 不修改 compact core；
- 对能力不足的宿主诚实标记认证等级。

## 19. 验收标准

1. 项目中不存在要求 LLM 调用不存在 compact 命令的文档或运行时输出；
2. Compact core 中不存在 vendor 名称和 vendor 命令；
3. 新 provider 接入不修改 coordinator；
4. Native 和 fallback 都必须验证结果，不能以 spawn / exit 0 代替；
5. Fallback capsule 能完整恢复目标、任务、gate 和 next action；
6. 进度条位于同一宿主 TUI，阶段单调且不会提前显示 100%；
7. 强保证模式下不打开新窗口或新 runner UI；
8. 正常流程中用户无需输入 CLI、确认 compact 或补充上下文；仅连续 3 次验证失败熔断后，才按 §10.3 提供分级人工 compact 兜底；
9. Compact 后自动继续且不重复 side effect；
10. 每个宣称 `certified-strong` 的主流 AI CLI provider 都通过真实宿主 E2E；
11. 无 bridge 的宿主明确 blocked，不伪装成功；
12. Peaks-Loop 仍是宿主增强层，不成为新的 AI CLI；
13. 同一 session 连续 3 次 compact 验证失败后开启持久化熔断，停止自动重试和模型消耗；
14. 熔断后的人工 compact 优先通过自然语言多选触发 bridge，无法映射时只提示一次宿主原生操作，人工验证失败后保持 blocked。

## 20. 最终设计决策

采用“**宿主内置桥接 + Peaks Compact Protocol**”作为唯一强保证架构：

- 宿主有可观察的原生 compact：优先使用；
- 宿主无原生 compact：Peaks 生成 capsule，宿主 bridge 在同一 TUI 原地替换；
- 两条路径都提供同界面进度并进行结果验证；
- 核心完全 capability-first、vendor-neutral；
- 无法同界面执行的宿主不宣称强保证，也不静默打开新窗口。

这同时满足用户确认的两层策略、强保证、无感接续、可见进度和主流 AI CLI 适配红线。
