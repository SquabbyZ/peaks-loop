---
name: peaks-loop-408-presence-lease-graph-shipped
description: 4.0.8 ship day sediment — 4 件套(presence lease + workflow graph + ack protocol + 24h graph probe)locked + shipped per peaks-code flow
metadata:
  type: project
---

# 4.0.8 ship day — presence-lease + workflow-graph

## 日期
2026-08-03

## 切片 id
001-2026-08-03-presence-lease-graph-design

## Session
2026-08-03-session-bee258 (main, branch: release/4.0.7 → main)

## 4 件套落地
- callerId + workflowId + graphRef 三维度 → 治"Peaks empty" / follow-up 不分 / 多 IDE 并发
- presence lease state machine + session/caller fail-closed binding → 治"delegate clear to last downstream" prose-only trap
- sub-agent graph node binding + heartbeat push + ack protocol → 治"LLM says waiting but didn't dispatch" 24h 偶发
- 24h mode inFlightBatch reads graph (not lease heuristic) → 治 auto-compact 在 ratio 0.85-0.95 区被 LLM 谎言触发

## 用户拍板的 4 决策 + 1 关键语义
1. session binding 强制 + adapter-resolved callerId(2 选 1 vendor-neutral)
2. callerId 通过 adapter,Claude Code → CLAUDE_CODE_SESSION_ID,Trae → TRAE_SESSION_ID 等
3. GC 三层触发:set / init / 手动 CLI
4. workflow 级别隔离(为了切 skill 不打架 + 嵌套可观察 + crash recovery 粒度)
5. graph 维度(workflowId + graphRef → nodes[] + edges[])
6. **D2 语义化:** "24h loop-engineering contract + 30min boundary tolerance" — 24h 不是 magic number,是 peaks-loop "24h AI 编排器"产品定位的具体化

## 12 个 schema design 决策
1. SkillPresenceLease: callerId + workflowId + graphRef + status enum {preparing|running|terminalized|lost}
2. WorkflowGraph: nodes[] + edges[], one terminal-kind node
3. WorkflowGraphNode: kind enum {step|dispatch|terminal}, dependsOn[], dispatchRef?, lastHeartbeat?, ackStatus?
4. 文件布局: `.peaks/_runtime/<sid>/{graphs,leases,presence-index}/`
5. 节点推进协议: prepare → dispatched → running → envelope-received → consumed-by-parent
6. Heartbeat 30s, node stale > 30min 不在 in-flight,> 1h 才走 GC
7. Adapter contract: `resolveCallerId(env?)` 必填,9 个 IDE adapter 全部实现
8. Migration: peaks workspace reconcile idempotent, 1 minor 兼容窗口
9. terminalReason enum: success / aborted / sub-agent-crashed / ttl-expired / outer-session-mismatch / parent-acked-no-envelope / graph-corrupted / unknown
10. terminalize atomic: lease + graph + index + observability event 一起 commit
11. PEAKS_GRAPH_NODE_REQUIRED: dispatch 没 --graph-node 直接拒绝
12. PEAKS_GRAPH_REF_BROKEN: silent catch 吞 graphRef 错误 → 反 fake-green 防御层

## BREAKING(写进 CHANGELOG)
- **B1:** IdeAdapter interface 必填 resolveCallerId(env?) — 4.0.7 自己写 adapter 的下游会编译失败
- **B1:** dispatch record schema v3.2 → v4.0.0,新增 workflowId / graphNodeId / graphRef 字段

## 真假阳性对比(2026-07-31 silent-catch + 2026-07-30 nightshift 系列的反 fake-green 教训)
- impl-002 子代理 self-report: "esmReproDeferTest: shouldCompact=false" — 用的是 vitest mock,**fake-green**
- 我亲自跑 production ESM repro:case1 / case2 / case3 全 shouldCompact=true,**action undefined**
- 这是 2026-07-31 系列教训的经典重现:vitest green ≠ production 正确
- hotfix 子代理修了一个文件 `src/services/code/auto-compact-orchestrator.ts`,问题:`inflightBatch` 参数没传到 decision function + return object 缺 `action` field
- 修复后:case1=defer / case2=auto-compact-now / case3=red-line,production ESM 验证通过

## 文件改动统计
- New files: 8 service + 1 CLI + 1 .changeset = 10
- Modified files: 22 (8 IDE adapter + ide-types + dispatch/heartbeat/sub-agent-shared/workflow-commands/code-runtime/skill-command/init-command + reconcile-service + 9 个 services + 2 docs + CHANGELOG)
- Tests added: 13 QA acceptance gate 文件 + 36 个 TC + 8 个 ESM repro

## 版本锁步
- root: 4.0.8
- peaks-loop-shared: 0.0.38 (CLI_VERSION chicken-egg 闭合)
- peaks-loop-shared-channel: 0.0.17
- peaks-loop-mut: 0.1.13

## 防 future 重蹈覆辙的规则(参考 2026-07-30 nightshift + 2026-07-31 silent-catch 系列)
1. **production ESM repro 是 source-of-truth,vitest green 是必要不充分** — 任何 src/services/** 改动后必须亲自跑 ESM repro
2. **DD semantic 不可变:** GC predicate 永远是 "24h loop-engineering contract + 30min boundary tolerance",不要回退到 magic 24h
3. **dispatch --graph-node 必填** — 反 fake-green + 反 LLM 撒谎
4. **terminalize atomic** — 失败模式注入测试要进 contract test 永久驻留
5. **adapter-resolved callerId** — core services 永远不读 vendor env,grep 审计 `CLAUDE_|TRAE_|CURSOR_|CODEX_|HERMES_|OPENCLAW_` 在 `src/services/skills/` `src/services/workflow/` 必须 0 hits
6. **B1 schema break** 接受但必须 CHANGELOG 大字标

## 发布路径(实际跑通)

- commit `42ba56b5`(初版 release)
- tag `v4.0.8` 推送 → publish run 30793726414 → **failed** at changeset hard gate:
  - 根因:Commander v12 parent API 撞名 — `peaks skill lease` 在 skill-command.ts 被注册两次(impl-002 加的 + 4.0.7 stub),CLI 启动 throw "cannot add command 'lease' as already have command 'lease'"
  - 同时影响:`workflow` parent(workflow-lifecycle-commands.ts)、`graph` parent(workflow graph show|list 链式 + loop-eval-commands.ts 的 graph 冲突)
  - 3 个 sibling bug 一次修齐,共用一个 pattern:复用已有 parent 而不是 `.command('parent child')` 链式隐式创建
- amend commit → `9cc42345`
- tag `v4.0.8` force-repoint 到 `9cc42345`,force-push main + tag
- changeset drain:删 `.changeset/four-oh-eight-presence-lease-graph.md`(publish hard gate 要求)
- publish run **30795515028 → success**
- `npm view peaks-loop dist-tags` → `latest: "4.0.8"` ✓
- `npm view peaks-loop dist-tags.latest` → `4.0.8` ✓
- 4.0.8 tarball: `https://registry.npmjs.org/peaks-loop/-/peaks-loop-4.0.8.tgz`

## 反 fake-green carry-forward(本次 ship 出现的第二个 4.0.8 silent bug)

impl-002 self-report "CLI loads OK" 是基于 vitest mock,真 production 加载 dist/ 时 throw(impl-002 没跑 `node -e "import('./dist/cli/index.js')"` 验证)。这跟之前 24h inflightBatch fake-green 是同一个反模式:**sub-agent self-report + vitest green 都不够,production ESM dist load 是 source-of-truth**。

未来 4.0.9+ 的 release-prep 必须包含的 verify step:
1. `node -e "import('./dist/cli/index.js').then(() => console.log('CLI loads OK'))"` 必须 throw nothing
2. `node ./dist/cli/index.js --help` 必须 exit 0
3. `node ./dist/cli/index.js <main-commands> --help` 每个主命令都要跑一遍
4. production ESM repro for any modified src/services/** file
5. **publish workflow 必须真 success 且 `npm view peaks-loop dist-tags.latest` 真返新版本**(publish.yml 经常 "success" 但 registry 没 write)

## Commander v12 parent API 教训(carry-forward for 4.0.9+)

`.command('parent child')` 在 Commander v12 是 **隐式创建 parent + 注册 child** 的链式 API。每次调用都会创建新 parent。如果同 parent 已经有同名 child → throw "already have command"。

正确写法(参考 loop-eval-commands.ts lines 72-75):复用已有 parent

```typescript
// 错:每次调用都创建新 parent
program.command('workflow init').action(...)
program.command('workflow graph show').action(...)
program.command('workflow graph list').action(...)  // 第二次 workflow → throw

// 对:复用已有 parent
const workflowCmd = program.command('workflow')
workflowCmd.command('init').action(...)
workflowCmd.command('graph').command('show').action(...)
workflowCmd.command('graph').command('list').action(...)  // 复用同一个 graph
```

**audit grep for 4.0.9:** `rg "\\.command\\(['\"][a-z]+ " src/cli/ | rg -v "<单一短命令>"` 应该 0 hits 在 4.0.9+ 新 CLI 文件。


- 4.0.7 → 4.0.8 是 minor bump 含 BREAKING → CHANGELOG 必须显眼,否则下游踩坑
- B1 dispatch record schema v4.0.0 — 任何 read `dispatch-*.json` 文件的代码必须 update 或 verify 兼容
- 升级路径:下游项目升 4.0.8 时,peaks workspace reconcile 第一次跑会自动迁 singleton + per-caller legacy markers → canonical lease/index,期间返回 `legacyPresence: true` 兼容投影
- 兼容窗口:1 minor release(4.0.8 → 下一个 minor 边界),4.1.0 删 legacy reader

## 相关 memory 引用
- [[peaks-loop-publishing-critical-hard-rules]] — 4.0.2 accidental publish 教训
- [[peaks-cli-version-shared-chicken-egg]] — CLI_VERSION chicken-egg
- [[peaks-bump-version-ac7-bypass]] — --to explicit 防 1 minor 短路
- [[peaks-stale-cli-version-2026-07-23-diagnosis]] — 五层根因 + verify 方法
- [[2026-07-31-mac-auto-compact-esm-fake-green-and-fix]] — silent-catch + ESM repro pattern

## 待 carry-forward 风险
- 9 个 IDE adapter 中的 hermes / openclaw / qoder / tongyi-lingma / zcode 是 fail-closed 保留实现,等 vendor 接入 verified 才填真 resolver
- presence-lease-service.ts 的 vendor env 引用是 4.0.7 legacy code(outer-session-mismatch detection),不是 4.0.8 新增,留 future minor 迁
- workspace reconcile 中 `require('node:fs')` 是 pre-existing 4.0.7 代码,留 carry-forward 按 2026-07-31 silent-catch 系列 ESM 迁
