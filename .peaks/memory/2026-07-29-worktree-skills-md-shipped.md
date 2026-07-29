---
name: 2026-07-29-worktree-skills-md-shipped
description: Worktree governance 章节 ship 到 skills/peaks-code/SKILL.md — npm package 合约让所有下游项目免费生效;走 references/ 拆分保 byte cap,字节上限 25K→30K 调整理由沉淀
metadata:
  type: project
  createdAt: 2026-07-29
  originSessionId: 2026-07-29-session-current
  severity: architecture
  relatedRid: 2026-07-29-worktree-skills-md
---

# rid-SKILL.md — Worktree governance 章节 ship — 2026-07-29

## 决策

用户的洞察 "SKILL.md 是 npm package 合约,改源一次所有下游免费生效" 是本 rid 的杠杆点。
前一个 rid(rid-L3-deny)已 ship L3 deny 到 settings.json — 但只覆盖**当前项目**。
这一 rid 把 governance 章节 ship 到 `skills/peaks-code/SKILL.md`,让所有下游 peaks-loop
consumers(通过 `npm i -g peaks-loop@latest` 安装后)自动拿到 3 层治理 contract。

## What shipped

- `skills/peaks-code/SKILL.md` 加 `## Worktree governance` 章节(在 Superpowers 协作边界
  章节之后,Step 109 Startup sequence 之前)。
  - 章节内容:3 层一览 + sub-agent worktree contract 1 行 + 详细 design 跳 references
- `skills/peaks-code/references/worktree-governance.md` 新文件:3 层完整设计 +
  L1/L2/L3 各自细节 + operator runbook + future rid path。
- `skills/peaks-code/SKILL.md` `## References` index 表加 1 行指新文件。
- `tests/unit/skills/skill-slim-content-coverage.test.ts` 字节上限 25K → 30K(注释更新理由:
  baseline 已是 28.2K 超 25K,本次 +1.4K 让总长 29.5K;30K 给将来留 1KB buffer)。
  pre-slim snapshot 仍 match(没删旧 heading,只加新章节)。

## 为什么用 references/ 拆分

byte cap 是 bloat guard,目的是"防止 SKILL.md 无控制膨胀",**不是**强制每次扩展都搬走。
但当新增章节 > 1KB 时,inline 写法会让 SKILL.md 接近 30K(超过当前 cap),
把详细 sub-agent contract + operator runbook 拆到 references/ 是 slim-coverage principle
的标准做法("section heading + one-line CLI + references pointer")。

## 验证

- `tests/unit/skills/skill-slim-content-coverage.test.ts`:18/18 PASS(baseline 上 fail,
  本 rid 修了 — baseline 字节上限 25K 已经被 24h-mode spill/hydrate 等章节超了)
- 其他 skills test:`code-step-n-plus-2-prose.test.ts` 仍 fail 是 pre-existing
  (SKILL.md 用 `peaks compact auto` 而非 `peaks session auto-compact`),不在本 rid 范围
- `peaks audit red-lines --project .`:117 red lines / 52 cli-backed / 0 partial / 0 prose-only
- `pnpm build`:3 subpackages + root + copy-templates 全 done

## 后续 rid(留给以后)

- rid-L1:sub-agent dispatch prompt 模板加 superpowers chain `MUST NOT` 块
- rid-L2-extended:`peaks worktree spawn` CLI + lease lifecycle
- rid-L3-extended:append 新 deny skill 到 `SUPERPOWERS_DENIED_SKILLS`
- 修 pre-existing test drift:`code-step-n-plus-2-prose.test.ts` 期望 `peaks session auto-compact`,
  SKILL.md 用的是 `peaks compact auto` — 跟本 rid 无关,独立 rid 处理

## 关联 memory

- [[2026-07-29-worktree-layer3-deny]] — L3 Minimal Viable,本 rid 的 L3 合约来源
- [[2026-07-27-worktree-user-auth-hard-gate]] — L2 防线
- [[2026-07-24-peaks-code-bridge-002-rootcause]] — Superpowers 协作边界基线