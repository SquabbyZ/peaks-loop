---
name: checkpoint-every-20-tool-calls-is-mandatory
description: checkpoint-every-20-tool-calls-is-mandatory
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-12-session-e37ef0/txt/handoff-4-0-45.md
---

每 20 次工具调用的 session checkpoint 是**强制项**，本轮 orchestrator 整轮没跑，一直到 context 76% 才补了第一次。

**Why:** checkpoint 是 compact 之后的恢复点。漏跑等于把「能恢复」降级成「靠运气」—— compact 发生时才想起来，此时被压缩掉的那段工作已经无法定位。它与 auto-compact 阈值是**两个不同的轴**，不能用「还没到 85%」当作不跑的理由。

**How to apply:** 计数到点就跑 `peaks session checkpoint --reason periodic`，与 context ratio 无关。三条轴不要互相替代或当成对方的陈旧版本：本规则量的是**每 20 次工具调用**；`sub-agent-headroom-forced-compression-gate` 量的是**子代理 dispatch 的 prompt 体积**；`auto-compact-threshold-policy` 量的是 **orchestrator 自己的 context ratio**。
