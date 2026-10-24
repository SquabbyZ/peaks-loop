---
name: mut-report-acceptance-retired
description: 维护者 2026-10-24 拍板：退休 mut/mut-report.json 的过期 back-compat 接受条目（不是续期）
metadata:
  type: decision
  sourceArtifact: .peaks/_runtime/2026-10-23-session-5e40e0/prd/handoff-rid-t4-mut-retire-mut-acceptance.md
---

**决定（用户原话「退休吧」，2026-10-24）**：`.peaks/lint/backcompat-expired-acceptance.json` 里
`mut/mut-report.json` 那条过期 back-compat 接受**退休**，不续期。

**为什么不是续期**：条目里的理由是「No producer in this build: peaks mut * requires --input-sig
(TACT.sig), and peaks tact read is not a registered command」—— 这两句话**都已失实**：
`peaks tact read` 早已是注册命令；rid 029 之后 `peaks mut` 真能在没有手写 `stryker.conf.js`
的项目上跑出真实变异。`reviewBy` 是 v4.2.0（下个 minor）。续期一条理由为假的债务 = 让假话
继续留在清单里。

**退休要动两处，不是删一个 JSON**：
1. `.peaks/lint/backcompat-expired-acceptance.json`（已跟踪清单）；
2. `src/services/artifacts/backcompat-acceptance.ts` 的 `backcompatAcceptanceSeed()`（默认种子）。
   `seedBackCompatAcceptance()` 只在文件**不存在**时播种 → 只删 1 会让**每个新项目**继续背这条债，
   而且继续带着那句假理由。

**退休后仓库行为变了**：`rd → qa-handoff`（feature / bugfix / refactor）从此**必须**带真实的
`mut/mut-report.json`（`thresholds.passed === true`）。MUT_REPORT 是 **session 作用域**
（`relativePath` = `mut/mut-report.json`，不带 `<rid>`）→ 本会话产出一份真实报告即可覆盖本会话所有切片。

**没动的**：`artifact-prerequisites.ts` 的 `backCompat` / `backCompatUntil` 字段保持原样 ——
退休的是「接受」，不是把窗口本身升级成硬失败。`rd/third-party-review-<rid>.md` 那条接受**保留**
（原因是「没配 reviewer」，与本次无关）。

**没放宽的**：阈值 `mutationKillRateMin=0.80` / `weakAssertionRateMax=0.05` 一个都没动。
若找不到能同时满足两个阈值的窄范围 → 报告 **BLOCKED** 并附实测数字，
**不伪造报告、不改阈值**。
