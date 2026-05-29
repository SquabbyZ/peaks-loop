---
name: token-encrypted-storage-decision
description: When Feature B (license/entitlement) is built, tokens/keys must be encrypted at rest and decrypted on use — not stored as plaintext or as bare references.
metadata:
  type: project
---
用户 2026-05-29 决策：将来做 Feature B（open-core license/entitlement）时，license key、token、密钥等敏感凭据必须**加密落盘、使用时解密**，而不是明文存储，也不是 B1 PRD 草案里原定的"只存 keychain/env 引用"方案。

**Why:** 用户明确要求"不存储明文的 token 和密钥等，加密存储，使用的时候解密"。这比 [config-service.ts](src/services/config/config-service.ts) 现有 TokenConfig 的"只存引用"更强，是对未来 B 的硬约束。

**How to apply:**
- 这是对**未来 Feature B** 的约束，现在不改任何代码（B 已暂缓，见 [[custom-sop-and-gate-metering]]）。
- 重启 B 时，RD 需设计：主密钥来源（机器绑定 / 用户口令 / OS keychain 派生）、加密算法、密钥管理与轮换、解密失败的降级。
- 仍需在 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 登记 token 红线（第 31/62 行"不得存 token"）的受控例外，并要用户签字——加密存储不豁免这条登记义务。
- B1 PRD 草案已归档（state: deferred）：`.peaks/2026-05-29-session-746113/prd/requests/002-2026-05-29-gate-metering-entitlement.md`，其 P3/G3 的"只存引用"被本决策覆盖。
