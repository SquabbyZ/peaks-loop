---
name: 2026-07-29-worktree-l2-extended-part3
description: rid-L2-extended Part 3.A ships auto-release on dispatch finalization; 3 sub-slices 3 commits SquabbyZ sole-author; closes the L2 lifecycle end-to-end so sub-agents no longer leak worktree leases when they forget to release manually.
metadata:
  type: project
  createdAt: 2026-07-29
  originSessionId: 2026-07-29-session-current
  severity: architecture
  relatedRid: 2026-07-29-worktree-l2-extended
---

# rid-L2-extended Part 3.A — Auto-release on dispatch finalization — SHIPPED 2026-07-29

## 决策回顾

Part 1/2 ship 后,lease lifecycle 还差最后一步:sub-agent 收尾时
要主动调 `peaks worktree release`,忘了就依赖 `peaks worktree gc`
兜底(默认 30min)。Part 2 sediment 写明"考虑 dispatch record
finalization 流程里 hook 一个 release 调用"。Part 3.A 落地:
sub-agent 自报 `heartbeat --status done` 或被 share-reducer 标
markCompleted → 自动 fire release,无需 sub-agent 自律。

3 子切片 3 commit:

- 947455df Part 3.A.1 — persist `leaseId` on dispatch record + markCompleted hook
- 12d1e95d Part 3.A.2 — terminal heartbeat hook
- e17fb7bc Part 3.A.3 — e2e (3 cases incl. happy + no-op + non-terminal)

## What shipped (per slice)

### Part 3.A.1 — leaseId persistence + markCompleted hook (947455df)

`src/services/dispatch/dispatch-record-writer.ts`:

- `DispatchRecord` schema 加 `leaseId: string | null`(默认 null,
  legacy records 通过 `upgradeRecord` 默认 null 兼容)。
- `WriteInitialDispatchInput` 加 `leaseId?: string | null`。
  dispatch-commands 传 `leaseId` 派生自 Part 2.C 的 spawn 结果。
- 新导出 `tryAutoReleaseLease({ projectRoot, sessionId, leaseId })`:
  fire-and-forget detached spawn of `peaks worktree release`,
  16-hex 校验(同 gate),best-effort silent catch。
- `markCompleted` 在 terminal status + leaseId 存在 + projectRoot
  trusted 时调 `tryAutoReleaseLease`。位置在 lock release 之后,
  index unregister 之后 — record 是 durably finalized 后才 fire,
  release crash 不会回滚。

`src/cli/commands/dispatch-commands.ts`:line 387 调
`writeInitialDispatchRecord({ leaseId })`。

`tests/integration/sub-agent-dispatch-e2e.test.ts`:`SubAgentDispatchEnvelope`
interface 扩 `isolation / leaseId / worktreePath / worktreeBranch`
字段(Part 2.C 加了但 test type 没更,today's run 触发 tsc 错误
带出了遗漏)。

### Part 3.A.2 — terminal heartbeat hook (12d1e95d)

`src/cli/commands/heartbeat-commands.ts`:在 `printResult(ok(...))`
之后加 terminal-status 判定。status ∈ {done, failed, cancelled,
no-execution} 且 `result.record.leaseId !== null` 时 fire
`tryAutoReleaseLease`。

terminal set 跟 share-reducer 用的一致(都是 done/failed/cancelled/
no-execution),保证 sub-agent 报 'done' 只触发一次 release — 第二次
markCompleted 触发时 lease 已 released,Part 1 release CLI 幂等
返回 `alreadyReleased: true`。

### Part 3.A.3 — auto-release e2e (e17fb7bc)

`tests/integration/dispatch-isolation-lifecycle.test.ts` 3 case:

1. happy path:dispatch + heartbeat --status done → 10s 内 lease
   status=released + worktree dir 消失 + git worktree list 排除
2. non-terminal (--status running) 不 fire:1.5s 后 lease 仍 active
3. dispatch 无 --isolation + heartbeat --status done:record.leaseId
   === null,无 lease 目录

## 关键 trade-off / 设计选择

- **Fire-and-forget detached spawn, sync caller API** — heartbeat
  / markCompleted 已经 ship response,release 失败不能让 caller
  exit 1。`tryAutoReleaseLease` 用 `void (async () => {...})()`
  保持函数签名 sync,内部用 dynamic `import('node:child_process')`
  ESM-friendly 加载 spawn。
- **Idempotent: 两条 release 路径并存不双 fire** — heartbeat
  触发 + markCompleted 触发都调 release CLI,第二次命中
  `alreadyReleased: true` 直接 no-op。release CLI 本身是幂等的
  (Part 1),所以不需要在 CLI 层加 dedup。
- **16-hex 校验两道关** — record write + tryAutoReleaseLease 都
  校验,attacker 控制 toolCall.args.env 也无法注入。
- **ESM `require is not defined` gotcha** — 第一版用
  `require('node:child_process')`,vitest 跑 test 过但 binary
  跑挂(HEARTBEAT_ERROR:`require is not defined`)。tsc 编译输出
  是 ESM,`require` 不可用。改 `await import('node:child_process')`,
  动态 import ESM-native。同一 pattern 用于 debug marker(后删)。
- **terminal status set 与 share-reducer 对齐** — done/failed/
  cancelled/no-execution,4 个值。两边对齐避免 sub-agent 收尾时
  双 trigger 引起 audit 日志噪音(虽然第二次是 no-op)。

## 不变量(给后续 rids 用)

1. **Lease 是 source of truth(Part 1 规则)**:hook(Part 2.B)读 lease 文件
   决定 allow;CLI(Part 2.A)维护 lease 文件;dispatch(Part 2.C)写
   lease;finalize(Part 3.A)释放 lease。
2. **`peaks worktree release` 幂等** — `alreadyReleased: true`
   no-op,两条 release 路径并存不双 fire。
3. **`tryAutoReleaseLease` 不 throw** — silent catch + detached
   spawn,所有失败模式不外泄。`peaks worktree gc` 是兜底。
4. **leaseId 16-hex(2 处校验)** — record write + tryAutoReleaseLease。
5. **ESM dynamic import 加载 child_process** — peaks-loop dist
   是 ESM,`require` 不可用;用 `await import('node:child_process')`。

## 验证

- `tests/unit/services/worktree/worktree-lease.test.ts`:42/42 PASS
- `tests/unit/hooks/worktree-authorization-gate.test.ts`:50/50 PASS
- `tests/integration/sub-agent-dispatch-e2e.test.ts`:3/3 PASS
- `tests/integration/worktree-lease-lifecycle.test.ts`:3/3 PASS
- `tests/integration/dispatch-isolation-lifecycle.test.ts`:3/3 PASS(新)
- **累加:101/101 PASS** (Part 2 收官 137/137 - 3.A.3 拆出 3 - 一些其他 test 不在我跑的集合)
- `pnpm build`:3 subpackages + root + copy-templates 全 done
- `peaks audit red-lines --project .`:119 red lines / 52 cli-backed / 0 partial / 0 prose-only

## 后续 rid(留给明天 / 下次)

Part 2 sediment 列的 3 个 follow-up 还剩:

- **CLI hint 引导 sub-agent 调 release** — Part 3.A 让 auto-release
  跑了,这条 soft hint 价值下降。但仍有价值:sub-agent 在 release
  触发前能看到自己拥有 lease。
- **Lease observability metrics** — peaks observability 加
  `lease.autoRelease.count` / `lease.autoRelease.failed.count`,
  dashboard 展示。
- **non-Part-2.C isolation modes** — `--isolation container` /
  `--isolation vm`,L4 防线,独立 PRD。

新增后续(Part 3 发现):

- **lease auto-release 失败 metric** — `tryAutoReleaseLease` 静默
  catch 失败,无 metric。给 observability 加 release.failed counter
  + sample stderr 一次。
- **dispatch record v3 schema migration** — `leaseId` 字段在 v2 schema
  内隐式增加,新 consumers 想区分 v2-with-leaseId vs v2-no-leaseId
  需靠 default null 推断。可以升 v3 把 leaseId required + 显式
  schema 标记,但需 4-6 周渐进 migration。

## 关联 memory

- [[2026-07-29-worktree-l2-extended-part2]] — Part 2 4 子切片
- [[2026-07-29-worktree-l2-extended-part1]] — Part 1 lease 基础
- [[2026-07-29-worktree-l1-dispatch-block]] — L1 dispatch hardening
- [[2026-07-29-worktree-skills-md-shipped]] — SKILL.md governance chapter
- [[2026-07-29-worktree-layer3-deny]] — L3 superpowers jailbreak deny
- [[2026-07-27-worktree-user-auth-hard-gate]] — L2 grant token(本 rid 平行 surface)
