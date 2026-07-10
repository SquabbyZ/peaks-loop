---
name: silent-warning-5-grace-marker-slice-1-5
description: silent-warning 5 处 grace marker 处理(Slice 1.5)
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-07-08-session-17918f/txt/handoff-005-silent-warning-grace.md
---

2026-07-10 Slice 1.5:给 silent-warning-detector 报的 5 处误报加 `// TODO(g2):` grace marker。

**核心问题**:detector 是 AST 形态检测,看不见 catch 上下文注释(Per-SC §3.4 best-effort / fail-closed / vendor-neutrality),会把"设计故意吞"判定为 `empty-catch` / `catch-return-null`。

**处理**:
- detector 自身已支持 grace marker(`scripts/lint/silent-warning-detector.mjs:20,125` —— `if (/TODO\(g2\)/.test(txt)) return`)
- 5 处全部在 `} catch {` 行加 `// TODO(g2): <reason>`,1 行 surgical 改动,0 行源码逻辑改动
- 后续审计可 grep `TODO(g2):` 看所有"故意吞",每处都有 1 行 reason 显式说明

**5 处**:
- `polyrepo-dispatcher.ts:144` — fail-closed JSON parse 返回 null
- `current-model-detector.ts:52` — Per-SC §3.4 best-effort 链
- `zcode-adapter.ts:56` — fail-closed JSON parse 返回 undefined
- `model-routing.ts:72` — best-effort 运行时探测 fall-through
- `runtime-commands.ts:151` — vendor-neutrality,损坏 registry 不阻塞 runtime

**未做(留给未来)**:
- 改进 detector 读函数注释关键词(best-effort / fail-closed / vendor-neutrality),减少 TODO(g2) 数量
- 把 grace marker 的 expiry 改成可读(目前 detector 内部硬编码 one minor release,~6 weeks)
