---
name: peaks-cli-24h-ai-programmer-positioning
description: peaks-cli 的产品定位速记 — 全栈 AI Coding 工具,24h 程序员场景,效率第一,full-auto + 唯一蜂群 + 退化兜底
metadata:
  type: project
  createdAt: 2026-06-28
---

# peaks-cli 24h AI 程序员定位

> 适用: 当 LLM 在解释 Solo 编排 / 退化路径 / mode 选择时,避免误读为"通用 AI 工具"或"前端代码工具"。

## 1. 核心定位

**peaks-cli = 24h 不停产的 AI 程序员编排器**,服务于"业务资深 + 技术半盲 + 极致工期 + 前后端全栈"的工程师。

**真实形态:** "双轨 + 分层并行 + 快速迭代 24h AI 程序员"
- 双轨: 业务线 + 上游同步线
- 分层并行: 大需求基础先行 + 业务并行
- 快速迭代: 2 天 1 版,带发现-反馈-修复闭环

**用户角色:** 业务/产品审阅者,不是技术决策者。

## 2. 6 个硬约束(必须按此理解)

| # | 约束 |
|---|---|
| C1 | B 端 / 复杂度高 / 性能边界窄(内存爆炸、闭包不清理、大列表渲染、接口超时、异步锁不稳、高并发被压、表结构不合理影响后续) |
| C2 | 团队里有初级工程师,领导误以为"有 AI = 初级能做复杂" |
| C3 | 24h AI 程序员场景 + 多业务并行,人歇 AI 不歇,**小步快跑每 slice 必介入** |
| C4 | 人力压缩,工作量倍增,AI 效果因人而异 → 工具要把"深度使用 AI 经验 + 业内成熟库 / skill"沉淀为 SOP |
| C5 | 节省时间用于思考 + 创新 + 业务理解(因为一次做成不可能) |
| C6 | 需求输入极粗(产品只给大纲,边界 / UI / 数据结构没想清楚),后端只给 txt 接口,工期极致压缩 |

## 3. 关键叙事(避免误读)

### 3.1 "效率第一" = `90% 效率 + 80% 质量` > `80% 效率 + 90% 质量`

- 在 24h 窗口里:`1 切片省 1h × 9 切片 = 9h ROI`,质量溢出 = 0(8/10 已够用)
- **质量杠杆前置到 prd 阶段**(脑暴时只花 1-2h,user 写业务场景块)
- **执行层不堆质量**,只换效率

### 3.2 "唯一蜂群模式" = 不区分 type

- 历史遗留 6 种 type(feature/refactor/bugfix/config/docs/chore),AI Coding 实际场景下 user 提的几乎都是 feature/bugfix
- 主路径 = feature/bugfix → 必有 rd-planning + qa-test-cases 蜂群
- config/docs/chore 跳过蜂群是单步完成,不打断主流程
- **assisted/strict 在 24h 场景下是反模式**(user 不在循环里,门门问等于逼 user 起来点确认)

### 3.3 退化兜底 = 真实代价只是墙钟 2-3x,无质量漏防

- 退化串行 ≠ "RD 看不到 UI 稿" (prd 已有 ASCII / 装配意图)
- 退化串行 ≠ "QA 测例缺失让 RD 写漏 AC" (prd 已含 AC)
- 退化串行真实代价 = 墙钟 max→sum,无二阶质量漏防
- "preferences.fanout.defaultMode='serial'" 逃生通道在 2.8.4 被砍 — 宁可退化也不允许静默 serial

### 3.4 user 介入时机 = 启动 + 终审两端

```
user 在循环里干什么?
  0. 提需求
  1. 等 prd 出来,瞄一眼
  2. 让 AI 跑
  3. 跑完看产物,有问题再说

user 在循环里不干什么?
  × 决定"现在 RD 写,还是 QA 先"
  × 决定"先 UI 还是先 RD"
  × 决定"串行还是并行"
  × 看每步 gate 决定是否继续
  × 决定是否跳过某步
```

## 4. 反例(不要再这样描述)

- × "退化串行会让 RD 看不到 UI 稿就写代码"
- × "QA 测例缺失会让 RD 写漏 AC"
- × "全栈中前后端分开规划是 peaks-cli 的卖点"
- × "type 区分是核心模式选择"
- × "peaks-cli 是只写前端代码的工具"
- × "质量优先于效率"
- × "user 是流程编排者"

## 5. 关联

- [[peaks-cli-user-role-and-tech-decision]] — user 角色 + 反伪选择
- [[peaks-cli-prd-template-design]] — prd 模板设计
- [[peaks-cli-slice-review-and-qa-perspective]] — slice 审阅 + QA 视角
- [[peaks-cli-fork-sync-and-layered-parallel]] — 上游同步 + 分层并行
- [[peaks-cli-fast-iteration-quality-loop]] — 快速迭代闭环
