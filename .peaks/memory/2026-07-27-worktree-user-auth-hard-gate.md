---
name: worktree-user-auth-hard-gate
description: 2026-07-27 peaks-loop 项目级红线 — worktree / EnterWorktree / git stash 必须 current-task 显式用户授权；prompt / IDE 工作流禁止自主创建 worktree
metadata:
  type: project
  sourceArtifact: peaks-audit 2026-07-27 + 用户直接指令
  createdAt: 2026-07-27
  originSessionId: 2026-07-27-session-b4e485
  severity: block
  enforcement: PreToolUse hook fail-closed (peaks gate enforce)
---

# worktree 显式用户授权硬门禁(2026-07-27)

## 事件

一次 audit-closeout 治理收尾任务中,peaks-code 编排器自行给
`Agent(isolation: "worktree")` 派了 worktree 隔离的子代理,并因
baseline 不干净而执行了 `git stash` 创建工作区。整条路径是
orchestrator 自主判断 → 无人参与授权,user 完全没有提出 "用
worktree" 的要求。这是 LLM 编排器对用户工作区的不可逆潜在破坏。

User 明确要求:**除非用户在当前任务中主动、显式提出使用
worktree,否则任何 LLM 编排器、子代理、IDE 工作流都不得创建或进
入 worktree**。这条规则必须升级为**机械硬门禁**(机械 hook + 强
制 deny),不允许仅靠 prompt 自觉。

## 边界

覆盖范围:

- `Agent` / `Task` 工具调用,`isolation: "worktree"` 或等价参数
- `EnterWorktree` 工具调用(Claude Code 独立工具,语义同 worktree 隔离子代理)
- Bash `git worktree add|remove|prune|lock|unlock|move|repair ...`
- Bash `git stash push|pop|save|create|drop|store|clear|apply ...`
  (读写型 `git stash list|show` 不在拦截范围)

不覆盖:

- `git status` / `git worktree list` / `git stash list` 等只读操作
- 用户直接敲的命令(hook 只拦截 LLM 派发,人类命令默认 allow)
- 其它 worktree 不相关的代码变更(常规 SOP gate 仍生效)

## 机械实现

新增的 service 模块是**单一决策边界**,所有派发路径都收口到这里:

- `src/services/hooks/worktree-authorization-gate.ts` — 纯函数
  - `evaluateWorktreeAuth(input) → WorktreeAuthDecision`
  - `classifyToolCall(input) → OperationType | null`
  - 默认 **fail-closed**:`WORKTREE_USER_AUTH_REQUIRED` / `_EXPIRED` /
    `_REQUEST_MISMATCH` / `_CONSUMED` / `_FILE_INVALID`
  - 授权文件:`.peaks/_runtime/<sessionId>/worktree-auth.json`
- `src/cli/commands/worktree-auth-commands.ts` —
  `peaks worktree auth grant|revoke|status`
  - grant 记录:operation, reason, ttl(default 5 min), multi/single,
    requestId scope, promptHash
  - 撤销:清空所有 unconsumed grant
  - 状态:列出当前 grant + 是否过期
- `src/cli/commands/gate-commands.ts` 内的 `peaks gate enforce`
  在 SOP gate 之前先调用 worktree gate(deny 时直接 emitBlock 退
  出 2),不与 SOP gate 复合。
- 注入位置:`peaks hooks install` 写入的 `peaks gate enforce` 钩
  子(已在 `claude-code` `trae` `codex` 等适配器上注册),所以一次
  install 同时启用 worktree gate + 既有 SOP gate。

## 默认 fail-closed 的原因

单凭 prompt 引导**会被遗忘**,这就是事故的根因。机械 hook 不
依赖 LLM 是否记得规则;它读 `.peaks/_runtime/<sid>/worktree-
auth.json`,文件不存在 / 已过期 / 已被消费 / 与当前 requestId 不
匹配,都直接 deny。这样即使 LLM 错误地再次尝试,Claude Code 也
会收到 `permissionDecision: "deny"`,无法继续。

## 用户自然语言规则(保持不变)

用户仍然通过自然语言描述需求,LLM 必须:

1. 听到用户**明确**说"用 worktree"或"worktree 隔离"等
2. 收到后调用 `peaks worktree auth grant --operation <op>
   --reason "<why>" --request-id <rid>` 写授权
3. 然后再派 `Agent(isolation: "worktree")` / `git worktree ...`

`AskUserQuestion` 选"是/否"也视为显式授权(用户主动选择)。

## 反例(禁止)

- LLM 自行决定"为了保持 baseline 干净"而 `git stash`
- LLM 因"性能 / 隔离"理由派 `Agent(isolation: "worktree")`
  而不写授权
- LLM 修改 `.peaks/memory/` 红线以"让 worktree 默认可用"
- 用户**只**说"把 X 做了" / "修一下" 而没说"用 worktree",LLM
  就触发 worktree 路径

## 关联红线

- `peaks-code` 任务规约:Task 0 锚定 → 编排器必须读 `.peaks/
  memory/2026-07-27-worktree-user-auth-hard-gate.md`(本文件)
- `peaks-rd` 实现规约:任何 worktree/stash 业务逻辑必须经过
  `evaluateWorktreeAuth`,禁止独立 git worktree 调用
- `peaks-qa` 验收规约:测试必须覆盖以下负面用例
  - 无 grant 时 `git worktree add` → deny
  - 无 grant 时 `Agent(isolation=worktree)` → deny
  - grant 已过期 → deny `_EXPIRED`
  - grant 已消费 + single-use → deny
  - malformed grant file → deny `_FILE_INVALID`(fail-closed)
  - 正面用例:grant 写入 → 一次性 allow → 第二次 deny
- 父 SKILL:Human-NL-Choice-Only + Two-Forms-Only 仍然 binding:
  授权必须由 user 的自然语言触发,LLM 不可代填

## 事故复盘

| 错误 | 修正 |
|---|---|
| 用 `Agent(isolation="worktree")` 而无人授权 | worktree 硬门禁 + `peaks worktree auth grant` 强制当前任务授权 |
| `git stash` 制造"干净"基线 | `git-stash-mutating` 进 worktree gate 同样需授权 |
| 子代理派发走 worktree-isolation 路径 | 派发层就无 worktree 隔离(由 gate 决定) |
| 编排器认为 baseline 脏就该 stash | baseline 由 `git diff`/stash 由 user 显式操作,LLM 不应"修整" |

## 验证

- `pnpm exec vitest run tests/unit/hooks/
  worktree-authorization-gate.test.ts` 38/38 通过
- `pnpm exec tsc -p tsconfig.json --noEmit` 通过
- `peaks audit red-lines` partial=0 / proseOnly=0
- `pnpm run build` 通过
