# Peaks

Peaks 是一组跑在 Claude Code 里的 **技能（SKILL）家族** ——把项目治理、工作流规划、受控执行、QA 验证、变更追踪组织成可复用的工程流程。
CLI 是这些技能在背后调用的引擎，负责「门禁 + JSON 契约 + 不可逆动作」。

> **一句话定位**：你**用技能（SKILL）工作**，CLI 只是技能用来在 hook、CI、结构化判断等场景下提供机器层保障的底层。

## 安装

```bash
npm install -g peaks-cli
```

安装后，Peaks 会把内置的 8 个 `peaks-*` 技能注册到 Claude Code，会话里直接通过技能名调用即可。

## 本地开发（从源码跑 CLI）

仓库自带 `peaks` CLI 源码。开发模式用 `tsx` 直接跑 `src/cli/index.ts`，所以**首次克隆后 `node_modules/` 里不会有 `chalk` / `ora` / `terminal-kit` 等运行时依赖**——直接 `tsx src/cli/index.ts` 会报 `ERR_MODULE_NOT_FOUND: chalk`。先执行一次 `pnpm install` 把依赖补齐，再验证：

```bash
pnpm install
pnpm exec tsx src/cli/index.ts --version   # 应打印 1.2.9
pnpm exec tsx src/cli/index.ts <cmd>       # 与全局 `peaks <cmd>` 行为一致
```

热重载开发循环可用 `pnpm dev:watch`。

## 5 分钟上手

在 Claude Code 对话里，**直接对 Claude 说「用 X 技能做 Y」** 即可，技能会接管剩下的所有流程：

```text
peaks-solo 用全自动模式治理 /path/to/your-project
peaks-prd  为会员邀请功能整理产品目标、非目标和验收标准
peaks-rd   分析这次重构的最小实现切片和风险
peaks-qa   为这次改动设计测试和回归验证清单
peaks-ui   设计登录页的交互和视觉方案
peaks-sc   记录这次变更的影响范围、artifact 留存和 commit 边界
peaks-txt  为当前模块生成上下文胶囊，保留关键决策
peaks-sop  帮我把"内容发布"流程变成带门禁的 SOP
```

第一次使用？照这 4 步走：

1. 在 Claude Code 里对 Claude 说：**`peaks-solo 分析 /path/to/your-project`**
2. 技能会自动跑：`peaks workspace init` → `peaks scan archetype` → 生成 `.peaks/<session-id>/rd/project-scan.md`
3. 接着说你要做的需求，技能会按 PRD → RD → UI → QA → SC → TXT 的顺序把流程走完
4. 工作流结束时，技能会把所有中间产物留在 `.peaks/<session-id>/`，并把"该记住的事实"写进 `.peaks/memory/`

想要随时确认状态？让 Claude 跑一下：

```bash
peaks -V                # 版本号
peaks                   # 当前 quickstart + 已安装技能数
peaks doctor --json     # 环境/技能/配置一键体检
peaks skill doctor --json
peaks project dashboard --project . --json   # 当前项目 dashboard
```

## 技能家族速查

| 技能 | 你用它做什么 | 典型场景 |
|------|------|----------|
| `peaks-solo` | **端到端编排入口**。从需求到上线的全流程，自动协调 `prd/rd/ui/qa/sc/txt` | 全流程开发、从产品文档/PRD 开始到上线、跨多个子任务的批量迭代 |
| `peaks-prd` | 把模糊的产品意图变成**可验收的 PRD**：目标、非目标、行为保留、验收标准 | 需求整理、PRD 撰写、重构目标定义 |
| `peaks-rd` | 工程分析 + 重构规划 + 执行契约（覆盖门、规格、风险） | 工程分析、最小实现切片、风险评估、重构规划 |
| `peaks-ui` | UI/UX 交互和视觉约束、视觉方向、设计系统约束 | 页面设计、交互方案、原型、UI 回归 |
| `peaks-qa` | 测试设计 + 覆盖率 + 回归验证 + 验收证据 | 测试用例、回归矩阵、验收检查、浏览器 E2E |
| `peaks-sc` | 变更追踪、commit 边界、artifact 留存、回滚证据 | 影响范围记录、回滚证据、变更控制 |
| `peaks-txt` | 上下文胶囊、决策记录、知识压缩 | 模块理解、关键决策留存、复盘 |
| `peaks-sop` | **把你的工作流变成带门禁的 SOP**（不是研发专属） | 内容发布、合规清单、数据 pipeline、运维 runbook、个人流程 |

### 三个常用工作流

**新功能（端到端）**

```text
peaks-prd  →  peaks-ui（如果涉及 UI）  →  peaks-rd  →  peaks-qa  →  peaks-sc
```

**重构既有项目**

```text
peaks-txt（先压缩现状）  →  peaks-prd（明确目标）  →
peaks-rd（拆最小切片）   →  peaks-qa（回归矩阵）  →
peaks-solo（编排执行）   →  peaks-sc（变更证据）
```

**修 bug**

```text
peaks-rd（复现 + 根因）  →  peaks-qa（失败用例 + 验收）  →  改代码（先补失败测试）  →  peaks-sc
```

## 怎么用：技能优先，CLI 是门禁

Peaks 里的 `peaks <cmd>` CLI **不是日常使用的主要入口**。它的存在有三个理由，全都是机器层保障：

1. **不可逆动作的显式 opt-in**（例如 `peaks sop init --apply`、`peaks openspec archive --apply`）—— 这一刀不能靠 LLM"自觉"挥下。
2. **结构化 JSON 契约**（`peaks request show ... --json`、`peaks scan archetype ... --json`）—— 让技能读回一个可机读的判决，作为下游决策的输入。
3. **hook / CI / 脚本场景下能被程序化调用**（`peaks hooks install`、`peaks gate enforce`）—— 这层机器保障在对话里你看不到，但它把"必须满足门禁才能做 X"这件事从纸面规则变成可执行规则。

技能和 CLI 的关系可以记成一句话：**技能 = 流程的大脑**；**CLI = 流程的骨节**。

### 你**会**用到的几条 CLI 命令

虽然主要工作在技能里完成，但这些 CLI 命令在技能驱动下你也会经常看到被调用，概念上知道有它们就够了：

```bash
peaks workspace init --project <repo> --json       # 创建 .peaks/ 工作区（每个 session 一次）
peaks scan archetype --project <repo> --json       # 探测项目原型（greenfield/legacy-frontend/...）
peaks request init/show/transition                 # PRD/RD/QA/SC 的请求状态机
peaks sop init/lint/check/advance/register         # 你的自定义 SOP 生命周期
peaks hooks install --project <repo>               # 装门禁的 PreToolUse hook
peaks project dashboard --project <repo> --json    # 整个项目一眼看完
peaks project memories --project <repo> --json     # 读取 .peaks/memory/ 里的历史决策
```

完整命令列表跑 `peaks --help` 即可。

## 自定义 SOP（把你的流程变成带门禁的工作流）

> **技能入口**：`peaks-sop` 技能
> 告诉 Claude "帮我把『内容发布』做成一个 SOP"，它会引导你定义阶段、设定门禁、调试、注册，全程不用手写 JSON。

内置的 `peaks-*` 技能家族解决"开箱即用"的需求。但很多工作流是**领域特定的、有先后阶段、进入下一步前必须满足某些可检查条件**的——这种流程用 SOP（Standard Operating Procedure）来表达。

`peaks-sop` 技能可以把任何这样的流程变成**带门禁的工作流**：

| 领域 | 阶段举例 | 门禁思路 |
|------|---------|---------|
| 内容 / 发布 | draft → edit → publish | `file-exists` 草稿；`grep` 没有 `TODO`/`TKTK`；`command` 跑字数/拼写检查 |
| 合规 / 审批 | prepare → review → sign-off | `file-exists` `approval.md`；`grep` 包含 "Approved" |
| 数据 pipeline | raw → cleaned → validated | `command` 跑校验脚本，退出码 0 |
| 运维 / 入职 | request → provision → done | `file-exists` 每个清单产物；`command` 校验配置 |
| 研发发布（典型但非唯一） | draft → review → ship | `file-exists` CHANGELOG；`grep` 源码里没有 `FIXME`；`command` 跑测试 |
| 个人流程 | 任何"不要忘步骤 X"的流程 | 把"判断"重新物化成一个文件/文本/退出码 |

### 门禁类型

| 类型 | 含义 | 例子 |
|------|------|------|
| `file-exists` | 文件存在 → pass | `CHANGELOG.md` 存在 |
| `grep`（含 `absent`） | 文件内正则匹配 → pass；加 `absent: true` 反转（"不准有 X"） | "正文里没有 `TODO`" |
| `command` | 跑命令并按退出码判定（默认拒绝，需 `--allow-commands`） | 跑 `npm test` |

### 杀手锏：不可绕过的门禁

CI 只能在**合并时**拦，`CLAUDE.md` 里的规则靠 agent **自觉**。SOP 能做到 CI 和提示词都做不到的事：**在对话中途、面向 agent 本身**把不可逆动作摁住。

```jsonc
// sop.json
"guards": [ { "phase": "publish", "bash": "git +push" } ]
```

```bash
peaks hooks install --project <repo>   # 显式 opt-in：装一条 PreToolUse 规则
```

之后 agent 在 `publish` 阶段的门禁没全过时还想 `git push`，Claude Code 会收到 `permissionDecision: "deny"`，**在任何权限检查之前就被拦下——连 `--dangerously-skip-permissions` 都绕不过**。满足门禁后自动放行；紧急情况用 `peaks gate bypass --sop <id> --phase <phase> --reason "<原因>"` 一次性放行（每个项目每个 SOP 有上限、记原因）。

> **两层定义、执行按项目**：SOP 定义（`sop.json` + `SKILL.md`）可以放在**全局** `~/.peaks/sops/`（个人跨项目复用）或**仓库** `<repo>/.peaks/sops/`（随仓库提交、团队共享；`peaks sop init/register --project <repo>`）。**仓库层优先**于全局层。运行态（当前阶段、历史）按项目落在 `<project>/.peaks/sop-state/<sop-id>/`。

## 工程结构（了解 peaks-cli 本身）

```text
skills/        # 8 个 SKILL.md（peaks-solo / -prd / -rd / -qa / -ui / -sc / -txt / -sop）
src/cli/       # CLI 引擎（commands/、services/、hooks/、memory/、sop/、scan/、...）
bin/peaks.js   # 入口
docs/          # 设计文档
openspec/      # 内部 OpenSpec 变更提案
```

## 许可

MIT License，详见 [LICENSE](LICENSE)。
