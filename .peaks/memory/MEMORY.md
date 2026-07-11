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
- [slice-014-vitest-slowdown-and-race-repeat](slice-014-vitest-slowdown-and-race-repeat.md) — Slice 014: vitest fork slowdown × RACE_REPEAT=20 blew 60s/120s timeouts; 修复 = Promise 传播 + RACE_REPEAT 20→3 + describe 60s→180s + withFileLockSync wall-clock guard; 剩余 g8-shared-channel / legacy-detector / file-size-scan 是同样 race-mode 套路,留 slice 015 处理。
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
