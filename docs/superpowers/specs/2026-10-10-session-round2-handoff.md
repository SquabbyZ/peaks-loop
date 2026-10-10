# 交接 — 2026-10-10 第二轮：门分类器 + src 尺寸还债 + 边界取证

- 日期：2026-10-10
- 分支：`main`（**8 个提交未推送**，`origin/main...main = 0 8`）
- 上一个会话：`2026-10-09-session-90f47d`；本会话：`2026-10-10-session-062f74`
- 起点：`a7204b1e`，工作树干净，`peaks-loop@4.1.3` 已在 npm
- 模式：peaks-code **24h mode**（用户睡前指定："1、2、3、4按照顺序执行，期间你可以根据每个任务完成的结果进行动态的调整开发任务"）

---

## 0. 你要先知道的一件事

**这 8 个提交没有被任何 CI 验证过。** 它们是未推送的，`head_sha=HEAD` 在 Actions API 上返回
`total_count: 0`。上一次有 CI 证据的运行是 `a7204b1e`（成功）。所以本轮的**全部**证据是本地证据：
逐提交独立重跑的全量单测 + 门 + tsc。**推送之前，先按 §5 的清单过一遍。**

---

## 1. 四个 slice 的成果

| slice | 内容 | 提交 |
|---|---|---|
| 1 | 推送门分类器：让"新增 gated 文件却漏了基线行"无法过关 | `be592be7` |
| 2 | `src/cli/commands` 尺寸债：**30 文件 → 0 超帽** | `339746bb` `0fc7139e` `6eaaebdb` `feea6094` `a1f0911d` |
| — | 本轮的 rule-D 回归修复 | `04c04aeb` |
| 3 | `src/services` 三个最严重文件 | （见提交链末） |
| 4 | 三项"未验证边界"的取证 | 无代码改动（证据在 gitignored 的 `.peaks/_runtime/`） |

### 棘轮（**全程只降不升**）

| | 起点 | 终点 | Δ |
|---|---|---|---|
| `fileSizeOverCap` | 112 | **79** | −33 |
| `fileSizeExcessLines` | 30352 | **22677** | **−7675** |
| `eslintFindings` | 1951 | **1764** | −187 |
| `eslintErrors` | 709 | **590** | −119 |

`src/cli/commands`：300 跟踪文件 → **440**，其中超帽 **30 → 0**。

---

## 2. Slice 1 走了三轮，而中间那轮是本轮最有价值的事

1. **001 实现**：前提正确，但**引入了一个阻断级假绿**。
2. **002 修复**：5 路评审 fan-out 中**四个独立来源**（karpathy / security / perf / 我自己的复现）
   撞上同一个缺陷。
3. **003 修复**：QA 判 PASS 之后仍挖出两处，其中一处我判定值得再修一轮。

### 被拦下的那个缺陷，值得读两遍

第一版把"人口守卫"加进了**选择集**，而选择集一旦非空，`picked.size === 0 → 跑全量` 那张网
就永远不触发。后果：

| diff | 旧行为 | 第一版 |
|---|---|---|
| `A .github/workflows/x.yml` | 全量 | `subset [13 个守卫文件]` |
| `A .husky/<新钩子>` | 全量 | `subset` |
| `A README.md` | 全量 | `subset` |

**有 5 个测试文件读 `.github/`**（实测 `grep -rln '\.github/' tests/unit/`）。所以"新增一个 CI
workflow"会**一个相关测试都不跑**——与本 slice 存在的理由完全相同的一类假绿。

**而 AC5 的验收臂看不见它**，因为那条臂用的正是 `M README.md`——唯一还能漏下去的形状。**臂是绿的，
行为没了。**

修完之后的形状（`scripts/test-changed-classify.mjs`）：守卫是**映射的加法，不是全量网的替代品**。

### 三条规则

- **R1** 基线内容真的动了 → 跑它的守卫套件（`tests/unit/standards/` + `tests/unit/lint/`）
- **R2** `A`/`D`/`R`/`C` → 跑人口守卫（按 git **status** 判定，不重述 census 的策略目录）
- **R3** census 的**策略源文件**被改 → 同样跑（`M src/services/scan/file-size-policy.ts` 会让 44 个
  `.md` 突然进 scope，而 F4 守卫本来不会跑）

**只有 `generatedAt` 动了的重生成是惰性的**——0 测试，并且**这次理由是真的**。旧豁免的理由
（"没有测试读它"）是假的：`tests/unit/standards/_file-size-cap-scan.ts:64` 的 `BASELINE_PATH`
正指向它，而 2026-09-23 那次搜索找的是**路径字符串**，看不见常量间接引用。

---

## 3. Slice 4 三项判定

| 项 | 判定 | 要点 |
|---|---|---|
| `format:check` 在 runner 上实跑 | **已验证** | 仓库是 public，Actions Jobs API 无需鉴权。run `37963241320` 的 job `format set ratchet` → **step 6 success（非 skipped）**。且"因为没东西可量而变绿"这条路被关掉了：`prettier --list-different` 匹配空集退出 **2**，ratchet 拒绝非 1 退出。**局限**：该 step 的日志文本不可读，"它评了 12 个名字"是从退出码推断的 |
| L3 端到端 | **已验证（事实）／判断为 (b)，范围有限** | PATH 上的 `peaks` 是 nvm **hardlink shim** → 已安装 4.1.3，**不是**工作树的 `bin/peaks.js`。**静默漂移是真的**：8 个未推送提交新增的 **161 个 src 文件全部不在已安装 dist 里**，而两边**都报 4.1.3**——版本串区分不了。**后果**：今晚每一个 `peaks …` 跑的都是**拆分前**的构建，所以拆分引入的 CLI 层回归会**完全不可见**；而因为版本号相同，**没有任何信号提示你**。门读数（工作树 `node .husky/*.mjs`）与磁盘编排状态**不受影响** |
| `COUPLED_SIZE_RISE` 端到端 | **已验证，双向** | 放行：overCap 79→**80**、excess 22677→**22661**（−16）→ **exit 0，写了**，打印 `ROSE, AND THIS RATCHET PERMITS IT`。拒绝：overCap +1、excess **+3**（都升）→ **exit 1，`Nothing has been written`**，sha 未变。**安全阀是有条件的，不是随手给的。** 实验后 sha256 逐字复原、`git status --porcelain` 为空（**验证过，不是声称**） |

**L3 那条值得单独记住**：一个"版本号相同但内容不同"的安装，会让本地 e2e 覆盖**看起来存在而实际为零**。

---

## 4. 本轮自己被验证过的两个防漏手段

1. **声明面对比**（slice 3 的 AC10）。用 TS checker 解析导出面，**抓住了第一版 façade 静默丢掉的
   5 个 re-export 类型——而所有测试与两个等价性 harness 全绿**。注册表/行为哈希看不见这一类丢失。
2. **全量单测**。`tests/unit/runtime/no-runtime-input-guard-rule-d` 是一条**跨切面结构守卫**，batch 1
   破坏了它，而它**穿过了三个批次、两个提交**——因为每一批的验证都是**区域**范围的，而它不在任何
   一批的"相关区域"里（见 §6.1）。

---

## 5. 你醒来后该做的（按顺序）

1. **推送前先跑一次全量**：`node node_modules/vitest/vitest.mjs run > /tmp/f.log 2>&1; echo $?`。
   本轮的最后一个提交已独立跑过并绿（427 files / 4487 passed / 3 skipped），但 body 级审计
   （§7）可能又改了测试。
2. **`git push origin main`**——不要单推 tag（交接文档 §2.3 的老问题仍在：单推 tag 的空变更集会被
   本仓 pre-push 门拒绝，所以本仓历史上是 `git push origin main vX.Y.Z` 一起推）。
3. **看一次 CI**，因为本轮**零** CI 证据。
4. **决定是否发 4.1.4**：本轮只动 `src/` 与 `scripts/`、`tests/`，`package.json` 版本未动。

---

## 6. 我在本轮犯的错（都当场抓住了，但值得写下来）

1. **区域范围验证漏掉了跨切面守卫。** 这是我最实质的错误：batch 1 之后我没有跑过全量，
   于是 rule-D 的红穿过了两个提交。**修正**：从 batch 4 起每批都跑全量。**这是本轮母题
   （"没跑的守卫不等于通过的守卫"）发生在我自己身上的样子。**
2. **把 `vitest` 管道给 `tail`——两次。** 第一次拿到的是 `tail` 的退出码（vitest 报 `1 failed`
   而通知说 exit 0），第二次把失败详情一起截掉了，只能重跑 320s。
3. **把窗口内的性质说成了全链的性质。** 我说"ceiling 单调下降"，而 slice 2 评审实测全链有**三处上升**
   （全在 slice 2 之前）。窗口内成立，全链不成立。
4. **用一个粗暴 grep 自检红线，报了假警。** `grep -i claude` 命中了提交信息里的路径
   `` `~/.claude/settings.local.json` ``。**真检查是 `no-ai-co-author-trailer.test.ts`**（当时 7/7 绿）。

---

## 7. 未完成 / 后续项

### 7.1 头号：等价性证据是"一个维度重复了五次"（body 级审计**正在跑**）

slice 2 评审用**自造探针 + 8 处刻意差异**证明：那五个相同的注册表哈希**看不见函数体**，而拆分
**恰恰改了函数体**。它实测种入 `releaseLease` 内部的 `dockerRmFailed`→`dockerRemoved` 与删掉
`docker rm` 的 `--force`，**注册表哈希与行为哈希都不动**。

另外两条它测出来的硬事实：
- **"action delegate arity" 那一行是死字段**：Commander 把每个 `.action(fn)` 包成内部
  `(args) => {}`，`_actionHandler.length` 恒为 1。那一行"证据"是空的。
- **"aliases" 行同样是常量**（518 个命令里 0 个有 alias）。

本会话结束时已派出一轮审计（Part A 枚举五个批次的**非搬迁改动**、Part B 分类"跑过 vs 只是读过"、
Part C 对**声明为未驱动**的路径补直接调用测试）。**结果在 `.peaks/_runtime/2026-10-10-session-062f74/qa/unproven-edit-audit.md`**
——你醒来时应当已经在里面；若为空则说明那一轮没跑完，按该文件里的方案自己续。

**注意**：请求 011 与 012 **完全没有公布它们的非搬迁改动清单**，所以 Part A 对这两批是**从零推导**的，
方法本身的盲区要一并读。

### 7.2 git C-quoting（`-z`）——刻意推迟

非 ASCII / 控制字符路径会被 git 默认加引号（`core.quotePath`），于是 `"C:/…/中文 name.ts"` 匹配不上
任何锚定正则。**先于本 slice 存在**，HEAD 同样暴露，且当前**0 个受影响的跟踪路径**。修法是
`git diff --name-status -z`，但那会改动**每一条**路径的解析。在门的改动上放大爆炸半径是错的取舍。
`parseNameStatus` 里已留注释点明边界。

### 7.3 `COUPLED_SIZE_RISE` 的叙事仍未覆盖

§3 证明了阀门能开、且有条件。但实验里的"下降"来自**删掉一个文件里的 19 行**，不是契约注释里
叙述的那个"拆成 4 个模块"中间态形状。同一个 census 单位，但那个特定故事仍未被证明。

### 7.4 shadow 块在涨，且**不是门**

本轮新增约 190 个模块进 `scripts/`、`tests/`——它们是 **shadow 人口**（owner 2026-10-03 决定
排除在 ceiling 之外），所以 `shadow.fileSizeOverCap 32 → 34`、`excessLines 10797 → 11326+`。
**门只打 WARNING，不拦。** 真正让陈旧基线变红的是 `tests/unit/standards/scope-shadow-coverage.test.ts`
的 reconciliation。这个区别本轮才搞清。

### 7.5 记录未修（都是真的，都不属于本轮）

- `deriveCallerId` 抛的是 `fail()` 信封而非 `Error`，于是 `PEAKS_CALLER_NOT_RESOLVED` 打印
  `Unexpected error` 而不是解析器的话（batch 2 发现）
- `doctor --rebuild-binding` 把成功的重写报成 `fail(..., 'BINDING_REBUILD_OK')`（batch 5 发现，
  **逐字保留**）
- `resolveCanonicalProjectRoot` 对 `$HOME` 下任何非 git 路径返回 `$HOME`（H1 守卫拒绝写入，
  所以无实害）（slice 3 发现）
- `tests/unit/scripts/test-changed-git-env.test.ts` 里一条**先于本 slice** 的 BDD 风格违规
  （HEAD 第 73 行的臂，被本轮新增推到 204 行）；**没有任何门强制 BDD 风格**

### 7.6 交接文档 §2.2 与 §2.3 仍未动

- **§2.2**：`tests/integration/**` 不在默认 vitest 配置里。**这是刻意的**（集成测试慢），
  改它要先决定"本地/推送该不该跑它"。本轮**没碰**。
- **§2.3**：单推 tag 过不了 pre-push 门。属门机器，须单独立项。本轮**没碰**。

---

## 8. 一条方法学（本轮出现三次）

**断言的范围不能超出证据的范围。**

- batch 3 的 RD 测出"offender 恰好出现在 `339746bb`"（对），由此说"predates this batch"（对 batch 3
  而言也对），但**没问"`339746bb` 是谁写的"**——那是本轮 batch 1。**一个正确的测量 + 一个没问的问题
  = 一个错误的结论。**
- 我把"窗口内单调"说成了"全链单调"。
- 我用 `grep claude` 代替那条真测试。

三次的形状相同：**手里有一个较强的结论，就用一个较弱的检查去支撑它。** 本仓这一轮修的门，
修的正是同一件事。
