# Peaks

Peaks 是一个面向 Claude Code 的 CLI 工具和技能族，把项目治理、工作流规划、受控执行、QA 验证、变更追踪组织成可复用的工程流程。

## 安装

```bash
npm install -g peaks-cli
```

安装后，Peaks 会把内置 skills 注册到 Claude Code，你可以在对话里直接调用。

验证安装：

```bash
peaks --help
peaks skill list --json
```

## 使用 Skills

在 Claude Code 对话里，直接用 `skill名称 + 自然语言描述` 发起工作流：

```text
peaks-solo 使用全自动模式治理 /path/to/your-project
peaks-prd 为会员邀请功能整理产品目标、非目标和验收标准
peaks-rd 分析这次重构的最小实现切片和风险
peaks-qa 为这次改动设计测试和回归验证清单
peaks-ui 设计登录页面的交互和视觉方案
peaks-sc 记录这次变更的影响范围、artifact 留存和 commit 边界
peaks-txt 为当前模块生成上下文胶囊，保留关键决策
```

按任务选择对应技能：

| 技能 | 用途 | 典型场景 |
|------|------|----------|
| `peaks-solo` | 端到端编排入口 | 全流程开发、从需求到上线 |
| `peaks-prd` | 产品目标、非目标、验收标准 | 需求整理、重构目标定义 |
| `peaks-ui` | UI/UX、交互和视觉约束 | 页面设计、交互方案、原型 |
| `peaks-rd` | 研发分析、重构规划、执行契约 | 工程分析、最小实现切片、风险评估 |
| `peaks-qa` | 测试、覆盖率、回归验证 | 测试设计、回归矩阵、验收检查 |
| `peaks-sc` | 变更追踪、commit 边界、artifact 留存 | 影响范围记录、回滚证据 |
| `peaks-txt` | 上下文胶囊、决策记录、知识压缩 | 模块理解、关键决策留存 |

### 常用工作流

**从零到一的新功能：**

1. `peaks-prd` 输出功能目标、用户价值、验收标准和非目标
2. `peaks-rd` 找到最小实现切片和受影响模块
3. `peaks-ui` 补充交互和视觉方案（UI 相关任务）
4. `peaks-qa` 定义新增测试和回归测试
5. `peaks-solo` 端到端编排执行

**既有项目重构：**

1. `peaks-txt` 生成上下文胶囊，理解当前模块
2. `peaks-prd` 明确重构目标、非目标和验收标准
3. `peaks-rd` 分析项目结构、测试、脚本、关键模块和风险
4. `peaks-qa` 定义回归矩阵和覆盖率门禁
5. `peaks-solo` 端到端编排执行
6. `peaks-sc` 记录 impact、retention、boundary

**修 bug：**

1. 先复现或定位 bug
2. `peaks-rd` 生成 root cause、修复策略和回归风险
3. `peaks-qa` 定义失败用例和验收条件
4. 先补失败测试，再做最小修复
5. `peaks-sc` 记录影响范围和边界

### 环境检查

使用 skill 之前，建议先确认环境：

```bash
peaks doctor --json
peaks skill doctor --json
```

## 自定义 SOP（用户自创流程门禁）

除了内置的 `peaks-*` 技能家族，你还能用 `peaks sop` 命令族定义**自己的 SOP**：一组有序阶段（phases）加上绑定在阶段上的门禁（gates）。门禁不通过，就推不进对应阶段——把"流程不丢环节"落到你自己的工作流上。

**这是一个通用的流程门禁工具，不限于研发。** 凡是"有先后阶段、进入下一步前必须满足某些可检查条件"的流程都适用——内容发布、合规/审批清单、数据校验管线、入职流程、运维 runbook、个人可重复流程……研发发布只是其中一个例子，往往非研发场景更有价值。

> 更顺手的用法：直接用 **`peaks-sop` 技能**——在对话里用自然语言描述你的流程，由 LLM 帮你生成、调试、注册 SOP，无需手写 JSON 或记命令。下面的 CLI 是它底层调用的引擎。

**定义全局、执行按项目**：SOP 定义（`sop.json` + 可注册的 `SKILL.md`）落在全局 `~/.peaks/sops/<sop-id>/`，写一次即可跨项目复用；运行态（当前阶段、历史）按项目落在 `<project>/.peaks/sop-state/<sop-id>/`，同一个 SOP 在不同项目各自独立进度。`init`/`lint`/`register`/`registry` 操作全局定义、**无需 `--project`**；`check`/`advance` 带 `--project`（默认当前目录）指定对哪个项目执行。

```bash
# 1. 创建 SOP 骨架到 ~/.peaks/sops（默认预览不落盘，--apply 才写入）
peaks sop init --id team-release --name "Team Release" --apply --json

# 2. 校验 manifest（门禁 id 唯一、阶段合法、check 字段完整）
peaks sop lint --id team-release --json

# 3. 注册进全局门禁注册表（--dry-run 预览）
peaks sop register --id team-release --json

# 4. 列出注册表里所有自定义门禁（内置 peaks-* 门禁永不出现）
peaks sop registry --json

# 5. 评估单个门禁（在某项目下，返回 pass / fail / blocked）
peaks sop check --id team-release --gate changelog --project . --json

# 6. 推进到某阶段——门禁须全过、且不能跳级，否则被真正阻断
peaks sop advance --id team-release --to ship --project . --json
```

`sop.json` 示例：

```json
{
  "id": "team-release",
  "name": "Team Release",
  "phases": ["draft", "review", "ship"],
  "gates": [
    { "id": "changelog", "phase": "ship", "check": { "type": "file-exists", "path": "CHANGELOG.md" } },
    { "id": "no-fixme", "phase": "review", "check": { "type": "grep", "file": "src/index.ts", "pattern": "FIXME", "absent": true } },
    { "id": "tests", "phase": "ship", "check": { "type": "command", "run": ["npm", "test"] } }
  ]
}
```

门禁 check 支持三类：

| 类型 | 字段 | 含义 |
|------|------|------|
| `file-exists` | `path` | 文件存在 → pass |
| `grep` | `file` + `pattern`（+ `absent`） | 文件内匹配到正则 → pass；加 `absent: true` 则反转——匹配不到才 pass（表达「不准有 X」，纯文本、免 `--allow-commands`、跨平台） |
| `command` | `run`（参数数组）+ `expectExitZero` | 运行命令并按退出码判定 |

「不准有 TODO / 占位符 / 遗留项」这类最常见的诉求，优先用 `grep` + `absent: true`，不必动用 `command` 门禁。

安全约束：
- `command` 类门禁运行用户定义的命令，**默认拒绝**，必须显式加 `--allow-commands` 才会评估；命令以参数数组执行（无 shell、无注入面）、有超时上限、工作目录锁定项目根。
- `file-exists` / `grep` 的路径锁在项目根内，越界路径返回 `blocked`。
- 有副作用的命令（init/register/advance）都支持 `--dry-run` 预览且不落盘。
- `advance` 还会校验**阶段顺序**：可停留当前阶段、可回退，但不能越过下一个阶段跳级，跳级返回 `SOP_PHASE_SKIP`。
- 被门禁阻断或被判跳级时，可用 `--allow-incomplete --reason "<原因>"` 显式绕过（同时绕过门禁与顺序校验）；assisted/strict 模式下还需 `--confirm`，且每个项目内每个 SOP 的绕过次数有上限。

## 许可

MIT License，详见 [LICENSE](LICENSE)。
