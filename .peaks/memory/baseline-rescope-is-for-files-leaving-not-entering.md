---
name: baseline-rescope-is-for-files-leaving-not-entering
description: 基线生成器的 --rescope 只用于"文件离开 scope"；文件进入是增长，带该标志会被拒（"growth is not a rescope"）。另附：新文件未 git add 时全量套件会给假绿 —— 同一个 census 陷阱
metadata:
  type: project
  createdAt: 2026-10-12
---

# `--rescope` 的方向性：离开 vs 进入

`node .husky/peaks-gate-baseline.mjs` 在 2026-10-12 的两次实测，**同一棵树、两种人口变更，它要的标志相反**：

| 人口变更 | 正确调用 | 它说的话 |
|---|---|---|
| 删掉一个被跟踪的文件（文件**离开** census） | `--rescope` | `RESCOPE applied (--rescope): the boundary moved … 1 left the scope` |
| 新增了被跟踪的文件（文件**进入** census） | **不带标志** | `--rescope was passed but the scope has not changed since HEAD: this run measured 1 MORE file(s) than HEAD inside an unchanged boundary — growth is not a rescope. There is nothing to rescope. Run without the flag.` |

**"Growth is not a rescope."** 两个方向不是同一个概念，别按类比套用——我第一次是照着删文件那次的记忆猜的，被工具纠正。

两个方向都**不会**静默放过：写之前会拒，且明说 `Nothing has been written; the existing ceilings are untouched.`

## 为什么这条重要 —— 它连着 §3.1 的假绿

`census` 读 `git ls-files`，**只认索引**。于是：

1. 新增文件后，若**先跑全量套件、后 `git add`**，census 看不到新文件 → 基线仍然自洽 → **套件全绿**。
2. 但提交之后文件进了索引，census 变了 → 一致性守卫（`file-size-cap F4`、`scope-shadow-coverage control(c)`、`silent-warning A7`）**立刻变红**。

2026-10-12 实测：新增 3 个文件后套件报 **441 文件 / 4657 通过 / exit 0**；提交后同样那套报 **expected 22502 to be 22552**、census `1930 → 1933`、`in-scope file(s) with no files[] row: src/services/loop/loop-observability.ts`。

**How to apply：** 新增或删除被跟踪文件后，**先 `git add -A`，再跑门与生成器，再信任何绿灯**。全量套件在未 `git add` 的树上给出的是**关于旧人口**的读数。交接文档 §3.1 记的是同一件事；本条补上 `--rescope` 的方向性，那是 §3.1 没说的部分。

Related: [[scripts-and-tests-are-ungated-shadow]]（同一个 census 的另一面）。
