---
name: prd-handoff-frontmatter-three-consumers-disagree
description: peaks prd handoff init 写出的 schemaVersion "2" / handoffHash 满足不了任何消费者；rd:qa-handoff 门禁要字面量 schemaVersion: 2 与 sha256:；上一次只写进 gitignore 的 _runtime，所以复发
metadata:
  type: project
  node_type: memory
  originSessionId: e0ac1231-9059-438e-b036-c6cae372eb87
  modified: 2026-09-13T12:55:00.000Z
---

**`peaks prd handoff init` 产出的胶囊，过不了它自己的门禁。正文没错 —— 只有两个 frontmatter 键的序列化方式对不上。**

## 三个消费者，三种要求

| 消费者 | 要求 |
|---|---|
| `rd:qa-handoff` 门禁（`artifact-prerequisites.ts` → `AUDIT_REQUIRES_HANDOFF`） | 字面量子串 **`schemaVersion: 2`**（无引号）与 **`sha256:`** |
| `audit-independent/{security,perf}-audit-service.ts` | 正则 `^schemaVersion:\s*(\d+)\s*$` —— 同样是**无引号数字** |
| `services/prd/handoff-service.ts` | YAML **字符串** `"2"` |

而**规范写入器 `stringifyYaml` 产出的是 `schemaVersion: "2"` + 裸 `handoffHash:`** —— **三个里一个都不满足**。

## 后果与实测

`peaks prd handoff init` 跑成功（`applied: true`，sha256 正确），但 `rd → qa-handoff` 立刻报 `prd/handoff.md` 缺失。**把 `schemaVersion: "2"` 改成 `2`、`handoffHash:` 改成 `sha256:<hash>`（正文与哈希一字不动）之后，该前置项立刻消失。** 这就是全部病因 —— 不是内容，是格式。

## 为什么这次会复发（这才是要记的）

**上一个会话（`2026-09-12-session-e37ef0`）已经踩到并完整定位过**，处置是**手写胶囊**绕开，代价是 `peaks prd handoff verify` 认不出该文件。但那段根因分析**只写在 `_runtime/<sid>/prd/handoff.md` 的 NOTE 里 —— 而 `_runtime` 是 gitignore 的**。下一个会话（本次）看不见它，于是原样再踩一次。

**教训比缺陷本身值钱：写在 `_runtime` 里的根因等于没写。** `_runtime` 是当次会话的草稿区，不是记忆。根因要进 `.peaks/memory/`，否则它随会话一起消失，而缺陷留着。

## 怎么用

- 遇到 `rd:qa-handoff` 报 `prd/handoff.md` 缺失、而该文件确实存在且 `peaks prd handoff init` 报成功时：**不要去查正文或路径**，直接查那两个键的序列化。
- 修完要**在文件里写明偏离**（哪个键、为什么、正文与哈希未动），否则下一个读者会以为是手写产物。
- 本轮（`2026-09-13-session-21878f`）就是这么处理的，NOTE 在胶囊顶部。
- **尚未修**：写入器与门禁的格式分歧仍在，每个走到 `rd:qa-handoff` 的切片都要再踩一次。值得单独一片，方向有两种 —— 要么让门禁接受写入器的实际输出（改动小，但把门禁放松到现实），要么让写入器产出消费者要的形式（改动大，但让契约一致）。**两个方向都没有被论证过，别默认选小的那个。**

相关：[[two-components-resolved-the-window-independently]] · [[a-guard-whose-scope-differs-from-what-it-claims]] · [[upgrading-the-package-does-not-refresh-generated-settings]]。
