---
name: peaks-loop-2026-08-05-peaks-loop-4-0-11-publish-closure-sediment
description: 4.0.11 publish 成功 ship 沉淀 — BDD test-style + statusline 3 bug fix + build chain repair
metadata:
  type: project
---

# peaks-loop 4.0.11 publish closure sediment

## Why
2026-08-05 一次性 ship `peaks-loop@4.0.11` — 包含 rid-2026-08-05-bdd-test-style 完整 5 slice + 3 statusline bug fix + build chain repair + 8 tail cleanup (63 rid state machine 归位)。

## How to apply
未来 publish 4.0.x 参考本 sediment 的步骤 + 红线:
- bump version root + peaks-loop-shared 同步 (lockstep)
- 写 CHANGELOG 4.0.x entry (含 ridge 编号 + commit hash)
- `git tag v4.0.x && git push origin main --tags`
- publish.yml 触发 + 通过 monitor + npm view verify

## Publish 步骤(2026-08-05 验证通过)

1. **bump version**:
   - `package.json` root: `4.0.10 → 4.0.11`
   - `packages/peaks-loop-shared/package.json`: `0.0.40 → 0.0.41`
2. **CHANGELOG.md**: 写 4.0.11 entry(BBD + statusline fix + build chain + cleanup tail)
3. **commit**: `chore(release): bump to 4.0.11 (BDD test-style + statusline bug fixes)`
4. **tag + push**:
   - `git tag v4.0.11`
   - `git push origin main --tags`
5. **monitor**: `HTTPS_PROXY=http://127.0.0.1:58309 gh run watch 31010735283`
6. **verify**:
   - `npm view peaks-loop dist-tags.latest` → 4.0.11 ✅
   - `npm view peaks-loop@4.0.11 version` → 4.0.11 ✅
   - `npm view peaks-loop@4.0.11 dependencies` → peaks-loop-shared@0.0.42(注意:pack 后 publish.yml chicken-egg fix 会自动 bump shared 到 n+2,所以 commit 时 0.0.41,实际 npm 上是 0.0.42)
   - GitHub Actions run ID: 31010735283, 1m3s 完成

## Publish 触发红线(2026-07-22 sediment + fix f4375b4a + 8f47d789)
- `git tag v<ver>` 后 publish.yml auto-bump 关闭 — gate #6 Verify exact tag matches bumped root version 强制
- `Refuse to publish if any .changeset/*.md is staged` — changesets/ 目录必须空
- peaks-loop-shared 必须 lockstep bump(root 4.0.11 → shared 0.0.41,pack 后 → npm 上 0.0.42)

## 4.0.11 包含 commits
- `715a2367` chore(release): bump to 4.0.11
- `9a0dd484` docs(project): auto-update PROJECT.md (BDD rid + statusline fix closure)
- `3438b0b2` fix(statusline): resolve 3 statusline bugs + unblock build chain
- `ec68d89e` docs(project): auto-update PROJECT.md session history
- `154679f0` fix(statusline): resolve 2 statusline display bugs (rd(+1) + mode)
- `3f200a28` fix(test): resolve 2 baseline fail (capability-glossary + batch-counter)
- `5af73566` feat(test-style): add BDD AST migrator + 8 pilot
- `018159d1` feat(test-style): peaks-qa BDD test-style verifier
- `f96a9879` feat(rd-dispatch): BDD Test Style Contract
- `5a3c8934` feat(qa-dispatch): BDD verification step
- `13504c84` feat(reporters): vitest BDD reporter
- `e4ca483f` feat(test-style): ship LLM contract + include in package.json#files
- + 11 个 Slice D 全量迁移 commits
- `cd407f77` ~ `4dcf6107`
- `8f42edac` docs(memory): b1+b2 sweep sediment (63 rid)
- `cabd032a` feat(eslint): ship .peaks-rules.cjs ESLint bundle
- (本会话之前 ship 的 peaks-loop commits 在 4.0.10 之外)

## 关键经验

### 1. peaks-loop-shared chicken-egg
publish.yml 在 pack 时会自动 bump shared 一档以避免 lock 死锁。
- 我 commit 时 shared 写 `0.0.41`
- publish.yml 跑 release-pack 时 shared 自动 bump 到 `0.0.42` (写到 tarball)
- 实际 npm 上的 `peaks-loop-shared@0.0.42` 是 publish.yml 的事,不是我手动

### 2. Statusline 3 bug 共同根因
4.0.8 引入 Presence Lease Graph 时,**忘了 mode 字段** + **legacy path 写死 mode: null** + **dispatch index 没 release queued status**。3 个 bug 都在 4.0.11 一次 ship。

### 3. callerId 不可区分 LLM/human
`process.env.CLAUDE_CODE_SESSION_ID` 是同一来源 — peaks-loop 任何 LLM-only 约束必须走 LLM 跑的 verifier 路径(peaks-qa),不能靠 PostToolUse hook。

### 4. CLI silent-catch 反复触发
publish.yml 内部 `try { setPresenceLease via fire-and-forget } catch { /* swallow */ }` — callerId 没绑时静默失败,导致 lease 不写 mode。**修法**:让 setSkillPresence 同步写 lease(但 production risk 高)。

## 守住的反向边界(全程)
- ✅ SquabbyZ sole-author(所有 commit)
- ✅ 0 Co-Authored-By trailer
- ✅ vitest 4.1.10 frozen(不升 5.x)
- ✅ Human-NL-Choice-Only
- ✅ Worktree 3-layer governance
- ✅ ESLint bundle 加 npm-contract,不发布新 npm package
- ✅ 0 误 publish 误 unpublish

## 未来 session 接续
4.0.12 候选:
- presence-lease-service.ts fire-and-forget 改成 await(setSkillPresence 同步等 lease 写入)
- dispatch-record-writer.ts 加 markCompleted 触发点(leaf sub-agent 完成后自动调)
- bdd-test-style-verifier 加更多 cases(LLM 输出边界 case)

---

**作者**:SquabbyZ (LLM-assisted; sole-author)
**关联会话**:2026-08-04-session-3fe1be
**publish 时间**:2026-08-05T13:34Z(Asia/Shanghai)