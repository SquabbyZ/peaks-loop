# 门加固与尺寸债 — 本轮交接

- 日期：2026-10-09
- 分支：`chore/gate-hardening-and-size-debt`（**叠在 `feat/mcp-readonly-surface` 之上，两者都未合并**）
- 会话：`2026-10-09-session-90f47d`
- 状态：**6/6 slices 完成并提交**

> **补记（同日稍晚）**：原写"S3-1 未起"。用户随后决定起 S3-1，且**已在分支 `chore/size-debt-commands-batch1` 上完成并提交**（`c88e38dc`）——命令层首批 5 个文件拆成 38 模块，并把拆分暴露的 **51 个 >50 行函数压到 0**。四项 ceiling 全降：`fileSizeExcessLines 39154→35536`、`fileSizeOverCap 127→122`、`eslintFindings 2094→2055`、`eslintErrors 802→770`。§5 的起手指南**已执行完毕**，其内容对**后续批次**仍然适用。
>
> **一条仍未解决的既有债**：`src/cli/commands` 的 **181 个未改动文件中仍有 231 个 `max-lines-per-function` 违规**——函数长度的债远大于本批触及的范围。

---

## 1. 分支栈

```
chore/gate-hardening-and-size-debt          ← 本轮（3 个提交）
  ├── b3f4f795  chore(gate): let the size ratchets be judged together
  ├── 23fb500d  chore(gate): make the gates able to fail
  └── a53c86ec  docs(mcp): record the design spec and the post-landing roadmap
  └── 72729c3c  chore(memory): reindex
feat/mcp-readonly-surface                    ← 上一轮（3 个提交）
  ├── fdf7807f  feat(mcp): generate the distribution manifest, and wire registration
  ├── 46463f85  feat(mcp): prove a read-only argv surface, then expose it over MCP
  └── (a53c86ec/72729c3c 已随上面带上)
main (8570fce5)                              ← 两条分支的共同基点
```

**合并顺序**：先 `feat/mcp-readonly-surface`，再 `chore/gate-hardening-and-size-debt`。后者假定前者已在。

---

## 2. 已完成并可提交（5/6）

| Slice | 内容 | 提交 |
|---|---|---|
| S5a | 端到端注册实测 | 无代码改动（纯验证） |
| S2a | `peaks-gate staged` 无参须非零 | `23fb500d` |
| S2b | `format:check` 接进 CI 并改为**集合棘轮** | `23fb500d` |
| S2c | 「整套证明不得被 skip 关掉」窄守卫 | `23fb500d` |
| S1 | 单调守卫的**第一个例外**：两尺寸棘轮联合判定 | `b3f4f795` |

**每一刀都走了独立 QA**，且每一处的判据都**经注入验证能被转红**。

---

## 3. 未验证项（**必须随交付一起读**）

| 项 | 原因 |
|---|---|
| **MCP 真实注册（client 侧那一跳）** | 本机 `claude` launcher 连 `--version` 都不返回（真 PE 文件、非沙箱、非 stdin）→ `peaks mcp install` 必然走超时。**需要在能跑 `claude` 的机器上做一次** `peaks mcp install` + 新开会话确认 tool 出现 |
| **CI `format-check` job 在 runner 上实跑** | 本机无 runner。只验了脚本本身 |
| **C 层沙箱**（slice ① 的无网络只读挂载） | CI-only，**从未实跑** |
| **L3 端到端** | `peaks` 在 PATH 上是已安装构建而非工作树 |
| 政策例外的**端到端触发** | S1 不触发再生成；机制只在纯函数层被测。"允许涨" ≠ "已经涨过" |

---

## 4. 路线图进度

`docs/superpowers/specs/2026-10-09-post-mcp-current-state-roadmap.md` §3.5 的五条工作流：

| | 工作流 | 状态 |
|---|---|---|
| **W2** | 门可靠性 | ✅ **已完成**（S2a/b/c） |
| **W4** | 收尾 MCP | 🟡 **部分**（S5a done；S5b/c/d 未起） |
| **政策** | 联合判定 | ✅ **已完成**（S1） |
| **W1a/W1b** | 还债 | ⬜ **未起**（S3-1 是本轮唯一剩下的） |
| **W3** | 工具缺陷（`audit goal` 3.6 KB 截断、`.cmd` 换行参数） | ⬜ 未起 |
| **W5** | 强制链大洞（非 Bash 全 fail-open） | ⬜ 未起（**须单独立项**） |

---

## 5. S3-1 起手指南（下一轮直接可执行）

### 目标
从 `src/cli/commands` 拆第一批超限文件（该目录 **45 个超限文件**，全仓最大聚落）。

### 选哪几个（按超出额排序，取前 5–8）
```
825  src/cli/commands/loop-eval-commands.ts
750  src/cli/commands/dispatch-commands.ts
718  src/cli/commands/workflow-commands.ts
688  src/cli/commands/compact-command.ts
637  src/cli/commands/code-runtime-commands.ts
```
（前 25 与命令层的并集是 **60 文件 / 25,283 超出行 ≈ 全债 52,079 的 48.5%**）

### 每批的验收标准
1. **拆分必须一次拆到底**：每一份都 <300 行。**例外**：S1 已放行"`overCap` 涨且 `excess` 严格降"，故**允许**中间态，但**要报出**两个数的变化
2. **等价性**：搬迁块逐字或仅重命名/具名常量；给出等价证据（同 slice ② 的做法）
3. **`gate repo` 绿**；`fileSizeExcessLines` **须下降**（这是收益的唯一度量）
4. **零回归**：既有测试全绿（宿主失败逐条点名）
5. 交付前必跑：`pnpm format:check` · `node .husky/peaks-gate.mjs repo` · `npx tsc --noEmit`

### 硬约束（血换来的）
- **新文件 ≤300 行**；`.husky/**` 有独立 cap 与 ceiling 对
- **不要跑 `node .husky/peaks-gate-baseline.mjs`**，除非确实新增了 gated 文件（跑完后**逐条报告每个 ceiling 的升降**，且 `fileSizeExcessLines` 不得上升）
- 不得扩大 `_no-mcp-source-import-scan` 的豁免
- **归类纪律**：报失败时**分开答**——「文件是否被本工作碰过」与「回归是否由本工作引入」。本运行里混同过 **7** 次（含编排器自己 3 次）

---

## 6. 本轮的教训（已沉淀进 `.peaks/memory/`）

| memory | 一句话 |
|---|---|
| `pass-shaped-output-that-verified-nothing` | **四次**"绿了但什么都没验"：`skipIf` 让证明消失、自失效 fixture、无参门 exit 0、`format:check` 与 pre-commit 范围错位 |
| `subagent-evidence-must-hold-at-delivery-state` | 证据须在**交付态**可复现；"文件旧" ≠ "回归不是新的"（本运行 7 次） |
| `mcp-e2e-verified-by-official-schema-not-by-sdk` | 手写协议实现用**官方 schema** 验符合性；本机 `claude` 不可非交互执行 |
| `proof-gated-by-skipif-can-vanish-and-report-success` | 证明装置的入口守卫**不得用 skip** |
| `prd-must-not-turn-unproven-assumptions-into-must` | PRD 不得把**待证明的假设**写成 MUST |
| `peaks-audit-goal-output-truncates-at-3-6kb` | `peaks audit goal` 输出上限约 3.6 KB，撑不到 spec 规模 |
| `peaks-cmd-shim-fails-on-newline-arguments` | Windows `.cmd` shim 吃不下含换行的参数 |
| `peaks-code-role-artifact-lifecycle-gotchas` | 角色工件须先 `request init`；qa 终态是 `verdict-issued`；`TYPE_SANITY` 是时序门 |

---

## 7. 一条**站立的观察**（未修，非本轮引入）

- `tests/**` 的 comment-hygiene 违规（6 narrative + 1 dead-ref）**不被任何门监视**——门的 `scope.dirs` 只含 `src` + `packages/*/src`。与 `format:check` 的范围问题同族。
- `gate enforce` 对**所有非 Bash 工具** fail-open（含 Write/Edit/所有第三方 MCP server）——面比 MCP 那刀大两个数量级，**须单独立项**。
- `git stash pop` 被 worktree gate 拒（`WORKTREE_USER_AUTH_REQUIRED`），而 `stash drop` 不被拒——实测。
