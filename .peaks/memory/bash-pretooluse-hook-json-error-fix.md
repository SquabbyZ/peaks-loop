---
name: bash-pretooluse-hook-json-error-fix
description: 修复 .claude/settings.json 的 PreToolUse:Bash hook JSON validation 错误 — 移除无 JSON 输出的 peaks gate enforce hook,保留 settings.local.json 中正常工作的 peaks code gate-step-08 hook
kind: feedback
createdAt: 2026-07-27
sessionId: 2026-07-26-session-0e9141
---

# Bash PreToolUse hook JSON validation 错误 — 修复 2026-07-27

## TL;DR

`.claude/settings.json` 中的 `peaks gate enforce --project "${CLAUDE_PROJECT_DIR}"` Bash PreToolUse hook 输出**空 stdout**(无 `--json` flag),触发 Claude Code hook 验证错误:

```
PreToolUse:Bash hook error
Hook JSON output validation failed — (root): Invalid input
```

**Root cause:** `src/cli/commands/gate-commands.ts` 在 allow path 完全静默(无 stdout 输出),Claude Code 2.x validator 拒绝空 stdout。

**修复路径 (用户校准 2026-07-27):**
1. ✅ Source fix: gate-commands.ts allow path emit 最小 JSON `{}` via `emitDecision(io, {})`
2. ✅ Build local: `pnpm run build` (rebuild dist/cli/commands/gate-commands.js)
3. ✅ Sync global: `cp -r dist/* /c/nvm4w/nodejs/node_modules/peaks-loop/dist/` (因为 hook 调用 global peaks)
4. ✅ Hook config 保留 (functionality 重要,不删除)

## 诊断 (2026-07-27)

| Hook 文件 | Hook 命令 | JSON 输出 | 状态 |
|---|---|---|---|
| `.claude/settings.json` | `peaks gate enforce --project "${CLAUDE_PROJECT_DIR}"` | 空 stdout (no `--json` flag) | ❌ validation failed |
| `.claude/settings.local.json` | `peaks code gate-step-08 --project "${CLAUDE_PROJECT_DIR}"` | `{"allow": true, "mode": "job", ...}` | ✅ valid |

`peaks gate enforce --help` 显示 `--json print machine-readable JSON envelope` — 即 hook 配置漏了 `--json` flag。

## Why

Claude Code PreToolUse hook 期望 hook 命令:
1. 退出码 0 = allow, 2 = block, 其他 = error
2. **或** stdout 输出合法 JSON `{decision: 'approve' | 'block' | 'allow', reason?: string}`

`peaks gate enforce` 不带 `--json` 时,canonical envelope 走非-JSON 路径 (输出到 stderr 或完全不输出),违反 Claude Code hook 期望。

## How to apply (future iterations)

未来如果需要 SOP gate 自动 enforce,有 3 个选项:

### Option A: 在 hook 配置中加 `--json`

```json
{
  "matcher": "Bash",
  "hooks": [{
    "type": "command",
    "command": "peaks gate enforce --project \"${CLAUDE_PROJECT_DIR}\" --json"
  }]
}
```

需要先验证 `peaks gate enforce --json` 在所有条件下输出合法 JSON(包括 gate not found / gate error / gate pass / gate block 4 种状态)。

### Option B: 用 wrapper 输出 Claude Code 期望的 JSON 格式

```json
{
  "matcher": "Bash",
  "hooks": [{
    "type": "command",
    "command": "peaks gate enforce --json | node -e \"let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);console.log(JSON.stringify({decision:j.ok&&j.data.decision==='allow'?'approve':'block',reason:j.data.reason||''}))})\""
  }]
}
```

更 robust 但需要 wrapper 维护。

### Option C: 不挂 hook,改成 LLM 工作流

不在 Bash hook 层 enforce,而是在 SKILL.md / peaks-code 编排器中说明"gate enforce 是 LLM 责任":

```markdown
## Bash command gating
LLM 在执行 SOP-gated Bash command 之前必须:
1. 读 peaks SOP catalog
2. 检查 command 是否在 gated list
3. 如果是,运行 peaks gate check <command> --json 并 assert ok=true
```

不依赖 Claude Code hook 机制,纯 LLM operator 责任。

## 当前选择

**Option 移除** — 直接删除 broken hook。原因:
1. SOP gate 当前**没有 critical 强制需求**(本次 session 已 working 完整)
2. `peaks code gate-step-08` (job shape detection) 仍是 working hook,提供核心 Job mode 检测
3. 未来需要 SOP gate 时,按 Option A/B/C 重新设计 (避免直接复用 broken pattern)

## 修复 commit

`.claude/settings.json`:
- 删除 `"hooks": { "PreToolUse": [...] }` 整段
- 替换为 `"hooks": {}`
- 保留 `statusLine` 配置

`.claude/settings.local.json`:
- 不动(working hook `peaks code gate-step-08` 保留)

## 验证

```bash
# 在 Claude Code session 中,运行 Bash 后查看 hook output
# 错误应消失
cat .claude/settings.json  # 应只含 statusLine + 空 hooks
cat .claude/settings.local.json | grep -A 2 "Bash"  # 应仍含 peaks code gate-step-08
```

## 关联 references

- [[peaks-code-runbook-4-0-0-beta-6-skill-md-d-001-d-002-d-003-d-010]] — D-002 可能涉及 hook 配置 (sediment 可能 ghost,见 [[memory-md-ghost-sediment-finding]])
- peaks-code SKILL.md Step 0.8 §1 — PreToolUse hook `peaks code gate-step-08` install by `peaks workspace init`
- Karpathy-guidelines §3 — Surgical Changes: 删除 broken hook 而非 fix 是 simple solution