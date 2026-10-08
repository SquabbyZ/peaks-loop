# peaks-loop 只读 MCP 能力面 — 设计

- **日期**：2026-10-09
- **session**：`2026-10-09-session-90f47d`
- **rid**：`rid-035`
- **状态**：设计已定（grilling 7 轮 28 问 + peaks-audit 两轮）
- **上游**：`audit-goal/rid-035.json`（首轮审计）· `rid-035-acceptance.md`（用户接受的目标）
  · `rid-035-rev2.json`（修正设计二轮审计）
- **约束（用户提出）**：**不得硬编码 Claude 与 Windows 使用环境。** vendor-neutrality 是本 spec 的宪法条款，不是风格偏好。

---

## 0. 起因

peaks-loop 目前由 AI Harness 通过 skill 文本 shell 出 `peaks <cmd>` 驱动。用户提出新增一条 MCP 面，让 harness 用原生 tool 调用触达非 gate 能力，**不删除现有 CLI**。

**四条痛点**：① skill ↔ CLI 漂移 ② 权限与可见性 ③ 调用可靠性 ④ 上下文与往返成本。

**审计结论**：方向成立；「新增子包」方向反了；「非 gate」边界不可判定且搬过去会静默绕过强制链（blocker）。

**用户已接受的载体决定**：扩成 `peaks mcp` 命令族，**不新起独立子包**（沿用 rid-016 收敛先例）。

---

## 1. 承重不变量

> **MCP server 是一段可删除的管道。**
> 删掉 MCP 模块后，CLI 的一切行为不变，harness 只是回到 Bash 调用。

**精确化（首轮 spec 两处写法不严谨，均在审计/自审中发现）**：

L3 的强制链改动位于 MCP 模块**之外**，故删模块**不会**回到原状。不变量的严格表述拆成三条：

1. **无 MCP 专属业务逻辑**：「业务逻辑」专指**命令语义**——不存在任何只为 MCP 而新增的、对命令行为的改写。
2. **CLI 语义与输出不变**：命令名、参数、输出 envelope 逐字节不变。
3. **L3 分支变为惰性**：§6.1 新增的 MCP 分支在没有 MCP tool 可匹配时**不进任何判定路径**，不改变任何既有调用（含 Bash 调用）的放行/阻断结果。

> 注意：L3 分支**确实是** MCP 专属代码。不变量不要求它消失，只要求它**不影响既有行为**。把它写成"完全无残留"是做不到的——它必须住在 `gate enforce` 里，因为那里才是强制点。

**推论（这是本设计最强的一条约束）**：任何组件都不得 `import` MCP 模块的源码。白名单必须以**数据文件**形式存在 —— 否则 L3 会依赖 MCP 模块，删模块即弄坏 `gate enforce`，不变量失效。

---

## 2. 非目标

- ❌ 写操作 / 编排 / transition —— 会写状态，属 gate 相关
- ❌ 鉴权 —— 复用 runtime 鉴权
- ❌ server 端缓存、常驻状态
- ❌ **不生成 SKILL.md** —— 本设计只保证「清单不漂移」，不保证「文档不漂移」
- ❌ 不直连内部 service 层（见 §5.4）
- ❌ 不做 generic invoke（`peaks_invoke(cmd,args)`）—— 丢掉逐 tool 权限粒度
- ❌ **本 slice 只落一个 harness adapter**，接口与 conformance 测试按 multi-adapter 写（见 §12）
- ❌ **不为任何平台写特判分支**（见 §8.3）

---

## 3. 架构

vendor-neutral 主干：

```
harness（任一支持 MCP 的 runtime）
   │  MCP / stdio        ← 标准协议，无 harness 特有扩展
   ▼
peaks-mcp server ── 查表 → 执行 → 原样返回
   │  执行方式由平台层解析（§8.3）
   ▼
peaks CLI   ← 原封不动
```

| # | 组件 | 职责 | **明确不干** |
|---|---|---|---|
| 1 | `surface` **数据定义** | 声明哪些 argv 进面、各自的 tool 名与参数占位 | 不含 schema 细节 |
| 2 | `schema` **内省器** | 从 Commander 注册表**读出**被选中 argv 的参数定义 → JSON Schema | 不判断只读 |
| 3 | `server` **stdio server** | 查表 → 执行 → 解析 envelope → 返回。**没有第四个职责** | 不认识 gate、不认识 session 语义、不缓存、不常驻、不重写错误 |
| 4 | `peaks mcp install/uninstall` | 写/删 harness 的 MCP 注册 | 不启进程 |
| 5 | **白名单数据文件**（build 时生成） | L3 与 server 共读的单一来源 | 不得为任何模块 `import` |

### 3.1 工具面设计原则

> **定义数靠策展压，调用数靠组合工具压，进程数不要去压。**

- **定义数**：每份 tool 定义是每次请求的常驻税。硬上限 ≤10。
- **调用数**：**MCP 本身一次往返都不减**。杠杆是让 tool 回答「skill 需要知道什么」。
- **进程数**：单次调用上 MCP 比 Bash 更贵（server + 子进程）。不要为省进程去直连内部 API（§5.4）。

### 3.2 组合工具的边界

> 组合工具**可以编排和改形，不可以判断**。

**可执行判据**：复合 tool 的输出必须是其内部各 argv 输出的**子集或可逆变换**。
允许：合并 / 截断 / 排序 / 挑字段 / 计数。
禁止：任何**由条件分支产出的新结论**（「所以这刀卡住了」）。判断永远属于 CLI。

---

## 4. 单源真源与渲染

**真源一份，产物是数据**：

```
CLI 注册表 + skill 池  ──┬──▶  tool schema（运行时内省，不产文件）
     （唯一真源）          ├──▶  白名单数据文件（build 时生成，入库）
                         ├──▶  harness 注册清单（build 时生成，入库）
                         └──▶  SKILL 索引
```

**为什么机制不统一（Q5）**：schema 内省读的是**运行时**的 Commander 程序；build 时生成它等于把注册表再快照一份——快照就会漂。而白名单与注册清单**必须**入库，因为 CI 要断言它们。两者机制不同是**故意的**，实现者不得"统一"它们。

**生成器必须确定性**：无时间戳、排序稳定，否则 CI 的「重新生成后 `git diff` 为空」会假红。

### 4.1 分发层的既存漂移（本设计要顺带消灭）

**实测**：`.claude-plugin/marketplace.json` 声明 version **2.0.3**（实际 **4.1.2**）、声明 **12** 个 skill（实际 **22**，缺 10）。根因：**该清单是手写的，且现行分发渠道是 `npm i -g` 而非插件渠道**，所以烂了没人发现。

**对策**：该清单改为**生成物**。§4 的「一份真源」由此从**工具层**延伸到**分发层**——清单不可能再漂，因为它没得漂。

---

## 5. 只读的定义与证明

### 5.1 定义（**分层**，Q9 + Q23）

> **readOnly = 不写持久状态 ∧ 无网络 ∧ 无 LLM 计费 ∧ 不 spawn 外部进程**

**分层**：「不 spawn 外部进程」指 **CLI → 外部**的 spawn（`npx` / `tsc` / `vitest` / `codegraph` / `docker`）。`server → CLI` 的 spawn 是**架构本身**，不是副作用。

**刻意不含**「输出跨时间一致」——状态查询天然随钟走（`skill presence` / `project dashboard` 依赖 mtime）。首轮把它写进定义是与选定工具面自相矛盾，已删。

### 5.2 实测基线

对 `.peaks/**` 全树 + `~/.peaks/**` + 状态库做前后快照，跑 5 条候选只读命令：**项目状态零变化**，唯一变化是全局日志追加。故：

- 「只读」的 claim 站得住
- 快照测试**必须显式排除全局日志**，且日志路径要可配置
- **附带收益**：MCP 调用也会进该日志 = 免费的调用审计流水（直接服务痛点②）

### 5.3 三层证明（对应 §5.1 的四条）

| 层 | 证明什么 | 手段 | 跑在哪 |
|---|---|---|---|
| A | 不写持久状态 | fixture 上走**真实 server 入口**，`hash(项目全树) + dump(状态库)` 前后 diff | 本机 |
| B | 无网络 / 无计费 / 不 spawn | **测试替身拦截**：在被执行的 CLI 进程内（preload 注入）patch `child_process` / `fetch` / `http(s).request`，断言零调用 | 本机 |
| C | 上述其实没发生 | **OS 沙箱**：无网络 + 只读挂载 | **CI-only** |

**替身必须打在 CLI 进程内部，不是 server 层** —— 否则会断言「server 没 spawn」，而那正是它的工作（Q23）。

**fixture 必须非空**：预置 memory / session / job / request 各若干条。否则「零变化」是**空真**——什么都没读到，自然什么都没改。

**替身的局限（审计指出）**：它只能证明「我们想得到的那几个 API 没被调」。故 **C 层不可省**。

### 5.4 为什么不用进程内只读数据层（审计的 alternative）

那样确实更快，且天然没有 spawn 矛盾。但会把 server 从「**CLI 公开契约**的消费者」变成「**内部实现**的消费者」——内部 API 改动比 CLI 契约自由得多，server 会跟着内部重构碎掉而 CLI 还好好的。**§1 的不变量因此失效。** 明确否决。

---

## 6. 强制链覆盖 — 四层

> 若 §5 成立，强制链在语义上是冗余的（只读面上没有 gate 相关路径）。之所以仍做：§5 的证明**只有 fixture 那么强**，一条 argv 可能「在 fixture 上只读、在真实项目上不是」。

| 层 | 内容 | 性质 |
|---|---|---|
| L1 | server 只能执行白名单内的 argv | 定义，**不是控制** |
| L2 | §5.3 的三层证明 | **真控制**，只强到 fixture |
| L3 | harness 的 pre-tool 拦截覆盖 MCP tool 面 | **真控制**，覆盖 fixture 之外 |
| L4 | server 启动校验：任一 argv 不在只读白名单则**拒绝启动** | 把「有人往面里塞写操作」从静默漏洞变成启动失败 |

**L4 的校验单元是 argv，不是 tool**（Q6）—— 复合 tool 内部有 N 条 argv，按 tool 校验会漏掉 N-1 条。

### 6.1 L3 拦什么（Q17）

**拦配置一致性**，不是拦业务：默认拒绝**不在白名单里的 MCP tool 调用**，并记录每次调用。

它防的是：改了 `surface` 没重启 server、或有人手改了 harness 配置指向别的 server。**这个定位必须在 spec 里写明**，否则实现者会以为它该拦业务语义。

### 6.2 L3 的失败方向（Q22）

**MCP 分支 fail-closed（异常 → 阻断）**，与 Bash 分支的 fail-open **相反**。

理由：Bash 分支拦的是**命令文本**，误拦会打断正常工作；MCP 分支拦的是**配置一致性**，误拦的代价是「一个本该一致的调用失败」，放过的代价是「一个绕过强制链的调用」。**量级不对等**，同一个 `catch` 不能服务两个方向相反的目标。

### 6.3 matcher 集合由 adapter 提供（**不得硬编码**）

> **MCP tool 名是 harness 特有的。** matcher 集合必须**从 adapter 读取**，不得写在设计或测试里。

已知的两种形态（**属 Claude Code adapter 的取值，非设计要求**）：

| 注册渠道 | tool 名形态 |
|---|---|
| 直接注册 | `mcp__<server>__<tool>` |
| 经插件注册 | `mcp__plugin_<plugin>_<server>__<tool>` |

**这是设计级陷阱**：对裸 server key 写的 matcher（如 `mcp__peaks__.*`）在**插件渠道下永不触发** —— L3 会**静默失效**。若某 adapter 同时支持两条渠道，其 matcher 集合必须**两条都含**，且每条都要有独立测试断言「确实触发」。

### 6.4 两条易踩的运行时事实

- **pre-tool 拦截超时 = 不阻断**（超时的 hook 不阻止调用）。gate 必须足够快；不要拿「会挂住的 hook」当门。
- **stdio server 每 session 一个进程，且不自动重连**。server 崩了不自愈，属可接受的失败态。

---

## 7. 工具面 v1

**只做 2 个**（Q12）。全部先过 §5 才进面，没过就退回 Bash。

| tool | 回答什么 | 复合了几条 argv | 今天的样子 |
|---|---|---|---|
| `peaks_status` | 现在到哪了 | **3**：`skill presence` / `session list` / `request show` | 3 次 CLI 调用 |
| `peaks_memory_search` | 项目里沉淀过什么 | 1：`memory search` | 原输出 **4.3 MB**，须有界 |

> **实测修正（slice ① RD + 编排器独立复核，2026-10-09）**：原设想的第 4 条 `project dashboard` **已被排除**——`findProjectRoot` 会 `execFileSync('git', ['rev-parse','--show-toplevel'])`（`src/services/config/config-safety.ts:240`），实测 B 层替身捕获到 `node:child_process.execFileSync`，违反 readOnly 第 4 条。RD 将其移出白名单并保留 **live arm** 每轮重测（把被排除项塞回去，测试必须转红）。
>
> **不通过放宽定义来救回它。** 放宽「不 spawn」是拿安全属性换功能。**根因修法**：`findProjectRoot` 在调用方已显式给出 `--project` 时不应再去 shell 出 git——那是 CLI 改进，属后续 slice（记 §14 R8）。
>
> 另两处实测修正：`request show` 的 `--project` **同样是必填**（我的初稿只写了 `--role`）；`session list` 则**不接受** `--project`。**flag 集合不可跨子命令推断。**

**明确不进 v1**：`peaks_test`（spawn 测试运行器，非只读）；任何编排型（run / advance / transition）；generic invoke。

**晋升规则**（清单不固定，用规则代替）：

> 一个能力晋升为 MCP tool，必须同时满足 ①过 §5 ②高频 ③今天是多调用旅程。三条缺一，留在 Bash。

`≤10` 是上限不是目标。这条规则同时也是「预留对外」的路径。

### 7.1 有界返回（Q15）

`peaks_memory_search`：默认 **≤10 条**，每条只给 `name` + `title` + 前 120 字符；`--limit` 硬上限 **50**；**永不返回正文**。

它回答的是「有没有、叫什么」，不是「内容是什么」。

### 7.2 超时（Q16）

server 对**所有**执行加强制超时，超时返回**明确错误**（不是静默返回空——那违反 §9 第 3 条）。

**动因（实测）**：`peaks job status --watch` 是**无限循环、永不退出**。它在白名单外，但暴露了一类风险：任何白名单 argv 一旦挂住，MCP 调用会**永久挂着**，harness 无救济手段。

---

## 8. 供给、白名单与注册

### 8.1 白名单的形状（Q10 + Q14 + Q24）

**分类键 = 完整 argv 含全部 flag**，不是顶层命令名。

**实测依据**：13 个命名族（`request`/`session`/`job`/`skill`/`memory`/`audit`/`workflow`/`code`/`project`/`sub-agent`/`slice`/`gate`/`doctor`）**全部混读写，0 个统一只读**。且存在**默认即写**的命令：`project context`（`--read` 才读）、`skill sync`、`workflow skip`；以及 `memory list --pick`（写 + spawn fzf）。

**条目 = argv 模板 + 参数占位**：

- 占位的类型**尽量从 Commander 内省**；内省不到的才手写，**并显式标注「此处为手写 schema」** —— 手写处就是漂移的唯一入口，必须可见
- **参数注入防护（审计 blocker）**：①占位符**按类型白名单校验**（如 rid 必须匹配 `^[a-z0-9-]+$`），非法直接拒；②server **从不把参数拼成命令行字符串**，一律以数组传入且禁用 shell 解析。这两条堵死「`<rid>` 传 `--apply` 翻转语义」
- 无匹配即拒绝（正面声明，默认拒绝）

### 8.2 执行方式：平台无关（Q28）

**不写任何平台分支。** 选一个**两边都成立**的 launch 形状：由平台层解析出 runtime 可执行文件与 CLI 入口，以数组形式传入。

**实测动因**：直接以 CLI 名作为命令，在本机（Windows，CLI 是 `.cmd` shim）**实测失败** —— `InvalidBatchScriptArg`。给 Windows 写特判恰是「硬编码平台」，故否决。

### 8.3 注册：adapter 接口（Q21 的供给侧）

沿用仓库既有的「**规范真源 + adapter 物化**」机制：

1. adapter 接口加**可选字段**（与既有 `skillInstall?` / `standardsProfile?` / `compact?` 并列）；未填的 adapter **静默跳过**，不报错
2. `resource-profile.ts` 加一个 accessor，**dispatch 层不动**（其注释已明确「未来加 IDE 只填 adapter 字段，accessor 与 dispatch 层不变」）
3. 安装流程对每个探测到的 harness，按其 adapter 物化注册

**物化方式与 skill 不同**：skill 是**目录**，可符号链接；MCP 注册是**别人配置里的一段 JSON**，不能。它走「托管片段合并」，沿用既有的 `<name>.peaks-managed` 标记原则 —— **只动自己写的，绝不碰用户的**。

**实现原则（vendor-neutral 表述）**：

> 优先使用 **harness 自己的注册入口**，不要手写 JSON 去改 harness 的配置文件。那些文件装满用户状态，手改既不安全也不耐版本变化。**具体入口属 adapter**，例如某 adapter 可能是 `claude mcp add --scope user --transport stdio <name> -- <cmd> [args...]`。

**升级路径必须实现**：某 harness 的注册命令**不幂等、不可原地升级**（同名同 scope 直接 fail，无 `--force`/`update`）。installer 每次必须「先删后加」，并在删除前处理「同名存在于多个 scope」的分支。

**卸载（Q19）**：提供 `peaks mcp uninstall` **显式命令**；**不依赖**包管理器的自动卸载钩子（常被跳过，残留会让后续 install 撞「已存在」而失败）。

### 8.4 可见性与其失败态

注册为**用户级**（跟机器走，不跟项目走），意味着在**非 peaks 项目**里 harness 也会列出这些 tool。

**接受**（Q8），但加三条：
1. 自检返回必须**明确区分**「这不是 peaks 项目」与其他错误 —— 一句人话，不是 stack trace，也不是静默
2. tool 描述写明适用前提，避免 LLM 误用
3. 若非 peaks 目录下的噪音实测确实烦，再议改项目级 —— **但那会牺牲零配置**，是有代价的退路

---

## 9. 错误契约

1. CLI 的 envelope **原样透传**（`code` / `message` / `nextActions` / `errorId`），不包装。包装一层等于在 server 里埋第二份语义
2. 非 peaks 项目 → **一句人话**
3. **绝不吞错。** CLI 失败必须让 harness 看到 `isError`，不能返回「看似成功但空」的结果。**一个读工具在失败时返回空，比直接报错危险得多** —— LLM 会把「读失败」当成「没有数据」，进而编

---

## 10. 测试矩阵

| 测什么 | 怎么测 |
|---|---|
| 每条 argv 只读（状态） | §5.3 A：fixture（**非空**）走真实 server 入口，快照 diff |
| 每条 argv 无副作用 | §5.3 B：**CLI 进程内**替身拦截 `child_process`/`fetch`/`http`，断言零调用 |
| 事实上无副作用 | §5.3 C：**CI-only** 无网络 + 只读挂载沙箱 |
| 参数注入不可翻转语义 | 对每个占位符喂 `--apply` 类值，断言被拒 |
| 非只读条目进面 → 拒启 | 塞一条非只读 argv，断言 server 起不来 |
| schema 真从注册表内省 | 改一个 CLI 参数名 → tool schema 跟着变（**清单不用手改**） |
| L3 覆盖（**逐渠道**） | 对 adapter 提供的**每条** matcher 各构造一次越界调用，断言被阻断 |
| L3 fail-closed | 让白名单读取抛异常，断言**阻断**而非放行 |
| 返回值有界 | 打 4.3 MB 的 memory 库，断言 ≤ 上限 |
| **每条 argv 都能在超时内退出** | 防 `--watch` 类无限循环 |
| CLI 未被动过 | 现有全套测试仍绿 + 命令名 / 行为 diff 为空 |
| 供给**语义**幂等 | 连跑两次 install，断言**产出的注册内容一致**（因注册命令非幂等，不能断言「第二次无动作」） |
| 生成物不漂移 | 重新生成后 `git diff` 为空；清单 version == 包 version；清单 skill 数 == 实际 skill 数 |
| **无模块 import MCP 源码** | §1 不变量的机械守卫：静态断言无跨边界 import |

---

## 11. 验收标准

> ① 删掉 MCP 模块后现有测试全绿、CLI 行为不变、无 MCP 专属业务逻辑残留；
> ② 两个 tool 的**每条 argv** 通过 §5.3 三层证明；
> ③ **`peaks-status` skill 的 4 条读路径中，3 条由 1 次 MCP 调用完成**（`project dashboard` 因 §7 已排除，仍走 Bash）；未装 MCP 时**全部回落 Bash** 仍可用；
> ④ 该路径上的越界调用被 L3（adapter 提供的**每条** matcher）拦住。

**③ 是本设计唯一证明端到端价值的一条** —— 面存在 ≠ 有人用。首轮 spec 漏了这一点，是结构性漏洞。

---

## 12. 切片计划（Q26）

审计独立判定 `large` 并建议拆里程碑，与 grilling 结论一致。**拆 3 段**：

| 段 | 内容 | 为什么可以独立 |
|---|---|---|
| **①** | **只读白名单 + 三层证明** | **即使 MCP 永不上线也有独立价值** —— 它加固的是**现有**的强制链（今天 matcher 只有 `Bash`，等于强制力整个挂在「一切走 shell」这个隐含前提上）。可独立验证、可独立合并 |
| **②** | MCP server + 2 个 tool + **§6 的 L3 强制链改动** + skill 改造 + fallback + **退役 R9 死脚本** | 依赖 ① 的白名单 |

> **编排器补记（2026-10-09）**：初版 §12 漏了把 **L3**（pre-tool 拦截覆盖 MCP 面 + `gate enforce` 的 MCP 分支）归到哪一段。它逻辑上只能跟 MCP tool 一起出现（没有 tool 就没有可拦截对象），故归 **②**。同样，**adapter 的 `mcpInstall` 字段**属分发，归 **③**。
| **③** | 生成式清单 + 分发（install/uninstall）+ 插件渠道「只生成」 | 与 ①② 正交，可并行或延后 |

**顺序：① → ② → ③。** ③ 可提前并行，因为它与 ① 无依赖。

---

## 13. adapter / 平台实例（**隔离区**）

> 本节内容**不是设计要求**，是某几个具体环境的取值。加新环境时只增行，不改上文。

| 环境 | 项 | 取值 |
|---|---|---|
| Claude Code | 直注册 tool 名 | `mcp__<server>__<tool>` → matcher `mcp__peaks__.*`（`.*` 必需） |
| Claude Code | 经插件注册 tool 名 | `mcp__plugin_<plugin>_<server>__<tool>` → matcher `mcp__plugin_peaks-loop_peaks__.*` |
| Claude Code | 注册入口 | `claude mcp add --scope user --transport stdio <name> -- <cmd> [args...]`；**不幂等，须先删后加** |
| Claude Code | 配置位置 | 用户级为顶层 `mcpServers`；项目级在 `projects.<path>.mcpServers` |
| Claude Code | pre-tool 拦截 | 对 MCP tool **会触发**，`tool_name` 为该形态；异常退出**可阻断** |
| Windows | CLI 可执行 | 是 `.cmd` shim —— **直接作为命令实测失败**（`InvalidBatchScriptArg`），故 §8.2 选平台无关形状 |
| 通用 | 环境变量展开 | 已知形态为 `${VAR}` / `${VAR:-default}`；**裸 `$HOME` 无保证**。本设计的注册条目**不需要任何展开** |

---

## 14. 未决与风险

| # | 项 | 状态 |
|---|---|---|
| R1 | 平台无关 launch 形状在**各平台**的落地与验证 | **实现前必须实测**（Windows 侧已确认直接调用不可行） |
| R2 | L3 在 target harness 侧的改动面（分支新增 + 白名单读取） | 待 peaks-rd 评估 |
| R3 | 白名单数据文件的 schema（argv 模板 + 占位类型） | 待定 |
| R4 | 生成式清单的**第二渲染**（非 Claude 的 harness 如何被服务） | 只留接口，本 slice 不实现 |
| R5 | 既有大洞：pre-tool 拦截对**非 Bash 工具一律 fail-open** | **本 slice 不修**（审计建议），记 finding 另开 slice |
| R6 | `peaks audit goal` 输出上限约 3.6 KB，无法审计 spec 规模输入 | 使用中发现，**独立缺陷**，另开记录 |
| R7 | 沙箱层（§5.3 C）在各平台的可实施性 | Windows 侧手段受限，待评估 |
| R8 | **`project dashboard` 因 spawn git 被排除**（实测，§7 已记录） | 非缺陷、是**证明生效**。根因修法：`findProjectRoot` 在已给 `--project` 时跳过 git 调用 → 属 CLI 改进，**另开 slice**，不得搭本次便车 |
| R9 | `scripts/static-scan-mcp-removed.mjs` 是一个**死脚本**，断言 `src/services/mcp` 路径**不得存在** | slice ② 必须**显式退役**它，否则会与新模块冲突 |

---

## 15. 关联

- 审计：`audit-goal/rid-035.json`（首轮）· `rid-035-rev2.json`（修正后）
- 接受记录：`audit-goal/rid-035-acceptance.md`
- 先例：`2026-07-27-rid-016-monorepo-delete-5-subpackages`（不新起纯内部子包）
- 宪法：`peaks-loop-is-enhancement-not-new-cli`（**vendor-neutrality 是定义性条款**）· `human-nl-choice-only-tenet` · `4x-sediment-pool-reserves-desktop-client-entry-points`
