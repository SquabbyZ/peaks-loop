---
name: peaks-cli-fast-iteration-quality-loop
description: peaks-cli 快速迭代闭环 = G13 存量影响面扫描(改 A 前预警) + G14 轻量回归(无 UT 兜底下的最低验证) + G15 上线观察期(发现-反馈-修复小时级)
metadata:
  type: project
  createdAt: 2026-06-28
---

# peaks-cli 快速迭代闭环

> 适用: 当 LLM 解释存量老项目 / 无 UT 场景 / 改 A 触发 B / 2 天 1 版快速上线时。

## 1. 现实约束(用户描述)

- 存量老项目 = 没有 UT 兜底
- 没有 UT → 没有回归网,没有 E2E,没有契约测试
- 改 A 触发 B = **必然会发生**,不是意外
- 2 天 1 版 = 业务压力极大,不能停下来补 UT
- 必须**快速发现 + 快速修复**,不能"上线后 1 周用户报"

## 2. 核心工程权衡

**发现速度 > 修复速度 > 预防速度**(在快速迭代下)

- 不能"补完 UT 再上线"
- 只能"上线后 1-2 天内必须发现并修复 B 类问题"
- → **发现-反馈-修复周期压到小时级**

## 3. G13 存量影响面扫描(改 A 前预警)

### 3.1 核心需求

- 改 A 之前,知道 A 会影响哪些 B
- 现状(没工具): 改 A → 跑全量回归(没有)→ 上线后用户报 B → 紧急修复
- peaks-cli 责任: 改 A 之前,**静态分析 + 业务知识**生成影响面报告,user 提前知道风险

### 3.2 关键能力

| # | 能力 |
|---|---|
| 1 | 代码依赖图(函数/接口/数据模型被谁引用) |
| 2 | 业务影响面(改了用户管理,影响哪些业务流程) |
| 3 | 风险评级(高/中/低) |
| 4 | 改之前的"必看清单" |

### 3.3 CLI 形态(预期)

```bash
peaks impact scan --change <slice-id> --project . --json
peaks impact must-check --change <slice-id> --project . --json
```

### 3.4 输出示例

```json
{
  "sliceId": "P1",
  "changeType": "用户管理重构",
  "affectedFiles": 12,
  "affectedApis": ["GET /api/user/:id", "POST /api/user"],
  "affectedBusinessFlows": [
    "登录流程(用户表结构变化)",
    "权限校验(角色表结构变化)",
    "Skill 权限层(userId 字段)"
  ],
  "riskLevel": "high",
  "warnings": [
    "改动会影响 Skill 权限层,需要回归",
    "用户表结构变化,需配合数据迁移"
  ]
}
```

## 4. G14 轻量回归(无 UT 兜底下的最低验证)

### 4.1 核心需求

- 没有 UT 的存量项目,必须有最低限度回归
- 现状(没工具): 改完 → 上线 → 用户报 → 修(慢)
- peaks-cli 责任: 提供"轻量回归"机制,**比 E2E 快,比 UT 覆盖广**

### 4.2 轻量 vs 完整 E2E

| 维度 | 完整 E2E | 轻量回归 |
|---|---|---|
| 覆盖路径 | 全部 | 关键 5-10 条 |
| 跑时间 | 1-2 小时 | 5-10 分钟 |
| 数据 | 多场景 | 核心场景 |
| 维护成本 | 高 | 中 |
| 适用 | 稳定期 | 快速迭代期 |

### 4.3 关键路径来源(自动 + 人工)

- prd 业务场景块(user 写)
- 老板强调的流程(老板文档)
- 历史事故(上次出问题的地方)
- 改 A 触发 B 的 B(G13 影响面扫描出的) ← **G13 + G14 联动**

### 4.4 CLI 形态(预期)

```bash
peaks smoke define --project . --json     # 定义关键路径
peaks smoke run --project . --json         # 跑轻量回归
peaks smoke run-and-repair --project . --json  # 跑失败 → 自动进修复环
peaks smoke add-path --from-issue <id> --project . --json  # 修复后回灌
```

## 5. G15 上线观察期(快速发现 + 快速修复)

### 5.1 核心需求

- 快速上线后,必须有快速发现 + 快速修复机制
- 现状(没工具): 上线 → 1-2 天用户报 → 修(慢)
- peaks-cli 责任: "上线观察期"工作流,**发现-反馈-修复小时级**

### 5.2 3 个阶段

```
阶段 1: 灰度发布
  - 10% → 50% → 100%,每阶段 1-2h 观察
  
阶段 2: 观察期(灰度到 100% 后 24-48h)
  - 错误码聚合
  - 关键接口 P99
  - 用户反馈聚合
  - 异常堆栈采集
  
阶段 3: 紧急修复(发现 B 类问题)
  - 跳过 prd 脑暴(只写 hotfix PRD)
  - 跳过蜂群(单 slice 直接修)
  - 直接进 production
  - 修复后回灌到 G14(加进关键路径)
```

### 5.3 CLI 形态(预期)

```bash
peaks release canary --version v1.2.0 --percent 10 --project . --json
peaks release canary --version v1.2.0 --percent 50 --project . --json
peaks release promote --version v1.2.0 --project . --json
peaks release watch --version v1.2.0 --duration 24h --json
peaks hotfix --issue <issue-id> --project . --json
peaks smoke add-path --from-issue <issue-id> --project . --json
```

## 6. G13/G14/G15 联动流程

```
改 A 之前(G13)
  └→ 影响面扫描
       └→ 必看清单(技术维度,但 user 必须知道)
            └→ 自动进 G14 关键路径
                 
改 A 完成(G14)
  └→ 跑轻量回归
       └→ 失败 → repair-loop
       └→ 成功 → 进 G15
       
上线(G15)
  └→ 灰度发布
       └→ 观察期监控
            └→ 发现 B → 紧急修复
                 └→ 修复回灌到 G14 关键路径(防下次再犯)
```

## 7. peaks-cli 完整职责总览

```
做对(原始 5 个 Gaps + 切片相关):
  G1 slice 业务审阅
  G2 复杂度分流
  G3 prd 业务场景块
  G4 技术决策反伪选择
  G5 QA 业务视角

双轨(演化相关):
  G11 上游 tag 断点同步
  G12 基础/业务分层并行

快速迭代(质量闭环):
  G13 存量影响面扫描
  G14 轻量回归
  G15 上线观察期

→ 完整 = 做对 + 双轨 + 快速迭代
```

## 8. 反例(不要再这样描述)

- × "存量项目必须先补 UT 再迭代"
- × "上线后等用户报再修"
- × "改完跑全量回归"
- × "上游同步要逐版本跟随"
- × "大需求必须串行"
- × "完整 E2E 跑 1-2 小时"

## 9. 关联

- [[peaks-cli-24h-ai-programmer-positioning]]
- [[peaks-cli-user-role-and-tech-decision]]
- [[peaks-cli-prd-template-design]]
- [[peaks-cli-slice-review-and-qa-perspective]]
- [[peaks-cli-fork-sync-and-layered-parallel]]
