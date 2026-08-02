---
name: 2026-08-02-ice-cola-dogfood-surface-probe
description: peaks-loop 4.0.6 在 ice-cola (downstream monorepo) 真实项目上的全 CLI surface 探测结果,25 个 bug 候选,4.0.7 修复 input
metadata:
  type: feedback
---

# peaks-loop 4.0.6 ice-cola dogfood surface probe (2026-08-02)

> **Where:** 在 `C:\Users\smallMark\Desktop\peaksclaw\ice-cola` (peaks-loop 下游 monorepo: admin/server/client/hermes-agent 4 子包) 上跑 peaks-loop 4.0.6 的核心 CLI surface。
> **Why:** 用户要求"测下 peaks-loop 的整体功能,冰茶随便改,目的是帮 peaks-loop 发现问题"。
> **Mode:** 24h-mode ACTIVE (sessionId `2026-08-02-session-b3a54b`);决定 isJob=false (一次性 CLI tour,不是 sliced job)。
> **How to apply:** 这 25 个候选 bug 是 4.0.7 的 high-priority 修复 input。优先级 = (1) catalog/implementation drift (88 finding), (2) session-resolver 系统性 bug (4 CLI), (3) documentation drift (3 CLI), (4) UX 体验 bug。

## Critical findings (P0 — 必修,4.0.7 ship-blocker)

### Finding #1: red-line-catalog.ts 引用 26 个不存在的 enforcer 文件 (88 enforcerFindings)

- **Repro:** `cd ice-cola && peaks audit red-lines --project . --json`
- **实际:** peaks-loop 自己的 `src/services/audit/red-line-catalog.ts` 引用 26 个 `src/services/audit/enforcers/*.ts` 文件,**但 0 个文件存在**。
- **影响:** 全部 88 个 enforcerFindings 都是 `severity: warn` 但其实是 fail — catalog 是 prose-only 红线的"声称实现",但实际只写了一个 catalog 文件没写 enforcer 实现。
- **Data:**
  ```
  Total findings: 88
  Unique enforcerRef entries: 87
  Unique missing files: 26
  ```
- **Missing files (按文件聚合):**
  ```
  src/services/audit/enforcers/code-ban.ts
  src/services/audit/enforcers/no-root-pollution.ts
  src/services/audit/enforcers/sub-agent-sid.ts
  src/services/audit/enforcers/mock-placement.ts
  src/services/audit/enforcers/resume-detection.ts
  src/services/audit/enforcers/prototype-fidelity.ts
  src/services/audit/enforcers/design-draft-confirm.ts
  src/services/audit/enforcers/pre-rd-scan.ts
  src/services/audit/enforcers/login-gate.ts
  src/services/audit/enforcers/lint-style.ts
  src/services/audit/enforcers/lint-output-style.ts
  src/services/audit/enforcers/lint-cli-back.ts
  src/services/audit/enforcers/lint-reference-integrity.ts
  src/services/audit/enforcers/lint-workflow-shape.ts
  src/services/audit/enforcers/lint-catalog-governance.ts
  src/services/audit/enforcers/lint-skill-presence-mandatory.ts
  src/services/audit/enforcers/lint-prd-source-snapshot.ts
  src/services/audit/enforcers/lint-prd-artifact-handoff.ts
  src/services/audit/enforcers/lint-rd-handoff-coverage.ts
  src/services/audit/enforcers/lint-qa-gateguard-and-runtime.ts
  src/services/audit/enforcers/lint-peaks-ui-sc-txt-runtime.ts
  src/services/audit/enforcers/lint-bee-runtime-contract.ts
  src/services/audit/enforcers/lint-peaks-code-runtime.ts
  src/services/audit/enforcers/lint-peaks-skill-runtime.ts
  src/services/audit/enforcers/lint-reference-shape.ts
  src/services/audit/enforcers/lint-audit-regression.ts
  ```
- **修复路径:** 4 个选项
  - (A) **Implement all 26 enforcers** (最对路,但耗 ~26 slice)
  - (B) **Prune catalog** to only enforcers that exist (删 26 个 catalog 条目,降低 catalog 红线声称)
  - (C) **Stub enforcers** with `return { ok: true, severity: 'info' }` 当 placeholder
  - (D) **Mark catalog as "aspirational"** in catalog header + enforcer file path becomes optional with --no-enforce

### Finding #2: session-resolver 在 `peaks code` 子命令族系统性失效 (4 CLI)

- **Repro A:** `cd ice-cola && peaks code detect-job --is-job false --rationale "x" --suggested-job-id n-a`
  → `NO_ACTIVE_SESSION: no --session-id and no canonical binding`
- **Repro B:** `cd ice-cola && peaks code read-job-shape --json` (binding 存在)
  → 同 NO_ACTIVE_SESSION
- **Repro C:** `cd ice-cola && peaks workflow plan read --type security --project .`
  → NO_ACTIVE_SESSION
- **Repro D:** `cd ice-cola && peaks route --mode code --goal "x" --code-mode full-auto --dry-run --json`
  → `sessionId: ""` (空字符串,不是 NO_ACTIVE_SESSION 但等价)
- **根因:** `peaks code *` / `peaks workflow plan read` / `peaks route` 不读 `.peaks/_runtime/session.json` binding,而 `peaks session list` 和 `peaks session info --active` **能正确读**。这说明 session-resolver **只对 `peaks session *` 子命令生效**,对 `peaks code/workflow/route` 都漏了。
- **修复路径:** 在 `src/services/session/resolver.ts`(推测)导出 shared resolver,让所有 `peaks code/workflow/route/audit` 走同一路径。`peaks session info --active` 是 reference impl。

## High-priority findings (P1 — 应修,4.0.7 second-batch)

### Finding #3: 24h-mode 与 code should-pause 互斥 (stale-presence 假阳性)

- **Repro:** `cd ice-cola && peaks session 24h-mode transition --state 24H_ACTIVE` (成功) → `peaks code should-pause --step step-1-mode-select --json` → `stale-presence: no-presence; shouldPause: true; reason: stale-presence`
- **根因:** 24h-mode 通过 `peaks session 24h-mode transition` 写 `.peaks/_runtime/<sid>/24h-state.json`,但 `code should-pause` 检查的是 `peaks skill presence` (`.peaks/.active-skill.json`),两者无联动。
- **影响:** 任何 24h-mode 会话(不需要设 presence,因为不需要 sub-skill 切换)在 should-pause 上都会被假阳性拦下,要求"re-ask Step 1"。**24h-mode 不能用 + should-pause 互斥**。
- **修复路径:** `code should-pause` 应在判定 stale 之前先读 24h-state.json,若 state=24H_ACTIVE 则 skip stale-presence check。

### Finding #4: SKILL.md Drift Index D-001 与 4.0.6 CLI 反向

- **SKILL.md 写:** D-001 "`peaks code detect-job --is-job ...` rejected with `error: unknown option '--is-job'`. Fix: Use `peaks job init --job-id <jid> --slice-list <list>`"
- **实际 4.0.6:** `peaks code detect-job --help` 明确说 `--is-job <bool>` is **required**;CLI 拒绝无 `--is-job` 报 `required option '--is-job <bool>' not specified`。
- **影响:** SKILL.md 在错误地引导 LLM 走 `peaks job init` 替代 detect-job,而 CLI 实际需要 `--is-job`。
- **修复路径:** 重写 D-001 行为:4.0.6 `peaks code detect-job` 接受 `--is-job <bool>`,CLI 是 mandatory input,LLM 需明确给 verdict。

### Finding #5: 文档说 `peaks context-now` 可无 `--project`,实际 CLI 强制要

- **SKILL.md 写:** "`peaks code context-now --json` (无 --project)"
- **实际:** `peaks code context-now --json` → `error: required option '--project <path>' not specified`
- **影响:** SKILL.md Step N+2 全部 canonical 范例都会失败。
- **修复路径:** CLI 允许 `--project` 默认 cwd,或 SKILL.md 改用 `--project .`。

## Medium-priority findings (P2 — 修,4.0.7 nice-to-have)

### Finding #6: scan archetype monorepo 识别不完整

- **Repro:** `peaks scan archetype --project . --json` 在 ice-cola
- **报:** `archetype: fullstack-monorepo`,但 `hasBackendFramework: false, backendFrameworks: []`
- **问题:** backend = NestJS 但没识别 (server/ 在 packages/server 实际有 nest-cli.json / nest start)
- **修复:** scan libraries 应深入子包 package.json,不能只看 root

### Finding #7: scan existing-system visualTokens 空 + componentNaming unknown

- **Repro:** `peaks scan existing-system --project .`
- **报:** `visualTokens: { colors: [], spacing: [], typography: [], radii: [], sources: [] }`,`componentNaming: "unknown"`
- **问题:** ice-cola admin 是 React + Vite + (推测) Tailwind/antd,应该有 tokens 但扫不到
- **根因:** 扫 root package.json 不递归 packages/*/tailwind.config.* / tokens.css

### Finding #8: sub-agent dispatch prompt 硬编码 `0.0% used (100.0% free)` 占位符

- **Repro:** `peaks sub-agent dispatch rd --prompt "echo hi" --request-id x --json`
- **prompt 内嵌:** `"Your context is 0.0% used (100.0% free) as measured by the IDE adapter's token-counted statusline (source: conservative-fallback, IDE: claude-code)"`
- **问题:** 这是 hard-coded placeholder,不会真去查 context-now,会让 sub-agent 永远认为 context 是 0%。
- **修复:** dispatch CLI 应在生成 prompt 前调用 `peaks code context-now --json` 替换占位符

### Finding #9: sub-agent dispatch prompt 不适配 monorepo

- **Repro:** 同上
- **prompt 内嵌:** `Before running any test, read package.json#scripts.test` + "vitest → ... ; jest → ... ; mocha → ..."
- **问题:** ice-cola 根 package.json 的 `test` 是 `pnpm -r test`(monorepo recursive);模板没适配 monorepo,sub-agent 会误以为根 package.json#test 是单一 runner。
- **修复:** dispatch prompt 模板增加 monorepo 分支:若根 `workspaces` 存在,提示子包独立跑 + pnpm -r

### Finding #10: slice check 不适配 monorepo typecheck

- **Repro:** `peaks slice check --rid x --project . --skip-tests --json`
- **报:** `typecheck: { status: "fail", durationMs: 2, detail: "tsc exited with code 1", data: { exitCode: 1 } }`
- **问题:**
  - ice-cola 根没 `tsconfig.json`,只有 `tsconfig.base.json`,子包各自 `tsconfig.json`
  - typecheck 跑的是 root 级别 tsc,2ms 太快实际是 fallback default
  - `detail` 没指明跑了哪个 tsc / 哪个 tsconfig
  - monorepo 模式应跑 `pnpm -r typecheck` 或 `pnpm -r --parallel exec tsc --noEmit`
- **修复:** slice check typecheck 阶段:detect `pnpm-workspace.yaml` → 切到 `pnpm -r --parallel exec tsc --noEmit`;或 per-subpackage tsc;detail 透传 stderr tail

### Finding #11: workspace init "alreadyExisted" 误报

- **Repro:** 首次 `peaks workspace init --project .` 在空目录
- **报:** `created: [], alreadyExisted: ["."], claudeSettings.action: "already-current"`
- **问题:** 实际 `.peaks/_runtime/<sid>/` 是刚创建的,但 `created: []` 暗示什么都没建;`alreadyExisted: ["."]` + `claudeSettings.action: "already-current"` 在首次 init 应该是 `created`。
- **根因:** 检测逻辑把"project root 存在"当 "workspace 存在",**这俩不是同一回事**。
- **修复:** check `.peaks/_runtime/<sid>/session.json` 真存在再算 "alreadyExisted"

### Finding #12: standardsMissing language 判错

- **Repro:** `peaks workspace init` → `standardsMissing: { language: "javascript" }`
- **实际 ice-cola:** 99% TypeScript (packages/server 是 NestJS TS, admin 是 React+TS)
- **根因:** language detection 看的是 root package.json#devDependencies,看到 peaks-loop 自己有 `javascript/coding-style.md` 就判 JS。
- **修复:** 递归 packages/*/package.json#devDependencies,TypeScript 优先;或看 root tsconfig.* 存在 → TS

### Finding #13: audit CLI 缺 --project fallback

- **Repro:** `peaks audit red-lines` (无 --project) → `required option '--project <path>' not specified`
- **SKILL.md 范例:** `peaks audit red-lines` (无 --project,假设 cwd)
- **修复:** audit 子命令族应支持 `findProjectRoot(cwd)` 默认值

### Finding #14: `peaks capability status` 不接受 --project

- **Repro:** `peaks capability status --project .` → `error: unknown option '--project'`
- **同类:** `peaks doctor` / `peaks user-touchpoints` 都接受 --project,但 capability 不接受。
- **修复:** capability subcommand 增加 --project 一致性

### Finding #15: peaks workflow plan read --type 必填但 help 没说

- **Repro:** `peaks workflow plan read --project .` → `required option '--type <type>' not specified`
- **help 文本:** "Read the project-level plan envelope (exists, path, hash, refreshedAt)" — 没提示 type 必填
- **修复:** help 文本加 `--type` 标记为 required

### Finding #16: peaks route 返回 sessionId: ""

- **Repro:** `peaks route --mode code --goal "x" --code-mode full-auto --dry-run --json`
- **报:** `sessionId: ""` (空字符串)
- **修复:** route 应读 canonical binding,若失败 → NO_ACTIVE_SESSION 而不是 ""

### Finding #17: route model 引用过期 `claude-opus-4-7`

- **Repro:** peaks route modelRouting.strongestModel.modelId = "claude-opus-4-7"
- **实际当前:** Claude Opus 5 (1M context) 已是 2026 default
- **修复:** route 模型的 model id 列表应从配置读,不在代码硬编码

### Finding #18: peaks session checkpoint --reason 枚举文档缺位

- **CLI 接受:** context-fill, periodic, artifact-written, user-pause, user-close
- **SKILL.md 提:** "checkpoint write a JSON snapshot" 但不列枚举
- **修复:** SKILL.md Runbook Step 加完整 enum list

### Finding #19: workspace init standardsMissing warning 触发但 language 错

- **Repro:** 见 #12 — language 判成 javascript 而 ice-cola 是 typescript
- **影响:** 后续 `peaks standards init --apply` 会把 javascript 模板套到 TS 项目
- **修复:** 见 #12

### Finding #20: peaks make / peaks ask router 不够聪明

- **Repro:** `peaks make "ice-cola dogfood surface probe"` → confidence=0.25, rationale="No route keyword matched; default candidate"
- **问题:** "ice-cola dogfood" 实际是 peaks-issue-fix-orchestrator 类但 router 没匹配
- **修复:** router 关键词增加 monorepo/dogfood/probe/surface/test 关键词命中 peaks-issue-fix-orchestrator 或 peaks-doctor

### Finding #21: sub-agent dispatch 不发 rd/qa 之前需要已 apply PRD

- **Repro:** `peaks sub-agent dispatch rd --prompt "x" --request-id x` 在 PRD 未 apply 时 → 仍成功生成 dispatchRecord,但下游 rd/qa 没 artifact 可读。
- **修复:** dispatch 应 enforce `peaks request show <rid>` 存在 + state ≠ draft

### Finding #22: peaks context-now 子命令缺失

- **SKILL.md Step N+2 范例:** `peaks code context-now --json`
- **实际:** peaks 顶层是 `peaks code context-now --json`,但 SKILL.md 还有处说 `peaks context check` (deprecated)。需要统一入口。
- **修复:** SKILL.md 删除所有 `peaks context check` 引用,只留 `peaks code context-now`

### Finding #23: 24h-mode 状态机 entry reason 不传

- **Repro:** `peaks session 24h-mode transition --state 24H_ACTIVE` (无 --reason)
- **报:** 实际接受;但 help 写 `--reason <text> "human-readable reason for the transition"` 不强调 required
- **修复:** --reason 标记为 required (实际是 audit field)

### Finding #24: peaks workflow plan read "type" 枚举缺位

- **Repro:** `peaks workflow plan read --type security` 成功
- **实际 type 枚举:** security, perf, ? 其它没列
- **修复:** help 文本列 type 枚举

### Finding #25: peaks workflow verify-pipeline 缺 dry-run 模式

- **Repro:** `peaks workflow verify-pipeline --rid x --project . --json`
- **报:** 直接 verify,不接受 --dry-run
- **修复:** verify-pipeline 加 --dry-run / --no-write 模式

## 3 个 P3 体验级 bug (可选 4.0.7)

- **E1:** `peaks project context` 输出 path 写反斜杠 `.peaks\\PROJECT.md` 与 JSON 风格不一致
- **E2:** session info --active 返回的 bindingPath 是内部路径,SKILL.md Slice 021 说"必须 NOT cat directly"但 LLM 看到 JSON 自然会 cat
- **E3:** `peaks --help` 列的 `peaks slice boundary check` 用 4 阶段描述,但实际 `peaks slice check` 是 4 阶段,文档不一致

## 关键 fact-of-record

- peaks-loop 4.0.6 版本号
- ice-cola downstream monorepo,4 子包 (admin/server/client/hermes-agent)
- peaks-loop 装在 ice-cola devDependencies via `file:C:/Users/smallMark/Desktop/peaks-loop`
- sessionId `2026-08-02-session-b3a54b`,24H_ACTIVE
- 25 个 bug candidate 全部在 ice-cola 上 + 真实复现 path
- **P0 必修 2 个 (Finding #1 catalog drift, Finding #2 session-resolver 系统性)**
- **P1 应修 3 个 (#3 24h+should-pause 互斥, #4 SKILL.md D-001 反向, #5 context-now --project 文档错)**
- **P2 修 20 个**
- **P3 体验 3 个**

## 建议修复顺序 (4.0.7 PR 序列)

1. **PR-1 P0:** Finding #1 (catalog→enforcers) — decide A/B/C/D then implement
2. **PR-2 P0:** Finding #2 (session-resolver) — refactor resolver module + 4 CLI call site fix
3. **PR-3 P1:** Finding #3 (24h-mode bypass stale-presence)
4. **PR-4 P1:** Finding #4 + #5 (SKILL.md 文档同步)
5. **PR-5 P2 batch:** Finding #6-#25

## Not in this report (保留 future slice)

- 24h-mode 实际运行 (auto-compact triggers, sub-agent drift) 还没在 4.0.6 跑出真数据
- 真实 peaks-code → RD → QA → verdict 端到端没跑
- worktree governance 3 层 (L1/L2/L3) 没在 ice-cola 真触发
- peaks-loop 自己代码 (RedLineCatalog.ts 等) 没动 — 是 ice-cola 实测报告 input

---
**Linked:** peaks-code dogfood runbook (TBD), `2026-08-02-nightshift-test-failures-fix.md`(同类型 47-failures batch fix sediment)
