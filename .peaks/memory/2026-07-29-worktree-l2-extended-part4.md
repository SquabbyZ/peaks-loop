---
name: 2026-07-29-worktree-l2-extended-part4
description: rid-L2-extended Part 4 ships lease observability (5 emit sites + peaks lease-metrics CLI) and dispatch record v3 schema migration (leaseId structurally required); 4 sub-slices 4 commits SquabbyZ sole-author; closes the L2 observability + schema debt from Part 3.
metadata:
  type: project
  createdAt: 2026-07-29
  originSessionId: 2026-07-29-session-current
  severity: architecture
  relatedRid: 2026-07-29-worktree-l2-extended
---

# rid-L2-extended Part 4 — Lease observability + dispatch v3 migration — SHIPPED 2026-07-29

## 决策回顾

Part 2 sediment 留的 3 个 follow-up:

1. **Lease observability metrics** — peaks observability 加 lease 类目
2. **CLI hint 引导 release** — Part 3.A 闭环后价值下降,跳过
3. **Non-worktree isolation modes** — 新方向,放后续

加 Part 3 新发现的 2 个:

4. **Auto-release 失败 metric** — Part 4.A 一并 ship(`autoRelease-failed` kind)
5. **Dispatch record v3 schema migration** — Part 4.C 一并 ship

4 子切片 4 commit:

- f0b5690c Part 4.A — emitLeaseEvent + 5 emit sites + `peaks lease-metrics` CLI
- 4cb0f0e0 Part 4.B — lease-metrics e2e 2 case
- f8751b56 Part 4.C — v3 schema migration + 6 literal site fix
- (this) Part 4.D — sediment

## What shipped (per slice)

### Part 4.A — Lease observability emitter + CLI (f0b5690c)

`src/services/observability/observability-service.ts`:
- 加 `category: 'lease'` 到 `OBSERVABILITY_CATEGORIES` enum(zod schema 自动 pick up)
- 新导出 `emitLeaseEvent({ sessionId, projectRoot, kind, leaseId, rid?, role?, reason? })`
- 7 个 `LeaseEventKind`:spawn / renew / release / gc / autoRelease / autoRelease-failed / autoRelease-skipped

`src/cli/commands/worktree-auth-commands.ts`:5 个 emit site
- spawn 后 emit kind='spawn'
- release 后 emit kind='release' (manual)
- renew 后 emit kind='renew'
- gc sweep 每个 lease emit kind='gc'

`src/services/dispatch/dispatch-record-writer.ts`:`tryAutoReleaseLease` 拆
async block 内:
- 成功 emit `kind='autoRelease'`
- catch(动态 import / child_process sync throw)emit `kind='autoRelease-failed'`

`src/cli/commands/lease-metrics-commands.ts` (新文件):`peaks lease-metrics`
CLI 读 `.peaks/_runtime/<sid>/metrics/slices.jsonl` 过滤 `category==='lease'`,
聚合 per-kind counts + 5-event chronological tail。

`src/cli/program.ts`:register `peaks lease-metrics` 到顶层(不挂在 `peaks lease`
下,避免 lease noun vs verb 语义冲突 — lifecycle verbs 已经在 `peaks worktree`
下)。

### Part 4.B — lease metrics e2e (4cb0f0e0)

`tests/integration/lease-metrics.test.ts` 2 case:
1. 全手动生命周期 spawn → renew → release → gc → 读 metrics,断言 per-kind counts
2. clean session 0 events,autoRelease-failed counter 可见

### Part 4.C — dispatch v3 schema migration (f8751b56)

- `DispatchRecord.version: 2` → `version: 3`
- `DispatchRecord.leaseId?: string | null` → `leaseId: string | null`(required)
- 6 个 literal site 更新(4 unit + 1 e2e + 1 stage-visibility)
- `upgradeRecord` 把 v2 on-disk 升 v3 + `leaseId: null` default
- markCompleted + heartbeat hook 删 `?? ''` workaround(已 required,不再需要)

## 关键 trade-off / 设计选择

- **观测事件复用现有 schema** — `category='lease'` + `detail.kind`
  不用新 schema version,跟 slice/dispatch/cycle/token-usage 同 stream。
  Reader filter on read,schema pollution = 0。
- **autoRelease-failed 只覆盖 sync throw** — `tryAutoReleaseLease` 的
  async spawn(NOENT 等)在 detached child 失败无法从父进程 catch。
  16-hex regex 在 helper 入口拦截坏 leaseId(Part 1-3 一直这样做)
  是真正结构防线。autoRelease-failed metric 覆盖的是动态 import 本身
  抛错的罕见 case。整体防御 = 2 层 + 1 metric。
- **`peaks lease-metrics` 顶层(不挂 `peaks lease`)** — 避免新 parent
  group 命名冲突(lease noun vs verb)。lifecycle verbs 已在
  `peaks worktree` 下。
- **v3 schema 升 1 个 minor** — 不分 v3-minor / v3-patch。leaseId required
  是 binary 切换,upgradeRecord 一处兼容。后续如果需要 v3.1,加
  `?` 字段用 v3.1 区分。
- **TypeScript strict 模式 behavior** — Part 3.A.1 引入 nullable
  字段时,object-literal excess check 没 fire 因为字段 nullable。
  Part 4.C 把字段 required 才强制 4 个 test 补 leaseId。教训:
  required field 在 strict mode 下 literal site 必须显式列出,
  nullable alone 不会触发提醒。

## 不变量(给后续 rids 用)

1. **Observability stream 是 single source of truth for lease metrics** —
   不在 lease file 里加 counter,避免双写漂移。
2. **leaseId 16-hex double-gate** — record write + tryAutoReleaseLease。
3. **v3 schema is forward-only** — `upgradeRecord` 把 v2 升 v3,无降级路径。
4. **`peaks lease-metrics` 是 read-only** — 不写 stream,只聚合。
5. **emitter 全部 fire-and-forget** — `emitObservabilityEvent` 永不 throw,
   caller 不 inspect result。

## 验证

- `tests/unit/services/worktree/`:42/42 PASS
- `tests/unit/hooks/worktree-authorization-gate.test.ts`:50/50 PASS
- `tests/integration/sub-agent-dispatch-e2e.test.ts`:3/3 PASS
- `tests/integration/worktree-lease-lifecycle.test.ts`:3/3 PASS
- `tests/integration/dispatch-isolation-lifecycle.test.ts`:3/3 PASS
- `tests/integration/lease-metrics.test.ts`:2/2 PASS
- `tests/integration/dispatcher-flow.test.ts`:7/7 PASS
- `tests/unit/dispatch/stage-visibility.test.ts`:pass(v3 迁移后)
- `tests/unit/dispatch/startup-timeout.test.ts`:pass(v3 迁移后)
- `tests/unit/dispatch/await-batch-characterization.test.ts`:12/12 PASS
- **累加:103/103 across 9 worktree-related test files**
- `pnpm build`:3 subpackages + root + copy-templates 全 done
- `peaks audit red-lines --project .`:119 red lines / 52 cli-backed / 0 partial / 0 prose-only

## 后续 rid(留给后续 session)

Part 2/3 sediment 列的还剩:

- **Non-worktree isolation modes**(`--isolation container` / `--isolation vm`)— L4 防线,独立 PRD
- **Lease observability dashboard** — 聚合 peaks-league metrics 到 web view(目前 CLI only)
- **Lease GC metrics 聚合** — 跟 `lease.spawn.count` - `lease.release.count` 算 leak rate
- **Dispatch record v3.1 minor** — 加 e.g. `isolationStartedAt`,如果未来想追踪 isolation 时间

## 关联 memory

- [[2026-07-29-worktree-l2-extended-part3]] — Part 3 auto-release
- [[2026-07-29-worktree-l2-extended-part2]] — Part 2 hook + dispatch bridge
- [[2026-07-29-worktree-l2-extended-part1]] — Part 1 lease 基础
- [[2026-07-29-worktree-l1-dispatch-block]] — L1 dispatch hardening
- [[2026-07-29-worktree-skills-md-shipped]] — SKILL.md governance
- [[2026-07-29-worktree-layer3-deny]] — L3 superpowers jailbreak
- [[2026-07-27-worktree-user-auth-hard-gate]] — L2 grant token
