---
name: 2026-07-29-worktree-l1-dispatch-block
description: rid-L1 — Layer 1 of worktree governance ships; superpowers chain refusal block prepended to 4 dispatch surfaces (2 markdown + 1 inline SKILL.md section + 1 CLI composer constant); byte-identical degradation contract (slice-022) explicitly broken with governance justification.
metadata:
  type: project
  createdAt: 2026-07-29
  originSessionId: 2026-07-29-session-current
  severity: architecture
  relatedRid: 2026-07-29-worktree-l1-dispatch-block
---

# rid-L1 — Sub-agent dispatch prompt hardening (Layer 1) — SHIPPED 2026-07-29

## 决策

L3(`permissions.deny`)只 deny `superpowers:using-git-worktrees` 一个 Skill。但 superpowers
链(`brainstorming` → `writing-plans` → `subagent-driven-development` → `using-git-worktrees`)
让 LLM **在到达 using-git-worktrees 之前**就被教"raw `git worktree add` 是 OK 的"。
L3 拦下 Skill 后,LLM 可能改用直接 bash 走 raw `git worktree add`(绕开 L3,L2 hook 也能
被用户 `peaks hooks uninstall` 绕开)。L1 的目的:**在 L3 拦下之前就让 LLM 知道整条链
不能走**,堵死 chain-bypass attempts。

## What shipped

4 个 surface 加 superpowers chain refusal block:

1. `skills/bee/peaks-rd/references/rd-sub-agent-dispatch.md` — 文件顶部第一个章节(在
   `## Default --from-dag is mandatory` 之前)。
2. `skills/bee/peaks-qa/references/qa-sub-agent-dispatch.md` — 文件顶部第一个章节
   (在 sub-agent suspended sections 之前)。
3. `skills/bee/peaks-ui/SKILL.md` — G8.6 章节顶部(在 prompt template code fence 之前)。
4. `src/services/context/build-dispatch-system-prompt.ts` — 新增
   `L1_WORKTREE_GOVERNANCE_BLOCK` export 常量,`buildDispatchSystemPrompt` 在两个分支
   都 prepend 该 block(break slice-022 byte-identical degradation contract)。

Block 内容(4 处一致):
- chain:`superpowers:brainstorming` → `superpowers:writing-plans` →
  `superpowers:subagent-driven-development` → `superpowers:using-git-worktrees`
- 失败模式:`git worktree add` (using-git-worktrees SKILL.md L96)
- 唯一授权路径:`peaks worktree spawn --rid <rid> --ttl <duration> --purpose <text>`
  (fallback: `peaks worktree auth grant --rid <id> --reason <text> --ttl <5m>`)
- 治理失败说明:L3 不够,即使 deny terminal Skill,chain 已教 LLM 走 raw bash
- superpowers 作 reference material,不作 workflow

测试:`tests/unit/skills/l1-worktree-governance.test.ts` 12 个 case,验证:
- 4 个 surface 都含必需 substring(8 个 REQUIRED_SUBSTRINGS)
- markdown surface 顶部 30 行内含 block
- UI SKILL.md 的 L1 block 紧接 G8.6 code fence 之前
- CLI composer 在 available + unavailable 两个分支都 prepend block
- drift guard:3 个 markdown surface 一致

## 关键 trade-off:break slice-022 byte-identical contract

slice-022 (`buildDispatchSystemPrompt` 设计)的 unavailable 分支曾承诺
"byte-identical degradation":返回原 taskBody 不变。本 rid 主动 break 这条契约 —
unavailable 分支现在返回 `${L1_WORKTREE_GOVERNANCE_BLOCK}\n${taskBody}`。

理由:L1 治理是必须的。slice-022 的 byte-identical 是性能 / 兼容性优化,不是治理契约。
break 这条契约比漏掉 L1 block 重要。doc comment + 现有 test 都更新说明。

## 验证

- `tests/unit/skills/l1-worktree-governance.test.ts`:12/12 PASS
- `tests/unit/services/context/orchestrator-memory-hook.test.ts`:3/3 PASS(test 已更新反映
  slice-29 主动 break byte-identical)
- `peaks audit red-lines --project .`:119 red lines / 52 cli-backed / 0 partial / 0 prose-only
- `pnpm build`:3 subpackages + root + copy-templates 全 done

## 不变量(给后续 rids 用)

1. **Single source of truth**:`skills/peaks-code/references/worktree-governance.md`
   的"Sub-agent worktree contract"段是 L1 block 的语义权威。
2. **4 surface lockstep**:任何 surface 改动都必须同步改其他 3 个;
   drift guard test 会 fail。
3. **CLI composer always prepend**:L1 block 必须在 available + unavailable 两个
   分支都出现 — 这是 break slice-022 契约的全部理由。

## 后续 rid

- rid-L2-extended:`peaks worktree spawn` + lease lifecycle(主力 rid,1 周)
- rid-L3-extended:append 新 deny skill(触发式)
- 修 pre-existing test drift:`code-step-n-plus-2-prose.test.ts` 期望
  `peaks session auto-compact`,SKILL.md 用 `peaks compact auto`(独立 rid)

## 关联 memory

- [[2026-07-29-worktree-layer3-deny]] — L3 Minimal Viable
- [[2026-07-29-worktree-skills-md-shipped]] — SKILL.md npm contract
- [[2026-07-27-worktree-user-auth-hard-gate]] — L2 防线
- [[2026-07-24-peaks-code-bridge-002-rootcause]] — Superpowers 协作边界基线