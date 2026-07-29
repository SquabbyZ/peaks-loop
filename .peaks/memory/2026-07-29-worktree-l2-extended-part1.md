---
name: 2026-07-29-worktree-l2-extended-part1
description: rid-L2-extended Part 1 ships lease store + peaks worktree spawn/release CLI; Part 2 covers renew/list/gc/status + hook integration + dispatch --isolation worktree; today explicitly stopped at lease foundation to avoid session drift.
metadata:
  type: project
  createdAt: 2026-07-29
  originSessionId: 2026-07-29-session-current
  severity: architecture
  relatedRid: 2026-07-29-worktree-l2-extended
---

# rid-L2-extended Part 1 — Lease foundation + spawn/release CLI — SHIPPED 2026-07-29

## 决策回顾

L2 防线(已 ship:`peaks worktree auth grant|revoke|status`)只给单次操作授权。
完整工作流需要生命周期管理:spawn → use → renew/release → gc。本 rid 是
**Part 1**(lease foundation + spawn/release CLI),Part 2 续做 renew/list/gc/status
+ hook lease-aware 集成 + dispatch `--isolation worktree`。

按 TTL by role 决策:rd=30m / qa=15m / ui=1h / sc=30m / prd=15m / general=30m;
用户 `--ttl <ms>` 可覆盖。Lease + grant 并存(grant 是 L2 hook 的现有 token,
lease 是新生命周期管理 — 两个面向不同场景,不互斥)。

## What shipped

- `src/services/worktree/worktree-lease.ts` — 纯函数 lease store
  - `generateLeaseId()` — 16 hex (8 random bytes)
  - `DEFAULT_TTL_BY_ROLE` + `ttlForRole(role)`
  - `leaseStoreDir` / `leaseFilePath` / `worktreePath` 路径派生
  - `finalizeLease` / `markReleased` / `markExpired` / `markGc` 状态转移(全部纯)
  - `recordConsumption` 子代理消费日志(幂等)
  - `isLeaseActive(lease, now?)` 时间窗 + 状态检查
  - `serializeLease` / `deserializeLease` JSON 往返 + malformed 输入校验
- `src/cli/commands/worktree-auth-commands.ts` — 新增 `peaks worktree spawn` 和
  `peaks worktree release` 命令(挂在既有 `peaks worktree` 父命令下,与 `auth` 子命令组平级)
  - `spawn --rid --role --purpose --ttl? --branch?` 写 lease + `git worktree add <path> -b <branch>`
  - `release --lease-id` 跑 `git worktree remove --force <path>` + 状态转移 released
  - 错误码:`SPAWN_FAILED` / `LEASE_FILE_INVALID` / `LEASE_NOT_FOUND` / `RELEASE_FAILED`
- `tests/unit/services/worktree/worktree-lease.test.ts` — 31 个 case,覆盖所有纯函数路径
- lease file layout:`<projectRoot>/.peaks/_runtime/<sessionId>/worktree-leases/<leaseId>.json`
- worktree layout:`<projectRoot>/.peaks/_runtime/<sessionId>/worktrees/<leaseId>/`

## 已知 gaps(Part 2 解决)

- **CLI command e2e test deferred** — spawn/release 的 envelope shape + execSync
  spy 测试需要 git fixture setUp,scope 警告触发时跳过。Part 2 与 renew/list/gc
  + hook 集成一起 ship 完整 e2e 测试。
- **renew / list / gc / status CLI 未 ship** — Part 2。
- **Hook 集成(lease-aware gate)未 ship** — `evaluateWorktreeAuth` 当前只看
  `peaks worktree auth grant` token,Part 2 让它也接受 lease id。
- **Dispatch `--isolation worktree` 未 ship** — Part 2。
- **Env var `PEAKS_WORKTREE_LEASE_ID` 注入未 ship** — Part 2(让子代理自我发现 lease id)。

## 验证

- `tests/unit/services/worktree/worktree-lease.test.ts`:31/31 PASS
- 累加回归测试:76/76 PASS(33 hooks-settings + 12 L1 + 31 lease + 3 memory hook)
- `pnpm exec tsc --noEmit -p tsconfig.json`:0 error on changed files
- `peaks audit red-lines --project .`:119 red lines / 52 cli-backed / 0 partial / 0 prose-only
- `pnpm build`:3 subpackages + root + copy-templates 全 done

## 关键 trade-off / 设计选择

- **TTL by role not by rid** — 简化心智模型;用户 override 足够灵活。
- **branch 默认从 rid 派生**(`rid-2026-07-29-foo` → `rid-2026-07-29-foo`)— 让大多数
  rid 直接工作;用户可 `--branch` 覆盖。
- **Path 前缀 `.peaks/_runtime/<sid>/worktrees/<leaseId>/`** — 用户原始 4 痛点之一
  `.claude/worktree` 路径不再用。
- **execSync 而非 spawn** — spawn/release 是 CLI 命令,要求同步结果给用户;child 进程
  异步只增加复杂度。
- **release 不跑 git prune** — lease 标记 released 即可,gc CLI(Part 2)是唯一
  prune 入口。

## 不变量(给后续 rids 用)

1. **Lease 是 source of truth**:hook 集成(Part 2)读 lease 文件而非 grant token。
2. **状态转移不可逆**:active → released/expired/gc;released/expired/gc 之间不可互转。
3. **路径布局固定**:`.peaks/_runtime/<sid>/worktree-leases/<id>.json` + `.peaks/_runtime/<sid>/worktrees/<id>/`。
4. **JSON schema 严格**:`deserializeLease` 校验所有 9 个必需字段;malformed 输入 throw,
   CLI 翻译为 `LEASE_FILE_INVALID`(never fails open)。

## 后续 rid(留给 Part 2 / 明天)

- **renew / list / gc / status CLI**(4 个新命令)
- **Hook lease-aware gate**:`evaluateWorktreeAuth` 接受 lease id
- **Dispatch `--isolation worktree`** 自动 spawn + 注入 `PEAKS_WORKTREE_LEASE_ID`
- **CLI e2e test**:`spawn → release` envelope + git worktree spy

## 关联 memory

- [[2026-07-29-worktree-layer3-deny]] — L3 Minimal Viable
- [[2026-07-29-worktree-skills-md-shipped]] — SKILL.md npm contract
- [[2026-07-29-worktree-l1-dispatch-block]] — L1 dispatch hardening
- [[2026-07-27-worktree-user-auth-hard-gate]] — L2 防线(grant token,本 rid 的 lease 并存)