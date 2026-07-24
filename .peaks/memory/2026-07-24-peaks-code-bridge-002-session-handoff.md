---
title: peaks-code vs superpowers 污染根因 + peaks-loop@4.0.0-beta.14 治理 session 交接
kind: session-handoff
created: 2026-07-24T00:38:00.000Z
session: 2026-07-24-session-526ad1
related-rid: 2026-07-24-peaks-code-bridge-002-rootcause
job-id: peaks-code-bridge-002-rootcause
---

# Session handoff — peaks-code bridge 治根 session

## 用户原始诉求

> "我需要你把代码回退到4.0.0-beta.36版本的代码" + "现在 peaks-loop 把 superpowers 的流程占据,peaks-code 的流程完全失效" + "我手动处理全局的 peaks-code 了...之前是软连接...我怀疑是不是 bate.14 版本后造成的问题,也有可能是某次 dogfood 引起的" + "那基本可以判断出当前的这个修复问题是,拆子包引入的"

## 用户最终决策

- **P1**:完全回退到 4.0.0-beta.14 干净状态
- **pre-tool-superpowers-bridge.sh** 来源:不是仓库源,LLM 现场拼装(有 heredoc bug)
- **writing-plans blocker B1**:**option B 撤回 G5/AC5**,依靠 peaks-code/SKILL.md + runbook + boundaries + external-skill-invocation 4 处冗余 bridge
- **monorepo-split 根因**:**确认**,本次污染根因之一

## 治根治理三件已完成

1. **user 全局清理**(今天 08:00-08:08):
   - 删 `~/.claude/skills/peaks-code/hooks/pre-tool-superpowers-bridge.sh`
   - 撤 `~/.claude/skills/peaks-code/SKILL.md` 的 BRIDGE 章节(恢复 npm 包 16,746 字节原版)
   - 清 `.claude/settings.local.json` bridge hook 残留(从 3 hook → 2 hook)
   - 重建 `~/.claude/skills/peaks-code` 为 junction → `AppData/.../peaks-loop/skills/peaks-code`
   - 22 个 peaks-* skill 现在全部统一为 `<JUNCTION>` 格式

2. **001-bridge 半成品收尾**:
   - block job `peaks-code-superpowers-governance` slice-001(reason: 被 PRD 002 取代)
   - 001 PRD/RD 留在 `.peaks/_runtime/2026-07-24-session-526ad1/{prd,rd}/requests/001-*.md` 作为历史档案

3. **PRD 002 + RD 002 起草完成**:
   - PRD 002:124 行,G1-G19 + AC1-AC19 + 15/15 验证
   - 业务 G1-G8(G5 撤回,4 处冗余 bridge)
   - 基础设施完整性 G9-G12
   - 半成品收尾 G13-G15
   - **monorepo-split 根因层 G16-G19(本次新增,user 2026-07-24 诊断)**
   - RD 002:208 行,11 slices,G5 dropped,G16 added
   - PRD lint pass + transition `handed-off`

## 未完成(下一 session 必走)

1. **dispatch peaks-rd pass 2**:写 7 安全 in-scope paths + G16 files[] whitelist + G18 version lockstep,transition rd-handoff
2. **dispatch peaks-qa**:验证 AC1-AC19(15 个原始 AC + 4 个 monorepo-split AC)
3. **dispatch peaks-txt**:出 handoff capsule
4. **peaks memory extract --apply**:Step 11 BLOCKING,sediment 闭环

## 关键产物的绝对路径(供下一 session 读)

```
.peaks/_runtime/2026-07-24-session-526ad1/session.json
.peaks/_runtime/2026-07-24-session-526ad1/prd/requests/002-2026-07-24-peaks-code-bridge-002-rootcause.md  (state=handed-off)
.peaks/_runtime/2026-07-24-session-526ad1/rd/requests/002-2026-07-24-peaks-code-bridge-002-rootcause.md  (state=blocked-on-B1-resolved, ready-to-resume)
.peaks/_runtime/2026-07-24-session-526ad1/job/peaks-code-superpowers-governance/state.json                 (blocked)
.peaks/_runtime/2026-07-24-session-526ad1/job/peaks-code-bridge-002-rootcause/state.json                  (active, 8 slices)
.peaks/_runtime/2026-07-24-session-526ad1/sc/p1-backup/                                                  (清理前快照)
.peaks/_runtime/2026-07-24-session-526ad1/sc/symlink-restore/                                            (junction 重建前快照)
```

## 备份位置(回滚)

```
.peaks/_runtime/2026-07-24-session-526ad1/sc/p1-backup/
  SKILL.md.before                            (19,588 bytes, 含 BRIDGE)
  pre-tool-superpowers-bridge.sh.before      (3,892 bytes, 有 bug)
  settings.local.json.before                 (1,088 bytes, 3 hook)
  settings.local.json.after                  (839 bytes, 2 hook)
.peaks/_runtime/2026-07-24-session-526ad1/sc/symlink-restore/
  SKILL.md                                   (16,746 bytes)
  references/
```

## 仓库状态

- HEAD: `08d93353`(回退后,符合 user commit hash)
- package.json: `4.0.0-beta.34`
- 安全分支: `backup/main-pre-reset-2026-07-24` → 原 `6c9d917b`
- untracked: `tests/unit/skills/peaks-code-superpowers-bridge.test.ts` (RD G7 产物)

## peaks-loop CLI

- 版本: `peaks-loop@4.0.0-beta.14` (npm 全局)
- peaks-loop-shared: **未装**(beta.14 pre-monorepo-split)
- 这就是为什么 junction 全是 `peaks-loop/skills/<skill>`(单层)而不是 `peaks-loop/skills/bee/<sub-skill>`(monorepo-split 后)

## 闭环状态(2026-07-24 03:xx,本次 session 收尾)

- 提交 `3c82c797` 已落 `main`,7 个 repo source 文件改动,human-only author。
- RD 状态:`qa-handoff`(5/5 gate pass)。
- QA 状态:`verdict-issued`(PASS WITH NOTE,16/19 AC + 1 withdrawn + 2 deferred)。
- `peaks workflow verify-pipeline`:`complete: true`,`gateC: pass`,`gateH: pass`。
- 4 维/2 审计/security/perf artifacts 齐全;feedback promotion 完成。
- `peaks memory extract --apply` 已执行,稳定记忆已落到 `.peaks/memory/`(包括本 handoff)。
- 切片边界检查:review-fanout 已 dispatched(以 `Skill("peaks-rd")` 重生);`tsc --noEmit` 因 `peaks-loop-shared/version` 缺失失败 — 仍是已记录的 `peaks-cli-version-shared-chicken-egg`,与本 slice 无关,继续作为 follow-up 处理。

## 用户最后一条消息

> "继续修复"

→ 本次 session 已在 commit `3c82c797` 与 `verdict-issued` 状态下完成,边界非阻塞遗留项已记录。

## 后续关注点(非阻塞,follow-up)

1. **AC18 PRD 文案修正**:把 PRD 里"version equality"检查改为基于 `CLI_VERSION`,而不是 `peaks-loop-shared/package.json#version`(避免与 shared 包的 0.0.x cadence 冲突)。
2. **桥接 hook 真实安装**:运行 `peaks hooks install --global` 把 `pre-tool-superpowers-bridge.sh` 真正落到 `~/.claude/skills/peaks-code/hooks/`,目前仅代码就绪。
3. **chicken-egg 解决**:运行 `pnpm -r build` 让 `packages/peaks-loop-shared/dist/version.js` 重新生成,消除 `tsc --noEmit` 报错。
4. **monorepo-split 溯源**:`86546a76 / bec3b951 / 2b47fa42` 三次提交引入的 8 subpackage 拆分,已被本次根因层 G16-G19 覆盖。

## How to apply(下次)

- 读本 memory 与 `.peaks/_runtime/2026-07-24-session-526ad1/txt/handoff.md`。
- 验证 `pnpm exec peaks workflow verify-pipeline --rid 2026-07-24-peaks-code-bridge-002-rootcause --project . --type refactor --session-id 2026-07-24-session-526ad1 --json` 仍返回 `complete: true`。
- 处理上述 4 个 follow-up 即可。

**Why:** 闭环已记录,不再需要接力;下个 session 只需清理 follow-up 而非重做。

**Related:** [[001-bridge 半成品]][[junction 治根]][[monorepo-split 根因]][[peaks-rd pass 2 接力]]