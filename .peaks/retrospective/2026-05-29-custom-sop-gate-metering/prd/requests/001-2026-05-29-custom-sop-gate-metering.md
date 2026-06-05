# PRD Request 2026-05-29-custom-sop-gate-metering

- session: 2026-05-29-session-746113
- type: feature (foundation A) —商业层 B 单独立项
- source: verbal — "支持使用者自己创建 SOP 的 skill，以及插槽式的 cli 门禁……free 2 / pro 6 / max 18 / ultra 不限制……让项目有收益一直维护下去"
- raw input (sanitized): 用户希望让 Peaks 的使用者能自己创建 SOP 技能（不再只能用内置 peaks-* 家族），并引入"插槽式 CLI 门禁"作为分层付费点（free=2 / pro=6 / max=18 / ultra=∞），以改善体验并让项目可持续获得收益。本 PRD 只覆盖地基 Feature A（用户自创 SOP + 门禁注册表 + 接入 mode-enforcement），商业计量 Feature B 单独立项。

## Scope split (本 PRD 的边界)

本请求拆成两个分层功能，本 PRD 只交付 **A**：

- **Feature A（本 PRD）**：用户自创 SOP 技能 + 门禁注册表（gate registry）+ 自定义门禁接入 mode-enforcement 真正阻断 transition。范围做到"范围 3"（最完整）。
- **Feature B（后续单独 PRD）**：插槽式门禁分层计量与 open-core entitlement（free=2 / pro=6 / max=18 / ultra=∞）。A 必须为 B 留好接缝（门禁是可寻址、可计数的一等对象 + 一张可枚举的注册表），但 A 不实现任何计数、限制或付费判断。

## Goals

- G1：用户能通过 CLI 定义自己的 SOP（阶段 phases + 绑定在 transition 上的门禁 gates），产物落在 `.peaks/sops/{sop-id}/`，包含结构化 manifest 和可注册的 SKILL.md。
- G2：每个门禁是一等对象，拥有 **workspace 内稳定唯一的可寻址 id**、绑定的 transition、可被 CLI 评估的 check（返回 pass/fail/blocked）。
- G3：存在一张**门禁注册表（gate registry）**，可枚举 workspace 内所有已注册的自定义门禁（这是 A 为 B 预留的计量接缝，A 只读不计费）。
- G4：自定义门禁接入现有 mode-enforcement，使其能像内置 Gate 一样在对应 transition 上真正阻断（范围 3）。
- G5：提供 init / lint / register / check 四个命令，全部支持 `--json` 和（有副作用时）`--dry-run`，输出稳定信封 `{ok,command,data,warnings,nextActions}`，为未来可视化客户端预留无需解析人话的接口。
- G6：自定义 SOP 注册后能进入 skill presence / statusline，与内置技能同等可见。

## Non-goals

- N1：**不做** Feature B 的任何计量、分层、配额限制或付费判断（free/pro/max/ultra 的数字在 A 阶段不出现在任何强制逻辑里）。
- N2：**不做**可视化客户端 / GUI（仅以"命令可被客户端调用"为设计约束守住，不实现 UI）。
- N3：**不改动**内置 peaks-* 家族的门禁、runbook 或 enforcement 行为（内置门禁永远豁免，见 Preserved behavior）。
- N4：**不做** SOP 的远程分享 / 市场 / 同步（这属于 B 之后的 open-core 能力）。
- N5：**不替 RD 拍板**门禁如何在源码层接入 mode-enforcement 的具体实现（注册表 vs 其它结构由 RD 定，见 Open questions）。
- N6：**不引入**新的运行时配置写入、hooks、agents、MCP 启用或 token 存储（严守 skill/CLI 边界）。

## Preserved behavior

这些是重构/扩展中**绝不能破坏**的现有行为，QA 必须回归验证：

- P1：内置 peaks-* 家族（prd/ui/rd/qa/sc/txt/solo）的门禁、runbook、SKILL.md 行为完全不变。内置门禁**永不被注册进自定义门禁注册表，永不被计量**。装上本功能后，纯用内置技能的用户体验零变化。
- P2：现有 mode-enforcement 行为不变 —— `full-auto`/`swarm` 跳过确认，`strict` 全拦，`assisted` 只拦 `prd:confirmed-by-user` / `rd:qa-handoff` / `qa:verdict-issued`（见 [mode-enforcement.ts:6-10](src/services/mode/mode-enforcement.ts#L6-L10)）。自定义门禁是**叠加**在这套机制上，不得改变内置 transition 的拦截结果。
- P3：现有唯一调用点 [request-artifact-service.ts:729](src/services/artifacts/request-artifact-service.ts#L729) 的 `requireUserConfirmation` 语义不变；自定义门禁的接入不得让内置 request artifact 的 transition 行为回归。
- P4：`--confirm` / `--force-confirm` / `PEAKS_AUTO_CONFIRM` / bypass 计数（每 session 上限 3，见 [bypass-tracker.ts](src/services/mode/bypass-tracker.ts)）的现有语义不变。
- P5：skill presence / statusline / `.peaks/.active-skill.json` 对内置技能的现有行为不变；自定义 SOP 进入这套机制时复用同一格式，不破坏内置技能的显示。
- P6：严守 skill/CLI 边界（[ARCHITECTURE.md:14-34](docs/ARCHITECTURE.md#L14)）—— SOP 定义只描述"该发生什么"，副作用（注册、enforcement）由 CLI 显式命令完成；不静默改 settings.json / 装 hooks / 建 agents / 开 MCP / 存 token。
- P7：覆盖率红线不变 —— 本功能涉及的重构/新增遵守现有 95%/有意义覆盖门禁。

## Acceptance criteria

QA 可逐条执行的 pass/fail 条件：

- AC1（创建）：`peaks sop init {id} --project . --json` 在 `.peaks/sops/{id}/` 生成 manifest + SKILL.md 骨架；信封 `ok:true`，`data.path` 指向落点；不带 `--apply` 时 `applied:false` 且不落盘（与现有 request init 的 preview/apply 模式一致）。
- AC2（校验通过）：对一个合法 SOP（门禁 id 唯一、transition 合法、check 可解析）运行 `peaks sop lint {id} --json` → `ok:true`，列出门禁数与各门禁 id。
- AC3（校验拦截）：对一个非法 SOP（重复门禁 id / 非法 transition / 无法解析的 check）运行 `peaks sop lint` → `ok:false` 且 `code` 为稳定错误码，`data` 指明违例门禁 id 与原因。
- AC4（注册表）：`peaks sop register {id}` 后，注册表能枚举出该 SOP 的全部门禁，每个门禁有 workspace 内唯一 id、所属 SOP、绑定 transition；内置 peaks-* 门禁**不出现**在该枚举里。
- AC5（presence）：注册后的自定义 SOP 能被 `peaks skill presence:set {sop-id}` 设为活动技能并在 statusline 显示，格式与内置技能一致。
- AC6（门禁评估）：`peaks sop check {id} --gate {gate-id} --json` 对 pass 条件返回 `data.result:"pass"`，对 fail 条件返回 `"fail"`，对无法评估（依赖缺失等）返回 `"blocked"`，三态均 `ok:true`（评估成功），评估器本身出错才 `ok:false`。
- AC7（范围 3 阻断）：当一个自定义 SOP 的门禁绑定在某 transition 且该门禁为 fail/blocked 时，在需要确认的模式下推进该 transition 会被**真正阻断**（抛出与现有 `ConfirmationRequiredError` 同族的、可被 CLI 捕获并转成稳定错误码的错误），与内置 Gate 的阻断体验一致。
- AC8（内置零回归）：在**未**定义任何自定义 SOP 的 workspace 里，内置 7 技能的所有现有行为（presence、enforcement、request transition、bypass）与本功能引入前完全一致（回归测试 + 现有测试全绿）。
- AC9（信封一致性）：A 阶段新增的每个命令都返回 `{ok,command,data,warnings,nextActions}`，有副作用的命令支持 `--dry-run` 预览且预览不落盘。
- AC10（B 接缝就位但未启用）：门禁注册表可被程序化枚举计数，但 A 阶段**没有任何**基于该计数的限制、警告或付费分支（grep 不到 free/pro/max/ultra 阈值逻辑）。

## Risks and open questions

**待 RD 确认的实现问题（PRD 不替 RD 拍板）：**

- OQ1（核心架构，已定方向待 RD 设计）：自定义门禁接入 mode-enforcement 的方式采用 **(a) 门禁注册表**——自定义门禁注册进一张表，mode-enforcement 运行时从表里动态查并叠加判断。用户已拍板走 (a) 且范围做到 3。RD 负责设计这张表的存储位置、schema、与现有硬编码 `ASSISTED_CONFIRM_TRANSITIONS` 的合并逻辑，以及如何在不回归 P2/P3 的前提下注入。
- OQ2：注册表的持久化位置（`.peaks/sops/registry.json`？workspace 级单文件 vs 每 SOP 自描述后聚合）——影响 B 阶段"按 workspace 数门禁总数"的计量主体一致性。
- OQ3：门禁 check 的可执行类型边界。MVP 建议 `command` / `file-exists` / `grep` 三类（对齐现有 Gate A/B 的 ls/grep 风格）；`command` 类型需要沙箱/白名单以防任意命令执行风险（安全 review 必查）。
- OQ4：自定义 SOP 的 id 命名空间如何与内置 peaks-* 隔离，避免用户注册一个叫 `peaks-rd` 的 SOP 覆盖内置技能（presence/registry 都要防冲突）。
- OQ5：自定义 transition 的命名规范。内置是 `role:state`；自定义 SOP 的 phases 是用户自定义的，transition key 形态需 RD 与 mode-enforcement 的 `TransitionKey` 类型对齐。

**风险：**

- R1（安全）：`command` 类型门禁 = 用户定义的 shell 命令被 CLI 执行。必须有授权/白名单机制，且 SOP 来源若未来可分享（B 之后），这是供应链风险点。安全 review 必须覆盖。
- R2（收益本质）：A 本身不产生收益；收益完全依赖 B 的 open-core entitlement。A 要避免把任何"假装在计费"的客户端逻辑写进来（那既无收益又被 fork 即破）。本 PRD 已用 N1/AC10 把这条钉死。
- R3（计量主体）：B 的计量主体定为 workspace/账号而非项目（否则建新 repo 即重置）。A 的注册表设计若按项目存储，B 阶段需聚合——OQ2 需提前考虑。
- R4（free 数值调参）：free=2 若指"全局总共 2 个门禁"可能太紧、用户尝不到"流程不可跳过"的甜点而影响转化。属 B 阶段数值调参，不阻塞 A。
- R5（范围 3 的回归面）：动态注入 mode-enforcement 是改动现有拦截核心，P2/P3/P8 回归面较大，QA 需重点保护现有 enforcement 测试。

## Handoff

- to peaks-rd: .peaks/2026-05-29-session-746113/rd/requests/2026-05-29-custom-sop-gate-metering.md
  - 交接内容：Feature A 范围（做到范围 3）、四命令契约（G5/AC9）、注册表接缝（OQ1/OQ2）、mode-enforcement 单一接入点 [request-artifact-service.ts:729](src/services/artifacts/request-artifact-service.ts#L729)、内置零回归红线（P1/P2/P3/AC8）、安全约束（OQ3/R1）。RD 拥有 OQ1-OQ5 的实现决策与标准 dry-run 应用。
- to peaks-qa: .peaks/2026-05-29-session-746113/qa/requests/2026-05-29-custom-sop-gate-metering.md
  - 交接内容：AC1-AC10 逐条验收、Preserved behavior P1-P7 回归矩阵、enforcement 现有测试基线、`command` 门禁安全用例、AC10 的"无计费逻辑"反向断言。
- to peaks-ui: 不涉及（N2，无 UI）。

## Status

- created: 2026-05-29T12:49:48.720Z
- last update: 2026-05-29T13:40:53.833Z
- state: handed-off
- 说明：待用户确认本 PRD 后，state 改为 `confirmed-by-user` 方可交接 RD/QA（PRD Gate B）。

- transition note (2026-05-29T13:00:52.671Z): User confirmed PRD scope (Feature A only, range 3, gate registry, built-in gates exempt, open-core, no billing logic in A) in brainstorm session