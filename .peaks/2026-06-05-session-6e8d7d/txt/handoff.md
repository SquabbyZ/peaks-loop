# TXT Handoff — README / README-en 同步

**Session:** 2026-06-05-session-6e8d7d
**Mode:** assisted
**Type:** docs
**Date:** 2026-06-05

## 范围

仅 README 文本更新，未触碰代码、CLI 注册表、package.json、schemas、tests。

| 文件 | 改动统计 |
|---|---|
| `README.md` (CN) | +19 / -7（5 处：技能数 8→11；版本 1.2.9→1.3.0；新增 3 行包装技能表行；新增 3 行 CLI 子命令；工程结构重写） |
| `README-en.md` (EN) | +29 / -7（5 处：技能数 8→11；新增 Local dev 段对齐 CN；新增 3 行包装技能表行；新增 3 行 CLI 子命令；工程结构重写） |

## 驱动的最近改动（commit→README 触点）

| Commit | 影响 README 表述的点 |
|---|---|
| `97ee9af` feat(skills): add peaks-solo-resume wrapper | 技能家族速查表新增 1 行；包装技能 = 3 个起步 |
| `4c53a4c` feat(skills): add peaks-solo-test wrapper | 包装技能 = 2 |
| `9c0e164` feat(skills): add peaks-solo-status wrapper | 包装技能 = 3；技能总数 8→11 |
| `33799aa` feat(workspace): add peaks workspace reconcile | CLI 速查新增 `peaks workspace reconcile` |
| `1a66e75` feat(scan): discover monorepo packages in peaks scan libraries | CLI 速查新增 `peaks scan libraries`（并标注 supports monorepo） |
| (peaks session 新子命令) | CLI 速查新增 `peaks session list/info/title/rotate` |
| `f5b47a8` chore(build): auto-sync CLI version | 本地开发段版本号 1.2.9→1.3.0（与 `package.json` 对齐） |
| `f0c380e` refactor(workspace): move runtime state under .peaks/_runtime/ | 工程结构图未变（`.peaks/_runtime/` 是运行时状态，本来就 gitignore，不应进 README） |
| `c9e03ec` chore(workspace): gitignore .peaks runtime state | 同上（属于 gitignore，不进 README） |

## 验证

- `git diff --stat README.md README-en.md` → 41 insertions, 7 deletions（与提案一致）
- `wc -l` → README.md 187 行、README-en.md 188 行（结构对称）
- Markdown 表格列宽未越界（每行 8 个 cell，与原文一致）
- 改动未触及 1) 安装命令、2) 顶部产品定位段、3) 自定义 SOP 章节、4) License 段
- 英文版 Local dev 段是新增（与中文版对齐），其他段位 1:1 对应

## Dogfood

无 CLI 行为变化（仅文档），无需跑 `peaks ...` 命令证明。`peaks --version` 仍输出 1.3.0，`peaks scan libraries --help` 仍含 monorepo 描述。

## 风险 / 注意事项

- 若后续 `package.json` 版本号变更，`README.md` 行 22 与 `README-en.md` 的 Local dev 段需要同步。`scripts/sync-version.mjs` 只同步 `src/shared/version.ts`，不会动 README；后续若想让版本号自同步进 README，需要新加脚本（不在本 slice 范围）。
- 工程结构图仍以文字描述为主；若 `src/services` 与 `src/shared` 命名再变，README 需要再次手工对齐。

## Round 2 — 多 IDE 定位 + 双语切换

**触发**：用户提出"不能把 peaks-cli 写成只是 Claude Code 的工具"，Trae 适配在做，后续还有 Codex/Cursor/Qoder/通义灵码。同步要求 CN/EN 互跳。

**变更**（每份 README 4 处）：

| # | 位置 | 改动 |
|---|---|---|
| A | 标题下方 | 加语言切换按钮（CN: `[English](./README-en.md) | **简体中文**`；EN: `**English** | [简体中文](./README.md)`） |
| B/C | 顶部产品定位段 | 重写为"跨 AI IDE 的工作流门禁 CLI + 技能家族"，加 "Supported IDEs" 段（✅ Claude Code；🚧 Trae；📋 Codex/Cursor/Qoder/通义灵码） |
| D | 3 处"Claude Code"软化 | CN: "注册到 Claude Code"→"注册到已适配的 AI IDE（当前：Claude Code）"；CN: "在 Claude Code 对话里"→"在已适配的 AI IDE 对话里"；EN: 对应 2 处同改。**第 3 处（"在 Claude Code 里对 Claude 说 `peaks-solo analyze`"）保留**——是具体命令示例，事实就是 Claude Code |
| E | 工程结构图 | `skills/` 注释后追加一行：技能当前以 Claude Code 的 SKILL.md 格式承载；其他 IDE 各自有等价承载格式（见各自 IDE 的适配目录） |

**未触动的部分**（保持稳定）：
- 安装段（`npm install -g peaks-cli` 跨 IDE 一致）
- 5 分钟上手段中的具体命令（peaks-solo / peaks-prd 等名字、CLI 子命令速查）——这些是 CLI 引擎，跨 IDE 通用
- 自定义 SOP 章节（产品机制，跨 IDE 通用）
- License 段

**CSDN 文章核对**（用户提供的 `https://blog.csdn.net/weixin_40766789/article/details/161455584`）：该文是 **EDD 范式论文**（声明层 + 命令层 + 7 角色状态机 + 6 类失效模式 + SOP profiles），**正文不涉及 Trae / Claude Code / SKILL.md / hooks 的具体集成形态**。所以 README 里只声明"Trae 适配中"，不替用户承诺具体的 Trae 承载方式（`.trae/` 目录 / Trae MCP / Trae rules / Trae commands 都不在 README 里写）——等用户完成 Trae 适配后再补一段。

**承诺边界**（用户以后 review 时要核对）：
- "Trae 适配中"是用户当下的近期承诺。如果 Trae 适配被砍或延期，README 这行要同步撤掉。
- "路线图" 4 个 IDE 没有时间表——只声明状态，不声明时间。

## Open questions

无（Round 1 + Round 2 + Round 3 + Round 4 都收敛）。

## Round 4 — 工作流框架重写 + peaks-solo-test 脱 vitest

**触发**：用户指出"### 三个常用工作流"分错类了——peaks-solo 是编排入口（占日常 90%+），peaks-prd/rd/qa/ui/sc/txt/sop 是被它调度的子角色；应该按"solo vs 非 solo"分。同步要求 peaks-solo-test 不能写死 `pnpm vitest run`（要看项目实际用什么测试工具）。

**前置熟悉**（按用户"先整体再细致"指示）：
- 通读 `skills/peaks-solo/SKILL.md` 前 120 行（确认 `peaks-solo` 是 "Full-auto orchestration facade... Coordinates peaks-prd, peaks-rd, peaks-ui, peaks-qa, peaks-sc, and peaks-txt"）
- 通读 11 个 SKILL.md frontmatter（确认 7 个角色技能 + 1 个 solo 编排 + 3 个 solo 包装的家族结构）
- 通读 `skills/peaks-solo-test/SKILL.md`（确认测试命令探测规则：默认 vitest，可被项目原生命令覆盖，"Do NOT silently default to vitest"）

**变更范围**（每份 README 4 处，共 8 处编辑）：

| # | 位置 | 改动 |
|---|---|---|
| 1 | 主段落："### 三个常用工作流" / "### Three common workflows" | 替换为"### 两种基本用法" / "### Two basic ways to use Peaks"——按 solo（最常用，含 4 种 mode：default / full-auto / swarm / strict）+ solo 包装 + 单角色技能（进阶）三段重写；3 个手动链（feature / refactor / bugfix）删除（这些是 solo 内部的调度，不是用户手动选链） |
| 2 | `peaks-solo-test` 表行（CN+EN） | 描述从"`pnpm vitest run`"改为"从 `package.json` 探测测试工具（vitest / jest / mocha / pytest / ...），用项目原生命令跑"——与 `peaks-solo-test/SKILL.md` 的 hard rule 对齐 |
| 3 | 5 分钟上手段"对话示例"块 | 在 peaks-solo 那一行后追加一行 `peaks-solo 用 full-auto 模式做这个新功能`（带 # ← 日常最常见的真实用法 注释），让 solo 编排模式的"常用性"在第一屏就露脸 |
| 4 | 5 分钟上手段"4 步走" / "four steps" | 改为 5 步：(1) 触发命令从 `peaks-solo 分析` → `peaks-solo 全自动做`；(2) 不变；(3) 改写为"复杂任务分阶段，简单任务直接走 solo 全自动"；(4) **新增**：`peaks-solo-status` 看进度 + `peaks-solo-resume` 继续；(5) 把原步骤 4 的"结束时"挪到新步骤 5 |

**未触动**（保持稳定）：
- 顶部产品定位段（Round 2 已写多 IDE）
- 技能家族速查表（11 个 skill 完整）
- 自定义 SOP 章节（产品机制，跨 IDE 通用）
- 安装段、CLI 速查段、License 段

**承诺边界**（核对项）：
- "≥90% 的需求"是定性判断，不是统计数字。如果用户实际觉得 80% 更准确或 95% 更准确，告诉我改
- 新表格对 7 个角色技能的描述都缩到 1 行——比上方速查表更短，因为本段定位是"什么时候才需要"，不是"它做什么"。如果觉得信息丢了，把哪行展开告诉我

**前后对比**（核心差异）：

| 维度 | Round 3 README 写法 | Round 4 README 写法 |
|---|---|---|
| 工作流分类 | 3 个手动链（feature / refactor / bugfix） | 2 类用法（solo 编排 / 单独角色技能），solo 占 90%+ |
| 用户的入口 | "选一条链自己走" | "说 `peaks-solo 全自动做 X`，剩下 solo 处理" |
| 角色技能的角色 | 主流程成员 | 进阶选项（"只想做工作流一个阶段时才用"） |
| `peaks-solo-test` | `pnpm vitest run`（写死） | 从 package.json 探测（vitest / jest / mocha / pytest / ...） |
| 5 分钟上手第一步 | `peaks-solo 分析 /path/to/your-project` | `peaks-solo 全自动做 /path/to/your-project`（更接近日常） |

## Round 5 — 删面向贡献者段 + 5 分钟示例去重 + peaks-solo 默认模式去写死

**触发**（用户两轮反馈合并）：
1. 截图显示"## 本地开发（从源码跑 CLI）"段；用户说自己用 `/peaks-solo` 迭代 peaks-cli 自己，不需要手敲 `pnpm install` + `tsx` 路径
2. 截图显示 5 分钟示例里有两条 `peaks-solo` 行（"用全自动模式治理" + "用 full-auto 模式做这个新功能"），重复
3. 用户原话："`peaks-solo` 的默认是根据具体的任务和项目 LLM 会主动推荐的" + "不是写死的"——指出我在"两种基本用法"代码块里写"默认（assisted 模式，每步等确认）"是写死了默认行为

**变更范围**（每份 README 4 处，共 8 处编辑）：

| # | 位置 | 改动 |
|---|---|---|
| 1 | `## 本地开发（从源码跑 CLI）` / `## Local dev (running the CLI from source)` | 整段删除（含代码块、热重载句）—— 用户用 `/peaks-solo` 迭代，不需要这条 |
| 2 | `## 工程结构（了解 peaks-cli 本身）` / `## Project layout (the peaks-cli repo itself)` | 整段删除（含 IDE 适配层注释、src/ 树、bin/output-styles/docs/openspec/scripts/ 注释）—— 同样是面向"想给 peaks-cli 贡献代码的人"，对用户没价值；如果未来要写，应该去 CONTRIBUTING.md |
| 3 | 5 分钟上手段"对话示例"代码块 | 删掉 Round 4 加的那条 `peaks-solo 用 full-auto 模式做这个新功能` 重复行（带 `# ← 日常最常见的真实用法` 注释的那行）—— 保留原有的 `peaks-solo 用全自动模式治理 /path/to/your-project` |
| 4 | "两种基本用法"代码块注释 + 上方解释段 | 把"`# 默认（assisted 模式，每步等确认）`"改成"`# 默认（不写死，LLM 按任务和项目推荐）`"；其他 3 行（`全自动 / swarm / strict`）从"`模式`"改成"`显式 模式：xxx`"；解释段加一句"**默认模式不写死**：LLM 根据任务复杂度和项目状态主动推荐 assisted / full-auto / swarm / strict 中的一种；想自己指定时再显式标注" |
| 5 | 5 步走第 1 步 | 把 `peaks-solo 全自动做 /path/to/your-project` 改为 `peaks-solo 帮我做 /path/to/your-project`（LLM-picks-default 形式，不是显式 full-auto）+ 括号说明"LLM 会按任务和项目推荐模式；想直接定可以写 `peaks-solo 全自动做 ...` / `peaks-solo swarm ...` / `peaks-solo strict ...`" |

**未触动**（保持稳定）：
- 顶部产品定位段（Round 2 写的多 IDE 表述）
- 技能家族速查表（11 个 skill 完整，Round 4 已写）
- "两种基本用法"段本身（Round 4 框架保留，只改 1 处代码块注释 + 1 处解释段）
- 安装段、CLI 速查段、License 段
- "怎么用：技能优先，CLI 是门禁" / "How it works" 段
- 自定义 SOP 段

**承诺边界 / 核对项**：
- "LLM 按任务和项目推荐模式"是产品文档表述——peaks-solo SKILL.md 里 Step 1 是 `AskUserQuestion` 选 4 种 profile 之一（full-auto / assisted / swarm / strict），确实不是写死默认。这里只是把 README 表述与 SKILL.md 行为对齐
- 删除"## 工程结构"段意味着用户从 README 看不到 peaks-cli 的源码树——这是有意的面向用户/面向贡献者分离。如果用户希望恢复，告诉我加到 CONTRIBUTING.md
- 5 步走第 1 步的 `peaks-solo 帮我做` 与"两种基本用法"代码块第 1 行一致，3 个备用显式模式也一致——读起来协调

**前后对比**（核心差异）：

| 维度 | Round 4 README 写法 | Round 5 README 写法 |
|---|---|---|
| Local dev 段 | 完整（pnpm install + tsx + dev:watch） | 整段删除 |
| Project layout 段 | 完整（skills/src/bin/output-styles/docs/openspec/scripts） | 整段删除 |
| 5 分钟示例里 `peaks-solo` 行数 | 2 行（重复） | 1 行 |
| 5 分钟上手第 1 步 | 显式 `peaks-solo 全自动做` | 自然 `peaks-solo 帮我做`（让 LLM 选） |
| "两种基本用法"代码块 | 写死"默认 = assisted" | 写"默认 = LLM 推荐"；其他行标"显式 XX" |

## Round 6 — 5 分钟上手段：cwd 是项目根，命令里只说需求

**触发**：用户原话"这个使用示例有问题，应该是在适配的 AI IDE 中第一次显性的使用 `peaks-solo` 加需求描述，大多数是在项目的路径下运行 AI IDE"。

**问题诊断**（我之前写的）：
- 5 分钟示例里 `peaks-solo 用全自动模式治理 /path/to/your-project` —— 把项目路径塞进命令
- 5 步走第 1 步 `peaks-solo 帮我做 /path/to/your-project` —— 同样把路径塞进命令
- 这不符合真实使用模型：用户先 `cd /path/to/project` 启动 AI IDE（让 IDE 知道 cwd 是项目根），然后在 IDE 里对 AI 说需求描述

**变更范围**（每份 README 3 处，共 6 处编辑）：

| # | 位置 | 改动 |
|---|---|---|
| 1 | 5 分钟示例"对话示例"代码块（CN+EN） | 第 1 行 `peaks-solo 用全自动模式治理 /path/to/your-project` → `peaks-solo 帮我给登录页加 OAuth 回调` / `peaks-solo add OAuth callback to the login page` + 注释 "项目根 = IDE 当前 cwd" / "project root = the IDE's current cwd" |
| 2 | 5 步走列表 5 步 → 6 步（CN+EN） | 新增第 1 步"在项目目录里打开已适配的 AI IDE：`cd /path/to/your-project && <你的 IDE 命令，如 claude>`——让 IDE 知道项目根在哪"；原第 1 步挪到第 2 步，命令从 `peaks-solo 帮我做 /path/to/your-project` 改为 `peaks-solo 帮我做 X`（X = 需求描述），并把"X = 需求描述"显式标出 |
| 3 | "两种基本用法"/"Two basic ways"代码块第 1 行注释（CN+EN） | 在"默认（不写死，LLM 按任务和项目推荐）"基础上追加"；X = 需求描述；项目路径走 IDE 当前 cwd" / "; X = a need description; the project path is the IDE's current cwd" |

**未触动**（保持稳定）：
- 顶部产品定位段（Round 2 写的多 IDE 表述）
- 技能家族速查表（11 个 skill 完整，Round 4 已写）
- 安装段、CLI 速查段、License 段
- "怎么用：技能优先，CLI 是门禁" 段
- 自定义 SOP 段

**承诺边界 / 核对项**：
- "X = 需求描述" 与 `peaks-solo/SKILL.md` description 的 "the user asks Peaks-Cli to handle a project workflow end-to-end" 对齐——`peaks-solo` 接受的是"用户说要做什么"，不是"用户给项目路径"
- "项目路径走 IDE 当前 cwd" 是基础设施事实：peaks workspace init 与 peaks scan archetype 都读 cwd 找项目根；不是文档选择
- "X = 给登录页加 OAuth 回调" 是示例，与现有"为会员邀请功能整理产品目标、非目标和验收标准"在节奏上一致
- 6 步而不是 5 步是诚实的——"开 IDE"和"说命令"是 2 个不同动作，合并会让"在项目目录里开 IDE"这个前提被掩盖

**前后对比**（核心差异）：

| 维度 | Round 5 README 写法 | Round 6 README 写法 |
|---|---|---|
| 5 分钟示例第 1 行 | `peaks-solo 用全自动模式治理 /path/to/your-project` | `peaks-solo 帮我给登录页加 OAuth 回调` |
| 5 分钟示例第 1 行注释 | 无 | `项目根 = IDE 当前 cwd` |
| 5 步走步数 | 5 步 | 6 步 |
| 5 步走第 1 步 | "在已适配的 AI IDE 里对 AI 说 peaks-solo 帮我做 /path/to/your-project"（命令里塞路径） | "在项目目录里打开已适配的 AI IDE：`cd /path/to/your-project && <你的 IDE 命令，如 claude>`"（前提是 IDE 在项目目录里） |
| 5 步走第 2 步（迁移自原第 1 步） | `peaks-solo 帮我做 /path/to/your-project` | `peaks-solo 帮我做 X`（X = 需求描述） |
| "两种基本用法"代码块第 1 行注释 | `默认（不写死，LLM 按任务和项目推荐）` | `默认（不写死，LLM 按任务和项目推荐）；X = 需求描述；项目路径走 IDE 当前 cwd` |

## Round 7 — 支持 IDE 列表加 "等" + 一句话定位微调

**触发**（用户截图圈出 2 处）：
1. 第一处红框：`📋 **Codex / Cursor / Qoder / 通义灵码**（路线图）` —— 用户加 "等" 字，因为主流 IDE 不仅是这 4 个
2. 第二处红框：`> **一句话定位**：你**用技能工作**，CLI 是跨 IDE 的门禁引擎；技能形态会按 IDE 适配，但 CLI 契约、EDD 范式、PRD → RD → UI → QA → SC → TXT 的工作流顺序是稳定的。` —— 用户问"看要不要微调"。**判断：要微调**——原句与上方"支持的 IDE"列表 + 下方"两种基本用法"段重复了，且不像"一句话"。

**变更范围**（每份 README 2 处，共 4 处编辑）：

| # | 位置 | 改动 |
|---|---|---|
| 1 | "支持的 IDE"列表第 3 项（CN+EN） | `Codex / Cursor / Qoder / 通义灵码` → `Codex / Cursor / Qoder / 通义灵码 等`（EN: `, and more`）—— 显式声明"路线图是开放列表" |
| 2 | "一句话定位" / "One-line positioning"（CN+EN） | 删 3 个分句：(1) "技能形态会按 IDE 适配"——上方"支持的 IDE"列表已表达；(2) "但 CLI 契约、EDD 范式、PRD → RD → UI → QA → SC → TXT 的工作流顺序是稳定的"——下方"两种基本用法"段已表达。**新句只保留 2 个核心**：技能 = 你做的事；CLI = 跨 IDE 稳定的门禁引擎 |

**未触动**（保持稳定）：
- 顶部产品定位段（"Peaks 是一个跨 AI IDE 的工作流门禁 CLI + 技能家族"——这是产品定位段，比"一句话定位"长，是正常的）
- 技能家族速查表、5 分钟上手段、两种基本用法、安装段、CLI 速查、License 段

**承诺边界 / 核对项**：
- 删 "EDD 范式" 在 README 里的唯一一次提及 —— "EDD" 是用户 CSDN 文章里的范式名（`peaks-solo/SKILL.md` 里不叫 EDD）。如果用户认为 EDD 是产品品牌一部分、需要在 README 留入口，告诉我加在哪
- 删 "CLI 契约" 措辞 —— "契约" 在下方"怎么用：技能优先，CLI 是门禁"段和 CLI 速查段都出现过，读者不丢信息
- 加 "等" 字是承诺边界声明："路线图是开放列表"——以后再增加新 IDE 时，不需要更新 README 列表，只需更新 `peaks-solo/SKILL.md` 之类内部源

**前后对比**（核心差异）：

| 维度 | Round 6 README 写法 | Round 7 README 写法 |
|---|---|---|
| 支持的 IDE 列表第 3 项 | `Codex / Cursor / Qoder / 通义灵码`（闭口） | `Codex / Cursor / Qoder / 通义灵码 等`（开放） |
| 一句话定位（CN）长度 | 1 句 3 分句（含工作流顺序） | 1 句 1 分句（仅核心 mental model） |
| "EDD" 在 README 是否出现 | 出现 1 次 | 不出现 |
| "CLI 契约" 在一句话定位是否出现 | 出现 | 不出现（下方段仍有） |

## Round 10 — 6 步走拆分：用户操作 vs peaks 自动

**触发**（用户截图圈出）：6 步走列表里，**前 2 步是用户操作**（开 IDE + 说命令），**后 4 步是 peaks 自动**（跑 CLI、扫项目、协调角色、收尾）。混在一个"6 步走"列表里让用户分不清"我该做"和"系统会做"，有误导。

**变更范围**（每份 README 1 段，共 2 处编辑）：

| # | 位置 | 改动 |
|---|---|---|
| 1 | 第一次使用段（CN+EN）| 把"照这 6 步走"列表拆成两个块：(A) "你需要做的（2 步）" 包含原步骤 1+2；(B) "之后 peaks 会自动" 包含原步骤 3+4+5+6（peaks-solo-status / -resume 放在这里因为它们是用户主动调用的，但属于"用户问 peaks 要结果"的同类——peaks 接收指令并返回/执行） |

**未触动**（保持稳定）：
- 顶部产品定位段
- 5 分钟上手"对话示例"代码块
- 技能家族速查表
- "你想要随时确认状态？" / "Want a quick status check?" 段 + CLI 速查命令块
- 两种基本用法
- 安装段、CLI 速查段、License 段
- SKILL.md 自身、CLI 引擎、package.json

**承诺边界 / 核对项**：
- 拆 6 步为 2+4 块后，"步骤"语义被"块"取代——这是有意的：6 步的"step"暗示用户必须按顺序做 N 件事；2+4 块的"块"暗示"2 个用户操作 → peaks 接管剩下"，更准确
- `peaks-solo-status` 和 `peaks-solo-resume` 放在 "peaks 会自动" 块里——它们是"用户问 peaks 要结果"型交互，性质上属于 peaks 的职责范围，不是"用户必须主动做的操作"。但严格说它们是用户主动调用的，如果用户觉得应该归到"用户做"块里，告诉我挪
- 段头从"第一次使用？照这 6 步走" 改为 "第一次使用？分两层：**你做 2 步，peaks 接管剩下**"——一句话给读者 mental model

**前后对比**（核心差异）：

| 维度 | Round 9 README 写法 | Round 10 README 写法 |
|---|---|---|
| 段头 | 第一次使用？照这 6 步走 | 第一次使用？分两层：你做 2 步，peaks 接管剩下 |
| 列表结构 | 1 个平铺 6 步 | 2 个块："你需要做的（2 步）" / "之后 peaks 会自动" |
| 用户操作可识别性 | 弱（混在 6 步里）| 强（明确标"2 步"）|
| peaks 自动可识别性 | 弱（混在 6 步里）| 强（明确标"peaks 会自动"）|
| 步骤 3-6 措辞 | "技能会自动跑..." / "技能会..." | "peaks 会自动..." / "peaks 接管..." —— 主语从"技能"统一到"peaks"（与"产品定位"段措辞对齐）|

## Round 9 — 主句语气翻转：LLM 自由判断做主，peaks 做"护栏 + 记忆"

**触发**（用户两轮反馈合并）：
1. 第一轮：把 "门禁引擎" 改成 "质量保障"；加 3 句核心理念（SOP 严格 + 可审计 / 项目级持久记忆 / AI IDE 和 LLM 越来越懂项目）—— 用户已批准
2. 第二轮（系统提醒紧跟）："**现在的会有歧义，会让人感觉是完全限制和教AI做事，这个是和当下的AI编程背道而驰**" —— 用户在看到 Round 8 措辞后指出"让 LLM 严格按 SOP 干活"读起来像完全限制 + 教 AI 做事，违背当下 AI 编程的自主性方向

**问题诊断**（Round 8 措辞的歧义点）：
- "让 LLM 严格按 SOP 干活、每一步可审计" —— 主语是 LLM，修饰词"严格"+"可审计"读起来像教 AI 做事
- "我们的目标"被读成"我们的目标是管住 LLM"
- 当时给的 reframe（Round 9 第一版"让流程严格按 SOP 走"）仍有问题：主语换到"流程"但"严格按 SOP 走"+"每一步可审计"语气仍偏重

**变更范围**（每份 README 1 段，共 2 处编辑）：

| # | 位置 | 改动 |
|---|---|---|
| 1 | "我们的目标" 句（CN+EN）| **主句从"严格 SOP / 严格可审计"翻转为"LLM 自由判断"**；peaks 的贡献（"流程边界上的 SOP 护栏"+"项目级记忆沉淀"）放在主句之后做并列——读起来是"peaks 加在 LLM 自主性之上"，不是"peaks 约束 LLM" |

**未触动**（保持稳定）：
- "产品定位" 段名（Round 8 引入）
- "你用技能工作，CLI 是跨 IDE 的质量保障层" 上一句（mental model 不变）
- 顶部其他段（品牌段、支持的 IDE 列表）
- 技能家族速查表、5 分钟上手段、两种基本用法、安装段、CLI 速查、License 段
- SKILL.md 自身、CLI 引擎、package.json

**承诺边界 / 核对项**：
- 删"严格按 SOP 干活 / strictly follow SOPs"措辞——但"按 SOP 走"的产物（门禁 / 阶段 / 钩子）依然在下方"自定义 SOP"段（CN 行 158-167、EN 行 137-149）展开，不丢信息
- 加"peaks 在流程边界上提供可审计的 SOP 护栏"——"护栏"是新的隐喻，替代了之前"门"的隐喻
- 加"在每个环节里自由判断与决策 / exercise full judgment in each step"——明确 LLM 的自主性边界
- "和当下的 AI 编程背道而驰"这句用户原话没有进 README（避免 README 出现"和当下趋势"这种自夸/自省语气）

**前后对比**（核心差异）：

| 维度 | Round 8 README 写法 | Round 9 README 写法 |
|---|---|---|
| 主句主语 | "让 LLM 严格按 SOP 干活" | "让 LLM 在每个环节里自由判断与决策" |
| 主句语气 | 严格 / 强制 | 自由 / 自主 |
| peaks 的位置 | 主句的"严格"承担者 | 主句后的并列补充（"peaks 在流程边界上提供 SOP 护栏"） |
| "严格" 措辞 | 出现 1 次（"严格按 SOP 干活"）| 不出现（"严格"被"自由"取代；SOP 边界只说"可审计") |
| 隐喻 | 隐含"管 LLM" | "护栏" —— 护栏不替车开；只是不让车出界 |
| CN 总字数 | 67 字 | 73 字（多 6 字 = "peaks 在流程边界上提供可审计的 SOP 护栏" 替代"让 LLM 严格按 SOP 干活、每一步可审计"）|
| EN 总词数 | 36 词 | 38 词（多 2 词 = "peaks provides an auditable SOP guardrail at process boundaries" 替代"make the LLM strictly follow SOPs with every step auditable"）|

## Round 8 — "产品定位"重写：从"门禁引擎"到"质量保障层" + 4 句核心理念

**触发**（用户两轮反馈合并）：
1. 第一轮：把 "门禁引擎" 改成 "质量保障"；加 3 句核心理念（SOP 严格 + 可审计 / 项目级持久记忆 / AI IDE 和 LLM 越来越懂项目）
2. 第二轮（Round 8 末尾系统提醒）："核心大概是这个意思，不需要完全照搬" —— 用户授权可以**用自己的措辞**重述 4 个核心点，不必逐字照搬原话

**变更范围**（每份 README 1 段，共 2 处编辑）：

| # | 位置 | 改动 |
|---|---|---|
| 1 | "一句话定位" / "One-line positioning"（CN 行 14-15、EN 行 14-15） | 段名 → "产品定位" / "Positioning"（内容已不止一句）；mental model 措辞从"门禁引擎" → "质量保障层" / "quality assurance layer"；新加 1 段核心理念，4 个核心点用自然措辞表述 |

**4 个核心点的产品对应**（自检表）：

| 核心点 | 用户原话 | README 措辞 | 实际产品对应 |
|---|---|---|---|
| SOP 严格 + 可审计 | "LLM 严格按照 SOP 规范要求完成并且可审计" | "让 LLM 严格按 SOP 干活、每一步可审计" | `peaks-sop` 技能（自定义 SOP 生命周期）+ `peaks hooks install`（门禁不可绕过）+ `peaks-sc` 技能（commit 边界 / 变更追踪）|
| 项目级持久记忆 + 使用经验 | "项目级的持久记忆和使用经验等的存储" | "把项目级记忆和使用经验沉淀下来" | `.peaks/memory/` 目录（LLM 写的事实/决策/模块/约定）+ `peaks project memories` CLI + `peaks memory extract` |
| AI IDE / LLM 越来越懂项目 | "让 AI IDE 和 LLM 越来越懂你的项目" | "AI IDE 和 LLM 在你的项目上用得越久就越懂它" / "the AI IDE and the LLM grow to know your project better the more you use them" | `peaks-solo` 每次启动读 `peaks project memories` 注入项目级 context |
| 质量保障定位 | "CLI 是跨 IDE 的质量保障" | "CLI 是跨 IDE 的质量保障层" | CLI 引擎（gates + JSON 契约 + 不可逆副作用三件套）+ 跨 IDE 稳定（不被各 IDE 绑定）|

**措辞策略说明**（按"不需要完全照搬"指示）：
- 用户原话 4 句是**口语化的并列短句**；README 措辞是**自然的书面句**，2 句压缩 4 个核心
- CN: "我们的目标" + 冒号引出 2 句并列分句（"让 LLM..." / "把项目级...沉淀下来"），末句"AI IDE 和 LLM 在你的项目上用得越久就越懂它"作收
- EN: "Our goal" + 冒号引出 2 个并列动词不定式短语（"make the LLM..." / "accumulate..."），末句用 "the more you use them" 表达"用得越久越懂"

**未触动**（保持稳定）：
- "支持的 IDE"列表（Round 7 写的"等"字保持）
- 技能家族速查表、5 分钟上手段、两种基本用法、安装段、CLI 速查、License 段
- SKILL.md 自身、CLI 引擎、package.json

**承诺边界 / 核对项**：
- 删 "门禁引擎" 措辞——但 "门禁" 在下方 "自定义 SOP" 段（CN 行 158-167、EN 行 137-149）保留"杀手锏：不可绕过的门禁"，不丢信息
- 加 "项目级记忆" 措辞——对应 `.peaks/memory/` 和 `peaks project memories` CLI，是真实存在的产品机制
- "AI IDE 和 LLM 越来越懂你的项目" 是产品 outcome——与 `peaks-solo/SKILL.md` 的 Step 2.3 "Load project memory" 行为对齐
- 段名从"一句话定位"→"产品定位"：因为内容已不止一句。如果用户觉得段名想保留"一句话定位"的简洁，告诉我改回去

**前后对比**（核心差异）：

| 维度 | Round 7 README 写法 | Round 8 README 写法 |
|---|---|---|
| 段名 | 一句话定位 / One-line positioning | 产品定位 / Positioning |
| mental model | 跨 IDE 稳定的门禁引擎 | 跨 IDE 的质量保障层 |
| 核心理念（4 点） | 无 | 4 点用 2 个并列分句压缩 |
| CN 总字数（含标点）| 30 字 | 67 字（多 37 字 = SOP+记忆+AI 越来越懂） |
| EN 总词数 | 14 词 | 36 词（多 22 词 = 同上） |

## Round 3 — npm 页面仓库链接 + README badges

**触发**：用户提出希望 GitHub 仓库地址 `https://github.com/SquabbyZ/peaks-cli` 在 npm 发布页面能直接看到；附带要求 README 互跳按钮（已在 Round 2 完成）。

**变更范围**（3 个文件）：

| 文件 | 改动 |
|---|---|
| `package.json` | (1) `description` 改写为多 IDE 表述（与 Round 2 README 定位段对齐）；(2) 新增 `repository` / `homepage` / `bugs` 三个字段（按 npm registry 标准字段顺序，插在 `publishConfig` 之后、`bin` 之前） |
| `README.md` (CN) | 标题块紧跟语言切换按钮后，加 2 行 badges：`npm version` + `GitHub repo`（shields.io 渲染，点击跳到 npm 包页和 GitHub 仓库） |
| `README-en.md` (EN) | 同上，badges 块与 CN 一致 |

**package.json 字段顺序变化**（仅顺序、字段值是新增的）：

```diff
   "publishConfig": {
     "access": "public"
   },
+  "repository": {
+    "type": "git",
+    "url": "https://github.com/SquabbyZ/peaks-cli.git"
+  },
+  "homepage": "https://github.com/SquabbyZ/peaks-cli",
+  "bugs": {
+    "url": "https://github.com/SquabbyZ/peaks-cli/issues"
+  },
   "bin": {
```

**为什么这不需要 RD/QA 流水线**：
- 纯 metadata 变更，不影响 CLI 行为、`bin`、脚本、依赖、文件清单
- 改动可逆（回退 4 个字段即可）
- 不影响 `node_modules`、不需要 `pnpm install`
- `pnpm typecheck` / `pnpm vitest run` 不会因为这 4 个字段变绿/红

**npm 页面会发生什么**（下次 `pnpm publish` 后）：
- 右侧栏出现 "Repository" → 跳 `https://github.com/SquabbyZ/peaks-cli`
- 右侧栏出现 "Homepage" → 跳 `https://github.com/SquabbyZ/peaks-cli`
- 右侧栏出现 "Issues" → 跳 `https://github.com/SquabbyZ/peaks-cli/issues`
- 左侧副标题从 "Peaks CLI and short skill family for Claude Code automation." 改为多 IDE 描述

**核对**（用户发布前可跑）：
```bash
pnpm pack --dry-run
# 确认 tarball 里 package.json 的 repository / homepage / bugs 三个字段正确带上
# 不需要真的 publish
```

**未触动**（保持稳定）：
- `bin` / `dependencies` / `devDependencies` / `scripts` / `files` / `engines` —— 0 改动
- 11 个 `peaks-*` 技能的任何文件
- `src/` / `tests/` / `schemas/` 任何源文件
- 自定义 SOP 章节、安装段、CLI 速查、License 段

**承诺边界**（核对项）：
- URL 用 `https://github.com/SquabbyZ/peaks-cli.git`（与 git remote 一致）；npm registry 接受 https URL 作为 repository url
- `bugs.url` 用 issues URL；如需独立的邮箱（如 `SquabbyZ@users.noreply.github.com`），不在本 slice 范围

## Next action

需要的话由用户自行决定：

1. `git add README.md README-en.md && git commit -m "docs(readme): sync skill count, version, new subcommands to current state"`（按用户的 commit policy 自行提交）
2. 不提交，保留 working tree 让用户 review
3. 继续下一个需求

## 关联 artifact

- 工作区：`.peaks/2026-06-05-session-6e8d7d/`
- presence：peaks-solo / mode=assisted / gate=handoff
- 标题：更新 README 和 README-en 反映最近改动
