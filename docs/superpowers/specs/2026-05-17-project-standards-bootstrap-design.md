# Peaks 项目代码规范初始化设计

## 目标

Peaks 首次用于一个项目时，不应该只扫描仓库上下文，还要在目标项目仓库内准备项目级代码规范，让后续 Peaks 工作流、skills、代理和开发者遵循同一套工程规则。

规范初始化必须把 `everything-claude-code` 作为已知来源，覆盖语言编码规范、代码评审指导和安全检查指导，同时保证 Peaks 对离线仓库和私有仓库仍然安全可用。

## 范围

实现一个写入目标仓库内的规范初始化流程：

- 默认只预览将要写入的规范文件。
- 只有用户明确 apply 时才写入。
- 文件写入目标项目仓库，而不是 artifact workspace。
- 永不覆盖已有项目规范。
- 已有项目规范优先于 Peaks 生成的通用模板。
- 将 `everything-claude-code` 记录为语言规范、code review 和 security guidance 的来源与 fallback 参考。
- 同时支持 skill 高频入口和 CLI 低层执行入口。

本次不做：

- 自动 clone 或执行 `everything-claude-code`。
- 从互联网安装外部 agents。
- 修改远程仓库。
- 重写已有 `CLAUDE.md` 或 `.claude/rules` 文件。

## Skill + 工作流自动化入口

当前 Peaks 代码仓的能力定位是 skill 为主、CLI 为辅。虽然 CLI 提供底层能力，但绝大多数真实使用场景是 skill + 自然语言；真正会进入代码仓执行的入口主要是 `peaks-rd`、`peaks-qa` 和 `peaks-solo`。因此本功能不应依赖关键词触发，而应作为这些代码仓工作流的自动前置检查。

- `peaks-rd` 在准备研发/实现计划前，自动检查目标仓库是否已有 `.claude/rules` 和 `CLAUDE.md`。
- `peaks-qa` 在准备质量验证前，自动检查是否已有 code review 和 security review 规范。
- `peaks-solo` 在编排端到端代码工作流前，自动汇总 RD/QA 所需规范状态。
- 如果规范缺失，skill 自动生成 standards init dry-run plan，并把它作为工作流 next action 或 preflight result 展示。
- 如果当前操作已经获得写入授权，skill 可调用 CLI/service apply；否则只展示计划并请求用户确认。
- skill 输出必须明确说明规范会写入目标项目内，并列出 planned/written files。
- skill 不直接手写文件逻辑，避免 skill 与 CLI 产生两套行为。

建议自动化流程：

```text
peaks-rd / peaks-qa / peaks-solo 进入代码仓工作流
  -> 自动检测项目语言、已有规范和缺失规范
  -> 自动生成 standards init dry-run plan
  -> 有写入授权则调用 peaks standards init --project <path> --apply
  -> 无写入授权则把 standards init 作为 preflight next action
  -> skill 用中文总结规范状态、缺失项和写入结果
```

自然语言仍然是用户入口，但规范初始化由代码仓工作流自动挂接，而不是靠匹配“扫描项目”“加规范”等关键词。

## CLI 形态

CLI 是稳定、可测试、可被 skill 调用的执行入口。在现有核心命令组下新增命令：

```text
peaks standards init --project <path> [--language <language>] [--apply] [--json]
```

行为：

- 不传 `--apply` 时返回 dry-run 计划。
- 传 `--apply` 时创建缺失的规范文件。
- `--language` 选择语言规范包；如果省略，Peaks 根据常见项目标记检测主语言。
- `--json` 返回与其他 Peaks 命令一致的稳定 result envelope，方便 skill 解析和展示。

## 生成文件

初始化流程只写入缺失文件：

```text
CLAUDE.md
.claude/rules/common/coding-style.md
.claude/rules/common/code-review.md
.claude/rules/common/security.md
.claude/rules/<language>/coding-style.md
```

每个生成的 rules 文件都包含来源元数据，标识 Peaks 和 `everything-claude-code` 是参考来源。根目录 `CLAUDE.md` 会指向项目内规则，并声明已有仓库约定优先于通用模板。

## everything-claude-code 集成

Peaks 已经把 `everything-claude-code` 编入 capability source。本功能继续扩展该集成，新增显式的规范相关 capability items：

- 语言编码规范
- 代码评审指导
- 安全评审指导

生成到项目里的文件会引用来源 URL，并说明 Peaks 使用的是 curated baseline，不会盲目执行外部内容。这样既满足集成价值，也避免供应链风险。

## 架构

新增一个专注的 standards service，与 memory 和 artifact service 分离：

```text
src/services/standards/project-standards-service.ts
```

公开服务 API：

- `createProjectStandardsInitPlan(options)`
- `executeProjectStandardsInit(options)`
- `summarizeProjectStandardsInitResult(result)`

服务负责：

- project root 归一化
- 主语言检测
- 规范文件渲染
- no-overwrite 计划
- 安全写入校验
- 来源元数据

CLI 负责：

- 命令解析
- result envelope
- exit code

Skill 负责：

- 在 `peaks-rd`、`peaks-qa`、`peaks-solo` 进入代码仓工作流时自动检查规范缺口
- 展示 dry-run 计划或 preflight next action
- 在已有写入授权时调用 CLI/service 执行 apply
- 在缺少写入授权时请求用户确认，而不是静默写入
- 把结果转成面向用户的中文说明

## 安全规则

规范初始化沿用 project memory extraction 的安全姿态：

- 规划前解析真实 project root。
- 拒绝 `.claude` 和 `.claude/rules` 的 symlink 或 junction 越界。
- 只有 apply 时才创建目录。
- 使用 exclusive create 创建文件，保证已有规范不会被覆盖。
- 生成内容保持静态且不包含 secret。
- 不向外部服务发送项目代码或密钥。
- skill 不绕过 service/CLI 的安全校验。

## 首次使用流程

本次新增显式命令，并让 `peaks-rd`、`peaks-qa`、`peaks-solo` 在进入代码仓工作流时自动挂接规范 preflight：

```text
peaks standards init --project <project-root> --apply
```

用户不需要记住这个 CLI。正常路径是用户通过自然语言使用 Peaks skill，skill 自动完成规范检查、计划和授权后的写入。

Doctor 后续可以把缺失项目规范报告为建议项，而不是硬阻塞项。

## 测试

新增单元测试覆盖：

- dry-run 计划不写文件
- apply 只写缺失文件
- 保留已有文件
- 语言检测和显式语言覆盖
- symlink/path escape 拒绝
- CLI JSON envelope 和失败处理
- `peaks-rd`、`peaks-qa`、`peaks-solo` 可稳定消费 standards preflight summary
- skill-facing summary 可稳定表达 planned/written files
- `everything-claude-code` 规范指导相关 capability catalog entries

纳入覆盖率的模块必须继续保持 100%。
