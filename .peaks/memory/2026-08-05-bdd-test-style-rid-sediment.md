---
name: peaks-loop-2026-08-05-bdd-test-style-rid-sediment
description: rid-2026-08-05-bdd-test-style sediment — peaks-loop 单测 given-when-then 化全量 ship + 下游 LLM 强约束 + BDD reporter ship
metadata:
  type: project
---

# rid-2026-08-05-bdd-test-style sediment

## Why
peaks-loop 当前 ~49 个 unit test 文件(不是 ~250,我估算错误),AAA 风格纯结构不表达业务。本 rid 把所有现有 test 改造到 given-when-then 格式(类型 C:it 描述 + 函数体注释),让 LLM 写测试时强制表达业务上下文/用户动作/可观察结果。同时给 LLM(不是 human)写测试时加硬约束,human 不被约束(Human-NL-Choice-Only 红线保护)。

## How to apply
未来 session 写新 unit test 时,LLM 必须遵守:

1. `it()` / `test()` 第一个 string argument 含 `when` 或 `should`(regex `/(\bwhen\b|\bshould\b)/`)
2. 函数体顶部 3 行注释:`// given:` / `// when:` / `// then:`
3. 不用 `// arrange:` / `// act:` / `// assert:` AAA 标记

peaks-qa 在 verification 阶段跑 `bdd-test-style-verifier` 验证 git diff 中新加/修改的 test 文件。**只有 LLM 跑的 peaks-qa 流程触发了该验证** — human 不通过 peaks-qa,自动不受约束。

下游项目 opt-in 接入:读 `docs/test-style-contract.md`(peaks-loop npm 包 `files` 数组已含此 doc)。

## 5 slice 落地

| slice | 内容 | commits |
|---|---|---|
| A | migrator 工具 + 试点 8 文件 + 5 round-trip cases | 5af73566 |
| B | bdd-test-style-verifier + 17 unit cases | 018159d1 |
| C | dispatch prompts + BDD reporter + test-style-contract docs | f96a9879 / 5a3c8934 / 13504c84 / e4ca483f |
| D | 全量 ~38 文件迁移(11 commits,每上层目录 1 commit,12 个文件已是 BDD 跳过) | cd407f77 ~ 4dcf6107 |
| E | 验证 + 本 sediment | (本 commit) |

**总计**:19 commits,所有 SquabbyZ sole-author,无 Co-Authored-By trailer。

## 关键决策点
1. **试点优先**(Slice A 8 文件验证 migrator 可靠,再推 Slice D 全量)
2. **Slice B 改设计**:原 PostToolUse hook 不可行(callerId 来自 `process.env.CLAUDE_CODE_SESSION_ID`,LLM/human 无法区分),改为 peaks-qa 验证阶段跑 verifier
3. **package.json#exports 不加**:避免破坏现有 npm contract(peaks-loop 没 `exports` 字段,加任何 exports 让所有现有 subpath invisible — breaking change)。改用 `files` 数组加 `docs/test-style-contract.md`
4. **Reporter flag 启用**:用户选 flag(默认 reporter 不变)
5. **Hook 误报 block 拒绝**(用户选)

## 关键经验
- **CLI drift 撞到 2 个**:`peaks code detect-job / context-now` 必填字段
- **presence 收尾后必须 re-set**:presence:clear 后 detect-job 报 NO_ACTIVE_SESSION,新 rid 启动前需要 `peaks skill presence:set peaks-code`
- **outerSessionMismatch 在 presence:set 后报**:context compact 切换会话 ID 后,callerId 链 mismatch 但可继续工作
- **callerId 不可区分 LLM/human**:这是 peaks-loop v2.15.0 的本质限制,任何 LLM-only 约束都不能依赖 callerId,只能走 LLM 跑的验证阶段

## 未来 rid 候选
1. **lint 增量 BDD check**:CLI `peaks test --bdd-style-strict` flag,LLM 必须加,human 不强制
2. **OpenSpec BDD format**:openspec change pack 也用 BDD 格式描述 acceptance criteria
3. **e2e test BDD 化**(本 rid 只动 unit test,e2e 是 future rid)

## 红线守住
- SquabbyZ sole-author(全部 19 commit)
- 0 个 Co-Authored-By: Claude/Anthropic trailer
- vitest 4.1.10 frozen 不动
- 0 publish, 0 npm push
- Human-NL-Choice-Only(只约束 LLM,human 不被强制)

---

**作者**:SquabbyZ (LLM-assisted; sole-author flow)
**关联会话**:2026-08-04-session-3fe1be