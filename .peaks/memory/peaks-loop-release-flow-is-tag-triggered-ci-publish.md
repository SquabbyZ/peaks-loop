---
name: peaks-loop-release-flow-is-tag-triggered-ci-publish
description: peaks-loop 发布流程 = 本地 bump + push main + 等 CI 绿 + 打轻量 tag + CI 用 OIDC 发布；不是本地 npm publish
metadata:
  type: project
  node_type: memory
  originSessionId: cba36372-fa93-4b11-86c2-d29b1d3edba9
  modified: 2026-09-12T03:56:15.830Z
---

peaks-loop **不在本地 `npm publish`**。发布由 `.github/workflows/publish.yml` 完成,触发条件只有两个:`push tag v*.*.*` 或 GitHub UI 手动的 `workflow_dispatch`。

**完整链条**(2026-09-12 实发 4.0.43 走通):
1. 本地改版本号 + 写 CHANGELOG,commit 为 `chore(release): X.Y.Z — <一句话>`
2. `git push origin main` → 触发 **ci.yml**(ubuntu + windows,node 22)
3. **等 CI 绿**(别跳;tag 之前必须绿)
4. `git tag vX.Y.Z <release-commit>` 然后 `git push origin vX.Y.Z` → 触发 publish.yml
5. publish.yml 跑 `install → build → vitest → 条件 changeset → scripts/release-pack.mjs`,用 **OIDC Trusted Publishing** 发 tarball
6. `npm i -g peaks-loop@X.Y.Z`

**版本号要改 9 处**(规则从 4.0.42 发布 commit `fba04265` 反推):root `package.json`;`packages/peaks-loop-shared/src/version.ts` 的 `CLI_VERSION`;`packages/peaks-loop-internal-runtime/src/index.ts` 的 `RUNTIME_VERSION`(这两个跟 root 走);**四个子包各自的 `package.json` 各自 patch +1**(它们版本号与 root 无关:internal-runtime 0.0.x、mut 0.1.x、shared-channel 0.0.x、shared 0.0.x);`README.md` + `README-en.md` 的版本行。加 CHANGELOG 共 10 个文件。

**第三个容易踩的点（2026-10-10 实测）**: **bump 之后、跑任何测试之前，必须先 `pnpm build`。**
`bump-version.mjs` 会改 `packages/peaks-loop-shared/src/version.ts` 与
`packages/peaks-loop-internal-runtime/src/index.ts`，而 `packages/*/dist` 是**独立发布的产物**、
**不经 alias 指向 `src/`**。于是 `tests/_global-setup/packages-build.ts` 会**拒绝启动套件**：

```
Test suite refused to start: 2 workspace package(s) have a dist/ that was not built
from their current src/.  stale: packages/peaks-loop-internal-runtime/dist, packages/peaks-loop-shared/dist
```

CLI 自己的 CI 流水线里有 build，所以**只有本地会撞**。看到 `refused to start` 不要去查那些"失败"的测试
——它们根本没跑；先 `pnpm build`。

**两个容易踩的点**:
- `tag` 是**轻量 tag**(`git cat-file -t v4.0.42` → `commit`,不是 `tag`)。别用 `-a`。
- `.changeset/` 里**只有 config.json(无待发条目)时**,publish.yml 走"按已提交清单版本原样发布"分支 —— 所以手动 bump 是正确的。若有 `.changeset/*.md`,它会跑 `changeset version` 重新推导版本,会覆盖你的手动 bump。

**第四、第五个容易踩的点（2026-10-10 发 4.1.4 时实测）**:

- **`npm notice Your package is being processed and may take a few minutes to become available.`**
  发布步骤 59 秒跑完、`[release-pack] OK peaks-loop@4.1.4`、job 绿——而**此刻 registry 上还查不到**：
  `dist-tags.latest` 仍是上一版、`time.modified` 不动。复制完成前查 registry 会得出**错误的**结论
  （我当时判断成"报了成功却什么都没做"）。**发布后先等几分钟再核**，npm 自己会这么说。
- **`publish.yml` 的 `gate-capability-baseline`（step 14）在同一个 commit 上可以一次红、一次绿。**
  4.1.4 的 attempt 1 报 `verdict=drifted failing=[J03]`、attempt 2（**同一个 `ab17864b`、
  无任何代码改动**）报 success。J03 是"`src/**` 里没有重新引入 silent-catch"这条不变量，
  实现为跑 `scripts/lint/silent-warning-detector.mjs` 并对比冻结棘轮
  `capability-guard-runner/contracts/J03.ts` 的 `{ 'catch-return-null': 41, 'empty-catch': 59 }`。
  本地同一条 detector 报 **41 / 58 —— `catch-return-null` 余量为零**。
  **一个能对同一 commit 给出两种裁决的门不是门**；而一个零余量的棘轮本来就不该是零余量。
  要不要重跑卡住时，这条是依据。

**为什么不用 `npm publish`**:pnpm workspace 包里 `workspace:*` 会被原样序列化进 tarball,registry 视为不可解析,导致 `npm i -g peaks-loop` 报 ENOTFOUND。`release-pack.mjs` 用 `pnpm pack`(等价 `--no-workspace`)把它们变成精确 semver。验证发布成功要顺带查这个:`curl registry.npmjs.org/peaks-loop` 看 4.0.43 的 dependencies 里有没有 `workspace:*`。

**验证要走到哪一步**:`peaks --version` 只是第一层;真正要验的是**今天的修复在已发布构建里能用**(例:4.0.43 验了 `peaks scan api-diff` 出现在 help、`ecc-hooks-schema-drift` 出现在 doctor、`peaks test <file>` 不再 ENOENT)。

**权威口径**:核对发布要看 registry(`curl registry.npmjs.org/...`),不要只信裸 `npm view` —— 它会读本地缓存。相关:[[npm-view-reads-a-local-cache]] · [[check-ci-on-every-push-and-run-wide-tsc]]
