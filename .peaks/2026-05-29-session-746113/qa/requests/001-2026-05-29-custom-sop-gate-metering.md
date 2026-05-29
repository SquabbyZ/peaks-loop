# QA Request 2026-05-29-custom-sop-gate-metering

- session: 2026-05-29-session-746113
- linked-prd: .peaks/2026-05-29-session-746113/prd/requests/2026-05-29-custom-sop-gate-metering.md
- linked-rd:  .peaks/2026-05-29-session-746113/rd/requests/2026-05-29-custom-sop-gate-metering.md
- linked-ui:  .peaks/2026-05-29-session-746113/ui/requests/2026-05-29-custom-sop-gate-metering.md  (when UI involved)
- type: feature

## Red-line boundary check

- in-scope changes seen in the diff (match PRD + RD scope)
- out-of-scope changes flagged (any extra file, route, mock, fixture, behavior)
- verdict: clean | boundary-violation

## OpenSpec exit gate (when openspec/ exists)

- change-id: <id>
- peaks openspec validate <id> data.valid: true | false
- issues: ...

## Acceptance checks

> 本段由 peaks-prd seed（验收标准 PROD 拥有）。check method/result/evidence 由 peaks-qa 在实现后填。
> 源 PRD（confirmed-by-user）：.peaks/2026-05-29-session-746113/prd/requests/001-2026-05-29-custom-sop-gate-metering.md

- AC1（创建）：`peaks sop init {id} --json` 落 `.peaks/sops/{id}/` manifest+SKILL.md；不带 `--apply` 时 `applied:false` 不落盘。
- AC2（lint 通过）：合法 SOP `peaks sop lint {id} --json` → `ok:true`，列门禁数+各 id。
- AC3（lint 拦截）：非法 SOP（重复 id / 非法 transition / 无法解析 check）→ `ok:false` + 稳定 `code` + 违例 id/原因。
- AC4（注册表）：`peaks sop register {id}` 后注册表枚举出全部门禁，各有唯一 id/所属 SOP/transition；**内置 peaks-* 门禁不出现**。
- AC5（presence）：注册的 SOP 能 `presence:set` 并在 statusline 显示，格式同内置技能。
- AC6（门禁评估）：`peaks sop check {id} --gate {gid} --json` 三态 pass/fail/blocked 均 `ok:true`，评估器自身出错才 `ok:false`。
- AC7（范围 3 阻断）：门禁 fail/blocked 时在需确认模式推进绑定 transition 被真正阻断（同族 `ConfirmationRequiredError`，CLI 可捕获转稳定 code）。
- AC8（内置零回归）：无任何自定义 SOP 的 workspace，内置 7 技能 presence/enforcement/transition/bypass 全一致 + 现有测试全绿。
- AC9（信封一致性）：每个新命令返回 `{ok,command,data,warnings,nextActions}`，有副作用支持 `--dry-run` 且预览不落盘。
- AC10（反向断言）：注册表可程序化计数，但 grep 不到任何基于计数的 free/pro/max/ultra 限制/警告/付费分支。

## Mandatory validation gates

- unit tests: command + pass/fail + coverage delta
- API validation (when applicable): request paths exercised, evidence
- browser E2E (when frontend): N/A（PRD N2 无 UI）
- browser-error feedback loop: N/A
- security check: **必查项** —— OQ3/R1 的 `command` 类型门禁任意命令执行风险（沙箱/白名单），SOP 来源未来可分享的供应链风险
- performance check: tool used, baseline vs after numbers when available
- validation report path

## Regression matrix

> 本段 seed 自 PRD Preserved behavior P1-P7（保持不变的行为 PROD 拥有）。pass/fail 由 peaks-qa 填。

- P1：内置 peaks-* 家族门禁/runbook/SKILL.md 行为不变；内置门禁不进注册表/不计量 → [ ]
- P2：mode-enforcement 四模式行为不变（full-auto/swarm 跳过、strict 全拦、assisted 只拦三条内置 transition）→ [ ]
- P3：[request-artifact-service.ts:729](src/services/artifacts/request-artifact-service.ts#L729) `requireUserConfirmation` 语义不变 → [ ]
- P4：`--confirm` / `--force-confirm` / `PEAKS_AUTO_CONFIRM` / bypass 计数（上限 3）语义不变 → [ ]
- P5：skill presence / statusline / `.active-skill.json` 内置技能行为不变 → [ ]
- P6：skill/CLI 边界不破（无静默改 settings/hooks/agents/MCP/token）→ [ ]
- P7：95%/有意义覆盖门禁不变 → [ ]
- 现有 enforcement 测试基线全绿（R5 回归重点保护面）→ [ ]

## Browser evidence

- sanitized observations only — no login URLs, cookies, headers, tokens, storage state, browser traces, or screenshots/logs with PII / SSO / MFA material

## Verdict

- overall: pass | return-to-rd | blocked

## Status

- created: 2026-05-29T13:03:05.700Z
- last update: 2026-05-29T13:03:05.700Z
- state: draft
