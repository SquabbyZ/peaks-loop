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

**两个容易踩的点**:
- `tag` 是**轻量 tag**(`git cat-file -t v4.0.42` → `commit`,不是 `tag`)。别用 `-a`。
- `.changeset/` 里**只有 config.json(无待发条目)时**,publish.yml 走"按已提交清单版本原样发布"分支 —— 所以手动 bump 是正确的。若有 `.changeset/*.md`,它会跑 `changeset version` 重新推导版本,会覆盖你的手动 bump。

**为什么不用 `npm publish`**:pnpm workspace 包里 `workspace:*` 会被原样序列化进 tarball,registry 视为不可解析,导致 `npm i -g peaks-loop` 报 ENOTFOUND。`release-pack.mjs` 用 `pnpm pack`(等价 `--no-workspace`)把它们变成精确 semver。验证发布成功要顺带查这个:`curl registry.npmjs.org/peaks-loop` 看 4.0.43 的 dependencies 里有没有 `workspace:*`。

**验证要走到哪一步**:`peaks --version` 只是第一层;真正要验的是**今天的修复在已发布构建里能用**(例:4.0.43 验了 `peaks scan api-diff` 出现在 help、`ecc-hooks-schema-drift` 出现在 doctor、`peaks test <file>` 不再 ENOENT)。

**权威口径**:核对发布要看 registry(`curl registry.npmjs.org/...`),不要只信裸 `npm view` —— 它会读本地缓存。相关:[[npm-view-reads-a-local-cache]] · [[check-ci-on-every-push-and-run-wide-tsc]]
