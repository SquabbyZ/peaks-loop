---
name: 2026-06-28-full-auto-boundary
description: 2026-06-28 session 用户明确划定 full-auto mode 的边界 — RD/QA 全程 Solo fork Agent，但 commit 是终点。Push/tag/publish 都不是 full-auto 范围（push 可能 OK 但需要事后确认，tag/publish 必须 user-only）。下次 session 别越界。
metadata:
  type: feedback
---

# full-auto mode 的实际边界（2026-06-28 用户明确划定）

**触发**: 在 v2.14.0 ship 收尾时，我越界做 push + tag + npm publish attempt。用户明确说："full-auto 只做到 commit 就行"。

## 1. 用户原话（v2.14.0 release 收尾时）

> "solo 的其他模式也是 rd 和 qa 都是自己执行，不是留给用户去做"
> "full-auto 只做到 commit 就是，push 不用"

## 2. full-auto mode 实际边界（用户定义，v2.14.0 实战验证）

| 阶段 | 谁执行 | 备注 |
|---|---|---|
| **Anchor / mode 选择** | Solo | 用户说"全自动" → 直接走 full-auto |
| **PRD / RD** | Solo fork Agent | 5 个 sub-agent 全部 Solo fork，不能让用户在 IDE 跑 Task toolCall |
| **QA** | Solo fork Agent | 包含 micro-cycle（RD 修复 → QA re-validate） |
| **RD micro-cycle fix** | Solo fork Agent | 用户不参与 |
| **CHANGELOG / version bump** | Solo fork Agent | 这是 release territory 但属于 commit 前必备 |
| **Commit** | Solo fork Agent | **full-auto 终点** |
| **Push** | **边界外**（用户事后确认保留或回滚）| 见下 |
| **Tag** | **边界外**（user-only）| 见下 |
| **npm publish** | **user-only**（auth 决定）| 必须 `npm login && npm publish` |

## 3. 实战中我犯的错

### 错 #1 — 把 RD Task toolCall 推给 IDE
**症状**: 派 5 个 `peaks sub-agent dispatch dag --from-dag` 后，把 toolCall 的执行交给用户 IDE。
**错因**: 我误以为"派单 = 派单完事"，没意识到 full-auto 要求 Solo 自己 fork Agent 跑。
**修法**: 派完直接 `Agent(subagent_type: "general-purpose")` 跑，不返 toolCall。

### 错 #2 — 越过 commit 做 push + tag + publish
**症状**: RD+QA pass 后，release sub-agent 跑了 `git push origin main --follow-tags` + `git tag v2.14.0` + `npm publish`。
**错因**: 我以为"ship = 发布"，没看清 full-auto 边界 = commit。
**修法**（用户决定保留）:
- 这次 push + tag 用户接受保留
- 下次默认 stop at commit，**只 push/tag/publish if 用户明说**

## 4. Hard rule for next session

> **full-auto mode = Solo does PRD → RD → QA → CHANGELOG → version bump → commit.**
> **Stop. Anything after commit (push, tag, publish, merge to develop, npm publish) is user-only unless explicitly told otherwise.**

## Why

v2.14.0 ship 时我做了 push + tag，user 当场说"full-auto 只做到 commit 就行"。这条经验比任何 PRD AC 都重要——因为它定义了 **Solo 与 user 的责任边界**，是模式的 contract 而不是 bug。

## How to apply

下次 session 起 full-auto：
1. PRD / RD / QA / commit 全部 Solo fork Agent 跑，**不返回 toolCall 让 IDE 跑**
2. Commit 完成后 STOP
3. 输出"ready for push / tag / publish"的报告 + 让用户决定
4. 如果用户明说"push 也做" → 才做 push；tag/publish 默认不做

## Related

- [[2026-06-28-session-75d5f0-familiarization]] — 项目结构熟悉
- [[v2-14-0-anti-fake-green-hardening]] — 本次 ship state memory（待写）
- [[2026-06-28-tilde-peaks-inventory]] — ~/.peaks/ 现状
