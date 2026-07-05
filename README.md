# ⛰️ Peaks Loop

[English](./README-en.md) | **简体中文**

[![npm](https://img.shields.io/npm/v/peaks-loop?style=flat-square&logo=npm)](https://www.npmjs.com/package/peaks-loop)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)
[![stars](https://img.shields.io/github/stars/SquabbyZ/peaks-loop?style=flat-square&logo=github)](https://github.com/SquabbyZ/peaks-loop/stargazers)

给 AI 编程助手装一套工程门禁 + 编排,让它像资深工程师一样跑流程,不再每次从零猜。

## 它是什么

peaks-loop 是装在 Claude Code / Codex / Copilot / 任意 AI CLI 里的一套工作流技能。它把你 24 小时的工程流程(需求 → 实现 → 审计 → 测试 → 发布)拆成 11 个 LLM 角色技能,让 AI 严格按你定的门禁走,不偷懒、不跳过、不乱猜。

## 一句安装

```bash
npx peaks-loop install
```

打开你的 AI CLI,在聊天里说 **"用 peaks 帮我跑一遍"**,完事。

## 一个例子

你说:**"我想加一个用户登录功能"**

peaks-loop 自己跑:

1. **peaks-code** 接管编排 → 读你项目 → 出 PRD
2. **peaks-prd** 出产品需求(可读出来给你确认)
3. **peaks-rd** 出实现方案 + 跑 4 个独立审计(代码 / 安全 / 性能 / QA)
4. **peaks-qa** 跑测试 + 回归
5. **peaks-ui** 做界面原型(如果涉及 UI)
6. **peaks-sc** 出 commit + PR 描述
7. **peaks-txt** 沉淀上下文给下次复用

中间任何一步不通过,自动停。**你只负责说话和拍板。**

## 你能问它的命令

| 你说 | 它做什么 |
|---|---|
| "用 peaks 帮我跑这个需求" | 走完整流程 |
| "现在到哪了" | 查 session 状态 |
| "继续做完刚才没做完的" | 从 checkpoint 恢复 |
| "把今天学到的沉淀下来" | 写进项目 memory |

## 跟其他 AI 编排工具有啥不同

- **跑得动**:不是 prompt 模板,是真代码,有单元测试,有审计门禁
- **跨 IDE**:Claude Code / Codex / Copilot 同一个 `peaks` CLI
- **能复用**:跑过一次的流程,下次自动记住,不再重复猜

## 想深入

- 全部技能清单 → [`skills/`](./skills/)
- 命令参考 → 跑 `peaks --help`
- 设计文档 → [`docs/superpowers/specs/`](./docs/superpowers/specs/)
- 协议与白皮书 → [`docs/`](./docs/)
- 更新日志 → [`CHANGELOG.md`](./CHANGELOG.md)
- 提问 / 反馈 → [GitHub Issues](https://github.com/SquabbyZ/peaks-loop/issues)

---

MIT License · Made by [SquabbyZ](https://github.com/SquabbyZ)