---
name: substring-gate-passes-unparseable-artifact
description: gate 做子串检查、产物却不可解析 —— 子串通过 ≠ 文件能用，必须另有一条真正解析它的测试
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-12-session-e37ef0/txt/handoff.md
---

`src/services/prd/handoff-auto-regen.ts` 写出的 handoff frontmatter 把 `sessionId` **写了两遍**（第 64–65 行连续两行 `` `sessionId: ${opts.sessionId}` ``）。而 `AUDIT_REQUIRES_HANDOFF`（`src/services/artifacts/artifact-prerequisites.ts`）对同一份文件只做**子串**检查：`mustContain: ['schemaVersion: 2', 'sha256:']`。两份重复键各自都是一行合法的 `sessionId: ...`，子串在场 → **闸门放行**。但 `yaml@2.9.0` 解析同一份文件会抛 `Map keys must be unique`，于是 `readAndVerifyHandoff`（security audit / perf audit 的独立读取路径）直接炸。

通用形状：**writer 产出不可解析的文件 → 子串/marker gate 放行 → 真正解析它的下游消费者炸**。这个模块当时 **0 测试**，所以重复键没有任何一条断言能抓到。

**Why:** gate 验的是"字符串在场"，不是"文件合法"；只要 gate 用的是子串而不是 parser，writer 的任何语法级破坏都是不可见的。

**How to apply:** 凡是 gate 只做子串 / marker / heading 检查的产物，**都要另外有一条"用真正的解析器读它"的测试**（这里就是 `yaml.parse`）；没有任何测试覆盖的 writer 尤其危险。审 gate 契约时把 `mustContain` 列表和"谁真的解析这个文件"一起看 —— 两者不一致就是缺口。发现重复键这类问题的成本极高（它只在 audit 路径上炸，主流程全绿）。
