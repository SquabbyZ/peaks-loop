# PRD Request 2026-06-02-sop-global-reuse-ux-v2

- session: 2026-06-02-session-prd003ux (iteration; `peaks request init` reused the legacy 746113 session dir for the request artifact)
- type: feature (ux-fix)
- source: carry-over from PRD 003 (`.peaks/2026-05-29-session-746113/prd/requests/003-2026-05-30-sop-global-reuse-and-usability.md`) + memory `custom-sop-and-gate-metering.md` "Next = dogfood custom SOP for usability gaps before resuming B"
- raw input (sanitized): PRD 003 原始目标「SOP 定义迁全局」已被 PRD 004 Slice 2 演化为「双层 project-first + global fallback + merged registry」(见 `gate-enforcement-hook` memory, commit b289cd6)。本 PRD **只**承接 003 中尚未落地的 4 个 dogfood UX 修复。Feature B 仍 deferred,见 `custom-sop-and-gate-metering` 状态记录。

## Scope split (继承自 PRD 003 现状)

| 项 | 003 原目标 | 当前状态 (2026-06-02) | 本 PRD |
|----|------------|------------------------|--------|
| G1 定义迁 `~/.peaks/sops/` | 是 | **被 004 改写**: project-first + global fallback + merged registry | **OUT** |
| G2 state 按项目隔离 | 是 | 已实现 (`<project>/.peaks/sop-state/<id>/`) | **OUT** |
| G3 gate 路径相对 `--project` | 是 | 不变,仍相对 `--project` | **OUT (preserved)** |
| G4 `grep` check 加 `absent: true` | 是 | **未实现** | **IN** |
| G5 `sop advance` phase 跳级校验 | 是 | **未实现** | **IN** |
| G6 `sop init` 成功 `nextActions` | 是 | **未实现** | **IN** |
| G7 `--project` 默认当前目录(执行类) | 是 | **未实现** | **IN** |

## Goals

- G4: `grep` check 新增 `absent: true` —— 找不到 pattern 才 pass,纯文本表达「不准有 X」,免 `--allow-commands`、跨平台、不依赖 `sh`。
- G5: `sop advance` 校验 phase 顺序 —— 只允许进入当前 phase 或其相邻下一个;跳级报 `SOP_PHASE_SKIP`(`bypass --allow-incomplete --reason` 仍可破)。
- G6: `sop init` 成功返回 `nextActions`(编辑 sop.json → lint → register 链路指引)。
- G7: `--project` 对**执行类**命令(`sop check` / `sop advance` / `sop gate enforce` / `sop registry`)默认当前目录,不再强制显式传入;**定义类**命令(`sop init` / `sop lint` / `sop register`)继续按现有「全局为默认、`--project` 写到项目层」语义保持显式。

## Non-goals

- N1: 不做 Feature B 的任何计量/分层/配额(双层 registry 只是为 B 留好"跨项目 SOP 总数"的接缝,本轮不计费)。
- N2: 不改 gate 三种 check 的安全边界(command 仍需 `--allow-commands`,execFileSync 无 shell、有 timeout、cwd 钉项目根)。
- N3: 不引入新的运行时配置写入、hooks、agents、MCP、token 存储(严守 skill/CLI 边界)。
- N4: 不改 PRD 004 Slice 2 的 project-first 解析、`scopedSopManifestPath` / `readRegistry` 合并视图;本轮视为黑盒。
- N5: 不为 G7 加交互式确认;若 `--project` 未传且当前目录不在任何 git/sop 边界内,直接报错并 hint 用法,不要 silently 落 cwd。

## Preserved behavior (QA 必须回归)

- P1: 内置 peaks-* 家族行为零变化;内置门禁永不进自定义注册表、永不计量。
- P2: command gate 的安全语义不变(无 shell、timeout、cwd 钉项目根、`--allow-commands` 门槛)。
- P3: range-3 阻断不变 —— 失败 gate 仍无条件阻断 advance,唯一逃逸是显式 bypass(`--allow-incomplete --reason`, assisted/strict 需 `--confirm` + 每 SOP bypass 上限)。
- P4: `file-exists` / `grep` 路径仍被钉在项目根内,越界返回 `blocked` 而非读取项目外。
- P5: 既有 `grep` (找到即 pass) 语义不变;`absent` 是叠加的可选字段,不改默认行为。
- P6: PRD 004 Slice 2 的双层解析(merged registry、project-first、enforceBashCommand 读合并视图)行为零变化。
- P7: `sop init --project <repo>` 仍写到项目层;不带 `--project` 仍写全局层(本轮 G7 不动 init)。

## Acceptance criteria

- AC1: manifest 中 `checks: [{type: "grep", pattern: "TODO", absent: true}]`,artifact 文件含 TODO → gate 报 `fail`;不含 TODO → 报 `pass`;lint 接受 `absent: true` 字段且 schema 校验。
- AC2: `grep` 加 `absent: true` 后,无需 `--allow-commands` 即可用纯文本模式表达「不准有 X」(跨平台、不依赖 `sh`)。
- AC3: 定义 `phases: [draft, review, publish]`,`currentPhase: null` 时,`sop advance publish` 报 `SOP_PHASE_SKIP`;`currentPhase: draft` 时,`sop advance publish` 同样报 `SOP_PHASE_SKIP`(只能进 review);`--allow-incomplete --reason <why>` 可破。
- AC4: `sop advance` 跳级报错时,响应 `data.reason` 列出允许的下一 phase(若有),`nextActions` 含"用 `--allow-incomplete --reason` 破"的提示。
- AC5: `sop init <id>` 成功时,响应 `nextActions` 含三步指引:「编辑 `~/.peaks/sops/<id>/sop.json` → `peaks sop lint <id>` → `peaks sop register <id>`」(或项目层对应路径,按 scope 切换)。
- AC6: 在 git 仓库根目录执行 `peaks sop check <id>` 不传 `--project` 等价于 `peaks sop check <id> --project .`;在非 git 目录执行时,若当前目录含 `<projectRoot>/.peaks/`(任一 sops/registry/state 标记),视为该 project;否则报错 `MISSING_PROJECT_ROOT` + 提示显式传 `--project`。
- AC7: `sop check/advance/gate enforce/registry` 至少一个命令的 `--project` 默认值与显式传 `.` 行为完全等价(测试覆盖);`sop init/lint/register` 三个定义类命令**不**得被本轮 G7 影响,继续按 004 语义。
- AC8: 全部既有 SOP 测试更新通过;覆盖率红线达标;新增 AC1/AC3/AC4/AC5/AC6 测试为真实断言(无 padding)。
- AC9: `peaks sop --help` 与相关命令 `--help` 在 `--project` 已默认 cwd 的命令上明确显示「[default: <cwd>]」;定义类命令不显示。

## Unresolved questions (留给 RD)

- OQ1: G5 跳级规则的「相邻」是「按 phases 数组下标 ±1」还是「manifest 显式声明 `next[]`」?003 PRD 没指定;倾向前者(下标邻接),但 manifest 可在 OQ1 实现里加可选 `transitions: {draft: [review, publish]}` 字段覆盖默认(本期不实现,留 TODO)。
- OQ2: G6 的 `nextActions` 中第三步 `register` 是否在 lint 失败时仍列出(作为后续修复路径)?倾向是 —— 它是修好 lint 之后的下一步,不是当下必做。
- OQ3: G7 的「当前目录能解析为 projectRoot」判定,应否复用 PRD 004 Slice 2 里既有的「`<cwd>/.peaks/sops/` 或 `sop-state/` 或 `memory/` 存在则视为该项目」启发式?(参考 `sop-paths.ts` / `projectDashboard` 的 project 探测。)倾向:是,直接复用同一探测函数,避免两边判据漂移。

## Risks

- R1: G4 的 `absent` 语义与「`grep` 找到即 fail」的常见直觉相反;SKILL.md 与 `--help` 必须显式标注(AC9 同源),否则用户误用会导致 SOP 默写通过。
- R2: G5 跳级规则若按数组下标,用户在 phases 数组中间插入新 phase 会让旧 state 的「相邻」判定偏移;需要 state 持久化时存 `phaseIndex` 或 `phaseName`,不存「我以为的 next」。本轮 OQ1 实现里要明确。
- R3: G7 的「cwd 默认为 projectRoot」如果用户在 monorepo 子目录跑 `sop advance`,会拿到 monorepo 根而非子目录的 sop-state —— 这正是「执行按项目隔离」要的行为,但需要 SKILL.md 明示,避免用户期待子目录级隔离。

## Handoff

- to peaks-rd: `.peaks/2026-06-02-session-prd003ux/rd/requests/2026-06-02-sop-global-reuse-ux-v2.md`
- to peaks-qa: `.peaks/2026-06-02-session-prd003ux/qa/requests/2026-06-02-sop-global-reuse-ux-v2.md`
- to peaks-ui: N/A(纯 CLI,无 UI 改动)

## Status

- created: 2026-06-01T16:11:43.613Z
- last update: 2026-06-02T00:18:00.000Z
- state: confirmed-by-user (2026-06-02 00:24)

## User confirmation record

- 2026-06-02 00:18 verbal (this turn): "下一轮迭代吧" + 选择 PRD 003 + 走完整 peaks-prd→rd→qa 流程
- 2026-06-02 00:19 verbal (this turn): 确认 003 v2 收窄为 4 UX 修复,G1/G2 标 OUT(被 004 覆盖)
- (auto-confirm 待用户在 `peaks request show` 流程中 sign-off,或下一轮 peaks-rd 启动时视为 implicit confirm)
