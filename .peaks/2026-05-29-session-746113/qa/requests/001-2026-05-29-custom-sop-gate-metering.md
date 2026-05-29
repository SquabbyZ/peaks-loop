# QA Request 2026-05-29-custom-sop-gate-metering

- session: 2026-05-29-session-746113
- linked-prd: .peaks/2026-05-29-session-746113/prd/requests/2026-05-29-custom-sop-gate-metering.md
- linked-rd:  .peaks/2026-05-29-session-746113/rd/requests/2026-05-29-custom-sop-gate-metering.md
- linked-ui:  .peaks/2026-05-29-session-746113/ui/requests/2026-05-29-custom-sop-gate-metering.md  (when UI involved)
- type: feature

## Red-line boundary check

- in-scope changes seen in the diff: 新增 `src/services/sop/*`（types/service/registry/check/advance）、`src/cli/commands/sop-commands.ts`、`src/cli/program.ts` 注册、`schemas/sop-manifest.schema.json` + 对应测试 —— 全部落在 RD red-line scope 的 in-scope 内。
- bug 修复改动（prereq 前缀 / type-sanity / lint / bypass-session / cwd-presence）属本会话先行修复，已单独提交，不在 Feature A diff 内。
- out-of-scope changes flagged: 无。未触碰内置 peaks-* 技能门禁/runbook、未改 `ASSISTED_CONFIRM_TRANSITIONS`、未碰 request artifact transition 核心。
- verdict: **clean**

## OpenSpec exit gate (when openspec/ exists)

- N/A —— 本 Feature A 未走 openspec change 流程（无对应 change-id）。

## Acceptance checks

> check method/result/evidence 由 peaks-qa 填（2026-05-29 实现后验证）。
> 源 PRD（confirmed-by-user）：.peaks/2026-05-29-session-746113/prd/requests/001-2026-05-29-custom-sop-gate-metering.md

- AC1（创建）→ **pass**。证据：`sop-commands.test.ts` "previews without writing"（preview 不落盘 `applied:false`）+ "writes the SOP when --apply"；dogfood：preview 不落盘、`--apply` 落 manifest+SKILL.md。
- AC2（lint 通过）→ **pass**。证据：`sop-service.test.ts` "reports a valid manifest as ok with gate metadata"（`ok:true`，返回 gateCount+gateIds）+ CLI "passes for a freshly scaffolded SOP"。
- AC3（lint 拦截）→ **pass**。证据：`sop-service.test.ts` 覆盖 INVALID_JSON / DUPLICATE_GATE_ID / GATE_PHASE_UNKNOWN / EMPTY_PHASES / DUPLICATE_PHASE / INVALID_CHECK_TYPE / CHECK_MISSING_FIELD / RESERVED_ID / ID_MISMATCH 共 9 类稳定 code；CLI "fails with SOP_LINT_FAILED and exit 1"。
- AC4（注册表）→ **pass**。证据：`sop-registry-service.test.ts` "enumerates gates with workspace-unique refs"（ref=`<sop>/<gate>`、transition=`<sop>:<phase>`）+ "built-in peaks-* gates never appear" + "pools gateCount across SOPs"。
- AC5（presence）→ **pass**。证据：statusline renderer 直接用 `presence.skill`（不校验内置注册表），自定义 SOP id 零改动即可 `presence:set` 并渲染；dogfood：`⛰ Peaks ● demo-rel · assisted · gate:review`。
- AC6（门禁评估）→ **pass**。证据：`sop-check-service.test.ts` 三类 check × pass/fail/blocked（含路径逃逸→blocked、坏正则→blocked、命令超时/spawn 失败→blocked、空 run→blocked），均 `ok:true`；SOP/gate 缺失才抛 SOP_NOT_FOUND/GATE_NOT_FOUND。
- AC7（范围 3 阻断）→ **pass（实现偏差已记录见下）**。证据：`sop-advance-service.test.ts` "blocks (throws SopGateBlockedError) when a guarding gate fails"（且阻断时**不写 state**）+ CLI "advancing into a phase with a failing gate is blocked (SOP_GATE_BLOCKED, exit 1)"。
- AC8（内置零回归）→ **pass**。证据：`mode-enforcement` / `request-commands` / `request-transition-service` / `artifact-prerequisites-typed` / `skill-presence-service` 共 106 测试全绿；全量 1560 通过（仅 2 个 Windows symlink EPERM 环境性失败，与本功能无关）。
- AC9（信封一致性）→ **pass**。证据：六命令均 `{ok,command,data,warnings,nextActions}`；有副作用的 init（preview/apply）、register（`--dry-run`）、advance（`--dry-run`）均支持预览且不落盘——`sop-commands.test.ts` "register --dry-run previews without writing" + "advance --dry-run previews ... without recording state"。
- AC10（反向断言）→ **pass**。证据：`sop-registry-service.test.ts` "no free/pro/max/ultra threshold logic"（剥离注释后 grep 不到 tier/entitlement/quota/paywall）。

## Mandatory validation gates

- unit tests: **71 SOP 测试全绿**（service 17 / registry 11 / check 12 / advance 12 / commands 19，含 dry-run + 边界）；全量 **1560 通过**。
- API validation: N/A（无 HTTP）。
- browser E2E: N/A（PRD N2 无 UI）。
- browser-error feedback loop: N/A。
- security check（**必查项 OQ3/R1**）→ **pass**：`command` 门禁经 code-reviewer 审查，确认 (1) `execFileSync` argv 数组、无 shell（无注入面），(2) 强制 timeout，(3) cwd 锁定项目根，(4) 默认拒绝、须显式 `--allow-commands`，(5) file-exists/grep 路径经 `isInsidePath` 锁在项目根内（逃逸→blocked）。**残留风险（已记录、非阻断）**：命令可执行文件本身不沙箱（信任边界=SOP 作者，等同 npm scripts/Makefile）；grep 用用户正则跑整文件无超时（轻微 ReDoS，同用户同机项目内文件，低风险）。
- performance check: N/A（无热路径；命令门禁有 30s 超时上限）。
- validation report path: 本文件。

## Regression matrix

- P1（内置门禁/runbook/SKILL.md 不变；内置门禁不进注册表）→ **pass**。`registerSop` 只读 `.peaks/sops/`，从不枚举内置技能；专项测试 "built-in peaks-* gates never appear"。
- P2（mode-enforcement 四模式不变）→ **pass**。`sop advance` 是独立命令路径，不改 `ASSISTED_CONFIRM_TRANSITIONS`；`mode-enforcement.test.ts` 全绿。
- P3（`requireUserConfirmation` 语义不变）→ **pass**。未改 request-artifact transition 核心；`request-transition-service.test.ts` 全绿。
- P4（`--confirm`/`--force-confirm`/`PEAKS_AUTO_CONFIRM`/bypass 计数语义不变）→ **pass**。`sop advance` 复用 `bypass-tracker` 同一常量与语义（per-SOP 目录计数）；`request-commands.test.ts` 全绿。
- P5（presence/statusline/.active-skill.json 内置行为不变）→ **pass**。复用同一格式，未改 renderer；cwd→project 修复有回归测试且使内置测试更稳。
- P6（skill/CLI 边界不破）→ **pass**。SOP 副作用仅落 `.peaks/sops/`，无 settings/hooks/agents/MCP/token 写入。
- P7（95%/有意义覆盖门禁不变）→ **pass**。覆盖率门禁通过，无 padding 测试。
- 现有 enforcement 测试基线（R5 重点保护面）→ **pass**。106 条内置 enforcement/transition/presence 测试全绿。

## Deviation notes

- **AC7 措辞**：PRD 原文设想门禁阻断抛"同族 `ConfirmationRequiredError`"。实现采用**独立的 `SopGateBlockedError`（code `SOP_GATE_BLOCKED`）经 `sop advance` 命令**，而非复用内置确认错误。这是 RD 的有意决策（OQ1 范围 3）：独立命令路径避免改动内置 enforcement 核心，从而保住 P2/P3 零回归。阻断的**行为效果**与 AC7 完全一致（fail/blocked 门禁真正拦截推进 + 可捕获转稳定 code + 显式 bypass 出口），仅错误类名不同。判定为符合 AC7 意图。

## Browser evidence

- N/A（无 UI / 无浏览器交互）。

## Verdict

- overall: **pass**
- 说明：Feature A（用户自创 SOP + 门禁注册表 + 范围 3 阻断）AC1-AC10 全部满足，P1-P7 保持不变的行为全部回归通过，安全必查项通过（残留风险已记录、非阻断）。AC9 在验收期补齐了 register/advance 的 `--dry-run`（原实现缺失，已修复+测试+dogfood）。可进入文档收尾。

## Status

- created: 2026-05-29T13:03:05.700Z
- last update: 2026-05-29T13:03:05.700Z
- state: verdict-issued
- verdict note: pass —— Feature A 全部 AC/P 通过，验收期补齐 AC9 dry-run；进入文档收尾。
