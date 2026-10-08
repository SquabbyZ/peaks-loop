---
name: proof-gated-by-skipif-can-vanish-and-report-success
description: 用 skipIf 守卫整套证明会让它在前提缺失时静默消失并以 0 退出；"消失"不是"通过"，缺前提必须转红
metadata:
  type: lesson
  createdAt: 2026-10-09
---

# 被 `skipIf` 守着的证明，会静默消失并报成功

## 事实（2026-10-09，rid-035 slice ①，QA 独立发现）

三层只读证明装置（快照 diff / 替身拦截 / 沙箱）整体挂在：

```ts
describe.skipIf(!existsSync(dist/cli/index.js))(...)
```

QA 实测：**把 `dist/cli/index.js` 挪开**，运行输出 `1 skipped (1) / 9 skipped (9)`，**vitest 退出码 0**。

三层证明**凭空消失，且报告成功**。

更隐蔽的是它**自带一个与仓库分歧的闸门**：仓库既有约定 `PEAKS_BUILD_AVAILABLE` 检查 `bin/peaks.js` + `dist/cli/program.js` 并报「可用」，而证明的私有守卫看的是**另一个文件**，于是仓库说可用、证明说跳过。

## Why

`skipIf` 的语义是"前提不满足就不测"。对**可选**用例这没错；但当它守着**一套完整的安全证明**时，语义就反了：证明的存在本身就是断言，前提缺失应当是**失败**而不是**跳过**。否则"证明"与"没写证明"在 CI 上无法区分。

这正是 [[peak-loop-mcp-readonly-surface-design]] 里 §6 反复强调的"能否因无法失败而通过"——闸门本身也是被检查对象。

## How to apply

- **证明装置的入口守卫不得用 `skipIf`。** 前提缺失 → 断言失败（红），不是跳过。
- 守卫要**复用仓库既有的可用性判定**，不要新造一个私有闸门——两个开关必然分歧，且分歧方向常是 fail-open。
- 审查任何"为排除环境而 skip"的用例时，先问：**它跳过时，CI 是什么颜色？** 若是绿的，它就不是证明。
- 相关：rid-035 的修复循环第 1 轮 P1 即为此项的修复。
