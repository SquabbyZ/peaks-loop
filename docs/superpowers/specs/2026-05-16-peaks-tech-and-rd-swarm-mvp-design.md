# Peaks Tech 与 RD Swarm MVP 设计

**日期：** 2026-05-16
**状态：** 设计完成

## 背景

Peaks 需要先补齐技术方案门禁，再推进 RD 开发蜂群。用户目标是：开发阶段尽可能打开更多安全并行 worker，显著提升研发效率；同时技术方案、CR、安全、QA 和证据记录必须可追踪。

本设计确认两件事：

1. `peaks-tech` 是技术方案与技术评审门禁。
2. `peaks-rd` 是基于已批准技术方案的开发蜂群 dry-run planner。

## 核心原则

- `.peaks/changes/<change-id>/...` 属于 Peaks artifact workspace，不写入目标代码仓。
- `peaks-tech` 只做技术理解、技术方案、方案评审，不写实现代码。
- `peaks-rd` 根据已批准技术方案生成 25-40 个 worker 规模的 dry-run task graph。
- 单元测试覆盖率门禁必须为 100%：statements、branches、functions、lines 全部 100%。
- CR 和安全检查属于 RD 研发闭环；SC 只记录证据和边界。

## Skill 职责边界

| Skill | 职责 | 是否人审 | 是否蜂群 |
| --- | --- | --- | --- |
| `peaks-prd` | 产品需求、范围、非目标 | 是 | 弱蜂群：多候选 + 主控收敛 |
| `peaks-ui` | 设计方案、交互、设计规范 | 是 | 弱蜂群：设计探索 + 主设计收敛 |
| `peaks-tech` | 前后端技术方案、contract、测试、平台、CI、安全方案 | 是 | 技术扫描/文档/评审蜂群 |
| `peaks-rd` | 研发实现计划、前后端、测试、CR、安全、回归、reducer | 否，除非被 gate 阻断 | 强蜂群：25-40 worker dry-run graph |
| `peaks-qa` | 验证、回归、覆盖率、平台测试 | 否 | 强蜂群 |
| `peaks-sc` | 证据、commit boundary、artifact retention、change impact | 否 | 单主控 + 审查蜂群 |

## Workflow Router 规则

### 直接进入 `peaks-rd`

以下场景默认不需要 `peaks-tech`：

- 普通 bug fix
- 小型 hotfix
- 小型/中型局部重构
- 目标明确且实现路径明确的改动

Bug fix 默认流程：

```text
reproduce -> root cause -> minimal fix -> tests -> CR/security if needed -> SC evidence
```

### 先进入 `peaks-tech`

以下场景必须走 `peaks-tech`：

- 新功能开发
- 大型重构
- 前后端 contract/API/schema 变化
- public API / CLI contract 变化
- 数据结构、配置、CI、部署变化
- 权限、token、安全边界变化
- 需要 3 个以上模块协同重构
- worker 冲突组过多，无法安全并行

一句话规则：

```text
目标明确、实现路径明确 -> peaks-rd
设计未定、边界会变 -> peaks-tech
```

## `peaks-tech` MVP

### 定位

`peaks-tech` 需要理解项目，但只理解到“能做技术决策”的程度，不深入到每个函数的实现细节。它关注：

- 目录和模块边界
- 前后端连接方式
- contract / shared types / schema
- 测试结构和覆盖率门禁
- Windows/macOS/Linux 平台差异
- CI / build / release 约束
- 安全边界和风险点

### CLI

```bash
peaks tech plan --change-id <id> --goal "<目标>" --swarm --dry-run --json
peaks tech status --change-id <id> --json
```

### Tech Swarm Waves

#### Wave 1: 技术事实扫描

```text
tech-architecture-scan
tech-frontend-scan
tech-backend-scan
tech-contract-scan
tech-test-scan
tech-platform-scan
tech-security-scan
tech-ci-scan
```

#### Wave 2: 技术方案文档

```text
tech-frontend-doc-worker
tech-backend-doc-worker
tech-contract-doc-worker
tech-test-doc-worker
tech-platform-doc-worker
tech-security-doc-worker
tech-ci-doc-worker
tech-migration-doc-worker
```

#### Wave 3: 技术方案评审

```text
tech-architecture-reviewer
tech-contract-reviewer
tech-security-reviewer
tech-test-reviewer
tech-platform-reviewer
tech-risk-reviewer
```

#### Wave 4: 技术方案 reducer

```text
tech-reducer
```

### Tech Artifacts

写入 Peaks artifact workspace：

```text
.peaks/changes/<change-id>/architecture/
├── frontend-tech-doc.md
├── backend-tech-doc.md
├── contract-tech-doc.md
├── test-tech-doc.md
├── platform-tech-doc.md
├── security-tech-doc.md
├── ci-tech-doc.md
├── migration-tech-doc.md
├── tech-review-report.md
└── tech-approval-record.md
```

`peaks tech status` 检查：

- 必要 tech docs 是否存在
- tech review 是否存在
- `tech-approval-record.md` 是否 approved
- 未 approved 时阻断 `peaks-rd swarm plan`

### `peaks-tech` MVP 输出

第一版先 dry-run，不执行真实 agent，不写完整技术文档。输出：

```text
architecture/tech-task-graph.json
architecture/waves/*.json
architecture/workers/<task-id>/brief.md
architecture/tech-review-checklist.md
architecture/tech-approval-record.template.md
```

如果 artifact workspace 未配置，只返回预览和 next actions。

## `peaks-rd` Swarm MVP

### 定位

`peaks-rd` 基于已批准的 `peaks-tech` 方案，生成研发阶段 dry-run task graph。第一版不真实启动 agent，不改目标代码仓，只生成 task graph、waves、worker briefs、reducer plan。

### CLI

```bash
peaks swarm plan --skill rd --change-id <id> --goal "<研发目标>" --max-workers 40 --dry-run --json
```

### RD Swarm Target

给定一个研发目标，生成 25-40 个 worker 规模的 dry-run task graph，覆盖：

- 前端
- 后端
- contract
- 单元测试
- 集成测试
- 平台兼容
- CI / build / typecheck
- 文档 / DX
- code review
- security review
- 回归测试
- reducer / merge plan

### RD Waves

#### Wave 1: Discovery

```text
rd-frontend-scan
rd-backend-scan
rd-test-scan
rd-contract-scan
rd-platform-scan
rd-risk-scan
rd-dependency-scan
rd-ci-scan
```

#### Wave 2: Planning

```text
rd-frontend-slicer
rd-backend-slicer
rd-unit-test-slicer
rd-integration-test-slicer
rd-contract-planner
rd-config-planner
rd-file-owner-planner
rd-quality-gate-planner
```

#### Wave 3: Implementation Candidates

```text
rd-impl-frontend-001..N
rd-impl-backend-001..N
rd-impl-contract-001
rd-impl-config-001
rd-impl-unit-test-001..N
rd-impl-integration-test-001..N
rd-impl-platform-001
rd-impl-ci-001
rd-impl-docs-001
```

#### Wave 4: Quality Gates

```text
rd-code-review-worker
rd-security-review-worker
rd-typecheck-worker
rd-coverage-worker
rd-regression-worker
rd-performance-worker
rd-docs-review-worker
```

#### Wave 5: Reducer

```text
rd-reducer-worker
```

### RD Artifacts

写入 Peaks artifact workspace：

```text
.peaks/changes/<change-id>/swarm/
├── task-graph.json
├── waves/
│   ├── wave-1-discovery.json
│   ├── wave-2-planning.json
│   ├── wave-3-implementation-candidates.json
│   ├── wave-4-quality-gates.json
│   └── wave-5-reducer.json
├── workers/
│   └── <task-id>/brief.md
└── reducer-report.md
```

### RD Gate

`peaks-rd` 在以下情况阻断：

- `peaks-tech` required but not approved
- artifact workspace 未配置且用户要求持久化
- change id 无效
- task graph worker 数低于最小目标且未说明原因
- 冲突组过多导致无法安全并行

## Artifact Boundary

目标代码仓不得写入：

- `.peaks/changes/<change-id>/swarm/`
- worker brief
- worker report
- reducer report
- tech review report
- final report

这些都属于 artifact workspace。目标代码仓只保留源码、测试、项目文档和必要配置。

## Testing Requirements

所有新增模块必须有 100% 单元测试覆盖率：

```text
statements: 100
branches: 100
functions: 100
lines: 100
```

完成条件：

```bash
pnpm test
pnpm typecheck
pnpm test:coverage
```

全部通过，且 coverage 100%。

## Non-goals

第一版不做：

- 真实启动 worker agent
- 自动修改目标代码仓
- 自动提交/推送 artifact repo
- 自动审批 tech docs
- UI 预览
- 完整 OpenSpec 实现

## Implementation Order

1. 实现 `peaks-tech` dry-run plan/status 的类型和服务。
2. 增加 CLI `peaks tech plan/status`。
3. 实现 tech artifact path 规划，不污染目标代码仓。
4. 实现 `peaks-rd` swarm dry-run types 和 planner。
5. 增加 CLI `peaks swarm plan --skill rd`。
6. 加入 tech approval gate。
7. 用 100% coverage 覆盖所有新增模块。
