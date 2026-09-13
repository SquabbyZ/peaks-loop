---
name: check-ci-on-every-push-and-run-wide-tsc
description: 每次 push 后必须查 CI；改 tests/ 前必须跑宽 tsconfig（142 基线有守卫）
metadata:
  type: feedback
  node_type: memory
  originSessionId: 29601951-8e04-4525-8107-125180abe7b4
  modified: 2026-09-11T15:28:41.791Z
---

**2026-09-11 我推了两个红提交却没发现。** `7292dd11` 和 `24fadf92`(4.0.39 后的两条技能修复)
**CI 双双失败**,而我是**在下一批发版时偶然翻 run 列表才看到**。它们失败直到 `e6b8effe` 修掉。

**根因是一条我踩过的旧坑:** 改动只在 `tests/**` 里,我**只跑了 `tsc -p tsconfig.build.json`**
—— 而那个配置**排除 `tests/**`**,所以它看不见。宽 `tsconfig.json` 的基线是 **142**,
我的改动让它变成 **143**。

**并且仓库本来就有守卫**:`tests/unit/slice/slice-check-service.test.ts` 会跑宽 tsconfig 并断言基线,
报 `typecheck errors grew to 143 (pre-existing ...)`。它**抓到了**——是我没看。

**做法（两条,都要）:**
1. **任何 push 之后查 CI。** 别假设"本地绿=CI 绿"。**最省事的时点是刚推完**,
   别等下一批 — 否则红提交会留在历史里,而且在你会话里静默。
2. **改动落在 `tests/**` 时,必须跑宽 `tsconfig.json`**,期望 **142**。
   `tsconfig.build.json`(exit 0)是必要不充分的。

**给用户的判断**:这条属于"绿测试抓不到"家族的近亲 —— **这次不是没有守卫,是我没看守卫的输出**。
区别值得记住:守卫存在 ≠ 我在听。

相关：[[npm-view-reads-a-local-cache]]、[[execsync-goes-through-cmd-on-windows]]
