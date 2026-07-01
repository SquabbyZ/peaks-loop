---
name: peaks-current-directory-scope
description: Peaks-related changes should stay limited to the current project directory unless explicitly authorized.
metadata:
  type: feedback
---
<!-- peaks-feedback-promoted: layer=B -->
Peaks 相关的实际改动必须局限于当前项目目录内，除非用户明确授权修改全局位置。

**Why:** 用户明确要求"所有 peaks 相关的改动局限于当前目录下"，避免 postinstall、skills、配置等流程触碰 `~/.claude` 或 `~/.peaks` 这类全局状态。

**How to apply:** 对 peaks-loop 工作优先编辑当前仓库文件；涉及 `~/.claude`、`~/.peaks`、全局 settings、全局 skills 或全局 config 的操作只做 dry-run/只读检查，或先询问确认。运行可能触发 postinstall 的命令时设置跳过全局安装的环境变量或先确认。关联 [[main-branch-iteration]]。
