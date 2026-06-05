# RD Request 2026-05-29-custom-sop-gate-metering

- session: 2026-05-29-session-746113
- linked-prd: .peaks/2026-05-29-session-746113/prd/requests/2026-05-29-custom-sop-gate-metering.md
- linked-ui:  .peaks/2026-05-29-session-746113/ui/requests/2026-05-29-custom-sop-gate-metering.md  (when UI involved)
- type: feature

## Red-line scope

> 本段由 peaks-prd 从已确认 PRD 翻译为工程边界（产品侧输入）。其余技术段（标准预检、覆盖率、切片、实现证据、OQ 拍板）由 peaks-rd 拥有。
> 源 PRD（已 confirmed-by-user）：.peaks/2026-05-29-session-746113/prd/requests/001-2026-05-29-custom-sop-gate-metering.md

**In-scope（A 阶段允许新增/改动）：**
- 新增 `peaks sop` 命令族：init / lint / register / check（四命令契约见 PRD G5/AC9，全部 `--json` + 有副作用支持 `--dry-run` + 稳定信封）。
- 新增自定义 SOP 产物形态 `.peaks/sops/{sop-id}/`（结构化 manifest + 可注册 SKILL.md）。
- 新增**门禁注册表**（gate registry，OQ2 定位置/schema），可枚举 workspace 内自定义门禁。
- 改动 mode-enforcement 使其能从注册表动态读取自定义门禁并叠加阻断（范围 3，单一接入点 [request-artifact-service.ts:729](src/services/artifacts/request-artifact-service.ts#L729)）。

**Out-of-scope（禁止改动/新增）：**
- 内置 peaks-* 家族（prd/ui/rd/qa/sc/txt/solo）的门禁、runbook、SKILL.md、enforcement 行为 —— 内置门禁永不进注册表、永不计量（PRD P1/N3）。
- 现有 `ASSISTED_CONFIRM_TRANSITIONS` 三条内置 transition 的拦截结果（PRD P2）。
- 任何 Feature B 计量/分层/配额/付费逻辑 —— grep 不到 free/pro/max/ultra 阈值（PRD N1/AC10）。
- settings.json / hooks / agents / MCP / token 的静默写入（PRD P6/N6）。

**RD 拥有的开放问题（PRD 不替 RD 拍板，见源 PRD Risks & open questions）：**
- OQ1：注册表如何注入 mode-enforcement 且不回归 P2/P3（方向已定 = 门禁注册表，范围 3）。
- OQ2：注册表持久化位置与计量主体一致性（影响 B 按 workspace 计数）。
- OQ3 + R1：门禁 check 可执行类型（建议 command / file-exists / grep）；`command` 类型的沙箱/白名单（安全 review 必查）。
- OQ4：自定义 SOP id 与内置 peaks-* 命名空间隔离防冲突。
- OQ5：自定义 transition key 形态与 `TransitionKey` 类型对齐。

## Standards preflight

- peaks standards init/update --project <path> --dry-run output paths and status
- planned application: apply | review-only | blocked

## OpenSpec linkage (when openspec/ exists)

- change-id: <openspec change id>
- entry validate: peaks openspec validate <change-id> data.valid status
- to-rd projection: peaks openspec to-rd <change-id> artifact path
- exit validate (after implementation): status

## Coverage status

- current total UT coverage: <percent>
- new/changed code coverage: <percent>
- gate verdict: pass | legacy-accepted | blocked

## Slice contract

- slice id, functional boundary, pre-refactor behavior, target structure, unit-test requirements, acceptance checks, rollback plan, commit boundary

## Implementation evidence

- diff paths, test commands + outputs, code review findings + fixes, security review findings + fixes, dry-run output

## MCP usage (when external docs lookup was used)

- capabilityId / tool / sanitized args
- artifact path of stored result
- no secrets, no full network bodies

## Handoff

- to peaks-qa: .peaks/2026-05-29-session-746113/qa/requests/2026-05-29-custom-sop-gate-metering.md
- to peaks-sc: .peaks/2026-05-29-session-746113/sc/commit-boundaries/2026-05-29-custom-sop-gate-metering.md

## Status

- created: 2026-05-29T13:01:56.749Z
- last update: 2026-05-29T13:01:56.749Z
- state: draft
