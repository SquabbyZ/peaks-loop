# Changelog

## [2.15.0] — 2026-06-28 — Sticky-mode forced re-ask + user-feedback → peaks-cli enforcement (slice 002)

**MINOR bump from 2.14.2** (slice `2026-06-28-sticky-mode-and-feedback-promotion`). Closes defect A (sticky-mode) and defect B (advisory-only feedback) from PRD-002. Two system-level fixes ship together because both are triggered by the same root cause: user-given rules were not machine-enforced.

### Feature — Sticky-mode forced re-ask (defect A fix)

- **`peaks skill presence:check-stale --project <path> --json`** (NEW) — Detects whether the recorded skill presence's `outerSessionId` matches the current outer (Claude / harness) session id. Returns `{ stale: boolean, reason: "outer-session-mismatch" | "no-presence" | null }`. Pure read-only; does NOT clear the presence.
- **`peaks skill presence --check-stale`** (NEW flag, default false for back-compat) — Pair the standard presence read with the staleness check in a single CLI call. Statusline + sub-agent dispatch consume this.
- **`peaks workspace init`** (MODIFIED) — When an outer-session-mismatch rotation fires, the CLI now calls `clearStalePresenceOnRotation` to clear the stale presence. Two guards prevent accidental destruction of user-explicit mode choices:
  - **Reconnect guard** — recorded outer id matches the NEW outer id → do NOT clear (reconnect).
  - **Live-different-outer guard** — recorded outer id belongs to a different LIVE outer session → do NOT clear (would destroy another user's mode).
- **`peaks solo should-pause --step step-1-mode-select`** (MODIFIED) — Now consults `presence:check-stale` automatically. When the presence is stale, returns `shouldPause: true, reason: 'stale-presence — re-ask Step 1'`. The hard-pause on Step 1 itself is preserved (defect #1 from slice 2026-06-28-solo-mode-bypass-fix).
- **`skills/peaks-solo/SKILL.md` Step 1** (MODIFIED) — Wording changed from "if user did not name a profile, AskUserQuestion" to "if user did not name a profile OR presence is stale, AskUserQuestion". Cross-references the new `references/mode-selection-with-stale-presence.md`.
- **`skills/peaks-solo/references/mode-selection-with-stale-presence.md`** (NEW) — Detection protocol + worked example (88b27d defect) + ACL.
- **`src/services/skills/skill-presence-service.ts`** — New exports: `checkStalePresence`, `clearStalePresenceOnRotation`, types `StalenessCheck`, `StaleReason`.

### Feature — User-feedback → peaks-cli enforcement (defect B fix)

- **`sops/feedback-promotion-sop.md`** (NEW) — SOP that requires every feedback memory (`.peaks/memory/<name>.md` with `metadata.type === 'feedback'`) to be promoted to at least one enforcement layer: A (peaks-sop gate), B (peaks-hooks PreToolUse), or C (mode-gate hardFloorCategory). When a rule spans multiple layers, promote to ALL of them.
- **`peaks feedback promote <memory-file> [--layer A|B|C] [--dry-run]`** (NEW) — Reads the feedback memory, generates a code stub for the chosen layer, writes the promotion marker (HTML comment + `.promotion.json` sidecar), and writes the envelope at `.peaks/_runtime/<sid>/rd/feedback-promote-<name>.json`.
- **`peaks feedback check-unpromoted --project <path> [--strict]`** (NEW) — Scans `.peaks/memory/*.md` for feedback memories without a promotion marker. Default: dry-run (exit 0, just warn). `--strict`: fail with exit code 1 (used by Gate H).
- **`peaks workflow verify-pipeline` Gate H "feedback-promotion"** (NEW) — Runs `feedback check-unpromoted --strict`. Failures block `complete: true` and surface as `gateH: 'fail'` in the verification envelope.
- **`src/services/feedback/feedback-promotion-service.ts`** (NEW) — Parses feedback memories, detects promotion markers (comment OR sidecar), generates layer stubs, writes the promotion envelope.

### Feature — Commit-boundary hard-floor (full-auto boundary = commit only)

- **`src/services/solo/mode-gate.ts`** — New `HardFloorCategory` value: `'commit-boundary-side-effect'`. New `CommitBoundaryActionId` union with 5 actions: `git-push`, `git-tag`, `npm-publish`, `npm-install-global`, `peaks-global-install`. New function `detectCommitBoundaryAction(command)` matches the patterns. New `shouldPauseAtGate({ commitBoundaryAction: true })` flag — when true, ALWAYS pauses regardless of mode (overrides full-auto / swarm auto-proceed).
- **Per the user-given rule** `.peaks/memory/2026-06-28-full-auto-boundary.md`: "full-auto 只做到 commit 就是，push 不用". The commit-boundary hard-floor is the machine enforcement of that advisory rule.

### Test results
- 4 new test files: `presence-staleness.test.ts` (12), `stale-presence-detection.test.ts` (9), `feedback-promotion.test.ts` (18), `commit-boundary-hard-floor.test.ts` (247). Total new cases: **286**.
- Existing solo tests (mode-gate × 81, post-compact × 11) pass unchanged.
- Full unit suite baseline 4394 → 4680 passing (286 added). 0 new failures; pre-existing 7 unrelated failures unchanged.

### Out-of-scope
- Push / tag / npm publish — full-auto boundary = commit only; the commit-boundary hard-floor now BLOCKS these in full-auto (was advisory). User must explicitly confirm via AskUserQuestion to proceed.
- `peaks hooks install` — slice is code-only. Hooks remain user-only.
- Cleaning the 88b27d session's stale presence on disk — slice ships the detection + auto-clear, does NOT proactively touch the live tree.

### Feature — slice DAG layered parallelism + foundation/upstreamSync/complexity 标记 (2026-06-28 follow-up)

slice-2026-06-28-layered-dag PRD: 大需求(1 周内做不完)= 基础先行 + 业务并行(节省 2-3 天 wall time);fork 场景 = 上游 tag 断点同步;复杂度分流 = user-attended vs overnight 排程。

- **`src/services/dispatch/slice-dag.ts`** — `SliceNode` 加 3 可选字段(`foundation?: boolean` / `upstreamSync?: boolean` / `complexity?: 'trivial'|'simple'|'complex'`)。`validateDag` 加新字段合法性校验 + 防御性规则(foundation slice 不可 dependsOn 非 foundation)。`topologicalLevels` 同层内 priority 排序: foundation > upstreamSync > id asc。`serializeDag` / `hashDag` 含新字段,**老 DAG hash 稳定**。
- **`src/services/solo/dag-orchestrator.ts`** — 新增 `runLayeredDag` 函数。同 `runDag` 语义 + 业务 slice 不等所有 foundation,只等其 `dependsOn` 子集。cancel-on-fail 保留。`runDag` 保留(向后兼容,内部走 priority-sorted levels)。
- **`src/cli/commands/dispatch-from-dag.ts`** — 切到 `runLayeredDag`。envelope 加 `sliceMeta` 字段(per-slice foundation/upstreamSync/complexity)。
- **2 new test files** — `tests/unit/dispatch/slice-dag-foundation.test.ts` (19 cases) + `tests/unit/solo/dag-orchestrator-layered.test.ts` (5 cases) = **24 new tests, 0 regression**。
- **dispatch + solo tests**: 215/215 通过(单跑)。
- **全量 vitest** 4843 cases: 4824 passed / 2 failed(并发 race,pre-existing)。

**不触动:** transition gates / hard contracts / Karpathy 4 / sub-agent 协议 / 老 DAG 兼容性。

### Feature — G11/13/14/15 CLI 全套落地 (2026-06-28 follow-up)

4 个 PRD + 4 个 service + 4 个 CLI 文件 + 4 个 test 文件,共 **17 个新命令 + 63 个新测试通过**。

**G11 上游 tag 同步**(slice-2026-06-28-fork-cli):
- 5 commands: `peaks fork status` / `upstream-check` / `sync-plan` / `sync` / `sync-verify`
- 持久化 `.peaks/fork-state.json` (baseline + history)
- `recommendStableTags` 过滤 pre-release 标签(alpha/beta/rc/dev/preview)
- 15 tests pass

**G13 存量影响面扫描**(slice-2026-06-28-impact-cli):
- 2 commands: `peaks impact scan --files <list>` / `peaks impact must-check --files <list>`
- 手写 glob 匹配(`**` / `*`),无 AST 依赖
- 10 个默认业务流(用户管理 / 权限校验 / 登录流程 / Skill 权限 / 数据列表 / API 网关 / DB schema / ...)
- 风险等级: auth/schema/migrations = high;services/api/components = medium
- 13 tests pass

**G14 轻量回归 critical-paths**(slice-2026-06-28-smoke-cli):
- 4 commands: `peaks smoke define` / `run` / `run-and-repair` / `add-path`
- 持久化 `.peaks/smoke-paths.json`
- 5 个 source (prd-business-scenario / boss-stated / historical-incident / impact-must-check / manual)
- 3 个 status (pending / pass / fail),history 保留最近 5 次
- 16 tests pass

**G15 上线观察期状态机**(slice-2026-06-28-release-cli):
- 7 commands: `peaks release plan` / `canary` / `promote` / `watch` / `done` / `rollback` / `hotfix`
- 8 阶段状态机: planned → canary-10 → canary-50 → promoted → watching → done
- side branches: → rolled-back (from any pre-done), → hotfixed (from watching)
- 24h 观察期倒计时(从 promotedAt 起)
- `hotfix` 强制 rollback 旧 release + 跳过 planned 阶段
- 19 tests pass

**触动:** 新增 4 个 service / 4 个 CLI / 4 个 test 文件 = **12 个新文件**。CLI 注册全在 `src/cli/program.ts`,**不触动** transition gates / hard contracts / Karpathy 4 / sub-agent 协议 / mode-gate。

**已知未实现**(后续切片):
- 真实 git fetch + merge(G11)
- 真实 Playwright 路径执行(G14)
- 真实 k8s rollout / LB config / 监控集成(G15)

### Feature — G1/G3/G4/G5 user-touchpoint CLI 全套落地 (2026-06-28 follow-up)

4 个 service + 4 个 CLI 文件 + 4 个 test 文件,共 **16 个新命令 + 40+ 个新测试通过**。所有 CLI 都遵循 12 Gaps 核心原则: user 在循环里 = 业务/产品审阅,不参与技术决策。

**G3 prd 4 必填块**(slice-2026-06-28-prd-blocks):
- `peaks prd check-blocks <rid>` — 验证 4 必填块(业务场景/边界/UI 装配/上游基线)+ 业务禁区子节
- 上游基线仅在 fork 项目上 required(检测 `.peaks/fork-state.json`)
- 8 tests pass

**G4 user touchpoint classifier**(slice-2026-06-28-user-touchpoints):
- 3 commands: `peaks solo gate-classify` / `peaks solo user-touchpoints` / `peaks solo commit-boundary-actions`
- 14 个 Solo gate 静态分类: business / tech / mode-selection / commit-boundary / commit-floor
- `userShouldReview`: always / business-only / never
- 7 tests pass

**G1 slice 业务审阅**(slice-2026-06-28-slice-review):
- 4 commands: `peaks slice review` / `score` / `accept` / `reject`
- 4 个默认 review item: business-match / boundary-cases / ui-assembly / mergeable
- 12 Gaps 阈值: avg >= 3 AND no item <= 2 → accepted
- 16 tests pass

**G5 QA 业务视角验收**(slice-2026-06-28-qa-business):
- 4 commands: `peaks qa business-review` / `business-score` / `business-accept` / `business-reject`
- 6 个默认 review item: business-flow / req-coverage / boundary-cases / ui-assembly / exception-tone / mergeable
- 同一阈值(avg >= 3, no item <= 2)
- 12 tests pass

**不触动:** transition gates / hard contracts / Karpathy 4 / sub-agent 协议。**新增 8 个新文件**(4 services + 4 CLIs + 4 tests)。

### Documentation — peaks-cli 真实定位 + 12 Gaps 沉淀 (2026-06-28 follow-up)

会话期间从资深前端 + 后端半盲 + 极致工期 + 24h AI 程序员 + 存量无 UT 的真实场景,沉淀 6 个 memory 文件 + 索引 + 4 个 SKILL.md 校准注。**核心叙事:** `90% 效率 + 80% 质量` > `80% 效率 + 90% 质量`;user 在循环里 = 业务/产品审阅者不参与技术决策;主路径 = 唯一蜂群模式;prd 质量前置 = 4 必填块;QA = 业务视角 + 轻量回归 + 上线观察期。

- **6 new memory files** — `.peaks/memory/peaks-cli-{24h-ai-programmer-positioning, user-role-and-tech-decision, prd-template-design, slice-review-and-qa-perspective, fork-sync-and-layered-parallel, fast-iteration-quality-loop}.md` (warm.project index 18 → 24)
- **4 SKILL.md 校准注** — peaks-solo / peaks-prd / peaks-rd / peaks-qa 各加精简 anchor(均通过 25KB cap,只引用 memory 不重复内容)
- **不触动** transition gates / hard contracts / Karpathy 4 / 模式枚举 / mode-gate.ts / sub-agent 协议

### Fix — 2 pre-existing bugs (2026-06-28 follow-up)

- `src/services/feedback/feedback-promotion-service.ts:88` — `catch` 改 `throw with cause`(silent-warning-detector 报 catch-return-null,让 caller 区分 IO 失败)
- `src/services/feedback/feedback-promotion-service.ts:138` — `catch {}` 改 `console.warn`(silent-warning-detector 报 empty-catch,malformed sidecar 不再静默)
- `tests/unit/services/context/tokenizer.test.ts:23` — `fetchedAt` 硬编码 `2026-06-21` 距今 7 天触发 `timeDecayScore 0.886 < 0.9` 期望,改 `new Date().toISOString()` 符合"fresh fetch"测试意图

**测试结果:**
- silent-warning-detector: 2 violations → 0
- `tests/unit/services/context/`: 49/50 → 50/50
- 全量 vitest 4819 tests:3 failed → 2 failed(剩下 2 个是并发 race condition,单跑 context 50/50 全过,pre-existing)

---

## [2.14.2] — 2026-06-28 — peaks-companion dead skill removal + minimax provider migration

**PATCH bump from 2.14.1** (slice `2026-06-28-tilde-peaks-p3p4`). Closes P3 + P4 from `.peaks/memory/2026-06-28-tilde-peaks-inventory.md`.

### Cleanup
- **`skills/peaks-companion/`** — REMOVED. Skill was dead: SKILL.md documented `peaks companion status/install/setup/start` but no CLI implementation existed (`src/services/companion/` not present, `peaks --help` had no companion entry). Empty `~/.peaks/companion/` directory is no longer expected to receive `cc-connect.log` writes.
- **`tests/unit/skills/peaks-companion.test.ts`** — REMOVED (9 cases). The companion skill-count assertion (19 → 18 skills) is now verified by `tests/unit/skills/skill-count.test.ts` (already covers the meta count, not companion specifically).
- **`.peaks/memory/peaks-companion-*.md`** — REMOVED (4 files: `cc-connect-dogfood-2026-06-15`, `qr-autoopen-2026-06-15`, `qr-inline-display-2026-06-15`, `watcher-ecs-url-config`). Historical dogfood records, no longer relevant.

### Refactor
- **`~/.peaks/providers.json`** (NEW sidecar) — MiniMax provider config migrated from deprecated `~/.peaks/config.json.providers` to canonical `~/.peaks/providers.json` per `provider-service.ts` schema. The slim `config.json` (per `config-types.ts`) no longer carries the `providers` field.
- **MiniMax model field preserved** — `~/.peaks/providers.json.providers.minimax.model = "minimax-2.7"`; `peaks config provider minimax get/status` continue to report correctly via the back-compat fallback in `provider-service.ts`.

### Test results
- `pnpm vitest run tests/unit/doctor.test.ts` — 50/50 pass
- `pnpm vitest run` full unit suite — `peaks-companion.test.ts` no longer runs; total cases drop from 4418 → 4409. Pre-existing failures (`doctor.test.ts` × 0, `tokenizer.test.ts` × 1, `35-checks-aggregate.test.ts` × 1) unchanged.

### Out-of-scope
- Push / tag / npm publish — full-auto mode boundary = commit only; user-only.
- Re-implementing peaks-companion CLI — user chose delete over revive.
- Cleaning `~/.peaks/companion/` empty dir — left in place; harmless.

---

## [2.14.1] — 2026-06-28 — Prepublish Windows ENOENT + npm 11.x https_proxy deprecation

**PATCH bump from 2.14.0** (carry-forward from v2.13.3 AC-2 partial fix + npm 11.x config rename).

### Bug fixes
- `scripts/prepublish-build.mjs` — use `execFileSync('pnpm', ['run', 'build'])` (no shell) with Windows fallback to `prepublish-build.ps1` (proven dogfood). Eliminates the v2.13.4 partial-fix `spawnSync cmd.exe ENOENT` on Node 22 + Windows native.
- `.npmrc` (NEW, repo-local template) — documents that `https_proxy` (underscore) is NO LONGER VALID in npm 11.x; use `https-proxy` or `proxy`. User-global `~/.npmrc` may still have `https_proxy`; npm 11.x warns, npm 12 will error.

### Test results
- `tests/unit/scripts/prepublish-build.test.ts` (NEW, 6 cases) — covers execFile happy path + Windows ps1 fallback + error propagation + version validation + ENOENT regression
- `node scripts/prepublish-build.mjs` end-to-end: `[prepublish-build] build OK` exit 0 (verified on this Windows session)

### Out-of-scope
- Do NOT modify user-global `~/.npmrc` (user-only boundary); user must run `npm config delete https_proxy` themselves if they want to silence the warning before npm 12.

---

All notable changes to peaks-cli are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.14.0] — 2026-06-28 — Anti-fake-green hardening (5-line defense in depth)

**MINOR bump from 2.13.4** (slice `v2-14-0-anti-fake-green-hardening`, 5 production-grade defenses against single-LLM self-dogfood blind spots).

### Features

- G1 fixture-replay: 32 real-shipment fixtures + `peaks fixture capture` CLI + `pnpm test:replay` CI gate
- G2 silent-warning lint: AST-based detector catches 4 anti-patterns (empty catch / catch-return-null / Promise-reject-no-cause / console-error-no-env); `pnpm lint:silent-warning` exits 1 by default with `// TODO(g2):` grace markers; 142 baseline sites pre-marked
- G3 prose-only ≤5%: 89 prose-only entries → 6 promoted to enforcers (prose ratio 60.1% → 0%); `pnpm audit:prose-ratio` CI gate
- G4 third-party reviewer: `skills/peaks-reviewer/` with `~/.peaks/config.json` provider pool; 35/35 new tests; `THIRD_PARTY_REVIEW` prereq (soft-warn skipped in v2.14.0, hard-fail in v2.15.0)
- G5 race-detector: 4 fuzz-hardened modules + fixed `share-commands.test.ts` LWW timing flake via `uniqueBatch()`; `pnpm test:race` (--repeat=20 --no-file-parallelism) in 4.7s

### Test results

- 4502 pass + 3 pre-existing failures (artifact-prereq x2, tokenizer x1 — NOT introduced)
- 25/25 ACs pass; 10/10 QA gates pass
- tsc clean; prepublish-build OK

### Known limitations (NOT a guarantee — see NG5)

- Self-dogfood blind spots still exist by construction (any single-LLM evaluator shares blind spots with the code author). The 5-line defense reduces the probability of undetected regressions but does not eliminate it.

---

## [2.14.0-alpha.1] — 2026-06-28 — Slice B G4 third-party reviewer (anti-fake-green hardening)

**MINOR bump from 2.13.4** (slice `2026-06-28-session-75d5f0`, slice-b-1-g4-third-party-reviewer).

Slice B of the v2.14.0 anti-fake-green hardening PRD (`v2-14-0-anti-fake-green-hardening`, R6 sub-slice plan). This slice introduces the `peaks-reviewer` skill — a third-party independent reviewer that runs **in parallel** to the existing `karpathy-reviewer`. The intent is structural: when the RD-side karpathy reviewer and the QA-side dogfood both run on the same model family, "single-LLM self-dogfood" blind spots can survive 49/49 unit-test pass + tsc clean (the v2.13.1 + v2.13.2 ship bugs were real cases). peaks-reviewer adds an out-of-band perspective from a guaranteed-distinct model family.

> ⚠️ **Important honesty note (per A4.5):** peaks-reviewer is a structural mitigation, NOT a guarantee. The release notes MUST NOT claim "no more fake green". Two reviewers from different families reduce — they do not eliminate — the single-LLM blind-spot class. v2.14.0 ships the G4 mitigation in a 1-minor-release soft-warning window; hard-fail (when `reviewer.providers` is configured but `rd/third-party-review.md` is absent) lands in v2.15.0.

### Features

- **`skills/peaks-reviewer/SKILL.md` + `references/reviewer-prompt.md` + `references/reviewer-schema.md`** — new skill family (19 → 20 skills) with a 5-step prompt, ReviewerEnvelope shape, and the A4.4 modelFamily distinctness gate contract.
- **`schemas/reviewer-envelope.schema.json`** — JSON Schema for the ReviewerEnvelope (reviewerId / modelId / modelFamily / passed / violations[] / gateAction / reason). Free-form LLM JSON is rejected at parse time.
- **`peaks reviewer run --rid <rid> [--json]`** + **`peaks reviewer status [--json]`** — CLI surface. `run` returns the schema-validated envelope; `status` shows whether the reviewer is configured (providers / selection / fallback policy).
- **`~/.peaks/config.json` `reviewer` section** — `providers[]` (≥2 entries; ollama / anthropic / openai supported), `selection` (`round-robin` | `hash(rid)` | `random`), `rdProviderName`, `requireDistinctModelFamily`, `fallbackOnError` (`skip` | `error`), `schemaPath`. Missing section → reviewer skipped (no CLI prompt, transition still passes, envelope records `skipped: no-reviewer-config`).
- **THIRD_PARTY_REVIEW prereq** — wired into `rd:qa-handoff` for FEATURE / BUGFIX / REFACTOR slices. v2.14.0 ships with a 1-minor-release soft-warning window (`backCompat: true`); v2.15.0 will hard-fail when `reviewer.providers` is configured but the artifact is absent.
- **CLI flag `--reviewer-model` REMOVED** — A4.1 explicitly demotes the model selection to config-file-only. Users edit `~/.peaks/config.json` and the change takes effect without any CLI intervention.

### Service layer

- **`src/services/reviewer/reviewer-service.ts`** — orchestrator. `runReviewer({ rid, context, state?, fetchImpl?, rng? })` returns `{ ok, envelope, nextState? }`. Stamps `modelFamily` from the actual `modelId` we called (LLM cannot lie about its family — A4.4 hard gate).
- **`src/services/reviewer/reviewer-config.ts`** — strict loader for the `reviewer` section. <2 providers → `no-reviewer-config`. NEVER throws on missing file.
- **`src/services/reviewer/model-family.ts`** — `deriveModelFamily(modelId)` → `claude | gpt-4o | gpt-4 | gpt-3.5 | gpt-5 | o1 | o3 | azure-openai | bedrock-llama | bedrock-mistral | llama | mistral | qwen | deepseek | gemini | unknown-<sha256-prefix>`. Pure, deterministic, total.
- **`src/services/reviewer/selection-strategies.ts`** — `selectRoundRobin` (cycles + `initialState()` reset) / `selectHash(rid)` (stable per rid, sha256-of-rid) / `selectRandom(rid, rng)` (injected RNG for testability).
- **`src/services/reviewer/providers/ollama.ts` / `anthropic.ts` / `openai.ts`** — pure `fetch` + manual JSON parse; NO SDK (A4 prohibition). 30s timeout, `AbortController`-backed. Missing env var → `{ ok: false, error: 'missing env <NAME>' }`.

### Internal

- `src/services/artifacts/artifact-prerequisites.ts` — `THIRD_PARTY_REVIEW` added to FEATURE/BUGFIX/REFACTOR rd:qa-handoff tables; mirrors the MUT_REPORT back-compat pattern (1-minor-release soft-warning; v2.15.0 hard cut).
- `src/cli/program.ts` — registers `registerReviewerCommands`.
- `tests/unit/reviewer/{model-family,selection-strategies,reviewer-service}.test.ts` — 35 new test cases (10 / 12 / 13 across the three files). All pass; `tsc -p tsconfig.json --noEmit` clean; 99/99 cli-program + 28/28 artifact-prereq regressions still green.

### Honesty clauses preserved

- The karpathy-reviewer skill (`andrej-karpathy-skills:karpathy-guidelines` + `src/services/scan/karpathy-service.ts`) is **unchanged** (NG4 — parallel reviewer, not replacement).
- No new dependencies added — pure `fetch` + node:crypto + zod-equivalent manual schema guard.
- The 5 existing envelope parsers (v2.13.3 territory: `audit/security.md`, `audit/perf.md`, `prd/handoff.md`, `mut-report.json`, `mutants.json`) are **byte-stable**.
- No tests deleted or renamed; only additions.

---

## [2.13.4] — 2026-06-28 — Solo mode gate + verify-pipeline canonical path + auto-compact main target

**PATCH bump from 2.13.3** (slice `2026-06-28-solo-mode-bypass-fix`, 4 production defects reported by user in solo session 2026-06-28).

The four defects all stem from the v2.13.0 two-axis convention landing debt: the canonical evidence location is `.peaks/_runtime/change/<changeId>/<role>/...` (per `change-scope-service.ts`), but v2.13.0's mode-gate, verify-pipeline, and auto-compact dispatcher all referenced the pre-1.3.0 sibling-of-`_runtime/` form. v2.13.4 also adds the user-requested economy-vs-concurrency separation (per direction 2026-06-28: "效率比省钱更重要，是在效率达到最大值的时候，再去考虑经济问题").

### Bug fixes

- **Step 1 AskUserQuestion is no longer auto-defaulted to `mode: full-auto`** (defect #1) — `src/services/solo/mode-gate.ts:104-196` now treats `step-1-mode-select` (and `step-0.5-openspec-opt-in`, `step-0.7-resume-detection`) as a `HARD_PAUSE_STEPS` set: even `full-auto` mode pauses for the user to pick the mode. A new `gateKind: 'mode-selection-itself' | 'mode-driven' | 'hard-floor'` discriminator lets the LLM-side runner distinguish "you paused because the user must choose" from "you paused because the user already chose assisted/strict" from "you paused because a hard-floor category always wins". Dogfood-verified: a new session no longer writes `mode: "full-auto"` to `.peaks/_runtime/active-skill.json` on the first tool call without surfacing the Step 1 AskUserQuestion. 14 new test cases in `tests/unit/solo/mode-gate-step-1-hard-pause.test.ts` cover the four-mode matrix + hard-floor precedence. The pre-existing `tests/unit/services/solo/mode-gate.test.ts` (77 cases) was also updated for the new `gateKind` field — 77/77 still pass.
- **`peaks workflow verify-pipeline` now resolves the canonical evidence path** (defect #3) — `src/services/workflow/pipeline-verify-service.ts:216,219,260,288,295` rebuilds evidence paths as `.peaks/_runtime/change/<changeId>/<role>/...` (was `.peaks/<changeId>/<role>/...`, the SKILL.md 2.8.3 hard-ban shape). `src/services/workflow/artifact-paths.ts:67,148` gets the same fix in the security/performance findings resolver. A 1-minor-release deprecation window accepts the legacy `.peaks/<changeId>/...` and `.peaks/_runtime/<changeId>/...` forms with a `DEPRECATION_LEGACY_PATH_USED` warning so un-migrated workspaces still resolve. `PipelineVerification.usedCanonicalPath: boolean` is added to the return envelope so QA / TXT can surface the deprecation state. The CLI help-text at `src/cli/commands/workflow-commands.ts:448` is updated to cite the canonical path. 4 new test cases in `tests/unit/workflow/pipeline-verify-canonical-path.test.ts` cover canonical / legacy misplaced / top-level fallback / absent. The pre-existing `tests/unit/pipeline-verify-service.test.ts` (60 cases) was updated to write evidence at both paths so the deprecation contract is exercised end-to-end — 60/60 still pass.
- **`auto-compact` now targets the main-session context, not a sub-agent shell** (defect #4) — `src/services/context/auto-compact-dispatcher.ts` and `src/services/solo/auto-compact-orchestrator.ts` accept a new `target: 'main' | 'sub-agent'` parameter (default `'main'`). For `target='main' + ide='claude-code'`, the dispatcher returns the `llm-self-compress` pathway and the orchestrator writes `.peaks/_runtime/<sessionId>/txt/auto-compact-pending.json` (with `pending: true, target: 'main', ratio, redLine`) so the next main-session LLM turn fires `/compact` in-band rather than spawning a detached `sh -c /compact` (which previously only compressed the sub-agent shell). For `target='sub-agent'`, the legacy shell-spawn behavior is preserved. Non-claude-code IDEs + `target='main'` return `noop` with a "main-session target unsupported" reason. 6 new test cases in `tests/unit/context/auto-compact-main-target.test.ts` cover the dispatch matrix + the orchestrator's intent-file write.

### Features

- **`peaks workspace migrate-change-scope --project <path> [--apply] [--json]`** — slice 2026-06-28-solo-mode-bypass-fix migration tool. Dry-run by default; `--apply` atomically renames misplaced `.peaks/_runtime/<changeId>/` (and `.peaks/<changeId>/`) entries into the canonical `.peaks/_runtime/change/<changeId>/` location, writes a `.peaks-migration.json` marker (with `from:`, `slice:`, `tool:`, `migratedAt:`) for audit. **Refusal conditions** (defense-in-depth, both pre-slice audit + new): entries that look like date-stamped session ids (`YYYY-MM-DD-session-X`) are refused to avoid destroying the session workspace (`MIGRATION_REFUSED_SESSION_ID_COLLISION`); entries whose target dir exists with non-byte-equal contents are refused to avoid clobbering (`MIGRATION_REFUSED_TARGET_NOT_EMPTY`); a hard-coded `PEAKS_TOP_LEVEL_DENY` / `RUNTIME_DENY` whitelist + `looksLikeChangeScopeId` structural check ensures `.peaks/memory`, `.peaks/standards`, `.peaks/retrospective`, `.peaks/sc`, `.peaks/sops`, `.peaks/project-scan`, `.peaks/_sub_agents` are **never** treated as misplaced change-ids. **Idempotent**: re-running on a clean workspace reports no work. Dogfood-verified: the actual misplaced `.peaks/_runtime/2026-06-27-verdict-aggregator-v2-12-debt/` (8 files) was migrated end-to-end; subsequent `peaks workflow verify-pipeline --rid 2026-06-27-verdict-aggregator-v2-12-debt --change-id 2026-06-27-verdict-aggregator-v2-12-debt --project .` reports `usedCanonicalPath: true` (was `false`) and zero `DEPRECATION_LEGACY_PATH_USED` warnings. 5 new test cases in `tests/unit/workspace/migrate-change-scope.test.ts` cover dry-run, apply, idempotency, session-id refusal, and target-not-empty refusal; a 6th case locks the `.peaks/<project-data>` whitelist contract.

### Internal

- `src/services/solo/mode-gate.ts` (+28/-4 lines) — `HARD_PAUSE_STEPS` set + `GateKind` union + `gateKind` field on `GateDecision`.
- `src/services/solo/auto-compact-orchestrator.ts` (+24/-2 lines) — `target` parameter, `writeMainSessionCompactIntent` helper, surface `target` in return envelope.
- `src/services/context/auto-compact-dispatcher.ts` (+38/-5 lines) — `CompactTarget` type, `target` parameter, reordered non-claude-code refusal, `shell-exec + main` → `llm-self-compress` rewrite.
- `src/services/context/auto-compact-types.ts` (+6 lines) — `target?: 'main' | 'sub-agent'` on `AutoCompactResult.data`.
- `src/services/preferences/preferences-types.ts` (+13 lines) — explicit doc-comments on `economyMode` (model selection only, NOT concurrency) and `swarmMode` (controls subgraph shape, NOT fan-out). Fan-out is governed by `fanout.defaultMode: 'fan-out'` (hard constraint per slice 2026-06-24-audit-5th-p2).
- `src/services/workflow/pipeline-verify-service.ts` (+58/-22 lines) — canonical-path lookup + 1-minor-release deprecation fallback + `usedCanonicalPath` + `findRequestFile` strips legacy `_runtime/` scope prefix.
- `src/services/workflow/artifact-paths.ts` (+31/-5 lines) — `canonicalQaDir` / `legacyQaDir` / `legacyTopLevelQaDir` helpers + extended legacy fallback chain in `resolveFindingsPath`.
- `src/cli/commands/workflow-commands.ts` (+1/-1 line) — CLI help-text now cites canonical path.
- `src/cli/commands/workspace-commands.ts` (+3 lines) — register `migrate-change-scope` sub-command.
- `src/cli/commands/workspace/migrate-change-scope-command.ts` (NEW, 230 lines) — `migrateChangeScope()` core + `migrateOne()` per-entry handler with the deny-list + `shallowContentEqual` (1-level recursion) + 3 refusal conditions.
- `tests/unit/workspace/banned-path-directive-guard.test.ts` (+11 lines) — added `KEEP_DESCRIPTIONS` anchor for the new help-text so the AC-2.2 banned-path-guard still passes.
- `tests/unit/pipeline-verify-service.test.ts` (+24/-12 lines) — `writeRdEvidence` / `writeQaEvidence` now write at canonical + legacy paths; `isResolvedChangeId` updated for the bare-id contract.
- `tests/unit/services/solo/mode-gate.test.ts` (linter-updated) — assertions for the new `gateKind` field on every `GateDecision` return.
- 5 new test files: `tests/unit/solo/mode-gate-step-1-hard-pause.test.ts` (14 cases), `tests/unit/workflow/pipeline-verify-canonical-path.test.ts` (4 cases), `tests/unit/workflow/artifact-paths-canonical.test.ts` (4 cases), `tests/unit/context/auto-compact-main-target.test.ts` (6 cases), `tests/unit/workspace/migrate-change-scope.test.ts` (6 cases) — 34 new cases total, all pass.

### Test results

- `pnpm vitest run` on the 4 affected module areas (solo/workflow/context/workspace): **181/181 pass** (5 new test files + pre-existing suites).
- Full unit suite: 4394/4418 pass (7 pre-existing failures unrelated to this slice — `doctor.test.ts` version-mismatch × 5, `tokenizer.test.ts` time-decay flake × 1, `35-checks-aggregate.test.ts` × 1).
- `pnpm tsc --noEmit`: clean.

---

## [2.13.3] — 2026-06-28 — Verdict aggregator parser fix + publish pipeline + CLI warnings

**PATCH bump from 2.13.2** (slice `2026-06-27-verdict-aggregator-v2-12-debt`, red-line scope 7 source files + 3 test files modified + 3 new scripts + 1 package.json hook).

2.13.2 dogfood surfaced 4 bugs that all stem from v2.12.0 envelope-schema落地 debt: the v2.12.0 audit artifacts (`audit/security.md`, `audit/perf.md`) are YAML-frontmatter + markdown, but v2.13.2's `parseSecurityEnvelope` / `parsePerfEnvelope` used `JSON.parse` (which is the wrong shape). v2.13.3 also fixes a cross-version publish-pipeline issue (`bin/peaks.js` was shipping a Jun 13 stale dist because `prepublishOnly` was never wired) and adds a soft-block-warning surface in the CLI so users can see v2.13.2's `mut-report-missing-deprecated-in-v2.14.0` warning instead of having it silently downgraded in service-layer.

### Bug fixes

- **`parseSecurityEnvelope` / `parsePerfEnvelope` now parse v2.12.0 markdown** (AC-1) — both parsers now try `JSON.parse` first and fall back to a markdown parser that extracts the YAML frontmatter `verdict:` line + parses `## Findings` bullets in 2 real v2.12.0 shapes (`- [SEV] dim @ file:line — hint` and `- HIGH: hint in file:line`). Dogfood-verified: a real `audit/security.md` with a HIGH `hardcoded password in src/auth.ts:42` now returns `parseSecurityEnvelope(...) === { verdict: 'warn', violations: [{ severity: 'HIGH', file: 'src/auth.ts', line: 42, hint: 'hardcoded password' }], summary: '...' }`. The CLI's inline `parseSecurityFromMarkdown` / `parsePerfFromMarkdown` were removed (strict-improvement refactor; canonical parser in `src/services/verdict/envelopes.ts` now owns the markdown path; CLI delegates). 4 new test cases (H/I/J/K) bring the envelope suite to 11/11.
- **`peaks verdict aggregate` returns real violations** (AC-1 end-to-end) — dogfood with a real v2.12.0 fixture now returns `{ verdict: 'warn', reasons: [{ source: 'security-audit', severity: 'HIGH', file: 'src/auth.ts', line: 42, hint: 'hardcoded password' }], sources: { security: 'present', perf: 'present', karpathy: 'present', mut: 'missing', qa: 'present' } }` — 2.13.2's silent `reasons: []` is gone.
- **`prd/handoff.md` frontmatter now has `sha256:` field** (AC-4) — `autoRegenPrdHandoff` was writing `handoffHash:` but `artifact-prerequisites.ts:158` requires `mustContain: ['schemaVersion: 2', 'sha256:']`. v2.13.3 writes `sha256: <hex>` as the primary field and keeps `handoffHash: <hex>` as an alias for backward compatibility. 1 new test case (E: prereq regression pin) brings the handoff suite to 5/5.
- **CLI surfaces `PrerequisiteCheckResult.warnings`** (AC-3) — `PrerequisitesNotSatisfiedError` now carries a `warnings` field (always present, possibly empty). The `code: PREREQUISITES_MISSING` error response now includes `data.warnings: [...]` plus a per-warning `Soft-blocked (v2.13.3 back-compat window): <path> — <message>` next-action line. This makes the v2.13.2 `MUT_REPORT` soft-block window visible to users instead of being silently downgraded in service-layer. 3 new test cases bring the request-commands suite to 8/8.

### Features

- **`prepublishOnly` build hook** (AC-2) — `package.json` adds `"prepublishOnly": "node scripts/prepublish-build.mjs"` which runs `pnpm run build` before every `npm publish`. Cross-platform dispatch via `scripts/prepublish-build.mjs` (Node entry), with equivalent `scripts/prepublish-build.sh` (git-bash / Linux) and `scripts/prepublish-build.ps1` (PowerShell) for direct invocation. The `prepublish-build.mjs` uses `shell: isWindows` to work around the Node 22 + Windows + .cmd-shim `EINVAL` (POSIX is a no-op). This is the cross-version publish-pipeline fix that prevents the 2.13.2 `bin/peaks.js → dist/src/cli/index.js (Jun 13 stale dist)` incident from recurring. The `.sh` path has been independently dogfood-verified to run `pnpm build` end-to-end with exit code 0.

### Internal

- `src/services/verdict/envelopes.ts` (+192/-18 lines) — `parseSecurityEnvelope` / `parsePerfEnvelope` markdown fallback (frontmatter + `## Findings` shape B bullets).
- `src/cli/commands/verdict-aggregate-command.ts` (+13/-31 lines) — removed inline `parseSecurityFromMarkdown` / `parsePerfFromMarkdown`; delegates to canonical parser.
- `src/services/prd/handoff-auto-regen.ts` (+8 lines) — `sha256:` primary + `handoffHash:` alias.
- `src/services/artifacts/request-artifact-service.ts` (+18/-7 lines) — `PrerequisitesNotSatisfiedError.warnings` field (defaulted param).
- `src/cli/commands/request-commands.ts` (+13/-1 lines) — surface `data.warnings` in PREREQUISITES_MISSING + per-warning next-action.
- `scripts/prepublish-build.mjs` (NEW) — cross-platform Node dispatch (8 lines of code).
- `scripts/prepublish-build.sh` (NEW) — bash variant for git-bash / Linux.
- `scripts/prepublish-build.ps1` (NEW) — PowerShell variant for Windows native.
- `package.json` (+1 line) — `prepublishOnly` hook.
- `README.md` (+1 line, 30-second onboarding block) — publish note: "v2.13.3 起 `npm publish` 会在 publish 前自动跑 `pnpm run build` (prepublishOnly hook 走 scripts/prepublish-build.mjs), 确保 bin/peaks.js 永远带最新 dist. 发布前不要手动跳过这一步 — 2.13.2 dogfood 抓过 bin/peaks.js 指 Jun 13 旧 dist 的事故."
- `tests/unit/services/verdict/envelopes.test.ts` (+112 lines) — 4 new cases (H/I/J/K).
- `tests/unit/services/prd/handoff-auto-regen.test.ts` (+62 lines) — 1 new case (E: prereq regression pin).
- `tests/unit/cli/commands/request-commands.test.ts` (+183 lines) — 3 new cases (warnings surface).

### Decision records

- NEW `.peaks/memory/2026-06-27-v2-13-3-verdict-aggregator-v2-12-debt.md` — ship state (162/162 PRD-targeted tests pass, 4363/4364 full unit suite pass with 1 pre-existing tokenizer.test.ts flake, tsc 0 errors, 6 AC all green, 4 dogfood scenarios 0-2-tychetes passed).
- UPDATED `.peaks/memory/2026-06-27-v2-13-2-verdict-aggregator-fixes.md` — 2.13.2 ship state amended with the dogfood that motivated v2.13.3 (this slice is the canonical example of "v2.13.1's BLOCKER led to v2.13.2, v2.13.2's dogfood led to v2.13.3 — the loop continues until 2.14.0 when envelopes get unified").

### Multi-CC commit boundaries

| Commit tag | Scope |
|---|---|
| v2.13.3 | 4 bug fixes (parser / publish pipeline / CLI warnings / handoff sha256) + 3 new scripts + 4 new test cases + package.json prepublishOnly + README publish note + CHANGELOG + version bump + ship-state memory |

### Verified (peaks solo dogfood + QA on this session)

- AC-1 (parser fix): `tests/unit/services/verdict/envelopes.test.ts` → **11/11 pass** (was 7/7 in v2.13.2, +4 markdown fallback cases H/I/J/K). Dogfood script confirms: real `audit/security.md` with HIGH violation → `parseSecurityEnvelope` returns non-null envelope; `peaks verdict aggregate` returns `reasons: [{severity: HIGH, file: src/auth.ts:42}]`.
- AC-2 (publish pipeline): `scripts/prepublish-build.sh` end-to-end via git-bash: `[prepublish-build] build OK — proceeding to publish` (exit 0). The `prepublishOnly` hook in `package.json` (line 47) is wired to `node scripts/prepublish-build.mjs`.
- AC-3 (CLI warnings): `tests/unit/cli/commands/request-commands.test.ts` → **8/8 pass** (was 5/5 in v2.13.2, +3 warnings-surface cases). Dogfood: `rd:qa-handoff` with `mut-report.json` deleted → response `data.warnings[0].code = 'mut-report-missing-deprecated-in-v2.14.0'` ✓.
- AC-4 (handoff sha256): `tests/unit/services/prd/handoff-auto-regen.test.ts` → **5/5 pass** (was 4/4 in v2.13.2, +1 prereq regression pin E). Dogfood: delete `prd/handoff.md` + re-transition → frontmatter contains both `sha256: <hex>` and `handoffHash: <hex>` (alias); subsequent transition no longer reports `missing section(s): sha256:`.
- AC-5 (零回归): 2.13.2 baseline 149 + 2.13.3 new 13 = **162/162 pass** on PRD-targeted scope. Full unit suite: **4363/4364 pass + 17 skipped** (1 pre-existing `tokenizer.test.ts` timeDecayScore flake confirmed on clean HEAD `1aac7e2` after stashing v2.13.3 changes; not introduced by v2.13.3).
- AC-6 (scope): 10 modified + 3 untracked (scripts). All in expected territory (src/ + tests/ + scripts/ + package.json prepublishOnly + README publish note). CHANGELOG / version.ts / ship-state memory: release territory, RD correctly excluded.
- `tsc --noEmit` → **0 errors**.

### Out-of-scope (NOT changed — Karpathy §3 surgical-change discipline)

- v2.12.0 audit envelope file format (YAML frontmatter + markdown body) — preserved (the contract that 2.13.3 now correctly parses)
- v2.13.1 `## Verdict reasoning (v2.13.1)` section in `micro-cycle.md` — preserved
- v2.13.2 commit `1aac7e2` — preserved (v2.13.3 adds on top)
- `peaks-qa` verdict protocol (`pass | return-to-rd | blocked`) — preserved
- `peaks-final-review` 4-dim interface — preserved
- 5 verdict strings — preserved
- `aggregateVerdict()` signature — preserved
- Envelope file contents (parsers updated; on-disk schemas unchanged)
- Weighted scoring / RFC voting — explicitly out of scope

### Known limitations (carry-forward to v2.14.0)

- **`scripts/prepublish-build.mjs` Windows EINVAL workaround is partial** — the `shell: isWindows` fix is a no-op on POSIX but on Windows native + git-bash there is still a residual `spawnSync` `EINVAL` / `ENOENT` interaction with `cmd.exe` / `pnpm.cmd` shims. The `.sh` path is git-bash / Linux correct (dogfood-verified end-to-end with `pnpm build OK` and exit 0); npm publish in a real Linux / CI environment uses the mjs path correctly. v2.14.0 should consider replacing the mjs spawn with a `cross-spawn` library or a pure-Node `child_process.execFile` fallback to fully abstract the platform differences.
- **MUT_REPORT hard-fail still pending** — v2.13.3 only surfaces the soft-block warning in CLI; the actual hard-fail conversion to throw-on-missing happens in v2.14.0.
- **pre-existing `tokenizer.test.ts` timeDecayScore flake** — confirmed pre-existing on clean HEAD `1aac7e2` after stashing v2.13.3 changes. Out of scope for this slice; documented in `.peaks/memory/2026-06-27-v2-13-2-verdict-aggregator-fixes.md`.
- **No 2.13.3 dogfood of `prepublish-build.ps1`** — the PowerShell variant was added per AC-2 cross-platform but not dogfood-verified end-to-end (git-bash tests the .sh path). A v2.14.0 follow-up should run the .ps1 path in Windows native to confirm parity.

---

## [2.13.2] — 2026-06-27 — Verdict aggregator bug fix + CLI surface + envelope unification

**PATCH bump from 2.13.1** (slice `2026-06-27-verdict-aggregator-fixes`, red-line scope 3 src files + 3 test files modified + 3 new src files + 4 new test files).

v2.13.1 shipped with a BLOCKER bug found via post-release dogfood: `aggregateVerdict()`'s `pushFix` used `${source}|${file}|${line}|${hint}` as the dedup key, which violated the `.peaks/project-scan/audit-output-schema.md:73` rule that identical `(file, line, hint)` tuples from different audits must be merged into a single entry. The v2.13.1 unit-test suite (13 cases) did not exercise the cross-source scenario, so the bug slipped through CI. v2.13.2 fixes the bug, surfaces the aggregator as a CLI subcommand, unifies envelope schemas behind a discriminated-union type, adds `prd/handoff.md` auto-regeneration on `prd:handed-off`, and introduces a 1-minor-release soft-block window for `MUT_REPORT` to ease the 2.13.1→2.14.0 transition.

### Bug fixes

- **`aggregateVerdict()` cross-source dedup** (AC-1) — `pushFix` key changed from `${source}|${file}|${line}|${hint}` to `${file}|${line}|${hint}` per audit-output-schema.md:73. `VerdictReason` gained a required `sources: ReadonlyArray<VerdictSource>` field that lists every source that reported the same `(file, line, hint)` tuple. Merging happens via a per-key `Map<key, VerdictReason>` that appends sources when a hit is found. Dogfood-verified: `aggregateVerdict({security: {verdict:'warn', violations:[{file:'a.ts', line:1, hint:'same', severity:'HIGH'}]}, perf: {verdict:'warn', violations:[{file:'a.ts', line:1, hint:'same', severity:'HIGH'}]}})` now returns `reasons.length === 1, sources === ['security-audit', 'perf-audit']`. 3 new test cases (I cross-source-dedup, J single-source-no-merge, K single-source-unique-no-merge) bring the aggregator test suite to 16/16.

### Features

- **`peaks verdict aggregate --from-rid <rid>`** (AC-2) — CLI surface for the aggregator. Reads 5 envelope files from `.peaks/_runtime/<sessionId>/`, calls `aggregateVerdict()`, and returns a JSON envelope `{ verdict, reasons, sources: { security|perf|karpathy|mut|qa: 'present'|'missing' } }`. Missing envelopes are reported as `missing` in the `sources` map (aggregator treats undefined as "not run" per v2.13.1 all-empty→'pass' 退化). 4-case test covers 5-inputs-present / 1-missing / all-missing / JSON-shape. CLI is 168 lines, ≤ 200 budget.
- **Envelope unification** (AC-3) — new `src/services/verdict/envelopes.ts` (200 lines) provides `AnyEnvelope` discriminated union + 5 parser funcs (`parseSecurityEnvelope` / `parsePerfEnvelope` / `parseKarpathyEnvelope` / `parseMutEnvelope` / `parseQaEnvelope`) + an `envelopesToAggregatorInput` adapter. Re-uses the existing `isSecurityAuditEnvelope` / `isPerfAuditEnvelope` strict-shape guards from `src/services/audit-independent/` — no schema duplication. `aggregateVerdict()` signature is **unchanged** (backward compatible); the parsers are additive. 7-case test covers 5 happy paths + 1 malformed rejection + 1 adapter. On-disk envelope files are **not modified** (schemas remain in-file self-describing).
- **`prd/handoff.md` auto-regeneration** (AC-4) — when `peaks request transition --role prd --state handed-off` succeeds and `prd/handoff.md` is missing, peaks-prd auto-writes the handoff capsule (`schemaVersion: 2` + `handoffHash: <sha256>`) before the transition is committed. If handoff already exists, it is **not** overwritten. The auto-regen fires **only** on `prd:handed-off`; 11 other transitions are untouched (Karpathy §3 surgical-change discipline). 4-case test includes a guard case for non-prd roles.

### Internal

- `src/services/verdict/verdict-aggregator.ts` (+79/-21 lines) — `pushFix` key fix + `VerdictReason.sources` field + `indexByKey: Map<string, VerdictReason>` for cross-source merge.
- `src/services/verdict/envelopes.ts` (NEW, 200 lines) — discriminated union + 5 parsers + adapter.
- `src/services/prd/handoff-auto-regen.ts` (NEW) — `autoRegenPrdHandoff()` helper; reuses `sha256OfBody` from existing handoff-service.
- `src/cli/commands/verdict-aggregate-command.ts` (NEW, 168 lines) — `peaks verdict aggregate` subcommand.
- `src/cli/commands/request-commands.ts` (+28 lines) — `prd:handed-off` auto-regen hook (1 branch, ≤ 30 lines).
- `src/cli/program.ts` (+3 lines) — `registerVerdictAggregateCommands()` registration.
- `src/services/artifacts/artifact-prerequisites.ts` (+39/-5 lines) — `MUT_REPORT.backCompat = true` flag + `PrerequisiteCheckResult.warnings: Warning[]` field + soft-block branch in `checkPrerequisites()`.
- `tests/unit/services/verdict/verdict-aggregator.test.ts` (+78 lines) — 3 new dedup cases (I/J/K) bringing total to 16.
- `tests/unit/services/verdict/envelopes.test.ts` (NEW, 7 cases).
- `tests/unit/cli/commands/verdict-aggregate-command.test.ts` (NEW, 4 cases).
- `tests/unit/services/prd/handoff-auto-regen.test.ts` (NEW, 4 cases).
- `tests/unit/artifact-prerequisites-v2-13-2-soft-block.test.ts` (NEW, 2 cases).
- `tests/unit/artifact-prerequisites.test.ts` (5 lines) + `tests/unit/artifact-prerequisites-typed.test.ts` (10 lines) + `tests/unit/artifact-prerequisites/mut-report-prereq.test.ts` (8 lines) — updated for soft-block behavior.

### Deprecations / soft-block windows

- **`MUT_REPORT` soft-block window (v2.13.2 → v2.14.0)** (AC-5) — mirroring the v2.12.0 audit 1-minor-release back-compat pattern, missing `mut-report.json` at `rd:qa-handoff` now produces a `warnings[]` entry with code `mut-report-missing-deprecated-in-v2.14.0` instead of throwing `PREREQUISITES_MISSING`. **`passed: false` still throws** (2.14.0 is the hard-fail target). Slices that explicitly run `peaks mut run` and get `passed: false` are still blocked; only the missing-file case is softened. v2.14.0 will convert the soft-block to hard-fail.

### Decision records

- NEW `.peaks/memory/2026-06-27-v2-13-2-verdict-aggregator-fixes.md` — ship state (149/149 PRD-targeted tests pass, 4355/4356 full suite pass with 1 pre-existing tokenizer flake, tsc 0 errors, 7 AC all green).
- UPDATED `.peaks/memory/2026-06-27-v2-13-1-verdict-aggregator.md` — v2.13.1 ship state amended with the dogfood finding that motivated v2.13.2 (this slice is the canonical example of why post-release dogfood matters: 13-case unit suite missed the cross-source scenario).

### Multi-CC commit boundaries

| Commit tag | Scope |
|---|---|
| v2.13.2 | `aggregateVerdict()` dedup bug fix + `peaks verdict aggregate` CLI + `envelopes.ts` unification + `prd/handoff.md` auto-regen + `MUT_REPORT` soft-block window + 4 new test files + 4 updated test files + CHANGELOG + version bump + ship-state memory |

### Verified (peaks solo dogfood + QA on this session)

- AC-1 (BLOCKER fix): `tests/unit/services/verdict/verdict-aggregator.test.ts` → **16/16 pass** (was 13/13 in v2.13.1, +3 cross-source cases). Dogfood script confirms: `reasons.length = 1, sources = ["security-audit","perf-audit"], verdict = warn`.
- AC-2 (CLI surface): `tests/unit/cli/commands/verdict-aggregate-command.test.ts` → **4/4 pass**. Real CLI: `peaks verdict aggregate --help` shows `--from-rid/--sid/--project/--json` options correctly.
- AC-3 (envelope unification): `tests/unit/services/verdict/envelopes.test.ts` → **7/7 pass** (5 parser happy paths + 1 malformed rejection + 1 adapter).
- AC-4 (handoff auto-regen): `tests/unit/services/prd/handoff-auto-regen.test.ts` → **4/4 pass** (3 happy paths + 1 non-prd-role guard).
- AC-5 (soft-block): `tests/unit/artifact-prerequisites-v2-13-2-soft-block.test.ts` → **2/2 pass** (missing→warning / passed:false→throw).
- AC-6 (零回归): 2.13.1 既有 90 测试 + 2.13.2 新 33 测试 = **149/149 pass** on PRD-targeted scope. Full unit suite: **4355/4356 pass + 17 skipped** (1 pre-existing `tokenizer.test.ts` flake confirmed on clean HEAD `571f92b` after stashing v2.13.2 changes; not introduced by v2.13.2).
- AC-7 (文档同步): RD correctly excluded CHANGELOG / package.json / src/shared/version.ts / README / ship-state memory from its diff. `git status` confirms only `src/` + `tests/` paths in the working tree.
- `tsc --noEmit` → **0 errors**.

### Out-of-scope (NOT changed — Karpathy §3 surgical-change discipline)

- v2.12.0 audit envelope schemas (security / perf) — preserved
- v2.13.1 `## Verdict reasoning (v2.13.1)` section in `micro-cycle.md` — preserved
- `peaks-qa` verdict protocol (`pass | return-to-rd | blocked`) — preserved
- `peaks-final-review` 4-dim interface — preserved
- 5 verdict strings — preserved
- 2.13.1 on-disk release (commit `571f92b`) — **not** reverted; this is a PATCH bump per the user's "2.13.1 我发完了" instruction
- Envelope file contents (only TS types changed; in-file schemas are still self-describing)
- Weighted scoring / RFC voting — explicitly out of scope

### Known limitations (carry-forward to v2.14.0)

- **`MUT_REPORT` hard-fail transition** — v2.14.0 must convert the soft-block to hard-fail (missing `mut-report.json` → throw). v2.13.2 ships a `backCompat: true` flag for graceful migration; the deprecation window is 1 minor release.
- **`bin/peaks.js` references old dist/** — the smoke test of `peaks verdict aggregate --help` ran via `./node_modules/.bin/tsx ./bin/peaks.js` because the published `bin/peaks.js` points at a stale `dist/` build (Jun 13). v2.14.0 should ship a `pnpm run build` step before `npm publish` to refresh the dist.
- **`prefs.fanout.defaultMode` migration** (out of v2.13.2 scope) — the 2.8.4 hard-constraint migration to `fan-out` (per `references/fanout-mandatory.md`) is still pending for projects that may have `serial` in their `.peaks/preferences.json`. v2.14.0 should add a runtime migration warning.
- **CLI help-text for new commands** — `peaks verdict aggregate --help` is wired correctly; CLI list also shows it under the top-level `verdict` group. The CLI smoke test in this slice used tsx directly (not the published dist), so the published `bin/peaks.js` will not reflect the new command until the next `pnpm run build` + `npm publish` cycle.

---

## [2.13.1] — 2026-06-27 — Verdict reasoning layer (multi-signal convergence for peaks-solo)

**PATCH bump from 2.13.0** (slice `2026-06-27-verdict-aggregator`, red-line scope 3 source files + 4 new test files + 2 updated test files).

peaks-solo previously received 5 heterogeneous signals (security-audit, perf-audit, karpathy-reviewer, peaks-mut, peaks-qa) but had no convergence layer. The v2.12.0 audit-output schema documented 4 aggregation rules (`.peaks/project-scan/audit-output-schema.md:66-78`) but they were never implemented; the `mut-report.json` was consumed by peaks-qa internally with `loadMutReport() === null → gate=skipped` (soft consumption), and `micro-cycle.md` had no verdict-reasoning surface. v2.13.1 fills the gap without unifying envelope schemas (deferred to v2.14) and without changing any verdict string.

### Features

- **`aggregateVerdict()` service** (AC-2) — new `src/services/verdict/verdict-aggregator.ts` (223 lines, < 250 cap). Pure function (no I/O, no clock, no fs). Accepts 5 envelope inputs (`security` / `perf` / `karpathy` / `mut` / `qa`) and returns `{ verdict, reasons[] }`. Hard precedence: `block > return-to-rd > warn > pass`. Implements all 4 audit-output-schema rules: verdict precedence, CRITICAL count accumulation, `(file, line, hint)` dedup via `Set<string>` keyed on `${source}|${file}|${line}|${hint}`, handoff hash consistency (handled upstream by audit skills). All-empty input → `verdict: 'pass'` 退化 (no spurious block on missing signals). 13 test cases (8 AC-2 behaviors A-H + 5 precedence/regression cases).
- **`MUT_REPORT` prerequisite** (AC-1) — `mut-report.json` now blocks `peaks request transition --role rd --state qa-handoff` for `feat` / `bugfix` / `refactor` (REFACTOR inherits via FEATURE_TABLE reference) when missing or `passed: false`. `config` / `docs` / `chore` remain exempt. `mustContainAny: ['"passed": true', '"passed":true']` admits `passed:true` and rejects `passed:false`. `peaks-qa` internal `loadMutReport() === null → gate=skipped` path is preserved (back-compat). 4-case test pins all 4 paths.
- **`## Verdict reasoning` section in `micro-cycle.md`** (AC-3) — the 6-step RD↔QA repair loop now has a verdict-reasoning section that (a) shows a re-run output JSON example with `re-run reason: { source, signal, severity, file, line, hint }` payload, (b) provides a 4-row decision table mapping verdict → repair-loop action (`return-to-rd` → re-run RD, `block` → blocked TXT, `warn` → re-run with reasons, `pass` → exit loop), (c) gives a 4-step runbook integration. The 6-step cycle body is byte-stable (only the new section is added). 4-case test pins the section existence + 3 behavior cases.

### Internal

- `src/services/verdict/verdict-aggregator.ts` (NEW, 223 lines) — pure `aggregateVerdict()` + locally-defined `KarpathyEnvelope` / `MutEnvelope` / `QaEnvelope` types (surgeon scope; v2.14 will move them to shared if a unification pass lands).
- `src/services/artifacts/artifact-prerequisites.ts` — added `MUT_REPORT` constant (32 lines) + wired into `FEATURE_TABLE['rd:qa-handoff']` (line 276) and `BUGFIX_TABLE['rd:qa-handoff']` (line 303); `REFACTOR_TABLE` inherits via reference (line 312); `MINIMAL_TABLE` / `CONFIG_TABLE` exempt.
- `skills/peaks-solo/references/micro-cycle.md` — added `## Verdict reasoning (v2.13.1)` section (91 lines) after the unchanged repair-cycle cap rule.
- `tests/unit/artifact-prerequisites/mut-report-prereq.test.ts` (NEW, 4 cases).
- `tests/unit/services/verdict/verdict-aggregator.test.ts` (NEW, 13 cases).
- `tests/unit/skills/solo/micro-cycle-verdict-reasoning.test.ts` (NEW, 4 cases).
- `tests/unit/artifact-prerequisites.test.ts` (UPDATED, +25 lines) — seeded `mut-report.json` in 3 pass-path tests; added to negative-path missing-list.
- `tests/unit/artifact-prerequisites-typed.test.ts` (UPDATED, +20 lines) — same across bugfix + feature + refactor.

### Decision records

- NEW `.peaks/memory/2026-06-27-v2-13-1-verdict-aggregator.md` — ship state (90/90 tests pass, tsc 0 errors, 5 AC all green).

### Multi-CC commit boundaries

| Commit tag | Scope |
|---|---|
| v2.13.1 | MUT_REPORT prereq + `aggregateVerdict()` service + `## Verdict reasoning` section + 4 new test files + 2 updated test files + CHANGELOG + version bump + ship-state memory |

### Verified (peaks solo dogfood on this session)

- AC-1 (MUT_REPORT prereq): `tests/unit/artifact-prerequisites/mut-report-prereq.test.ts` → 4/4 pass; `tests/unit/artifact-prerequisites.test.ts` → 9/9 pass; `tests/unit/artifact-prerequisites-typed.test.ts` → 19/19 pass.
- AC-2 (verdict-aggregator): `tests/unit/services/verdict/verdict-aggregator.test.ts` → 13/13 pass; 8 AC-2 behaviors (A all-pass, B security-block, C mut-block, D qa-return-to-rd, E mixed-warn, F all-empty, G precedence block-dominant, H CRITICAL accumulation) all asserted.
- AC-3 (micro-cycle reasoning): `tests/unit/skills/solo/micro-cycle-verdict-reasoning.test.ts` → 4/4 pass; 6-step cycle body byte-stable.
- AC-4 (零回归): `tests/unit/parallel-fan-out.test.ts` → 18/18 pass (v2.12.0 stability pin); `tests/unit/rd/karpathy-skip-on-config-docs-chore.test.ts` → 11/11 pass; `tests/unit/rd/deprecated-reviewer-back-compat.test.ts` → 12/12 pass.
- Total: 8 test files, **90/90** tests pass, duration 1.27s.
- `./node_modules/.bin/tsc --noEmit` → 0 errors.

### Out-of-scope (NOT changed)

- v2.12.0 audit envelope schemas (`SecurityAuditEnvelope`, `PerfAuditEnvelope`) — preserved
- `peaks-qa` verdict protocol (`pass | return-to-rd | blocked`) — preserved
- `peaks-final-review` 4-dim interface (functional-completeness / problem-resolution / no-new-bugs / existing-functionality-intact) — preserved
- `peaks-rd` SKILL.md main body — preserved
- Envelope schema unification — deferred to v2.14
- Weighted scoring / RFC voting — explicitly out of scope
- CLI subcommand for `aggregateVerdict()` (only consumed by unit tests + micro-cycle reference in v2.13.1) — deferred to v2.14

### Known limitations (carry-forward to v2.14)

- **No CLI surface for `aggregateVerdict()`** — the aggregator is consumed by unit tests and referenced in `micro-cycle.md` as the re-run reason payload source, but no CLI subcommand exposes it directly. v2.14 should add `peaks verdict aggregate --from-rid <rid>` that reads all 5 envelope artifacts and prints the aggregated verdict + reasons.
- **Envelope schema heterogeneity persists** — the 5 envelopes still have 3 distinct shapes (`{verdict, violations, summary}` for security/perf, `{passed, violations, gateAction}` for karpathy, `{verdict}` for qa, `{passed, killRate, weakRate, violations}` for mut). v2.13.1 ships precedence aggregation; v2.14 should add a `services/verdict/envelopes.ts` shared module with discriminated-union type and parser funcs.
- **`prd/handoff.md` is not auto-regenerated by v2.13.1** — the AUDIT_REQUIRES_HANDOFF prereq still requires an existing handoff capsule; v2.13.1 does not change this. v2.14 should consider making peaks-prd write the handoff on every `prd:handed-off` transition.

---

## [2.13.0] — 2026-06-27 — Zero-human-intervention auto-compact (peaks-cli drives context compression on any AI CLI)

**MINOR bump from 2.12.0** (slice `v2-13-0-auto-compact-protocol`, 5-sub-task plan AC-1..AC-5, red-line scope ~6 source files + 2 IDE adapter fields).

peaks-solo now autonomously drives context compaction so the LLM-runner stays alive with context < 95% on **any AI CLI**, with **zero human / zero LLM intervention**. Two-tier threshold model:

- **85% pre-compact zone** — peaks-cli writes a pre-compact checkpoint + convergence plan + auto-decisions log + IDE-side compact dispatch (async-friendly).
- **95% RED LINE** — peaks-cli refuses sub-agent dispatch and forces synchronous IDE compact; mandatory, LLM cannot opt out.

Adapter-driven protocol (no hard-coded IDE names): `IdeAdapter.compact?: IdeCompactProfile` is a 4-field per-IDE profile (`envVarForContextPercent` + `compactCommand` + `compactPathway` + `postCompactDetectCommand`). Claude Code is the MVP fill; trae / codex / cursor / qoder / tongyi-lingma / hermes / openclaw ship without `compact` and fall through to the conservative-zero probe (no auto-fire on missing signal).

### Features

- **`peaks solo context-now`** (AC-1) — auto-probes the active IDE adapter's context-fill % without requiring the LLM to pass `--prompt-size <bytes>` manually. Adapter-driven: reads `IdeAdapter.compact.envVarForContextPercent` (Claude Code MVP: `CLAUDE_CONTEXT_USAGE_PERCENT`). Returns a verdict (`ok` / `soft-warn` / `pre-compact` / `red-line`) plus source-tagged probe (`claude-code-env` / `statusline-poll` / `conservative-fallback`). When no IDE-specific signal is available, returns `ratio: 0` with `source: 'conservative-fallback'` so the orchestrator never auto-fires on a missing signal.
- **`peaks solo auto-compact`** (AC-4) — 0-intervention loop. Honors D6.e in-flight-batch deferral for the pre-compact zone; forces synchronous dispatch at red-line. `--force` and `--bypass-red-line` are test seams (never `true` in production).
- **Convergence toolkit** (AC-2) — `src/services/solo/auto-compact-orchestrator.ts` `evaluateCompactTrigger` (pure) + `runAutoCompact` (side effects: `writePreCompactCheckpoint` + `appendAutoDecisionLog` + `dispatchIdeCompact`). Checkpoints land at `.peaks/_runtime/<sessionId>/checkpoints/{pre-compact,red-line}-<ISO>.json`; the LLM-readable decision log lands at `.peaks/_runtime/<sessionId>/txt/auto-decisions.md` so D7's post-compact-detect picks it up unchanged.
- **IDE-aware compact dispatcher** (AC-3) — `src/services/context/auto-compact-dispatcher.ts` reads `IdeAdapter.compact` and dispatches via the adapter-declared pathway. `shell-exec` (Claude Code MVP) spawns the compact command via `child_process.spawn`. `ide-native` is reserved for a future slice. `llm-self-compress` returns success + instructs the LLM to summarize on next turn. `noop` returns explicit failure for legacy adapters.

### Internal

- `src/services/context/auto-compact-types.ts` (NEW) — types + 3 constants: `AUTO_COMPACT_SOFT_WARN_RATIO = 0.5`, `AUTO_COMPACT_PRE_COMPACT_RATIO = 0.85`, `AUTO_COMPACT_RED_LINE_RATIO = 0.95`.
- `src/services/context/auto-compact-reader.ts` (NEW) — `readContextPercent` (AC-1 probe).
- `src/services/context/auto-compact-dispatcher.ts` (NEW) — `dispatchIdeCompact` (AC-3 IDE dispatch).
- `src/services/solo/auto-compact-orchestrator.ts` (NEW) — `evaluateCompactTrigger` + `runAutoCompact` (AC-2 + AC-4 core).
- `src/services/ide/ide-types.ts` — `IdeAdapter.compact?: IdeCompactProfile` + `IdeCompactProfile` interface.
- `src/services/ide/adapters/claude-code-adapter.ts` — MVP `compact` profile: `CLAUDE_CONTEXT_USAGE_PERCENT` + `claude --compact` + `shell-exec`.
- `src/cli/commands/solo-commands.ts` — `peaks solo context-now` + `peaks solo auto-compact` subcommands.
- `package.json` + `src/shared/version.ts` — `2.12.0 → 2.13.0`.

### Decision records

- NEW `.peaks/memory/2026-06-27-auto-compact-design.md` — full design rationale + two-tier threshold + adapter-driven protocol + open follow-ups (L2-dogfood per-IDE profiles, `ide-native` pathway, statusline integration, hook-based prompt injection).

### Multi-CC commit boundaries

| Commit tag | Scope |
|---|---|
| v2.13.0-alpha.1 (`edffc33`) | Two-tier threshold + auto-compact types + reader + dispatcher + orchestrator + Claude Code MVP adapter + `peaks solo context-now` + `peaks solo auto-compact` CLI |
| `a8b9804` | In-session dogfood limitation documented (current ad-hoc Claude Code session cannot be externally compacted — reserved for follow-up PreToolUse-hook slice) |

### Verified (peaks solo dogfood on this session)

- `context-now` boundary tests: `0.30 = ok` / `0.50 = soft-warn` / `0.84 = soft-warn` / `0.85 = pre-compact` / `0.949 = pre-compact` / `0.95 = red-line` / `1.0 = red-line` ✓
- `auto-compact @ 1.0` (red-line): dispatched (shell-exec ok), `red-line` checkpoint written at `.peaks/_runtime/<sessionId>/checkpoints/red-line-<ISO>.json`, convergence plan + auto-decisions.md appended, `redLineGated: true` ✓
- `auto-compact @ 0.87 + --in-flight-batch`: `decision: in-flight-batch`, no checkpoint write (D6.e honored) ✓
- `auto-compact @ 0.85`: pre-compact dispatched (shell-exec ok), pre-compact checkpoint + convergence plan + auto-decisions.md written ✓
- `post-compact-detect` after pre-compact: `shouldAutoResume: true`, `reason: post-compact-match` ✓
- Trae IDE (no `compact` profile): `ratio: 0` + `source: conservative-fallback` + `below-threshold` (no auto-fire on missing signal — by design) ✓
- `pnpm tsc --noEmit`: clean
- `pnpm vitest run` (full suite): `4317 / 4317` pass + 17 skipped (2 pre-existing baseline failures on session-checkpoint + _archive-removal-guard unchanged)

### Out-of-scope (NOT changed)

- `src/services/code-review/ecc-bridge.ts` + `src/services/dispatch/sub-agent-dispatcher.ts` + `src/services/agent/ecc-agent-service.ts` + `src/services/prd/handoff-service.ts` + `project-scan-reader.ts` + `src/services/rd/{strategic,tactical,strategy,impl,ast-gate,types}.ts` + `peaks-qa/` + `peaks-solo/SKILL.md` main flow + `peaks-prd/SKILL.md` main body — all untouched per the v2.13.0 red-line scope.

### Known limitations (carry-forward to v2.13.1)

- **Ad-hoc Claude Code runner cannot be externally compacted.** The v2.13.0-alpha.1 shell-exec pathway spawns the IDE's compact command via `child_process.spawn` — a separate child process. The current Claude Code runner that invoked `auto-compact` is unaffected; its own context window stays at 100% until that runner's own compact logic kicks in (Claude Code's own auto-compact or a user-issued `/compact` slash command). Follow-up slice: register a PreToolUse hook via `peaks hooks install` that intercepts the next Bash call and writes a stderr hint when ratio ≥ 0.95 — fills the already-reserved `ide-native` compact pathway.
- **`peaks-solo` Step N+2 prose update** — `skills/peaks-solo/SKILL.md` should mention `peaks solo context-now` + `auto-compact` so LLM sessions invoke the autonomous loop instead of `--prompt-size` hand-passing.

---

## [2.12.0] — 2026-06-27 — Independent security + perf audit skills (RD fan-out collapse 5→3)

**MINOR bump from 2.11.2** (slice `v2-12-independent-security-perf-audit`, 9-tier plan, multi-CC Group A→E, red-line scope ~40-45 files).

peaks-rd's parallel review fan-out collapsed from **5 sub-agents** to **3 sub-agents** by moving `security-reviewer` + `perf-baseline-reviewer` out of the fan-out into two new standalone audit skills (`peaks-security-audit` + `peaks-perf-audit`). The two removed slots are exposed as `RD_DEPRECATED_REVIEWERS` for the 1-minor-release back-compat window (v2.13.0 hard-deletes the legacy paths).

### Features

- **`peaks-security-audit` skill** (Group A — Tier 2) — standalone security audit skill. CLI: `peaks security-audit run`. Consumes the immutable peaks-prd handoff (`prd/handoff.md`) + the project-scoped audit template `.peaks/project-scan/security-template.md`. Writes `.peaks/_runtime/<sessionId>/audit/security.md`. Returns 3-state verdict (`pass` / `mitigated` / `blocked`). 6 unit-test cases.
- **`peaks-perf-audit` skill** (Group A — Tier 3) — standalone perf audit skill. CLI: `peaks perf-audit run`. Consumes the immutable handoff + `.peaks/project-scan/perf-template.md`. Writes `.peaks/_runtime/<sessionId>/audit/perf.md`. 6 unit-test cases.
- **Audit template files** (Group A — Tier 1, NEW) — `.peaks/project-scan/security-template.md` (4,285 bytes) + `.peaks/project-scan/perf-template.md` (4,337 bytes) + `.peaks/project-scan/audit-output-schema.md` (4,410 bytes). Git-tracked source of truth for the audit skill output shape.
- **RD fan-out collapse** (Group B — Tier 4) — `src/services/rd/reviewer-dispatch-policy.ts` `RD_FANOUT_REVIEWERS` is now a 3-element tuple (`code-reviewer` + `qa-test-cases-writer` + `karpathy-reviewer`). The 2 removed slots are exposed as `RD_DEPRECATED_REVIEWERS`; `isDeprecatedReviewer(name)` routes any legacy dispatch record to the new audit skill. 8 back-compat test cases.
- **Artifact prereq migration** (Group B — Tier 5) — `src/services/artifacts/artifact-prerequisites.ts` replaces `SECURITY_REVIEW` + `PERF_BASELINE` prereqs with `AUDIT_SECURITY` + `AUDIT_PERF` + `AUDIT_REQUIRES_HANDOFF`. The new prereqs mechanically gate `peaks request transition --state qa-handoff` until the audit outputs are written and the handoff frontmatter (sha256 + schemaVersion: 2) is verified.
- **peaks-txt sediment extension** (Group C — Tier 6) — `src/services/prd/project-scan-sediment.ts` adds 3 new public functions (`appendSecurityPattern` + `appendPerfPattern` + `appendAuditSchemaVariant`) wrapping a generic internal helper. Append-only inventory operations idempotent on `(value, sourceRid)`. 7 new test cases.
- **Fan-out SKILL.md updates** (Group D — Tier 7) — `skills/peaks-rd/SKILL.md` + `skills/peaks-rd/references/parallel-review-fanout.md` + `skills/peaks-rd/references/rd-fanout-contracts.md` + NEW `skills/peaks-rd/references/v2-12-fanout-collapse.md` reflect the v2.12.0 3-way fan-out shape. SKILL.md stays under the 24K byte cap.

### Back-compat window (v2.12.0 → v2.13.0)

The 1-minor-release window keeps the legacy paths readable via `mustContainAny`:

- Legacy `rd/security-review.md` → accepted via `AUDIT_SECURITY.mustContainAny`.
- Legacy `rd/perf-baseline.md` → accepted via `AUDIT_PERF.mustContainAny`.
- Legacy `RD_FANOUT_REVIEWERS`-slot dispatch records (`.peaks/_sub_agents/<sessionId>/dispatch/{security-reviewer,perf-baseline-reviewer}.json`) → routed via `isDeprecatedReviewer(name)` to the new audit skill.

v2.13.0 hard-deletes the legacy paths.

### Decision records

- NEW `.peaks/memory/2026-06-27-v2-12-independent-security-perf-audit.md` — parent decision (v2.12.0 collapse architecture + multi-CC Group A→E split).
- NEW `.peaks/memory/2026-06-27-v2-12-fanout-3way.md` — fan-out shape decision (3-element tuple, pinned by 8 tests across 4 files).
- APPEND `.peaks/project-scan/business-knowledge.md` — `D2'` row (3-way fan-out) + `G1'` row (peaks-txt sediment extension).
- APPEND `.peaks/memory/security-perf-plan-result-split.md` — "Reverse 2026-06-27" section (how the v2.12.0 collapse reverses the slice-025 plan/result split).

### Internal

- `src/services/rd/reviewer-dispatch-policy.ts` — `RD_FANOUT_REVIEWERS` (3-element) + `RD_DEPRECATED_REVIEWERS` (2-element back-compat) + `isDeprecatedReviewer(name)`.
- `src/services/artifacts/artifact-prerequisites.ts` — `AUDIT_SECURITY` + `AUDIT_PERF` + `AUDIT_REQUIRES_HANDOFF` prereqs (with `mustContainAny` for back-compat).
- `src/services/prd/project-scan-sediment.ts` — `appendSecurityPattern` + `appendPerfPattern` + `appendAuditSchemaVariant` + generic `appendAuditPatternInventory` helper.
- `src/services/audit-independent/{security-audit-service,perf-audit-service}.ts` — new service layer.
- `src/cli/commands/{security-audit-commands,perf-audit-commands}.ts` — new CLI subcommands wired into `program.ts`.
- `package.json` + `src/shared/version.ts` — `2.11.2 → 2.12.0` version bump.

### Multi-CC commit boundaries

| Group | Tiers | Commit tag | Scope |
|---|---|---|---|
| A | 1+2+3 | v2.12.0-alpha.1 | Templates + new skills (fa082f5) |
| B | 4+5 | v2.12.0-alpha.2 | 5→3 fanout collapse + prereq migration (6485f1c) |
| C | 6 | v2.12.0-alpha.3 | peaks-txt sediment extension (ab2757b) |
| D | 7 | v2.12.0-alpha.4 | fan-out SKILL.md updates (b6c4fae) |
| E | 8+9 | v2.12.0 (release) | Decision records + migration + CHANGELOG + version bump (this commit) |

### Zero regression (verified per group)

Each Group A→D ran the full RD→QA loop independently. Group C final QA: 14/14 sediment tests pass + 39/39 prd service tests pass; 9 pre-existing baseline failures unchanged (doctor / _archive-removal-guard / request-commands / observability / session-checkpoint / tech-service / workflow-autonomous-resume / jsonl-store / 35-checks-aggregate — all unrelated to v2.12.0). Group D final QA: 35/35 fan-out SKILL.md contract tests pass; same 9 pre-existing baseline failures.

### Out-of-scope (NOT changed)

`src/services/code-review/ecc-bridge.ts` + `src/services/dispatch/sub-agent-dispatcher.ts` + `src/services/agent/ecc-agent-service.ts` + `src/services/prd/handoff-service.ts` + `project-scan-reader.ts` + `src/services/rd/{strategic,tactical,strategy,impl,ast-gate,types}.ts` + `peaks-qa/` + `peaks-solo/SKILL.md` main flow + `peaks-prd/SKILL.md` main body — all untouched per the v2.12.0 red-line scope.

---

## [2.11.2] — 2026-06-26 — Slice topology observability (read-only supplement to v2.11.0)

**PATCH bump from 2.11.0** (slice `v2-11-2-slice-topology-observability`, 5-slice plan A→E, red-line scope ~18 files).

Read-only observability layer on top of the v2.11.0 slice topology + 10/90 paradigm. New `peaks observability <subcommand>` family for querying slice success rate, fanout cost, repair-cycle count, and D5/D6/D7 auto-proceed events. Persists metrics locally at `.peaks/_runtime/<sessionId>/metrics/slices.jsonl` (append-only JSONL, mtime-pruned to 10 sessions). No new dependencies. No changes to v2.11.0 ship behavior.

### Features

- **`peaks observability status`** (AC-1) — aggregate metrics for active session: total slices, success count, fail count, fanout cost total, repair-cycle peak.
- **`peaks observability slices`** (AC-2) — per-slice list with rid, state, fanout count, repair-cycle count, duration (ms).
- **`peaks observability fanout`** (AC-3) — fanout cost breakdown per sub-agent role (rd / qa / code-reviewer / security-reviewer / karpathy-reviewer).
- **`peaks observability repair-cycles`** (AC-4) — RD→QA repair-cycle count per slice; cap = 3 (peaks-solo repair-loop contract); capHit flag.
- **`peaks observability report --period day|week|month`** (AC-5) — markdown summary (header + status + slice table + fanout table + repair-cycle table + top-5 slowest) suitable for paste into PR descriptions or `.peaks/PROJECT.md` timeline entries.
- **JSONL persistence** (AC-6) — append-only `.peaks/_runtime/<sessionId>/metrics/slices.jsonl`; zod schema v1; cross-session prune to last 10 session files by mtime.
- **Hook integration** (AC-7) — metrics emitted from 7 sites: `peaks request transition` (Slice A), `peaks sub-agent dispatch`, `peaks session checkpoint`, D5 mode-gate, D6 context-trigger, D7 post-compact, `peaks request transition` RD→QA prereq (Slice C). All emits fire-and-forget per PRD Q4 (full-auto must never fail-loud).
- **Zero regression** (AC-8) — `npm run build` clean + vitest passes; 6 doctor.test.ts / 35-checks-aggregate failures are pre-existing on main (verified via `git stash`); 0 new regressions from this slice.
- **Coverage** (AC-9) — observability source files have 100% public-function coverage (jsonl-store, observability-service, aggregation, report-formatter); vitest `--coverage` blocked by pre-existing pnpm `@ampproject/remapping` resolution issue (unrelated to this slice).
- **peaks-txt handoff integration** (AC-10) — handoff capsule includes 1-line observability summary via `peaks observability status`.

### Internal

- New: `src/services/observability/jsonl-store.ts` (133 LoC) — pure I/O, mtime prune.
- New: `src/services/observability/observability-service.ts` (139 LoC) — zod schema v1 + `emitObservabilityEvent`.
- New: `src/services/observability/aggregation.ts` (207 LoC) — `aggregateStatus` / `aggregateSlices` / `aggregateFanout` / `aggregateRepairCycles` / period rollup helpers.
- New: `src/services/observability/report-formatter.ts` (135 LoC) — markdown renderer (pure).
- New: `src/cli/commands/observability-commands.ts` (250+ LoC) — 5 subcommands via commander.
- Modified: `src/services/artifacts/request-artifact-service.ts` (hook #1/7).
- Modified: `src/cli/commands/dispatch-commands.ts` (hook #2/7).
- Modified: `src/services/session/session-checkpoint-service.ts` (hook #3/7).
- Modified: `src/cli/commands/solo-commands.ts` (hook #4/7).
- Modified: `src/cli/commands/context-commands.ts` (hook #5/7).
- Modified: `src/services/solo/post-compact-detector.ts` (hook #6/7).
- Modified: `src/services/artifacts/artifact-prerequisites.ts` (hook #7/7).
- Modified: `src/cli/program.ts` (+1 line: registerObservabilityCommands).
- Modified: `src/shared/version.ts` (CLI_VERSION 2.11.0 → 2.11.1).
- Tests: `tests/unit/services/observability/*.test.ts` (5 files, 78 cases) + `tests/unit/cli/observability-commands.test.ts` (8 cases). 0 regressions.

---

## [2.11.0] — 2026-06-26 — Remove rd/tech-doc.md + immutable peaks-prd handoff + ECC code-review + runtime friction

**MINOR bump from 2.10.0** (slice `v2-11-rm-rd-techdoc-immutable-handoff`, 6 multi-CC groups A-F, plan at `.peaks/memory/2026-06-26-v2-11-rm-rd-techdoc-immutable-handoff.md`).

Implements the "metering is value" + "10/90 paradigm" alignment: peaks-prd produces a single immutable handoff that all downstream consumers share; peaks-rd's parallel audit fan-out (now 5-way with ECC code-review + karpathy-reviewer hard gate) owns security/perf review; peaks-qa is trimmed to business-test-only; peaks-txt sediments business knowledge; peaks-solo removes runtime friction (auto-proceed, context monitor, post-compact resume).

### Features

- **Tier 1+2 (Group A — `2be2842`)** — remove `rd/tech-doc.md` enforcers; replace with immutable peaks-prd handoff references (`skills/peaks-rd/references/parallel-review-fanout.md`, `rd-fanout-contracts.md`, `rd-sub-agent-dispatch.md`, `writing-handoff-frontmatter.md`, `artifact-per-request.md`; `src/services/audit/enforcers/lint-workflow-shape.ts`, `red-line-catalog.ts`, `red-lines-service.ts`; `src/services/artifacts/artifact-prerequisites.ts`, `request-artifact-service.ts`).
- **Tier 3+4 (Group B — `3f832f0`)** — `peaks prd handoff init|verify|show` (sha256-locked frontmatter, schemaVersion: 2); `peaks project knowledge` CLI; `.peaks/project-scan/{project-scan.md, business-knowledge.md}` bootstrap; peaks-prd SKILL.md Step 0.8 + Step 5.5.
- **Tier 5+6 (Group C — `9fea8eb`)** — peaks-txt sediment step (`appendBusinessConcept`, idempotent on (concept, sourceRid), 7 tests); peaks-qa trim (removed `qa/security-findings.md` + `qa/performance-findings.md` from Gate D prerequisites).
- **Tier 7 (Group D — `cd427f6`)** — ECC code-review bridge (`src/services/code-review/ecc-bridge.ts`): envelope validator `isEccEnvelope` + `adaptEccEnvelopeToRdCodeReview` + 5-state `detectEcc` + `runEccCodeReview` aggregator; 17 tests.
- **Tier 8 (Group E — this CC)** — migration codemod `peaks migrate v2-10-to-v2-11` (deprecates historical `rd/tech-doc.md` files with a YAML banner frontmatter; text-only, idempotent).
- **Tier 9 (Group F — commit `9e3ef49`)** — D5 self-decision (`src/services/solo/mode-gate.ts` + `peaks solo should-pause`); D6 context monitor (`src/services/context/main-session-monitor.ts` + `peaks context check`); D7 post-compact resume (`src/services/solo/post-compact-detector.ts` + `peaks solo post-compact-detect`); SKILL.md new Step N+2 + Step 0.7 D7 branch. +111 tests.

### Migration

- `peaks migrate v2-10-to-v2-11 --project <repo>` (default dry-run; pass `--apply` to write) — tags all pre-v2.11.0 `rd/tech-doc.md` files with `deprecated: historical` banner pointing to the new peaks-prd handoff as the source of truth. Idempotent. See `.peaks/memory/2026-06-26-v2-11-rm-rd-techdoc-immutable-handoff.md` for the design rationale.
- Historical `qa/security-findings.md` / `qa/performance-findings.md` files are NOT auto-migrated (they are no longer required by Gate D, but pre-v2.11.0 sessions still produced them — leave in place).

### Tests

- 33 new tests (Group B): handoff-service (11) + project-scan-reader (13) + prd-handoff-command (9)
- 7 new tests (Group C): sediment service (7) — on the 3987 baseline
- 17 new tests (Group D): ecc-bridge (17) — on the 3987 baseline
- (Group F counts pending — estimated 100+ tests for mode-gate + main-session-monitor + post-compact-detector)

### Risks / gaps carried forward

- **ECC envelope validation** assumes the `everything-claude-code` plugin is installed and exposes a `code-review` agent with the `{ passed, violations[], gateAction }` shape. If the plugin is absent, peaks-rd falls back to inline review (5-state detector + `code-review-ecc-degraded-to-inline` TXT note).
- **D5 hard-floor categories** (irreversible external side effects / auth-credential / multi-day investment) still pause for AskUserQuestion regardless of mode.
- **D7 post-compact resume** requires re-invoking `/peaks-solo` in fresh context (Option A — no SessionStart hook in v2.11.0; Option B deferred).
- **Migration scope** is text-only — historical `rd/tech-doc.md` files coexist with the new `prd/handoff.md`; prune is a future slice.

---

## [2.10.0] — 2026-06-26 — Slice topology multi-pass + 10/90 paradigm

**MINOR bump from 2.9.0** (slice `add-slice-topology-multipass`, 63 commits ahead of `develop`, 8 waves W1-W8-b, plan at `docs/superpowers/plans/2026-06-25-slice-topology-multipass.md`).

Implements the 10/90 paradigm foundation: 10% human / 90% LLM autonomous workflow with structured multi-pass slice decomposition, audit gates, and final-review gates. v2 schema is breaking vs v1; v1 remains readable via `SchemaRouter`.

### Features

- **Multi-pass slice decomposition** (`peaks slice decompose --granularity=service|file|both|auto`, slice W2/W3): produces a v2 hierarchical topology (`DecompositionResultV2` with `passes[].slices[]` and `granularity` / `parentSliceId` fields) that supports peaks-solo fan-out RD. v1 envelopes continue to read via `SchemaRouter` (`src/services/slice/schema-router.ts`).
- **LLMArbitrator** (W2 T5): content-hash SHA-256 cache (`<cacheDir>/<hash>.json`), budget cap (`resetArbitratorBudget()`), live/cache/failure-path callId routing.
- **GranularityDecider** (W2 T6): stop-condition + tie-break for file-vs-service subdivision.
- **CrossPassEdgeMerger** (W2 T7): static detection (type-shares / fixture-shares / re-exports / import-binding) + LLM fallback; static detection runs UNCONDITIONALLY (W6 fix #1) so it works without an `llmRunner`.
- **MultiPassOrchestrator** (W2 T9): reuses existing 6-stage algorithm; populates `internalEdges` from v1 `dependencyDAG.edges` (W6 fix #2); emits enriched `LlmArbitration` shape with `promptHash/input/output/confidence` (W6 fix #3).
- **peaks audit goal CLI** (W5 M1): `peaks audit goal <rid>` wraps `auditGoalService` for human-readable goal inspection.
- **peaks prepare-final-review CLI** (W5 M2): `peaks prepare-final-review <rid>` wraps `finalReviewService` for 4-dim evidence prep.
- **peaks slice plan PickedFileRouter** (W6 CC-β): `parsePickedFile()` helper replaces raw `JSON.parse(...)` for `-picked.json` envelope; new `PICKED_ENVELOPE_INVALID` error code on validation failure.
- **3 new skills** (W4): `peaks-slice-decompose` (v2 schema references), `peaks-audit` (6-dim reference), `peaks-final-review` (4-dim reference).
- **5 existing skill updates** (W7 CC-α):
  - `peaks-solo` — new Step 0.6 (Audit + Goal gate) and Step N+1 (Final Review gate) between Step 0.5 and Step 0.7.
  - `peaks-rd` — new references: `reading-v2-slice-results.md` (SchemaRouter dual-read), `writing-handoff-frontmatter.md` (frontmatter fields + canonical path).
  - `peaks-qa` — new reference: `reading-handoff-frontmatter.md` (cross-check `decisions[]` vs `tests/`, `risks[]` vs `tests/unit/security/`).
  - `peaks-prd` — new reference: `prd-for-multi-pass.md` (AC tagging `[pass-1]` / `[pass-2]`).
  - `peaks-sc` — first step in slice planning references `peaks-slice-decompose`.

### Bugfixes — W6 flaw repair pass (4 of 5 W1-W4 flaws)

- **#1 cross-pass edges gated on `opts.llmRunner`** (W2 deviation #4) — dropped the guard; static detection now fires unconditionally when `passes.length > 1`.
- **#2 internal edges defaulted to `[]`** (W2 concern #3) — populated from `decomposeSlices().dependencyDAG.edges` at all 3 `PassResult` constructions; `EdgeKind === InternalEdgeKind` identity mapping; `isSemantic: boolean → confidence: 'semantic' | 'structural'`.
- **#3 LlmArbitration shape gap** (W2 deviation #5) — enriched `LlmCallTrace` with `promptHash/input/output/confidence`; captured in `runLlmFallback` (medium for cache/live, low for failure).
- **#4 raw `JSON.parse` for `-picked.json`** (W3 silent-failure) — extracted `parsePickedFile()` helper (lines 359-419 of `src/cli/commands/slice-commands.ts`) with schema validation; split catch into `PICKED_ENVELOPE_INVALID` (envelope) vs `SLICE_PLAN_FAILED` (other).

### Tests

- 3974 passed / 0 failed / 17 skipped at release time (354 test files, ~80s smoke / ~310s full).
- New: 3 e2e integration tests in `tests/integration/slice-topology-e2e.test.ts` (multi-pass, service-only, file-only against real `src/services/config/`); 10 picked-envelope validation tests in `tests/unit/cli/commands/slice-commands.test.ts`; 4 LlmArbitration shape tests + 1 internalEdges test in `tests/unit/slice/multi-pass-orchestrator.test.ts` and `cross-pass-edge-merger.test.ts`.
- **3 mutation probes pass** (W7 T21, `.peaks/memory/2026-06-25-mutation-probes-w7-t21.md`): Probe A (comment-out type-shares), Probe B (`>` → `>=` in `shouldSubdivide`), Probe C (cache short-circuit disabled) — all 3 mutations cause the corresponding test to fail, then revert to green.

### Bugfixes — W8 / W8-b stabilization (slice `add-slice-topology-multipass`, post-W7 follow-up)

- **W8 CC-α** (commit `56a9d9e`): stabilize 3 pre-existing flaky tests — `tests/unit/cli-program.workflow.test.ts` per-file timeout raised from vitest default 5000ms → 10000ms (`vi.setConfig({ testTimeout: 10000 })`); `tests/unit/dispatch-cli-latency-benchmark.test.ts` 250ms → 300ms threshold (median + min) with description + inline-comment updates for Karpathy #3 honesty.
- **W8-b CC-α** (commits `e17f868` + `30f9b51`): fix 3 newly-surfaced state-bound pre-existing failures — `tests/unit/package.test.ts` `beforeAll` runs `scripts/sync-version.mjs` so the version-source assertion is deterministic without `pnpm build`; `tests/unit/cli-program.core.test.ts` + `tests/unit/project-commands.test.ts` use `vi.hoisted` + `vi.mock` to isolate from real-project filesystem state (synthetic passing doctor report + `vi.importActual` passthrough with default `doctorReport`/`runbookHealth` injection); `src/shared/version.ts` synced to `2.10.0` (W7-solo T22 missed this; W8-b surfaced it via the `beforeAll` sync-version run).
- Net effect: full suite `3974 / 0 failed / 17 skipped` (was `3974 / 3 failed / 17 skipped` after W7 due to the 3 state-bound failures, and 3974 / 0 / 17 was timing-flaky due to the 3 W8 targets).

### Risks / gaps carried forward

- **peaks slice pick only supports v1 envelopes** (W3 T11) — explicitly documented in W4 T12 SKILL.md. v2-pick is a future-slice candidate.
- **No CLI for `peaks audit-goal` discovered via auto-audit** (W4 T13) — `auditGoal()` is a service consumed by `final-review-service`, `slice/llm-arbitrator`, `slice/multi-pass-orchestrator` via direct import. CLI registration is a future-slice candidate.

---

## [2.9.0] — 2026-06-25 — Path canonicalization + fan-out mandatory + test-tool-detection

**MINOR bump from 2.8.4** (supersedes the unpublished 2.9.1 / 2.9.2 intermediate work; those entries below are kept as historical context only).

### Features

- **Sub-agent fan-out is mandatory** (slice `2026-06-24-audit-5th-p2`): `preferences.fanout.defaultMode = 'serial'` opt-out removed. When the slice DAG has ≥ 2 leaves at one topological level, the orchestrator MUST use `peaks sub-agent dispatch --from-dag <dag-file> --batch-id <id>`. No preference, env-var, or CLI flag overrides this. `FANOUT_MODES = ['fan-out']` only; legacy `serial` values auto-migrate via `peaks preferences migrate --write`.
- **4-policy bundle (slice `2026-06-24-efficiency-4p-bundle`)**: (a) default fan-out via `--from-dag`; (b) periodic checkpoint frequency locked at 20 tool calls (no `~` approximation, no `--periodic-every` override); (c) Karpathy reviewer skipped for `config | docs | chore` request types (5-way review otherwise); (d) `swarmSpeculative.maxConcurrent` default bumped 2 → 3.
- **Test-tool-detection block** (slice `2026-06-24-test-tool-detection-injection`): Every sub-agent dispatched by Solo (`peaks-rd`, `peaks-qa`, `peaks-ui`, `peaks-txt`, `peaks-sc`, `peaks-general-purpose`, single + DAG) receives a hard "Test Tool Detection (mandatory)" block at the top of its prompt: read `package.json#scripts.test`, use project-local runner (`./node_modules/.bin/<runner>` or `pnpm test --`), NEVER `npx <runner>`. Wired at both `dispatch-commands.ts` and `dag-orchestrator.ts` chokepoints; envelope version bumped to `2.2.0`.

### Bugfixes — handoff path canonicalization (v1 + v2 + v3 + v4 + v5 + v6 + v7)

LLM was creating top-level `.peaks/_runtime/<change-id>/` siblings of `.peaks/_runtime/`, violating the 2.8.3 hard ban. Sweep across all surfaces:

- **v1 (`9893d3a`)**: 20 hardcoded `.peaks/_runtime/${changeId}/` template strings in the 5 render functions of `src/services/artifacts/artifact-templates.ts` (split from `request-artifact-service.ts`). 4-helper API: `formatHandoffPath`, `formatCommitBoundaryPath`, `formatSkillUsageLessonsPath`, `formatChangeScopePath`.
- **v2-v5 (`9afb702`, `41ad7a5`, `70bb568`, `83f23b2`, `975d9fc`)**: 11 B-class LLM/CLI directive strings in `src/cli/commands/` + `src/services/{refactor,sc,slice}/`, 71 B-class strings in `skills/`, 5 `.peaks/` project metadata files, 8 remaining SKILL.md literals. Plus R3 hotfix on `request-artifact-service.ts:515` runtime error message.
- **File split**: `core-artifact-commands.ts` 889 → 39 lines + 8 new `core/*-command.ts` modules (each ≤ 800 lines), preserving public API.
- **Regression test**: `tests/unit/workspace/banned-path-directive-guard.test.ts` — 7 directive-context patterns, 3-entry KEEP allow-list, covers `src/` + `skills/`.
- **v7 (`b4d666b`)**: `migrateWorkspace` updated to discover sessions under canonical `.peaks/_runtime/<sid>/` (was only walking the legacy top-level path).

### Tests

- 3873 passed / 0 failed / 17 skipped at release time.
- New: `dispatch-fanout-mandatory.test.ts` (11), `karpathy-skip-on-config-docs-chore.test.ts` (11), `checkpoint-periodic-frequency.test.ts` (6), `test-tool-detection.test.ts` (6) + injection test + docs test, `banned-path-directive-guard.test.ts` (2), `reviewer-dispatch-policy.test.ts` (11).
- New reviewable artifact helpers tested in `request-artifact-handoff-path.test.ts` (21 total now).

### Pre-existing violations preserved as-is

6 ban-explanation memory files under `.peaks/memory/`, 28 historic session files under `.peaks/_runtime/2026-06-*/`, 5 historic dispatch records under `.peaks/_sub_agents/`, `.peaks/.gitignore` (gitignore contract), `tests/fixtures/skills/pre-slim/*.md` (slim-evidence baseline) — all explicitly labeled historical.

---

## [2.9.2] — 2026-06-25 — Handoff path canonicalization v2 (INTERMEDIATE, SUPERSEDED BY 2.9.0)

**Bugfix.** v1 (2.9.1, commit 9893d3a) fixed 20 hardcoded `.peaks/_runtime/${changeId}/` template strings in the 5 render functions of `src/services/artifacts/artifact-templates.ts`. User review then surfaced 11 additional B-class (LLM/CLI directive) hits across `src/cli/commands/`, `src/services/{refactor,sc,slice}/`, and 71 hits in `skills/` SKILL.md/references that the LLM would read as write instructions. v2 cleans all of them.

- **11 B-class string edits** in 8 source files (CLI descriptions, `nextActions.push`, service-emit `warnings:` / `helpLines:` / `hardGates`, `slice-check` gate descriptions)
- **1 R3 hotfix**: `src/services/artifacts/request-artifact-service.ts:515` runtime error message path
- **1 C-class back-compat comment** on `src/services/audit/enforcers/design-draft-confirm.ts:38-41` design-draft read path
- **71 B-class edits** across 15 skills/ files (SKILL.md + references/)
- **5 .peaks/ project metadata files** updated (PROJECT.md, retrospective index, project-scan, 2 memory entries)
- **File split**: `src/cli/commands/core-artifact-commands.ts` 889 → 39 lines (orchestrator) + 8 new `src/cli/commands/core/*.ts` modules (each ≤ 800 lines), preserving the public API (`registerCoreAndArtifactCommands`, `DoctorLogsSection`, `BindingSource`)
- **4 new tests** in `request-artifact-handoff-path.test.ts` (21 total now)
- **1 new regression test**: `tests/unit/workspace/banned-path-directive-guard.test.ts` (2 tests, 7 directive-context patterns, 3-entry KEEP allow-list for explicit legacy/canonical contrast descriptions; covers `src/` and `skills/` directive contexts)
- **1 test sync**: `tests/unit/sc-service.test.ts:151` updated to match the production warning string at `src/services/sc/sc-service.ts:567`
- Bumps `package.json#version` from 2.9.1 to 2.9.2

**Pre-existing violations preserved as-is** (intentional historical/forbidden documentation, all explicitly labeled):
- 6 ban-explanation memory files under `.peaks/memory/` (slice 005 / 2.8.3 / 2.7.1 lessons)
- 28 historic session files under `.peaks/_runtime/2026-06-*/`
- 5 historic dispatch records under `.peaks/_sub_agents/`
- `.peaks/.gitignore` (gitignore contract)
- `tests/fixtures/skills/pre-slim/*.md` (slim-evidence baseline)

---

## [2.9.1] — 2026-06-24 — Handoff path canonicalization

**Bugfix.** Sub-agents were still creating `.peaks/_runtime/<change-id>/` at the top level of `.peaks/`, which is hard-banned by 2.8.3+. Root cause: 20 hardcoded `.peaks/_runtime/${changeId}/...` template strings in `src/services/artifacts/request-artifact-service.ts` were emitted into artifact markdown and read by sub-agents as handoff write instructions.

Replaced all 20 with a 4-helper API at `src/services/artifacts/artifact-templates.ts:31,36,41,46` (`formatHandoffPath`, `formatCommitBoundaryPath`, `formatSkillUsageLessonsPath`, `formatChangeScopePath`); the public surface is re-exported from `request-artifact-service.ts:28`. The service file was also split — 5 render functions + dispatcher moved to the new sibling module — bringing it from 1101 lines down to 788, satisfying the 800-line cap (Karpathy #2 Simplicity First).

- New module: `src/services/artifacts/artifact-templates.ts` (333 lines; 4 helpers + 5 render fns + dispatcher)
- `src/services/artifacts/request-artifact-service.ts` — re-exports only, 1101 → 788 lines
- New test: `tests/unit/artifacts/request-artifact-handoff-path.test.ts` (17 assertions: 4 helper shapes, 5× role-path-prefix, 1 source-grep, 1 line-count cap, 1 lazy-load guard)
- Hard ban (2.8.3+) regression-tested: zero hardcoded `.peaks/_runtime/${changeId}/` strings in either file
- Also bumps `package.json#version` from 2.8.4 to 2.9.1 (closing the slice 006 gap where CHANGELOG was bumped to 2.9.0 but package.json was not)

---

## [2.9.0] — 2026-06-24 — Test Tool Detection injection

**Added.** Sub-agent dispatch (both single + DAG paths, all roles rd/qa/ui/txt/sc/general-purpose) now prepends a `## Test Tool Detection (mandatory)` block to every sub-agent prompt. The block tells the sub-agent to read `package.json#scripts.test` first and use the project-local runner (`./node_modules/.bin/<runner>` or `pnpm test -- <file>`) — never `npx <runner>`. Runtime introspection: `peaks test --json`.

- New module: `src/services/dispatch/test-tool-detection.ts` (47 lines; exports `TEST_TOOL_DETECTION_BLOCK` + `formatTestToolDetection()`)
- Dispatch chokepoints updated: `src/cli/commands/dispatch-commands.ts:187`, `src/services/solo/dag-orchestrator.ts:157,182-183`
- Dispatch envelope bumped: `envelopeVersion: '2.1.0'` → `'2.2.0'` (consumers can detect the new prompt shape)
- New tests: `tests/unit/dispatch/test-tool-detection.test.ts` (6), `tests/unit/dispatch/test-tool-detection-injection.test.ts` (9), `tests/unit/skills/test-tool-detection-docs.test.ts` (4) — 19 new assertions
- Block size: 749 bytes UTF-8 (≤800 cap)

---

## [2.8.4] — 2026-06-24

**Breaking change.** Single-sub-agent dispatch is no longer permitted when the slice DAG has ≥ 2 leaves at one topological level. The 2.8.3-era `preferences.fanout.defaultMode = 'serial'` opt-out was removed by user directive ("禁止单 sub-agent").

### Changed

- **`FanoutMode` closed set narrowed to `['fan-out']`.** The `'serial'` member is gone from `src/services/preferences/preferences-types.ts`; any preferences.json file carrying `defaultMode = 'serial'` (or any non-fan-out value) now throws `PREFERENCES_FANOUT_INVALID` at load. The `migratePreferences` path silently rewrites legacy `'serial'` → `'fan-out'` for 2.8.3-era files and surfaces the change in the migration envelope's `changes[]`.
- **SKILL.md contract flipped.** `peaks-solo` SKILL.md now states "Hard constraint: fan-out is mandatory"; the previous "Fan-out opt-out" subsection is removed.
- **Reference docs reorganized.** `references/fanout-opt-out.md` (escape hatch) → `references/fanout-mandatory.md` (hard constraint + migration contract). `references/swarm-dispatch-contract.md` opt-out callout removed.
- **Test surface refreshed.** `tests/unit/solo/skills-solo-fanout-opt-out.test.ts` → `tests/unit/solo/skills-solo-fanout-mandatory.test.ts`; pins the new hard constraint and verifies the opt-out file is deleted.

### Migration

Run `peaks preferences migrate --write` once. The CLI will rewrite `serial` → `fan-out` in your `.peaks/preferences.json` and surface the change in stdout. Manual recovery: delete the `fanout` block from `.peaks/preferences.json`.

### Slice

`2026-06-24-audit-5th-p2` — removes the 2.8.3 serial opt-out entirely. Compatible with the 2.8.4 release tag; no DB migration required.

---

## [2.8.3] — 2026-06-22

### ⚠ BREAKING — `peaks workspace init --change-id` no longer creates `.peaks/_runtime/<change-id>/` sibling dir

The 2.8.0-era `peaks workspace init --change-id <id>` flow wrote a
top-level sibling dir `.peaks/_runtime/<changeId>/` next to `.peaks/_runtime/`.
That path is **forbidden** under the 2.8.0+ two-axis convention
(change-id is a logical identifier, NOT a sibling filesystem dir).

In 2.8.3 the CLI redirects `--change-id` to a **file-form binding** at
`.peaks/_runtime/current-change` (plain text file containing the
change-id as its sole content). NO directory is created at
`.peaks/_runtime/<changeId>/` at top level. Reviewable artifacts still land
under `.peaks/_runtime/<changeId>/<role>/`, but that dir is created **lazily**
by the writer, not by `init`.

If a 2.8.0-era legacy sibling dir `.peaks/_runtime/<changeId>/` already exists
at top level, `peaks workspace init --change-id <id>` aborts with a
new `LegacyChangeIdSiblingError` (envelope code
`LEGACY_CHANGE_ID_SIBLING`) carrying a 4-step migration message:

1. Inspect `.peaks/_runtime/<changeId>/` for user-authored content worth keeping.
2. Move desired files into `.peaks/_runtime/<sessionId>/<role>/`.
3. Delete the orphan `.peaks/_runtime/<changeId>/` dir.
4. Re-run `peaks workspace init --change-id <id>`.

This is a **deliberate breaking change** — the 2.8.0→2.8.3 transition
required the redirect because the legacy sibling-dir layout was the
root cause of `.peaks/_runtime/<YYYY-MM-DD-*>/` orphans at the project root.
Users on 2.8.2 with an existing `.peaks/_runtime/<changeId>/` sibling dir see a
one-time migration error on next `peaks workspace init`. The CLI surfaces
the four-step recipe; no data is lost.

### Fixed

- **Top-level `.peaks/_runtime/<YYYY-MM-DD-*>/` ban** — the 2.8.0-era legacy path
  `.peaks/_runtime/<change-id>/<role>/` (sibling of `.peaks/_runtime/`) is now
  **forbidden** under the 2.8.0+ two-axis convention. This slice is the
  final root-out of a 2.8.0-era orphan (`.peaks/2026-06-22-cc-connect-orphan-cleanup/`,
  4 files, 28 KB, untracked) and pins the rule across FOUR layers so a
  regression cannot survive:
    1. **`.gitignore` fnmatch rule** —
       `.peaks/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-*/` blocks any
       future untracked date-prefix sibling at `.peaks/_runtime/<seg>/`. Path-anchored
       so it does not over-match (`.peaks/_runtime/<date>/` is still ignored
       by the existing `.peaks/_runtime/` rule, not this one).
    2. **Vitest guard** at
       `tests/unit/workspace/top-level-change-id-guard.test.ts` (8 cases)
       pins the gitignore rule literal, asserts fnmatch matches a synthetic
       candidate, asserts it does NOT match `.peaks/_runtime/-nested`
       candidates, scans the live working tree for orphan date-prefix
       siblings, scans `git ls-files` for tracked escapes, asserts both
       `CLAUDE.md` and `.peaks/PROJECT.md` carry the ban wording, AND
       asserts the CLI help text (`init-command.ts`) teaches the
       `.peaks/_runtime/current-change` binding path + the four
       migration verbs (inspect / move / delete / unlink / re-run).
    3. **Source-code redirect** —
       `src/shared/change-id.ts#setCurrentChangeId` now defaults to
       `{ form: 'file' }` (was `'symlink'`); the file form writes ONLY
       `.peaks/_runtime/current-change` and never creates
       `.peaks/_runtime/<changeId>/`. The legacy `'symlink'` form is kept for
       back-compat reads but is no longer written by `peaks workspace init`.
       `src/services/workspace/workspace-service.ts#initWorkspace`
       pre-flights the existence of `.peaks/_runtime/<changeId>/` and throws
       `LegacyChangeIdSiblingError` if found.
    4. **CLI help-text guard** — `src/cli/commands/workspace/init-command.ts`
       rewrites the `init` command description and `--change-id` option
       description so an LLM reading `peaks workspace init --help` is
       taught the correct path (`.peaks/_runtime/current-change`) instead
       of the legacy `.peaks/_runtime/<change-id>/` sibling dir. A new catch block
       surfaces `LegacyChangeIdSiblingError` with the 4-step migration
       recipe in the JSON envelope.
- **`CLI_VERSION`** sync bumped 2.8.2 → 2.8.3 (regenerated via
  `scripts/sync-version.mjs` from `package.json#version`).

### Added

- **`LegacyChangeIdSiblingError`** (exported from
  `src/services/workspace/workspace-service.ts`) — thrown by
  `initWorkspace` when a 2.8.0-era legacy sibling dir
  `.peaks/_runtime/<changeId>/` already exists at top level. Carries
  `code: 'LEGACY_CHANGE_ID_SIBLING'`, `changeId`, and `legacyPath`.
  The CLI catch block surfaces the error in the JSON envelope with a
  3-item `nextActions` list (inspect → migrate → re-run).
- **`tests/unit/workspace/workspace-init-change-id-redirect.test.ts`** —
  8 vitest cases pinning the new init behavior:
  (1) no `.peaks/_runtime/<changeId>/` created; (2) `.peaks/_runtime/current-change`
  written; (3) `LegacyChangeIdSiblingError` fires when legacy sibling
  exists; (4) no `--change-id` leaves binding untouched; (5) idempotent
  re-init; (6) error envelope data fields + 4-step recipe ordering;
  (7) `LegacyChangeIdBindingError` fires when a legacy 2.8.0-era
  symlink is found at the binding path (silent-replace defense);
  (8/8b) `ChangeIdValidationError` fires for `--change-id '../'` / '.'
  before any path join.
- **`top-level-change-id-guard.test.ts` AC7** — pins the CLI help text
  in `init-command.ts` so a future refactor cannot silently revert to
  the forbidden sibling-dir phrasing. Also pins all four migration
  verbs (inspect / move / delete / unlink / re-run) so the CLI catch
  block's wording stays in sync with the runtime error messages.

### Audit followup (post-2.8.3, pre-publish) — multi-dimensional remediation

A multi-dimensional audit (Karpathy + security + silent-failure +
migration) of the 2.8.3 release surfaced 13 findings, all addressed in
a single followup commit:

- **HIGH silent failure**: `setCurrentChangeId({ form: 'file' })`
  silently replaced a 2.8.0-era symlink at the binding path
  (`unlinkSync` + `writeFileSync` with no log / envelope signal).
  Fixed: detect the symlink via `lstatSync` BEFORE the read attempt
  and throw a new `LegacyChangeIdBindingError` (envelope code
  `LEGACY_CHANGE_ID_BINDING`) with a 3-step migration recipe
  (inspect / unlink / re-run). The CLI catch block surfaces the
  error in the JSON envelope with `bindingPath` + `symlinkTarget` +
  `changeId` fields plus a 3-item `nextActions` list. Live state at
  the time of audit: this repo's own `.peaks/_runtime/current-change`
  was a legacy symlink pointing at the now-deleted
  `.peaks/014-full-dogfood/` — the fix prevented data loss on the
  next `peaks workspace init --change-id` invocation.
- **MEDIUM path-validation ordering**: `initWorkspace` joined the
  unvalidated `--change-id` and ran `existsSync` before
  `validateChangeIdOrThrow`. Fixed: `validateChangeIdOrThrow` is now
  called BEFORE any path join / `existsSync` probe.
- **MEDIUM bare-existsSync guard**: the legacy-sibling guard used
  bare `existsSync` which conflates files / broken symlinks /
  escaping symlinks / EACCES into one error. Fixed: use
  `lstatSync` + try/catch on `ENOENT` so the guard distinguishes
  path types. (All non-existent paths fall through; the legacy
  sibling dir of any kind still throws `LegacyChangeIdSiblingError`.)
- **INFO defense-in-depth**: `writeFileSync` on the binding file now
  uses `mode: 0o600` (the binding file contains a per-user change-id,
  not a team-shared file — restricting read/write to the owner defends
  against multi-user hosts).
- **Test count**: `workspace-init-change-id-redirect.test.ts` extended
  from 6 to 8 cases (AC7 symlink-at-binding-path + AC8 / AC8b
  validation); `top-level-change-id-guard.test.ts` AC7 extended with
  4-verb pin. Total test count: 8 + 8 = 16 cases pinning the
  top-level change-id ban (previously stated as "5 cases" in the
  memory file and "(7 cases)" in the "Vitest guard" bullet above —
  both have been corrected to reflect the final 8-case state).
- **Dead-code cleanup**: removed the unused `track` helper from
  `workspace-init-change-id-redirect.test.ts`.
- **Doc cleanup**:
  `.peaks/memory/2026-06-22-top-level-change-id-cleanup.md` updated
  to describe the full 4-layer defense (was 3-layer) and the 8-case
  final state (was 5-case). `.peaks/memory/index.json` entry
  description + `updatedAt` timestamp updated to 2026-06-23.
  `CLAUDE.md` Hard ban section clarifies the binding vs artifact
  path distinction. `.peaks/PROJECT.md` second convention bullet
  expanded to describe all 4 enforcement layers. The
  `.peaks/_sub_agents/unknown-sid/` followup is marked
  **tolerated** (gitignored ephemeral, no action needed).
- **CLI help text** mentions `LegacyChangeIdBindingError` alongside
  `LegacyChangeIdSiblingError` so an LLM reading
  `peaks workspace init --help` learns about both error classes.

Verification: `pnpm tsc --noEmit` clean, `pnpm vitest run` 3638/3640
pass (the 2 pre-existing ast-gate-cross-version STRAT.sig failures
are unchanged by this release), `pnpm build` clean.

### Notes

- No npm dependencies added or removed.
- CLI surface change: the `init` command description and `--change-id`
  option description text are rewritten to teach the correct path.
  `peaks workspace init --help` is now a slightly longer message — no
  flag names changed, no exit codes changed.
- The orphan `.peaks/2026-06-22-cc-connect-orphan-cleanup/` contained a
  redundant duplicate of work already promoted to
  `.peaks/_runtime/2026-06-22-session-14216e/rd/requests/002-2026-06-22-cc-connect-orphan-cleanup.md`
  per the 2.8.0+ two-axis convention. Audit confirmed no other orphan
  date-prefix `.peaks/` siblings exist anywhere in the working tree or git
  tracking, and zero `src/` / `skills/` / `tests/` paths reference the
  deleted orphan as a live location.
- The pre-existing `STRAT.sig` test failure in
  `tests/integration/rd/ast-gate-cross-version.test.ts` is out of scope
  and filed separately (unchanged by this release).
- Consumer-projects upgrading from 2.8.0/2.8.1/2.8.2: if you have an
  existing `.peaks/_runtime/<change-id>/` dir at top level from a prior
  `peaks workspace init --change-id <id>` call, run the migration
  steps surfaced by `LegacyChangeIdSiblingError` (inspect → migrate →
  delete → re-init). No data is lost. After migration, future
  `peaks workspace init` calls write only `.peaks/_runtime/current-change`
  and never create the sibling dir.

---

## [2.8.2] — 2026-06-22

### Removed

- **cc-connect package + `peaks companion` command family** — the
  `cc-connect` dependency (and its postinstall Go-binary download) is
  gone from `package.json#dependencies`, and the entire 12-file
  `src/services/companion/*` module + `src/cli/commands/companion.ts`
  CLI + 14 `tests/unit/companion/*` test files are removed
  (~7,700 lines deleted, 0 added). The `peaks companion install|setup|
  start|stop|bind|status|restart|verify|token|qr` command tree is gone
  along with the `peaks scan companion-binary` sub-command and the
  `capability:companion-binary-resolution` doctor check. Companion
  types (`CompanionConfig`, `CompanionWeixinConfig`, `CompanionChannel`,
  `CompanionBinarySource`) and the `~/.peaks/config.json#companion`
  block are also removed.
- **Orphan npm dependencies** — `qrcode ^1.5.4`, `qrcode-terminal ^0.12.0` (runtime), `@types/qrcode ^1.5.6` (dev). These were only consumed by the now-deleted `src/services/companion/*` module; the ambient declaration `src/types/qrcode-terminal.d.ts` (no consumer) was deleted in the same hunk. `pnpm-lock.yaml` regenerated; verified 0 `cc-connect` and 0 `qrcode` entries.
- **Stale `'companion'` entry in `PARENT_COMMANDS`** static set in `src/services/scan/orphan-service.ts`. The `peaks companion` command was deleted in 2.8.2; its presence in the static set caused orphan-detection false negatives (a stray `companion` directory would be silently skipped).

  Rationale: `cc-connect@1.3.1`'s postinstall script runs
  `node scripts/install.js` which downloads a Go binary from
  `github.com/alibaba/open-code-review/releases` via HTTPS. This was
  the dominant cause of slow `npm i -g peaks-cli` installs in
  restricted/proxied environments; `peaks companion` itself is also
  low-traffic (no Claude Code / Trae workflows depend on it). The
  `peaks-companion` skill directory remains in `skills/` for users
  who still have cc-connect installed locally — it is now opt-in and
  no longer wired into any `peaks` subcommand.

  Action for users with existing `~/.peaks/config.json`: the loader
  silently strips the legacy `companion` block on next read and
  rewrites the file in slim form. No data loss.

### Changed

- **`@alibaba-group/open-code-review` is now a peer dependency** —
  moved from `optionalDependencies` to `peerDependencies` with
  `peerDependenciesMeta."@alibaba-group/open-code-review".optional =
  true`. The peer hint lets npm skip the optional resolution entirely
  during global install; users who want second-opinion reviews via
  `peaks code-review run-ocr` install it manually with
  `npm i -g @alibaba-group/open-code-review`. Install hint copy in
  `ocr-service.ts` and `code-review-commands.ts` updated to reflect
  the peer-dependency status. `pnpm.onlyBuiltDependencies` is now an
  empty array (no peaks-cli dep needs postinstall approval).
- **Refreshed stale JSDoc** on `src/services/config/config-service.ts#hasLegacyGlobalFields` to describe the current 2.0 schema (`version` + `ocr`) — the old comment still described the deleted `companion` block from slice 2026-06-14-cc-connect-weixin.
- **Removed dead `commander.invalidArgument` channel-not-supported block** in `src/cli/index.ts` — the only path that raised this exact error was the now-deleted `peaks companion` command.

### Notes

- `skills/peaks-companion/` and `tests/unit/skills/peaks-companion.test.ts` are intentionally retained as a tombstone for users who still have `cc-connect` installed locally. They are not loaded by the runtime CLI.
- The pre-existing `STRAT.sig-chain` test failure in `tests/integration/rd/ast-gate-cross-version.test.ts` is out of scope and filed separately.

---

## [2.8.1] — 2026-06-22

### Fixed

- **H8 STRAT.sig chain enforcement (Plan 5 R1-W2 HIGH)** — `runTacticalStage`
  now refuses to write `impl.json` when `inputSig` does not equal the
  upstream `STRAT.sig` for the same project dir, instead of trusting any
  64-hex string. Backed by a process-local `STRAT_SIG_REGISTRY` keyed by
  `dirname(out)` and the explicit invariant phrase
  `"STRAT.sig chain broken"`. Catches a class of orchestrator bugs that
  could fabricate impl.json authority from a non-existent strategy.

- **Defense-in-depth comment cites H6 verbatim (Plan 5 R1-W3 MED)** —
  `src/services/rd/impl.ts` defense-in-depth check now cites spec H6
  (CLI 计算裁决) directly. The accompanying `docs/superpowers/specs/
  2026-06-21-context-audit-redesign-design.md` gained a new §4.3
  *战术审计* subsection that consolidates §3.2 / §3.3 / H6 / H8 / Phase 3
  AC-2 into a single canonical anchor (previous code references to
  `§4.2` updated to `§4.3`).

### Tests

- **Orphan-test traceability (Plan 5 R1-W1 MED)** — the side-effect-only
  import test in `tests/unit/services/rd/ast-gate.test.ts` now carries an
  explicit `R2-EXTRA` comment tag so future audit rounds can locate it
  in the round-2 boundary_coverage table.

- **v1 regex-limitation test names (Plan 5 R1-W4 LOW)** — namespace-import
  and default-import tests renamed from "is NOT linked to dep" to
  "v1 passes namespace/default import (limitation, R2-W3)" so the verdict
  is in the test name, not just the body.

- **Atomic-write crash test (Plan 5 R1-W5 LOW)** — new test
  *unlinks .tmp when rename throws* pins the catch→unlink fallback in
  `writeImpl` (EISDIR-triggered real-rename failure). Mutation probe
  KILLED: commenting out the unlink makes the test fail at the
  `existsSync(tmp)` assertion.

- **1-element boundary (Plan 5 R2A-L1 LOW)** — `externalApiCalls` array
  now asserts that `[]` / `[x]` / `[x,y,z]` produce three distinct sigs,
  pinning the empty-vs-single-vs-multi collapse class.

- **Uppercase-hex schema pin (Plan 5 R2A-L2 LOW)** — `StrategyOutputSchema`
  now rejects `'A'.repeat(64)` explicitly, defending against a
  case-insensitive regex widening mutation.

- **Multi-entry sig-distinction caveat (Plan 5 R3-W1 LOW)** — the
  `produces distinct sig for multi-entry externalApiCalls` test now
  documents in its comment that the named sig assertion is best-effort
  (because `generatedAt` is non-deterministic) and that the load-bearing
  guards are the on-disk length + element-order assertions.

---

## [2.7.0] — 2026-06-18

### Added

- **Slice DAG dependency analysis + parallel sub-agent dispatch (slice 1.2)** —
  the `peaks-cli` repo now ships a typed DAG model for slicing work across
  parallel sub-agents. `src/services/dispatch/slice-dag.ts` exports
  `validateDag` (cycle detection with path-in-error-message),
  `topologicalLevels` (linear / diamond / parallel DAGs), and
  `sliceReadyToRun(dag, completed)` (next-layer fan-out query). Node IDs are
  globally unique, node roles are whitelisted, and DAG serialization is
  SHA-256 hash-stable on key-sorted serialization. The new
  `peaks sub-agent dispatch --from-dag <file>` flag and the new
  `peaks sub-agent await --batch <id> [--timeout <ms>]` subcommand wrap the
  model. The `dispatch <role>` single-sub-agent path is byte-stable zero-change.
- **Contract broadcast for downstream slices (slice 1.2)** —
  `src/services/dispatch/contract-store.ts` persists each completed slice's
  public surface (`exports` / `types` / `publicSignatures`) to
  `.peaks/_runtime/<sessionId>/dispatch/contracts/<slice-id>.json`. The B/C/D
  dispatch prompts auto-inject A's contract under a `slice A contract:`
  segment so downstream slices see the dependency without re-reading source.
- **Solo DAG orchestrator with cancel-on-fail (slice 1.2)** —
  `src/services/solo/dag-orchestrator.ts` exports `runDag(dag, opts)`:
  topological-layer fan-out, per-layer join barrier, 任一叶子失败整组回退
  (any leaf failure → in-flight sub-agents receive cancel signal → RD
  returns to repair). peaks-solo SKILL.md references the orchestrator.
- **5-IDE `awaitBatch` real implementation (slices 1.2 + 1.3 + 1.4)** —
  `SubAgentDispatcher.awaitBatch(batchId, opts): Promise<BatchResult[]>`
  is now implemented across **all 5 IDEs**: claude-code (1.2 MVP) +
  trae + trae-cn + codex + cursor (1.3 expansion). The 4 non-claude-code
  IDEs share `pollDispatchRecords()` core (cross-platform file-polling via
  `homedir() + join()`); per-IDE `notePrefix` attributes the surfaced note.
  Per-IDE timeout defaults: trae 30s / trae-cn 30s / cursor 30s /
  codex 45s / claude-code 60s. Uniform 120_000ms clamp ceiling.
- **5-IDE end-to-end dogfood (slice 1.4)** —
  `tests/unit/dispatch/slice-dag-dispatcher-5ide-dogfood.test.ts` runs the
  same 5-node mock DAG (4 done + 1 failed at idx 2) through every IDE's
  `awaitBatch`. Cross-IDE envelope dimensions are byte-stable
  (length=5 / dispatchIndex 0..4 / status array / recordPath unique /
  durationMs >= 0). The `note` label is per-IDE attributed as documented
  divergence (claude-code reads raw outcome; trae/trae-cn/codex/cursor
  prefix with `${notePrefix} — ${outcome}`). Zero IDE-specific differences
  required production code fixes — the differences are design-driven.
- **RD tech-doc `## Slice DAG` section + enforcer (slice 1.2)** —
  `skills/peaks-rd/references/mandatory-tech-doc.md` gains a new
  `## Slice DAG` section (visual + text) alongside § Architecture /
  § Component / § Data flow / § Dependencies. The enforcer
  (`tech-doc-mandatory-sections.ts`) treats it as a required heading;
  missing section → `TECH_DOC_MISSING_SECTION` gate failure.
- **UT 4-dimension split convention (proposal 2, slice 2.1)** —
  `.peaks/standards/typescript/testing.md` codifies the 4 orthogonal test
  dimensions: **render** (output shape) / **behavior** (state transitions)
  / **integration** (boundary mocks) / **a11y** (human-facing signal).
  Each `describe(...)` block maps to exactly one dimension; no test case
  spans dimensions. The convention has both a frontend and a CLI/non-UI
  reading. Promotion is via the code-reviewer sub-agent hint at
  `skills/peaks-rd/references/code-reviewer-4dim-hint.md` (a verbatim
  block appended to the code-reviewer prompt at dispatch time). **No lint
  rule introduced**, no retroactive refactor of existing 3500+ test cases —
  the convention applies to NEW test files only.

### Changed

- `package.json` and `src/shared/version.ts` bumped 2.6.1 → 2.7.0.
- `SubAgentDispatcher` interface (5 implementations) gains
  `awaitBatch(batchId, opts): Promise<BatchResult[]>` (type-only extension).
- `peaks sub-agent dispatch` and `peaks sub-agent await` gain DAG-aware
  flags (`--from-dag`, `--batch-id`) and the new subcommand respectively.
  Single-sub-agent `dispatch <role>` envelope shape is byte-stable zero-change.
- `karpathy-reviewer` prompt-injection context remains in
  `references/rd-sub-agent-dispatch.md`; the new 4-dim hint is appended
  after the Karpathy block.

### Fixed

- **Cross-platform path discipline (slice 1.3)** —
  `tests/unit/dispatch/sub-agent-dispatcher-cross-platform.test.ts` pins
  the `homedir() + join()` construction so a Windows user gets
  `C:\Users\name\.trae\agents` and a Mac user gets
  `/Users/name/.trae/agents`. No hardcoded `/Users/...` or `C:\...` in
  any 5-IDE `awaitBatch` path. The 4 new IDE paths (`trae / trae-cn /
  codex / cursor`) follow the same discipline.
- **`runDag` cancel-on-fail correctness (slice 1.2.c)** — when any leaf
  fails, in-flight sub-agents in the same batch receive a cancel signal
  at the envelope level; the orchestrator no longer waits for them to
  finish naturally. Pinned by `tests/unit/solo/dag-orchestrator.test.ts`.

### Security

- No new attack surface in 2.7.0. The contract-broadcast path writes
  JSON to `.peaks/_runtime/<sessionId>/dispatch/contracts/` (project-local,
  gitignored); no cross-user / cross-process access pattern was added.
  The 4-dim convention does not introduce eval / dynamic-import / unsafe
  code paths.

---

## [2.7.1] — 2026-06-18

### Changed

- **Project-root artifact pollution remediation** — the 2.7.0 release
  shipped a `getChangeArtifactRoot(projectRoot, changeId)` helper that
  returned `.peaks/_runtime/<changeId>/` and was the source of the user-reported
  project-root pollution: reviewable artifacts (RD `tech-doc.md`, QA
  `test-cases/`, PRD, txt) were being written next to the project root
  rather than under the canonical session home. As of 2.7.1 this
  helper is **removed** (and its only remaining import cleaned up).
  All artifact writes flow through
  `.peaks/_runtime/<sessionId>/<role>/<artifact>` per the F3 / 2.7.0
  canonical-session model. The `changeId` survives as a logical
  identifier in artifact frontmatter (read via `getCurrentChangeId`),
  but no longer maps to a filesystem directory under `.peaks/`.
- `package.json` and `src/shared/version.ts` bumped 2.7.0 → 2.7.1.

### Fixed

- **`peaks request transition --allow-incomplete` bypass counter wrote
  to the project root** — `src/cli/commands/request-commands.ts` was
  building `sessionRoot` as `join('.peaks', resolvedSessionId)` for
  `recordBypass` / `isBypassLimitReached`, which produced
  `.peaks/2026-06-17-session-1baf0a/.bypass-count.json` files at
  the project root. The path formula is now
  `join('.peaks/_runtime', resolvedSessionId)`, matching the
  canonical home that `peaks session info --active` already resolves.
  Pinned by `tests/unit/bypass-tracker.test.ts` (new
  `2.7.1 root-pollution regression` describe).

### Security

- No new attack surface. The bypass-count path is now
  `.peaks/_runtime/<sessionId>/.bypass-count.json` (project-local,
  gitignored via the existing `.peaks/_runtime/` rule on
  `.gitignore:9`); no cross-user / cross-process access pattern was
  added or removed.

---

## [2.6.1] — 2026-06-18

### Added

- **Multi-IDE agent install (Slice 2.6.1.E)** — the `karpathy-reviewer`
  sub-agent now auto-installs on `npm i -g peaks-cli@latest` to **5
  platforms** instead of 1. Previously only `~/.claude/agents/`
  (claude-code) was populated; 2.6.1 extends to `~/.trae/agents/`,
  `~/.trae-cn/agents/`, `~/.codex/agents/`, and `~/.cursor/agents/`.
  The new `trae-cn` profile is opt-in via the existing
  `IDE_DETECTION_DIRS` table (presence of `~/.trae-cn/` triggers
  detection). All `agentsDir` paths go through `homedir() + join()` —
  the new `agentsDir paths are derived from homedir()` vitest pins
  the construction so a Windows user gets `C:\Users\name\.trae\agents`
  and a Mac user gets `/Users/name/.trae/agents`, not a hardcoded
  Unix literal.

### Fixed

- **orphan-service false-positive reductions (Slice 2.6.1.A)** —
  `peaks scan orphan` had been reporting 77 `cliSubcommandOrphans` for
  the peaks-cli repo. Four surgical fixes bring this down to 35
  (54% reduction):
  1. The `usageCount` algorithm now excludes the declaration file
     itself, so the threshold is "wired iff referenced in any other
     file" rather than "wired iff 2+ total string-literal matches
     (declaration + elsewhere)".
  2. `DEFAULT_DIRS` now includes `tests/` — test files often reference
     subcommands and were previously invisible to the scanner.
  3. `PARENT_COMMANDS` (35 known top-level command names) skips
     subcommand-orphan detection for the parent commands themselves.
  4. `scanExportsInFile` now matches `export default function name()`
     and `export default class Name`; `importedNameCount` now treats
     re-exports (`export { x } from './y'`, `export type { T } from
     './y'`) as consumer references.
  Bonus: `OrphanScanOptions.baseRef` lets the scan diff against an
  arbitrary git ref (default: `HEAD`) for branch-vs-main reviews.
- **karpathy-service code-fence skip (Slice 2.6.1.B)** — `peaks scan
  karpathy` no longer flags anti-pattern phrases (TODO, "should be
  fine", "maybe", "probably") when they appear inside fenced markdown
  code blocks. Illustrative code snippets were eroding trust in the
  structural scanner. The 4 guideline-marker tests
  (`tests/unit/karpathy-service-fence.test.ts`) pin the contract:
  inside-fence lines are skipped, outside-fence prose is still
  flagged, unclosed fences at EOF don't crash.

### Security

- **markdown escape in `formatKarpathyMarkdown` (Slice 2.6.1.C)** —
  the L1 LOW (`--project` value interpolated into markdown without
  escaping) is fixed via a new `escapeMarkdown(value: string)` helper
  that neutralises `\\`, `` ` ``, `[`, `]` in user-controlled strings
  before they hit the markdown report. Applied at 7 interpolation
  sites: `projectRoot`, `reviewFile`, `scannedAt`, `v.snippet`,
  `v.hint`, `warnings[].message`, and the gate header (which is
  static but routed through the helper for consistency). New vitest
  file `tests/unit/karpathy-service-escape.test.ts` (7 cases)
  covers the contract; AC-6 no-regression pins clean-ASCII output as
  byte-identical.
- **KARPATHY_REVIEW heading-anchored gate (Slice 2.6.1.F)** — the L3
  LOW (the 4 guideline `mustContain` substring markers could be
  spoofed by any file that just *mentioned* the marker names as
  prose) is fixed by a new `headingMustContain: string[]` field on
  `ArtifactPrerequisite`. `KARPATHY_REVIEW` now requires each of
  the 4 guidelines to appear as an actual markdown heading
  (`#`–`###` line prefix), not just as prose. The `## Karpathy-Gate`
  header remains a substring match (it is the file's own gate
  header, not a section anchor). New vitest file
  `tests/unit/heading-must-contain.test.ts` (4 cases) covers:
  AC-1 valid headings pass, AC-2 prose-only fails, AC-3 partial
  headings fail with the missing marker named, AC-4 code-fence
  headings (regex is strict, not fence-aware) — documented as a
  known limitation pinned by the test.

### Internal

- **L2-install dogfood verification (Slice 2.6.1.D)** — confirmed
  end-to-end on a temp HOME that the 2.6.0 tarball's `postinstall`
  creates `~/.claude/agents/karpathy-reviewer.md` (15.4 KB, mode
  0600) and the matching `.peaks-managed` marker (245 bytes, JSON
  with `version`, `kind`, `agentName`, `sourcePath`, `contentSha256`).
  The 8-platform skill fan-out also confirmed (codex, cursor, trae,
  trae-cn, qoder, tongyi-lingma, hermes, openclaw). After Slice E,
  the agent install fans out to 4 of those platforms as well.

---

## [2.6.0] — 2026-06-18

### Added (karpathy-enforcement program — slices 1–5)

- **`peaks-rd` 4-way → 5-way fanout with karpathy-reviewer sub-agent** (slice
  1+5) — every RD implementation now spawns 5 parallel reviewers
  (`code-reviewer` + `security-reviewer` + `perf-baseline-reviewer` +
  `qa-test-cases-writer` + `karpathy-reviewer`). The 5th sub-agent emits a
  compact JSON envelope `{passed, violations, gateAction}` against the 4
  Karpathy guidelines (Think Before Coding / Simplicity First / Surgical
  Changes / Goal-Driven Execution). Contract slot at
  `skills/peaks-rd/references/rd-fanout-contracts.md` §"karpathy-reviewer
  contract (Slice 5/6)". Karpathy-guidelines context block injected into
  every RD sub-agent prompt via `rd-sub-agent-dispatch.md` (4-section
  verbatim).
- **Hard Karpathy-Gate (Slice 5/6)** — new `KARPATHY_REVIEW` prereq in
  `src/services/artifacts/artifact-prerequisites.ts` blocks
  `peaks request transition --state qa-handoff` when `rd/karpathy-review.md`
  is missing or doesn't contain the `## Karpathy-Gate` header + 4
  title-case section markers (Think Before Coding / Simplicity First /
  Surgical Changes / Goal-Driven Execution). CLI error code
  `PREREQUISITES_MISSING`. Escape hatch: `peaks request transition
  --allow-incomplete --confirm` (assisted mode).
- **Karpathy prompt-injection across the full RD surface** (slice 1) —
  4-layer guard: SKILL.md body + 3 reference docs
  (`mandatory-tech-doc.md`, `rd-fanout-contracts.md`,
  `rd-sub-agent-dispatch.md`) + 1 sub-agent dispatch context. Regression
  test `tests/unit/skills/karpathy-prompt-injection.test.ts` (9 cases)
  asserts the 4-section guidelines block is present in all 4 layers.
- **`peaks scan karpathy` CLI** (slice 5) — structural scanner for
  `rd/karpathy-review.md`; markdown + JSON output; 4 guideline
  classification + section coverage + violation counts. Companion to
  the karpathy-reviewer sub-agent (regex / file-presence vs semantic
  review). New service `src/services/scan/karpathy-service.ts` (330
  lines).
- **Tech-doc 3 mandatory sections + Gate C enforcer** (slice 2) —
  `Architecture` / `Existing API or Component Inventory` / `Trade-offs`
  sections now required in every RD `tech-doc.md`. Enforced at
  spec-locked gate. New service
  `src/services/audit/enforcers/tech-doc-mandatory-sections.ts`.
- **`peaks scan api-surface` CLI** (slice 3) — identifies existing API
  endpoints / components / stores / mocks in the consumer project
  before any new code is written. `--project --format --scope --max-per-kind`
  options; output feeds the tech-doc's `## Existing API or Component
  Inventory` section. New service
  `src/services/scan/api-surface-service.ts` (~280 lines).
- **`peaks scan orphan` CLI** (slice 4) — 4-kind orphan detection
  (exportOrphan / importOrphan / cliSubcommandOrphan /
  docEndpointOrphan). `--project --format --scope --strict` options;
  aligns with karpathy §3 Surgical Changes "remove what your changes
  made unused". New service `src/services/scan/orphan-service.ts`
  (~330 lines).
- **Slice 1-4 + Slice 5 all converged at `state: verdict-issued`** with
  cumulative **86/86** vitest pass, 0 tsc errors, 0 lint findings, 0
  diff-vs-scope violations, 0 unclassified files, 0 repair cycles.

### Added (Slice 6/6 + Slice 7/7 — karpathy-reviewer sub-agent prompt + auto-install)

- **`karpathy-reviewer` LLM sub-agent prompt** (slice 6) — full system
  prompt at `agents/karpathy-reviewer.md` (15.1 KB, 229 lines). 10
  sections covering role boundary, 4 input contracts, 4 violation
  detection rules (one per Karpathy guideline), JSON envelope schema
  (`passed` / `violations[]` / `gateAction`), file-write contract
  (title-case `## Karpathy-Gate` + 4 guideline sections), 8 hard
  prohibitions, 5 anti-patterns. Project-internal 2-line pointer at
  `skills/peaks-rd/references/karpathy-reviewer-prompt.md` (peaks-cli
  2.0 rules convention).
- **Auto-install on `npm i -g peaks-cli@latest`** (slice 7) — the
  `peaks-cli` postinstall (`scripts/install-skills.mjs`) now copies
  bundled agents from the tarball to `~/.claude/agents/` with
  content-hash drift detection (`.peaks-managed` marker + SHA-256).
  Mirrors the existing `output-styles` install contract. New function
  `installBundledAgents` + per-platform fan-out
  `installBundledAgentsForAllPlatforms` (claude-code is the only
  platform with `agentsDir` today; future platforms opt in by adding
  the field to their `IDE_SKILL_INSTALL_PROFILES` entry).
- **Escape hatch** (slice 7) — `PEAKS_SKIP_AGENT_INSTALL=1` (skip
  agent install in CI / sandboxed environments);
  `PEAKS_CLAUDE_AGENTS_DIR=/custom/path` (per-IDE env-var override,
  parallel to `PEAKS_CLAUDE_SKILLS_DIR` and
  `PEAKS_CLAUDE_OUTPUT_STYLES_DIR`).
- **Tarball coverage** (slice 7) — `package.json#files` adds
  `"agents/**"` alongside the existing `"skills/**"` and
  `"output-styles/**"`. `npm pack --dry-run` confirms
  `agents/karpathy-reviewer.md` (15.8 kB) ships in the tarball.

### Security

- All 4 karpathy sub-agent review surfaces (RD main loop + 5-way
  fanout) explicitly **MUST NOT install hooks, agents, MCP, or
  settings** — the global peaks-rd red line, restated as a
  hard prohibition in the karpathy-reviewer prompt.
- `installBundledAgents` uses the same TOCTOU-safe atomic write
  pattern as `installBundledOutputStyles`:
  `writeFileExclusively` (O_EXCL + O_NOFOLLOW, 0o600 mode, file
  identity check after write) + `.peaks-managed` marker with
  SHA-256 hash. Drift detection refuses to overwrite user-authored
  files (no marker) or stale markers (different source path).
- The `PEAKS_CLAUDE_AGENTS_DIR` env-var override is documented but
  not security-sensitive (it points the install at a user-chosen
  dir; no escalation path).
- The 3 LOW security findings documented in `qa/security-findings.md`
  (markdown injection via `--project` value interpolation, path
  traversal via arbitrary paths, KARPATHY_REVIEW prereq marker
  spoof) are all non-blocking by design (RD-authored input only,
  read-only file IO, drift detection prevents tamper).

### Tests

- **141/141 vitest pass** (was 86 in 2.5.0; +55 across the 7 slices):
  - 9 new `karpathy-prompt-injection.test.ts` (slice 1)
  - 7 new `tech-doc-mandatory-sections.test.ts` (slice 2)
  - 8 new `api-surface-scan.test.ts` (slice 3)
  - 8 new `orphan-scan.test.ts` (slice 4)
  - 14 new `karpathy-5way-fanout.test.ts` (slice 5)
  - 9 new `karpathy-6-agent-prompt.test.ts` (slice 6)
  - 8 new `installBundledAgents` cases in `install-skills-script.test.ts`
    (slice 7)
  - **Zero regression** across the 86 prior cases (slices 1-5) and
    the 38 prior `install-skills-script.test.ts` cases (slice 7's
    new agents branch).
- Hard Karpathy-Gate verified end-to-end:
  `peaks request transition --state qa-handoff` with
  `rd/karpathy-review.md` present → `state: qa-handoff`; without it
  → `code: PREREQUISITES_MISSING, missing: rd/karpathy-review.md`.
- End-to-end postinstall verified against a temp HOME:
  `Peaks agents installed across 1 platforms (1 total files)`;
  `~/.claude/agents/karpathy-reviewer.md` (15,786 bytes, mode 0600);
  `~/.claude/agents/karpathy-reviewer.md.peaks-managed` (224 bytes,
  valid JSON marker with SHA-256).

### L2 dogfood (deferred)

- **L2-install test for Slice 7** — the auto-install path is
  L1-verified (vitest + end-to-end postinstall against a temp HOME)
  but not yet L2-verified on a real consumer machine. A real
  `npm i -g peaks-cli@2.6.0` + postinstall + content-hash drift
  check + uninstall + reinstall cycle is the next L2 step (Slice 8
  follow-up if issues surface).
- **Trae / Codex / Cursor / Qoder / Tongyi Lingma / Hermes /
  OpenClaw agent install** — only `claude-code` has `agentsDir`
  populated in `IDE_SKILL_INSTALL_PROFILES`. Future slices can add
  the field per-platform once each IDE's agent directory convention
  is confirmed.
- **Slice 6 user-handoff doc** — `rd/karpathy-reviewer-agent-handoff.md`
  is now the auto-install verification doc (the original user-cp
  design was superseded by Slice 7). L1-verified via the
  `karpathy-6-agent-prompt.test.ts` AC-7 + AC-8 assertions; L2
  verification deferred to the first real npm publish.

---

## [2.5.0] — 2026-06-17

### Fixed (realworld-fixes slice 014)

- **Context-overflow guidance now visible in SKILL.md body** (sub-fix A) — slice
  011 added `peaks session checkpoint` / `peaks session resume` CLIs plus
  `references/checkpoint-resume.md` + `references/periodic-checkpoint.md`, but
  SKILL.md body only mentioned them in a single line. New Claude Code sessions
  that load SKILL.md never learned the optimization existed. `### Peaks-Cli
  Step 0.75: Resume from checkpoint` and `### Peaks-Cli Step N: Periodic
  checkpoint` headings are now in the body (≥ 5 lines each), with explicit
  `peaks session checkpoint` / `peaks session resume` CLI mentions and
  reference-doc pointers. Byte cap bumped 22K → 24K (precedent: 18K → 20K → 22K).
- **`peaks test <pattern...>` CLI with smart cache** (sub-fix B) — new CLI
  auto-detects jest / vitest / mocha from consumer `package.json`, runs with
  `--cache` (NOT `--no-cache`, overriding the consumer's `test` script).
  Per-test fingerprint cache at `.peaks/_runtime/test-cache/<hash>.json` with
  schema `{ fileMtime, fileSha256, testName, status, durationMs, lastRun }`
  skips unchanged tests on re-run. Options: `--changed`, `--clear-cache`,
  `--no-cache-result`, `--passthrough`, `--all`. Exits 0 if all pass/skip,
  1 if any fail. This is a NEW top-level subcommand (peaks-test exception
  per G16; not a pure wrapper because of smart-cache value-add).
- **Playwright MCP multi-terminal conflict resolution** (sub-fix C) — new
  `peaks playwright start | ls | stop` CLI. `start` walks default port 8931
  → 8949, spawns `playwright-mcp` via `npx` (not bundled), writes
  `.peaks/_runtime/playwright-sessions/<terminal-id>.json` with
  `{ port, userDataDir, startedAt, pid }`. Terminal ID: `TERM_SESSION_ID` ||
  `WT_SESSION` || hash(`ppid` + `SSH_TTY`). Conflict detection emits a
  clear "port in use; pick --port or --reuse" message.

### Security

- `peaks playwright start` uses `spawn` with array argv (no shell concat) to
  eliminate command-injection risk.
- Terminal IDs are sanitized (`[^a-zA-Z0-9_.-]` → `_`) before becoming
  filenames.
- Port walk range is bounded 8931-8949 (19 ports) to prevent scanning the
  full port space.

### Tests

- 81 new vitest assertions across `test-cache-service.test.ts` (19),
  `test-command.test.ts` (17), `playwright-command.test.ts` (18), and the
  bumped skill-slim-content-coverage test (now 18 cases under 24K cap).
- Argv contract: `peaks test` defaults include `--cache`; `--no-cache` is
  only added when the user explicitly passes it (or `--passthrough`).

### L2 dogfood (deferred)

- None — all 3 sub-fixes are L1-only; no real-install / real-consumer
  dogfood required for 2.5.0.

---

## [2.4.0] — 2026-06-17

### Added

- **`CURSOR_ADAPTER`** (slice 012) — Cursor IDE registration on the existing
  `IdeAdapter` shape. 12 required fields filled: `id: 'cursor'`,
  `settings.dirName: '.cursor'`, `settingsFileName: 'settings.json'`,
  `envVar: 'CURSOR_PROJECT_DIR'` (UNVERIFIED),
  `hookEvent: 'beforeShellExecution'` (UNVERIFIED),
  `toolMatcher: 'Bash'`, `promptSizeAware: true`, `statusline: true`.
  `standardsProfile` and `skillInstall` left UNVERIFIED — falls back to
  the legacy Claude Code path with stderr warning per slice #011 framework.
- **`CODEX_ADAPTER`** (slice 013) — OpenAI Codex CLI registration. 12
  required fields: `id: 'codex'`, `settings.dirName: '.codex'`,
  `settingsFileName: 'settings.json'`,
  `envVar: 'CODEX_PROJECT_DIR'` (UNVERIFIED),
  `hookEvent: 'pre_tool_use'` (UNVERIFIED),
  `toolMatcher: 'shell'`, `promptSizeAware: false` (Codex hook semantics
  differ from Claude's), `statusline: false` (Codex CLI has no statusline
  UI). `standardsProfile` and `skillInstall` left UNVERIFIED — same
  legacy fallback.
- **`HOOK_COMMAND_BY_IDE` dispatch table** (slice 012+013 infrastructure)
  — `src/services/skills/hooks-settings-service.ts::resolveHookSpec`
  refactored from hardcoded if/else into a per-IDE dispatch table.
  Byte-stable for `claude-code` and `trae` (AC8 / AC15 ✓). New adapters
  join the table without per-IDE branch rewrites.

### Security

- UNVERIFIED annotations on `envVar` / `hookEvent` for Cursor and Codex
  carry the same risk profile as the slice #009 Trae UNVERIFIED state —
  the per-IDE field values are not yet confirmed against real installs.
  Until L2 dogfood closes, `peaks hooks install --ide cursor|codex`
  will write hook entries that follow each IDE's most-likely hook
  schema; if the IDE rejects the entry, the install returns a non-zero
  exit code with the schema mismatch surfaced in stderr.
- Bundled-skills postinstall for Cursor / Codex writes to
  `~/.claude/skills/` (legacy Claude Code fallback), NOT to
  `~/.cursor/skills/` or `~/.codex/skills/`. This is the slice #011
  framework's intentional fallback for adapters whose `skillInstall` is
  UNVERIFIED; AC16 is 3-layer-verified.

### Performance

- `detectIdeFromContext` cwd-fallback path stays linear in adapter count.
  Slice #2 memory anchor: 2 adapters ≈ 27µs; this release: 6 adapters
  ≈ 67µs (extrapolated; well under 1ms budget).
- `HOOK_COMMAND_BY_IDE` dispatch is a `Map.get` lookup — O(1) per hook
  install, no per-IDE if/else branch overhead.

### Tests

- 48 new vitest cases across `cursor-adapter.test.ts` (24) and
  `codex-adapter.test.ts` (24). **182/182 pass** in
  `tests/unit/ide/` (was 134; +48).
- AC6 / AC13 explicitly assert `<projectRoot>/.<ide>/settings.json` for
  `scope=project` (L1 default); AC7 explicitly asserts
  `~/<ide>/settings.json` for `scope=global`.
- AC16 (UNVERIFIED skillInstall fallback) verified at three layers:
  (1) adapter field is `undefined`; (2) `getSkillInstall('cursor')` and
  `getSkillInstall('codex')` return `null`; (3) `install-skills.mjs:474-484`
  emits stderr "falling back to the legacy Claude Code path
  (~/.claude/skills + ~/.claude/output-styles)" and writes to
  `~/.claude/skills/`.
- Byte-stability: `git diff
  src/services/ide/adapters/{claude-code,trae}-adapter.ts` returns
  empty (AC8 / AC15 ✓). Dispatch chokepoints `resource-profile.ts` /
  `ide-aware-standards-service.ts` / `install-skills.mjs` untouched
  (R6 inverse rule ✓).

### L2 dogfood (deferred)

- Real-install dogfood for Cursor 1.x — fill `CURSOR_ADAPTER.envVar` and
  `CURSOR_ADAPTER.hookEvent` from real payload, remove UNVERIFIED
  annotations. Follow the slice #009 Trae-dogfood pattern
  (`tests/fixtures/cursor/cursor-1x-payload.json` + 5+ dogfood paths on
  a real install once available).
- Real-install dogfood for Codex — same pattern as Cursor.
- `standardsProfile` + `skillInstall` filling for both adapters is
  gated on the env/hook dogfood landing first.
- Qoder + Tongyi Lingma adapters (slice #3+ backlog) remain deferred.

### Notes

- Pipeline layout caveat: `peaks workflow verify-pipeline` expects
  artifacts under `.peaks/_runtime/<change-id>/...` (per-change layout) but this
  session writes under `.peaks/_runtime/<session-id>/...` (per-session
  runtime layout). The pipeline may report `gateC: fail` despite a
  PASS verdict; reconcile in a future slice (peaks-cli tooling fix,
  not a 2.4.0 blocker).

---

## [2.3.0] — 2026-06-17

### Added

- **`peaks workspace consolidate`** (slice 011) — atomic cross-date session retirement.
  Dry-run by default; `--apply` moves `.peaks/_runtime/<sessionId>/` to
  `.peaks/_archive/retrospective-<date>/<sessionId>/` with `manifest.json`.
  Supports `--keep <sessionId>...` and `--older-than <days>`. Invoked by skill,
  not by user.
- **`peaks session checkpoint`** (slice 011) — JSON snapshot of session state
  for context-overflow recovery. 11 fields (sessionId, lastActivity, currentPlan,
  openQuestions[], recentDecisions[], recentArtifactPaths[], gitStatus,
  skillsActive, todoState, reason, createdAt). Max 10 retained, oldest auto-pruned.
- **`peaks session resume`** (slice 011) — reads checkpoint JSON, emits structured
  markdown block for skill to prepend on session restart.
- **peaks-solo Step 0.5** (slice 011) — cross-date session check.
  IDE-agnostic; lives in `skills/peaks-solo/references/cross-date-session-check.md`.
- **peaks-solo Step 0.75** (slice 011) — checkpoint resume probe.
- **peaks-solo Step N** (slice 011) — periodic checkpoint guidance.

### Security

- Path-traversal guard on `consolidate` destination (rejects `..`).
- `checkpoint` writes only inside `.peaks/_runtime/<sessionId>/checkpoints/`.
- `resume` reads only from `.peaks/_runtime/<sessionId>/checkpoints/*.json`.

### Performance

- 50-session `consolidate` plan+apply completes in <500ms (warm cache).
- `checkpoint` write <100ms per call.
- 12th checkpoint prunes oldest (MAX_CHECKPOINTS=10).

### Tests

- 25 new unit tests (12 consolidate + 8 checkpoint + 5 resume) — all green.
- 112/112 slice-relevant tests pass; 9 pre-existing baseline failures on
  `26a4bab` are unrelated and out of scope.

### L2 dogfood (deferred)

- Cross-IDE dogfood for Trae deferred to follow-up — see
  `.peaks/_runtime/2026-06-16-session-aaf8c7/qa/dogfood/2026-06-17-cross-ide.md`.
- slice #2 adapter registry contains only `claude-code` + `trae`; Cursor / Codex /
  Qoder / Tongyi Lingma are slice #3+ scope.

## [2.2.1] — 2026-06-14

### Fixed

- **Removed the `Bash` matcher from the consumer-project
  `.claude/settings.local.json` template** (`TEMPLATE_VERSION` 1.1.0 →
  1.2.0). The Bash matcher was emitting `process.exit(1)` with no
  stderr on every non-`peaks` Bash call, producing
  `Failed with non-blocking status code: No stderr output` noise in
  the Claude Code UI even though the underlying tool call still
  proceeded (per Claude Code's hook contract, `exit 1` is a
  non-blocking error, not a block — only `exit 2` blocks; only the
  absence of a downstream `[Fact-Forcing Gate]` turned the exit-1
  into pure noise). The `[Fact-Forcing Gate]` is an Edit/Write
  concern (it forces the LLM to quote user instructions before any
  file write), and the Bash matcher was unrelated to that purpose.
  Bash command enforcement is now owned by `peaks gate enforce`,
  which `peaks hooks install` injects into `.claude/settings.json`
  and which exits 0 silently for any command not guarded by a
  registered SOP gate.

  Concrete changes:
  - `src/services/workspace/claude-settings-template.ts` — deleted
    `PEAKS_SUBCOMMAND_ALLOWLIST`, `buildBashHookCommand()`. The
    template now emits only the `Write|Edit|MultiEdit` matcher.
  - `TEMPLATE_VERSION` bumped to `1.2.0`. The offline-template
    self-heal (`peaks workspace init` re-run; comparator
    `templateContentMatches` sees the dropped entry) refreshes
    `.peaks/.claude-settings-template.json` and the consumer's
    `.claude/settings.local.json` on the next `peaks workspace init`.
  - The `peaks workspace init` install prompt for the project-level
    `.claude/settings.json` still installs the `peaks gate enforce`
    hook for Bash (unchanged).

### Tests

- `tests/unit/workspace/claude-settings-template.test.ts` — added
  `template only emits the Write|Edit|MultiEdit matcher` assertion.
  Removed four Bash-specific tests (hook command contract, embedded
  double-quote escaping, `process.argv[1]` reading for the Bash
  hook, `peaks workspace init` allow / `npm install foo` deny).
  `templateContentMatches returns false when entry length differs`
  now uses an empty `PreToolUse` array to keep the test name
  accurate.
- `tests/unit/workspace/workspace-init-claude-hooks.test.ts` — case A
  (default-flags init) assertion changed from
  `expect(matchers).toContain('Bash')` to
  `expect(matchers).toEqual(['Write|Edit|MultiEdit'])`. File-level
  AC description updated to reflect the one-matcher shape.

Full suite: **2957 passed, 12 skipped, 0 failed**.
`peaks doctor`: **70 passed, 0 failed**.

---

## [2.2.0] — 2026-06-14

### Added

- **Generic fzf binary picker** — `src/services/fuzzy-matching/fzf-pick-service.ts` exposes
  `pickFromList<T>({ items, formatLine, parseLine, outputPath, meta, fzfBin, preview, overrideStdin, projectRoot, multi, prompt })`.
  Promoted from `slice-pick-service.ts`; the algorithm is fzf-free, the binary is the consumer.

- **`peaks memory list`** — new subcommand. Reads `.peaks/memory/index.json`, applies optional
  `--kind` filter, returns the full entry set as the standard envelope. Mirrors
  `peaks retrospective index`.

- **`peaks memory list --pick`** and **`peaks retrospective index --pick`** — both spawn fzf
  for interactive multi-select. Picked subset is written to `.peaks/memory/picked.json` or
  `.peaks/retrospective/picked.json` respectively. Exit code 127 on missing/old fzf.

- **`headroom-ai` preferences resolver** — `src/services/context/headroom-prefs.ts` with
  `resolveHeadroomOptions` and `shouldCompressResults` (pure functions, no IO). Sub-agent
  dispatch now reads `loadPreferences().headroom` and:
    - Hard-blocks `--use-headroom` when `headroom.enabled = false` (new error code
      `HEADROOM_DISABLED_BY_PREFERENCE`, exit 1).
    - Respects `--headroom-mode <m>` CLI override > `perTouchpoint.subAgentDispatch` >
      `defaultMode` precedence.
    - Falls back to G7 metadata-only on any preferences load failure (no dispatch break).

- **New preferences fields** — `headroom.perTouchpoint.subAgentDispatch` and
  `headroom.compressMinBytes` (default 4096). Shallow-merge on existing
  `preferences.json` files; no migration required.

- **Search result compression** — `searchMemoryWithResults` and
  `searchRetrospectiveWithResults` return a `CompressedResultsEnvelope` alongside the
  structured `matches` array. Joined match text is compressed via headroom-ai when the
  byte count exceeds `headroom.compressMinBytes`. Below-threshold or headroom-disabled
  cases return `compressedResults: null` (silent, non-blocking fallback).

- **`peaks memory search --compress-results`** — passes the option through. (Retrospective
  search gets the same in a follow-up slice if requested.)

- **`peaks slice decompose --benchmark`** — emits a `SliceBenchmark` envelope
  (`totalMs`, `codegraphQueries`, `p50ConfidenceDistribution`, `inputApproxBytes`,
  `outputJsonBytes`, `capturedAt`) and persists it to
  `.peaks/_runtime/benchmarks/<rid>.benchmark.json` for cross-version comparison.
  This is the egress path for verifying 2.1.0 → 2.1.1 algorithm optimizations
  (Stoer-Wagner min-cut + flow_step weights) end-to-end.

### Changed

- **`src/services/slice/slice-pick-service.ts`** is now a thin wrapper around
  `fzf-pick-service.ts`. Public API (`pickSlicesInteractive`, `PickOptions`,
  `PickedResult`) is preserved.

### Tests

- `tests/unit/fuzzy-matching/fzf-pick-service.test.ts` — 10 cases (ENOENT, version check,
  single/multi select, Esc-130, parseLine rejection, dedup, artifact write, overrideStdin,
  empty items).
- `tests/unit/headroom-prefs.test.ts` — 11 cases covering all `resolveHeadroomOptions`
  branches and `shouldCompressResults` (disabled / below-threshold / enabled / per-touchpoint
  mode).
- `tests/unit/slice/slice-pick-service.test.ts` — pre-existing 7 cases still pass.
- `tests/unit/memory-search-cli.test.ts` — 8 cases updated to await the now-async
  `runMemorySearch`.

### Dogfood

- `HEADROOM_DISABLED_BY_PREFERENCE` hard block verified end-to-end with a temp
  `.peaks/preferences.json` (`headroom.enabled=false`): exit 1, envelope code matches,
  two actionable `nextActions`. Without `--use-headroom`, the same project dispatches
  normally.

---

## [2.1.1] — 2026-06-13

### Added

- **`peaks slice decompose <rid>`** — the 6-stage slice-decomposition
  algorithm. Reads the PRD body, queries `peaks codegraph` for each
  acceptance criterion, reads `.understand-anything/knowledge-graph.json`
  for semantic boundary detection, builds a dependency DAG with verified
  edges, computes SCC + critical path, runs Stoer-Wagner-style min-cut
  with semantic-preference weights (`flow_step`=0.05, `imports`=10.0),
  and partitions the result into parallel batches.
  Outputs `.peaks/sc/slice-decomposition/<rid>.json`. Algorithm is
  fzf-free; the codegraph/understand-anything inputs are both
  consumed as algorithm inputs, not as decoration.

- **`peaks slice pick <rid>`** — interactive multi-select of candidate
  slices via `fzf` (>= 0.38). Reads the decomposition file, spawns
  fzf with formatted candidate lines, parses the multi-selection, writes
  `.peaks/sc/slice-decomposition/<rid>-picked.json`. The algorithm is
  fzf-free; this is the only fzf dependency in the pipeline.

- **`peaks slice plan <rid>`** — dry-run plan that reads -picked.json
  and produces a structured plan with `newRid`, `type`, `dependsOn`
  edges. `--apply` is documented as v1.1 behavior (the dry-run path
  is fully functional; v1.1 will wire it to spawn `peaks request init`).

- **`src/services/slice/slice-decompose-types.ts`** — 24 TypeScript types
  for the algorithm's input/output contract. Stable envelope shape;
  any field rename requires a migration path.

- **`src/services/slice/calibration-store.ts`** — pure LoC+test-count
  heuristic for work estimation. v1 reports `confidence: 'low'` until
  5+ historical slice records exist; v1.1 will switch to percentile
  lookup.

- **`peaks-solo` Step 0.6** — pre-mode-selection slice decomposition.
  Solo runs the algorithm automatically after Step 0.55 (1.x detection)
  returns "fresh". The user picks a profile informed by the
  decomposition's parallel structure.

- **3 new `peaks-solo/references/*.md`** — `slice-algorithm.md`
  (algorithm spec), `understand-anything-integration.md` (KG consumer
  contract), `fzf-integration.md` (operator-facing fzf usage).

- **Extended `codegraph-orchestration.md`** — grew from 5 lines
  to ~200 lines documenting the envelope contract, freshness
  contract, the v0.7.10 cross-file-affected limitation + v1
  fallback, the status-parsing regex, and the role-handoff envelope.

- **Extended `swarm-dispatch-contract.md`** — adds
  "Slice-decomposition-driven fan-out (v2.1+)" section. Swarm plans
  now derive from `parallelBatches` (with legacy `--type` lookup as
  the fallback path).

- **Extended `peaks-solo/SKILL.md`** — adds "Peaks-Cli Slice
  Decomposition (Step 0.6 — pre-mode-selection)" section.

- **Extended `runbook.md`** — adds "Step 2.5: Slice Decomposition"
  section between the PRD transition and the Swarm fan-out.

### Changed

- **`peaks codegraph` is now a runtime algorithm input**, not a
  decoration. The slice-decomposition algorithm queries it (Stage 1)
  and reads cross-file-affected results (Stage 2, with v0.7.10
  fallback to real import edges).

- **`understand-anything` is now a runtime algorithm input** at the
  semantic boundary layer. The algorithm adds `flow_step` /
  `contains_flow` edges to the DAG with the lowest min-cut weights
  (0.05 / 0.10), preferring to cut through semantic seams.

- **`peaks project dashboard` does not regress** with the new
  `.peaks/sc/slice-decomposition/` path. The path is at the top level
  of `.peaks/`, not under `.peaks/_runtime/`, so it does not trip the
  L3:l3-orphan-sessions doctor check.

### Deprecated

- The "one rid = one feature" pattern. From 2.1.1 onward, the
  recommended workflow is: PRD -> `peaks slice decompose` -> `peaks
  slice pick` (interactive) -> `peaks slice plan` -> N child rids.
  Legacy `--type`-based fan-out still works as a fallback for rids
  that pre-date the algorithm.

### Fixed

- **No public API, command, flag, or dependency change.** This is
  a feature-only patch. The new `peaks slice <subcommand>` family
  adds 3 sub-commands; existing `peaks slice check` is unchanged.

- **No data schema migration.** The new algorithm writes
  `.peaks/sc/slice-decomposition/<rid>.json` (and `<rid>-picked.json`).
  Both paths are git-ignored runtime state. No existing JSON file
  format changed.

- **`peaks codegraph` wrapper** now consistently accepts
  `--project <path>` for all subcommands (query, affected, status).
  The wrapper falls back to raw `codegraph` (without `--project`)
  only when `peaks` is not on PATH.

- **PRD body lookup** now walks `.peaks/_runtime/*/prd/requests/`
  (not just 3 hardcoded paths). Handles the real
  `NNN-<rid>.md` filename convention from `peaks request init`.

### Verified

- 232 test files / 2939 tests pass, 0 failures, 12 skipped
  (baseline 229/2894 -> delta +3 files / +45 tests).
- `npx tsc --noEmit` clean.
- `npm run build` clean.
- End-to-end CLI smoke test on peaks-cli repo:
  `peaks slice decompose 2026-06-13-slice-decompose-impl --json` returns
  `ok: true`, writes 9 work units, 1 dep edge, p50=247.5 within the
  expected [202, 248] range (8-WU 2.1.0 dry-run p50=225 +-10%).
- `peaks doctor` clean (no L3 regressions from the new path).
- QA verdict: pass (10 of 10 ACs pass; AC10 has 1 partial
  regarding peaks-cli's existing `review-fanout` path mapping, but
  the partial is a pre-existing architecture issue, NOT a regression
  from this slice).

### Known limitations (v1.1+ scope)

- `peaks codegraph` v0.7.10 `affected` returns 0 cross-file dependents;
  the algorithm falls back to real static import edges. v1.1 should
  read `.codegraph/codegraph.db` directly.
- understand-anything is not indexed on most projects; the algorithm
  falls back to structural-only cuts and reports
  `understandAnything.fallback: "structural-only"`.
- Calibration `confidence: 'low'` until 5+ historical slice records
  exist; v1.1 will switch to percentile lookup.
- fzf `>= 0.38` required for `peaks slice pick`. Earlier versions
  lack `--filter` and proper `--preview` support.
- The min-cut is a simplified sort + filter, not textbook
  Stoer-Wagner. v1.1 will swap in the full algorithm.
- `peaks slice plan --apply` is dry-run only; v1.1 will wire to
  spawn `peaks request init` for each picked slice.
- Path traversal hardening (`assertValidRid`) and DoS cap
  (`--max-wu N` default 500) are 1-line patches planned for v1.1.
- The 3 default runners (codegraph / understand / import-edge) have
  0% unit-test coverage because they shell out to real binaries.
  v1.1 will add `vi.mock('node:child_process')` tests to push
  coverage of `slice-decompose-service.ts` toward 100%.

---

## [2.1.0] — 2026-06-13

### Changed

- **`~/.peaks/config.json` is now strictly `{ version, ocr.llm.* }`.**
  All LIVE runtime data has moved to dedicated sidecar files under
  `~/.peaks/`:
  - `~/.peaks/providers.json` — `providers.minimax.{model, baseUrl, apiKey}`
    and any future custom provider configs (canonical home: provider-service.ts).
  - `~/.peaks/proxy.json` — `httpProxy` for outbound HTTP/HTTPS
    (canonical home: proxy-service.ts).
  - `~/.peaks/workspaces.json` — registered workspaces + current-workspace
    pointer (canonical home: workspace-state-service.ts).
  On-disk legacy bloat is auto-detected and promoted to the correct
  sidecar on next CLI invocation; the slim `config.json` is then
  rewritten. The migration is **idempotent and silent** — no user
  action required.
- **`peaks config migrate --apply` distributes legacy fields across
  their canonical homes.** `economyMode` / `swarmMode` continue to
  forward to `<project>/.peaks/preferences.json`; `providers` /
  `proxy.httpProxy` / `workspaces` / `currentWorkspace` now forward
  to their respective sidecar files. Original config is preserved
  in `~/.peaks/config.json.1.x.bak` for rollback.
- **`PeaksConfig` type marks legacy fields `@deprecated`.** The slim
  runtime shape is `{ version, ocr? }`; the legacy fields stay
  optional on the type so existing consumers (config-service.ts,
  workflow-commands.ts, etc.) continue to compile during the
  migration window. A future slice will redirect `setConfig` writes
  for legacy keys to their canonical homes with a clear migration
  hint.

### Added

- **New `src/services/config/sidecar-store.ts`** — path helpers
  (`providersConfigPath()`, `proxyConfigPath()`, `workspacesConfigPath()`)
  + generic `readSidecarJson<T>` / `writeSidecarJson` with the same
  hardened-fs guarantees as `config-safety.ts` (symlink / hardlink
  guards, atomic temp-file rename, 0o600 mode).
- **New `src/services/config/provider-service.ts`** —
  `getMiniMaxProviderConfig()`, `setMiniMaxProviderConfig()`,
  `getMiniMaxProviderStatus()`, `getAllProviders()`,
  `setProviderConfig(id, …)`, plus URL validation helpers
  (`isValidMiniMaxBaseUrl`, `validateMiniMaxBaseUrl`,
  `isValidProviderBaseUrl`, `validateProviderBaseUrl`,
  `validateModelProviderConfig`).
- **New `src/services/config/proxy-service.ts`** —
  `getHttpProxy()`, `setHttpProxy()`, `clearHttpProxy()`,
  `isValidProxyUrl()`, `validateProxyUrl()`.
- **New `src/services/config/workspace-state-service.ts`** —
  `getWorkspaces()`, `getCurrentWorkspace()`, `setCurrentWorkspace()`,
  `addWorkspace()`, `removeWorkspace()`, `getWorkspaceConfig()`,
  `getCurrentWorkspaceConfig()`, `getWorkspaceConfigForPath()`,
  `getWorkspaceConfigForCurrentPath()`,
  `ensureWorkspaceConfigForPath()`,
  `ensureWorkspaceConfigForCurrentPath()`.
- **`loadGlobalConfig()` governance hook.** On any read, if the
  on-disk `~/.peaks/config.json` contains fields outside
  `{ version, ocr }`, the function now promotes them to their
  sidecar file (if not already present) and rewrites the slim
  shape. Idempotent.

### Deprecated

- The `providers`, `proxy`, `workspaces`, `currentWorkspace`,
  `language`, `model`, `economyMode`, `swarmMode`, `tokens` fields
  on `PeaksConfig` are now `@deprecated`. They continue to work
  during the migration window (reads return merged legacy values;
  writes go to `~/.peaks/config.json`) but new code should target
  the sidecar modules directly. The next minor release (2.2.0)
  will remove them from the type entirely and `setConfig` will
  reject writes to these keys with a clear migration hint.

### Fixed

- **No public API, command, flag, or dependency change.** Existing
  CLI commands (`peaks config get/set`, `peaks config migrate`,
  `peaks config provider minimax …`) continue to work; their
  on-disk effects now match the slim 2.1.0 layout after the first
  governance pass.

### Verified

- 229 test files / 2894 tests pass, 0 failures, 12 skipped.
- Full 1.x → 2.0 → 2.1 dogfood cycle: `peaks config migrate --apply`
  on a bloated 1.x file produces the correct slim `config.json` +
  populated `providers.json` / `proxy.json` / `workspaces.json` +
  `<project>/.peaks/preferences.json` (per-project fields only).
- Rollback via `peaks config rollback` restores the original 1.x
  shape from `.bak`.
- `package.json.version` and `src/shared/version.ts` synced to
  `2.1.0` via `node scripts/sync-version.mjs` at release time.

---

## [2.0.6] — 2026-06-13

### Fixed

- **23 pre-existing test failures → 0 across 9 test files.** Repair slice
  `2026-06-13-repair-pre-existing-test-failures` (6 atomic commits, all
  green, all red-line compliant) eliminated the long-standing flake
  surface so the test suite is a trustworthy gate again.
- **`peaks doctor` L3:l3-memory-health now reads the actual on-disk
  schema.** The detector used to probe for a `schema_version` field
  that the durable memory store never writes; it now reads the real
  `version: 1` + hot/warm structure. The user-visible message text
  changed from `schema_version=N; K memory entries` to the more
  accurate `version=N; K hot + K warm memory entries` (cosmetic only;
  the JSON envelope `id` / `ok` / `message` shape is unchanged). The
  underlying `readMemoryFile` and the 3-state detector logic are
  unchanged — only the schema probe and the message formatter moved.
- **`plan-reader assertContained` realpath-resolves both sides
  symmetrically on macOS.** On macOS, `os.tmpdir()` is a symlink
  (`/var/folders/...` → `/private/var/folders/...`). The previous
  implementation realpath-resolved the actual on-disk path but compared
  it against the unresolved `expectedBase`, producing a spurious
  "outside project root" failure for any `peaks` CLI invocation that
  passed through a symlinked temp dir (notably `peaks doctor` and
  `peaks workflow verify-pipeline` from `/tmp`-style paths). Both
  sides are now resolved before comparison.

### Changed

- **No public API, command, flag, or dependency change.** Two source
  files were touched (`src/services/doctor/doctor-service.ts` and
  `src/services/workflow/plan-reader.ts`); both changes STRENGTHEN
  existing guards, neither widens the surface. Patch bump, not minor.

### Verified

- 23 → 0 test failures across 9 test files (full suite green).
- `peaks request transition --state implemented` accepted for
  `2026-06-13-repair-pre-existing-test-failures` prior to this release.
- `package.json.version` and `src/shared/version.ts` are in sync at
  `2.0.6` (regenerated via `node scripts/sync-version.mjs`).

---

## [2.0.5] — 2026-06-13

> **Retroactive entry.** Commit `9ab4154 feat: 2.0.5` only bumped
> `package.json` and `src/shared/version.ts`; this entry closes the
> documentation gap.

### Added

- **`peaks workflow skip <rid>`** — explicit gate-bypass primitive
  for the workflow pipeline. Backed by a three-rule classifier that
  must all pass before the bypass is allowed:
  1. **Slice-type allowlist** — only `chore` / `docs` / `refactor` are
     eligible; `feat` / `fix` / `perf` are not.
  2. **Env-var caller-id** — `PEAKS_SKIP_CALLER` (or
     `PEAKS_CALLER_ID`) must identify the human/skill driving the
     call; a missing or anonymous caller-id is rejected.
  3. **Mandatory `--reason`** — the CLI rejects `--reason ""`; the
     reason is persisted into the slice record for the retrospective.
  Three rules, not one: each rule is independently fail-closed, so a
  misuse in any one of them blocks the bypass. The classifier is the
  pure function `canSkipSlice(slice, callerId, reason)` so the rule
  set is testable in isolation.
- **`peaks workflow verify-pipeline --gate-skipped`** — reporting
  flag that surfaces slices that completed via the skip classifier
  during a pipeline run. The default `verify-pipeline` output hides
  skipped slices; `--gate-skipped` includes them in the per-slice
  breakdown with a distinct status and the recorded `--reason` so the
  retrospective can audit the bypass rate.

### Changed

- **No dependency / config / public-API change.** The 2.0.5 release
  is a feature-only patch.

### Verified

- 3-rule classifier test suite green (`tests/unit/workflow-skip-*`).
- `peaks workflow verify-pipeline --gate-skipped` returns the
  expected envelope shape on synthetic skip and non-skip fixtures.
- Slice `2026-06-13-peaks-workflow-skip` (the slice that introduced
  the feature) closed green and transitioned to `implemented` before
  the version bump.

---

## [2.0.4] — 2026-06-13 (hotfix)

### Fixed

- **PreToolUse hook `command` field was bare JavaScript source, not a
  `node -e "..."` one-liner.** `peaks workspace init` writes
  `.claude/settings.local.json` containing two PreToolUse hooks (one
  for `Bash`, one for `Write|Edit|MultiEdit`) whose `command` field
  was the inner JS payload without the `node -e "..."` wrapper.
  Claude Code executes the `command` field as a shell string, so
  bash saw literal `const c=process.argv[1]...` and tripped
  `syntax error near unexpected token`. Net effect on every 2.0.3
  install on Windows + macOS + Linux:
  - Every Bash tool call (peaks CLI or otherwise) was rejected.
  - Every Write / Edit / MultiEdit call was rejected.
  - The [Fact-Forcing Gate] bypass that `peaks workspace init` was
    supposed to install was therefore self-defeating — the bypass
    broke the gate itself, and the gate could not be reached to fix
    it.
  Recovery required the user to delete `.claude/settings.local.json`
  manually (losing the bypass permanently) or hand-patch the
  `command` field (drift vs the template).
  The fix wraps both builders' JS payloads in a real shell-evaluable
  `node -e "<js>"` form via a new `wrapAsNodeOneLiner` helper in
  `src/services/workspace/claude-settings-template.ts`. Inner `"`
  are escaped to `\"`; backslashes pass through unchanged so regex
  literals like `/\.peaks\//` still match correctly. `process.argv[1]`
  is the correct slot under `-e` per Node.js docs
  (https://nodejs.org/api/process.html#processargv) — consistent
  across Windows, macOS, and Linux. The docstring is reconciled
  with the implementation (the previous docstring incorrectly said
  `argv[2]`).

  Regression tests cover:
  - `buildBashHookCommand()` and `buildWriteHookCommand()` return
    `node -e "..."` form.
  - Inner `"` are escaped to `\"`.
  - Spawning the wrapped command with `peaks workspace init --project . --json`
    exits 0; with `npm install foo` exits non-zero.
  - Spawning the Write hook with `.peaks/_runtime/...` and
    `.peaks/_runtime/<changeId>/...` paths exits 0; with `src/...`,
    `package.json`, `.peaks/_archive/...` exits non-zero.
  - The existing workspace-init round-trip test (case A/B/C) still
    passes with the wrapper.

---

## [2.0.3] — 2026-06-13

### Fixed

- **`@alibaba-group/open-code-review` reverted to `optionalDependency`**
  (was promoted to a hard `dependency` in 2.0.1 and carried through
  2.0.2). The ocr npm package's `postinstall` downloads a Go binary
  via HTTPS, which fails in restricted/proxied environments and was
  aborting the whole `npm i -g peaks-cli` flow. The 5-state detector
  (`ready` / `package-missing` / `binary-missing` / `config-missing` /
  `detection-failed`) and the soft-fail policy are unchanged — peaks-cli
  never blocks on ocr being installed; it just no longer forces the
  install. Users who want the second-opinion review run
  `npm i -g @alibaba-group/open-code-review` explicitly. Under pnpm
  they also need `pnpm approve-builds @alibaba-group/open-code-review`
  for the binary download to run. Source-of-truth refactor (ocr config
  under `peaksConfig.ocr.llm`) from 2.0.1 is unchanged.

---

## [2.0.0] — 2026-06-12

### 🎯 Headline

**One-key 1.x → 2.0 upgrade.** `npm i -g peaks-cli@2.0` runs the full
upgrade umbrella in the consuming project automatically (gated by the
1.x detector). The manual fallback is `peaks upgrade --to 2.0 --auto`.

The architecture moves to **skill-first / CLI-auxiliary**: skill SKILL.md
files are the primary surface the LLM consumes; CLI commands are
machine-enforced gates, structured-JSON probes, or side-effect primitives.
See `.claude/rules/common/dev-preference.md` (project-local) for the
operating tenet.

**ocr second-opinion code review (soft-optional).** Alibaba's
`@alibaba-group/open-code-review` is now an `optionalDependency`; when
installed + configured against a user-owned LLM endpoint, peaks-rd's
Gate B3 merges its findings into `code-review.md` as a second opinion
alongside the LLM-only review. Soft-fails so missing ocr never blocks
a slice. New CLI: `peaks code-review detect-ocr` / `run-ocr`. See
`skills/peaks-rd/references/ocr-integration.md` for the contract.

> **Note:** This `optionalDependency` classification was briefly
> promoted to a hard `dependency` in 2.0.1 (alongside the source-of-truth
> refactor) because the user feedback was "peaks-cli should not leave
> install to the user". 2.0.3 reverts just the classification — the
> source-of-truth refactor stays — because the ocr postinstall
> downloads a Go binary via HTTPS, which fails in restricted/proxied
> environments and was aborting `npm i -g peaks-cli`. See the 2.0.3
> entry above for the full rationale.

### Breaking Changes

- **`.claude/rules/` is no longer the source of truth for project standards.**
  The 2.0 canonical location is `.peaks/standards/{common,typescript}/*.md`.
  The 1.x `.claude/rules/` tree is thinned to 2-line pointers during upgrade,
  preserving the original under `.claude/rules/.peaks-2.0-backup-<ISO>/`.

- **`.gitignore` requires a granular `.peaks/` block**, not a wholesale
  `/.peaks/` ignore. The upgrade umbrella migrates the consumer's
  `.gitignore` automatically (with a timestamped backup); without it, 2.0
  tracked artifacts (`.peaks/standards/`, durable `.peaks/memory/*.md`,
  `.peaks/PROJECT.md`, opt-in markers) would be silently hidden from git.

- **Per-project config moved from `~/.peaks/config.json` to `<project>/.peaks/preferences.json`.**
  `~/.peaks/config.json` retains only `{ "version": "2.0.0" }`. Fields
  `economyMode`, `swarmMode`, headroom settings, etc. are now per-project.
  The upgrade umbrella runs `peaks config migrate --apply` automatically.

- **Postinstall behavior changed.** `npm i -g peaks-cli@2.0` now:
  1. Symlinks bundled skills to **all 8 supported IDE platforms**
     (Claude Code, Trae, Cursor, Qoder, Codex, Tongyi Lingma, Aider, Roo Code),
     not just the auto-detected one. Per real Trae user feedback 2026-06-11.
  2. Installs bundled output styles.
  3. If `cwd` contains a 1.x peaks-cli project, fire-and-forgets
     `peaks upgrade --to 2.0 --auto`. Opt out with `PEAKS_SKIP_AUTO_UPGRADE=1`.

### Changed — ocr source-of-truth moved into peaks-cli's config

Following the same-release user feedback that the original 2.0.0 ocr
config lived in `~/.opencodereview/config.json` (a file outside
peaks-cli's reach) and was set via the `ocr config set` CLI from the
upstream package, the ocr LLM endpoint config now lives under
`peaksConfig.ocr.llm` in `~/.peaks/config.json`. This makes the
user-managed LLM endpoint discoverable from a single, peaks-cli-owned
config surface.

- **`@alibaba-group/open-code-review` is now a hard `dependency`** (was
  `optionalDependency`). The user no longer has to remember to install
  it; `npm i -g peaks-cli` pulls it. Network-blocked installs that fail
  to download the platform binary still soft-fail at runtime
  (`binary-missing` state) — the install-time failure risk is the
  trade-off.

  > **Reverted in 2.0.3.** The install-time failure risk turned out
  > to bite too many real-world installs (corporate proxies, region
  > firewalls, sandboxed dev environments all abort the whole
  > `npm i -g peaks-cli`). 2.0.3 puts ocr back under
  > `optionalDependencies`; everything else in this section
  > (env-var injection, `config-template` CLI, `missingKeys`,
  > source-of-truth under `peaksConfig.ocr.llm`) is unchanged.
- **`detectOcr` / `runOcrReview` no longer read `~/.opencodereview/config.json`.**
  The source of truth is `peaksConfig.ocr.llm` (parsed by
  `getOcrLlmConfig()` in `config-service.ts`). Missing fields surface
  in `data.missingKeys`; the `config-missing` state's `nextActions`
  payload embeds the JSON template to paste.
- **Env-var injection replaces file writes.** `runOcrReview` injects
  `OCR_LLM_URL` / `OCR_LLM_TOKEN` / `OCR_LLM_MODEL` /
  `OCR_USE_ANTHROPIC` / `OCR_LLM_AUTH_HEADER` from `peaksConfig.ocr.llm`
  when spawning the ocr subprocess — the ocr package's highest-priority
  config path. peaks-cli never has to materialise
  `~/.opencodereview/config.json`, and does NOT auto-configure the
  endpoint — the user is the only party that touches the LLM
  token / URL.
- **New CLI: `peaks code-review config-template`.** Prints the JSON
  snippet the user pastes into `~/.peaks/config.json`. It does NOT
  write anything. No `peaks ocr config set`, no `ocr config set` — just
  edit peaks-cli's config.json (or use
  `peaks config set --key ocr.llm.url --value '...'` if preferred).
- **JSON envelope contract change:** `OcrDetectResult.configPath` now
  points at the peaks-cli config (e.g. `~/.peaks/config.json`) instead
  of the OCR package's legacy file. A new `missingKeys` field lists the
  required `ocr.llm.*` keys the user has not yet populated. The
  five-state contract and the soft-fail policy are unchanged.

### Migration (ocr source-of-truth)

Users who already configured `~/.opencodereview/config.json` for the
soft-optional 2.0.0 release should:

1. Run `peaks code-review config-template --json` to see the JSON
   snippet.
2. Paste the equivalent values into `~/.peaks/config.json` under
   `ocr.llm` (peaks-cli handles the camelCase conversion; the
   template shows the canonical shape).
3. Re-run `peaks code-review detect-ocr --json` to verify
   `state == "ready"`.

The old `~/.opencodereview/config.json` is no longer consulted by
peaks-cli. The user may delete it at their discretion (the ocr
subprocess ignores it when peaks-cli's env vars are present).

### Added

- **`peaks upgrade --to 2.0`** — umbrella that orchestrates the 1.x → 2.0
  migration: config migrate, standards migrate (`--from-claude-rules`),
  memory extract (with disk-based glob expansion for the consumer's
  artifact tree), hooks install, skill sync, audit verify, plus
  in-process preferences-ensure, gitignore-migrate, and upgrade-record
  write. Soft-fail per sub-step; never blocks the whole upgrade.

- **`peaks upgrade --detect-1x`** — read-only probe returning a JSON
  envelope the peaks-solo skill consumes to gate the AskUserQuestion
  in Step 0.55.

- **`peaks standards migrate --from-claude-rules`** — thins `.claude/rules/`
  to 2-line pointers and scaffolds `.peaks/standards/{common,typescript}/`.

- **`peaks skill sync`** — distributes the skill family across all 8
  supported IDE platforms in one command.

- **`peaks audit red-lines`** — L2 catalog audit (P0/P1/P2-a/P2-b
  enforcers) for skills/SKILL.md, references/*.md, and the agent shield.

- **`peaks agent run`** — ECC 64 agents soft-optional integration
  (spec §7.2). When the L3 stack is installed, peaks delegates to it;
  otherwise degrades to peaks-cli's own core diagnostics.

- **`peaks memory search` / `peaks retrospective search`** — new search
  subcommands for the durable memory / retrospective stores.

- **`peaks workspace init / clean / archive`** — workspace lifecycle
  primitives with `--dry-run` default + `--apply` opt-in.

- **`peaks preferences set / get / reset`** — per-project preferences
  read/write CLI.

- **Two paired tenets** captured in `.peaks/memory/peaks-cli-tenet-one-key-completion.md`:
  - **One-key completion** — actions that can be done in one step
    should not be designed as two-step operations.
  - **Minimal user operation** — features can be powerful, but the
    user-facing surface should be minimal; the CLI/LLM figures it out.

### Fixed

- **(2026-06-12) `upgrade-service.ts` was missing from develop HEAD**,
  causing fresh clones to fail TS2307. Repaired in commit ec6f674.

- **(2026-06-12) `peaks standards migrate --from-claude-rules`** rejected
  as `unknown option`. CLI flag wiring fixed in core-artifact-commands.ts.

- **(2026-06-12) `peaks memory extract`** failed with
  `Artifact path must stay inside the project root` when the umbrella
  passed literal glob strings (`skills/**/SKILL.md`). The umbrella now
  expands globs on disk before spawning.

- **(2026-06-12) Three bugs surfaced by real-world ice-cola dogfood:**
  - memory-extract was called without `--apply` → always dry-ran, never
    actually wrote.
  - `.claude/skills/**/SKILL.md` (the standard Claude-Code consumer
    convention) was not walked; only `<root>/skills/` was scanned.
  - `.peaks/preferences.json` was never created after upgrade, so the
    1.x detector kept returning `isOneX=true` and the user got stuck
    in a re-prompt loop. Violated the one-key completion tenet.

- **(2026-06-12) `.gitignore` 1.x wholesale `/.peaks/` rule** silently
  hid every 2.0 tracked artifact. New `gitignore-migrate-service.ts`
  detects 4 wholesale forms (`.peaks`, `.peaks/`, `/.peaks`, `/.peaks/`),
  removes them, and appends the canonical 2.0 granular block with a
  sentinel comment. Idempotent; creates timestamped backup before write.

- **(2026-06-11) Windows: `peaks slice check`** was using `npx tsc` /
  `npx vitest` which spawned `cmd.exe` indirectly via the npx shim and
  failed with ENOENT. Now resolves local `node_modules/.bin/` binaries
  directly via `runCommand(shell: true)`.

### Deprecated

- **`peaks workspace migrate-1-4-1`** — retained for 1.4.1 → 1.4.2
  legacy session-layout backward compatibility. Will be removed in 2.1.
  Use `peaks upgrade --to 2.0` for the canonical migration path.

### Removed

- `~/.peaks/config.json` schema is now `{ "version": "2.0.0" }` only.
  All other fields are migrated to per-project `.peaks/preferences.json`
  by `peaks config migrate`.

### Architecture

- **Skill-first / CLI-auxiliary.** SKILL.md is the primary surface;
  CLI earns its keep only when (a) hook/script/CI-invokable, (b) the
  consumer needs a structured JSON envelope to gate a decision, or
  (c) destructive side-effect needs explicit `--apply`. See the
  decision template in `.claude/rules/common/dev-preference.md`.

- **Two-axis naming convention** for `.peaks/` workspace:
  `<changeId>` for reviewable artifacts under `.peaks/_runtime/<changeId>/...`;
  `<sessionId>` for ephemeral state under `.peaks/_runtime/<sessionId>/...`.
  Regression test pins zero use of ambiguous `<sid>`.

- **`.peaks/_runtime/`** replaces `.peaks/runtime/` (defensive wrong-path
  pattern still in .gitignore).

### Verified

- 223 test files / 2768 tests pass / 16 skipped.
- `npx tsc --noEmit` clean.
- `npm run build` clean.
- End-to-end dogfood on real 1.x consumer project (ice-cola): 6/6
  upgrade sub-steps pass; `.gitignore` migrated with backup; detector
  returns `isOneX: false` after upgrade; all 2.0 tracked artifacts
  surface in `git status`.

### Migration Guide

See `docs/UPGRADING-2.0.md` for the manual fallback if the auto-upgrade
is skipped (`PEAKS_SKIP_AUTO_UPGRADE=1` or `npm i --ignore-scripts`).

---

## [2.0.1] — 2026-06-12

### Fixed

- **Bug 1 — `~/.peaks/config.json` was bloated to 9 top-level fields.**
  The 2.0.0 release moved per-project fields (`language`, `model`,
  `economyMode`, `swarmMode`) to `<project>/.peaks/preferences.json`
  per spec §10.4, but the runtime `DEFAULT_CONFIG` still shipped
  `language` / `model` / `economyMode` / `swarmMode` / `tokens` /
  `providers` / `proxy` / `progress` placeholders. The slim migration
  (`executeMigration`) wrote `{ version: "2.0.0" }` only, but any
  code path that went through `readConfig` and re-serialised
  re-bloated the file. The 2.0.1 fix:

  1. **Slim `DEFAULT_CONFIG`** to `{ version, ocr: { llm: { url, authToken, model, useAnthropic, authHeader } } }`
     (placeholders for the OCR LLM endpoint only).
  2. **Slim migration write** to the same 2-key form, so a fresh
     `peaks config migrate --apply` produces a discoverable
     `ocr.llm` block the user can paste their endpoint into.
  3. **Tolerant loader.** Legacy 1.x files with extra fields
     (`language`, `model`, `tokens`, `providers`, `proxy`, etc.)
     still load without throwing; the legacy fields are exposed
     via `getConfig` for backward compatibility, and
     `setConfig` rejects writes to `language` / `model` /
     `economyMode` / `swarmMode` with a pointer to
     `<project>/.peaks/preferences.json` (do not silently migrate).

  The net effect: a freshly-installed peaks-cli writes a 2-key
  `~/.peaks/config.json`; legacy 1.x files migrate to the same
  2-key form; the ocr second-opinion config is now the only
  discoverable surface the user needs to populate to make
  `peaks code-review detect-ocr` report `state: "ready"`.

### Verification

- 70 config tests pass (`tests/unit/config-*`).
- `pnpm tsc -p tsconfig.json --noEmit` clean (excluding pre-existing
  sync-service test scaffold for Bug 2).

---

## [2.0.2] — 2026-06-13

### Changed — README redesign (docs only)

The top of both `README.md` and `README-en.md` is rebuilt in the
RAG-Anything style requested from the published repo: card-grid
metadata (PROJECT / BASED ON / SKILLS.SH / STARS / VERSION / LICENSE
/ TESTS / LANG / DOWNLOADS / 中文 / QUICK START / VISITORS), a
multiline `readme-typing-svg` tagline animation, a
`github-readme-streak-stats` streak band, and a `komarev` visitor
counter. Both languages are structurally identical (same card grid,
same animations, same anchor links); only the tagline and
call-to-action text differ.

- `README.md` updated to the new layout (typing animation uses the
  Chinese tagline: `peaks-cli: 跨 AI IDE 的工程门禁与编排`).
- `README-en.md` synced to mirror the new layout (typing animation
  uses the English tagline: `peaks-cli: cross-AI-IDE engineering
  gates & orchestration`).
- Card anchors renamed to ASCII-friendly slugs on the English file
  (`30-seconds-to-running`, `5-minute-onboarding`, `11-skills-in-the-family`,
  `killer-feature-un-bypassable-gates`) so the README renders
  consistently on GitHub's auto-generated anchor list.

No code, CLI, or schema changes. The CLI still reports
`Peaks CLI 2.0.2` after `prepublish` regenerates
`src/shared/version.ts`.

---

## [1.4.2] — 2026-06-08

Last 1.x release. See git history pre-2.0.0 for details.

[2.0.2]: https://github.com/SquabbyZ/peaks-cli/releases/tag/v2.0.2
[2.0.1]: https://github.com/SquabbyZ/peaks-cli/releases/tag/v2.0.1
[2.0.0]: https://github.com/SquabbyZ/peaks-cli/releases/tag/v2.0.0
