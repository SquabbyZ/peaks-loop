---
name: peaks-cli-fork-sync-and-layered-parallel
description: peaks-cli 双轨演进 + 分层并行 = 上游 tag 断点同步(独立排期窗口,不在业务版本预算) + 大需求基础先行/业务并行(业务不等基础全部完成,基于基础子集立即启动)
metadata:
  type: project
  createdAt: 2026-06-28
---

# peaks-cli 上游同步 + 分层并行

> 适用: 当 LLM 解释 fork 场景 / 大需求调度 / 基础 vs 业务切分时。

## 1. 双轨演进(Hermes 类 fork 场景)

### 1.1 上游同步的本质

**不是"实时跟随上游",是"按 tag 断点 + 独立排期窗口"。**

```
时间线示例:

  Hermes 上游:    v1.0.0 ───── v1.10.0 ───── v1.20.0 ───── v1.30.0
                                 │            │            │
  你的 fork:    ── v1.0.0 起点 ──┘            │            │
                                              │            │
                              同步 1 (W2.5) ───┘            │
                              同步 2 (W4.5) ──────────────────┘
                              (选稳定 tag,不逐版本跟随)

关键:
1. 不实时跟随上游(中间 30 个版本不逐个合)
2. 按"需求迭代时间之外"做同步(独立排期)
3. 选稳定 tag(不是最新)
4. 每次同步有"大需求窗口"作为隔离缓冲
```

### 1.2 上游同步的 5 个关键能力

| # | 能力 | 描述 |
|---|---|---|
| C1 | 双日历 | 业务日历 + 上游同步日历,互不干扰 |
| C2 | tag 断点同步 | 选上游稳定 tag,不逐版本跟随 |
| C3 | 同步窗口独立排期 | 在业务版本"间隙"做,不占业务预算 |
| C4 | patch 重放 | 同步完 → 业务 patch 重新基于新基线 |
| C5 | 上游基线追踪 | 记录每次同步的 tag / commit / patch 集 / 偏离度 |

### 1.3 上游同步 CLI(预期形态)

```bash
peaks fork status --project . --json
peaks fork upstream-check --project . --json
peaks fork sync-plan --upstream v1.20.0 --project . --json
peaks fork sync --plan <plan-id> --project . --json
peaks fork sync-verify --sync-id <id> --project . --json
```

## 2. 分层并行(大需求调度模式)

### 2.1 核心问题

**大需求 = 一周内肯定做不完的需求,怎么合理调度?**

- 错误: 串行(等基础全部完成 → 再做业务)
- 正确: 基础快速做 → 立即并行业务(基础子集就绪即启动)

### 2.2 对比

```
错误(串行):
  基础 S1 → 基础 S2 → 基础 S3 → 业务 A → 业务 B → 业务 C
  [───── 3-5 天 ─────] [─A─][─B─][─C─]
  总时间: 5 + 3 = 8 天

正确(分层并行):
  基础 S1 → 基础 S2 ────────── 基础 S3
  [─S1─][──── S2 ────]────────[─── S3 ───]
            ↓
            业务 A (依赖 S1, S2) ──────────┐
            业务 B (依赖 S2) ─────┐         │
            业务 C (依赖 S2, S3) ─┴─────────┘
            [─ A ─][── B ──][── C ──]
  总时间: 3(基础)+ 3(业务) = 6 天
  节省: 2 天
```

### 2.3 Hermes TOB 化场景示例

```
基础 slice(3-5 天):
  B1. 数据库 schema(用户表 / 角色表 / 权限表 / Skill 关系表)
  B2. 后端核心 API(用户 CRUD / 角色 CRUD / 鉴权中间件)
  B3. 前端基础组件(Layout / Sidebar / AuthGuard / Empty / Loading)
  B4. 鉴权流程(登录 / 登出 / 续签 / 异常处理)

业务 slice(并行启动,基于基础子集):
  P1. 用户管理页 → 依赖 B1 + B2.user + B3.Layout + B4.登录
  P2. 角色管理页 → 依赖 B1 + B2.role + B3.Layout
  P3. 权限管理页 → 依赖 B1 + B2.perm + B3.Layout
  P4. Skill 权限层 → 依赖 B1 + B2.auth + B4.鉴权
  P5. SkillHub 列表 → 依赖 B1 + B3.Layout + B4.登录
  P6. SkillHub 详情 → 依赖 B2.skill + B3.Layout

时间线:
  Day 1: B1, B3 启动
  Day 2: B1 完成 → P1, P2, P3 立即启动(基于 B1)
         B2, B4 启动
  Day 3: B3 完成 → P5 立即启动
         B2.user 完成 → P1 进一步就绪
  Day 4: B2 完成 → P2, P3, P6 进一步就绪
         P1, P2, P3 完成 → 验收
         B4 完成 → P4 启动
  Day 5: P4, P5, P6 完成 → 验收
  Day 6: 整体验收
  
  vs 串行(等所有基础完成再做业务):
  Day 1-5: B1-B4 完成
  Day 6-8: P1-P6 启动
  
  → 分层并行节省 2-3 天
```

### 2.4 fan-out 算法修订

```typescript
function runLayeredDag(dag: SliceDag) {
  // 基础 slice 优先跑
  const foundationSlices = dag.nodes.filter(n => n.foundation === true);
  runLayer(foundationSlices);
  
  // 业务 slice:依赖子集就绪即启动,不等所有基础
  const businessSlices = dag.nodes.filter(n => n.foundation === false);
  for (const slice of businessSlices) {
    slice.startWhenDependsReady();  // 关键:只等其依赖的子集
  }
}
```

## 3. slice DAG 标记规范

```json
{
  "nodes": [
    { "id": "B1", "role": "rd", "foundation": true, "label": "数据库 schema" },
    { "id": "P1", "role": "rd", "foundation": false, "label": "用户管理页",
      "dependsOn": ["B1", "B2", "B3"] },
    { "id": "S1", "role": "rd", "upstreamSync": true, "label": "上游同步 v1.20.0" }
  ]
}
```

## 4. 反例(不要再这样描述)

- × "上游同步 = 实时跟随"
- × "大需求必须等基础全部完成"
- × "上游同步 = 业务版本节奏的一部分"
- × "业务 slice 必须依赖所有基础"
- × "上游逐版本合入"

## 5. 关联

- [[peaks-cli-24h-ai-programmer-positioning]]
- [[peaks-cli-prd-template-design]] — 上游基线块 + slice 切分标记
- [[peaks-cli-slice-review-and-qa-perspective]] — 上游同步 slice 的 QA 验收
- [[peaks-cli-fast-iteration-quality-loop]] — 上线后影响面扫描
