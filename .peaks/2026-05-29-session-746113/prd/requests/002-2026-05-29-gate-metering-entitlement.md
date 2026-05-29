# PRD Request 2026-05-29-gate-metering-entitlement

- session: 2026-05-29-session-746113
- type: feature (commercial layer B1 — open-core client half)
- source: verbal — "插槽式 cli 门禁……free 2 / pro 6 / max 18 / ultra 不限制……让项目有收益一直维护下去";身份模型选"邮箱+license key"、验证时机选"签名缓存+定期校验"、保护强度选"重方案(服务端 entitlement)"。
- raw input (sanitized): 在 Feature A（用户自创 SOP + 门禁注册表）之上，引入 open-core 的门禁分层计量：免费层最多 2 个自定义门禁、pro 6、max 18、ultra 不限。收益保护采用重方案——服务端签发 license、CLI 用内嵌公钥验签、本地缓存离线可用、到期重新校验。本 PRD 只覆盖 **B1（本仓 MIT 客户端半边）**：entitlement 数据模型、公钥验签、login、门禁池配额接入、层级展示。签发服务与支付（B2）单独立项。

## Scope split（本 PRD 的边界）

open-core 的物理边界 = 两个仓：

- **B1（本 PRD，本仓 MIT）**：entitlement 类型 + 公钥验签器（只验不签）+ `peaks login`/`logout`/`license status` + `sop register` 接入门禁池配额强制 + 层级与用量展示。用**测试密钥对**即可独立开发/测试，不阻塞于服务端。
- **B2（后续独立私有仓）**：持私钥的 license 签发服务 + 支付 + 账号（邮箱）管理。本 PRD 只定义 B1 依赖的**契约**（license 信封格式、签名算法、`/verify` 端点形状），**不实现**任何服务端代码。

## Goals

- G1：定义 entitlement 数据模型——层级 `free|pro|max|ultra` → 门禁配额 `2|6|18|∞`，作为 workspace 门禁池上限的唯一真相源。
- G2：CLI 内嵌**公钥**，能离线验证一个 license 信封（payload = {tier, email, issuedAt, expiresAt, nonce} + 签名）的签名与有效期；**CLI 永不持私钥、永不能签发**。
- G3：`peaks login`（输入 license key）/ `peaks logout` / `peaks license status` 三命令，license key 按既有 TokenConfig 范式**只存引用**（keychain/env），绝不落明文、绝不进 git。
- G4：`peaks sop register` 接入配额——注册会使 workspace 门禁池总数超过当前层级上限时，**阻断**并返回稳定错误码 + 升级引导；未登录视为 `free`。
- G5：签名缓存 + 定期校验——验签结果本地缓存（含过期时间），离线期内沿用；到期后下次联网时重新向 `/verify` 校验（B2 端点，B1 只定义契约 + 可注入的校验器接口）。
- G6：`peaks license status` 展示当前层级、门禁池用量（已用/上限，复用 A 的 `gateCount`）、到期时间；为未来客户端预留 `--json` 稳定信封。

## Non-goals

- N1：**不实现** B2 的签发服务、私钥管理、支付、账号注册（本 PRD 只定义契约）。
- N2：**不对内置 peaks-* 门禁计量**——配额只数用户自创 SOP 门禁（A 的注册表已保证内置门禁不入表）。
- N3：**不做** SOP 远程分享/市场（B2 之后）。
- N4：**不在 CLI 写任何"假装计费"的可绕过逻辑**——配额强制必须建立在公钥验签之上，删客户端判断也无法伪造有效 license（这是重方案相对 A 的本质区别）。
- N5：**不做**联网遥测/用量上报（验签是被动校验，不主动回传用量）。
- N6：**不改** Feature A 的 SOP init/lint/check/advance 行为——B1 只在 `register` 这一个写入点加配额闸口。

## Preserved behavior

- P1：Feature A 全部行为不变——`sop init/lint/check/advance` 零改动；只有 `sop register` 增加一道配额闸口，且**未登录(free)用户在门禁池 ≤2 时行为与 B1 引入前完全一致**。
- P2：内置 peaks-* 家族零影响——内置门禁永不计入配额（A 已保证不入注册表），纯用内置技能的用户装上 B1 后零变化、永不被要求 login。
- P3：**ARCHITECTURE.md token 红线的受控例外**——第 31/62 行"不得 Store tokens / token 绝不写进 config"对 license key 适用同一范式：只存 `{env}`/`{keychain}` 引用（复用 [config-service.ts:288](src/services/config/config-service.ts#L288) 的 TokenConfig），**绝不落明文、绝不进 artifacts/reports/committed config**。本 PRD 要求在 ARCHITECTURE.md 显式登记这条受约束例外（需用户签字），而非偷偷突破。
- P4：skill/CLI 边界不破——不静默改 settings.json / 装 hooks / 建 agents / 开 MCP；login 是显式命令、需用户主动运行。
- P5：离线可用——无网络时，缓存内有效期内的 entitlement 必须照常工作；验签/配额判断不得在断网时硬失败（除非缓存已过期）。
- P6：覆盖率红线不变（95%/有意义覆盖）；公钥验签等密码学逻辑必须有充分的真实行为测试（用测试密钥对）。
- P7：A 阶段的"无计费逻辑"反向断言（A 的 AC10）在 A 的代码里**继续成立**——配额逻辑只出现在 B1 新增模块，不回填进 A 的 sop-registry/sop-check。

## Acceptance criteria

- AC1（数据模型）：存在层级→配额映射 `free=2/pro=6/max=18/ultra=∞`，单一来源；`peaks license status --json` 返回当前 `tier` 与 `gateQuota`。
- AC2（验签-有效）：给定测试私钥签发的合法 license（未过期），CLI 用内嵌测试公钥验签 → `valid:true`，解析出 tier/email/expiresAt。
- AC3（验签-篡改）：篡改 payload（改 tier 或 email）后签名不匹配 → `valid:false`，配额回退到 `free`。
- AC4（验签-过期）：expiresAt 已过且无法联网重新校验 → license 视为失效，回退 `free`，`status` 标注 expired。
- AC5（login 存储）：`peaks login --license-ref keychain:peaks-license`（或 env 引用）成功后，**配置里只存引用，grep 不到明文 license**；`logout` 清除引用。
- AC6（配额放行）：当前层级配额内注册新 SOP → `sop register` 正常成功，`status` 用量 +1。
- AC7（配额阻断）：注册会使门禁池总数超过当前层级上限 → `sop register` 返回 `ok:false` + 稳定码 `GATE_QUOTA_EXCEEDED` + 当前用量/上限 + 升级引导；**不写注册表**。
- AC8（free 默认）：未登录 / 无 license → 视为 `free`（配额 2），不报错、不要求强制登录，仅在超限时提示。
- AC9（离线可用）：缓存内有效期内断网 → 验签/配额判断照常工作（用缓存），不因断网失败。
- AC10（ultra 无限）：ultra 层级注册任意数量门禁都放行，无上限分支误伤。
- AC11（信封一致性）：login/logout/license status 及 register 的配额错误都走 `{ok,command,data,warnings,nextActions}`；有副作用命令支持 `--dry-run`。
- AC12（防伪本质）：不存在任何"仅靠删除客户端常量即可解锁高层级"的路径——配额上限由验签后的 tier 决定，伪造高层级需要私钥（grep 不到硬编码绕过开关）。

## Risks and open questions

**待 RD 确认的实现问题：**

- OQ1（签名算法）：建议 Ed25519（node:crypto 原生支持、密钥短、无第三方依赖）。RD 拍板算法、license 信封编码（建议 base64url(JSON payload) + "." + base64url(sig)，类 JWT 但自定义）。
- OQ2（公钥分发与轮换）：内嵌公钥写在哪（常量 vs 随包资源）、如何支持未来轮换（多公钥并存窗口）。测试公钥与生产公钥如何隔离（env override 仅用于测试）。
- OQ3（缓存位置与时钟）：验签缓存存哪（建议 user 层 config 旁的非敏感缓存文件，含 verifiedAt/expiresAt）。定期校验周期多长（建议 expiresAt 为准 + 软宽限期）。时钟回拨防护要不要做（MVP 可不做，记风险）。
- OQ4（`/verify` 契约）：B1 只定义端点形状（请求含 license + nonce，响应含 valid/tier/expiresAt + 服务端签名），并提供**可注入的 verifier 接口**，使 B1 测试用 stub、B2 接真实服务。RD 定接口签名。
- OQ5（门禁池计量主体一致性）：配额数的是"当前 workspace 注册表的 gateCount"还是"跨 workspace 账号聚合"？PRD 决策记忆定为 **workspace/账号**而非项目；B1 先按单 workspace gateCount 实现，但 RD 要确认接缝不与未来账号聚合冲突（关联 A 的 R3）。

**风险：**

- R1（密码学正确性）：验签实现错误 = 要么误放(收益漏)要么误杀(体验崩)。必须用测试密钥对做正/负/过期/篡改全路径测试，安全 review 必查。
- R2（token 红线例外）：license key 存储是对 ARCHITECTURE.md "不存 token" 的受控突破。即使只存引用，也改变了"Peaks 不碰凭据"的承诺。**必须用户显式签字**并登记进 ARCHITECTURE.md，否则 B1 不应落地（这是产品-架构边界决策，不由 RD 私自定）。
- R3（fork 绕过）：MIT + 公开 npm，攻击者可 fork 删配额判断。重方案的防线是"伪造有效 license 需私钥"，但**本地配额强制本身可被 patch**。可接受——目标是挡住普通用户而非顶级逆向；真正高价值能力（B2 的远程分享/同步）才放服务端。这条要向用户讲清楚预期。
- R4（离线宽限被滥用）：宽限期太长=变相破解，太短=断网误伤。属 RD/数值调参。
- R5（free=2 转化）：数值调参，不阻塞 B1 机制实现（关联 A 阶段记忆 R4）。

## Handoff

- to peaks-rd: .peaks/2026-05-29-session-746113/rd/requests/2026-05-29-gate-metering-entitlement.md
  - 交接：B1 范围（本仓 MIT 客户端半边）、entitlement 模型（G1）、公钥验签（G2/OQ1/OQ2）、login 命令族 + TokenConfig 只存引用范式（G3/[config-service.ts:288](src/services/config/config-service.ts#L288)）、register 配额闸口单一接入点（G4，A 的 [sop-registry-service.ts](src/services/sop/sop-registry-service.ts) registerSop）、缓存+定期校验+可注入 verifier（G5/OQ3/OQ4）、防伪红线（AC12/N4）、token 红线受控例外需登记（P3/R2）。
- to peaks-qa: .peaks/2026-05-29-session-746113/qa/requests/2026-05-29-gate-metering-entitlement.md
  - 交接：AC1-AC12（含验签正/负/过期/篡改、配额放行/阻断/free 默认/ultra 无限、离线可用、明文不落盘反向断言、防伪反向断言）、Preserved P1-P7 回归、密码学安全用例（R1）。
- to peaks-ui: 不涉及（无 UI）。

## Status

- created: 2026-05-29T15:34:46.160Z
- last update: 2026-05-29T15:34:46.160Z
- state: deferred
- 说明：用户决定暂缓 B 计划，先 dogfood Feature A（自定义 SOP）验证易用性后再定。本 PRD 作为未来输入归档，未交接 RD/QA。
- deferred note (2026-05-29)：(1) 用户拍板暂缓 B，优先试用自定义 SOP 找易用性优化点。(2) 存储决策修订——license key/token 不再"只存引用"，改为**加密落盘、用时解密**（覆盖原 P3/G3 的 TokenConfig-只存引用方案）；重启 B 时 RD 需据此设计加解密方案（主密钥来源、算法、密钥管理），并仍需在 ARCHITECTURE.md 登记 token 红线的受控例外 + 用户签字。
