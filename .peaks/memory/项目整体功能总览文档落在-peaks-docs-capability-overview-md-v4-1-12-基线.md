---
name: 项目整体功能总览文档落在-peaks-docs-capability-overview-md-v4-1-12-基线
description: 项目整体功能总览文档落在 .peaks/docs/capability-overview.md（v4.1.12 基线）
metadata:
  type: project
  sourceArtifact: .peaks/_runtime/2026-10-20-session-f7f45b/txt/handoff.md
---

**位置**：`.peaks/docs/capability-overview.md`（项目级、git 跟踪，与 `backlog.md` 同级）。

**基线数字**（v4.1.12，2026-10-20 实测，后续版本改文档前先复算）：

| 项 | 值 | 复算命令 |
|---|---|---|
| 顶层 CLI 命令 | 124 | `peaks --help` |
| SKILL.md | 23（14 用户层 + 9 角色层） | `ls skills/**/SKILL.md` |
| 服务模块 | 98 | `ls src/services/` |
| src TS 文件 | 1,274 | `find src -name '*.ts'` |
| CLI 命令文件 | 448（递归） | `find src/cli/commands -type f` |
| 测试文件 | unit 541 / integration 96 / e2e 1 | `find tests -name '*.test.ts'` |
| 记忆条目 | 562（336 hot + 226 warm） | `peaks doctor` memory 段 |
| 内置 IDE 适配器 | 9 | `src/services/ide/ide-registry.ts` 的导入数 |
| doctor 检查 | 88 passed / 0 failed | `peaks doctor` |
| codegraph 索引 | 2,175 文件 / 38,984 节点 / 105,341 边 | `peaks codegraph status --project .` |

**为什么它值得留在仓库里**：它把「功能面」和「可复算的数字」绑在一起，所以下一次有人问
「这个项目到底能干什么」时，答案可以指着一个文件，而不是重新读 1,274 个源文件。
**它的价值会随版本漂移** —— 数字会过期，所以 §14 刻意把复算命令一起写进去，让它可被刷新
而不是可被信任。

**用法**：改完任何一项功能面之后，先跑 §14 的复算命令，再更新对应行 —— 不要凭印象改数字。
