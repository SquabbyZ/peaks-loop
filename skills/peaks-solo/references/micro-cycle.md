# RD micro-cycle (TDD 小步快测)

> 参考 TDD 模式的红绿循环。设计目标：把 1 行 bug fix 的反馈循环从
> ~30s（全 suite + verify-pipeline）压到 ~100ms（单测 + 心算）。

## 什么时候用 micro-cycle

- 在 **RD 实现** 阶段，**slice 内部** 做小修复 / refactor / lint fix / 微调时
- 节奏：5-10 秒一个 micro-cycle

## 什么时候**不**用 micro-cycle

- slice 边界（一个 RD 任务结束 / 用户说 ship / 一个 logical change 整体完成）→ 走 `peaks slice check`
- 新增 slice / 跨模块 refactor / 依赖升级 → 直接走 peaks-rd 主流程
- `--type docs` / `--type chore` → 没有 acceptance 表面，micro-cycle 不适用

## The cycle (硬约束顺序)

### 1. RED — 写/改一个 unit test 反映 bug

```bash
vim tests/unit/<file>.test.ts  # 加 1 个 test 反映 bug
```

约束：**先写测试，再写实现**。LLM 写完实现再补 test 属于反向 TDD，等同于 skip micro-cycle。

### 2. 跑这一个 test（确认 red）

```bash
npx vitest run tests/unit/<file>.test.ts \
  -t "<new test name>" \
  --no-coverage
```

预期：test FAIL。**如果已经 pass → 你的测试没反映 bug，回去重写**。

### 3. GREEN — 修实现

```bash
vim src/<file>.ts
```

约束：**minimal change**，不要顺手"改进"无关代码。

### 4. 跑这一个 test（确认 green）

```bash
npx vitest run tests/unit/<file>.test.ts \
  -t "<new test name>" \
  --no-coverage
```

预期：test PASS。**如果还 FAIL → 你的实现不对，回去修**。

### 5. 局部回扫 — 跑同 file 的所有 test

```bash
npx vitest run tests/unit/<file>.test.ts --no-coverage
```

目的：防"改一处坏一处"。比全 suite 快 10-50×。

### 6. 写一个 commit message（先不 commit）

```bash
git add -p
# commit message: [micro-cycle] <slice-id>: <one-line summary>
```

## micro-cycle 内**禁止**触发

| 命令 | 理由 |
|---|---|
| `npx vitest run`（无 filter）| 30s+，micro-cycle 内禁止 |
| `npx tsc --noEmit` | 边界点才跑 |
| `peaks workflow verify-pipeline` | 边界点才跑 |
| 3-way fan-out（code-review / security-review / perf-baseline）| 边界点 + RD-internal 才跑 |
| `peaks request transition <rid> --state qa-handoff` | micro-cycle 内**不切 slice 状态** |

**违反任何一条 = workflow violation**（slice 边界才能跑全套）。

## 边界 check（slice 结束）

当一个 slice 内的所有 micro-cycle 都 green 且用户/agent 准备进入 peaks-qa 时，**必须**跑：

```bash
peaks slice check [--rid <rid>] [--project <path>] [--json]
```

这个命令编排：
1. `npx tsc --noEmit`（typecheck）
2. `npx vitest run`（全 suite）
3. 3-way fan-out（code-review + security-review + perf-baseline）
4. `peaks workflow verify-pipeline --rid <rid> --project <path>`

4 个 check 全绿 + verify-pipeline pass → 才进 `peaks request transition --state qa-handoff`，让 peaks-qa 接管。

## Micro-cycle → 边界 check → QA 的串联

```
peaks-rd 启动一个 slice
  ↓
  bug 1 → micro-cycle (红绿, ~10s)
  bug 2 → micro-cycle
  bug 3 → micro-cycle
  ...
  ↓ 全部 green
peaks slice check  # 4 项检查全绿
  ↓
peaks request transition --state qa-handoff
  ↓
peaks-qa 接管 (full gate machinery)
  ↓
verdict=pass → SC + TXT → handoff
verdict=return-to-rd → RD 修 (new slice 内部走 micro-cycle)
```

## Anti-patterns（明确禁止）

- ❌ 写实现先于测试（反向 TDD）
- ❌ micro-cycle 内跑全 suite（`vitest run`）
- ❌ micro-cycle 内调 `peaks workflow verify-pipeline`
- ❌ 1 个 micro-cycle 改 < 1 行代码（合并到下一个相关变更）
- ❌ skip 边界 check 直接 ship
- ❌ 在 micro-cycle 内修改 reviewed artifacts（code-review / security-review / perf-baseline）— 等边界再 regenerate
- ❌ micro-cycle 跨 PR/branch（一次 PR 内的所有 micro-cycles 才合在一起 review）

## 跟其他 skill 的边界

| 阶段 | 谁负责 | 节奏 |
|---|---|---|
| RD slice 内部 | peaks-solo (main loop) | micro-cycle（5-10s 一个） |
| RD slice 边界 | peaks-solo 调用 `peaks slice check` | 一次 |
| QA test execution | peaks-qa (sub-agent or inline) | slice 级 |
| 3-way fan-out (CR + sec + perf) | peaks-rd (sub-agent) | slice 级（RD 内部一次 + 边界 check 一次） |
| TXT handoff | peaks-txt | slice 级 |
| SC commit-boundaries | peaks-sc | slice 级 |

## 为什么这套比当前 peaks-solo 的设计合理

- **快**：micro-cycle ~100ms（vs 30s 全 suite），改 10 个 bug 从 5 分钟降到 30 秒
- **稳**：边界 check 不省，4 项检查（tsc + vitest + 3-way + verify-pipeline）一次全跑
- **清晰**：LLM 看到一个 explicit "禁止" 列表 + 强制 sequence，比"建议"更不容易越界
- **可观测**：micro-cycle 走单测 → 边界跑 verify-pipeline，每步都有 JSON envelope 验证

## 跟 peaks-solo SKILL.md 的对账

- `peaks slice check` = 边界命令
- micro-cycle = slice 内部
- 3-way fan-out = peaks-rd 内部 + `peaks slice check` 末尾
- `peaks workflow verify-pipeline` = 边界 check
- `peaks request transition` = 边界切状态
- peaks-qa 接管 = 边界 + `verdict != pass` 时的下一轮

完整流程见 SKILL.md。
