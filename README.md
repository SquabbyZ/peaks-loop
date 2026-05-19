# Peaks

Peaks 是一个面向 Claude Code 的全局 CLI 工具和短技能族，用来把项目治理、工作流规划、受控执行、QA 验证、变更追踪组织成可复用的工程流程。

如果你是使用者，把 Peaks 当成一个安装后直接运行的命令行工具即可：先配置工作区，再选择工作流，再按需要调用 skills 和受控 worker。

## 安装

```bash
npm install -g @peaks/cli
```

安装后可直接使用：

```bash
peaks --help
```

如果你已经从源码或本地包安装，也可以直接运行 `peaks`。

要确认安装成功，可以执行：

```bash
peaks -v
peaks --version
peaks --help
peaks -h
```

`-v` / `--version` 会显示版本号，`--help` / `-h` 会列出可用的 Peaks 命令。

全局安装时，Peaks 会把包内置的 skills 以 symlink 形式注册到全局 Claude skills 目录。安装完成后，你可以在 Claude Code 里直接用这些 skill 名称加自然语言描述来发起工作。

## 项目全貌

Peaks 由五层组成：

- CLI 入口：`bin/peaks.js` 和 `src/cli/**`，提供所有 `peaks ...` 命令。
- 服务层：`src/services/**`，实现配置、artifact、memory、standards、workflow、RD、Tech、SC、capability、MiniMax worker 等能力。
- Skills：`skills/peaks-*`，提供 PRD、UI、RD、QA、Solo、SC、TXT 七个 Claude Code 工作流角色。
- Schemas：`schemas/*.json`，定义 artifact、recommendation、context capsule、approval、capability、change impact 等稳定数据契约。
- 验证：`tests/unit/**` 和 `tests/e2e/**` 覆盖 CLI 分支、服务边界、路径安全、安装脚本、watch 脚本和 E2E 工作流。

核心设计是“skills 定义流程，CLI 执行副作用”。Skills 不直接改配置、不安装 MCP、不写远端仓库；这些动作必须通过 CLI 的 dry-run、JSON 输出、显式 apply/confirm 和可验证结果完成。

## 快速开始

### 1. 先确认环境

```bash
peaks doctor --json
peaks skill doctor --json
```

这两条命令会帮助你确认 Peaks、skills、配置和 artifact 相关状态是否可用。

### 2. 查看可用 skills

```bash
peaks skill list --json
```

Peaks 的 skills 主要有这些：

- `peaks-solo`：端到端编排入口
- `peaks-prd`：产品目标、非目标、验收标准
- `peaks-ui`：UI/UX、交互和视觉约束
- `peaks-rd`：研发分析、重构规划、执行契约
- `peaks-qa`：测试、覆盖率、回归和验收
- `peaks-sc`：变更追踪、commit boundary、artifact 留存
- `peaks-txt`：上下文胶囊、决策记录、知识压缩

## 用 config.json 配置工作区

Peaks 读取两个位置的配置：

- 全局：`~/.peaks/config.json`
- 项目：`<project>/.peaks/config.json`

项目配置优先；没有项目配置时，Peaks 回退到全局配置。工作区、当前工作区和运行时偏好都直接写进 `config.json`，后续命令会自动读取，不需要每次重复传 workspace 参数。

项目级配置示例：

```json
{
  "currentWorkspace": "ice-cola",
  "workspaces": [
    {
      "workspaceId": "ice-cola",
      "name": "Ice Cola",
      "rootPath": "C:/Users/smallMark/Desktop/peaksclaw/ice-cola",
      "installedCapabilityIds": [],
      "artifactRepo": {
        "provider": "github",
        "owner": "YOUR_ARTIFACT_REPO_OWNER",
        "name": "YOUR_ARTIFACT_REPO_NAME"
      }
    }
  ]
}
```

如果你还需要用户级别的 provider 配置，把它放在全局 `~/.peaks/config.json`：

```json
{
  "providers": {
    "minimax": {
      "baseUrl": "https://api.minimaxi.com/anthropic",
      "apiKey": "YOUR_MINIMAX_API_KEY"
    }
  }
}
```

说明：

- `workspace.rootPath` 指向真实目标项目。
- `currentWorkspace` 决定当前启用哪一个 workspace。
- artifact repo 是中间产物仓库，不是目标代码仓库。
- 项目 `.peaks/config.json` 只放非敏感的工作区元数据；敏感凭据放全局配置。
- 中间产物不要写进目标仓库。

## CLI 命令地图

所有重要命令都支持 `--json`。会产生副作用的命令通常提供 `--dry-run` 预览和 `--apply` 或 `--confirm` 显式执行。

### 健康检查、skills、profiles

```bash
peaks doctor --json
peaks skill list --json
peaks skill doctor --json
peaks profile list --json
```

用途：检查 Peaks 运行环境、列出内置 skills、验证 skills 注册状态，并查看可用运行 profile。

### 查看和验证配置

如果你想确认 Peaks 读取到了什么，可以继续用 `doctor` 和 `config` 相关命令做检查，但配置本身直接写 `config.json` 就够了。

```bash
peaks config get --json
peaks config get --key currentWorkspace --json
peaks config set --key language --value '"zh"' --layer user --json
peaks config workspace list --json
peaks config workspace add --id <id> --name <name> --path <project> --json
peaks config workspace switch --id <id> --json
peaks config workspace remove --id <id> --json
```

### MiniMax provider 与外部 worker

```bash
export MINIMAX_API_KEY=<key>
peaks config provider minimax set --base-url <https-url> --json
peaks config provider minimax status --json
peaks config provider minimax get --json
peaks config provider minimax test --model MiniMax-M2.7 --json

peaks worker minimax \
  --change-id <id> \
  --goal "<目标>" \
  --coding-task "<编码任务>" \
  --unit-test-task "<测试任务>" \
  --confirm \
  --json
```

MiniMax provider 配置只把敏感凭据写到用户层配置。Worker 是受控外部执行入口：输入必须可外发，输出默认视为不可信，需要再经过顶级模型 review。

### Artifact workspace 与项目记忆

```bash
peaks artifacts status --json
peaks artifacts init --provider github --name <repo> --path .peaks-artifacts --dry-run --json
peaks artifacts workspace --json
peaks artifacts sync --dry-run --json
peaks artifacts setup --step detect --json

peaks memory extract --project <project> --artifact <artifact-path> --dry-run --json
peaks memory extract --project <project> --artifact <artifact-path> --apply --json
peaks memory sync --project <project> --workspace <artifact-workspace> --dry-run --json
peaks memory sync --project <project> --workspace <artifact-workspace> --apply --json
```

Artifact repo 用来保存 PRD、RD、QA、TXT、SC 等中间产物，不是目标代码仓库。Memory 命令只提取稳定、可复用的项目记忆，并带路径逃逸和密钥检测。

### 用短命令产出计划

Peaks 推荐使用顶层短命令：一个动作对应一个命令，不需要记多层命令堆叠。

- `route` / `workflow route`：判断这次改动该走 solo 还是 team，输出路线图。
- `autonomous` / `workflow autonomous`：生成全自动治理链路预览。
- `tech-plan` / `tech plan`：把技术目标拆成 scan、document、review、reducer 等可审阅波次。
- `tech-status` / `tech status`：查看技术 artifact / approval 状态。
- `swarm-plan` / `swarm plan`：把 RD 范围拆成并行 worker 图、冲突组和质量门。
- `refactor`：输出 refactor gates、artifact 要求和覆盖率门槛，不直接改代码。
- `recommend`：根据 workflow 推荐外部 skills、MCP 或 Peaks 内置 fallback。
- `minimax-worker` / `worker minimax`：把明确小任务交给 MiniMax worker，并返回给顶级模型审查的交接结果。

先写清楚目标，再让 Peaks 产出结构化结果，最后审查结果是否足够小、足够清楚、足够可验证。

```bash
peaks route --mode solo --change-id <id> --goal "<目标>" --dry-run --json
peaks autonomous --mode solo --change-id <id> --goal "<目标>" --dry-run --json
peaks tech-plan --change-id <id> --goal "<目标>" --swarm --dry-run --json
peaks swarm-plan --change-id <id> --goal "<目标>" --dry-run --json
peaks refactor --solo --dry-run --json
peaks recommend --workflow code-refactor --language zh --json
peaks minimax-worker --change-id <id> --goal "<目标>" --coding-task "<编码任务>" --unit-test-task "<测试任务>" --confirm --json
```


### 项目规范 preflight

Peaks 可以为目标项目生成项目本地规范，并让 `peaks-rd`、`peaks-qa`、`peaks-solo` 在进入代码仓工作流前先检查这些规范。

```bash
peaks standards init --project <project> --dry-run --json
peaks standards init --project <project> --apply --json
peaks standards update --project <project> --dry-run --json
peaks standards update --project <project> --apply --json
```

说明：

- `standards init` 用于首次创建 `CLAUDE.md` 和 `.claude/rules/**`。
- `standards update` 用于已有 `CLAUDE.md` 的项目：追加 Peaks 管理的规范索引，并只补齐缺失的 rules 文件。
- 如果已有 managed block 与当前模板不一致，命令会要求人工 review，并返回非零退出码。
- 对 `CLAUDE.md` 和 rules 的文件写入会检查项目边界，避免 symlink/path traversal 逃逸。

### 推荐能力与能力可用性

```bash
peaks capability status --json
peaks capability map --source all --json
peaks capabilities --source mcp-server --json

peaks recommend --workflow code-refactor --language zh --json
peaks recommend --workflow product-refactor --language zh --json
peaks recommend --workflow frontend-design --language zh --json
```

用途：帮助你决定是否应该调用外部 skills、MCP、hooks、agent browser、OpenSpec 等能力。Peaks 的立场是优先复用优秀外部能力；如果能力不可用，再回退到内置流程。

### Source control 与变更追踪

```bash
peaks sc status --json
peaks sc help

peaks sc impact \
  --change-id ice-cola-marketplace \
  --module admin-marketplace \
  --module server-marketplace \
  --file packages/admin/src/services/marketplaceApi.ts \
  --file packages/server/src/marketplace/marketplace.service.ts \
  --json

peaks sc retention \
  --slice-id marketplace-api-contract \
  --prd artifacts/prd.md \
  --rd artifacts/rd.md \
  --qa artifacts/qa.md \
  --coverage artifacts/coverage.md \
  --review artifacts/review.md \
  --code packages/admin/src/services/marketplaceApi.ts \
  --json

peaks sc boundary \
  --slice-id marketplace-api-contract \
  --artifact artifacts/prd.md \
  --artifact artifacts/qa.md \
  --code packages/admin/src/services/marketplaceApi.ts \
  --json

peaks sc validate --slice-id marketplace-api-contract --json
```

SC 命令负责把一次变更的影响范围、artifact 留存、代码边界和回滚点变成可审查记录。

### 代理与网络辅助

```bash
peaks proxy test --proxy http://127.0.0.1:7890 --target https://www.google.com --dry-run --json
```

`proxy test` 只规划连通性测试，不直接执行网络探测。

## 使用 skills 的方式

如果你在 Claude Code 里工作，可以把 Peaks skills 当成角色化工作流：

- 先用 `peaks skill list --json` 看有哪些技能可用
- 最简单的用法就是在 Claude Code 里输入：`skill + 自然语言描述`
- 例如：

```text
peaks-solo 使用全自动模式治理 C:/Users/smallMark/Desktop/peaksclaw/ice-cola
peaks-prd 为会员邀请功能整理产品目标、非目标和验收标准
peaks-rd 分析这次重构的最小实现切片和风险
peaks-qa 为这次改动设计测试和回归验证清单
```

按任务选择对应技能：
  - `peaks-solo`：决定整体工作流模式
  - `peaks-prd`：整理产品目标、非目标、验收标准
  - `peaks-ui`：补充 UI/UX、交互和视觉约束
  - `peaks-rd`：做工程分析、重构规划、执行契约
  - `peaks-qa`：定义测试、覆盖率和回归
  - `peaks-sc`：记录变更追踪、commit 边界、artifact 留存
  - `peaks-txt`：压缩上下文、保留关键决策

真实用户通常只需要知道怎么调用，不需要关心内部怎么实现。

一个实用顺序是：

1. 先熟悉项目
2. 再产出 PRD / RD / QA / TXT
3. 再生成 route / tech-plan / swarm-plan 计划
4. 最后才进入受控执行

## 推荐工作流

### 既有项目重构

1. `peaks doctor --json`
2. `peaks config workspace list --json`
3. `peaks artifacts workspace --json`
4. 用 `peaks-txt` 生成上下文胶囊
5. 用 `peaks-prd` 明确目标、非目标和验收标准
6. 用 `peaks-rd` 熟悉项目结构、测试、脚本、关键模块和风险
7. 用 `peaks-qa` 定义回归矩阵和覆盖率门禁
8. UI 相关任务再引入 `peaks-ui`
9. `peaks route --mode solo --solo-mode full-auto ... --dry-run --json`
10. `peaks tech-plan ... --swarm --dry-run --json`
11. `peaks swarm-plan ... --dry-run --json`
12. 必要时使用 `peaks minimax-worker ... --confirm --json`
13. 最后做 code review / security review / TypeScript review
14. 用 `peaks-sc` 记录 impact、retention、boundary

### 新增功能

1. 先熟悉项目：README、package scripts、路由、服务层、测试、数据模型、当前 git 状态
2. `peaks-prd` 输出功能目标、用户价值、验收标准和非目标
3. `peaks-rd` 找到最小实现切片和受影响模块
4. `peaks-qa` 定义新增测试和回归测试
5. 再进入 `route` 或 `autonomous` 计划
6. 受控执行前，确认 artifact workspace 在目标 repo 外部
7. 实现、单测、build、review、安全检查全部完成后再进入下一步

### 修 bug

1. 先复现或定位 bug
2. 熟悉相关模块、调用链、测试和已有约定
3. `peaks-rd` 生成 root cause、修复策略和回归风险
4. `peaks-qa` 定义失败用例和验收条件
5. 先补失败测试，再做最小修复
6. 跑聚焦测试和相关 build
7. 再做 code / security / TypeScript review
8. 用 `peaks-sc` 记录影响范围和边界

## 开发、测试和发布包内容

本仓库是 TypeScript + Commander + Vitest 项目。

```bash
pnpm install
pnpm run dev -- --help
pnpm run dev:watch
pnpm run typecheck
pnpm test
pnpm run test:coverage
pnpm run build
```

说明：

- `scripts/install-skills.mjs` 会把 `skills/peaks-*` 以 symlink 注册到 Claude skills 目录。
- `scripts/watch.mjs` 监听 `src/`、`schemas/`、`skills/`，构建后重新安装 skills。
- npm 包包含 `bin/peaks.js`、编译后的 `dist/src/**`、`scripts/**`、`skills/**` 和 `schemas/*.json`。
- 单元测试覆盖服务逻辑、CLI 分支、路径安全、配置脱敏、MiniMax provider、artifact workspace、standards、memory、SC 和 workflow planning。
- E2E 脚本覆盖 artifact、config、SC 的核心命令链路。

## JSON 输出

大多数 CLI 命令都支持 `--json`。建议自动化场景总是使用它，因为输出是稳定的 envelope：

```json
{
  "ok": true,
  "command": "workflow.route",
  "data": {},
  "warnings": [],
  "nextActions": []
}
```

## 安全边界

- 不要把 secrets 写进 project config 或 artifacts。
- provider URL 必须使用可信 allowlist 和 HTTPS。
- 既有项目不要跳过熟悉阶段。
- 重构需要测试、覆盖率和验收面。
- 中间 artifacts 应存放在目标仓库外部。
- 修改远端、创建仓库、推送代码、改共享配置都需要显式确认。
- MiniMax worker 等外部 provider 调用必须确认输入可外发。

## 许可

本仓库使用闭源非商用许可，详见 [LICENSE](LICENSE)。未经版权持有人事先书面许可，禁止商业使用、禁止商业目的的修改，禁止商业目的的分发、再授权、销售、托管、打包或捆绑。

## 设计立场

Peaks 与 cc-switch 等工具共存，不修改 cc-switch 状态。Peaks 只通过 Peaks 管理的状态、dry-run 计划、备份和可回滚 sync 来管理 Claude global skills、MCP、hooks、agents 和 profiles。
