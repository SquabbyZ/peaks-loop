<div align="center">

# ⛰️ Peaks

<img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=700&size=22&duration=3000&pause=800&color=6366F1&center=true&vCenter=true&multiline=true&width=720&height=110&lines=peaks-cli%3A%20跨%20AI%20IDE%20的工程门禁与编排;11%20个%E2%9A%99%EF%B8%8F%20工作流技能%20%2B%20%E2%9A%96%EF%B8%8F%20可执行门禁;%E2%9C%89%EF%B8%8F%20%E2%9A%96%EF%B8%8F%20%E2%9C%89%EF%B8%8F%20%E2%9A%91%EF%B8%8F%20%E2%9A%96%EF%B8%8F%20%E2%9C%89%EF%B8%8F%20%E2%9A%91%EF%B8%8F%20门禁%20%2B%20审计%20%2B%20跨%20IDE%20适配" alt="peaks-cli tagline typing animation" />

[English](./README-en.md) | **简体中文**

<table>
<tr>
<td align="center" width="180"><b>🔥 PROJECT</b></td>
<td align="center" width="180"><b>⚡ BASED ON</b></td>
<td align="center" width="180"><b>📚 SKILLS.SH</b></td>
</tr>
<tr>
<td align="center"><a href="https://github.com/SquabbyZ/peaks-cli">peaks-cli / 首页</a></td>
<td align="center">13 Skills + Cross-IDE</td>
<td align="center"><a href="https://skills.sh/SquabbyZ/peaks-cli">在 skills.sh 收录</a></td>
</tr>
<tr><td colspan="3">&nbsp;</td></tr>
<tr>
<td align="center" width="180"><b>⭐ STARS</b></td>
<td align="center" width="180"><b>📦 VERSION</b></td>
<td align="center" width="180"><b>📄 LICENSE</b></td>
</tr>
<tr>
<td align="center"><a href="https://github.com/SquabbyZ/peaks-cli/stargazers"><img src="https://img.shields.io/github/stars/SquabbyZ/peaks-cli?style=for-the-badge&logo=github&logoColor=white" alt="stars" /></a></td>
<td align="center"><a href="https://www.npmjs.com/package/peaks-cli"><img src="https://img.shields.io/npm/v/peaks-cli?style=for-the-badge&logo=npm&logoColor=white&color=CB3837" alt="npm version" /></a></td>
<td align="center"><a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="license" /></a></td>
</tr>
<tr><td colspan="3">&nbsp;</td></tr>
<tr>
<td align="center" width="180"><b>🧪 TESTS</b></td>
<td align="center" width="180"><b>🔧 LANG</b></td>
<td align="center" width="180"><b>📥 DOWNLOADS</b></td>
</tr>
<tr>
<td align="center"><b>2,800+</b></td>
<td align="center"><b>TypeScript</b></td>
<td align="center"><a href="https://www.npmjs.com/package/peaks-cli"><img src="https://img.shields.io/npm/dm/peaks-cli?style=for-the-badge&logo=npm&logoColor=white&color=CB3837" alt="downloads" /></a></td>
</tr>
<tr><td colspan="3">&nbsp;</td></tr>
<tr>
<td align="center" width="180"><b>🌐 中文</b></td>
<td align="center" width="180"><b>🚀 QUICK START</b></td>
<td align="center" width="180"><b>👁️ VISITORS</b></td>
</tr>
<tr>
<td align="center"><a href="./README.md">简体中文</a></td>
<td align="center"><a href="#-30-秒跑起来">30 秒跑起来 →</a></td>
<td align="center"><img src="https://komarev.com/ghpvc/?username=SquabbyZ&repo=peaks-cli&label=views&color=blue&style=for-the-badge" alt="visitors" /></td>
</tr>
</table>

<img src="https://github-readme-streak-stats.herokuapp.com?user=SquabbyZ&repo=peaks-cli&theme=radical&hide_border=true&date_format=j%20M%5B%20Y%5D" alt="GitHub Streak Stats" />

[安装](#-30-秒跑起来) · [5 分钟上手](#-5-分钟上手) · [技能家族](#-11-个技能家族) · [杀手锏：不可绕过的门禁](#-杀手锏不可绕过的门禁)

</div>

---

## 🤔 为什么是 Peaks

> 你把 `git push --force`、`rm -rf`、`npm publish`、`DROP TABLE` 这类不可逆动作**写进 CLAUDE.md** 吗？
> LLM 不会真听。它有 99% 的概率会"尊重你的偏好"，然后在下一次对话里忘掉。
> **CI 只能在合并时拦；规则只能靠自觉；只有门禁（gates）能在 agent 拔刀的瞬间摁住它。**

Peaks 把 AI IDE 里的"工程团队"建模成 13 个工作流技能 + 一组**可执行的门禁**：

- 🧭 **技能（skills）**——`peaks-solo` 编排，`peaks-prd/rd/qa/ui/sc/txt/sop` 各管一段；LLM 按任务自动选对的人
- 🚧 **门禁（gates）**——SOP 在每个 phase 上挂"可检查条件"（文件存在 / grep 命中 / 命令退出码），不满足就把 `git push` 在 agent 自己面前拦下——**连 `--dangerously-skip-permissions` 都绕不过**
- 🧠 **项目记忆（memory）**——`.peaks/memory/` 把决策、踩坑、约定落盘到 git 一起被 commit；下个 session 接手不用问"为什么这么写"
- 🌐 **跨 IDE**——一个 CLI 适配 Claude Code / Trae / Cursor / Codex / Qoder；技能注册到 IDE 原生格式
- 📦 **生态可发现**——13 个技能同样发布到 [skills.sh](https://skills.sh)，按需 `npx skills add` 单点装

## 🚀 30 秒跑起来

```bash
# 1. 装 CLI
npm install -g peaks-cli

# 2. 在你的项目里打开 Claude Code
cd /path/to/your-project && claude

# 3. 让 AI 干活
> peaks-solo 帮我给登录页加 OAuth 回调
```

完了。第一次跑 peaks 会自动建 `.peaks/` 工作区 + 扫一次项目原型 + 把任务分给对的技能（PRD → 工程切片 → UI → QA → 变更控制 → 知识压缩），中间产物全部落盘。**日常使用 1 个技能（`peaks-solo`）覆盖 ≥ 90% 的需求**。

## 🧠 peaks-context — 上下文构建模块 (v3.0)

peaks-context 是 CLI 强制执行的上下文采集器,**不再依赖 LLM 自主"读 package.json"**。

```bash
peaks context build --goal "<你的需求>" --project . --audience peaks-rd --out context.json
peaks context validate context.json
peaks context inspect context.json
```

**承诺**:deps 锁版本 antd@5.21.0 → context.json 绝不返回 6.x API 文档。  
详见 [design spec §4.1](../../docs/superpowers/specs/2026-06-21-context-audit-redesign-design.md)。

## 🧬 peaks-mut — 测试假绿拦截 (v3.0)

peaks-mut 通过变异测试 + 断言有效性扫描拦截测试假绿:

```bash
peaks mut run --project . --test-files src/A.test.ts --input-sig <TACT.sig> --out mut-report.json
peaks mut mutants --in mut-report.json
peaks mut asserts --in mut-report.json
peaks mut report --in mut-report.json
```

**默认阈值**:变异杀灭率 ≥ 80%、弱断言比例 ≤ 5%。详见 [design spec §4.2](../../docs/superpowers/specs/2026-06-21-context-audit-redesign-design.md)。

## 🎯 peaks-rd 双阶段 (v3.0)

peaks-rd 现在拆成两阶段:

1. **战略审计**:写 `strategy.md` + `STRAT.sig`(根因分析 + 影响面)
2. **战术审计**:写 `impl.json` + `TACT.sig`,**AST 硬门禁拦截版本错配的 API 调用**

详见 [design spec §4.2](../../docs/superpowers/specs/2026-06-21-context-audit-redesign-design.md)。

## ⏱️ 5 分钟上手

在 IDE 对话里直接对 AI 说：

```text
peaks-solo 帮我给登录页加 OAuth 回调      # 端到端编排（最常用）
peaks-prd  为会员邀请功能整理产品目标、非目标和验收标准
peaks-rd   分析这次重构的最小实现切片和风险
peaks-qa   为这次改动设计测试和回归验证清单
peaks-ui   设计登录页的交互和视觉方案
peaks-sc   记录这次变更的影响范围、artifact 留存和 commit 边界
peaks-txt  为当前模块生成上下文胶囊，保留关键决策
peaks-sop  帮我把"内容发布"流程变成带门禁的 SOP
```

**两种基本用法**：

1. **让 `peaks-solo` 编排**（绝大多数情况）——告诉它做什么，剩下 PRD → RD → UI → QA → SC → TXT 的链路它自己协调
2. **直接调单个角色技能**（进阶）——只想做工作流的某一段时，跳过整 pipeline

随时确认状态？让 AI 跑一下：

```bash
peaks -V                       # 版本
peaks doctor --json            # 环境/技能/配置一键体检
peaks project dashboard --project . --json   # 当前项目一眼看完
```

## 🧰 13 个技能家族

| 技能 | 你用它做什么 | 典型场景 |
|------|------------|----------|
| `peaks-solo` | **端到端编排入口**，自动协调 prd/rd/ui/qa/sc/txt | 全流程开发、PRD-to-ship、跨子任务批量迭代 |
| `peaks-prd` | 模糊意图 → **可验收 PRD**（目标/非目标/行为保留/验收） | 需求整理、PRD 撰写、重构目标 |
| `peaks-rd` | 工程分析 + 切片规划 + 风险 + 执行契约 | 架构分析、最小切片、风险评估 |
| `peaks-qa` | 测试设计 + 覆盖率 + 回归矩阵 + 验收证据 | 测试用例、回归、浏览器 E2E |
| `peaks-ui` | 视觉方向 + 交互方案 + 设计系统约束 | 页面设计、交互、原型、UI 回归 |
| `peaks-sc` | 变更追踪 + commit 边界 + 留存策略 + 回滚证据 | 影响范围、变更控制、审计 |
| `peaks-txt` | 上下文胶囊 + 决策记录 + 知识压缩 | 模块理解、决策留存、复盘 |
| `peaks-sop` | **把你的工作流变成带门禁的 SOP**（不只研发） | 内容发布、合规清单、数据 pipeline、运维 runbook |
| `peaks-solo-resume` | 继续刚才没做完的切片 | 「继续完成刚才未完成的」 |
| `peaks-solo-status` | 一眼看到现在到哪了 | 「现在到哪了」 |
| `peaks-solo-test` | 跑项目测试（自动探测 vitest/jest/pytest/...） | 「跑测试」 |
| `peaks-security-audit` | **独立安全审计**（OWASP Top-10 + 8-dim 威胁模型） | 新增鉴权/凭证/SQL 注入/外部 API 等安全面改动 |
| `peaks-perf-audit` | **独立性能审计**（6-dim 性能影响） | 改热循环/I-O/并发/bundle/cold-start |

**3 solo 包装 + 7 角色技能 + 2 独立审计 + 1 编排器 = 13 个。日常 1 个 `peaks-solo` 覆盖 ≥ 90%。**

> **v2.13.0 新增**：zero-human-intervention **auto-compact**（`peaks solo context-now` + `peaks solo auto-compact`）——peaks-cli 自己探测 context %，≥85% 主动收敛（写 checkpoint + 收敛计划 + 触发 IDE compact），≥95% 强制同步压缩红线。LLM-runner 上下文始终 < 95% 自主运行，零介入。

## 🚧 杀手锏：不可绕过的门禁

> CI 只能在**合并时**拦；`CLAUDE.md` 规则靠 agent **自觉**。**SOP 能做到 CI 和提示词都做不到的事——在 agent 拔刀的瞬间把它摁住。**

```jsonc
// sop.json
"guards": [ { "phase": "publish", "bash": "git +push" } ]
```

```bash
peaks hooks install --project <repo>   # 显式 opt-in：装一条 PreToolUse 规则
```

之后 agent 在 `publish` 阶段的门禁没全过就想 `git push`，Claude Code 会收到 `permissionDecision: "deny"`，**在任何权限检查之前就被拦下——连 `--dangerously-skip-permissions` 都绕不过**。门禁三种类型：

| 类型 | 含义 | 例子 |
|------|------|------|
| `file-exists` | 文件存在 → pass | `CHANGELOG.md` 存在 |
| `grep`（含 `absent`） | 文件内正则匹配 → pass；`absent: true` 反转 | "正文里没有 `TODO`" |
| `command` | 跑命令并按退出码判定（默认拒绝，需 `--allow-commands`） | 跑 `npm test` |

定义层（`sop.json` + `SKILL.md`）可以放**全局** `~/.peaks/sops/`（个人跨项目）或**仓库** `<repo>/.peaks/sops/`（随 git 提交、团队共享，仓库层优先）。**紧急放行**用 `peaks gate bypass --sop <id> --phase <phase> --reason "<原因>"`（一次性、记原因、有上限）。

## 🌍 真实场景

**场景 1：临时决定重构鉴权模块**

```text
> peaks-rd 分析 src/auth/ 的现状，给我一份最小切片方案
```
`peaks-rd` 出：3 阶段切片、风险评估、回归点、可执行契约。**写不写代码你定**。

**场景 2：把"内容发布"变成受控流程**

```text
> peaks-sop 帮我把"博客发布"做成带门禁的 SOP：草稿写完 → 自检（无 TODO/字数 ≥ 800） → 人工 review → 才允许发布
```
`peaks-sop` 生成 `sop.json` + `SKILL.md`，注册到全局，**从此 agent 跳过任何一步都发不出文章**。

**场景 3：浏览器 E2E 回归**

```text
> peaks-qa 用浏览器跑一次完整注册 → 登录 → 看板的核心流，把卡点列出来
```
`peaks-qa` 出：测试矩阵、回归清单、`code-review.md` 风格的证据文档。

**场景 4：第二天回来继续昨天的切片**

```text
> peaks-solo-resume
```
检测 in-flight slice 的最深已完成 gate，省 3-5k token 重新读 artifact。**会话断了不丢上下文**。

## 📦 在 skills.sh 上发现 peaks 技能

peaks 的 13 个 `peaks-*` 技能自动收录到 [skills.sh](https://skills.sh) 注册表——**不需要单独去 skills.sh 网站注册**。收录靠仓库里**自带配置**：

- 13 个 `skills/<name>/SKILL.md`（每个都有 `name` + `description` YAML frontmatter）—— skills.sh 的标准发现约定
- `.claude-plugin/marketplace.json` —— 显式列出 13 个公开技能（隐藏的内部 `peaks-doctor` / `peaks-ide` 通过 `metadata.internal: true` 屏蔽）

任何装了 `npx skills` 的环境（Claude Code、Cursor、Codex 等）都能直接拉取：

```bash
# 装全部 13 个：
npx skills add SquabbyZ/peaks-cli

# 或只装一个：
npx skills add SquabbyZ/peaks-cli --skill peaks-solo
npx skills add SquabbyZ/peaks-cli --skill peaks-rd
npx skills add SquabbyZ/peaks-cli --skill peaks-sop
```

浏览 [skills.sh/SquabbyZ/peaks-cli](https://skills.sh/SquabbyZ/peaks-cli) 看完整目录。技能和 `npm install -g peaks-cli` 是同一份内容——两条路径产物一致。

## 🛠️ 怎么用：技能优先，CLI 是门禁

`peaks <cmd>` CLI **不是日常使用的主要入口**。它存在有三个理由，全是机器层保障：

1. **不可逆动作的显式 opt-in**（`peaks sop init --apply`、`peaks openspec archive --apply`）—— 不能靠 LLM"自觉"挥下
2. **结构化 JSON 契约**（`peaks request show ... --json`、`peaks scan archetype ... --json`）—— 让技能读回可机读判决作为下游决策
3. **hook / CI / 脚本场景下能被程序化调用**（`peaks hooks install`、`peaks gate enforce`）—— 把"必须满足门禁才能做 X"从纸面规则变成可执行规则

一句话：**技能 = 流程的大脑；CLI = 流程的骨节**。

### 你**会**看到的 CLI 命令

```bash
peaks workspace init / reconcile / scan archetype / scan libraries
peaks request init / show / transition          # PRD/RD/QA/SC 请求状态机
peaks session list / info / title / rotate
peaks sop init / lint / check / advance / register
peaks code-review detect-ocr / config-template / run-ocr   # 阿里 Open Code Review 第二意见
peaks hooks install / gate enforce / gate bypass
peaks project dashboard / memories
```

完整列表跑 `peaks --help`。

## 🌐 支持的 IDE

| IDE | 状态 |
|---|---|
| ✅ **Claude Code** | 13 技能 + PreToolUse hook，agent team dogfood 通过 |
| ⚠️ **Trae** | slim `IdeAdapter` 已注册，真实 Trae 集成留到后续切片 |
| 📋 **Codex / Cursor / Qoder / 通义灵码 等** | 路线图 |

## 🪝 Hooks

peaks-cli 把自己注册为 Claude Code / Trae 的 PreToolUse hook，在**对话中途、面向 agent 本身**拦下不可逆动作——这是 CI 拦不住、CLAUDE.md 只能靠自觉的盲区。

### 装 / 卸

```sh
# 装到当前项目（写入 .claude/settings.json，幂等）
peaks hooks install

# 装到全局（写入 ~/.claude/settings.json）
peaks hooks install --global

# 查状态
peaks hooks status
peaks hooks status --global

# 卸（只卸 peaks 自己注册的；保留其他第三方 hook）
peaks hooks uninstall
```

装完之后**重启 IDE（或 reload workspace）**让 hook 生效。

### 装了什么

装的是 `peaks gate enforce` 这条 PreToolUse `Bash` 入口——每次 Bash 调用都会跑 SOP 门禁。命中失败 → 写 `permissionDecision: "deny"` 到 stdout + `process.exitCode = 2`，Claude Code 在权限检查**之前**就拦下来（连 `--dangerously-skip-permissions` 也拦得住）。完整审计表见 [`.claude/HOOKS.md`](./.claude/HOOKS.md)。

### 输出契约

| 信号          | 走哪                                    | 含义                       |
|---------------|-----------------------------------------|----------------------------|
| `stdout` JSON | `emitBlock` / `emitDecision`            | 给宿主读的 allow/deny 决策 |
| `stderr` 文本 | `emitHint`                              | 给 LLM/操作者看的人话提示  |
| 退出码 `0`    | 允许                                    | 宿主继续                   |
| 退出码 `2`    | 阻塞（`emitBlock` 专用）                | 宿主必须停                 |

所有 hook 走 `src/services/hooks/output.ts` 三个 helper：`emitHint` / `emitBlock` / `emitDecision`。跨平台契约测试（darwin / linux / win32）在 `tests/unit/hooks/contract.test.ts`。

### 一次性放行

```sh
peaks gate bypass --sop <id> --phase <phase> --reason "<why>"
```

下次匹配的 Bash 命令放行一次（每个 SOP 每项目上限 3 次）。完整文档：[`.claude/HOOKS.md`](./.claude/HOOKS.md)。

## 🏗️ 项目状态

- ✅ **13 技能** + 跨 IDE CLI + 2800+ 测试（v2.12.0 新增 `peaks-security-audit` + `peaks-perf-audit`）
- ✅ **门禁机制** 已在真实项目 dogfood
- ✅ **v2.12.0 RD fan-out 收缩**（3 路：code-reviewer + qa-test-cases-writer + karpathy-reviewer）2026-06-27 发布
- ✅ **v2.13.0 零介入 auto-compact**（peaks-cli 自主压缩任意 AI CLI 的上下文，runner 始终 < 95%）2026-06-27 发布
- 📋 路线图：Trae / Codex / Cursor 真实集成、`peaks-doc` / `peaks-i18n`、SOP 模板市场

详细看 [`CHANGELOG.md`](./CHANGELOG.md) 和 [`docs/`](./docs/)。

## 📄 许可

[MIT](LICENSE) — 商用、改、私有 fork 都欢迎，保留版权即可。

## 💬 加入微信交流群

遇到使用问题、功能建议、或者想和其他 peaks-cli 用户直接交流？扫码加入 **Peaks-Cli** 微信群：

<div align="center">
  <img src="./docs/images/wechat-group-qr.png" alt="Peaks-Cli 微信群二维码" width="240" />
</div>

> 二维码图片过期后，欢迎在 GitHub Issues / Discussions 提反馈。

---

<div align="center">

**觉得有用？**

⭐ [Star peaks-cli on GitHub](https://github.com/SquabbyZ/peaks-cli) · 🔍 [Browse on skills.sh](https://skills.sh/SquabbyZ/peaks-cli)

</div>
