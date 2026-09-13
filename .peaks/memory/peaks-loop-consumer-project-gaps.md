---
name: peaks-loop-consumer-project-gaps
description: 让 peaks 在别人的项目里工作——三个消费者项目缺陷的现状（2026-09-11）
metadata:
  type: project
  node_type: memory
  originSessionId: 29601951-8e04-4525-8107-125180abe7b4
  modified: 2026-09-11T14:06:19.667Z
---

用户在 **Mac 的消费者项目**里报告了三个问题。它们属于同一主题：peaks-loop 在自己的仓库里
能跑，在别人的项目里不能。

| # | 现象 | 状态（2026-09-11） |
|---|---|---|
| 1 | 状态头不显示 | **已修** — 指导只存在于 peaks-loop 自己的 `CLAUDE.md` + `.claude/output-styles/`，这二者不随技能发货；且 22 个技能只有 10 个有 presence 段、`peaks-code` 自己都没有。已把 header 指导放进 22 个 SKILL.md 的 hygiene 块 |
| 2 | Fact-Force Gate 卡主会话 | **已修**（`de407ab3`）— `7aa74168` 的 read-first 指导只注入了 `buildDispatchSystemPrompt`（子代理），主会话从未收到。已并入 22 个技能的 hygiene 块 |
| 3 | `peaks dispatch` 必填 `--graph-node` | **已修**（`6f0b6844`，用户选的 a+b）— 改成可选 + 按需 provision。查证后发现**这条友好提示指向的路径本身走不通**：`workflow node prepare` 从不 `writeGraph`（打印一个节点就丢），而它要求的图没有任何命令会创建。且 `graphNodeId`/`workflowId`/`graphRef` **从未传给 `writeInitialDispatchRecord`** —— 记录上恒为 null，特性整条链是死的，只有前置条件是真的 |

**同一根因（#2 与 auto-compact 从未触发）：** 给一条"非交互调用方（hook / 普通项目）
必须能跑"的命令挂 `.requiredOption`，产生的报错看起来像"用户用错了"。
`AUTO_COMPACT_HOOK_COMMAND` 漏了 `--project .`，导致 hook 每次 Bash/Task 调用都静默失败
——已在 `48b1c675` 修复，`3f17fadf` 让修复能到达已有安装。

**另修（`4540626c`，模板治理）：** `.peaks/.claude-settings-template.json` 机器相关、每次 init
重写，却被 git 跟踪 —— 于是每次发版都显示为 modified，被当"机器路径泄漏"回滚 3 次。
**真相是：那条本应忽略它的 managed gitignore 规则，在任何项目里都从没生效过。**
`upsertPeaksGitignoreSnippet` 把 snippet 写进 `.peaks/.gitignore`，而模式是按**项目根**写的；
带 `/` 的 gitignore 模式锚定到所在目录，于是解析成 `.peaks/.peaks/...`，匹配不到任何东西。
根级的 `.claude/settings.local.json` 更是**根本无法**从 `.peaks/` 内部表达（gitignore 没有 `..`）。
已改为写进根 `.gitignore`，并加了行为式守卫（逐条模式用 `git check-ignore --no-index` 验证生效，
已证明对旧行为会失败）。**教训：断言模式的字符串抓不到这个 —— 要断言模式的<效果>。**

**后续（`a2976681`）：搬家会留下僵尸块。** 所有已初始化项目在 `.peaks/.gitignore` 里留着一个
**既失效又无人维护、却仍自称 "do not edit by hand" 的块** —— 那比没有更糟，读的人会当成活配置。
`upsertPeaksGitignoreSnippet` 现在先把它剥掉（保留用户自己写的每一行，只有块内为空才删文件，
header 无 footer 的畸形块**不动**——为了收拾自己的烂摊子去删用户的文件不划算）。
本仓库那个文件正好只有这个块，已删除。

## 查过、无 bug（2026-09-11）

曾记过一条"`peaks session checkpoint/resume` 的 `--project` 默认值是机器绝对路径，同类问题未查"
——**这条是错的，撤回。** 实查：

- 默认值是 **`process.cwd()`**（`session-24h-mode.ts:98` 等 8 处），**不是硬编码**；探针里看到的
  `D:\peaks-loop` 只是"探针当时在哪个目录跑"。
- 也**不是**被 commander 默认值顶掉 git-root 回退的那一类：handler 都写
  `resolveCanonicalProjectRoot(opts.project ?? process.cwd())`（`session-24h-mode.ts:85`、
  `session-checkpoint-command.ts:62`、`session-resume-command.ts:35`），**git-root 提升在下游照常发生**。

唯一可说的：那个 commander 默认值**与 handler 里的 `?? process.cwd()` 冗余**，无害，但形状正是
`--mode` 那次真出事的形状（见 [[commander-defaults-defeat-fallbacks]]）。**没有改** —— 它没坏。

相关：[[per-turn-obligations-belong-in-per-turn-output]]
