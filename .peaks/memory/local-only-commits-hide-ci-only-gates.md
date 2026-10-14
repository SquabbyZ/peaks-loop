---
name: local-only-commits-hide-ci-only-gates
description: 提交只在本地累积时，只在 CI 跑的门从未运行过——第一次推送会一次性暴露积压；发版前必须查 CI
metadata:
  type: lesson
  createdAt: 2026-10-14
---

# 本地独积 ⇒ CI-only 的门从未跑过

## 事实（2026-10-14，4.1.5 发版）

发 4.1.5 时，`origin/main` 落后本地 **125 个 commit**——这批工作从未推送，因此 **CI 从未见过它们**。第一次推送（`b3468ac5..2e8c8b6a`，62 个 commit）之后，`ci` workflow 在 `main` 上**连续五次全红**（`2e8c8b6a`、`f50210ef`、`889eb709`、`15def424`、`c8dd42f0`）。

失败点是 `tests/unit/cli/commands/request-init-session-resolution.test.ts` 的两个用例（windows + macos 双平台红，本地绿），根因文件由 `fbe0c8df` 引入——**那个 commit 在未推送区间内**。也就是说：**红点可能落在区间中任何一处，而且与"当前正在做的改动"无关。**

发版 runbook 的 pre-flight 第一条就是「CI 在最新 main 推送上是绿的」。**这一条被跳过了**：只查了本地门（`pnpm test:unit` 三连绿、`build-integrity: OK`、version parity 双绿、release-pack dry run 干净）。**本地全绿与 CI 全红可以同时成立**，因为两者跑的不是同一组检查。

## Why

本地门与 CI 门是**不同的集合**：

- format 棘轮**只在推送/CI 跑**（2026-10-14 另一次实测：`47863518` 留下的两个未格式化文件，61 个 commit 期间无任何本地门看见）；
- `tests/integration/**` **不在默认 vitest 配置里**，只有 CI 跑；
- CI 用 `npx vitest run` 且带 `TZ: UTC`，还先跑 Build 与若干棘轮 job；
- 本地机器有 CI 没有的东西：仓库自己的 `.peaks/_runtime/session.json`、已构建的 `dist/`、以及上一次运行的残留。

所以「本地绿」证明的是**本地门这一集合**，而不是 CI 门那一集合。区间越长，两个集合的差集越大。

## How to apply

- **发版前第一条要查的不是 tree，是 CI**：`gh run list --limit 6` 看最新一次 `main` 上的 `ci` 是否 `success`。若最近几次有 `failure`，先定位再发——**不要把发版叠在一个已经红着的 main 上**。
- **推送频率决定门的有效性**。任何"只在推送/CI 跑"的门，其覆盖率与推送频率成反比；长期不推 = 那道门长期没跑。定期推送（哪怕只是为了跑门）比一次性攒大批更安全。
- **区间内出现 CI-only 红点时，先按 `git log <last-green>..HEAD -- <失败文件>` 定位引入 commit**，再判断是否与当前工作有关——不要默认是自己刚才改的。
- 同族：[[push-needs-ssh-keepalive]]（推送本身的坑）、[[full-suite-load-flakes]]（CI 红的另一类成因：负载 flake，判据是"单独跑是否通过"）。
