<!-- peaks-memory:start -->
---
title: codegraph 8 子任务集成 closure — 7 ship + 1 spike PARTIAL verdict (CG-006/007/001/009/005/008/002 ship; CG-003 spike 4 follow-ups)
kind: lesson
date: 2026-08-11
session: 2026-08-11-session-476090
session-continued-from: 2026-08-11-session-7f7f78
rids: [rid-CG-001, rid-CG-002, rid-CG-005, rid-CG-006, rid-CG-007, rid-CG-008, rid-CG-009, rid-CG-003]
commits: [e7ec3cb0, f4b56870]
related: [[2026-08-11-dogfood-4-0-20-cli-wiring-and-vendor-detect-defects]], [[2026-08-11-detached-architecture-feedback-in-shell-background]], [[2026-08-11-rid-001-redo-fake-green-recovery-closure]]
---

# codegraph 8-子任务集成 closure

> **优先级**：项目级 lesson。codegraph 集成的 future slice 必须按本 sediment 的 downstream-compat filter + pre-existing-rot discipline + spike-vs-ship boundary 三条走。

## 一句话总结

peaks-loop 4.0.20 codegraph 集成深化：7 个 sub-task ship'd（4 Quick + 3 Standards）+ 1 个 spike PARTIAL verdict（CG-003 `.codegraph/` → `.peaks/.codegraph/` 迁移路径需 4 follow-ups）。总 16 commits ahead of 4.0.20 SHIPPED + rid-001 redo + rid-001 sediment + 2 codegraph Phase commits。

## Timeline（关键节点）

| 时间 (UTC) | 事件 | 出处 |
|---|---|---|
| 2026-08-10 21:30Z | 4.0.20 SHIPPED (fde6b9f6)；@colbymchenry/codegraph@0.7.10 在 dependencies | git log / package.json |
| 2026-08-11 02:37Z | session 476090 启动；fresh peaks-code presence | session.json |
| 2026-08-11 03:00Z | user 授权 git-stash-mutating；drop rid-001 stash | worktree-gate |
| 2026-08-11 ~03:05Z | rid-001 redo RD | sub-agent |
| 2026-08-11 ~03:42Z | rid-001 RD repair (2 surgical fixes) | sub-agent |
| 2026-08-11 ~03:55Z | rid-001 QA cycle 2 verdict=pass | sub-agent |
| 2026-08-11 ~04:05Z | SC 出 rid-001 commit message | sub-agent |
| 2026-08-11 ~04:08Z | commit `e8fb5ed9` rid-001 redo landed | git log |
| 2026-08-11 ~04:10Z | commit `8db13d59` rid-001 sediment | git log |
| 2026-08-11 ~03:05Z | codegraph research 002 + 003 双 artifact | sub-agent |
| 2026-08-11 ~04:00Z | user reframe "下游兼容"；3rd artifact 003 出 | sub-agent |
| 2026-08-11 ~04:30Z | user 选 C: 8 全量 | AskUserQuestion |
| 2026-08-11 ~05:00Z | Phase 1 RD (CG-006/007/009/001) | sub-agent |
| 2026-08-11 ~05:30Z | Phase 1 QA all 4 pass | sub-agent |
| 2026-08-11 ~05:45Z | Phase 1 SC | sub-agent |
| 2026-08-11 ~05:50Z | commit `e7ec3cb0` Phase 1 landed | git log |
| 2026-08-11 ~06:00Z | Phase 2 RD (CG-005/008/002) | sub-agent |
| 2026-08-11 ~06:30Z | Phase 2 QA all 3 pass-with-minor | sub-agent |
| 2026-08-11 ~06:45Z | Phase 2 SC | sub-agent |
| 2026-08-11 ~06:50Z | commit `f4b56870` Phase 2 landed | git log |
| 2026-08-11 ~07:00Z | Phase 3 spike RD verdict=PARTIAL + 0 文件实施 | sub-agent |

## 8 sub-tasks 结果表

| rid | type | downstream-compat | ship? | verdict | commit |
|---|---|---|---|---|---|
| rid-CG-001 | Quick | only-self | ✅ | pass | e7ec3cb0 |
| rid-CG-006 | Quick | self+downstream | ✅ | pass | e7ec3cb0 |
| rid-CG-007 | Quick | self+downstream | ✅ | pass | e7ec3cb0 |
| rid-CG-009 | Quick | only-self | ✅ | pass (verify-only) | e7ec3cb0 |
| rid-CG-005 | Standard | self+downstream | ✅ | pass-with-minor | f4b56870 |
| rid-CG-008 | Standard | self+downstream | ✅ | pass-with-minor | f4b56870 |
| rid-CG-002 | Standard | only-self | ✅ | pass-with-minor | f4b56870 |
| rid-CG-003 | Heavy spike | only-self | ❌ | PARTIAL (spike) | (no commit) |

**总计 ship**：2 commit / 16 文件 / +1778 lines（含 1131 行 test）/ 31 new test cases / 124/124 unit suite PASS。

## 3 Lesson

### Lesson 1 — downstream-compat filter 是 ship 优先级判据

**现象**：8 个 sub-tasks 用 `downstream-compat: only-self / self+downstream / downstream-only` 三档分类。Phase 1 + 2 都优先 self+downstream（high ROI for consumer projects）。

**Why**：
- peaks-loop 是 npm package；consumer 装它时能拿到 `@colbymchenry/codegraph` transitively（confirmed via `npm view peaks-loop dependencies`）
- only-self 子任务只服务 peaks-loop 自己（如 auto-init、tarball verify）；self+downstream 服务所有 consumer（如 init guard、doctor fallback、consumer docs）
- 把"ship 顺序"按 ROI 排：self+downstream Quick 先做（CG-006/007 + 后 1/009），self+downstream Standard 次之（CG-005/008），only-self Standard 最后（CG-002），Heavy spike 最后（CG-003）

**How to apply**：
- 任何 peaks-loop 子任务定义必含 `downstream-compat` 字段
- Phase 1 + 2 顺序按 ROI 排，**不要** only-self 优先（user 最初犯了这个错）
- 子任务合并到 commit 时按同一 phase 打包（Phase 1 = 4 Quick，Phase 2 = 3 Standards）

### Lesson 2 — pre-existing rot discipline（version.ts drift）

**现象**：Phase 2 QA 3 个 verdict 全是 pass-with-minor，minor 是同一件事：`packages/peaks-loop-shared/src/version.ts` drift 4.0.18→4.0.20，**Phase 2 slices 都没碰**这个文件。drift 起源于 4.0.20 SHIPPED（fde6b9f6）当时 lockstep 没 bump peaks-loop-shared。

**Why**：
- pre-existing rot = "在我之前已存在，不是我引入的"——QA 不能 fail 整个 slice（否则 fake-green 风险）
- 但 commit 不能 silent include drift（out of scope per 切片 brief）
- SC 必须显式 `Out-of-scope:` 块在 commit footer 标出 drift，让 reviewer 知道
- 单独的 `chore(release): bump peaks-loop-shared version` 切片负责

**How to apply**：
- QA 看到 pre-existing rot 时 verbatim 时间戳证明（mtime vs RD 时刻）+ grep 证明切片未碰该文件
- SC 必须在 `Out-of-scope:` 块 verbatim 引用 drift + 原因
- 留 drift 在 working tree（不 git checkout --，等 sediment commit 一起处理）
- 下次 peaks-loop-shared bump 时 lockstep 同步（peaks CLI_VERSION shared chicken-egg lesson）

### Lesson 3 — spike vs ship boundary

**现象**：rid-CG-003 spike（`codegraph/` → `.peaks/.codegraph/` 全量迁移评估）verdict=PARTIAL，**RD 选择 0 文件实施**。

**Why**：
- spike 是 research-only experiment，结果是 verdict 不是 commit
- PARTIAL verdict = "feasible 但需要 follow-up slice"——不能在 spike 本身实施
- 0 文件实施不是 fake-green，而是诚实 boundary
- 4 个 follow-up items 列在 rd artifact 让未来切片接手

**How to apply**：
- 任何 spike-type sub-task：RD verdict + 0 文件实施（除非 verdict=PASS 且 sub-task brief 允许实施）
- PARTIAL verdict 必须列出 N 个 follow-up items（最小可 ship 子切片）
- follow-up items 写进 MEMORY.md sediment + 留在 rd artifact §"Minimum Follow-up"
- spike 自身 artifact 路径保留作为未来 slice 的 source-of-truth

## Follow-up 列表（不进本 session scope）

### CG-003 PARTIAL verdict 的 4 follow-up（最小可 ship 子切片）

1. **path-resolution slice** — `codegraph-service.ts` 加 `.peaks/.codegraph` 作为 preferred managed lookup + root `.codegraph` fallback for compatibility
2. **sub-command consistency** — `status / affected / init` 都用 resolved path（不 hardcode root）
3. **doctor capability probe 升级** — 识别 resolved managed path（保留 CG-007 的 package-resolution fallback）
4. **ignore rules + fixture test** — preferred-path precedence / root fallback / envelope writing real fixture

### 未来待 ship（按 ROI 排序）

- **F1**：扩 `DispatchResult` 暴露 ChildProcess；`detached.ts` 改 `child.on('error')`（来自 rid-001 redo follow-up）
- **F2**：detached arch 全面 revision（in-shell bg subprocess）← user 2026-08-11 feedback
- **F3**：vendor-detect Windows ENOENT 真 fix（不用 `shell: true`）
- **F4**：pre-existing test rot（dispatch-isolation-lifecycle 3 / sub-agent-dispatch-e2e 3 / dispatcher-flow 1）
- **F5**：sub-agent dispatch 模板 must_ls_files frontmatter
- **F6**：peak-loop-shared version bump lockstep 同步（resolve 4.0.18→4.0.20 drift）
- **F7**：CG-003 4 follow-up items（path-resolution + sub-command consistency + doctor probe + fixture test）
- **F8**：skill-resolution 切片（session 7f7f78 原 intent 之一，rid-002/003/004 scope unknown）

## 反模式（**不要做**）

1. **不要** 在 commit 里 include pre-existing rot（version.ts drift 单独 sediment commit）
2. **不要** 跳过下游兼容验证就直接 ship self+downstream 子任务（QA 必跑 npm view + 真 fixture）
3. **不要** spike 假装 ship——PARTIAL verdict + 0 文件实施是 honest answer，不是 fake-green
4. **不要** 把 `peaks-loop-shared/src/version.ts` 在 feature commit 中 silently bump（peaks CLI_VERSION shared chicken-egg）
5. **不要** 用 `Co-Authored-By: Claude/Anthropic` 在 commit message（项目红线）

## Sediment 关联

- [[2026-08-11-dogfood-4-0-20-cli-wiring-and-vendor-detect-defects]] — 4.0.20 dogfood 3 个缺陷（vendor-detect 死代码 + vendor-detect Windows ENOENT + bee 命名空间）
- [[2026-08-11-detached-architecture-feedback-in-shell-background]] — user feedback headless = in-shell bg
- [[2026-08-11-rid-001-redo-fake-green-recovery-closure]] — rid-001 fake-green recovery + 4 lesson
- [[peaks-loop-publishing-critical-hard-rules]] — peaks CLI_VERSION shared chicken-egg（背景：version.ts drift）

<!-- peaks-memory:end -->