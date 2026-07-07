---
name: redline-no-claude-co-author
description: 禁止在 peaks-loop 仓库 commit 信息中加 Co-Authored-By: Claude 或其他 AI assistant 行 — 这是 2026-07-01 立的红线
kind: feedback
createdAt: 2026-07-01
sessionId: 2026-06-30-session-f90141
---

# Red line: never credit Claude / AI assistants in commit messages

> **Effective 2026-07-01:** No peaks-loop commit shall contain a `Co-Authored-By: Claude ...` line (or any equivalent AI assistant attribution). Code takes sole authorship of every commit.

## Why

User explicit concern (2026-07-01, after the v3.0.0 rename ship):
- 4 commits ship (3b489d8 / 4b70901 / d33ae83 / 7d1984e) all auto-trailed `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` — user policy rejects this attribution style
- All 4 will be rewritten to drop the trailer; user (SquabbyZ <601709253@qq.com>) keeps sole authorship

## How to apply

For any new commit:
- NEVER include `Co-Authored-By:` lines referring to Claude / Anthropic / any model name
- The author trailer stays empty or carries user identity only
- This applies to:
  - the user's own local commits (user controls git config — drop the helper that adds trailers)
  - sub-agent RD / QA / final-review / audit work products (their commit messages, even if code commits on top, must not carry AI attribution)
  - any automated rebase / rewrite that re-templates commit messages

If a sub-agent dispatch mistakenly outputs a `Co-Authored-By:` trailer, strip it before committing.

## Red-line enforcement

- Documented in CLAUDE.md as a hard rule (see commit `3b489d8`'s amended message — also durable in `.peaks/memory/`)
- Any sub-agent dispatch prompt that ends in "write the commit message" MUST include this trailer-strip instruction verbatim

## Related

- [[sub-agent-no-commit-rule]] — sub-agents never commit; code decides
- [[peaks-code-sub-agent-commit-incident]] — analogous 2026-06-28 RD sub-agent auto-commit incident
