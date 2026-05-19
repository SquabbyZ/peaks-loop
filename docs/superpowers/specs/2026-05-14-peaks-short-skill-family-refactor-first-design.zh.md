# Peaks 短名技能家族架构设计：Refactor-first MVP

日期：2026-05-14
状态：新设计草案
来源：基于 `2026-05-14-peaks-sdd-skill-family-design.zh.md` 的重新脑暴

## 1. 设计结论

Peaks 新一代协作体系不再把 `peaks-sdd` 扩展成一个越来越大的单体技能，而是在 `skills/` 目录下新建一组短名子技能。每个子技能都可以独立使用、独立升级、独立 dogfood，也可以被全自动编排入口调用。

本轮确认的方向是：

1. 新建技能，不原地修改现有 `skills/peaks-sdd/`。
2. 使用短名命名，降低用户记忆成本。
3. 每个子技能都拥有自己的 harness、OpenSpec、agents、references、schemas 和 command 适配层。
4. `peaks-solo` 作为新的全自动单人编排入口，不是对旧 `peaks-sdd` 的直接改名。
5. 第一阶段以真实项目“重构”作为 MVP 场景，而不是先覆盖 0→1 全流程。
6. 现有 Claude commands 可以被迁移、改名或包装到对应子技能中，但新体系的主入口以 `peaks-*` 短名为准。

## 2. 新命名

| 新技能 | 历史/概念名称 | 定位 |
| --- | --- | --- |
| `peaks-solo` | `peaks-sdd` 的新一代全自动入口 | 单人全自动编排器，负责场景识别、模式推荐、跨技能调度和最终报告 |
| `peaks-prd` | `peaks-product` | 产品意图、PRD、验收标准、重构目标、需求变更 |
| `peaks-ui` | `peaks-design` | UI/UX、交互、视觉方向、高保真 HTML 原型、体验评估 |
| `peaks-rd` | `peaks-rd` | 技术分析、架构选项、任务图、实现、代码审查闭环 |
| `peaks-qa` | `peaks-qa` | 测试矩阵、回归保护、自动化验证、验收报告 |
| `peaks-sc` | `peaks-sync` | source control / sync / change control：产物仓与代码仓同步、审批、冲突、变更影响 |
| `peaks-txt` | `peaks-context` | 上下文胶囊、压缩、角色切片、过期检查、长期知识归档 |

命名原则：

- 对用户暴露短名。
- 在文档中可以注明历史概念名，但不作为主入口。
- 新技能目录放在 `skills/peaks-*` 下。
- 保留 `skills/peaks-sdd/` 作为历史实现和迁移参考。

目标目录形态：

```text
skills/
├── peaks-sdd/       # 保留，不原地重构
├── peaks-solo/      # 新全自动编排入口
├── peaks-prd/       # 产品与需求技能
├── peaks-ui/        # UI/UX 与体验技能
├── peaks-rd/        # 研发与重构技能
├── peaks-qa/        # 测试与验收技能
├── peaks-sc/        # 同步、审批、变更控制技能
└── peaks-txt/       # 上下文胶囊与知识压缩技能
```

## 3. 架构原则

### 3.1 每个子技能都是一等产品

每个子技能必须能独立完成本角色工作，不依赖 `peaks-solo` 才能运行。

每个子技能至少拥有：

- `SKILL.md`：技能入口、触发语、工具边界、执行原则；
- `references/`：角色方法论、产物模板、命令迁移说明；
- `templates/`：agent 模板、harness 模板、OpenSpec 模板；
- `schemas/`：本技能拥有的 artifact / evidence / trace / context schema；
- `scripts/`：可选的校验、格式化、迁移、质量门禁脚本；
- `examples/` 或 `fixtures/`：dogfood 和回归样例。

### 3.2 `peaks-solo` 是 orchestration facade

`peaks-solo` 负责：

- 识别场景：重构、功能开发、bug 修复、QA 强化、发布验证、事故响应；
- 推荐执行模式：Fast、Standard、Strict、Parallel Candidate、Incident；
- 调用子技能；
- 串联 artifact、trace、context、evidence；
- 汇总最终报告；
- 在用户确认点暂停。

`peaks-solo` 不负责：

- 直接替代 `peaks-prd` 写产品产物；
- 直接替代 `peaks-ui` 输出体验设计；
- 直接替代 `peaks-rd` 做技术方案和实现；
- 直接替代 `peaks-qa` 做测试矩阵和验收；
- 直接替代 `peaks-sc` 做同步与审批；
- 直接替代 `peaks-txt` 做上下文压缩。

### 3.3 harness 下沉到每个子技能

旧 `peaks-sdd` 的 harness 思路仍然有价值，但不应该只存在于编排入口中。

每个子技能都应该有自己的 harness：

- `peaks-prd` harness：需求澄清、PRD 完整度、验收标准、用户确认；
- `peaks-ui` harness：体验目标、交互流、视觉方向、原型、设计确认；
- `peaks-rd` harness：现状扫描、方案比较、风险评估、任务图、实现门禁、审查循环；
- `peaks-qa` harness：测试矩阵、回归保护、自动化执行、验收证据；
- `peaks-sc` harness：差异、审批、冲突、同步指针、变更影响；
- `peaks-txt` harness：上下文生成、切片、压缩、一致性、过期检查；
- `peaks-solo` harness：场景识别、跨技能调度、总门禁、最终报告。

### 3.4 OpenSpec 下沉到每个子技能

OpenSpec 不再只是 `peaks-sdd` 做功能开发时使用的规格工具。每个子技能都应该用 OpenSpec 管理自己的能力变化。

示例：

| 技能 | OpenSpec 管理内容 |
| --- | --- |
| `peaks-prd` | PRD 模板、验收标准协议、重构目标产物、需求变更流程 |
| `peaks-ui` | 原型产物、体验评估规则、设计确认门禁、UI 回归协议 |
| `peaks-rd` | 重构模式、任务图协议、文件所有权、实现门禁、代码审查循环 |
| `peaks-qa` | 测试矩阵 schema、回归轮次、覆盖率证据、验收报告 |
| `peaks-sc` | artifact repo 同步、审批记录、冲突处理、change-impact 协议 |
| `peaks-txt` | context capsule schema、角色切片、过期策略、知识沉淀 |
| `peaks-solo` | 场景路由、执行模式、跨技能 handoff、最终报告结构 |

### 3.5 全 AI 开发模式

Peaks 短名技能家族本身也应该按全 AI 工程模式开发，而不是按传统人工开发排期设计。

这意味着：

- 不需要因为人工开发周期而过度压缩架构边界；
- 可以同时设计 7 个子技能的骨架、协议、harness 和 OpenSpec；
- 可以使用多 agent 并行生成、互审、修复和 dogfood；
- 可以把 eval、质量门禁、真实项目试跑作为主要收敛机制；
- 设计重点从“人力排期最小化”转为“AI 产物可验证、可回滚、可迭代”。

用户计划使用 MiniMax 2.7 作为主要实现模型之一。因此协议和产物不能绑定 Claude 专有格式，必须保持模型厂商中立。Claude 现有 command、agents、skills 可以作为迁移素材，但新体系的产物契约应该能被 MiniMax 2.7 或其他模型消费。

Refactor-first 不是因为不敢做完整架构，而是因为它是最适合验证技能家族边界的第一个真实闭环。只要重构闭环跑通，就可以并行扩展到 0→1、bugfix、QA 强化、发布验证和事故响应。

## 4. 子技能边界

### 4.1 `peaks-prd`

`peaks-prd` 负责把用户意图变成可执行、可验证、可传递的产品产物。

独立使用时，它可以完成：

- 产品脑暴；
- PRD；
- 重构目标说明；
- 非目标定义；
- 验收标准；
- 需求变更提案；
- 产品上下文胶囊种子。

在 Refactor Mode 中，它不需要输出完整新产品 PRD，而是输出重构专用 PRD：

- 为什么要重构；
- 哪些行为必须保持不变；
- 哪些问题必须被改善；
- 哪些范围明确不做；
- 如何验收重构没有破坏业务。

不属于 `peaks-prd` 的职责：

- 技术方案；
- 代码实现；
- 测试执行；
- Git 同步；
- 长期上下文压缩。

可迁移 command：

| 原 command | 迁移方式 |
| --- | --- |
| `prp-prd` | 改造成 `peaks-prd` 的 PRD/目标产物入口 |
| `plan` | 提取需求规划部分，作为轻量规划能力 |
| `prp-plan` | 作为需求到实施计划的上游输入，不直接执行开发 |
| `product` | 迁移为 `peaks-prd` 的角色短入口 |

### 4.2 `peaks-ui`

`peaks-ui` 负责体验、交互、视觉和原型产物。

独立使用时，它可以完成：

- UX flow；
- 信息架构；
- 交互状态；
- 视觉方向；
- 高保真 HTML 原型；
- 组件体验规范；
- 可访问性和可用性评估；
- UI 回归种子。

在 Refactor Mode 中，它只在重构涉及 UI、交互、样式、设计系统、前端页面结构时介入。纯后端、纯架构、纯测试重构不强制调用 `peaks-ui`。

不属于 `peaks-ui` 的职责：

- 产品目标最终决策；
- 后端架构；
- 代码级重构执行；
- 完整 QA 验收。

可迁移 command：

| 原 command | 迁移方式 |
| --- | --- |
| `design` | 改造成 `peaks-ui` 主入口 |
| `client` | 提取前端体验/组件部分，作为 UI adapter |
| `admin` | 提取 B 端后台体验模式，作为 UI adapter |
| `gan-design` | 作为并行候选原型能力，可选接入 |
| `multi-frontend` | 前端复杂场景下作为研发协作 adapter，不直接成为 UI 主入口 |

### 4.3 `peaks-rd`

`peaks-rd` 负责技术理解、方案比较、任务拆分、实现和工程质量闭环。

独立使用时，它可以完成：

- 当前项目扫描；
- 技术债识别；
- 架构方案比较；
- 重构候选方案；
- 任务图；
- 文件边界；
- 实现 waves；
- code review 修复循环；
- build/type/test 失败修复。

在 Refactor Mode 中，`peaks-rd` 是主执行技能。用户也可能直接使用 `peaks-rd` 发起重构，而不是先调用 `peaks-solo`。

因此 `peaks-rd` 必须内置 Direct Refactor Hard Gates：

1. 一旦识别为重构、清理、架构调整、模块拆分或技术债治理，必须先理解当前项目，不得直接改代码；
2. 先扫描项目已有编码规范、测试框架、UT 覆盖率和验证命令；
3. UT 覆盖率必须达到 95% 及以上，覆盖率未知、无法运行、报告缺失、没有 UT 或只有 E2E/手工测试都视为未达标；
4. 覆盖率未达标时，严格拒绝执行重构，只允许生成 UT 补齐计划和补测试；
5. 覆盖率达标只允许进入分析和方案阶段，不等于允许开始改代码；
6. 对“整体重构”“清理架构”“技术债治理”等大范围请求，必须先按最小功能维度切片；
7. 每个功能切片必须先生成最严格的可验证 spec，再进入实现；
8. 即使用户直接调用 `peaks-rd`，也必须调度或等价调用 `peaks-prd` 生成重构目标、非目标和验收 spec，并调度 `peaks-qa` 生成覆盖率、回归矩阵、基线报告和验收报告；
9. 每个切片必须产出中间产物、验证报告和回滚信息；
10. 只有切片内容 100% 通过验收 spec 后，才算完成；
11. 切片完成后必须告知用户需要提交代码和全部中间产物；未提交或未确认提交前，拒绝进入下一切片。

这些门禁优先于用户的加速要求、AI 的“改动很小”判断、`peaks-solo` 的编排计划和语言 adapter 的默认策略。

不属于 `peaks-rd` 的职责：

- 替用户做产品取舍；
- 跳过 QA 保护直接大改；
- 独立批准发布风险；
- 长期产物仓同步治理。

可迁移 command：

| 原 command | 迁移方式 |
| --- | --- |
| `feature-dev` | 拆出研发实现部分，迁移到 `peaks-rd` |
| `prp-implement` | 改造成 `peaks-rd` 实施入口 |
| `build-fix` | 作为 `peaks-rd` build resolver adapter |
| `refactor-clean` | 作为 `peaks-rd` 重构清理 adapter |
| `server` | 后端 adapter |
| `client` | 前端实现 adapter，体验部分归 `peaks-ui` |
| `multi-backend` / `multi-frontend` | 多模块实现 adapter |
| `go-build` / `rust-build` / `cpp-build` / `kotlin-build` / `flutter-build` | 技术栈 adapter，按项目检测动态接入 |

### 4.4 `peaks-qa`

`peaks-qa` 负责测试策略、回归保护、自动化验证和验收证据。

独立使用时，它可以完成：

- 测试矩阵；
- 测试用例；
- 单元测试建议；
- E2E 计划；
- 回归范围分析；
- 覆盖率报告；
- QA 轮次；
- 验收报告；
- 问题复现证据。

在 Refactor Mode 中，`peaks-qa` 必须先于重构实现建立回归保护。

它的重构门禁：

1. 从 `peaks-prd` 读取重构目标和保持不变的行为；
2. 从 `peaks-rd` 读取现状扫描和风险模块；
3. 生成回归矩阵；
4. 识别必须先补的测试；
5. 给出重构前基线验证；
6. 重构后执行同一套验证；
7. 输出验收结论和残留风险。

不属于 `peaks-qa` 的职责：

- 直接决定产品范围；
- 主导技术方案；
- 处理产物仓同步；
- 替代人类 UX 验收。

可迁移 command：

| 原 command | 迁移方式 |
| --- | --- |
| `testing` | 改造成 `peaks-qa` 主入口 |
| `tdd` | 作为测试先行 adapter |
| `e2e` | 作为 E2E adapter |
| `test-coverage` | 作为覆盖率 adapter |
| `quality-gate` | 作为 QA 总门禁 adapter |
| `verify` | 作为验证 adapter |
| `code-review` / `review-pr` | 可作为 QA 质量证据输入，也可与 `peaks-rd` 共享 |

### 4.5 `peaks-sc`

`peaks-sc` 负责 source control、sync 和 change control。

独立使用时，它可以完成：

- 产物仓与代码仓指针管理；
- change-impact；
- artifact diff；
- 审批记录；
- 冲突检测；
- 分支/提交/PR 辅助；
- 发布前同步检查；
- 变更归档。

在 Refactor Mode 中，它记录：

- 哪些模块受影响；
- 哪些产物版本参与了重构；
- 哪些测试证据证明行为没有破坏；
- 用户选择了哪个重构方案；
- 哪些风险被接受；
- 最终代码仓和产物仓指针。

不属于 `peaks-sc` 的职责：

- 写 PRD；
- 做 UI 原型；
- 实现代码；
- 执行测试；
- 生成上下文摘要。

可迁移 command：

| 原 command | 迁移方式 |
| --- | --- |
| `prp-commit` | 迁移为提交辅助 adapter |
| `prp-pr` | 迁移为 PR 辅助 adapter |
| `checkpoint` | 迁移为阶段检查点 adapter |
| `jira` | 作为外部工单同步 adapter |
| `review-pr` | 作为 PR 证据读取 adapter，质量判断仍归 `peaks-qa` / `peaks-rd` |

### 4.6 `peaks-txt`

`peaks-txt` 负责上下文胶囊和长期知识压缩。

独立使用时，它可以完成：

- 会话摘要；
- 项目上下文胶囊；
- 角色切片；
- 决策记录；
- 假设记录；
- 已放弃方案记录；
- 过期检查；
- 长期知识归档；
- 技能沉淀候选识别。

在 Refactor Mode 中，它要把真实项目的现状、重构目标、用户选择、风险、测试证据和后续注意事项压缩成可复用上下文。

不属于 `peaks-txt` 的职责：

- 决定重构方案；
- 直接编辑业务代码；
- 直接写测试；
- 做 Git 同步审批。

可迁移 command：

| 原 command | 迁移方式 |
| --- | --- |
| `context-budget` | 上下文预算 adapter |
| `save-session` | 会话保存 adapter |
| `resume-session` | 会话恢复 adapter |
| `sessions` | 会话索引 adapter |
| `aside` | 旁路记录 adapter |
| `learn` / `learn-eval` | 技能沉淀候选 adapter |
| `instinct-export` / `instinct-import` / `instinct-status` | 组织学习 adapter |
| `projects` | 项目上下文索引 adapter |

### 4.7 `peaks-solo`

`peaks-solo` 是全自动单人编排入口。

独立使用时，它可以完成：

- 场景识别；
- 模式推荐；
- 子技能调用；
- 交接检查；
- 总体质量门禁；
- 用户确认点管理；
- 最终报告。

在 Refactor Mode 中，它的核心路径是：

```text
peaks-solo refactor
  → 判断重构风险是否适合全自动编排
  → peaks-prd 定义重构目标、非目标和验收 spec
  → peaks-txt 生成项目上下文胶囊
  → peaks-rd 扫描项目、规范、测试框架和 UT 覆盖率
  → 覆盖率 <95% 或无法验证时，转入测试补齐流程并阻断重构
  → peaks-rd 按最小功能维度生成切片图和 2-3 个重构方案
  → peaks-qa 生成回归矩阵、基线报告和验收计划
  → 用户确认方案、切片范围和风险接受
  → peaks-rd 按切片执行最小安全重构
  → peaks-qa 对切片做 100% spec 验收
  → peaks-sc 记录变更影响、提交边界和同步状态
  → peaks-txt 归档上下文胶囊和经验
  → peaks-solo 要求提交代码和中间产物
  → 提交完成后才允许进入下一切片或最终报告
```

不属于 `peaks-solo` 的职责：

- 把所有角色逻辑重新塞回一个大技能；
- 跳过子技能 harness；
- 替用户批准关键风险；
- 原地重构旧 `peaks-sdd`。

可迁移 command：

| 原 command | 迁移方式 |
| --- | --- |
| `multi-workflow` | 作为跨技能工作流 adapter |
| `multi-execute` | 作为跨 agent 执行 adapter |
| `multi-plan` | 作为多路径计划 adapter |
| `loop-start` / `loop-status` | 作为长任务循环 adapter |
| `feature-dev` | 只保留场景识别和编排部分，研发细节迁移到 `peaks-rd` |
| `orchestrate` | 历史 shim，不作为新主入口 |

## 5. Refactor-first MVP

第一阶段不做完整 0→1 产品开发，而是优先打通真实项目重构。MVP 的主路径应是 `peaks-solo refactor` 全自动单人编排入口，而不是只证明 `peaks-rd` 能单独重构。

`peaks-solo refactor` 适用于重构风险可接受、用户希望 AI 自动推进但仍保留关键确认点的场景。这是技能家族最能出彩的地方：如果 `peaks-solo` 能把 `peaks-prd`、`peaks-rd`、`peaks-qa`、`peaks-sc`、`peaks-txt` 编排成一次效果不错、证据完整、可回退的重构，那么子技能单独使用也会有可信基础。

选择重构作为第一个场景的原因：

- 能验证真实代码理解能力；
- 能验证 `peaks-prd` 是否能把宽泛重构请求收束为目标、非目标和验收 spec；
- 能验证 `peaks-rd` 的方案比较、功能切片和任务图；
- 能验证 `peaks-qa` 的覆盖率门禁和回归保护是否真的有价值；
- 能验证 `peaks-txt` 是否能压缩项目上下文；
- 能验证 `peaks-sc` 是否能记录变更影响、提交边界和证据；
- 能验证 `peaks-solo` 是否只是编排，而不是重新变成单体。

Refactor-first MVP 有两个入口：

| 入口 | 适用场景 | 说明 |
| --- | --- | --- |
| `peaks-solo refactor` | 风险可接受、希望全自动推进的重构 | MVP 主路径，展示整个技能家族的编排价值 |
| `peaks-rd refactor` | 开发者想直接控制研发重构流程 | 备用/专家入口，但仍必须调度 `peaks-prd` 和 `peaks-qa` 产物 |

两种入口共享同一组红线：UT 覆盖率 95% 门禁、中间产物、最小功能切片、严格可验证 spec、100% 验收、提交代码和产物后才能进入下一切片。

### 5.1 Refactor Mode 阶段

#### Phase 0：场景识别

入口：`peaks-solo`

输出：

- 场景类型：refactor；
- 风险级别；
- 推荐模式：Fast / Standard / Strict / Parallel Candidate；
- 需要调用的子技能列表；
- 用户确认点。

#### Phase 1：重构目标

入口：`peaks-prd`

输出：

- `refactor-goal.md`；
- `refactor-non-goals.md`；
- `acceptance-criteria.md`；
- `behavior-preservation.md`。

核心问题：

- 为什么要重构；
- 什么行为必须保持不变；
- 什么问题必须改善；
- 哪些范围不做；
- 什么证据能证明重构成功。

#### Phase 2：上下文胶囊

入口：`peaks-txt`

输出：

- `context-capsule.json`；
- `rd-context.md`；
- `qa-context.md`；
- `risk-context.md`。

内容包括：

- 用户原始目标；
- 项目技术栈摘要；
- 已确认决策；
- 约束；
- 风险；
- 过期条件。

#### Phase 3：技术现状、覆盖率门禁与候选方案

入口：`peaks-rd`

输出：

- `project-scan.md`；
- `engineering-constitution.md`；
- `coverage-report.md`；
- `feature-slice-map.md`；
- `current-architecture.md`；
- `refactor-options.md`；
- `risk-matrix.md`；
- `rollback-plan.md`；
- `task-graph.preview.json`。

要求：

- 先识别项目现有规范；没有项目规范时再加载 Peaks 内置语言规范包；
- 先运行或定位 UT 覆盖率报告；
- UT 覆盖率必须达到 95% 及以上，未知或无法验证等同于未达标；
- 覆盖率未达标时，不得输出可执行重构计划，只能输出测试补齐计划；
- 覆盖率达标后，按最小功能维度划分重构切片；
- 至少给出 2 个方案；
- 每个方案标注成本、收益、风险、回滚路径；
- 明确受影响模块和切片顺序；
- 不在用户选择前改代码。

#### Phase 4：回归保护

入口：`peaks-qa`

输出：

- `regression-matrix.md`；
- `baseline-report.md`；
- `tests-to-add.md`；
- `manual-checklist.md`。

要求：

- 先建立基线；
- 标出必须补的测试；
- 标出无法自动验证、需要人工确认的检查项；
- 输出重构前风险。

#### Phase 5：用户选择方案

入口：`peaks-solo`

输出：

- `selected-refactor-option.md`；
- `approval-record.json`。

要求：

- 用户明确选择方案；
- 记录被放弃方案；
- 记录已接受风险；
- 记录是否允许进入实现。

#### Phase 6：按最小功能切片执行重构

入口：`peaks-rd`

输出：

- `slice-spec.md`；
- `acceptance-spec.md`；
- `task-graph.json`；
- `waves.json`；
- `handoffs/`；
- `implementation-report.md`；
- `validation-report.md`；
- `code-review.md`；
- `commit-required.md`。

要求：

- 一次只执行一个最小功能切片；
- 每个切片实现前必须有最严格的可验证 spec；
- 小步执行；
- 遵守文件所有权；
- 每个 wave 都有交接；
- 失败时可回滚；
- code review 不通过则进入修复循环；
- 切片必须 100% 通过验收 spec 才算完成；
- 切片完成后必须要求用户提交代码和中间产物；
- 未提交或未确认提交前，不得进入下一切片。

#### Phase 7：回归验证

入口：`peaks-qa`

输出：

- `regression-report.md`；
- `coverage-summary.json`；
- `runtime-smoke-report.md`；
- `acceptance-report.md`。

要求：

- 使用 Phase 4 的同一套矩阵；
- 对比重构前后结果；
- 明确残留风险；
- 不通过则退回 `peaks-rd`。

#### Phase 8：同步、留存和归档

入口：`peaks-sc` + `peaks-txt`

输出：

- `change-impact.json`；
- `sync-status.json`；
- `artifact-retention-report.md`；
- `final-context-capsule.json`；
- `lessons.md`；
- `final-report.md`。

要求：

- 记录产物与代码指针；
- 记录影响范围；
- 留存每个切片的 PRD/RD/QA 中间产物、覆盖率报告、验收 spec、验证报告和审查报告；
- 确认中间产物与代码一起进入提交；
- 记录最终证据；
- 归档上下文；
- 输出下次可复用的经验；
- 形成可追溯、可回退的兜底。

## 6. 共享协议最小集合

第一阶段不需要一次性做完整协议平台，但需要最小共享协议让子技能能交接。

### 6.1 Artifact manifest

用于说明每个产物是谁生成的、属于哪个阶段、当前状态是什么。

核心字段：

- `artifactId`；
- `artifactType`；
- `ownerSkill`；
- `scenario`；
- `status`；
- `createdAt`；
- `updatedAt`；
- `inputs`；
- `outputs`；
- `evidence`。

### 6.2 Context capsule

用于向下游角色传递最小必要上下文。

核心字段：

- `sourceSkill`；
- `audience`；
- `purpose`；
- `confirmedDecisions`；
- `assumptions`；
- `discardedOptions`；
- `risks`；
- `staleness`。

### 6.3 Approval record

用于记录用户选择、确认和风险接受。

核心字段：

- `approvedBy`；
- `approvedAt`；
- `approvedArtifact`；
- `decision`；
- `acceptedRisks`；
- `conditions`。

### 6.4 Change impact

用于连接产品目标、技术变更、测试证据和同步状态。

核心字段：

- `changeId`；
- `sourceArtifacts`；
- `affectedModules`；
- `affectedFiles`；
- `qaImpact`；
- `riskImpact`；
- `syncPointers`。

### 6.5 Refactor slice spec

用于约束每一次最小功能切片重构。

核心字段：

- `sliceId`；
- `functionalBoundary`；
- `preRefactorBehavior`；
- `targetStructure`；
- `nonGoals`；
- `unitTestRequirements`；
- `coverageRequirement`；
- `acceptanceChecks`；
- `rollbackPlan`；
- `requiredArtifacts`；
- `commitRequired`。

### 6.6 Artifact retention report

用于证明中间产物被留存，并和代码一起形成可追溯、可回退的提交边界。

核心字段：

- `sliceId`；
- `prdArtifacts`；
- `rdArtifacts`；
- `qaArtifacts`；
- `coverageArtifacts`；
- `reviewArtifacts`；
- `codeChanges`；
- `commitStatus`；
- `rollbackPoint`。

## 7. command 迁移策略

采用“重命名优先”。

规则：

1. 新文档、新入口、新触发语统一使用 `peaks-*` 短名。
2. 旧 command 不作为主入口。
3. 旧 command 中可复用的 prompt、流程、参数说明可以迁移到对应子技能。
4. 与新技能边界冲突的 command 要拆分，而不是整体搬迁。
5. 明确 legacy shim 的 command 不进入核心家族。

### 7.1 直接迁移

| 子技能 | 可直接迁移的 command |
| --- | --- |
| `peaks-prd` | `prp-prd`、`product` |
| `peaks-ui` | `design` |
| `peaks-rd` | `prp-implement`、`build-fix`、`refactor-clean` |
| `peaks-qa` | `testing`、`test-coverage`、`quality-gate` |
| `peaks-sc` | `prp-commit`、`prp-pr`、`checkpoint` |
| `peaks-txt` | `save-session`、`resume-session`、`context-budget` |
| `peaks-solo` | `multi-workflow`、`multi-execute`、`multi-plan` |

### 7.2 拆分迁移

| command | 拆分方式 |
| --- | --- |
| `feature-dev` | 场景识别归 `peaks-solo`，需求归 `peaks-prd`，实现归 `peaks-rd`，验证归 `peaks-qa` |
| `client` | 体验和 UI 规范归 `peaks-ui`，前端实现归 `peaks-rd` |
| `server` | 后端实现归 `peaks-rd`，API 验证归 `peaks-qa` |
| `review-pr` | PR 信息读取归 `peaks-sc`，质量判断归 `peaks-qa` / `peaks-rd` |
| `learn` / `instinct-*` | 学习沉淀归 `peaks-txt`，技能创建仍可调用独立 skill-create 能力 |

### 7.3 不进入核心家族

以下 command 可以保留在平台层或历史层，不作为 Peaks 短名技能的核心入口：

- `orchestrate`；
- `claw`；
- `agent-sort`；
- `prompt-optimize`；
- `rules-distill`；
- `pm2`；
- `hookify-*`；
- 语言专用 review/build/test command 的全部直接入口。

语言专用 command 可以作为 `peaks-rd` 或 `peaks-qa` 的动态 adapter，而不是用户必须记住的主入口。

## 8. skill 创建方式

新建子技能时采用混合方式：

1. 使用 `skill-create` / `skill-creator` 的方法论做质量参考；
2. 不盲目生成外部风格目录；
3. 手动落到当前仓库标准结构；
4. 每个子技能都要有清晰 description、触发语、独立模式、编排模式、产物边界和测试提示；
5. 初始版本优先服务 Refactor Mode，不一次性覆盖所有场景。

每个新技能的最小骨架：

```text
skills/peaks-*/
├── SKILL.md
├── references/
│   ├── workflow.md
│   ├── artifact-contracts.md
│   └── command-migration.md
├── templates/
│   ├── agents/
│   ├── harness/
│   └── openspec/
├── schemas/
└── scripts/
```

## 9. 与现有 `peaks-sdd` 的关系

现有 `skills/peaks-sdd/` 保留。

它可以作为：

- 历史 workflow 参考；
- harness 门禁参考；
- agent 模板参考；
- artifact layout 参考；
- dogfood 经验来源。

它不应该在第一阶段被：

- 原地改名为 `peaks-solo`；
- 直接拆目录；
- 强制迁移所有文件；
- 作为新体系唯一事实源。

新体系应该通过新增目录演进，降低回滚成本。

## 10. 生命周期

每个子技能都有自己的生命周期。

| 阶段 | 含义 | 进入条件 |
| --- | --- | --- |
| Draft | 初始设计和骨架 | `SKILL.md`、references、基本触发语存在 |
| Dogfood | 可在真实项目试跑 | Refactor Mode 至少能跑通该技能负责的阶段 |
| Stable | 可推荐日常使用 | 有真实项目验证、有回归样例、有清晰失败处理 |
| Deprecated | 被新技能或新协议替代 | 有替代入口、有迁移说明、有兼容窗口 |

升级原则：

- 子技能可以独立升级；
- 共享协议升级要声明兼容范围；
- `peaks-solo` 只依赖稳定的子技能接口；
- breaking change 必须有迁移说明。

## 11. MVP 交付范围

第一阶段建议交付：

1. 新建 7 个子技能目录骨架；
2. 每个子技能写清楚独立模式和编排模式；
3. 每个子技能写 Refactor Mode 下的职责；
4. 定义最小共享协议：manifest、context capsule、approval record、change impact；
5. 为 `peaks-solo refactor` 写完整跨技能流程，并把它作为 MVP 主路径；
6. 为 `peaks-rd refactor` 写 direct mode，作为开发者直接控制的备用入口；
7. 为现有 commands 写迁移映射；
8. 在真实项目上 dogfood 一轮 `peaks-solo refactor` 全自动编排重构；
9. 再用同一项目或相邻切片验证 `peaks-rd refactor` direct mode；
10. 根据 dogfood 结果收缩或调整子技能边界。

MVP 不是传统意义上的“少做一点以节省人力”，而是“先选择最能验证架构的闭环”。由于开发将主要由 AI 完成，可以允许更完整的技能骨架和协议设计同时展开，但每一部分必须有可验证产物和真实 dogfood 反馈。

第一阶段不做：

- 不重构旧 `skills/peaks-sdd/`；
- 不一次性实现完整 0→1 产品开发；
- 不默认安装所有外部 skills；
- 不把 artifact repo 同步平台一次性做完整；
- 不把所有语言专用 command 都暴露为用户主入口。

## 12. 验收标准

本设计可接受的条件：

- 新技能命名短、清晰、好记；
- 新体系通过新增 `skills/peaks-*` 实现，而不是改旧 `peaks-sdd`；
- 每个子技能都可以独立使用和升级；
- 每个子技能都有自己的 harness 和 OpenSpec 作用点；
- `peaks-solo` 明确只是编排入口；
- `peaks-solo refactor` 是第一阶段真实 dogfood 的主路径，能展示整个技能家族的编排价值；
- `peaks-rd refactor` 是开发者直接控制的备用入口，但不能绕过 PRD/QA 中间产物；
- 现有 Claude commands 有明确迁移策略；
- 重构流程先建立目标和回归保护，再允许实现；
- `peaks-rd` 直接触发重构时也必须调度 `peaks-prd` 和 `peaks-qa` 生成中间产物；
- 重构 UT 覆盖率低于 95% 或无法验证时严格阻断；
- 覆盖率达标后仍必须先按最小功能切片生成严格可验证 spec，不能直接整体重构；
- 每个切片 100% 通过验收 spec 后，必须提交代码和中间产物，否则不得进入下一切片；
- 产物、上下文、审批、变更影响、切片 spec 和留存报告有最小共享协议；
- 可以在真实项目中调试验证。

## 13. 下一步建议

下一步不应该继续扩大愿景，而应该进入实施规划：

1. 先创建 7 个新 skill 的最小骨架；
2. 优先完成 `peaks-solo`、`peaks-rd`、`peaks-qa`、`peaks-txt` 的 Refactor Mode；
3. 把 `peaks-prd` 的重构目标产物补齐；
4. 把 `peaks-sc` 的 change-impact 最小协议补齐；
5. 选择一个真实项目试跑；
6. 根据试跑结果再决定是否扩展到 0→1、bugfix、QA 强化和事故响应。
