---
name: a-lone-ts6053-is-an-abort-not-a-clean-tree
description: tsc 报出单独一条 TS6053（找不到输入文件）会中止整个编译，所以"1 个错误"读起来像"几乎干净"，实际是"程序根本没跑完"；并发运行留下的临时目录就会触发
metadata:
  type: project
  node_type: memory
  originSessionId: e0ac1231-9059-438e-b036-c6cae372eb87
  modified: 2026-09-14T02:00:00.000Z
---

**`tsc` 报 `TS6053`（"File not found"）时不编译任何东西 —— 它直接中止。所以一次报出 1 个错误的运行，不是"几乎干净"，是"没跑"。**

## 实测（2026-09-14）

某个 RD 子代理在并发环境下首次 `tsc -p tsconfig.json` 得到 **单独一条 `TS6053`**，路径指向 `tests/unit/_bdd-reporter-tmp/…` —— 那是**另一个并发运行的进程留下的、尚未清理的 gitignored 临时目录**。该错误让整个 program 中止，于是这一轮**一个类型错误都没被检查**。重跑得 **140**（该仓库的基线）。

**危险在于读数**：`140 → 1` 看起来像"大幅改善"，`0 → 1` 看起来像"冒出一个无关紧要的小问题"。**两者都错，正确读法是"这轮没测到东西"。**

## 怎么用

- **`tsc` 报数异常小（尤其恰好 1）时，先确认它跑完了**，而不是先庆祝。判据：错误里出现 `TS6053` 就是中止信号。
- 并发跑测试/构建时会互相制造这种噪音（临时目录、半成品文件）。**报告数字前先确认没有别的进程在改盘**；本 session 里"兄弟切片正在改盘"至少污染过三次测量，每次都被当事人自己识别并丢弃。
- 这一类与 [[piping-a-test-run-reports-the-pipes-exit-code]] 同族：**读数是二手的，先问它是谁产生、在什么状态下产生的。**

相关：[[a-probe-that-samples-one-point-reports-green-for-the-whole-space]] · [[check-ci-on-every-push-and-run-wide-tsc]] · [[piping-a-test-run-reports-the-pipes-exit-code]]。
