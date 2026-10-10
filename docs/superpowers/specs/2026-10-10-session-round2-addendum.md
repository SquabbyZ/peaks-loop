# 交接补记 — 4.1.4 已发布，以及开工 4.1.5 前你要知道的事

- 日期：2026-10-10
- 本补记的读者：**下一个 session**（它看不到产生它的那场对话）
- 正篇：`docs/superpowers/specs/2026-10-10-session-round2-handoff.md`

---

## 0. 状态

| | |
|---|---|
| **4.1.4** | **已发布**（`registry.npmjs.org` 上 `latest = 4.1.4`；无 `workspace:*`；有 provenance）。本机全局亦为 4.1.4 |
| `origin/main` | `201fb6c3` |
| **本地待推** | `b9b5ca69`（把 format 棘轮接进 pre-push）+ 本补记。**owner 说稍后一起推** |
| 工作树 | 干净 |

**待推的两个提交不影响任何已发布内容**——4.1.4 是 `ab17864b` 的构建。

---

## 1. 开工前必读：pre-push 现在是**三条腿**，而第一条可能当场拦住你

```
set -e
node .husky/format-check-ratchet.mjs      ← 新增（本补记同一批）
node .husky/peaks-gate.mjs changed
pnpm test:changed -- origin/main
```

**第一条是全树的格式化 set 棘轮**（"未格式化集合必须留在 `FORMAT_CHECK_BASELINE_FILES` 那 12 个名字之内"，
集合外的文件会被点名）。**这是刻意的**：同一个检查在 2026-10-10 一个晚上咬了这个仓**两次**——
两次都是新增文件未格式化，而推送门看不见（腿 2 是逐文件 eslint 棘轮，腿 3 跑子集，
而 format 棘轮**此前只在 CI 上跑**）。

**所以**：新加文件后，推送前跑一次 `pnpm format:check` 并**数名字**（应为 12）。修法是
`node node_modules/prettier/bin/prettier.cjs --write <file>`——**只格式化你新增的**，
那 12 个是刻意容忍的债，不是你的活。

**第二条腿对 `.husky/**`、`docs/**` 这类"映射不到任何测试"的改动会退化成全量**。这是对的
（"映射不到"不等于"0 个测试"），但要知道改个 hook 的推送代价是约 6 分钟。

---

## 2. 仍然开着的：**J03 的非确定性**（下次它红时，你有一件新工具）

`publish.yml` 的 `gate-capability-baseline` 在**同一个 commit** 上给出过两种裁决：
4.1.4 的 attempt 1 报 `verdict=drifted failing=[J03]`，attempt 2（零代码改动）通过。

- J03 的不变量 = "`src/**` 里没有重新引入 silent-catch"
- 实现 = 跑 `scripts/lint/silent-warning-detector.mjs`，对比
  `src/services/capability-guard-runner/contracts/J03.ts` 里冻结的
  `{ 'catch-return-null': 41, 'empty-catch': 59 }`
- 本地同一条 detector 报 **41 / 58**（在边内）

**J03 的契约有六条 probe，而此前 audit 只报 `failing=[J03]`——六条塌缩成一个词。**
已修（`adb3c67c`）：`::error` 现在带 `detail=[J03(…失败 probe 原文…)]`。

**所以下次它红，第一件事是读那条 detail**——它会直接点名是六条里的哪一条。
**在拿到那条证据之前不要改那道门**；这一轮的全部教训就是"别改一块你还没看懂的东西"。

我的首要假设（**未证实**）：负载重的 runner 上 `spawnSync(node, [detector])` 失败 ⇒
`stdout` 空 ⇒ `parseCounts` 返回 null ⇒ 第 3/4 条 probe 失败——即
**"这条守卫跑不起来"被报成了"这条守卫发现了漂移"**。仓里有一条同名的 memory
（`a-detector-that-cannot-run-is-a-gate-failure-not-a-zero`），而那段文字**真的在 CI 日志里出现过**。

---

## 3. 这一轮撞出来、下次会再撞到的陷阱

1. **`git add -A` 必须在跑套件之前。** census 读 `git ls-files`——新增文件未跟踪时**整条门都看不见它**，
   于是你得到**假绿**，`git add` 之后两条守卫（`file-size-cap` F4 + `scope-shadow-coverage`）才变红。
   这一轮咬人**三次**，最后一次咬的是一位子代理。
2. **`tests/integration/**` 本地永远不跑**（不在默认 vitest 配置里）。CI 上一个 macOS/Windows 的
   真实失败就是这样藏了一整轮。
3. **hash 看不见两样东西**：函数体，和被丢掉的 re-export。这一轮的后半段证明过——评审在函数体里
   植入改动、两个哈希纹丝不动；而一个 façade 静默丢掉 5 个类型时，所有测试与两个等价性 harness 全绿。
4. **已安装构建的版本串与工作树相同时，本地 e2e 覆盖可能是零。** 实测：8 个未推送提交新增的
   161 个 `src/` 文件**全部不在已安装 dist 里**，而两边都报同一个版本号——**没有任何信号提示你**。

---

## 4. 一条硬约定（本轮的产物，已进 `.peaks/memory/`）

**子代理的 scratch 只放 `.peaks/_runtime/<sessionId>/rd/scratch/`，仓外任何路径都不行。**
理由不是整洁：`.peaks/_runtime/` 被 gitignore，所以那里对 `git status` **和** census 同时不可见。
**仓外路径也能达到同样的不可见性**——所以只写"路径"不够，要写"边界 + 理由"。
本轮的 D0：五个批次里四个推断对了，一个写到了 `D:\projects\peaks-loop-scratch`，**而它没有违反任何规则，
因为没有任何规则说过边界**。

---

## 5. 发布流程的三个新坑（`peaks-loop-release-flow-is-tag-triggered-ci-publish.md` 已补）

1. **bump 之后、跑任何测试之前必须先 `pnpm build`**——bump 会改 `packages/*/src`，而
   `packages/*/dist` 是独立产物、不经 alias 指向 src，套件会**拒绝启动**（不是失败，是拒绝）。
2. **发布后不要马上查 registry**——npm 自己会说 "Your package is being processed and may take a few
   minutes"；复制完成前查会得出**错误的**结论（本轮我就这么错过一次）。
3. **`gate-capability-baseline` 可能瞬时红**（见 §2），重跑是正当的，但**要看 detail**。
