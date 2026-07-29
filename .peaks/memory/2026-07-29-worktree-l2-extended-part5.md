---
name: 2026-07-29-worktree-l2-extended-part5
description: rid-L2-extended Part 5 ships lease leak rate + cross-session aggregation (--rate + --all-sessions on peaks lease-metrics); 2 sub-slices 2 commits SquabbyZ sole-author; closes the observability query layer promised in Part 2/4 sediment.
metadata:
  type: project
  createdAt: 2026-07-29
  originSessionId: 2026-07-29-session-current
  severity: observability
  relatedRid: 2026-07-29-worktree-l2-extended
---

# rid-L2-extended Part 5 — Lease leak rate + cross-session aggregation — SHIPPED 2026-07-29

## 决策回顾

Part 4 sediment 留的 follow-up "lease observability dashboard"
具体化:不是 web dashboard,是用现有 observability stream 算
leak rate + 跨 session 聚合。预算充足所以把 dashboard 的核心
查询面(per-kind count → leak rate + lifetime stats)做了。

2 子切片 2 commit:

- 0f85cb94 Part 5.A — `peaks lease-metrics --rate` + `--all-sessions` aggregation
- d5b7c099 Part 5.B — e2e 3 case (clean rate / leak rate / cross-session)

## What shipped (per slice)

### Part 5.A — Rate + cross-session aggregation (0f85cb94)

`src/cli/commands/lease-metrics-commands.ts`:

- 新 pure 函数 `aggregateLeaseEvents(events)` — 共享 per-kind counts + tail 逻辑(single/all-sessions 路径复用)
- 新 pure 函数 `recomputeRate(events)` 返回 `RateStats`:
  - `totalSpawn` / `totalTerminal` / `estimatedActive` / `estimatedLeaked`
  - `completedLifetimes` / `avgLifetimeMs` / `p99LifetimeMs`
  - lifetime 算法:每个 leaseId 配对 first-spawn → first-terminal(release/gc/autoRelease/autoRelease-failed),duration 排序算 p99(0-1 lease 时 null)
- 新 pure 函数 `readAllSessionLeaseEvents(projectRoot)`:
  扫 `.peaks/_runtime/*/metrics/slices.jsonl` 聚合跨 session,跳过没事件 session
- CLI flag `--rate` / `--all-sessions` opt-in,默认行为不变
- envelope 加 `mode: 'single-session' | 'all-sessions'` 让 caller 知道返回范围
- 两个 flag 独立 + 可组合(`--all-sessions --rate` = project-wide leak rate)

### Part 5.B — e2e (d5b7c099)

`tests/integration/lease-metrics.test.ts` 加 3 case:

1. **clean rate**:spawn + renew + release + gc → estimatedActive=0, estimatedLeaked=0, completedLifetimes=1, avg/p99 非 null
2. **leak rate**:只 spawn → estimatedActive=1, estimatedLeaked=1, avg/p99 null
3. **cross-session**:2 个 session (A: spawn+release, B: spawn only)→ sessionCount=2, totalSpawn=2, totalTerminal=1, estimatedLeaked=1

## 关键 trade-off / 设计选择

- **`estimated` prefix** — aggregation 是基于 metrics stream 的估算,
  真正的 alive set 是 on-disk lease files。`peaks worktree list` 是
  source of truth for "alive" — metrics 给的是时间序列视角
  (leak 趋势)。两个 surface 各司其职,estimated 不会假装是 truth。
- **First-spawn → first-terminal pairing** — 简单的 spawn 配 release
  即可。renew 不计入 lifetime(renew 跟 spawn 不是 lifecycle 事件)。
  若同一 leaseId 多次 release(理论上 release CLI 幂等返回
  alreadyReleased),first-wins 避免重复计算。
- **All-sessions 跳没事件 session** — `missingSessions` 字段告诉
  caller 扫了多少空 session,不是错误。clean project 应该返回
  `sessionCount=0, missingSessions=N` 而不是 throw。
- **Pure functions 导出供未来 unit test** — `recomputeRate` /
  `aggregateLeaseEvents` / `readAllSessionLeaseEvents` 都是
  exported,pure input → output。e2e 覆盖了 end-to-end,但 unit
  test 可以加更细的 corner case(目前没加 — 没必要,aggregation
  简单且 e2e 覆盖了主路径)。
- **File size 290 行** — 仍 800 行 cap 内(Karpathy #2 Simplicity First)。
  若 Part 6+ 加更多 aggregation(e.g. p50/p95/p99 + 时间序列
  histogram),拆 `lease-metrics-aggregation.ts`。

## 不变量(给后续 rids 用)

1. **`peaks worktree list` 才是 "alive" source of truth** —
   `peaks lease-metrics` 是历史 metrics 视角,不是 FS 状态查询。
2. **RateStats 是估算** — `estimated` prefix 必须在每个 caller 显式
   读到,不能简化成 truth。后续 rid 加更细的 alert 规则要记住。
3. **envelope `mode` 字段是 source of truth for scope** —
   single-session / all-sessions 行为差异大,caller 必读。
4. **Pure aggregation functions** — `recomputeRate` /
   `aggregateLeaseEvents` / `readAllSessionLeaseEvents` 都接
   `ReadonlyArray<ObservabilityEvent>`,可在测试 mock 时间序列
   而不用真 spawn。

## 验证

- `tests/integration/lease-metrics.test.ts`:5/5 PASS(Part 4.B 2 + Part 5.B 3)
- 累加:原 Part 4 累加 103 + 2 net new = 105/105
- `pnpm build`:3 subpackages + root + copy-templates 全 done
- `peaks audit red-lines --project .`:119 red lines / 52 cli-backed / 0 partial / 0 prose-only

## 后续 rid(留给后续 session)

Part 2/3/4 sediment 列的剩:

- **Web dashboard** — `peaks lease-metrics --rate --all-sessions` 现在可 JSON 输出,web UI 调它渲染就是 dashboard
- **`--isolation container` / `--isolation vm`** — L4 防线,独立 PRD
- **Dispatch v3.1 minor** — 加 e.g. `isolationStartedAt` 时间字段
- **Lease GC 自动化** — 现在的 gc 是手动,可以让 peaks-cron 周期跑

## 关联 memory

- [[2026-07-29-worktree-l2-extended-part4]] — Part 4 observability
- [[2026-07-29-worktree-l2-extended-part3]] — Part 3 auto-release
- [[2026-07-29-worktree-l2-extended-part2]] — Part 2 hook + dispatch
- [[2026-07-29-worktree-l2-extended-part1]] — Part 1 lease 基础
- [[2026-07-29-worktree-l1-dispatch-block]] — L1 dispatch hardening
- [[2026-07-29-worktree-skills-md-shipped]] — SKILL.md governance
- [[2026-07-29-worktree-layer3-deny]] — L3 superpowers jailbreak
- [[2026-07-27-worktree-user-auth-hard-gate]] — L2 grant token
