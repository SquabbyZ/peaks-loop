---
name: finalize-request-id-broken-4-0-43
description: peaks sub-agent finalize --request-id 在 4.0.43 恒失败（share-commands.ts 的 .json 过滤过宽）
metadata:
  type: module
  sourceArtifact: .peaks/_runtime/2026-09-12-session-e37ef0/txt/handoff.md
---

`src/cli/commands/share-commands.ts` 的 `peaks sub-agent finalize --request-id <rid>` 分支（约第 413 行）用 `if (!f.endsWith('.json')) continue;` 遍历 `.peaks/_sub_agents/<sessionId>/`，于是会先读到同目录下的 `active-dispatches.json` 和 `batch-*.counter.json`（这两个文件**没有** `version` 字段）→ `readRecord` 抛 `FINALIZE_ERROR: Dispatch record version mismatch ... got undefined`。同文件的 `--batch` 分支（约第 432 行）用的是 `if (!f.startsWith('dispatch-') || !f.endsWith('.json')) continue;` —— **那才是对的过滤器**。D21 当初就是为"13 条陈旧记录"加的这道清理，这个 bug 让它重新失效。

**Why:** 同一个目录里混着"派发记录"和"派发计数器 / 活跃索引"两类 JSON，只按扩展名过滤等于把索引文件当成记录读。而 `readRecord` 的版本校验会把"这不是一条记录"报成"记录版本不匹配"，错误信息把人指向错误的方向。

**How to apply:** 现在绕过用 `--batch <batchId>` 或 `--all-stale`（两者过滤器正确）。修法是一行：把 `--request-id` 分支的过滤器对齐成 `f.startsWith('dispatch-') && f.endsWith('.json')`，并补一条测试断言"目录里存在 `active-dispatches.json` 时 `--request-id` 仍能解析成功"。
