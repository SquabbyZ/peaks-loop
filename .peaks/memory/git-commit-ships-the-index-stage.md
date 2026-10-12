---
name: git-commit-ships-the-index-stage
description: git-commit-ships-the-index —— 修复轮的编辑没被重新 stage 时，提交出去的是修复前那版
metadata:
  type: project
  sourceArtifact: .peaks/_runtime/2026-10-12-session-74bd69/txt/handoff.md
---

2026-10-12 实测：`git status --porcelain` 显示 `AM`（已 add 过、又在工作树改过）。
- staged `no-esm-require-mixing.test.ts` = **16004 B / 22 例**
- worktree = **24168 B / 28 例**
- staged 的扫描模块 **没有 `SHIM_REQUIRE_OBJECTS`**（对 `globalThis.require(` / `module.require(` 视而不见）

把 staged 版本取出来实跑：**22 passed（绿）** —— 也就是说**提交出去的那一版会被自己的测试判为通过**，
但它比工作树里的弱。QA 阶段发现（不是代码审查，也不是闸门）。

**为什么危险**：`git commit` 提交的是 **index**，不是工作树。而本仓有一整套验证是**对着工作树**跑的
（测试、lint、审查者的 diff 阅读）。两者分叉时，**验证的结论与提交的字节不是同一个东西**。

**判据（可复现）**：`for f in $(git diff --cached --name-only); do [ "$(git show :$f | wc -c)" = "$(wc -c < $f)" ] || echo DIFFERS; done`

**修法方向**：提交前跑一遍这条判据，或做成守卫（staged ≠ worktree ⇒ 红）。
**本次是手工补 `git add` 并逐路径比对。**
