---
name: 2026-07-29-worktree-l2-extended-part2
description: rid-L2-extended Part 2 ships 4 sub-slices (renew/list/gc/status CLI + lease-aware PreToolUse gate + dispatch --isolation worktree bridge + lifecycle e2e); 137/137 PASS, 4 commits SquabbyZ sole-author; closes the L2 ecosystem promised in Part 1 sediment.
metadata:
  type: project
  createdAt: 2026-07-29
  originSessionId: 2026-07-29-session-current
  severity: architecture
  relatedRid: 2026-07-29-worktree-l2-extended
---

# rid-L2-extended Part 2 — Lease lifecycle CLI + hook integration + dispatch bridge + e2e — SHIPPED 2026-07-29

## 决策回顾

Part 1 ship 完(sediment 写明 "留给 Part 2 / 明天")Part 2 一气 4 子切片
做完,4 个独立 commit:

- dd0b505e Part 2.A — `peaks worktree renew | list | gc | lease-status`
- ed61016f Part 2.B — `evaluateWorktreeAuth` 接受 `leaseId` fallback
- 8c596417 Part 2.C — `peaks sub-agent dispatch --isolation worktree` 桥接
- b3d87e70 Part 2.D — `tests/integration/worktree-lease-lifecycle.test.ts`

每一片都有 e2e 或 unit test ship,验证 137/137 累加 PASS。

## What shipped (per slice)

### Part 2.A — Lease lifecycle CLI (dd0b505e)

`src/services/worktree/worktree-lease.ts` 新加 3 个纯函数:
`listLeasesSync` / `isLeaseGcEligible` / `renewLease`。
`src/cli/commands/worktree-auth-commands.ts` 新加 4 命令:
- `peaks worktree renew --lease-id <id> [--ttl <ms>]` —
  续期;`released`/`gc` 状态拒绝 (LEASE_NOT_RENEWABLE)。
- `peaks worktree list [--status <s>] [--expired-only]` —
  扫 `.peaks/_runtime/<sid>/worktree-leases/*.json`,
  注释 `live` / `remainingMs` / 排序 createdAt desc;malformed → `errors[]`。
- `peaks worktree gc [--lease-id <id>] [--dry-run]` —
  主动 sweep released / past-expiry,先 `markExpired` 再 `git worktree remove --force`
  + `git worktree prune`,最后 `markGc`。`--dry-run` 是真 no-op。
- `peaks worktree lease-status --lease-id <id>` —
  单 lease inspector + `live` 标志 + path-exists / path-is-dir 诊断。

测试:11 个新 case (renewLease 3 / isLeaseGcEligible 4 / listLeasesSync 4)
累加 31 → 42/42。

### Part 2.B — Lease-aware PreToolUse gate (ed61016f)

`src/services/hooks/worktree-authorization-gate.ts`:
- `WorktreeAuthCheckInput` 加 `leaseId: string | null`(undefined 兼容);
  38 个老 test 不动。
- `WorktreeAuthDecision` 变 3-variant union:`allow via auth` /
  `allow via lease` / `deny`。`viaLease: WorktreeLease | null` 字段
  让审计日志能区分哪条路授权。
- `evaluateWorktreeAuth` 现在是 2 阶段:先 `decideFromAuthorization`,
  allow 直接返回;deny 走 `decideFromLease`(Part 1 lease 模块复用)。
- `decideFromLease` 读 `<projectRoot>/.peaks/_runtime/<sid>/worktree-leases/<leaseId>.json`,
  fail-closed 全套:malformed → WORKTREE_LEASE_FILE_INVALID;
  not-active → WORKTREE_LEASE_NOT_ACTIVE;
  rid-mismatch → WORKTREE_LEASE_REQUEST_MISMATCH。
- `src/cli/commands/gate-commands.ts` 读 `process.env.PEAKS_WORKTREE_LEASE_ID`
  (16-hex 校验),传给 gate。dispatch (Part 2.C) 是 env 的 canonical writer。

跨平台路径修:worktree-lease.ts 原来用 hand-rolled `/`-only join,
在 Windows 跟 `node:path.join` 的 backslash 路径错位。
改成 `path.posix.join` + 显式 `\\` → `/` normalize 后,
`leaseFilePath` 跟 `writeFileSync` 一致,`existsSync` 看到同一路径。

测试:12 个新 case (无 grant+lease / grant+lease 选 grant /
malformed / expired / released / rid-mismatch / rid-match / passthrough /
undefined legacy)。38 → 50/50。

### Part 2.C — `peaks sub-agent dispatch --isolation worktree` (8c596417)

`src/cli/commands/dispatch-commands.ts` + `sub-agent-shared.ts`:
- 加 `--isolation <mode>` flag,只接受 "worktree"(其他 → INVALID_ISOLATION)。
- 派发前 `spawnWorktreeLease(...)` 子进程调 `peaks worktree spawn`,
  parse JSON envelope 拿 leaseId + path + branch。
- `toolCall.args.isolation = 'worktree'` + `env.PEAKS_WORKTREE_LEASE_ID = <id>`。
  env block 是 PreToolUse gate 读 `process.env.PEAKS_WORKTREE_LEASE_ID` 的源。
- prompt body 前置 `## Worktree isolation (Part 2.C)` 块,
  sub-agent 即使 IDE 不 surface `args.env` 也能看到 leaseId。
- envelope 加 `data.isolation / data.leaseId / data.worktreePath / data.worktreeBranch`,
  envelopeVersion 2.2.0 → 2.3.0。
- INVALID_ISOLATION + ISOLATION_SPAWN_FAILED 两个新 error code,
  fail-fast 在任何 sub-agent 工作之前。

测试:3 个新 e2e case 在 `tests/integration/sub-agent-dispatch-e2e.test.ts`:
happy path(临时 git repo + isolation worktree → exit 0,
on-disk lease 文件 status=active rid 匹配 request-id,
toolCall.args.env.PEAKS_WORKTREE_LEASE_ID === leaseId)+
invalid mode + 原 P1-7 case 仍过(隔离是 opt-in)。

### Part 2.D — Lease lifecycle e2e (b3d87e70)

`tests/integration/worktree-lease-lifecycle.test.ts` 3 case:
1. 完整 happy path lifecycle 跑 8 步:
   spawn → list (1 active) → status (live + pathIsDirectory)
       → renew (24h TTL,严格 new > previous, previousExpiresAt = on-disk)
       → release (worktree remove + status=released)
       → gc (markGc + git worktree prune)
       → list --status active (returned=0)
       → respawn (--branch unique) → release → gc --dry-run
         (swept ≥ 1,lease 文件 status 仍 'released',证明 dry-run 是真 no-op)。
2. renew on released → LEASE_NOT_RENEWABLE fail-closed。
3. status on missing → LEASE_NOT_FOUND fail-closed。

为什么不用 execSync spy:CLI 调 `git worktree add/remove/prune`,
用真 tmp git repo 跟 `sub-agent-dispatch-e2e` 一致 — 真 repo 让
side effects 自然可见,比 mock 更强。

Windows clock-skew 修:renew `newExpiresAt = Date.now() + ttl`,
spawn 跟 renew 跨进程 Date.now() 漂移可达数百 ms。原 test 断言
`new > previous` 直接,当 `--ttl` 比 spawn 的 TTL(rd default 30m)小时
new 可能更小。修:用 24h TTL 严格保证更大。

Branch-conflict 修:`git worktree add -b <branch>` 拒绝已被另一
worktree 占用的 branch。lifecycle test 跑 release→gc→respawn on
同 rid(派生同 branch)会撞。修:respawn 加 `--branch <unique>`。

## 验证

- `tests/unit/services/worktree/worktree-lease.test.ts`:42/42 PASS
- `tests/unit/hooks/worktree-authorization-gate.test.ts`:50/50 PASS
- `tests/integration/sub-agent-dispatch-e2e.test.ts`:3/3 PASS
- `tests/integration/worktree-lease-lifecycle.test.ts`:3/3 PASS
- `tests/integration/dispatcher-flow.test.ts`:7/7 PASS
- `tests/unit/skills/l1-worktree-governance.test.ts`:32/32 PASS
- **累加:137/137 PASS**
- `pnpm build`:3 subpackages + root + copy-templates 全 done
- `peaks audit red-lines --project .`:119 red lines / 52 cli-backed / 0 partial / 0 prose-only

## 关键 trade-off / 设计选择

- **Two authorization paths coexist, grant first** — `decideFromAuthorization`
  先跑,allow 就直接返回;lease 是 deny 时的 fallback。这意味着同时
  有 grant + lease 时 grant 赢(用户显式授权优先)。Lease 单独走的
  路径是 sub-agent 没人授权的场景。
- **`PEAKS_WORKTREE_LEASE_ID` 通过 env 而非 stdin** — sub-agent 进程
  在 LLM 环境里跑,不是 CLI 子进程;env 是 IDE / Claude Code 唯一
  可信传递的渠道。gate 严格 16-hex 校验防 env injection。
- **envelope 增量字段而不是 v3** — `isolation` / `leaseId` / `worktreePath` /
  `worktreeBranch` 都标 `null` 当未启用,旧消费者能继续解析。
  envelopeVersion 2.2.0 → 2.3.0 让消费者可选检测。
- **gc --dry-run 真 no-op** — `dryRun` 走 if-else 不调 `markGc` /
  `git worktree prune`,lease 文件 status 保持原样。e2e 验证了
  `stillReleased === 'released'`(非 'gc')。
- **renew 拒绝 released** — 用户能 mistake 想"激活" 一个旧 lease,
  实际上 lease 是 immutable object,新需求应该 spawn 新 lease。LEASE_NOT_RENEWABLE
  把这个心智模型硬编码到 CLI。

## 不变量(给后续 rids 用)

1. **Lease 是 source of truth(Part 1 规则)**:hook(Part 2.B)读 lease 文件而非 grant token;
   dispatch(Part 2.C)写 lease 文件;CLI(Part 2.A)维护 lease 文件。
2. **grant + lease 并存**:两个面向不同场景,任何 rid 既有 grant 也有 lease 都合法。
3. **路径布局固定**:`.peaks/_runtime/<sid>/worktree-leases/<id>.json` + `.peaks/_runtime/<sid>/worktrees/<id>/`。
4. **状态转移不可逆**:active → released/expired/gc;released/expired/gc 不可互转(除 gc 是 terminal)。
5. **PEAKS_WORKTREE_LEASE_ID 必须 16-hex** — gate 拒绝非 hex 注入。
6. **`--isolation` 只接 "worktree"** — 未来 mode(可能要 `container` / `vm`)
   走独立 flag,避免跟现有 dispatch envelope 冲突。

## 后续 rid(留给明天 / 下次)

- **CLI hint 引导 sub-agent 调 `peaks worktree release`** —
  Part 2.C 在 envelope 暴露了 `leaseId`,但没强制 sub-agent 收尾时
  release。考虑在 dispatch record + heartbeat status union 里加
  `lease-releasable` 状态。
- **Isolation auto-release on sub-agent finalization** —
  dispatch 拿到 "sub-agent done" 事件时自动 `peaks worktree release`,
  减少 zombie lease。当前依赖 sub-agent 自律 + gc 兜底。
- **worktree lease metrics** — peaks observability 收集
  `lease.spawn.count` / `lease.expired.count` / `lease.gc.swept` 指标。
- **non-Part-2.C isolation modes** — `--isolation container` /
  `--isolation vm` 是 L4 防线讨论中,跟 lease 平行存在。

## 关联 memory

- [[2026-07-29-worktree-l2-extended-part1]] — Part 1 (lease 基础 + spawn/release CLI)
- [[2026-07-29-worktree-l1-dispatch-block]] — L1 dispatch hardening
- [[2026-07-29-worktree-skills-md-shipped]] — SKILL.md governance chapter
- [[2026-07-29-worktree-layer3-deny]] — L3 superpowers jailbreak deny
- [[2026-07-27-worktree-user-auth-hard-gate]] — L2 grant token(本 rid 平行 surface)
