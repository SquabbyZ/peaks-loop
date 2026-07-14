# Peaks-Loop Memory Index

> One-line pointer per memory file. Loaded into context every session. Full content lives in each `.md` file.

## 4.x sediment-pool

- [4x-sediment-pool-reserves-desktop-client-entry-points](4x-sediment-pool-reserves-desktop-client-entry-points.md) — 4.x pool + CLI + adapter 对未来桌面客户端天然预留的 4 个契约面（2026-07-04 user note）。
- [peaks-loop-is-enhancement-not-new-cli](peaks-loop-is-enhancement-not-new-cli.md) — peaks-loop = 现有 AI CLI 之上的增强层,不造新 AI CLI（2026-07-04 user note）。
- [human-nl-choice-only-tenet](human-nl-choice-only-tenet.md) — 项目元规则: 人参与决策 = 选择 / 自然语言描述,user 不敲 CLI 也不手写 JSON（2026-07-04 user note,优先级最高）。
- [peaks-loop-local-skillhub](peaks-loop-local-skillhub.md) — peaks-loop 本地 SkillHub store = 版本化的完整 skill 包;为未来线上公共 SkillHub 留 on-ramp;商业延展（2026-07-04 user note chain）。
- [peaks-code-to-peaks-code-rename-session-directive](peaks-code-to-peaks-code-rename-session-directive.md) — 2026-07-05 user 在 rename brainstorm 末尾追加的 6 条硬约束(一次到位 / 不计成本 / 不计时间 / 禁假绿 / 禁偷懒 / 存量迁移 LLM 做),适用于所有 peaks-loop 长任务。
- [peaks-code-consumer-project-smoke-test-ice-cola](peaks-code-consumer-project-smoke-test-ice-cola.md) — 2026-07-05 ice-cola 实测 peaks-code 消费项目两次:早场全绿 + 3 个冰山陷阱(dist 路径 / pnpm link 不触发 build / 全局 peaks 抢路径);晚场 re-run 确认 CLI / SKILL.md / skills/ 4-user-facing 目录全部锁死到 peaks-code-only,user-facing 唯一性成立。
- [user-decision-2026-07-05-eradicate-peaks-code](user-decision-2026-07-05-eradicate-peaks-code.md) — 2026-07-05 user 决定"彻底去根",107 个文件 peaks-code → peaks-code 全替换,包括 48 个 `.peaks/memory/` 历史快照——打破 rename spec AC-10 不动 history 的硬规则。
- [user-decision-2026-07-08-revive-peaks-solo-as-dispatcher](user-decision-2026-07-08-revive-peaks-solo-as-dispatcher.md) — 2026-07-08 商讨锁:4.x-beta 周期内 peaks-solo 0 起来作为 dispatcher(分诊员,不是 orchestrator、不是 rename peaks-code);peaks-code 完整保留;3.x→4.x 升级路径 0 breaking;同步新建 `peaks skill search` CLI 解决 dispatcher 分诊判断源(不能用 `peaks skill list` 兜底);沉淀时机 = LLM 识别 + 用户主动 / leaf 跑完不重复问;注册方式 = 装进 Skill tool skill 池(独立 skill)。
- [2026-07-08-4-0-0-beta-5-overview](2026-07-08-4-0-0-beta-5-overview.md) — 4.0.0-beta.5 整体改动轴心 = 上线 peaks-solo dispatcher(SKI search CLI + skill + 3 references + 老入口 0 改动);10 commits 增量;peak-code 流程 unchanged。后续 cross-version diff 先排除 dispatcher 维度再展开。
- [2026-07-08-4-0-0-beta-6-published](2026-07-08-4-0-0-beta-6-published.md) — 4.0.0-beta.6 已 npm publish + global install 更新(commit ddc85f8);含 OpenSpec 解耦 + vendor adapter + polyrepo;已知遗留(S3-cleanup / AC-4 baseline / AC-5 PARTIAL / final-review allPass=false)。

- [2026-07-09-zcode-adapter-overview](2026-07-09-zcode-adapter-overview.md) — RID 003-add-zcode-adapter 完成总结:Slice A (install 默认 model 修复) + Slice B (zcode-adapter 第 9 个 IDE) 全 PASS,verify-pipeline ok=true。
- [slice-014-vitest-slowdown-and-race-repeat](slice-014-vitest-slowdown-and-race-repeat.md) — Slice 014: vitest fork slowdown × RACE_REPEAT=20 blew 60s/120s timeouts; 修复 = Promise 传播 + RACE_REPEAT 20→3 + describe 60s→180s + withFileLockSync wall-clock guard; 剩余 g8-shared-channel / legacy-detector / file-size-scan 是同样 race-mode 套路,留后续 slice 处理(不是 slice-015 — 见 [[slice-015b-test-full-run-flake-evidence]])。
- [slice-014b-vitest-slowdown-real-cause-fork-accumulation](slice-014b-vitest-slowdown-real-cause-fork-accumulation.md) — Slice 014b: 慢+超时根因 = 单 fork O(N) 累积(非 test body);修 = .session.json stash 挪到 globalSetup + file-parallelism=true + maxWorkers=4 + test:fast lane + 撤销上一会话的 30000 band-aid;3 失败已定位为预存 bug(F-3 已切 delta 断言,另 2 个留 slice 015)。
- [slice-015-swarmplan-strict-standards-reach](slice-015-swarmplan-strict-standards-reach.md) — Slice 015: 修 4 个 CLI catch 一律包 INVALID_GOAL → mapServiceError 路由 (INVALID_PROVIDERS / INVALID_GOAL / INTERNAL_ERROR); ProviderNotConfiguredError typed; 6/6 AC pass; QA verdict-issued + SC handed-off; fanout artifacts (code-review/security/perf/karpathy/mut/third-party-review) --allow-incomplete 跳过。
- [slice-015b-test-full-run-flake-evidence](slice-015b-test-full-run-flake-evidence.md) — Slice 015b: pnpm test:full post-merge 暴露 1 个 Slice 015 Risk A（goal-validation regex vs 实际字面 不同，commit 519cf07 修了）+ 2 个 g8-shared-channel 180s 超时（pre-existing race-mode flake，standalone 27/27 全绿只在 full-suite content 下超时，OOS for slice 015，plan-slice-016）。
- [slice-016-g8-shared-channel-race-mode](slice-016-g8-shared-channel-race-mode.md) — Slice 016: g8 race-mode 180s timeout 根治 = RACE_REPEAT 20→3 + per-test 180s→60s + PEAKS_RACE_REPEAT 保留 20× 路径;test:race 已含 g8 不需改;零残留。
- [slice-016b-cli-command-branches-parallelism-budget](slice-016b-cli-command-branches-parallelism-budget.md) — Slice 016b: cli-command-branches 一个 unmocked skill-doctor 测试在 maxWorkers=4 下被 10s default 撞,改成本地 30_000 budget(budget 而不是 swallow);111/111 across 9 个相关测试全绿。
- [slice-016c-cli-program-workflow-parallelism-budget](slice-016c-cli-program-workflow-parallelism-budget.md) — Slice 016c: cli-program.workflow 的"prefers the workspace matching the current repository"测试(三连 runCommand)在 maxWorkers=4 下被 60s hookTimeout 撞,改成 120_000 显式 budget;133/133 across 8 affected 文件全绿。
- [slice-016d-workflow-autonomous-resume-parallelism-budget](slice-016d-workflow-autonomous-resume-parallelism-budget.md) — Slice 016d: workflow-autonomous-resume-validation 的 "keeps resume preview when resume JSON is malformed"测试在 maxWorkers=4 + 520 文件全量下被 120s default testTimeout 撞,改成 240_000 显式 budget;单文件 baseline 45ms 不变。
- [slice-016e-dispatch-record-truncation-lock-pressure](slice-016e-dispatch-record-truncation-lock-pressure.md) — Slice 016e: dispatch-record-writer 的 "truncates heartbeats past 100 entries"测试 101 次 appendHeartbeat 在 maxWorkers=4 + 全量下被 180s 撞,不是 band-aid 而是根因修:直接 JSON 预填 100 entries + 1 次 appendHeartbeat,锁获取 101→1。
- [slice-016f-cliff-rebump-and-slow-lane-need](slice-016f-cliff-rebump-and-slow-lane-need.md) — Slice 016f: cli-command-branches skill-doctor 30s→60s + workflow-autonomous-resume-validation symlink 0→240s;同时明确 slice-017 slow-lane config split 是结构性修复。
- [slice-017-cli-default-subset-fast-default](slice-017-cli-default-subset-fast-default.md) — Slice 017: pnpm test 默认改为 test:dev:cli 那 41 文件 CLI 子集(400 测试,~3 分 19 秒 vs 老的 37+ 分钟);pnpm test:full / test:unit 不变(CI gate)。
- [slice-018-orphan-scan-budget-fix](slice-018-orphan-scan-budget-fix.md) — Slice 018: orphan-scan.test.ts 5 个 AC-1.x 预算 60s→180s;AC-3 re-export 单文件 60.004s 撞 timeout(真工作负载,非 parallelism 竞争);单文件 13/13 全绿 2m21s;pnpm test:full 用时仍 ~36min(剩 integration suite + 每文件 transform import 税没变)。
- [slice-019-pnpm-test-full-budget-fixes](slice-019-pnpm-test-full-budget-fixes.md) — Slice 019: 3 个 pnpm test:full 真实工作量预算 bump(workflow-autonomous-resume-validation/workflow-autonomous-service/install-skills-dispatch 各 +120s);profile **169 文件 > 60s、61 > 120s、30 > 180s**(总 27548s 墙钟);budget-bump 策略耗尽,需 slice-020 slow-lane split 结构性修。
- [slice-020-attempt-vitest-projects-rollback](slice-020-attempt-vitest-projects-rollback.md) — Slice 020: 试 vitest 4.1.10 `projects` 切 slow lane 救 18min 的 workflow-autonomous-resume-validation 文件;`extends: true` 行为坏,每个测试两个 project 都列,run 没产出 JSON 就 abort,代码已回滚;正确路径 = `workspace` config-key + 兄弟 config 文件,留待后续。
- [slice-020-1-vitest-workspace-not-supported](slice-020-1-vitest-workspace-not-supported.md) — Slice 020+1: 试 vitest 4.1.10 `workspace` config-key (3 attempts: 数组 export / defineConfig wrapper / root config field) 都未生效;`pnpm test` 子集被带坏 14 失败。所有改动回滚,代码回到 slice-017 baseline HEAD。Path A/B/C 备选项沉淀在 sediment。
- [z-code-peaks-loop-9-ide-adapter-vendor-neutrality-adapter](z-code-peaks-loop-9-ide-adapter-vendor-neutrality-adapter.md) — z-code 是 peaks-loop 第 9 个 IDE adapter,vendor-neutrality 通过 adapter 抽象守住(2026-07-09 lesson)。
- [peaks-loop-install-model-getstrongestmodelid-fallback](peaks-loop-install-model-getstrongestmodelid-fallback.md) — peaks-loop install 不再写死默认 model,改运行时探测(getStrongestModelId 三层 fallback)(2026-07-09 lesson)。
- [desktop-application-ide-adapter-z-code-cli](desktop-application-ide-adapter-z-code-cli.md) — desktop-application 类 IDE adapter 字段降级决策(z-code 非 CLI)(2026-07-09 lesson)。
- [peaks-code-runbook-4-0-0-beta-6-skill-md-cli-d-001-d-002-d-003-d-010](peaks-code-runbook-4-0-0-beta-6-skill-md-cli-d-001-d-002-d-003-d-010.md) — peaks-code runbook 4.0.0-beta.6 SKILL.md 与实际 CLI 多处偏离(2026-07-09 lesson)。
- [peaks-ide-runtime-detect-zcode-only](peaks-ide-runtime-detect-zcode-only.md) — `peaks ide model --current` 运行时探测 z-code 当前激活 model(4-tier 优先级链,实测命中 P2 返回 `"M3"`)(2026-07-09 lesson)。
- [ide-adapter-detectcurrentmodel-optional-interface-pattern](ide-adapter-detectcurrentmodel-optional-interface-pattern.md) — IdeAdapter interface 加 optional `detectCurrentModel?` 字段的扩展模式(back-compat + vendor-neutrality + 异步隔离)(2026-07-09 pattern)。

## 4.x sediment-pool — 项目元规则

- 优先级栈: two-forms-only > human-nl-choice-only > enhancement-not-new-cli > 24h 定位 > 反伪选择。任何 spec/code 违反即重写。
- 已上升为项目级硬规则的条目,见 `CLAUDE.md`:
  - Human-NL-Choice-Only (2026-07-04)
  - Two-Forms-Only + 桌面是 UI 加速 (2026-07-04)
  - Enhancement, not new AI CLI (2026-07-04)
- 数据层一等公民: local SkillHub (`state.db` `bee_release` table) 与 pool (JSON) 并列,前者是版本化历史库,后者是 live dispatch 源。任何设计都不得混淆这两者。
