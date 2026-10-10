# 驾驶者解析与提交闸修复（S0）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `peaks-*` 提交闸依赖的"谁在开车"这个答案**可靠且作用域正确**，并让它在该答案不可得时的行为**显式且可辩护**。

**Architecture:** 三处病灶不在同一层，本计划**先用 Task 1 把三个事实钉死**，再按事实选修法——不预先假定 payload 里的 `session_id` 就是 lease 的 `callerId`。核心修法是把调用方身份**从 hook payload 取**（不依赖子进程的 env 继承，那条路评审明确未能核实），并让解析器的排序与 statusline 那条读取路径**对齐**，消除"同一个问题两个答案"。

**Tech Stack:** TypeScript / Node 24 / vitest / pnpm

**Spec:**
- `docs/superpowers/specs/2026-10-10-peaks-race-code-design.md` §8.2（硬前提）、§12 U11、§12 U4
- `docs/superpowers/specs/2026-10-10-session-handoff.md` **§2.2**（本条的证据与三个候选修法）

> 本 slice **独立于** `peaks-race-code`：它是既存 bug，可单独发布、单独验证。`peaks-race-code` 的 S2 **依赖**它，但它不依赖 race-code。

## Global Constraints

- **红规则**：任何 commit message **不得**含 `Co-Authored-By: Claude` / `Co-Authored-By: Anthropic` 或等价 AI 署名 trailer。SquabbyZ（`601709253@qq.com`）是唯一作者。由 `tests/unit/standards/no-ai-co-author-trailer.test.ts` 在 `pnpm test:unit` 与 CI 的 `commit-message-red-line` job 上强制。
- **gated ceiling 只降不升**：改 `src/**` 会移动棘轮。推送前 `.husky/peaks-gate.mjs` 会检查 `eslintFindings` / `eslintErrors` / `fileSizeOverCap` / `fileSizeExcessLines`。**本 slice 不得让任何 ceiling 上升。**
- **不得**在 `.peaks/` 顶层创建日期前缀目录（`.gitignore` 规则 + `tests/unit/workspace/top-level-change-id-guard.test.ts` 双重强制）。
- **平台**：宿主是 Windows。遍历文件用 `fs.readdirSync`，**不要**用 shell `find`（`tests/unit/skills/loop-hygiene-block.test.ts` 的注释记着这个坑）。
- **测试运行**：默认 `pnpm test:unit`（vitest）。**`tests/integration/**` 不在默认配置里**，本地与推送门都不覆盖它，只有 CI 跑——所以本 slice 的新测试**一律放 `tests/unit/`**。
- 提交用 conventional commits（`fix(gate): …`）。

## Review Focus

以下输入/状态**没有任何 spec 章节或现有测试覆盖**，而它们是 S0 最可能踩到活人的地方。每一项在拥有该代码的任务里各配一条测试。

1. **装了 gate 的仓库里一个普通的、非 peaks 的会话执行 `git commit`** —— 必须**不**被拦。这是"解析失败就 fail-closed"最可能的灾难性误伤。
2. **两个会话绑定到同一个 project session**（评审已确认这种 lease 可以共存）—— 解析必须**不**取到对方的 skill。
3. **一个留在 `status: "preparing"` 的 lease**（盘上真实存在）—— 不得被当成无限期"在飞"。
4. **`PEAKS_ACTIVE_SKILL` 环境变量**（`active-skill-resolver.ts:69-72`）—— 它是**未认证的覆盖**：设成非 `peaks-` 前缀即可让提交闸整个跳过。**本计划不改它，但必须在 Task 1 记录其存在**，否则它是修完之后仍然敞着的门。
5. **hook 子进程拿不到任何调用方身份** —— 不得让提交闸静默失效（今天的行为）。

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/services/audit/enforcers/active-skill-resolver.ts` | 解析"谁在开车"；排序与 `callerId` 作用域 | Modify |
| `src/services/skills/presence-lease-service.ts` | `listPresenceLeases` 的返回顺序 | Modify（若 Task 1 判定需要在源头排序） |
| `src/cli/commands/hook-handle.ts` | 提交闸的调用点；payload → callerId 的接线 | Modify |
| `src/services/audit/enforcers/code-ban.ts` | 提交闸的判定（纯函数） | Modify（失败方向） |
| `tests/unit/services/audit/active-skill-resolver.test.ts` | 解析器的作用域与排序契约 | **Create** |

---

### Task 1: 钉死三个事实（**不写产品代码**）

> 本任务的存在理由：计划其余部分依赖三个当前**未核实**的前提。把它们钉死之前不对任何修法编程——评审明确说过 `resolveCallerProjection` 需要的调用方身份"it did not verify whether the hook subprocess reliably receives"。

**Files:**
- Create: `.peaks/_runtime/<sessionId>/s0/facts.md`（**gitignored**，不是交付物）
- Read: `src/cli/commands/hook-handle.ts`、`src/services/session/resolve-caller-id.ts`、`src/services/skills/presence-lease-service.ts`

**Interfaces:**
- Produces: 三个**是/否**答案，决定 Task 2 走哪条分支。

- [ ] **Step 1: 事实 A —— payload 里有没有 `session_id`？**

Claude Code 的 PreToolUse payload 由 `parseClaudeShapeStdin`（`hook-handle.ts`）解析。读该解析器与 `buildCanonicalHook`，确认 `rawPayload` 是否保留 `session_id`，以及 `parseClaudeShapeStdin` 是否**丢弃**它。

写进 `facts.md`：**保留 / 丢弃 / 不存在**，附 `file:line`。

- [ ] **Step 2: 事实 B —— 它等不等于 lease 的 `callerId`？**

盘上有真实对照物：`.peaks/_runtime/<sessionId>/leases/presence-<callerId>-wf-<callerId>-compat.json`。同时用 `peaks skill presence --json` 读当前 `outerSessionId`。

若 A 为"保留"，则在本机**实测一次**：打印 hook payload 的 `session_id`，与 `leases/` 下的文件名段比对。

写进 `facts.md`：**相等 / 不相等 / 无法实测**。**这是分支点**：
- **相等** ⇒ Task 2 走 **(a′) payload 路线**（主路线）。
- **不相等或无法实测** ⇒ Task 2 降级为 **(b) 仅排序路线**，且必须在计划里记下"callerId 作用域未能实现"。

- [ ] **Step 3: 事实 C —— 盘上的 `lastHeartbeat` 会不会前进？**

`skill-presence-service.ts:701-721` 的 `touchSkillHeartbeat` 只改内存就返回，注释称心跳刷新"now lives exclusively in `presence-lease-service.setPresenceLease`"。查 `setPresenceLease` 的**调用点**，判断是否存在周期性调用（statusline / 每轮 probe）。

写进 `facts.md`：**有周期调用（心跳会前进）/ 无（心跳恒等于 `startedAt`）**。

- [ ] **Step 4: 顺带记录 —— `PEAKS_ACTIVE_SKILL` 覆盖**

记下 `active-skill-resolver.ts:69-72` 是**未认证覆盖**：设成非 `peaks-` 前缀即可跳过提交闸。**本计划不修它**，但这条要留在 `facts.md`，否则它是修完之后仍然敞着的门（→ 见本计划末尾"本 slice 之外"）。

- [ ] **Step 5: 把三个答案贴给用户，取得分支确认**

**本任务不提交任何东西**（`facts.md` 在 gitignored 目录下）。它是一个检查点，不是交付物。

> **任务边界**：Task 1 的唯一产出是"事实 + 分支选择"。它**不**改代码，因此没有测试——这符合本仓库对"未验证前提"的一贯处理。

---

### Task 2: 把调用方身份接进解析（作用域正确）

**Files:**
- Modify: `src/cli/commands/hook-handle.ts`（`:131` 的调用点）
- Test: `tests/unit/services/audit/active-skill-resolver.test.ts`

**Interfaces:**
- Consumes: `resolveActiveSkillForCaller(projectRoot: string, opts?: { legacyPresence?: boolean; callerId?: string | null }): ActiveSkillResolution`（`active-skill-resolver.ts:67-70`）——**签名已存在，`callerId` 过滤已实现**（`:122-127`），只是没人传。
- Produces: `hook-handle.ts` 在调用处传入**从 payload 取到的** callerId（若事实 B 为"相等"）。

- [ ] **Step 1: 写失败测试 —— 作用域**

```ts
// tests/unit/services/audit/active-skill-resolver.test.ts
it('只返回 callerId 匹配的 lease，不返回同一 session 下别的 caller 的 skill', () => {
  // 夹具：同一 session 目录下两个 lease —— callerA=peaks-code, callerB=peaks-race-code
  const r = resolveActiveSkillForCaller(projectRoot, { callerId: 'callerB' });
  expect(r.skill).toBe('peaks-race-code');
});
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `pnpm vitest run tests/unit/services/audit/active-skill-resolver.test.ts`
Expected: FAIL —— 夹具不存在（新文件），且当前实现在不传 `callerId` 时按目录顺序取第一个。

- [ ] **Step 3: 建夹具并让断言通过**

夹具须**建在临时目录**的真实 lease 文件上（`.peaks/_runtime/<sessionId>/leases/presence-*.json`），不要 mock `listPresenceLeases`——本条的病灶正是真实目录顺序。

- [ ] **Step 4: 跑测试，确认通过**

Run: `pnpm vitest run tests/unit/services/audit/active-skill-resolver.test.ts`
Expected: PASS

- [ ] **Step 5: 在 `hook-handle.ts:131` 接线**

若事实 B = **相等**：从 `rawPayload` 取 `session_id`，作为 `opts.callerId` 传入。
若事实 B = **不相等/无法实测**：**跳过本步**，在 `:131` 加一行注释说明"callerId 作用域未能实现，原因见 S0 计划 Task 1 事实 B"，并**停下汇报**——不要用 env 猜测代替。

- [ ] **Step 6: 覆盖 Review Focus #2（两个会话绑同一 project session）**

```ts
it('两个 caller 绑同一 project session 时，解析不串到对方', () => {
  expect(resolveActiveSkillForCaller(projectRoot, { callerId: 'callerA' }).skill).toBe('peaks-code');
  expect(resolveActiveSkillForCaller(projectRoot, { callerId: 'callerB' }).skill).toBe('peaks-race-code');
});
```

Run: `pnpm vitest run tests/unit/services/audit/active-skill-resolver.test.ts` → 两条都 PASS。

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/hook-handle.ts tests/unit/services/audit/active-skill-resolver.test.ts
git commit -m "fix(gate): scope the driver resolution to the calling session"
```

---

### Task 3: 让两条读取路径给出同一个答案（排序对齐）

> 现状：`resolveActiveSkillForCaller`（`active-skill-resolver.ts:116-130`）取遍历中**第一个**合格 lease；而 `skill-presence-service.ts:198` 按 `lastHeartbeat` 降序取 `[0]`。**同一个问题两个答案。** 本任务消除这个不一致。

**Files:**
- Modify: `src/services/audit/enforcers/active-skill-resolver.ts`
- Test: `tests/unit/services/audit/active-skill-resolver.test.ts`

**Interfaces:**
- Consumes: Task 1 的事实 C。
- Produces: 无 callerId 可匹配时，解析按**最新 `lastHeartbeat`** 取胜者（与 `skill-presence-service.ts:198` **同一规则**）。

> **自审修正**：本任务原先把断言写成"与 `getSkillPresence` 结果相等"。那不稳——`getSkillPresence` 还带 session 轮换与陈旧清理，两者可能因**别的原因**合法地不同，用它当断言会把无关差异变成假红。**断言钉的是规则本身**，"与另一读者一致"只作**交叉核对**（Step 3），且不一致时应当**汇报分歧**而不是强行拉平。

- [ ] **Step 1: 写失败测试 —— 无 callerId 时取最新心跳**

```ts
it('无 callerId 可匹配时，取 lastHeartbeat 最新的那条 lease', () => {
  // 夹具故意让两种顺序相反：
  //   leaseA: skill=peaks-code,      lastHeartbeat 旧, 目录序在前
  //   leaseB: skill=peaks-race-code, lastHeartbeat 新, 目录序在后
  expect(resolveActiveSkillForCaller(projectRoot).skill).toBe('peaks-race-code');
});
```

- [ ] **Step 2: 跑测试，确认它失败**

Run: `pnpm vitest run tests/unit/services/audit/active-skill-resolver.test.ts`
Expected: FAIL —— 当前实现按**目录顺序**取第一个，会返回 `peaks-code`。**若它直接 PASS，说明夹具没造出两种顺序的分歧——那本身就是发现，先修夹具再继续。**

- [ ] **Step 3: 让解析器按 `lastHeartbeat` 降序选**

在 `active-skill-resolver.ts` 遍历前对齐排序（或改由 `listPresenceLeases` 源头排序——**二选一，不要两处都排**）。排序**必须与** `skill-presence-service.ts:198` **同一比较函数**；若两处各写一份，就是本仓库 §4.1 反复反对的那种重复。

- [ ] **Step 4: 跑测试，确认通过**

Run: `pnpm vitest run tests/unit/services/audit/active-skill-resolver.test.ts`
Expected: PASS

- [ ] **Step 4b: 交叉核对（**不是断言**）—— 与 statusline 那条读取路径比对**

`getSkillPresence(projectRoot)`（`skill-presence-service.ts:489`，导出）走的是 `:198` 那条规则。在 Step 1 的夹具上手动比对两者取到的 lease：

- **一致** ⇒ 记一行结果即可。
- **不一致** ⇒ **停下来汇报分歧**，不要把断言改成"相等"来强行拉平。两者**可能因合法原因**不同（`getSkillPresence` 还带 session 轮换与陈旧清理）。本任务的契约是"规则对齐"，不是"两个函数恒等"。

- [ ] **Step 5: 覆盖 Review Focus #3（`preparing` 的 lease）**

```ts
it('一个长期 status=preparing 的 lease 不会被当成比 running 的更新', () => {
  // 夹具：preparing + lastHeartbeat 陈旧；running + lastHeartbeat 新
  expect(resolveActiveSkillForCaller(projectRoot).skill).toBe(<running 那条的 skill>);
});
```

Run: 同上 → PASS

- [ ] **Step 6: 若事实 C = 无周期调用，追加一条注释（不修）**

在排序处加注释：*本排序在 `touchSkillHeartbeat` 只写内存（`skill-presence-service.ts:701-721`）且无周期 `setPresenceLease` 调用时，退化为按 `startedAt` 排序；修复心跳写入在本 slice 之外。* **不要顺手修 `touchSkillHeartbeat`**——它影响 statusline 的新鲜度语义，属另一个 slice。

- [ ] **Step 7: Commit**

```bash
git add src/services/audit/enforcers/active-skill-resolver.ts tests/unit/services/audit/active-skill-resolver.test.ts
git commit -m "fix(gate): make the driver resolver agree with the statusline reader"
```

---

### Task 4: 提交闸在"答案不可得"时的行为显式化

> **这是本 slice 唯一的用户级决定。** 计划按**推荐项**写；若用户选另一条，改 Step 3。

**决定：解析不出身份时怎么办？**

| | 行为 | 评 |
|---|---|---|
| 今天 | **整个跳过**（`hook-handle.ts:132` 的 `if (activeSkill.skill !== null)`）——即 fail-open | 静默失效；评审的"新泳道还是新洞"正指这里 |
| 评审 / audit 建议 | fail-**closed** | **灾难性误伤**：`resolveActiveSkillForCaller` 对**任何未绑定 session** 都返回 null，于是**装了 gate 的仓库里每个普通会话都提交不了** |
| **推荐** | **按 session 里有没有 `peaks-*` lease 分岔**：有 peaks lease 但认不出调用方 ⇒ **拦**；完全没有 peaks lease ⇒ **放行** | 既安全又不误伤：只有"peaks 在场但不确定是不是你"才拦 |

**Files:**
- Modify: `src/services/audit/enforcers/code-ban.ts`（判定）
- Modify: `src/cli/commands/hook-handle.ts:131-140`（调用点）
- Test: `tests/unit/services/audit/code-ban.test.ts`（**Create**，若无）

**Interfaces:**
- Consumes: `ActiveSkillResolution { skill, callerId, sessionId, mode, source }`（`active-skill-resolver.ts:40-`）
- Produces: `evaluateCodeBan({ skill, command, peaksLeasePresent }): CodeBanResult`（在现有入参上**新增一个**字段；`isCodeCommit(skill, command)` 保持不变）

- [ ] **Step 1: 写失败测试 —— 三条分支各一条**

```ts
it('session 里有 peaks lease 但认不出调用方 ⇒ 拦', () => {
  expect(evaluateCodeBan({ skill: null, command: 'git commit -m x', peaksLeasePresent: true }).denied).toBe(true);
});
it('完全没有 peaks lease ⇒ 放行（普通会话不被误伤）', () => {
  expect(evaluateCodeBan({ skill: null, command: 'git commit -m x', peaksLeasePresent: false }).denied).toBe(false);
});
it('认得出是 peaks-code ⇒ 仍拦（不得因本次改动放宽）', () => {
  expect(evaluateCodeBan({ skill: 'peaks-code', command: 'git commit -m x', peaksLeasePresent: true }).denied).toBe(true);
});
```

- [ ] **Step 2: 跑测试，确认三条里至少两条失败**

Run: `pnpm vitest run tests/unit/services/audit/code-ban.test.ts`
Expected: FAIL —— 现签名没有 `peaksLeasePresent`。

- [ ] **Step 3: 实现**

`evaluateCodeBan` 加 `peaksLeasePresent: boolean` 入参；`skill === null && peaksLeasePresent` ⇒ `denied: true`，reason 明说"无法确认调用方，而本 session 有 peaks skill 在场"。调用点 `hook-handle.ts` 用 `listPresenceLeases` 判断是否存在 `peaks-` 前缀的 `skill`，**不要**复用解析结果（它正是不可靠的那个）。

- [ ] **Step 4: 跑测试，确认通过**

Run: `pnpm vitest run tests/unit/services/audit/code-ban.test.ts`
Expected: PASS（三条）

- [ ] **Step 5: 覆盖 Review Focus #1（**最重要的一条**）**

```ts
it('装了 gate 的仓库里，非 peaks 会话的 git commit 不被拦', () => {
  // 夹具：session 目录存在、无任何 peaks lease、解析返回 skill=null
  expect(evaluateCodeBan({ skill: null, command: 'git commit -m x', peaksLeasePresent: false }).denied).toBe(false);
});
```

Run: 同上 → PASS

- [ ] **Step 6: 覆盖 Review Focus #5（拿不到身份）**

断言该情形**不静默**：`denied` 为 true 时 reason 必须非空，且**包含可执行的下一步**（去向 `peaks request transition` 或说明如何绑定 session）。

- [ ] **Step 7: 跑受影响的既有测试**

Run: `pnpm vitest run tests/unit/services/audit/ tests/unit/services/hooks/`
Expected: 全绿。**`tests/unit/services/audit/enforcer-liveness.test.ts` 若变红，先读它再改**——它可能正钉着今天的行为，而那正是本任务要改的东西。

- [ ] **Step 8: Commit**

```bash
git add src/services/audit/enforcers/code-ban.ts src/cli/commands/hook-handle.ts tests/unit/services/audit/code-ban.test.ts
git commit -m "fix(gate): decide the commit ban when the driver cannot be resolved"
```

---

### Task 5: 收口验证

**Files:** 无（只跑命令）

- [ ] **Step 1: 全量单测**

Run: `pnpm test:unit > /tmp/s0-unit.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`。**注意**：不要 `| tail`——那会拿到 `tail` 的退出码并丢掉失败文件名，重定向到文件再读 `$?`。

- [ ] **Step 2: 红规则**

Run: `pnpm vitest run tests/unit/standards/no-ai-co-author-trailer.test.ts`
Expected: PASS

- [ ] **Step 3: 全仓门（ceiling 只降不升）**

Run: `node .husky/peaks-gate.mjs repo`
Expected: 全部 ceiling **held**（不得上升）

- [ ] **Step 4: 推送前跑一遍推送门限**

Run: `node .husky/peaks-gate.mjs pre-push`
Expected: 通过。**Windows 宿主已知可跑**（Developer Mode 已开、npx-resolver bug 已修），所以红灯是真信号，不要当环境噪声绕过。

---

## 本 slice 之外（**记下，不做**）

| 项 | 为什么不在本 slice |
|---|---|
| `PEAKS_ACTIVE_SKILL` 是未认证覆盖（`active-skill-resolver.ts:69-72`） | 它是**测试缝**，改它要么引入认证、要么删缝；两者都超出"修解析"的范围。Task 1 Step 4 已记录 |
| `touchSkillHeartbeat` 只写内存（`skill-presence-service.ts:701-721`） | 影响 statusline 的**新鲜度语义**，不只影响本闸 |
| `.sh` 兄弟实现（`pre-tool-code-gate.sh`）的泳道漂移 | 属 `peaks-race-code` S2（spec §10.1） |
| `metrics/slices.jsonl` 缺 `sliceRid` | 属 `peaks-race-code` S3 |
