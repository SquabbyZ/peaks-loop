---
name: peaks-code-role-artifact-lifecycle-gotchas
description: 编排 peaks-code 时角色工件的四个陷阱：须先 request init 再让子代理写、各角色终止状态不同、qa 转换有额外前置、type-sanity 是时序门
metadata:
  type: lesson
  createdAt: 2026-10-09
---

# peaks-code 角色工件的生命周期陷阱（2026-10-09 实操踩到）

## 1. 必须先 `peaks request init` 再让子代理写，否则工件没有状态机

`peaks request init --role <r> --id <rid> --apply` 生成带 `## Status` 块的模板。若跳过它、直接让子代理往 `qa/requests/<rid>.md` 写报告，该工件**没有 `state:` 字段**，后续 `request transition` 无从下手（报 `UNHANDLED_ERROR`）。

**而 `request init` 在工件已存在时会拒绝**（`REQUEST_INIT_FAILED`），且**不覆盖**——所以顺序错了就得手工补 `## Status` 块。

**正确顺序**：`request init` → 派子代理 → 子代理写入 → 若它覆盖掉了 Status 块，补回。

## 2. 各角色的**终止状态不同**

| 角色 | 合法状态 |
|---|---|
| prd | … → `confirmed-by-user` → `handed-off` |
| rd | `spec-locked?` → `implemented` → `qa-handoff` → `handed-off` |
| **qa** | `draft` / `running` / **`verdict-issued`** / `blocked` |

**qa 没有 `handed-off`**。把它当 prd/rd 一样转会报 `UNHANDLED_ERROR` 并附上合法值列表——**读那个列表**，别猜。

## 3. `qa → verdict-issued` 有额外文件前置

转换要求 `qa/test-cases/<rid>.md` 与 `qa/test-reports/<rid>.md` 存在，且**含字面标题**：

- `qa/test-cases/<rid>.md` → 必须含 `## Test cases`（**英文标题**），且含 `test(` 或 `it(`
- `qa/test-reports/<rid>.md` → 必须含 `## Test execution`

定义在 `src/services/artifacts/artifact-prerequisites.ts`。用自己的中文标题写会**不被识别**。

> ⚠️ **不要**用 `peaks evidence generate` 去凑这些文件——它是给「机械式文件拆分 slice」用的模板生成器，模板原文声称 "no new tests; behavior preserved"，对真实带测试的 slice **等于让产物说谎**。按实测结果**如实写**。

## 4. `TYPE_SANITY_VIOLATION` 是**时序门**，不是缺陷

`request transition` 会把 `--type` 与**当前 git diff** 比对。于是：

- **代码落笔前**，PRD 无法转 `handed-off`（diff 里只有 docs，会建议 `docs`）
- 代码落笔后自然通过

**含义**：PRD handoff 事实上**完成于 RD 落笔之后**。别在 PRD 阶段撞这个门去反复重试；落码后再转即可。`--allow-incomplete` **不覆盖**它。

## 5. 附带一条平台事（同 session 实测）

`peaks` 在 Windows 是 `.cmd` shim，**参数含换行即** `InvalidBatchScriptArg`。派子代理时不要传多行 prompt——落地成文件、参数只传短单行指针，再用 `--write-artifact` 注册。见 [[peaks-cmd-shim-fails-on-newline-arguments]]。
