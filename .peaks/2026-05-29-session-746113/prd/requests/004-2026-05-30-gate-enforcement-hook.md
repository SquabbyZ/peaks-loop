# PRD Request 2026-05-30-gate-enforcement-hook

- session: 2026-05-29-session-746113
- type: feature (护城河闭环 / Slice 1)
- source: verbal — 竞品视角走查后用户指令「把『能用』变成『别人非用不可』」,确认 ① 只守 Bash、② 一次性 bypass 令牌
- raw input (sanitized): 当前 SOP 门禁只拦 `peaks sop advance` 命令本身,agent 可绕过(直接改文件/push/宣布完成)。把门禁接进 Claude Code PreToolUse hook,使其在被守卫的 Bash 动作发生前强制评估门禁,不过就 deny,做到对话内不可绕过。

## 背景:为什么这是护城河

CI 只能拦合并,CLAUDE.md 靠 agent 自觉。Peaks 的差异点是「对话流程中途、面向 agent 的硬门禁」——但当前门禁是约定而非强制。PreToolUse 的 `permissionDecision:"deny"` 在权限模式检查之前触发,即使 `--dangerously-skip-permissions` 也拦得住。这一步把约定变成不可绕过的强制。

## Scope

- **本 PRD = Slice 1**:单人作者获得真实强制(SOP 定义在全局 `~/.peaks`,hook 在项目 `.claude/settings.json`)。
- **Slice 2(后续)**:仓库提交式 SOP 定义,让队友 clone 即被强制。本切片为其留接缝(enforce 已按「给定 projectRoot 解析」设计)。

## Goals

- G1:SOP manifest 可声明 `guards`(把一个 Bash 命令正则绑定到一个 phase),语义=执行该命令即进入该 phase 的不可逆动作,必须先满足该 phase 门禁。
- G2:`peaks gate enforce` 作为 PreToolUse hook handler,读 stdin 的 `tool_input.command`,命中 guard 且门禁失败时输出已核实的 `permissionDecision:"deny"` JSON,否则放行。
- G3:`peaks hooks install/uninstall/status` 显式管理 `.claude/settings.json` 的 PreToolUse(matcher `Bash`)条目,默认项目级,安全读改写(复用 statusline 基建)。
- G4:`peaks gate bypass` 写一次性令牌,下次 enforce 命中即消费放行,复用 bypass 计数上限 + 审计原因。
- G5:enforce 对内部错误 fail-open(只对真实门禁失败 deny),Peaks 自身 bug 绝不 brick Claude Code。
- G6:lint 校验 guards(phase 合法、正则可编译);schema 同步;文档含第一屏杀手 demo。

## Non-goals

- N1:不做 Slice 2 的项目级 SOP 定义 / 团队同步。
- N2:不在 postinstall 自动写 settings.json / 装 hook —— 必须显式用户命令。
- N3:v1 不守 Write/Edit 等非 Bash 工具(留 v2)。
- N4:不改三种 check 类型、不改既有 sop advance/check/lint 的非 guard 行为。

## Preserved behavior(QA 必须回归)

- P1:不声明 guards 的 SOP 行为完全不变;未装 hook 的用户零变化。
- P2:既有 sop init/lint/register/check/advance 语义不变(guards 是叠加的可选字段)。
- P3:command-type 门禁安全边界不变(execFileSync 无 shell、30s 超时、cwd 钉项目根)。enforce 中以 allowCommands:true 运行属用户装 hook 的显式同意。
- P4:settings.json 写入复用 statusline 的 symlink/越界 guard + atomic 写,绝不破坏 settings 内其它键或其它 hook。

## Acceptance criteria

- AC1:manifest 加 `guards:[{phase,bash}]`;lint 校验 phase 存在(`GUARD_PHASE_UNKNOWN`)、bash 可编译(`GUARD_INVALID_PATTERN`)、bash 非空;schema 更新。
- AC2:`enforceBashCommand(projectRoot, command)`:guard 命中 + 门禁失败 → deny(reason 点名 phase + 失败 gateId);命中 + 全过 → allow;无命中 → allow。
- AC3:正则非法 / manifest 坏 / registry 读失败 → fail-open allow + stderr 告警。
- AC4:`gate enforce` 读 stdin,非 Bash/空命令 → 放行;deny 时 stdout 输出 `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}` 且 exit 0;allow 时无输出 exit 0。
- AC5:`hooks install` 把 PreToolUse(matcher Bash,command `peaks gate enforce --project "${CLAUDE_PROJECT_DIR}"`)并入 settings.hooks.PreToolUse[];幂等;冲突需 `--force`;`--dry-run` 预览;symlink/越界拒绝。`uninstall` 仅移除自有条目;`status` 报告。
- AC6:`gate bypass --sop --phase --reason` 写一次性令牌;下次 enforce 命中消费并 allow,再次命中又 deny;超 `MAX_BYPASSES_PER_SESSION` 报 `BYPASS_LIMIT_REACHED`。
- AC7:端到端 demo(TODO 在正文 → git push 被 deny → bypass 一次放行 → 清 TODO 放行)真实 CLI 跑通。
- AC8:tsc 干净;全量测试绿(除既有 2 个 Windows EPERM);新文件 functions/statements 100%,残留仅防御性分支。
