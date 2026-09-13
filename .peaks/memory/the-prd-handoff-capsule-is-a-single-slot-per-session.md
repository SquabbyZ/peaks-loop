---
name: the-prd-handoff-capsule-is-a-single-slot-per-session
description: prd/handoff.md 是全 session 单槽，peaks prd handoff init --rid <x> 每次写都覆盖前一个；多切片 session 里门禁靠一份写着别的 rid 的胶囊满足，而它从未被 rid 化
metadata:
  type: project
  node_type: memory
  originSessionId: e0ac1231-9059-438e-b036-c6cae372eb87
  modified: 2026-09-14T02:30:00.000Z
---

**`prd/handoff.md` 没有 rid，是每个 session 一个槽。而 `peaks prd handoff init --rid <x> --sid <s>` 每次调用都会把它覆盖 —— 于是同一个 session 里的多个切片共用一份胶囊，而它只写着其中一个 rid。**

## 实测（2026-09-14）

一个四切片 job 里，逐片探转移时 `prd/handoff.md` **不在缺失列表里** —— 但盘上那份的 `requestId` 是**几天前另一条线**（压缩那两个切片）的 rid。也就是说 `AUDIT_REQUIRES_HANDOFF` 这道门**只查文件存在与两个子串**（`schemaVersion: 2` + `sha256:`），**从不查它写的是哪个 rid**。

**所以四片的这一项，实际是靠一份不属于它们的证据满足的。**

## 为什么这值得记（而不是"反正门禁过了"）

**这是同一个 session 里两个切片互相覆盖的同一类问题 —— 而这一份正是没被 rid 化的那一个。**

同一晚的另一个切片（`2026-09-14-audit-artifact-rid-scoping`）**正是因为审计产物按 session 命名、跨切片互相覆盖**才存在，它把 `audit/security.md`、`audit/perf.md`、`rd/code-review.md`、`rd/karpathy-review.md` **全部改成了 rid 作用域**（`<dir>/<basename>-<rid><ext>`）。**而 `prd/handoff.md` 是它没有动的那个。**

结果是一个自相矛盾的目录：**大部分证据按 rid 分开了，唯独 PRD 交接胶囊还是单槽。**

## 怎么用

- **一个 session 跑多于一个切片时，不要以为 `prd/handoff.md` 是"本片的"** —— 它可能是任何一个切片的，或是几轮之前的。要判断，读它的 `requestId`，别看它是否存在。
- `peaks prd handoff init` **没有 rid 作用域形式**；想为多个 rid 各留一份，得自己在文件之外归档。
- 若要把这条路修完，方向与已落地的一致：让胶囊路径也带 rid（`prd/handoff-<rid>.md`），并保留裸路径作 legacy 层 —— **那一片已经建立了可复用的三层解析模式**（`relativePath` → `legacyRelativePath` → `legacyRelativePaths`）。
- 相关 CLI：`peaks request transition … --json` 的 `data.missing` **只给路径、不给 rid 归属** —— 它无法告诉你那份文件属于哪个切片。

相关：[[gated-audit-artifacts-collide-across-slices-in-one-session]] · [[gated-artifacts-have-shape-contracts-nobody-tells-the-producers]] · [[prd-handoff-frontmatter-three-consumers-disagree]]。
