---
name: peaks-loop-prd-template-design
description: peaks-prd 模板设计 — 4 个必填块:业务场景 / 边界 case / UI 装配意图 / 上游基线(适用 fork 场景);质量杠杆前置到 prd 阶段
metadata:
  type: project
  createdAt: 2026-06-28
---

# peaks-prd 模板设计

> 适用: 当 LLM 解释 prd 模板 / 脑暴必填项 / slice 切分依据时。

## 1. 设计哲学

**质量杠杆前置到 prd 阶段**(user 写 prd 时 1-2h 一次性锁住),执行层不堆质量,只换效率。

→ **prd 模板的设计质量 = 整个工具的天花板。**

## 2. 4 个必填块(顺序固定)

### 2.1 业务场景块(必填,user 写)

```markdown
## 业务场景(必填,user 写,200 字以内)

### 目标用户
- 什么人用?企业 IT 管理员 / 普通员工 / 第三方开发者?
- 单租户 / 多租户?租户隔离粒度?
- 预期用户量级?100 / 1k / 10k / 100k?

### 业务流程(核心)
- 用户首次进入:登录?邀请码?SSO?
- 普通用户能用哪些 skill?管理员能用哪些?
- SkillHub 的发现 → 安装 → 使用全流程?
- 付费场景?(如未来要商业化)

### 性能 / 数据量级
- 预期并发:10 / 100 / 1000?
- 技能库规模:100 / 1k / 10k?
- DB 容量预期:GB / TB 级?
- 实时性要求:毫秒 / 秒级?

### 跟现有系统关系
- 替换老系统 / 共存?
- 老用户数据怎么处理?
- 老 API 是否要兼容?

### 业务上绝不能出现
- 越权访问(用户能看别人的 skill / 数据)
- 数据跨租户泄漏
- 关键操作无审计日志
- 老板级别的需求漏掉
```

→ **这一段 user 必写,写了之后技术决策 AI 自决。**

### 2.2 边界 case 清单(必填,user 写)

- 异常输入下的引导
- 错误提示的用户语言
- 空状态 / 加载状态 / 失败状态的产品语调
- 多角色 / 多租户 / 越权场景
- 数据迁移 / 兼容场景

### 2.3 UI 装配意图(必填,user 写)

**不画 ASCII 视觉**,因为视觉会**自动由选定的开源组件库 + 模板**决定。

```markdown
## UI 装配意图(必填,user 写)

### 页面模式
- 这个功能用哪些"已有页面模式"?
  例:列表 / 详情 / 表单 / 抽屉 / 弹窗 / 卡片

### 关键交互
- 搜索 / 过滤 / 排序 / 批量操作 / 拖拽
- 大列表分页 / 虚拟滚动 / 实时刷新 / 多 Tab

### 信息密度
- 紧凑(数据后台) / 宽松(产品介绍)

### 装配意图(不是视觉)
- 权限管理要树状(业务预期:管理员能直观看到资源树)
- SkillHub 要支持列表/卡片切换(业务预期:不同用户偏好)
- 未授权要有引导(业务预期:用户知道下一步干什么)
```

→ **AI 据此在 RD 阶段选 UI 库 + 选组件 + 装配,user 不参与。**

### 2.4 上游基线块(必填,适用 fork 场景)

```markdown
## 上游基线(必填,fork 场景)

### 当前 fork 状态
- 上游仓库: https://github.com/xxx/hermes
- 当前 fork 基于: v1.0.0(commit abc123)
- fork 偏离度: <N> commits, <M> files

### 这次需求
- 需要合入上游吗? 是 / 否
- 如果是,目标上游版本: v1.1.0
- 预计冲突点: <预判>

### 业务 patch 集
- 当前 patch 数: <N>
- 关键 patch: <列表>
- patch 重放风险: <评估>
```

## 3. Slice 切分(从 prd 推导)

| 类型 | 标记 | user 决策 |
|---|---|---|
| 基础 slice | `foundation: true` | user 标 |
| 业务 slice | `foundation: false` | user 标 |
| 上游同步 slice | `upstreamSync: true` | user 标 |
| 复杂度 | `complexity: trivial \| simple \| complex` | user 标(AI 辅助建议) |

**业务 slice 必填"基础依赖":**
- 依赖哪些基础 slice(可子集,不必全部)
- 依赖哪些业务 slice
- 依赖哪些上游同步 slice

## 4. 反例(不要再这样描述)

- × "prd 画 ASCII UI 视觉稿"
- × "prd 不必写性能 / 数据量级"
- × "prd 不必写业务禁区"
- × "prd 不必标基础 / 业务 slice"
- × "prd 必填块都是 AI 写"

## 5. 关联

- [[peaks-loop-24h-ai-programmer-positioning]]
- [[peaks-loop-user-role-and-tech-decision]] — 业务场景块是反伪选择的唯一入口
- [[peaks-loop-slice-review-and-qa-perspective]] — slice 审阅依据 prd 业务场景块
- [[peaks-loop-fork-sync-and-layered-parallel]] — 上游基线块的来历
- [[peaks-loop-fast-iteration-quality-loop]] — slice 切分 + 复杂度标
