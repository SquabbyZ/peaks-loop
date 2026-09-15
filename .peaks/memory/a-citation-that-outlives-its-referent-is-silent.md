---
name: a-citation-that-outlives-its-referent-is-silent
description: 被引用者消失时没有任何机制报警，于是文档可以无限期地宣称一个不存在的守卫"会 fail 掉整个套件"
metadata:
  type: lesson
  node_type: memory
  originSessionId: 41d14175-50f5-4352-bac1-bc0b4656940d
  modified: 2026-09-15T13:45:00.000Z
---

**"验证的输入来自被验证者自己" 有两种形态。第一种（自证）已经被记过很多次；第二种是"来自一份不会再被核对的静态清单"—— 这一条在本仓没有专门记录，而它同样致命。**

被引用者消失时，**没有任何机制报警**。于是引用可以无限期地悬空，且悬空的引用读起来与有效的引用完全一样。

2026-09-15 实测的四处，全部在"每个 session 必读"的文档里：

| 引用处 | 被引用者 | 结局 |
|---|---|---|
| `CLAUDE.md:34` "will fail the suite" | `tests/unit/workspace/top-level-change-id-guard.test.ts` | 死于 `457b9a87`（2026-06-29）|
| `.peaks/standards/loop-engineering-guidelines.md:25` "exercised by" | `tests/unit/standards/loop-engineering-guidelines.test.ts` | 死于 `f17aa377`（2026-07-30）|
| 定位记忆的 frontmatter `spec_ref` | `docs/superpowers/specs/2026-07-07-…-crystallization-design.md` | 不存在，且 `docs/adr/` 整个目录都不存在 |
| `hooks-commands.ts:76-77` 注释 "NOT a hardcoded expected list" | 实为 `:81-84` 的手写字面量 | 注释描述的不是代码在做的事 |

**触发条件很具体：一次大规模删除。** `f17aa377` 单次提交删除 **568 文件 / 108,205 行 / 559 个测试文件**（含 `tests/vitest.setup.ts`）。这次重置遗留的引用至今未清 —— `stryker.vitest.config.mjs` 至今指向那两个已删路径，**变异测试按当前配置跑不起来**。

**Why:** 悬空的引用比没有引用更糟 —— 它提供了**已完成的感觉**。`CLAUDE.md:34` 不只是没提这件事，它明确承诺"四层防护"并点名了第 2 层；读者会因此不去建那一层。而 `peaks standards lint --category loop-engineering`（文档声称的执行动词）**在 CLI 里根本没有注册**，整套 RL-0..RL-9 撰写契约在运行时不存在。

**How to apply:** ① 大规模删除后，**把"清扫悬空引用"当成该次提交的一部分**，不是后续事项。② 任何"由 X 守护"的断言，在被引用前先 `ls` 一次 X。③ 区别标注"我跑过它"与"文档说它存在" —— 本次审计里我用 `[实测]` / `[转述]` 分开标，这个区分应当成为默认。参见 [[verify-a-memory-entry-s-premise-before-relaying-it-as-an-open-item]]、[[a-right-conclusion-resting-on-evidence-nobody-can-reproduce]]。
