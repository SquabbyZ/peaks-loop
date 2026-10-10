# 快泳道本体（S2）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `peaks-race-code` 真实存在——一个允许**当前窗口直接编辑源码**的兄弟 skill，由一个自报事实（解析出的驾驶者）开门，并自带完成证明、风险面与单向升级。

**Architecture:** 判定的**唯一输入**是"解析出的驾驶者是不是 `peaks-race-code`"（spec §8.2）。判定是**纯函数**（`decideGateAction` 的可选第三参），解析在**命令层**（`code-gate-command.ts` 从 hook payload 取身份，与技术 S0 已为 `hook-handle` 建立的同一套）。skill 的散文部分**引用** `fast-lane-norm.md` 而不重述（S1 已建）。

**Tech Stack:** TypeScript / Commander / vitest / Markdown（skills）。

**Spec:** `docs/superpowers/specs/2026-10-10-peaks-race-code-design.md` — §8.1/§8.2（一个输入）、§8.3（fail-closed）、§5（完成证明）、§6（升级）、§7（痕迹）、§3（路由）、§10（T1–T11）、§12（U1/U2 未决）。**S1 的产物**：`skills/peaks-code/references/fast-lane-norm.md`。

## Global Constraints

- **新增/重命名文件后：先 `git add`，再重生成门基线。** 普查读 `git ls-files`，未跟踪文件对它不可见——2026-10-10 实测：未暂存时 `peaks-gate.mjs repo` 会打印 `all whole-repo ceilings held`（ceiling 是计数，缺文件不移动计数），而 `file-size-cap.test.ts` / `scope-shadow-coverage.test.ts` 是红的。**重生成之后必须跑 `pnpm test:unit`。**
- **跑测试永远重定向到文件再读 `$?`，绝不 `| grep`/`| tail`。** 仓库有 hook 强制这条（`pre-tool-piping-a-test-run-reports-the-pipes-exit-code.sh`）。
- **gated ceiling 只降不升**：`tscErrors` / `commentNarrativeLines` / `fileSizeOverCap` / `fileSizeExcessLines`。
- **注释不得含过程叙事**（"S2 Task 3"、plan 文件名、日期）——`commentNarrativeLines` 会数它。**写约束，不写过程。**
- **红规则**：commit message 不得含 AI 署名 trailer。**本 slice 不改这条的任何机制**（U14 已裁决：不接提交闸），只是 SKILL.md 里如实写它。
- **`skills/peaks-race-code/SKILL.md` 必须携带与其余 skill 逐字节相同的 loop-hygiene 块**（`tests/unit/skills/loop-hygiene-block.test.ts` 遍历文件系统，漏了自己会红）。
- **不得**把 `peaks-race-code` 做成 peaks-code 的 mode；不得改 peaks-code 的 Gate A–G / 11 步工序。
- 平台是 Windows；遍历文件用 `fs.readdirSync`，不要 shell `find`。

## Review Focus

spec 隐含、但没有哪条任务的测试会覆盖、而最可能咬人的输入：

1. **装了 gate 的仓库里，一个非 peaks 的会话编辑 `src/`** —— 不得被新逻辑挡住。这是 S0 Rev Focus #1 在**编辑**面上的同一风险，而本 slice 第一次让 gate 的判定依赖一个**解析结果**。
2. **解析失败 / payload 无身份**时，gate 的默认必须仍是**今天的行为**（deny `src/**`）——不得因为加了第三参而意外放行。
3. **`peaks-audit` 被绕过**（用户直接开 `/peaks-code`）——此时泳道问题不该问（pilot 前按 §3.2 的阶段表：已指定 skill 就不问）。
4. **`.sh` 兄弟**（`src/services/hooks/pre-tool-code-gate.sh`）不认驾驶者 ⇒ 两条闸对同一路径给出不同判定。
5. **新 SKILL.md 的 loop-hygiene 块**漏掉或改了字节。
6. **`SKILL_NAMES`**（`src/services/skills/skill-conformance-service.ts:46`，硬编码 13 个）不含新 skill ⇒ conformance 审计看不见它。

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/cli/commands/code-gate-command.ts` | 解析驾驶者并传给纯函数 | Modify |
| `src/services/hooks/pre-tool-code-gate.ts` | `decideGateAction` 加**可选**第三参（默认 fail-closed） | Modify |
| `src/services/skills/hook-command-by-ide.ts`…（现行在 `hooks-codegate-superpowers.ts`） | 若 Task 1 决定加 `--project`，同步 entry 文本 | Modify（条件性） |
| `skills/peaks-race-code/SKILL.md` | 泳道本体 | **Create** |
| `src/services/skills/skill-conformance-service.ts` | `SKILL_NAMES` 加一项 | Modify |
| `skills/peaks-audit/SKILL.md` | 泳道路由问句 | Modify |
| `src/services/hooks/pre-tool-code-gate.sh` | `.sh` 兄弟的处置 | Modify 或**声明不动** |
| `tests/unit/services/hooks/code-gate.test.ts` | T1/T3/T4 + 默认分支 | Modify |
| `tests/unit/hooks/code-gate-driver.test.ts` | T2/T8/T9（解析层） | **Create** |
| `tests/unit/skills/loop-hygiene-block.test.ts` | 自动覆盖新 skill | **不改**（遍历 FS） |

---

### Task 1: U1 —— `peaks code-gate` 的 projectRoot 从哪来（**先决定，再写码**）

> **本任务不写产品代码。** 判定需要 projectRoot（去读该 session 的 lease），而 `peaks code-gate` **只有 `--dry-run`，没有 `--project`**。在决定之前不动 `decideGateAction`——否则后面所有 gate 代码建在一个没定的前提上。

**Files:** Read `src/cli/commands/code-gate-command.ts`、`src/services/skills/hooks-codegate-superpowers.ts`、`src/services/hooks/pre-tool-code-gate.sh`

**Interfaces:**
- Produces: 一个**决定**（cwd vs 新增 `--project`），决定 Task 2/3 的形状。

- [ ] **Step 1: 看 `.sh` 兄弟怎么拿 projectRoot**

Run: `grep -n "project\|cwd\|pwd" src/services/hooks/pre-tool-code-gate.sh | head -20`
Expected: 列出它依赖什么。**若它假定 cwd = project root，那是本仓库对这条 entry 的既有约定。**

- [ ] **Step 2: 看 entry 文本实际怎么写的**

Run: `grep -n "code-gate" src/services/skills/hooks-codegate-superpowers.ts`
Expected: 找到注册的那一行（`peaks code-gate --json` 之类）。**若它没传 `--project` 而 `gate enforce` 那条传了 `--project "${CLAUDE_PROJECT_DIR}"`，那是一处不一致，写下来。**

- [ ] **Step 3: 裁决并记录**

三选一，写进 ledger 的 Ruling：
- **(a) 依赖 cwd**（与 `.sh` 一致，零改动）——**前提是 hook 的 cwd 确实是 project root**。若无法验证，明确写"未验证"。
- **(b) 新增 `--project` 并同步 entry 文本**——最显式，但要改安装器的 entry 表。
- **(c) 由 payload 推断**——Claude 的 hook payload 带 `cwd` 字段的话可用；**先确认它有没有**。

> **本仓库的既有先例**：`gate enforce` 那条 entry **显式传** `--project "${CLAUDE_PROJECT_DIR}"`（`hooks-codegate-superpowers.ts`）。**如果 code-gate 那条没传，那它是这两条里更脆的一条**——这一点本身可能就是答案。

- [ ] **Step 4: 把决定写进 ledger，向用户报告**

**不提交**（无产品代码）。

---

### Task 2: 判定层 —— `decideGateAction` 的可选第三参（T1 / T3 / T4）

**Files:**
- Modify: `src/services/hooks/pre-tool-code-gate.ts`
- Test: `tests/unit/services/hooks/code-gate.test.ts`（**追加**，不动既有 18 个调用点）

**Interfaces:**
- Consumes: Task 1 的决定。
- Produces: `decideGateAction(tool: GateToolName, input: Record<string, unknown>, driver?: string | null): GateVerdict` —— **第三参可选**；**未传或为 null ⇒ 与今天逐字节相同的行为**（硬阻断族 deny）。

- [ ] **Step 1: 写失败测试 —— 默认分支不得变**

```ts
it('with no driver supplied, a hard-blocked path is still denied', () => {
  // The 18 existing call sites pass two arguments. Their behaviour may not change.
  expect(decideGateAction('Edit', { file_path: 'src/x.ts' }).action).toBe('deny');
});
```

- [ ] **Step 2: 跑，确认它失败**

Run: `pnpm vitest run tests/unit/services/hooks/code-gate.test.ts > /tmp/t2.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t2.log`
Expected: **FAIL** —— 第三参不存在，多传的参数被忽略；关键是**这条测试在实现前就该红**（若它直接绿，说明默认行为已经正确——那记录下来，它仍是必须保留的回归守卫）。

- [ ] **Step 3: 写另外两条 —— 放行只在驾驶者是 race 时发生**

```ts
it('allows a hard-blocked path when the driver is peaks-race-code', () => {
  expect(decideGateAction('Edit', { file_path: 'src/x.ts' }, 'peaks-race-code').action).toBe('allow');
});

it('still denies when the driver is peaks-code', () => {
  expect(decideGateAction('Edit', { file_path: 'src/x.ts' }, 'peaks-code').action).toBe('deny');
});
```

- [ ] **Step 4: 跑，确认三条的关系正确（两条红或全红）**

- [ ] **Step 5: 实现**

加可选第三参；**仅在** `driver === 'peaks-race-code'` 时对硬阻断族放行。白名单短路**保持不变且仍在最前**（T4）。

- [ ] **Step 6: 跑，确认全绿，且既有 18 个调用点的断言未改一字**

Run: `pnpm vitest run tests/unit/services/hooks/code-gate.test.ts > /tmp/t2b.log 2>&1; echo "EXIT=$?"`

- [ ] **Step 7: 覆盖 Review Focus #1**

```ts
it('an ordinary session with no driver is not newly blocked on a non-family path', () => {
  expect(decideGateAction('Edit', { file_path: 'src/../README.md' }).action).toBe(...);
});
```
（按实际路径族语义写；**目的是证明"加第三参"没有把非硬阻断路径误伤。**）

- [ ] **Step 8: Commit**

---

### Task 3: 命令层 —— `code-gate` 解析驾驶者并传入（T2 / T8 / T9）

**Files:**
- Modify: `src/cli/commands/code-gate-command.ts`
- Test: `tests/unit/hooks/code-gate-driver.test.ts`（**Create**）

**Interfaces:**
- Consumes: Task 2 的第三参；S0 的 `resolveActiveSkillForCaller(projectRoot, { callerId })` 与 `hasLeaseForCaller`（`src/services/audit/enforcers/active-skill-resolver.ts`）。
- Produces: `peaks code-gate` 在编辑类工具上按驾驶者判定。

- [ ] **Step 1: 写解析层测试（三条）**

用**真实 lease 文件**建夹具（照 S0 `tests/unit/hooks/commit-ban-caller-scope.test.ts` 的做法：`setPresenceLease` + `mkdtemp`）：

| # | 场景 | 断言 |
|---|---|---|
| T2 | payload 无 `session_id`/`caller_id`，而 peaks lease 在场 | **必须 deny**（fail-closed 默认） |
| T8 | 驾驶者报 `peaks-race-code` 但该 caller **不拥有** lease | **必须 deny**（S0 的保守路径） |
| T9 | 驾驶者 = `peaks-race-code`（拥有 lease） | **必须 allow** |

- [ ] **Step 2: 跑，确认 T9 红（放行尚未接线）**

- [ ] **Step 3: 实现**

`code-gate-command.ts` 在调用 `decideGateAction` 前：从 `parsed` 取 `caller_id ?? session_id`（`GateInput` **不声明**这两个字段，但 `parsed` 是完整 JSON——**与 S0 对 `hook-handle` 的处理同一技术**）；projectRoot 按 Task 1 的决定拿；解析出的驾驶者作第三参传入。

- [ ] **Step 4: 跑，确认三条全绿**

- [ ] **Step 5: 覆盖 Review Focus #2 —— 默认不得变**

断言：**解析失败 / 无身份 ⇒ 硬阻断族仍然 deny**（与 Task 2 的默认分支一致，但这条走的是**命令层**，所以两条都要有）。

- [ ] **Step 6: 跑受影响域 + Commit**

Run: `pnpm vitest run tests/unit/services/hooks/ tests/unit/hooks/ tests/unit/cli/ > /tmp/t3.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t3.log`

---

### Task 4: `skills/peaks-race-code/SKILL.md` + `SKILL_NAMES`

**Files:**
- Create: `skills/peaks-race-code/SKILL.md`
- Modify: `src/services/skills/skill-conformance-service.ts`（`SKILL_NAMES`）

**Interfaces:**
- Consumes: `skills/peaks-code/references/fast-lane-norm.md`（S1，**相对路径引用**：`../peaks-code/references/fast-lane-norm.md`）。
- Produces: 载体本身；S2 其余任务都靠它。

- [ ] **Step 1: 建文件，带逐字节相同的 loop-hygiene 块**

**直接从任一既有 SKILL.md 复制那块**（`<!-- peaks:loop-hygiene` 到 `<!-- /peaks:loop-hygiene -->`），**一个字节都不要改**。

- [ ] **Step 2: 写正文 —— 逐节清单**

| 节 | 内容 | 必须精确的点 |
|---|---|---|
| 定位 | 它是**泳道**，不是 peaks-code 的 mode | 三档表指针 → spec §2.5；**说明它是第三档** |
| 门 | 直接编辑源码**由一个自报事实**开门 | `driver === peaks-race-code`；**明说这是纪律门、不是安全边界**（§9） |
| 完成证明 | 四条 | **#1/#2 指向 `fast-lane-norm.md`（不重述）**；**#3 明写"只有事后检测，没有事前拦截"**（U14 裁决）；#4 可回退单元 |
| 风险面 | **指向** `fast-lane-norm.md`，不重述（T11 的 §4.4 规则） | — |
| 升级 | 单向——**对 LLM**；用户可覆盖并记一笔；**按任务不按 session** | §6.3 的三条限定 |
| 痕迹 | `.peaks/_runtime/<sessionId>/race/<rid>.md`；memory 只在画动风险边界或踩新坑时沉淀 | §7 |
| 不写文书 | 零子代理、零 Gate A–G、零 transition、零规划文书 | §4.1 |

- [ ] **Step 3: 加进 `SKILL_NAMES`**

`src/services/skills/skill-conformance-service.ts` 的硬编码数组加 `'peaks-race-code'`。

- [ ] **Step 4: 跑两个自动守卫**

Run: `pnpm vitest run tests/unit/skills/ tests/unit/standards/doc-command-claims.test.ts tests/unit/standards/repo-citation-integrity.test.ts > /tmp/t4.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/t4.log`
Expected: loop-hygiene 那条**自动覆盖新 skill**；`doc-command-claims` 检查 SKILL.md 里 `peaks <cmd>` 的声称都存在。

- [ ] **Step 5: 覆盖 Review Focus #5（loop-hygiene 字节）**

Run: `pnpm vitest run tests/unit/skills/loop-hygiene-block.test.ts > /tmp/t4b.log 2>&1; echo "EXIT=$?"`
Expected: PASS。**若红，回去把块逐字节对齐，不要改测试。**

- [ ] **Step 6b: 扩展 T11 —— 把第二个消费者加进唯一性守卫**

S1 的 `tests/unit/standards/fast-lane-norm-single-source.test.ts` 现在只守 `skills/` 全树里门句**恰好一次**。**S2 是第二个消费者**，所以要**加一条断言**：新 SKILL.md **含指向 `fast-lane-norm.md` 的路径**，且**不含**那句验收门（即它引用而不重述）。

```ts
it('the race-code skill points at the norm and does not restate the gate', () => {
  const skill = readFileSync('skills/peaks-race-code/SKILL.md', 'utf8');
  expect(skill).toContain('fast-lane-norm.md');
  expect(skill).not.toContain(GATE);
});
```

Run: `pnpm vitest run tests/unit/standards/fast-lane-norm-single-source.test.ts > /tmp/t4c.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t4c.log`

- [ ] **Step 7: 先 `git add`，再重生成基线，再跑全量**

```bash
git add skills/peaks-race-code/SKILL.md tests/unit/standards/fast-lane-norm-single-source.test.ts
node .husky/peaks-gate-baseline.mjs
pnpm test:unit > /tmp/t4b.log 2>&1; echo "EXIT=$?"
```

- [ ] **Step 8: Commit**

---

### Task 5: `peaks-audit` 的泳道路由（§3）

**Files:**
- Modify: `skills/peaks-audit/SKILL.md`

**Interfaces:**
- Consumes: Task 4 的 skill 存在。
- Produces: 泳道问句落在**每个 peaks 工作流必经的入口**。

- [ ] **Step 1: 先确认入口可达性（Review Focus #3）**

Run: `grep -n "Precondition\|first step" skills/peaks-audit/SKILL.md | head -5`
Expected: 确认它的契约是"任何 peaks 工作流的第一步"——**这正是选它的理由**（§3.1）。若该契约已变，**停下回报**。

- [ ] **Step 2: 写路由段**

明确三条（§3.2 的表）：
1. 用户**未**指定 skill ⇒ 弹一次 `AskUserQuestion`，**无预选**；
2. 用户**已**指定 skill ⇒ 弹一次，**预选指定的那条**（一次回车即过）；
3. 同一 request 已答过 / 本 session 已锁定 ⇒ **不再问**。

**并且写明阶段表**（§3.2）：**pilot 通过之前 race-code 只能指名到达**（此阶段已指定 skill 时**不问**）；通过后才切到上面第 2 条。

- [ ] **Step 3: 跑受影响守卫 + Commit**

Run: `pnpm vitest run tests/unit/skills/ tests/unit/standards/ > /tmp/t5.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t5.log`

---

### Task 6: `.sh` 兄弟的处置（§10.1）

**Files:**
- Modify 或**声明不动**：`src/services/hooks/pre-tool-code-gate.sh`

**Interfaces:**
- Consumes: Task 2/3 的新判定。
- Produces: 两条闸不再对同一路径给出**不同且无人知道**的判定。

- [ ] **Step 1: 确认它现在会不会分岔**

Run: `grep -n "HARD_BLOCKED\|ALLOW_LIST\|project" src/services/hooks/pre-tool-code-gate.sh | head -12`
Expected: 确认它是否也判路径族。**若它不认驾驶者，它会对 race-code 也 deny。**

- [ ] **Step 2: 二选一，并记录**

- **(a) 同步改**：让 `.sh` 也读驾驶者。**但 shell 里解析 lease 是重活**，且它与 CLI 是两份实现（S1 刚在 §4.4 反对过这种重复）。
- **(b) 明确声明它不再承载泳道判定**，并**在测试里钉住这个差异**——这是**首选**：`.sh` 是给非 Node harness 的退化路径，让它保守 deny（即：它对 race-code 也拦），并在测试里写明"这是有意的，不是漂移"。

- [ ] **Step 3: 若选 (b)，加一条测试钉住差异**

```ts
it('the shell sibling does not know about lanes, and denies on purpose', () => { /* ... */ });
```

- [ ] **Step 4: Commit**

---

### Task 7: 收口（S2 的退出判据）

- [ ] **Step 1: T1–T5 / T8 / T9 / T11 全绿**

Run: `pnpm vitest run tests/unit/services/hooks/ tests/unit/hooks/ tests/unit/standards/ > /tmp/t7.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/t7.log`

> **⚠️ T6 / T7 / T10 不适用（本计划自审时更正）**：那三条是 spec §10.2 里**提交闸**的测试（trailer 拒/放、`peaks-code` 仍被拦、message 含 trailer ⇒ 拒）。它们属 **S0 的活**——S0 已交付并推送——而 **U14 已裁决不接提交闸**，所以 S2 **不得**实现它们。原稿写"T1–T11 全绿"是错的，照写会让人去实现一个已被明确否掉的机制。

- [ ] **Step 2: `fast-lane-norm.md` 仍然为真**

**逐条读规范并对着 S2 的实际行为核**：它说 race-code "没有独立 QA 窗口"、"单向升级到 peaks-code"。**S2 是第一个能证伪它的东西。** 若有不符，**改规范**（它是唯一来源）并说明。

- [ ] **Step 3: 全仓门 / 格式棘轮 / 红规则 / 推送门**

Run: `node .husky/peaks-gate.mjs repo` / `node .husky/format-check-ratchet.mjs` / `pnpm vitest run tests/unit/standards/no-ai-co-author-trailer.test.ts` / `node .husky/peaks-gate.mjs changed`
（**各自重定向到文件再读 `$?`。**）

- [ ] **Step 4: 全量单测**

Run: `pnpm test:unit > /tmp/t7full.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t7full.log`

---

## S2 的验收（对应 spec §13）

| 判据 | 怎么验 |
|---|---|
| **T1–T5 / T8 / T9 / T11 绿**（**T6 / T7 / T10 不适用**——那是 S0 的提交闸，且 U14 已裁决不接） | Task 2/3/4 + Task 7 Step 1 |
| §10.1 的文件改完 | Task 2/3/4 |
| `.sh` 差异有明确处置 | Task 6 |
| `fast-lane-norm.md` 仍然为真 | Task 7 Step 2 |
| U14 已关闭 | **已满足**（2026-10-10 裁决） |

## 本 slice 之外（**记下，不做**）

| 项 | 为什么 |
|---|---|
| 把提交闸接进 `gate enforce` | U14 已裁决**不接** |
| 加 `.husky/commit-msg` | 同上；且它推翻一条已记录的决定 |
| **U2 规模阈值** | 计划期未定 ⇒ 规范第 6 行仍标"不可执行"。**Task 4 必须在 SKILL.md 里如实指过去，不得假装它可用** |
| 时序指标埋点（S3） | 属 S3 |
| 修 `code-gate` 无 `--project` 的**其他**后果 | Task 1 只定这一个决定 |
