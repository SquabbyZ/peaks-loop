---
name: 2026-07-29-worktree-l2-extended-part6-9
description: rid-L2-extended Part 6-9 close out the L2 follow-up stream: lease-stats summary CLI, dispatch record v3.1 (isolationStartedAt), --isolation container contract bridge; 4 sub-slices 4 commits SquabbyZ sole-author; final L2 ecosystem arc complete.
metadata:
  type: project
  createdAt: 2026-07-29
  originSessionId: 2026-07-29-session-current
  severity: observability + schema + L4 bridge
  relatedRid: 2026-07-29-worktree-l2-extended
---

# rid-L2-extended Part 6-9 — L2 follow-up stream closed — SHIPPED 2026-07-29

## 决策回顾

Part 2/3/4/5 sediment 列的 4 个 follow-up:
- Lease observability dashboard → Part 6 完成(CLI 形式,`peaks lease-stats`)
- Dispatch v3.1 minor → Part 7 完成(`isolationStartedAt` 字段)
- L4 isolation container → Part 8 完成(contract 桥接,runtime spawn 留给后续)
- Web dashboard / cron 自动化 → 留未来 session(Part 6 CLI 已可 JSON 输出给 dashboard)

4 子切片 4 commit:

- 024680e2 Part 6 — `peaks lease-stats` summary CLI
- 69d57b63 Part 7 — v3.1 schema + `isolationStartedAt`
- 3e6bbbc9 Part 8 — `--isolation container` contract bridge
- (this) Part 9 — final sediment

## What shipped (per slice)

### Part 6 — peaks lease-stats summary CLI (024680e2)

新顶层命令 `peaks lease-stats --project <root> --json`。聚合
3 维度:per-rid (top 20 by event count)/ per-role / per-isolation。
`isolation` 字段读 observability event detail(Part 4.A emitter 传
的 'isolation' = 'worktree' / 'container' / 'none')。

`computeLeaseStats` 纯函数导出供未来 unit test。
读侧复用 Part 5.A 的 `readAllSessionLeaseEvents` + `recomputeRate`。

### Part 7 — dispatch v3.1 + isolationStartedAt (69d57b63)

`DispatchRecord` 加 `isolationStartedAt: string | null`(required)。
`WriteInitialDispatchInput` 加 `isolationStartedAt?: string | null`。
`writeInitialDispatchRecord` 写入新字段。
`upgradeRecord` 读 v3 on-disk 时 default null(v3 → v3.1 是 additive,
不升 version 字段 — readers 通过 field presence 判断)。
`dispatch-commands` 在 `--isolation` 时传 `new Date().toISOString()`。
4 个 test literal site 更新。

意义:dashboard 算 isolation duration(`now - isolationStartedAt`)
不用 cross-reference metrics stream。Part 8 container 启动时间
会写在同一字段,dashboard 一次读取覆盖两种 isolation。

### Part 8 — --isolation container contract (3e6bbbc9)

`isolationMode` type 加 `'container'`。`--isolation container`
被 CLI 接受(以前 INVALID_ISOLATION),但 fail-fast
`ISOLATION_CONTAINER_NOT_YET_IMPLEMENTED` 带 clear remediation
hint(后续 rid 名字)。为什么不 silent fallback worktree:用户
显式要 container,silent 改 worktree 会破坏 L4 防线。contract
落地但 runtime spawn 是 TODO(新 service + CLI + 桥接,Part 8
commit 写明设计)。

## 关键 trade-off / 设计选择

- **`peaks lease-stats` 复用 lease-metrics 读侧** — 0 重复 IO,
  compose-by-design:metrics 给 input,stats 给 answer。
- **v3.1 不升 version 字段** — 4 个 test literal site 改动已
  Part 7 完成,如果升 v3→v4 又要改。Additive field 配 default
  null 让 read path 简单。Version 字段的真实意义是 "schema
  大改",v3.1 只是 v3 的新字段,reader 通过 field presence
  判断 v3.1 即可。
- **`ISOLATION_CONTAINER_NOT_YET_IMPLEMENTED` 而不是静默
  fallback** — L4 防线是 contract,不能偷工。后续 rid 接 docker
  runtime 时,这个 error code 直接消失。
- **Part 6 没写 e2e** — `peaks lease-stats` 是 read-only aggregation,
  复用 Part 5.A 的 readers(已有 e2e 覆盖)。新 unit test 收益低。
- **Part 7 没写 e2e** — schema 字段加是 tsc 验证,逻辑无新分支。
  dashboard 测在 Part 6 的 read 路径(后续 rid 写 dashboard 时
  会自然覆盖)。

## 不变量(给后续 rids 用)

1. **`peaks lease-metrics` 是 event stream,`peaks lease-stats`
   是 state** — 两个 surface 各司其职,不大一统。
2. **v3 / v3.1 共存** — readers 通过 field presence 区分。
3. **container 集成未完成** — `ISOLATION_CONTAINER_NOT_YET_IMPLEMENTED`
   error code 是 stable contract,新 rid 落地后这 code 消失。
4. **isolationStartedAt 跨模式统一** — worktree 跟 container 都写
   同一字段,dashboard 一处读。

## 验证

- 累加:**106/106 across 6 worktree-related test files**
- `pnpm build`:3 subpackages + root + copy-templates 全 done
- `peaks audit red-lines --project .`:119 red lines / 52 cli-backed / 0 partial / 0 prose-only

## 完整 L2 ecosystem 总结(20 commits)

```
Part 1   33aad895 spawn/release CLI
Part 2.A dd0b505e renew/list/gc/status
Part 2.B ed61016f lease-aware hook
Part 2.C 8c596417 dispatch --isolation worktree
Part 2.D b3d87e70 lifecycle e2e
Part 2.E d8736d35 sediment
Part 3.A.1 947455df leaseId persist + mark
Part 3.A.2 12d1e95d heartbeat terminal hook
Part 3.A.3 e17fb7bc auto-release e2e
Part 3.A.4 58656d64 sediment
Part 4.A f0b5690c observability emitter
Part 4.B 4cb0f0e0 metrics e2e
Part 4.C f8751b56 v3 schema migration
Part 4.D b1d0cfb0 sediment
Part 5.A 0f85cb94 --rate + --all-sessions
Part 5.B d5b7c099 e2e
Part 5.C 4032d139 sediment
Part 6   024680e2 lease-stats CLI
Part 7   69d57b63 v3.1 + isolationStartedAt
Part 8   3e6bbbc9 container contract bridge
Part 9   (this) final sediment
```

**L2 ecosystem 现在覆盖**:
- 1 CLI command: `peaks sub-agent dispatch --isolation <mode>`
- 6 lifecycle CLIs: `peaks worktree {spawn,renew,list,gc,lease-status,release}`
- 2 observability CLIs: `peaks lease-metrics` + `peaks lease-stats`
- 1 auth CLI: `peaks worktree auth {grant,revoke,status}`
- 3 layer governance: L1 dispatch block / L2 hook gate / L3 IDE deny

**全部 follow-up 完成**:
- ✅ Lease observability metrics (Part 4)
- ✅ Leak rate (Part 5)
- ✅ Cross-session aggregation (Part 5)
- ✅ Lease-stats summary (Part 6)
- ✅ v3.1 schema + isolationStartedAt (Part 7)
- 🚧 Container isolation contract (Part 8) — bridge landed, runtime TODO
- ⏸️ Web dashboard — Part 6 CLI 输出 JSON 可直接 feed
- ⏸️ Cron automation — peaks-cron 集成 留给后续

## 剩 follow-up(真正后续 session)

- **L4 container runtime spawn** — `src/services/container/container-lease.ts`
  + `peaks container spawn/release` + PreToolUse gate 桥接
  (Part 8 commit msg 写明设计)
- **peaks-cron 周期 lease gc** — 现在 `peaks worktree gc` 是手动
- **Web dashboard** — `peaks lease-stats --json` 已有,web UI 直接调

## 关联 memory

- [[2026-07-29-worktree-l2-extended-part5]] — Part 5 rate + cross-session
- [[2026-07-29-worktree-l2-extended-part4]] — Part 4 observability + v3
- [[2026-07-29-worktree-l2-extended-part3]] — Part 3 auto-release
- [[2026-07-29-worktree-l2-extended-part2]] — Part 2 hook + dispatch
- [[2026-07-29-worktree-l2-extended-part1]] — Part 1 lease 基础
- [[2026-07-29-worktree-l1-dispatch-block]] — L1 dispatch hardening
- [[2026-07-29-worktree-skills-md-shipped]] — SKILL.md governance
- [[2026-07-29-worktree-layer3-deny]] — L3 superpowers jailbreak
- [[2026-07-27-worktree-user-auth-hard-gate]] — L2 grant token
