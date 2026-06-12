# Peaks

[English](./README-en.md) | **简体中文**

[![npm version](https://img.shields.io/npm/v/peaks-cli.svg)](https://www.npmjs.com/package/peaks-cli)
[![GitHub repo](https://img.shields.io/badge/GitHub-SquabbyZ%2Fpeaks--cli-181717?logo=github)](https://github.com/SquabbyZ/peaks-cli)

Peaks 是一个**跨 AI IDE 的工作流门禁 CLI + 技能家族**——把项目治理、工作流规划、受控执行、QA 验证、变更追踪组织成可复用的工程流程。CLI 是跨 IDE 稳定的核心（门禁 + JSON 契约 + 不可逆动作），技能 / 钩子 / 配置按各 IDE 的原生格式承载。

> **支持的 IDE**：
> - ✅ **Claude Code**（shipped, 当前主用）：11 个 `peaks-*` 技能 + `.claude/settings.json` PreToolUse hook；agent team 在本 IDE 已 dogfood
> - ⚠️ **Trae**（adapter shipped, real-Trae unverified）：slim `IdeAdapter` 已注册到 slice #1 registry（`hookEvent` / `toolMatcher` / `envVar` 是 1.x 假设，**未在真实 Trae 上验证**）；真实 Trae 集成 dogfood 留到后续切片
> - 📋 **Codex / Cursor / Qoder / 通义灵码 等**（路线图）

> **产品定位**：你**用技能工作**，CLI 是跨 IDE 的质量保障层。
>
> 我们的目标：让 LLM 在每个环节里自由判断与决策；peaks 在流程边界上提供可审计的 SOP 护栏，把项目级记忆和使用经验沉淀下来——AI IDE 和 LLM 在你的项目上用得越久就越懂它。

## 安装

```bash
npm install -g peaks-cli
```

安装后，Peaks 会把内置的 11 个 `peaks-*` 技能注册到已适配的 AI IDE（当前：Claude Code），会话里直接通过技能名调用即可。

### 2.0 新增：一键升级（1.x → 2.0）

如果你已经装过 peaks-cli 1.x，把 `npm install -g peaks-cli` 跑一遍就够了：postinstall 会自动检测项目里的 1.x 状态，并就地把 `.claude/rules/`、`~/.peaks/config.json`、`.gitignore` 等迁移到 2.0 布局（每一步都带时间戳备份）。完成后 `git status` 里会浮出 `.peaks/standards/`、`.peaks/memory/*.md`（durable）、`.peaks/PROJECT.md` 等 2.0 新增的可跟踪 artifact。

```bash
# 手动 fallback（当 CI 跳过 postinstall，或者升级被 PEAKS_SKIP_AUTO_UPGRADE=1 抑制时）：
peaks upgrade --to 2.0 --auto --project .
```

> 详细说明 + 8 步骤 + rollback 路径见 [`docs/UPGRADING-2.0.md`](./docs/UPGRADING-2.0.md)。

### 2.0 新增：ocr 第二意见 code review（soft-optional）

peaks-cli 2.0 把阿里 [Open Code Review](https://github.com/alibaba/open-code-review)（`@alibaba-group/open-code-review`）作为 **required dependency** 带进来，给 `peaks-rd` 的 Gate B3（code review 证据）增加**第二意见**：peaks-rd 自己 LLM 评 + ocr 专评工具评，两份结果合并到 `.peaks/<session-id>/rd/code-review.md`。

LLM 端点配置**由用户在 peaks-cli 自己的 config 里维护**（**不**自动配置，**不**写 `~/.opencodereview/config.json`，**不**调 `ocr config set`）：

```bash
# 1) 打印要粘贴的 JSON 模板（不写任何东西，只是引导）：
peaks code-review config-template --json

# 2) 把模板贴到 ~/.peaks/config.json 的 "ocr.llm" 段下，替换 <your-api-key>。
#    也可以分键写：peaks config set --key ocr.llm.url --value '<url>' 等等。

# 3) 验证就绪状态（peaks-rd 也会自动跑这一步）：
peaks code-review detect-ocr --json
```

peaks-cli 永远不会替你写 token / URL — 你的 LLM 端点和 key 都是你的。配置存在 `peaksConfig.ocr.llm`，peaks-rd 调用 ocr 时**作为 env vars 注入**（`OCR_LLM_URL` / `OCR_LLM_TOKEN` / `OCR_LLM_MODEL` / `OCR_USE_ANTHROPIC` / `OCR_LLM_AUTH_HEADER`）— 这是 ocr 包最高优先级的配置路径，peaks-cli 不必生成 `~/.opencodereview/config.json`。

软失败（soft-fail）策略：缺包、缺 binary、缺配置都**不会**让 peaks-rd 卡住 — 它会跳过第二意见、继续 LLM-only review。详见 [`skills/peaks-rd/references/ocr-integration.md`](./skills/peaks-rd/references/ocr-integration.md)。

## 5 分钟上手

在已适配的 AI IDE 对话里，**直接对 AI 说「用 X 技能做 Y」** 即可，技能会接管剩下的所有流程：

```text
peaks-solo 帮我给登录页加 OAuth 回调      # 第一次显性用 peaks-solo；项目根 = IDE 当前 cwd
peaks-prd  为会员邀请功能整理产品目标、非目标和验收标准
peaks-rd   分析这次重构的最小实现切片和风险
peaks-qa   为这次改动设计测试和回归验证清单
peaks-ui   设计登录页的交互和视觉方案
peaks-sc   记录这次变更的影响范围、artifact 留存和 commit 边界
peaks-txt  为当前模块生成上下文胶囊，保留关键决策
peaks-sop  帮我把"内容发布"流程变成带门禁的 SOP
```

第一次使用？分两层：**你做 2 步，peaks 接管剩下**。

**你需要做的（2 步）**：

1. 在项目目录里打开已适配的 AI IDE：`cd /path/to/your-project && <你的 IDE 命令，如 claude>`——让 IDE 知道项目根在哪
2. 在 IDE 里对 AI 说：**`peaks-solo 帮我做 X`**（X = 需求描述，如"给登录页加 OAuth 回调"）
   - LLM 会按任务和项目推荐模式；想直接定可以写 `peaks-solo 全自动做 X` / `peaks-solo swarm X` / `peaks-solo strict X`

**之后 peaks 会自动**：

- 跑 `peaks workspace init`（首次会创建 `.peaks/`）→ `peaks scan archetype` → 生成 `.peaks/<session-id>/rd/project-scan.md`
- 复杂任务按 PRD → RD → UI → QA → SC → TXT 协调；简单任务直接走 solo 全自动，无需分阶段
- 工作流进行中可用 `peaks-solo-status` 看看当前到哪了；中断后用 `peaks-solo-resume` 继续
- 工作流结束时把所有中间产物留在 `.peaks/<session-id>/`，并把"该记住的事实"写进 `.peaks/memory/`

想要随时确认状态？让 AI 跑一下：

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
| `peaks-solo-resume` | **继续刚才没做完的切片**——一键检测 in-flight slice 的最深已完成 gate，省 3-5k token | 「继续完成刚才为完成的」「resume the unfinished slice」 |
| `peaks-solo-status` | **看一眼现在到哪了**——5-CLI snapshot 表格（presence + session + dashboard + request + memory） | 「现在到哪了」「show me the dashboard」 |
| `peaks-solo-test` | **跑项目测试**——从 `package.json` 探测测试工具（vitest / jest / mocha / pytest / ...），用项目原生命令跑并汇总 pass/fail | 「跑测试」「run the tests」 |

### 两种基本用法

**1. 让 `peaks-solo` 编排（最常用）**

`peaks-solo` 是产品入口，**绝大多数场景都用它**——告诉它做什么，剩下 PRD / UI / RD / QA / SC / TXT 的链路它自己协调。**默认模式不写死**：LLM 根据任务复杂度和项目状态主动推荐 assisted / full-auto / swarm / strict 中的一种；想自己指定时再显式标注：

```text
peaks-solo 帮我做 X              # 默认（不写死，LLM 按任务和项目推荐）；X = 需求描述；项目路径走 IDE 当前 cwd
peaks-solo 全自动做 X            # 显式 full-auto：端到端跑完
peaks-solo swarm 模式做 X        # 显式 swarm：最大化子代理并行（适合大任务）
peaks-solo strict 模式做 X       # 显式 strict：最严格门禁
```

3 个 `peaks-solo-*` 包装技能是 solo 的轻量变体（不算单独角色）：

- `peaks-solo-resume` —— 继续刚才没做完的切片
- `peaks-solo-status` —— 看看现在到哪了
- `peaks-solo-test` —— 跑项目测试

**2. 直接调用单个角色技能（进阶）**

只有当你只想做工作流的**一个阶段**（比如只写 PRD、只做架构分析、只跑回归），不想走 full pipeline 时，才单独调这些：

| 技能 | 你用它做什么 | 什么时候才需要 |
|---|---|---|
| `peaks-prd` | 写 / 改 PRD（目标、非目标、行为保留、验收标准） | 想自己定义需求，不走 solo 整流程 |
| `peaks-rd` | 架构分析 + 最小切片规划 + 风险 | 只想拿一份技术分析，不要写代码 |
| `peaks-qa` | 测试用例 + 回归矩阵 + 验收证据 | 只想补测试，不走完整 solo |
| `peaks-ui` | 视觉方向 + 交互方案 + 设计系统约束 | 只做 UI 设计，不带实现 |
| `peaks-sc` | 影响范围 + commit 边界 + 留存策略 | 只想记录变更，不触发整流程 |
| `peaks-txt` | 上下文胶囊 + 决策记录 | 只想压缩知识，不走整流程 |
| `peaks-sop` | 把任意工作流（不只是开发）变成带门禁的 SOP | 想定义 / 注册自己的 SOP |

**3 个 solo 包装 + 7 个角色技能 + 1 个 solo 编排 = 11 个技能家族。** 日常使用中，1 个（`peaks-solo`）覆盖 ≥90% 的需求。

## Agent team

`peaks` 帮你调度一个 agent team——`peaks-solo` / `peaks-rd` / `peaks-qa` / `peaks-ui` 把 peer sub-agent 派到隔离沙箱里写 PRD / 做架构分析 / 跑测试 / 设计 UI，主 LLM 只看每个 sub-agent 的元数据（路径 + 大小 + 摘要）。

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
peaks workspace reconcile --project <repo> --json  # 4-tier heuristic 重新指向 canonical session，干掉孤儿 dir（默认 dry-run，--apply 才删）
peaks scan archetype --project <repo> --json       # 探测项目原型（greenfield/legacy-frontend/...）
peaks scan libraries --project <repo> --json       # 枚举依赖 + 解析 major，支持 monorepo
peaks request init/show/transition                 # PRD/RD/QA/SC 的请求状态机
peaks session list/info/title/rotate               # session 元数据；rotate 丢弃绑定让下次 peaks 自动重生成
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

## 许可

MIT License，详见 [LICENSE](LICENSE)。
