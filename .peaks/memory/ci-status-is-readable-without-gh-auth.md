---
name: ci-status-is-readable-without-gh-auth
description: 本机 gh 未登录，但 CI 的 check 状态与失败断言可以用两个未认证的公开 API 读到；且 tests/integration 只跑 ubuntu，Windows 绿不代表它绿
metadata:
  type: reference
  node_type: memory
  originSessionId: e0ac1231-9059-438e-b036-c6cae372eb87
  modified: 2026-09-15T12:30:00.000Z
---

**本机 `gh` 未登录**（`gh auth status` → not logged in），但 `SquabbyZ/peaks-loop` 是**公开仓库**，所以 CI 状态**不需要认证**就能读到。2026-09-15 实测两个端点都是 `http=200`：

```
GET /repos/SquabbyZ/peaks-loop/commits/<sha>/check-runs
      → 四个 check 的 status/conclusion（含 name，能分辨 ubuntu / windows job）
GET /repos/SquabbyZ/peaks-loop/check-runs/<check_id>/annotations
      → **失败断言的文件与行号**，以及 message
```

**`/check-runs/<id>/annotations` 是关键的那个** —— check-run 自己的 `output.summary` 和 `output.text` 都是**空的**，唯一能看到"哪个测试挂了、挂在第几行"的地方就是 annotations。

**别用 `/repos/.../actions/runs`** —— 未认证下返回 `http=000`（连不上），这条路上没有信息。

未认证 core 速率上限 60/小时，够用。

## 两个会让人误判的坑

**一、`tests/integration/**` 不在 Windows 上跑。** `ci.yml:121-125` 明写：默认 `test` job 的 config `include` 是 `tests/unit/**`，并**排除** `tests/integration/**`；integration 是**独立的 ubuntu-only job**。所以 **`vitest + build (windows-latest)` 绿，对 integration 说明不了任何事**。本机所有本地验证都是 Windows —— 一次 ubuntu-only 的失败就是这样漏过去的。

**二、`trusted-publish` 的 check-run 可以在 registry 公开视图更新之前就报 `completed/success`。** 2026-09-15 实测：publish job 12:10:00 报成功，而两个子包在 12:12:42 / 12:13:27 才出现在 `registry.npmjs.org` 上（公开读路径滞后 2–3 分钟）。**从滞后读数下"发布失败"的结论会错。**

## 怎么用

- 推完要判 CI，直接 curl 那两个端点，不要因为 `gh` 没登录就放弃。
- 看到某种 job 绿，**先确认它跑的是哪套测试**（`grep -n 'include\|exclude\|config' .github/workflows/ci.yml`），再决定这个绿能不能作为证据。
- 判"发布成功"要看 **registry**（`curl registry.npmjs.org/peaks-loop`），并且**等公开视图收敛**；顺手核 `workspace:*` 有没有泄漏进 dependencies。

相关：[[peaks-loop-release-flow-is-tag-triggered-ci-publish]] · [[npm-view-reads-a-local-cache]] · [[check-ci-on-every-push-and-run-wide-tsc]] · [[a-lone-ts6053-is-an-abort-not-a-clean-tree]]。
