# 快泳道规范单一来源（S1）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把"快泳道验收门 + 何时不该走快泳道"这两块散文收敛到**一份**规范文件，让 peaks-code 的 fast mode 与将来的 `peaks-race-code` 都指向它，而不是各写一份。

**Architecture:** 规范落在 `skills/peaks-code/references/`（随 npm 包发、在安装器覆盖范围内）；`fast-mode.md` 改为指向它并删掉重述。一个测试钉住"指向存在 **且** 没有第二份"——判据是 §4.4 的那条：**两处文字若不能逐字相同，就不该抽**。

**Tech Stack:** Markdown（skills 散文）+ TypeScript/vitest（那个测试）。

**Spec:** `docs/superpowers/specs/2026-10-10-peaks-race-code-design.md` §2.5（三档关系）、§4.4（机制与反向警告）、§6.2（风险面须保持 advisory）、§13 S1（含 U12=P1、U13）

## Global Constraints

- **新增/重命名文件后，必须先 `git add`，再重生成门基线。** 普查读 `git ls-files`，未跟踪文件对它不可见——2026-10-10 实测：未暂存时 `peaks-gate.mjs repo` 会打印 `all whole-repo ceilings held`（ceiling 是计数，缺一个文件不移动任何计数），而 `file-size-cap.test.ts` 与 `scope-shadow-coverage.test.ts` 是红的。**重生成之后必须跑 `pnpm test:unit`。**
- **gated ceiling 只降不升**：推送前 `.husky/peaks-gate.mjs repo` 必须 `all whole-repo ceilings held`；四条被量的指标是 `tscErrors` / `commentNarrativeLines` / `fileSizeOverCap` / `fileSizeExcessLines`。
- **红规则**：任何 commit message 不得含 `Co-Authored-By: Claude` / `Anthropic` 或等价 AI 署名 trailer。SquabbyZ 是唯一作者。
- **注释不得含过程叙事**（"S0 Task 4 (Ruling 11)"、plan 文件名、日期）——`commentNarrativeLines` 会数它。
- **格式棘轮**：`node .husky/format-check-ratchet.mjs` 必须在推送前 held，**不许**把文件加进 `FORMAT_CHECK_BASELINE_FILES`。
- **风险面必须保持 advisory**：一份判断清单，**不接到任何门上**（spec §13 S1 的用户裁决）。加门就是改变 peaks-code 的行为。
- 平台是 Windows。遍历文件用 `fs.readdirSync`，**不要** shell `find`。

## Review Focus

这一轮的 spec 与计划都没覆盖、但最可能咬人的输入：

1. **`fast-mode.md` 里那句被删掉的验收门**——它是否真的只出现一次、且删除后没有别处（如 `startup-sequence.md`、`quality-gate-cheatsheet.md`）仍在重述它。**先 grep 全仓**再删。
2. **规范文件被当成"新门"**——它的措辞一旦像强制性要求（"MUST"），读者会以为有一条执行它的门。必须写成 advisory 并明说"无门执行"。
3. **`change-id` 改名波及面**——`fast-mode.md` 与 CLI 帮助之外，是否还有别处提到 `peaks code plan <change-id>`（docs/、CHANGELOG、tests fixture）。
4. **`--fast` 的语义未被本次改动触碰**——本 slice 只动文档与帮助文本，**不得**改 `buildCodePlan` 的行为。

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `skills/peaks-code/references/fast-lane-norm.md` | **唯一**的验收门 + 风险面陈述 | **Create** |
| `skills/peaks-code/references/fast-mode.md` | fast mode 的工序差异；改为指向规范 | Modify |
| `src/cli/commands/code-mode-gate-plan-command.ts` | `--fast` 的帮助文本（`:21` 的 `<change-id>`、`:26` 的 description） | Modify（仅文本） |
| `tests/unit/standards/fast-lane-norm-single-source.test.ts` | 钉住"指向存在 + 无第二份" | **Create** |

---

### Task 1: 规范单一来源（红→绿）

**Files:**
- Create: `skills/peaks-code/references/fast-lane-norm.md`
- Modify: `skills/peaks-code/references/fast-mode.md`
- Test: `tests/unit/standards/fast-lane-norm-single-source.test.ts`

**Interfaces:**
- Produces: `skills/peaks-code/references/fast-lane-norm.md` —— 后续 S2 的 `peaks-race-code/SKILL.md` 用相对路径 `../peaks-code/references/fast-lane-norm.md` 指向它。

- [ ] **Step 1: 先 grep 清楚重述出现在哪几处**

Run: `grep -rn "tsc pass\|lint pass\|test pass" skills/ --include=*.md`
Expected: 至少 `fast-mode.md` 一处。**把结果记下来**——凡是在重述验收门的文件都要在 Step 4 处理，不只是 `fast-mode.md`。

- [ ] **Step 2: 写失败的测试**

```ts
// tests/unit/standards/fast-lane-norm-single-source.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const NORM = 'skills/peaks-code/references/fast-lane-norm.md';
// The exact gate sentence. If a fast-lane doc restates it verbatim, the norm
// has stopped being the single source — section 4.4's rule is that two places
// that cannot be word-for-word identical should not have been split.
const GATE = 'test pass + tsc pass + lint pass';

describe('the fast-lane norm is single-sourced', () => {
  it('the norm exists and states the acceptance gate', () => {
    const norm = readFileSync(NORM, 'utf8');
    expect(norm).toContain(GATE);
  });

  it('fast-mode.md points at the norm instead of restating the gate', () => {
    const doc = readFileSync('skills/peaks-code/references/fast-mode.md', 'utf8');
    expect(doc).toContain('fast-lane-norm.md');
    expect(doc).not.toContain(GATE);
  });
});
```

- [ ] **Step 3: 跑测试，确认它失败**

Run: `pnpm vitest run tests/unit/standards/fast-lane-norm-single-source.test.ts`
Expected: **FAIL** —— `ENOENT` 打开 `fast-lane-norm.md`（文件还不存在）。这是"功能缺失"的正确失败形态。

- [ ] **Step 4: 建规范文件；把重述改成指向**

`fast-lane-norm.md` 至少包含两块，**并明说自己是 advisory**：

```markdown
# Fast-lane norm（唯一来源）

> **advisory**：本文是判断清单，**没有任何门执行它**。门在各自的泳道里：
> fast mode 走 `peaks code plan --fast` 的步骤开关，race-code 走它自己的完成证明。

## 验收门
`test pass + tsc pass + lint pass` = GO。

## 何时不该走快泳道
（从 spec §6.2 取那 7 条，逐条标注哪些真机械、哪些是判断）
```

`fast-mode.md` 里那句验收门**删掉**，换成一句指向，例如：
`验收门见 `fast-lane-norm.md`（唯一来源）。`

- [ ] **Step 5: 跑测试，确认通过**

Run: `pnpm vitest run tests/unit/standards/fast-lane-norm-single-source.test.ts`
Expected: PASS（2/2）

- [ ] **Step 6: 覆盖 Review Focus #2 —— 规范不得看起来像门**

断言规范里含 `advisory`（或等价措辞），且**不含** `MUST` / `BLOCKING` / `RED LINE`：

```ts
it('the norm reads as advisory, not as a gate', () => {
  const norm = readFileSync(NORM, 'utf8');
  expect(norm.toLowerCase()).toContain('advisory');
  expect(norm).not.toMatch(/MUST|BLOCKING|RED LINE/);
});
```

Run: 同 Step 5 → PASS

- [ ] **Step 7: 先暂存新文件，再重生成基线（顺序不能反）**

**两步，次序固定**：

```bash
# 1) 让普查看得见新文件 —— 未跟踪文件对 `git ls-files` 不可见
git add skills/peaks-code/references/fast-lane-norm.md \
        tests/unit/standards/fast-lane-norm-single-source.test.ts
# 2) 现在才重生成（它会写基线，所以基线在这一步之后才暂存）
node .husky/peaks-gate-baseline.mjs
```

Expected: `monotonicity: every ceiling held`。**若它拒绝**，说明本 slice 推高了某条 ceiling——回去修，不要编辑 ceiling。

⚠️ **不要**在跑生成器之前 `git add .peaks/lint/gate-baseline.json`：生成器**要写**那个文件，先暂存只会暂存旧版本。

- [ ] **Step 8: 跑全量**

Run: `pnpm test:unit > /tmp/s1.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/s1.log`
Expected: `EXIT=0`。**不要 `| tail`**——那会拿到 `tail` 的退出码并丢掉失败文件名。

- [ ] **Step 9: Commit**

```bash
git add skills/peaks-code/references/ tests/unit/standards/fast-lane-norm-single-source.test.ts .peaks/lint/gate-baseline.json
git commit -m "refactor(skills): single-source the fast-lane norm"
```

---

### Task 2: `change-id` 漂移（U13）

**Files:**
- Modify: `skills/peaks-code/references/fast-mode.md`
- Modify: `src/cli/commands/code-mode-gate-plan-command.ts`（仅 `:21` 与 `:26` 的文本）

**Interfaces:**
- Consumes: Task 1 已改过 `fast-mode.md`。
- Produces: 无（文档与帮助对齐）。

- [ ] **Step 1: 先查清波及面（Review Focus #3）**

Run: `grep -rn "code plan <change-id>\|code plan --fast <change-id>\|change-id" skills/ docs/ CHANGELOG.md src/cli/commands/code-mode-gate-plan-command.ts 2>/dev/null | head -20`
Expected: 列出每一处。**只改描述该命令参数的地方**；`change-id` 在别处（如 spec 的历史说明、`--id` 之类）另有含义时不要动。

- [ ] **Step 2: 改 CLI 帮助文本**

`code-mode-gate-plan-command.ts` 的 `.argument('<change-id>', 'change id to plan against')` → `.argument('<session-id>', 'session id to plan against')`；description 同步。handler 形参**已经是** `sessionId`（`:31`），所以只改文本。
⚠️ **不改** `buildCodePlan` 的任何行为（Review Focus #4）。

- [ ] **Step 3: 改 `fast-mode.md` 里的参数名**

Run: `grep -n "change-id" skills/peaks-code/references/fast-mode.md`
把它描述的调用改成 `peaks code plan --fast <session-id>`。

- [ ] **Step 4: 验证 `--fast` 的行为/帮助没被改坏**

Run: `peaks code plan --help`
Expected: 用法行显示 `<session-id>`；`--fast` 仍在，描述不变。

- [ ] **Step 5: 跑受影响测试 + 全量**

Run: `pnpm vitest run tests/unit/cli/ tests/unit/standards/ > /tmp/s1b.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/s1b.log`
Expected: `EXIT=0`。若有测试钉着旧字符串 `<change-id>`，**那是真信号**——去更新它，不是绕过它。

- [ ] **Step 6: Commit**

```bash
git add skills/peaks-code/references/fast-mode.md src/cli/commands/code-mode-gate-plan-command.ts
git commit -m "docs(cli): the plan argument is a session id, and change-id no longer exists"
```

---

### Task 3: 收口

- [ ] **Step 1: 全仓门**

Run: `node .husky/peaks-gate.mjs repo`
Expected: `all whole-repo ceilings held.`

- [ ] **Step 2: 格式棘轮**

Run: `node .husky/format-check-ratchet.mjs`
Expected: `held`。**若 BREACHED，跑 `pnpm format` 修那个文件**，不许加进 baseline。

- [ ] **Step 3: 红规则**

Run: `pnpm vitest run tests/unit/standards/no-ai-co-author-trailer.test.ts`
Expected: PASS

- [ ] **Step 4: 推送门**

Run: `node .husky/peaks-gate.mjs changed`
Expected: `changed file(s) OK (ratchet held).`

---

## S1 的验收（对应 spec §13）

| 判据 | 怎么验 |
|---|---|
| T11 绿 | Task 1 Step 5 + Step 6 |
| peaks-code 既有测试全绿 | Task 1 Step 8（全量） |
| U13 已修 | Task 2 |
| ceiling 只降不升 | Task 3 Step 1 |

## 本 slice 之外（**记下，不做**）

| 项 | 为什么 |
|---|---|
| `peaks-race-code/SKILL.md` 指向规范 | 属 S2（race-code 尚不存在）。S2 要**扩展** Task 1 的测试到第二个消费者 |
| 把风险面接到任何门上 | 用户裁决要保持 advisory |
| 改 `buildCodePlan` 行为 | Review Focus #4：本 slice 只动文本 |
| 安装器支持共享目录（P4） | 包分发面改动，应另立 slice（spec §12 U12 记了 P1 的代价） |
