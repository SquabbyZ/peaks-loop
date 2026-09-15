---
name: baseline-guard-audit-fabricates-fifteen-passes
description: 2026-09-15 实测：peaks baseline audit 报 15/15 通过，而 run-guard 只跑了 J01 且其余静默 skipped exit 0 —— RL-10 指定的反漂移机制本身无法失败
metadata:
  type: project
  node_type: memory
  originSessionId: 41d14175-50f5-4352-bac1-bc0b4656940d
  modified: 2026-09-15T13:45:00.000Z
---

**RL-10 亲自指定的能力漂移检测机制，在 2026-09-15 的坐标上是自证的。** 全部经我本人手跑复核：

```
$ node bin/peaks.js baseline audit --json
{"verdict":"consistent","consistencyScore":1,
 "evidence":[{"kind":"guard-run","ref":"capability-guard-runner:15",
              "summary":"15 pass / 0 fail"}],
 "requiresUserDecision":false}

$ node bin/peaks.js baseline run-guard --journey J05 --json
{"ok":true,"data":{"status":"skipped"}}       ← exit 0；跳过与通过不可区分

$ node bin/peaks.js baseline run-guard --json  # 帮助文本称"默认全部 15"
{"journeyId":"J01", ...}                        ← 只跑了 J01
```

机制在源码里：`baseline-commands.ts:79` 是 `opts.journey === 'J01' ? runJ01Contract(ctx) : Promise.resolve({status:'skipped'})`；`:104` 把 `guardSummary` 硬编码为 `{pass:15,fail:0}`；`:106-110` 的 LLM 打桩返回常量 `"consistent"`。

**RL-10 自己的文本把"An LLM audit is allowed to self-pass without independent context"列为它要防的失效模式 —— 那正是它现在的行为。**

同批实测的相邻发现（完整清单见 `docs/diagnosis-2026-09-15-peaks-loop-state.md`）：
- `baseline freeze-update` / `rollback` / `reset` 三个动词**没有可达的成功路径**（无条件 `fail(HUMAN_NL_DECISION_REQUIRED)`，且未注册 `--confirm`），RL-10 承诺的棘轮因此**动不了**
- `runAllGuards`（`capability-guard-runner/runner.ts:15`）**从未被任何非测试文件导入**，生产没有 all-15 通路
- 15 个 guard contract 中 13 个是 `existsSync` + 常见词 substring（J10 断言 `hooks-commands.ts` 含有词 `hook`）
- `assertBaselineRef` 只检查 `baselineRow` / `invariant` 字段为真值，**从不与基线 JSON 比对**，不变量文本在运行时从不被读取

**Why:** 这是"闸门验的是描述产物的话而不是产物本身"（4.0.49 发布说明的自我总结）在**最高杠杆位置**上的活体实例 —— 它不是一个边角 enforcer，是 RL-10 用来发现其他所有漂移的那一个。它的绿意味着**能力漂移在当前状态下不可被发现**。

**How to apply:** 任何声称"独立验证"的能力基线/审计结论，在引用前先跑一次 `run-guard --journey <非 J01>`，看它是否返回 `skipped` 且 exit 0。**`skipped` 与 `pass` 在退出码上不可区分 —— 这个缺陷本身值得单独修。** 参见 [[a-diff-scoped-gate-reporting-zero-violations-may-have-checked-nothing]]、[[a-probe-that-always-says-caught-is-indistinguishable-from-a-working-guard]]。
