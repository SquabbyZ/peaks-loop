---
name: ci-green-restoration-2026-09-08
description: ci.yml 从未真正跑通；修 pnpm/typecheck/node20/callerId + 3 个 Linux-only 测试 bug，CI 首次全绿
metadata:
  type: project
  node_type: memory
  originSessionId: 90742f29-4074-4c14-acd7-2984851a606f
  modified: 2026-09-08T14:16:18.277Z
---

# CI 首次全绿（2026-09-08）

**Date:** 2026-09-08（session 2026-09-07-session-245530）

## 背景：ci.yml 此前**从未**跑到过 Test 步骤

第一个门 `pnpm/action-setup@v4` 在 runner 默认 Node 24 上 self-installer 失败（publish.yml 注释早已写明 @v4/@v6 都失败），所以后面所有步骤都是"从未验证"的死代码。修好第一个门后，一连串 pre-existing 问题逐个暴露。

## 五层修复（commit ce05fccc → ac7d22b5）

1. **`pnpm/action-setup@v4` → corepack**（`corepack enable && corepack prepare pnpm@10.11.0 --activate`），对齐 publish.yml。
2. **删掉 Build 之前的 `npx tsc --noEmit` 步骤** — 它用根 tsconfig（include `tests/**` + `~` 别名），裸 tsc 解析不了；更致命的是它跑在 `packages/*/dist` 生成之前，而 `peaks-loop-shared/version` 等 subpath 指向 **dist**。canonical typecheck 是 `npm run build` 里的 `tsc -p tsconfig.build.json`。
3. **移除 node 20.x 矩阵**（windows-latest + 20.x 的 pnpm install 红，日志 admin-only 无法诊断；publish.yml 也是 node 22）。
4. **capability-guard 加 `PEAKS_CALLER_ID: ci-runner`** — J02 等 contract 会 spawn `bin/peaks.js`，CI 无 IDE adapter env → callerId 解析走 D2/EX_USAGE(exit 64)。`resolve-caller-id.ts` 注释明说这是给 CI 的 vendor-neutral override。
5. **3 个 pre-existing Linux-only 测试 bug**（见下）。

## 关键教训

### Lesson 1 — "CI 一直红" 要区分"红在第一个门"和"红在真失败"
一个 fail-fast 的早期门会让后面所有步骤成为未验证的死代码。修好第一门后必须逐个重新验证，不要假设"后面的应该没问题"。

### Lesson 2 — 拿不到 CI 日志时，让 CI 自己产出可读证据
本仓库 job 日志 admin-only（REST `/logs` 403、HTML 需登录）。解法：给 vitest 加 `--reporter=github-actions`，失败变成 **check-run annotation**，而 annotations API **无需 admin 即可读**（`/repos/<o>/<r>/check-runs/<jobid>/annotations`）。这比反复猜快得多。

### Lesson 3 — `setImmediate` 里读可变模块级变量 = 延迟读取竞态
反模式：
```ts
afterEach(() => { setImmediate(() => rmSync(workspace, ...)) });  // workspace 是可变的 let
```
回调执行时 `workspace` 可能已被下一个测试的 beforeEach 重新赋值 → 删掉**活着的**目录 → `ENOENT: uv_cwd`。Linux 调度下必现、Windows 下不触发。正确写法（`tests/unit/_setup/tmp-workspace.ts` 已有）：`const ws = active` 先捕获，闭包里用 `ws.path`。

### Lesson 4 — 平台写死的断言要在 CI 上暴露
`expect(firstCall[0]).not.toBe('npx')` 只在 win32 成立（`npx-resolver.ts` 在 POSIX 按设计返回裸 `npx`）。Windows 本地跑永远绿。

### Lesson 5 — 用 Docker 复现 Linux-only CI 失败
Windows 本地复现不了的 CI 失败，起一个常驻容器（`docker run -d ... sleep infinity` + 挂载源码 tar 同步）即可忠实复现，且可反复迭代，不必每次重装依赖。注意：容器里要补 `.git` 和 `npm run build`，否则会引入假失败（`git ls-files` 依赖、`dist/cli/index.js` 依赖）。

## 验证

- CI run `34236577415`（commit `ac7d22b5`）**全部 3 个 job success**（binding-store / windows / ubuntu）——本仓库首次全绿。
- 双平台独立复跑：Linux 容器 119 files / 1010 passed；Windows 119 files / 1014 passed。

## 反模式（不要做）
- 不要用 `pnpm/action-setup@v*` 装 pnpm（Node 24 runner 上 self-installer 必挂）→ 用 corepack。
- 不要在 workspace 子包 build 之前跑根 tsc typecheck（subpath 指向 dist）。
- 不要在 CI 里省略 `PEAKS_CALLER_ID` 就调用会 spawn CLI 的测试。
- 不要在 `setImmediate`/`setTimeout` 回调里读可变闭包变量做清理。

相关：[[codegraph-dangling-marker-autorefresh-fix]]
