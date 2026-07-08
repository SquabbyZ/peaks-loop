---
name: user-decision-2026-07-05-eradicate-peaks-code
description: 2026-07-05 user 决定"彻底去根"——打破 rename spec AC-10 不动 .peaks/memory/ 的硬规则,107 文件全部 peaks-code → peaks-code
metadata:
  type: feedback
  createdAt: 2026-07-05
  source: post-rename user manual sweep
---
<!-- peaks-feedback-promoted: layer=A -->

# User decision: "彻底去根" — 全仓库 peaks-code → peaks-code

> **Why:** 2026-07-05 user 在 peaks-code → peaks-code rename 出版后,做了一个**全局手动替换**,把 107 个文件中的 `peaks-code` 全部替换为 `peaks-code`——包括 48 个 `.peaks/memory/` 历史快照 + 13 个 `openspec/` + 3 个 `.superpowers/` + project 规则文件(CLAUDE.md 等)。

## user 原话(2026-07-05)

> "我的想法是彻底去根,不然会影响后面的迭代,干扰后续的迭代开发"

## 决策影响

- **打破 rename spec AC-10**:spec §2.1 / §3.5 / §8 AC-10 明示 `.peaks/memory/` + `.git/sdd/` **零修改**——理由是"memory 是历史沉淀,旧名字是合理的'历史快照'"
- **打破 spec AC-3 / AC-6**:marketplace.json 引用、CLI 表面数字、vitest 期望数组的稳定性都基于"memory 里出现 peaks-code 是历史"
- **新规则**:从 2026-07-05 起,`.peaks/memory/` **可以含 peaks-code**,因为 user 主动把它们重写为"当前快照"而非"历史快照"

## 实际改动统计

| 目录 | 文件数 | 是否在 spec in-scope |
|---|---|---|
| `.peaks/memory/` | 48 | ❌(out-of-scope by AC-10) |
| `openspec/` | 13 | ❌(out-of-scope by §2.1) |
| `.superpowers/` | 3 | ❌(未在 spec 范围) |
| `skills/`(role + audit) | 26 | 部分 in-scope(bee demote 时动过) |
| `docs/` | 6 | 部分 in-scope |
| 其他(CLAUDE.md / CHANGELOG.md / tests / templates / vitest.config.ts) | 11 | 部分 in-scope |

## How to apply

- 未来 session 看到 `.peaks/memory/` 里有 `peaks-code` 字面,**不要**回滚成 peaks-code。这是 user 的"彻底去根"决策——memory 是当前快照而非历史。
- 类似决策(如再发生大批量 rename 后 user 全局手动搜索)前,**先**问 user:是要"严格按 spec 不动 history"还是"彻底去根"。本条说明默认是后者。
- spec AC-10 在 user 此次手动操作后**实质失效**——下次 spec 重写时需更新 AC 表述或删除 AC-10。

## Related designs / memory

- `docs/superpowers/specs/2026-07-05-peaks-code-to-peaks-code-rename-design.md` §2.1 / §3.5 / §8 AC-10(被 user 决策实质覆盖)
- [[peaks-code-to-peaks-code-rename-session-directive]]
- [[peaks-loop-24h-ai-programmer-positioning]]
