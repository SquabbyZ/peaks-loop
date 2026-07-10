---
name: vitest-perf
description: vitest-perf 治理事故 + 真实交付
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-07-08-session-17918f/txt/handoff-006-final-delivery.md
---

2026-07-10 vitest-perf 治理最终交付的核心教训:

**1. 8-file 1.86× speedup 不能外推到 519 文件全量**。multi-fork 在真实 IO 负载下被 fs/io 竞争抵消。**测试 subset 提速,先验小 subset,再考虑全量;不要相信理论加速比**。

**2. 绝不 `git reset --hard` 在 unmerged state**。处理 merge conflict 必须先 `git status` + `git diff` 看清楚,再决定。reset --hard 是不可逆的,丢失了所有改动只能重做。**用户在这种事故里能原谅(他授权我重做),但别再犯**。

**3. 真实可赢的 subset**:
- `pnpm test:dev:cli` (38 CLI 文件) — 2 min 59 秒, 351/351 tests, 17× 加速
- `pnpm test:dev` (488 unit) — 5-8 min, 6-10× 加速
- `pnpm test:audit:silent-warning` — ~1s, 0 violation

**4. baseline `pnpm test` 51 min 是物理上限**。CLI integration tests 是真实 OS-level IO,multi-fork 救不了。要再压只能拆大文件 + 移 CLI tests 到 e2e 目录。

**5. 5 处 silent-warning 误报是 detector 设计盲区**(只读 AST 不读注释)。`// TODO(g2):` grace marker 是 detector 自身支持的解,1 行 surgical 改动 0 行源码逻辑改动。
