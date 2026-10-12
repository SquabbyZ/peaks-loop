---
name: esm-require-4-2-15
description: ESM 包内用 require() 是模式级缺陷 —— 已知 4 处站点，§2.15 只是其中之一
metadata:
  type: project
  sourceArtifact: .peaks/_runtime/2026-10-12-session-74bd69/txt/handoff.md
---

症状与后果：
- `peaks loop run` ⇒ `RUN_FAILED: require is not defined`（干净会话上必崩；loop runtime 的唯一入口）
- `peaks security-audit run` / `peaks perf-audit run` ⇒ 先写 `<target>.md.tmp`，然后在 rename 处抛
  ⇒ **盘上留下 `.tmp` 而无 `.md`**，`rd:qa-handoff` 会报该 artifact 缺失（即使审计本身做完了）

`tsx src/cli/index.ts` 与 `node bin/peaks.js`（含旧 `dist/`）**都复现**。
**修法**：删掉那行 `require`，把 `renameSync`/`readFileSync` 加到文件既有的 `node:fs` import 里。
**正确做法是合并成一个 slice 全仓扫 `type: module` 包内的 `require(`** —— 逐处补会继续漏。

工作区权宜之计（不改源码）：仓外放一个 `globalThis.require = createRequire(...)` shim，
用 `node --import file:///<shim> bin/peaks.js …` 走真 CLI。
