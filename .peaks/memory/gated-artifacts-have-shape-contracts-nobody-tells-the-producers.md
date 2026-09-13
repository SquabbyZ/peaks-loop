---
name: gated-artifacts-have-shape-contracts-nobody-tells-the-producers
description: rd:qa-handoff 的每个产物都有标题/标记形状要求，写在 artifact-prerequisites.ts 里但生产者看不到；不说就静默挂，挂了还谎称"文件缺失"；在派活指令里逐字写出就一次过
metadata:
  type: project
  node_type: memory
  originSessionId: e0ac1231-9059-438e-b036-c6cae372eb87
  modified: 2026-09-13T13:30:00.000Z
---

**门禁查的是产物的"形状"，不是内容。形状契约只写在 `src/services/artifacts/artifact-prerequisites.ts` 里，生产者（子代理）看不到。于是：内容全对，仍报"文件缺失"。**

## 形状要求（实测，2026-09-13）

| 产物 | `mustContain` |
|---|---|
| `rd/code-review.md` | `## Findings` **和** 字面量 `CRITICAL` |
| `audit/security.md` | `## Verdict` 或 `## Findings` |
| `audit/perf.md` | `## Baseline` 或 `## Results` 或 `N/A — no perf surface` |
| `rd/karpathy-review.md` | `## Karpathy-Gate` + 四个指南名**作为真实标题**（行锚 `#`–`###`，散文提及不算） |
| `qa/test-cases/<rid>.md` | `## Test cases` + `test(` |
| `qa/test-reports/<rid>.md` | `## Test execution` |
| `prd/requests/<rid>.md` | `## Goals` + `## Acceptance` |
| `prd/handoff.md` | `schemaVersion: 2`（**无引号**）+ `sha256:` —— 见 [[prd-handoff-frontmatter-three-consumers-disagree]] |

## 证据：说了就过，不说就挂

同一个晚上，同一批子代理：

- **karpathy 评审一次过** —— 因为派活指令里**逐字写了**要哪些标题。
- **code-review 与 perf 评审挂了** —— 内容都很好（code-review 有 `## Findings, by severity`，`## Findings` 子串其实满足，挂的是全文没有 `CRITICAL` 一词；perf 用 `## 1.`–`## 4.` + `## Summary`，没有 `## Results`）。派活时我没写形状要求。

**结论是确定的：形状契约本身没问题，问题是它从不出现在生产者的视野里。**

## 为什么危险（不只是麻烦）

1. **报错在撒谎。** 文件**存在**、内容**正确**，门禁说的是"missing"。于是排查方向天然跑偏到路径、到是否写成功 —— 而不是形状。本次为此多花了好几轮。
2. **静默。** 形状不满足在**转移那一刻**才暴露，中间任何时候都不报警。一个跑了几小时的切片可以在最后一步才发现。
3. **生产者包括 CLI 自己。** `peaks prd handoff init` 写出的胶囊也不满足它自己的门禁 —— 所以这不是"子代理不够听话"，是契约不可发现。

## 怎么用

- **派任何会被门禁检查的产物时，在派活指令里逐字写出要求的标题/标记。** 一句话的成本，换掉整轮返工。
- 门禁说某产物 missing、而该文件确实存在时：**不要先查路径或写入是否成功，先查形状**。`grep` 那几个 mustContain 子串，一眼就能判定。
- 事后对形状（编排方追加一个"为门禁合规所加"的小节并注明不是新判断）是可以接受的补救，但**它永远是补救**；正确做法是派活时说清楚。
- 相关 CLI：`peaks request transition … --json` 的 `data.missing` **只给路径，不给缺哪个标记** —— 这就是"报错在撒谎"的机制来源。

相关：[[prd-handoff-frontmatter-three-consumers-disagree]] · [[use-the-repos-existing-ast-guard-not-a-fresh-regex-scan]] · [[a-guard-whose-scope-differs-from-what-it-claims]]。
