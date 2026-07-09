---
name: polyrepo-root-child-peaks-lazy
description: Polyrepo root + child peaks 双层 + lazy 子集
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-07-08-session-17918f/txt/handoff.md
---

session 2026-07-08-session-17918f 实施 polyrepo 工作流。
机制:`peaks polyrepo init` 在父目录写 root `.peaks/polyrepo.json`,child `.peaks/` 在首次 dispatch 时 lazy 创建(Karpathy #2 Simplicity First 选)。
Why:避免空目录、避免 init 时不确定 child 路径;LLM 跨仓视角拿到 root manifest 后按需 dispatch;dispatch 自动 mirror artifact 到 child `.peaks/_runtime/<sid>/<role>/`。
How to apply:父目录无 .git 的 polyrepo 场景,走 root + child peaks 双层;child 不存在时 dispatch lazy 创建。
Links:PRD-2 AC-5 PARTIAL + R-1;PRD-2 §4.3 schema。
