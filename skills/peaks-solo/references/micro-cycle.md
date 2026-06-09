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
2. `npx vitest run --changed`（默认；changed-only suite，只跑 git 改动相关的 test，~1-3s）。要全量请加 `--run-tests`；要彻底跳过请加 `--skip-tests`。
3. 3-way fan-out（code-review + security-review + perf-baseline）
4. `peaks workflow verify-pipeline --rid <rid> --project <path>`

4 个 check 全绿 + verify-pipeline pass → 才进 `peaks request transition --state qa-handoff`，让 peaks-qa 接管。

> **新增 run 017（2026-06-09）**：边界默认走 changed-only suite，原来的全 suite 行为移到 `--run-tests` opt-in。`peaks-solo-test` skill 仍然是手动跑全量的入口。rationale: 全量 30s+ 严重拖慢 workflow；changed-only 命中 99% 真正回归。详见 PRD `.peaks/_runtime/2026-06-07-session-84feb7/prd/requests/002-017-2026-06-09-remove-auto-full-vitest-from-slice-check.md`。

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
- **稳**：边界 check 不省，4 项检查（tsc + vitest run --changed + 3-way + verify-pipeline）一次全跑；changed-only 模式 1-3s 内出结果，全量用 `--run-tests` opt-in
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

---

# Mandatory RD QA repair loop (AUTO-PROCEED)

> Body of `## Peaks-Cli Mandatory RD QA repair loop`.

> **CLI gate enforcement**: `peaks request transition` now refuses to move RD/QA to gated states when required artifacts are missing. The required files depend on `--type` chosen at `peaks request init` (default `feature`):
>
> - `feature` / `refactor`: full gates (tech-doc, code-review, security-review, test-cases, test-report, security-findings, performance-findings)
> - `bugfix`: lighter planning (`bug-analysis.md` instead of `tech-doc.md`); still requires code-review + security-review + regression test-cases + security-findings; performance-findings optional unless the bug is performance-related
> - `config`: only security-review (RD) and security-findings (QA)
> - `docs` / `chore`: no gates
>
> When PRD lands, classify the request type before running `peaks request init` for every role — pass `--type <type>` so the artifact records it and downstream transitions enforce the right gates. Misclassifying a feature as `docs` to skip gates is a workflow violation. If a transition fails with `code: PREREQUISITES_MISSING`, the response lists every missing path — produce them, then re-transition. For one-off exceptions, the escape hatch `--allow-incomplete --reason "<text>"` records the bypass in the artifact transition note.

After `peaks-rd` finishes any implementation, repair, or code-output slice, Peaks-Cli Solo MUST automatically route the result to `peaks-qa` without waiting for user confirmation. This is not optional in full-auto mode. Solo must not declare the workflow complete, emit a TXT handoff, or stop at RD completion.

**How Solo invokes another role (mechanism, not metaphor):**

Solo is itself a skill running in the current session. There are **two distinct mechanisms** in this skill, and they MUST NOT be confused:

1. **Swarm fan-out (planning side, after PRD confirmed)** — uses `peaks sub-agent dispatch <role>` to launch real concurrent sub-agents. The CLI returns a per-IDE tool-call descriptor that the LLM executes in its environment. See "Peaks-Cli Swarm parallel phase" above for the full contract. Sub-agents do NOT call Skill(...) back into the role; they execute the role's instructions inline from the prompt.
2. **Sequential handoff (execution side, RD↔QA repair loop)** — Solo is the only loop, and after RD or QA finishes (whether as a sub-agent or directly), Solo drives the next step from the orchestrator seat. Do NOT use the `Skill` tool to "reactivate" peaks-rd or peaks-qa in the main loop; doing so is the v1.x anti-pattern that masqueraded as "calling the role" but actually just re-prompted the same session. From v1.3 onward, the main loop drives roles via the CLI gate (`peaks request transition`) and reads back artefacts (`peaks request show ... --json`); the actual RD/QA work is either done inline by Solo (when Solo has just been re-invoked by the user) or by a Task sub-agent (in swarm mode).

After RD completes (whether inline or sub-agent), Solo does not stop — it must advance to QA. There is no "RD done, ask the user" state in full-auto mode. The only valid stops are: (a) QA verdict=pass, (b) repair cap hit, (c) explicit user cancel.

**RD's internal reviews are already parallelized.** When RD finishes implementation, it issues a 3-way sub-agent fan-out (code-review + security-review + perf-baseline, see `skills/peaks-rd/SKILL.md` "Parallel review fan-out") and waits for all to return before transitioning to `qa-handoff`. Solo does NOT need to track three separate RD-side sub-runs; the RD role owns the fan-out lifecycle end-to-end. Solo's presence restoration after the swarm converges is the only coordination point.

**Presence restoration after RD/QA work returns (MANDATORY):** In v1.x, role skills called `peaks skill presence:set <role>` internally and stomped on `.peaks/.active-skill.json`. From v1.3 onward, sub-agents in the Swarm path are forbidden from calling `peaks skill presence:set` (see "Sub-agent dispatch" in each role's SKILL.md), so the main loop's presence file is preserved across the fan-out window by construction. The one place Solo still has to actively restore presence is **once after the fan-out returns** (gate=swarm-converged) and again **after each RD↔QA repair iteration** (gate=repair-cycle-<N>). Use the same command from Step 2 with the current mode and the gate that has just advanced:

```bash
peaks skill presence:set peaks-solo --project <repo> --mode <mode> --gate <current-gate>
```

This keeps the CLAUDE.md status header accurate (`Peaks-Cli Skill: peaks-solo`) instead of showing a stale role name. Use the current mode and gate values; the gate may have advanced since startup. Skipping this step causes the header to display the last-known gate permanently.

**Full-auto auto-proceed rule**: In the `full-auto` profile, when RD transitions to `qa-handoff`, Solo immediately drives QA — by launching a `peaks sub-agent dispatch qa` sub-agent carrying the `peaks-qa` body (swarm path), then executing the returned toolCall, or by running QA inline in the main loop (assisted/strict path). Do not pause, do not ask the user, do not summarize RD results as if they were final. The only valid reason to skip QA is when `--type` is `docs` or `chore` (no acceptance surface).

A QA report with any failing, blocked, missing, or unverified acceptance item is not a pass.

**How Solo routes QA findings back to RD (mechanism, not metaphor):**

When `peaks-qa` returns `verdict=return-to-rd`, Solo does NOT manually rewrite RD artifacts. Instead it follows this exact sequence:

1. Read the QA verdict and findings via `peaks request show <rid> --role qa --project <repo> --json`. The findings live in the QA artifact body (failing acceptance items, evidence paths, severity).
2. Transition the RD artifact back from `qa-handoff` to a working state and record the QA verdict in the transition note:
   ```bash
   peaks request transition <rid> --role rd --state spec-locked \
     --reason "QA return-to-rd cycle <N>: <one-line summary of failing items; full findings in qa/test-reports/<rid>.md>" \
     --project <repo> --json
   ```
   `spec-locked` is the canonical "needs more RD work" state. The reason is mandatory in repair cycles so the artifact history shows the loop.
3. Re-launch `peaks-rd` work. Two paths, mode-driven:
   - **Swarm / full-auto**: launch a fresh `peaks sub-agent dispatch rd` sub-agent (then execute the returned toolCall) with the same `peaks-rd` body used in the Swarm phase, plus the QA findings path so it can read the failure list. Solo restores presence after the sub-agent returns.
   - **Assisted / strict / inline-fallback**: Solo executes the RD repair steps directly in the main loop, since there is no concurrent fan-out to coordinate.
   In both paths, pass the QA findings path so the repair sees what failed.
4. peaks-rd fixes the reported issues only (red-line scope: do not modify unrelated surfaces), regenerates code-review and security-review evidence if changes touched reviewed surfaces, then transitions `rd → implemented → qa-handoff` again.
5. Solo re-runs QA (sub-agent Task in swarm/full-auto, inline in assisted/strict) with the same `<request-id>`. QA re-runs gates against the new diff.
6. Repeat steps 1-5 until QA returns `verdict=pass`, or the cap below fires.
   **After each repair iteration** (after peaks-rd and peaks-qa both return), Solo MUST restore presence:
   ```bash
   peaks skill presence:set peaks-solo --project <repo> --mode <mode> --gate repair-cycle-<N>
   ```

**Repair cycle cap**: After 3 repair cycles without a passing QA verdict, emit a blocked TXT handoff regardless of remaining issues. Do not loop indefinitely. If a specific issue cannot be resolved within 3 cycles, mark it as a known blocker in the TXT handoff and proceed to the SC phase.

In full-auto mode, treat the RD↔QA repair loop as a built-in controller objective: loop through RD→QA until all acceptance items pass (max 3 cycles). Do not exit the loop on a non-passing QA verdict unless the TXT handoff marks the workflow as blocked.
