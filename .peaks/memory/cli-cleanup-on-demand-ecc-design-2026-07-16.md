---
name: cli-cleanup-on-demand-ecc-design-2026-07-16
description: Peaks-Loop 4.0.0-beta.10 cli-surface-cleanup-and-on-demand-ecc 切片设计 sediment,含 affaan-m/ECC 真实结构校验和 5 个 QA blocker
metadata:
  type: project
  rid: 2026-07-15-cli-surface-cleanup
  sliceCount: 3
  acCount: 24
---

# CLI surface cleanup + on-demand ECC — design sediment

**日期:** 2026-07-16
**rid:** `2026-07-15-cli-surface-cleanup`
**sessionId:** `2026-07-15-session-87a173`
**targetRelease:** `4.0.0-beta.10`
**流水线状态:** ✅ `peaks workflow verify-pipeline` complete,9/9 gates pass

## 设计意图

3-slice cleanup:

1. **Slice 1 — del-minimax-worker**:全删 `peaks minimax-worker`、`peaks worker minimax`、`peaks config provider minimax *` 整条链 + 历史引用清理。纯删,7 个 AC。

2. **Slice 2 — hide-role-skills**:9→14→10 个(grep 实际)role-skill CLI 入口用 `Commander.hidden()` 隐藏 + 8 个 SKILL.md 加 `visibility: internal` frontmatter + `--include-internal` 兜底。8 个 AC。

3. **Slice 3 — `peaks ecc install|status|ls|show`**(2026-07-16 redesign):peaks-loop 在 ECC 缺失时从 GitHub release 拉 tarball 到 `~/.peaks/cache/ecc-<sha>/`,**只读 agents/**,7 天 TTL。**没有 `peaks agent run` CLI,没有 subprocess**。LLM 自己读 `agents/*.md`。11 个 AC。

**合并顺序 1 → 2 → 3**(不是并行)。Slice 3 flip `peaks agent` 默认行为,必须等 Slice 2 先 hide `peaks agent`,否则用户会看到一个 "不存在于 --help 里却有了新行为" 的命令。**Why:** user 不应见到未公开的命令,这是 peaks-loop "enhancement not new CLI" 原则的边界。

## 关键事实纠正 (proved during pipeline)

### 事实 1:affaan-m/everything-claude-code **不是 npm 包**

`npx ecc --version` 在裸机上 timeout 60 秒后失败。peaks-loop v4.0.0-beta.9 的代码里把 `npx ecc --version` 当成 fast-path 探测是**假的** —— 它从来没工作过。

**How to apply:** 不要在 LLM 推荐里写 "fast-path 保留" 类似的表述。要从代码审计 + 真实运行两条路验证 fast-path 真的存在。

### 事实 2:affaan-m/agentshield **也不是 npm 包**

`src/services/audit/static-service.ts:103-104` 有第二个 dead-probe `npx ecc-agentshield --version`。RD handoff 漏了,QA 抓到。

**How to apply:** 任何 `npx <name> --version` 模式都要先验证 `<name>` 是否真的在 npm registry 上发布。affaan-m 系列普遍不在 npm。

### 事实 3 (REVISED 2026-07-16, Gate S3-0 解决):affaan-m/ECC 没有 `ecc` 二进制

RD agent 在 Slice 3 final pass 触发 Gate S3-0:affaan-m/everything-claude-code 仓库**没有** `ecc` 二进制;它的真实结构是 `agents/*.md` 平铺目录 + SKILL.md 描述。peaks-loop 假设的 `ecc agent run <name> --json` 子命令契约在现实中不存在。

**用户拍板 (2026-07-16):Option B 全范围 —— peaks-loop 不提供 `peaks agent run` CLI,只下载 + cache;LLM 自己读 `agents/*.md`(Skill-first 路径)。**

新 Slice 3 设计:

| 删除 | 新增 |
|---|---|
| `src/cli/commands/agent-commands.ts`(整个文件) | `src/services/agent/ecc-cache-service.ts`(download + cache) |
| `src/services/agent/ecc-agent-service.ts`(spawn 编排) | `src/cli/commands/ecc-commands.ts`(4 个子命令) |
| `tests/unit/services/agent/ecc-agent-service.test.ts` | `tests/unit/agent/ecc-cache-service.test.ts` |
| `peaks agent run <name>` CLI | `peaks ecc install` |
| `peaks agent list` CLI | `peaks ecc status` |
| `peaks agent run --no-ecc-fetch` 兜底 | `peaks ecc ls` |
| `peaks agent list --source all` 默认 | `peaks ecc show <name>` |

**净效果**:
- 0 subprocess attack surface
- 0 npm registry 依赖(affaan-m/ECC 不在 npm)
- 0 spawn 性能开销(纯 read 操作)
- LLM 通过 `peaks ecc show <name>` 或直接读 `<cache>/agents/<name>.md` 消费 ECC 内容

**How to apply:**
- 在 PRD 里写外部依赖的子命令契约前,**必须**先验证那个子命令在依赖里真的存在
- 如果外部仓库没有 CLI,peaks-loop 不应该假装它有 —— peaks-loop 应该 cache + 暴露内容,LLM 自己消费
- "Enhancement, not new AI CLI" 原则要求 peaks-loop 不 spawn 外部进程
- Skill-first 路径:`peaks <verb>` 是辅助,LLM 才是主路径

### 事实 4:真实隐藏入口是 **10 unique top-level**(不是 9 也不是 14)

PRD v1 估 9(估少了),RD 估 14(估多了),QA grep 全部 `program.command(...)` 调用点给出 **10 unique**:`prd` / `qa` / `sc` / `audit` / `code-review` / `perf-audit` / `security-audit` / `upgrade` / `agent` / `code`。

`rd` / `ui` / `txt` 没有 `program.command(...)` 注册(只在内部 sub-agent dispatch 路径用),`prepare-final-review` 是唯一注册名(不是 `final-review`)。

**How to apply:** 估算 CLI 数量时,不要从 SKILL.md 数量推断;要从 `program.command(...)` 调用点 grep。

### 事实 5:`'minimax-2.7'` 字面量替换

`workflow-router-service.ts:296` 和 `rd-service.ts:25` 用 `'minimax-2.7'` 作为 fallback model-id。删 MiniMax provider 时**必须**同时把这个字面量替换为 `'claude-opus-4-7'`,否则 swarm 跑不起来。

**How to apply:** 删除 vendor 提供商时,**先 grep 字面量**(`grep -rn "<vendor-name>" src/ tests/`)。如果有 fallback 字面量,要列入 touchlist。

## Schema 流程笔记

verify-pipeline 要求 9 个 schema artifact(在 `.peaks/_runtime/<sid>/` 下):

- `rd/tech-doc.md`
- `rd/code-review.md`(要 `## Findings` + `CRITICAL` section 标记)
- `rd/security-review.md`
- `rd/karpathy-review.md`(要 `## Karpathy-Gate` header + 4 guideline heading)
- `qa/test-cases/<rid>.md`(要 `## Test cases` heading + `test(` literal)
- `qa/test-reports/<rid>.md`(要 `## Test execution` heading)
- `qa/security-findings-<rid>.md`(要 `## Verdict` 或 `## Findings` heading)
- `qa/performance-findings-<rid>.md`(要 `## Baseline` 或 `## Results` 或 `N/A` heading)
- `prd/handoff.md`(要 `sha256:` literal)

state machine 顺序:

```
rd:qa-handoff (需要以上 9 个 artifact 全部就位)
  ↓
qa:verdict-issued (需要 qa/.initiated marker + 4 个 qa artifact)
```

**How to apply:** 写 schema artifact 时,section marker 必须**精确匹配**(比如 `## Test cases` 不是 `## Slice 1 test cases`),否则 transition fail。

## 相关记忆

- [[cli-cleanup-on-demand-ecc-2026-07-15]]: 本次 pre-implementation 设计合同 (PRD v2)
- [[peaks-loop-24h-ai-programmer-positioning]]: user 角色 = 业务/产品审阅者
- [[human-nl-choice-only-tenet]]: 不写 CLI 动词

## 风险与未决问题

1. ~~**Gate S3-0** —— affaan-m/ECC 缺 `ecc agent run` CLI。~~ **RESOLVED 2026-07-16** —— peaks-loop 不再尝试 spawn,改成下载 + cache + LLM 自己读。
2. **`peaks ecc install` 真实性能** —— 第一次下载延迟 3-35s。Mitigated by 7-day TTL + `peaks ecc status|ls|show` 离线工作。
3. **cache 目录权限** —— Unix `chmod 0700`;Windows ACL。RD plan 没写细节,implementation phase 要补。
4. **LLM context budget** —— `peaks ecc show <name>` 一次性把整个 SKILL.md 灌给 LLM。如果某个 agent 的 SKILL.md 很大,可能爆 context。Mitigation:LLM 自己只 `Read` 需要的章节,不要整个吞下。
5. **affaan-m/ECC agents/*.md 格式** —— 假设有 YAML frontmatter。如果某天上游改成纯 markdown,`listCachedAgents` 要 fallback 到文件名(已在 RD §4.5 R10 标注)。
6. **`peaks sub-agent dispatch --role agent` 路径** —— Slice 2 把 `peaks agent` hide 后,sub-agent dispatch 仍然能调它(因为 hidden ≠ removed)。需要在 SKILL.md / runbook 文档化这条路径仍是合法入口。

## 实现 phase checklist(交给 user)

- [ ] Slice 1:按 `rd/requests/2026-07-15-cli-surface-cleanup.md` §1 touchlist 删 6 文件 + 改 21 文件 + 改 8 test 文件
- [ ] Slice 1:替换 `'minimax-2.7'` → `'claude-opus-4-7'` 在 5 个文件里
- [ ] Slice 2:10 个 CLI 文件加 `.hidden()`(按 PRD v2 表)
- [ ] Slice 2:8 个 SKILL.md 加 `visibility: internal`
- [ ] Slice 2:重写 `tests/integration/skill-search-cli.test.ts:72-79` 用新 frontmatter 字段
- [ ] Slice 3:删 `agent-commands.ts` + `ecc-agent-service.ts` + 1 test 文件
- [ ] Slice 3:建 `ecc-cache-service.ts`(5 函数:downloadToCache / readCacheManifest / listCachedAgents / readAgentSkill / cleanupStaleCache)
- [ ] Slice 3:建 `ecc-commands.ts`(4 子命令:install / status / ls / show)
- [ ] Slice 3:同步删 `static-service.ts:104` 的 `npx ecc-agentshield --version` dead-probe
- [ ] Slice 3:wire `cleanupEccCache` 进 `bootstrapLogger`(program.ts:121,不是 `peaks doctor --cleanup-stale`)
- [ ] Slice 3:**不要**实现 `peaks agent run` / `peaks agent list` —— 这俩命令必须彻底不存在
- [ ] 所有 Slice:`pnpm test:full`(不是 `:unit`)通过
- [ ] 所有 Slice:27 个 AC 手动验证(原 24 + AC3.10 + AC3.11)
- [ ] publish 4.0.0-beta.10