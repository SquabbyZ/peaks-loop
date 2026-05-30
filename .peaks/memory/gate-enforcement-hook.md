---
name: gate-enforcement-hook
description: SOP gates are made un-bypassable via a PreToolUse hook (guards + peaks gate enforce); Slice 1 done, Slice 2 = repo-committed SOPs for team enforcement.
metadata:
  type: project
---
决策 2026-05-30(已实现,commit b289cd6):把 SOP 门禁从「约定」变「强制」。这是产品护城河——CI 只拦合并、CLAUDE.md 靠自觉,只有这里能在**对话流程中途、面向 agent 本身**拦住不可逆动作。

**机制**:manifest 声明 `guards: [{phase, bash}]`(bash=JS 正则,绑定不可逆 Bash 命令到 phase)。`peaks hooks install` 把一条 PreToolUse(matcher `Bash`)写进 `.claude/settings.json`,command 为 `peaks gate enforce --project "${CLAUDE_PROJECT_DIR}"`。enforce 读 stdin 的 `tool_input.command`,命中 guard 且该 phase 门禁失败 → 输出 `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":...}}`。

**已核实关键事实**:PreToolUse 的 `permissionDecision:"deny"` 在权限模式检查**之前**触发,**连 `--dangerously-skip-permissions` 都拦得住**。这是 CI 做不到的。来源:code.claude.com/docs/en/hooks(见 [[custom-sop-and-gate-metering]] 关联)。

**信任红线(务必保持)**:enforce **fail-open** —— registry 读失败 / manifest 坏 / 正则非法都放行 + warn,只有**真实门禁失败**才 deny。Peaks 自身 bug 绝不能 brick 用户的 Claude Code。

**放行**:`peaks gate bypass --sop --phase --reason` 写一次性令牌(存 `<project>/.peaks/sop-state/<id>/.gate-bypass.json`),下次命中即消费;复用 bypass 计数上限(每项目每 SOP 3 次)。

**安装是显式 opt-in**:绝不 postinstall 自动写 settings.json;skill 自己永不写 settings——符合「skill 描述、CLI 执行副作用」红线。复用 `statusline-settings-service` 的安全读改写(symlink/越界 guard、O_NOFOLLOW、atomic rename)。

**坑**:guard 的 `bash` 是 JSON 里的正则,`\s` 是非法 JSON 转义——必须 `"git\\s+push"` 或用 `"git +push"`。lint 会拒非法正则。

**团队强制(Slice 2,已实现 2026-05-30)**:SOP 定义分**两层**——全局 `~/.peaks/sops/`(个人)与**项目** `<repo>/.peaks/sops/`(随仓库提交、团队共享),同 id **项目层优先**。`init`/`lint`/`register` 默认全局,加 `--project <repo>` 写项目层。`readSopManifest(id, projectRoot?)` 做 project-first 解析;`readRegistry(projectRoot?)` 返回 project∪global 合并视图(project 覆盖同 id);`registerSop` 写调用方指定层(`scope` 字段)。`enforceBashCommand(projectRoot)` 读合并视图 → **队友只 clone 仓库(全局空)也被强制**(已 e2e 验证)。新路径 helper 在 [[sop-paths]]:`projectSopDir`/`projectRegistryPath`/`scopedSopManifestPath`/`scopedRegistryPath`/`resolveSopManifestPath`。运行态/bypass 令牌仍按项目、git-ignored。关联 [[custom-sop-domain-agnostic-positioning]]。
