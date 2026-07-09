---
name: peaks-code-runbook-4-0-0-beta-6-skill-md-cli-d-001-d-002-d-003-d-010
description: peaks-code runbook 4.0.0-beta.6 SKILL.md 与实际 CLI 多处偏离(D-001/D-002/D-003/D-010)
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-07-08-session-17918f/txt/handoff-003-add-zcode-adapter.md
---

session 2026-07-08-session-17918f 跑 peaks-code 启动时实测发现 4 处 SKILL.md 描述跟实际 CLI 不一致:
- D-001:SKILL.md 描述 `peaks code detect-job --is-job/--suggested-job-id`,实际是 `peaks job init --job-id/--slice-list/--main-loop-strategy`。
- D-002:SKILL.md 描述 `peaks session title --session-id <sid>` flag,实际 sid 是 positional arg。
- D-003:SKILL.md 描述的 `JOB_SHAPE_NOT_DECIDED` 红线异常在实测 CLI 上没看到对应 throw。
- D-010:CLI 期望 RD/QA artifact 命名(`requests/<n>-<rid>.md` + 多种 section header)与 PRD/RD 实际惯例(`<role>/<rid>/<rid>-report.md`)不一致,full-auto 模式需要 `--allow-incomplete` bypass。
Why:SKILL.md 是 peaks-loop 4.0.0-beta.6 时期,CLI 在中间版本可能已经改了但 SKILL.md 没同步。
How to apply:跑 peaks-code 启动时,如果 SKILL.md 描述的命令/flag 报错,先 `peaks <cmd> --help` 看实际 CLI;feedback 给 SKILL.md 维护者做文档同步。
