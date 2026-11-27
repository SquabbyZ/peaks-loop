---
name: peaks-的-windows-cmd-代理吃不下多行-prompt
description: peaks 的 Windows .cmd 代理吃不下多行 prompt
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-11-27-session-791264/txt/handoff.md
---

`peaks sub-agent dispatch ... --prompt "$(cat <<'EOF' ... EOF)"` 在 Windows 上会报 `proxy failed to run peaks: InvalidBatchScriptArg`，因为 `peaks` 是 .cmd 代理，多行/超长参数被 cmd.exe 拆坏。改走仓库内源码入口即可：`node node_modules/tsx/dist/cli.mjs src/cli/index.ts <命令>`。另外该命令的输出是 JSON + 一行 `next:` 尾巴，`JSON.parse` 前要先按 `\nnext:` 截断。
