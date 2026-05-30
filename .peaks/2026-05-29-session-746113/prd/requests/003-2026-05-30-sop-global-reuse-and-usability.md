# PRD Request 2026-05-30-sop-global-reuse-and-usability

- session: 2026-05-29-session-746113
- type: feature + ux-fix (Feature A 的复用化重构 + dogfood 暴露的易用性修复)
- source: verbal — dogfood「公众号发文:草稿→校对→发布,发布前不准有 TODO」后的真实反馈 + "sop 应该放全局 ~/.peaks 多项目复用"
- raw input (sanitized): 用户以真实身份跑通了 peaks-sop 全链路,确认机制正确,但提出 SOP 定义应放在全局 `~/.peaks` 以便多项目复用,并要求修复 dogfood 暴露的 4 个易用性问题。

## 背景:dogfood 结论

`peaks-sop` 技能的 interview→scaffold→lint→双态 gate 测试→dry-run advance→register→registry 全链路跑通,range-3 阻断成立。但暴露出复用模型与易用性缺口。

## Scope split:定义全局 + 执行按项目

核心方向决策(用户认可):**SOP 定义全局复用,运行执行按项目隔离**。

| 数据 | 现状 | 改后 | 解析依据 |
|------|------|------|---------|
| 定义 `sop.json` + `SKILL.md` | `<project>/.peaks/sops/<id>/` | `~/.peaks/sops/<id>/` | homedir(全局复用) |
| 运行态 `state.json` | SOP 目录内 | `<project>/.peaks/sop-state/<id>.json` | `--project`(项目隔离) |
| 注册表 `registry.json` | `<project>/.peaks/sops/` | `~/.peaks/sops/registry.json` | homedir(全局,喂 B 计量) |
| gate 检查目标路径 | 相对 `--project` | 不变,仍相对 `--project` | `--project` |

`~/.peaks` 已是既有全局配置位([config-safety.ts](src/services/config/config-safety.ts) 在用),方向契合现有架构。

## Goals

- G1:SOP 定义(`sop.json` + `SKILL.md`)与注册表迁到全局 `~/.peaks/sops/`;一次编写,任意项目复用。
- G2:运行态 `state.json` 拆到 `<project>/.peaks/sop-state/<id>.json`;同一全局 SOP 在不同项目各自独立进度,互不覆盖。
- G3:gate 检查目标路径仍相对 `--project` 解析,这是复用的语义基础(`posts/current.md` 在每个项目各自存在)。
- G4:`grep` check 新增 `absent: true` —— 找不到 pattern 才 pass,纯文本表达「不准有 X」,免 `--allow-commands`、跨平台、不依赖 `sh`。
- G5:`sop advance` 校验 phase 顺序 —— 只允许进入当前 phase 或其相邻下一个;跳级报 `SOP_PHASE_SKIP`(bypass 仍可破)。
- G6:`sop init` 成功返回 `nextActions`(编辑 sop.json → lint)。
- G7:`--project` 默认当前目录,执行类命令(check/advance)不再强制显式传入。

## Non-goals

- N1:不做 Feature B 的任何计量/分层/配额(registry 全局化只是为 B 留好"跨项目 SOP 总数"的接缝,本轮不计费)。
- N2:不改 gate 三种 check 的安全边界(command 仍需 `--allow-commands`,execFileSync 无 shell、有 timeout、cwd 钉项目根)。
- N3:不引入新的运行时配置写入、hooks、agents、MCP、token 存储(严守 skill/CLI 边界)。
- N4:不做 SOP 远程分享/市场/同步(属 B 之后的 open-core 能力)。

## Preserved behavior(QA 必须回归)

- P1:内置 peaks-* 家族行为零变化;内置门禁永不进自定义注册表、永不计量。
- P2:command gate 的安全语义不变(无 shell、timeout、cwd 钉项目根、`--allow-commands` 门槛)。
- P3:range-3 阻断不变 —— 失败 gate 仍无条件阻断 advance,唯一逃逸是显式 bypass(`--allow-incomplete --reason`,assisted/strict 需 `--confirm` + 每 SOP bypass 上限)。
- P4:`file-exists`/`grep` 路径仍被钉在项目根内,越界返回 `blocked` 而非读取项目外。
- P5:既有 `grep`(找到即 pass)语义不变;`absent` 是叠加的可选字段,不改默认行为。

## Open questions(留给 RD)

- OQ1:全局 `~/.peaks/sops/` 的路径解析是否需要可被环境变量(如 `PEAKS_HOME`)覆盖以便测试隔离?(倾向是 —— 现有测试用临时目录,全局化后需要可注入根。)
- OQ2:`state.json` 迁移后,旧的 `<project>/.peaks/sops/<id>/state.json` 是否需要兼容读取?(倾向否 —— 功能刚发布无存量用户,直接改路径不留兼容垫片,符合 coding-style「不留 backwards-compat shim」。)
- OQ3:phase 顺序校验对 `currentPhase: null`(从未 advance)如何处理?(倾向:允许进入第一个 phase 或任意已声明 phase 的"第一步",具体由 RD 定相邻规则。)

## Acceptance criteria

- AC1:`sop init/lint/register` 默认读写 `~/.peaks/sops/`;不再要求 `--project`。
- AC2:`sop advance` 的 state 写入 `<project>/.peaks/sop-state/<id>.json`;两个不同 `--project` 跑同一 SOP,进度互不影响(测试覆盖)。
- AC3:`grep` check 加 `absent:true` 时,pattern 命中→`fail`,未命中→`pass`;lint 接受该字段;schema 更新。
- AC4:含 TODO 的草稿,用 `grep absent` gate(无 `--allow-commands`)即可阻断 advance 到 publish。
- AC5:定义 `draft→review→publish`,从 `null`/`draft` 直接 advance 到 `publish` 报 `SOP_PHASE_SKIP`;`--allow-incomplete` 可破。
- AC6:`sop init` 成功的 `nextActions` 含"编辑 sop.json 与 lint"指引。
- AC7:check/advance 不传 `--project` 时默认当前目录。
- AC8:全部既有 SOP 测试更新通过;覆盖率红线达标;新分支配真实测试(非 padding)。
- AC9:reference 文档的「不准有 X」改用 `grep absent`,删除 `sh -c` 绕法;路径说明更新为"定义全局 + 执行按项目"。
