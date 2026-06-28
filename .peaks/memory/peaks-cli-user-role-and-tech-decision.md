---
name: peaks-cli-user-role-and-tech-decision
description: peaks-cli 真实 user 画像 = 业务+产品+前端资深 + 后端半盲;user 审 = 业务/产品/UI 装配,不审技术;技术决策全部反伪选择,AI 拍板
metadata:
  type: project
  createdAt: 2026-06-28
---

# peaks-cli user 角色 + 技术决策反伪选择

> 适用: 当 LLM 解释 Solo gate / 14 个 AskUserQuestion 点 / slice review 模板时,避免让 user 参与技术决策。

## 1. user 真实画像(peaks-cli 默认 user 模型)

```
user 的真实画像(资深前端 + 后端半盲 + 业务资深):

  业务 / 产品 维度    ████████████ (资深)
  前端技术 维度        ██████████   (资深)
  后端语言栈 维度      ████         (半盲)
  性能 / 安全 维度     ██           (不熟)
  AI 使用 维度         ████████████ (资深 — 这是 peaks-cli 诞生的原因)

→ user 在 Solo 循环里**只能有效决策**前 3 个维度
→ 后 2 个维度必须 AI 拍板
```

→ **peaks-cli 的 user 模型核心假设 = "业务 + 产品 + (擅长的)技术 资深"**,不是"全栈资深"。

## 2. 反伪选择机制(核心原则)

### 2.1 什么叫"反伪选择"

- 让 user 选"用什么库 / 框架 / 语言" → user 选 AI 推荐 = 错
- **根源:** AI 推库基于"通用技术评价"(stars、活跃度、社区、benchmark),**user 真实诉求**是"这个具体业务的预期实现效果"
- **AI 推的 ≠ 业务预期,因为出发点不同**

### 2.2 正解

- **prd 阶段强问"业务场景"** → AI 据此选库 / 选架构
- **技术类 gate 全部走 full-auto default,user 不参与**
- 唯一例外 = 业务/产品类 gate 才让 user 审

### 2.3 为什么不能用 "AI 推荐 + user 确认"

- user 没能力判断"AI 推荐 A 还是 B"对业务预期的影响
- 让 user 选 = 让非专家决策 = 等于 AI 选
- user 唯一能 override 技术的时机 = **prd 阶段写"业务场景"时**

## 3. 14 个 Solo gate 的新分类(必须)

| Gate 类型 | 数量 | 谁决定 | 处理 |
|---|---|---|---|
| 业务 / 产品 gate(必须 user 介入) | 5-6 | user 必审 | ✅ 保留 [CONFIRM] |
| 技术 gate(AI 沉淀 + 子代理自决) | 7-8 | AI 自决,user 不参与 | 🔄 full-auto 默认放过 |
| 不可逆 / 外部 gate | 1-2 | user 必审(commit-boundary) | ✅ 保留硬停 |

→ **核心改动:** 技术类 gate 在 full-auto 模式下不再打扰 user,让 user 只在业务/产品维度被叫醒。

## 4. UI 是"开源装配",不是"原创设计"

- user 不用从 0 画原型 / 选色板 / 写 design token
- 用 shadcn / Ant Design / Material UI / Radix 这类**开源组件库 + 模板** 拼装
- prd 里"UI" 部分 = **页面模式 + 关键交互 + 信息密度**(user 写)
- **视觉由选定的开源组件库 + 模板自动决定**(AI 拍板)
- user 不审:按钮颜色 / 间距 / 字号 / design token / 主题切换
- user 审:装配是否跟产品预期一致 + 异常态语调

## 5. UI 选型决策树(peaks-rd 内置,user 不参与)

| 维度 | 选型 |
|---|---|
| 前端框架 | React(生态 + 团队) |
| 组件库 | shadcn(可控 + 现代 + React) |
| CSS | Tailwind(shadcn 配套) |
| 图标 | lucide(shadcn 配套) |
| 表单 | react-hook-form + zod |
| 表格 | TanStack Table |
| 大列表 | tanstack-virtual |
| 日期 | react-day-picker |
| 图表 | echarts(国内 + 功能够) |
| 富文本 | tiptap |
| 拖拽 | dnd-kit |
| 后端 ORM | Node → Prisma;Go → GORM;Python → SQLAlchemy |
| 鉴权 | Auth.js / Passport / Casbin |
| 多租户 | row-level 隔离(成本 + 维护性平衡) |
| 沙箱 | wasm(启动快 + 隔离) |
| 缓存 | Redis |
| 文档 | OpenAPI 自动生成 |

## 6. 反例(不要再这样描述)

- × "让 user 选 React 还是 Vue"
- × "让 user 选 PG 还是 MySQL"
- × "让 user 决定 JWT 还是 session"
- × "让 user 评审技术方案"
- × "user 写 ASCII UI 视觉稿"
- × "user 决定按钮颜色 / 间距"

## 7. 关联

- [[peaks-cli-24h-ai-programmer-positioning]]
- [[peaks-cli-prd-template-design]] — 业务场景块的设计
- [[peaks-cli-slice-review-and-qa-perspective]] — 业务审阅 + QA 业务视角
