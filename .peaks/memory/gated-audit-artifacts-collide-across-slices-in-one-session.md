---
name: gated-audit-artifacts-collide-across-slices-in-one-session
description: audit/*.md 与 rd/*-review.md 按 session 命名不带 rid，同一 session 里第二个切片会静默覆盖第一个的审计证据；实测一次被覆盖、一次被审计员自己保住
metadata:
  type: project
  node_type: memory
  originSessionId: e0ac1231-9059-438e-b036-c6cae372eb87
  modified: 2026-09-14T00:30:00.000Z
---

**`rd:qa-handoff` 要求的审计产物路径里没有 rid，于是同一 session 的第二个切片写同名文件时，第一个切片的证据被静默覆盖。**

## 碰撞面

| 路径 | 带 rid？ |
|---|---|
| `audit/perf.md` | ❌ |
| `audit/security.md` | ❌ |
| `rd/code-review.md` | ❌ |
| `rd/karpathy-review.md` | ❌ |
| `rd/tech-doc.md` | ❌ |
| `prd/requests/<rid>.md` | ✅ |
| `qa/test-cases/<rid>.md` / `qa/test-reports/<rid>.md` / `qa/requests/<rid>.md` | ✅ |
| `mut/mut-report.json` | ❌ |

`artifact-prerequisites.ts` 的路径常量（`:93`、`:125`、`:135`、`:211`、`:235`）都不含 `<rid>`。

## 实测：同一晚，两种结局

切片 1（`compact-event-settle`）闭合后，切片 2（`statusline-window-witness`）**必须产出同名文件**才能过同一道门。结果：

- **`audit/perf.md` 被直接覆盖** —— 切片 1 的 perf 证据没了，而现在那份文件描述的是切片 2。
- **`audit/security.md` 被保住了** —— 那一位审计员**自己发现路径冲突**，把切片 1 的存成 `audit/security-2026-09-13-compact-event-settle.md`，并注明"每个消费者读的是固定路径，所以这份是惰性的"。
- `rd/code-review.md`、`rd/karpathy-review.md` 同样被覆盖（两位审计员都在文件顶部写了一行"本文件取代切片 1 的那份"）。

**两种结局的差别不是纪律，是运气。** 一个靠审计员的个人自觉，一个没有 —— 所以这是**路径设计问题**，不是执行问题。指望每个审计员都自觉，等于把证据保全托付给随机性。

## 为什么危险（而不是仅仅可惜）

1. **门禁查不出这件事。** 它只查文件存在与形状，不查内容属于哪个 rid。覆盖后门禁照样绿。
2. **覆盖是静默的**，发生在正常流程里，没有任何一步会报警。
3. **被覆盖的那个切片已经闭合了**，所以损失在事后才可能被发现，而那时它已经提交进历史。

## 怎么用

- **一个 session 跑多于一个切片时，明确决定审计产物归属**：要么在接受覆盖前把前一份复制到带 rid 的名字（`audit/perf-<rid>.md`），要么确认前一个切片已闭合且其记录已在 `tech-doc.md` 里留档 —— **不要什么都不做**。
- 这一条现在**已经是自觉行为**（切片 2 的 security 审计员就这么做了），但**没有守卫**。若要修，方向是让路径带 rid，或加一个"覆盖前先归档"的检查。
- 相关 CLI：`peaks request transition … --json` 的 `data.missing` 只给路径 —— 它无法告诉你那份文件属于哪个切片。

相关：[[gated-artifacts-have-shape-contracts-nobody-tells-the-producers]] · [[prd-handoff-frontmatter-three-consumers-disagree]] · [[a-job-tracker-is-a-log-of-checkpoint-calls-not-evidence-about-the-repository]]。
