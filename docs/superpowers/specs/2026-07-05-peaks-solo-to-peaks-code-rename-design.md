# Peaks-Solo → Peaks-Code Rename + Sub-Skills to General Primitives

**Status:** Draft (post-brainstorming, pre-writing-plans)
**Date:** 2026-07-05
**Author:** SquabbyZ (via peaks-code brainstorm session 2026-07-05)
**Affects:** peaks-code (主技能), peaks-code-resume, peaks-code-status, peaks-code-test, peaks-prd, peaks-rd, peaks-qa, peaks-ui, peaks-sc, peaks-txt (六个 role skill 全部下沉), `.peaks/skills/.system/bees/`, marketplace, hooks, tests, docs, ~110 memory files (历史只读).
**Target version:** 4.1.0 (next minor release after 4.x sediment pool lands). Bundled with whatever the next 4.x minor cycle is — not a standalone hot-fix.

## 0. 硬约束(Hard Constraints — 2026-07-05 user directive)

本 spec 适用以下不可违反的约束(由 user 在本次 brainstorm 末尾追加,优先级等同于 4.x sediment spec 里的所有硬规则):

- **HC-1 一次到位:** 不分批、不灰度、不留半步状态。所有 4 个 skill id 在单一 release 内同步改名;所有 4 个目录在单一 commit 序列里 `git mv`;所有 CLI / marketplace / hooks / docs 在单一 PR 里同步。
- **HC-2 不计成本:** 不为减少工作量而妥协任何决策。例如:不为省事保留 peaks-code 作为 alias、不为省事仅在描述里改字、不为省事把三个 sub-skill 留在 peaks-code 树下。
- **HC-3 不计时间:** 可以拆多个 sub-task 派给多个 sub-agent 并行;每个 sub-agent 完成前不进入下一个 sub-task。
- **HC-4 禁止假绿:** 任何 sub-agent 自报"完成"必须附证据(dogfood 命令实际输出、vitest 实际 pass 数、rg 实际输出)。LLM 不允许"应该是绿了" / "理论上通过" / "skip 了无关的 case"——只允许"跑了 X,绿了 N/N,下面是原始输出"。
- **HC-5 禁止偷懒:** 不允许为了"完成数量"跳过:
  - 历史 `.peaks/memory/` / `.git/sdd/` 例外(明示不动,见 §2.1)
  - 其他任何"看起来可以不动"的位置——一律改,除非本 spec §2.2 明示不动。
- **HC-6 全量回归:** 本次改动后必须跑 `pnpm vitest run`(全量)+ `pnpm run dogfood:sediment`(全链路),**任何**失败都阻塞 PR。LLM 不允许"已知某 case 红,先合并,后续修"。
- **HC-7 子任务并行 + Karpathy:** 若工作分解为 ≥ 2 个独立 sub-agent 任务,使用 `peaks sub-agent dispatch --from-dag <dag-file>`(G12 fan-out);每个 sub-agent prompt 必须包含 4 Karpathy 准则。
- **HC-8 用户不介入技术细节:** 任何 user-facing 消息、PR 描述、commit message 都不要求 user 输入 CLI 字符串 / 手写 JSON / 手填表项。Manual migration(§5.5)是 user 在 brainstorm 中**明确选择**的,且 user 已表态"我直接手动替换应该就行吧",不在 HC-8 违反范围内——但**仅此一处**,其他任何决策点仍然走 AskUserQuestion,绝不要求 user 写代码。

> **⚠️ 反向设计:** 2026-07-04 的 `peaks-maker-dynamic-skill-sediment-design.md` §4.1.1 显式做了"保留 peaks-code"决定(原话:"We honor the user's explicit request: '保留 peaks-code 这个技能'")。本 spec 是对该决定的**主动覆盖**,不是新增。覆盖理由由 user 在 2026-07-05 brainstorm 中给出:**4.x 出版后整个项目不再是局限的代码开发,已经可以扩展到自定义的领域,后续会内置一些想 3.x 版本的 peaks-code 定位一样的 loop engineering,趁现在使用的人只是几个,做一次调整,把 peaks-code 更名为 peaks-code,是这个内置的 loop engineering 的名称和实际的内容及定位更加准确**。

---

## 1. 动机(Motivation)

### 1.1 长痛 vs 短痛

user 在 brainstorm 中明确表态:

> "这是个长痛和短痛的问题。开启 4.x 后整个项目不再是局限的代码开发,已经可以扩展到自定义的领域,后续会内置一些想 3.x 版本的 peaks-code 定位一样的 loop engineering。趁现在使用的人只是几个,做一次调整。"

**短痛(本次承受):** 全量 id 重命名 + 全量测试 + marketplace + hooks + 文档同步。
**长痛(现在不做、未来持续):** peaks-code 这个名字已经**直接误导用户**——它字面上暗示"solo = 单飞、孤立、零依赖",但实际 4.x 后的定位是"code-domain loop engineering orchestrator",与未来多个领域 loop engineering 并列存在。继续用 peaks-code,用户会自然以为"peaks-code 是唯一入口 / 其他领域只能靠 LLM 兜底",这与 4.x 多领域扩展的产品定位冲突。

### 1.2 与 2026-07-04 决定的兼容性

2026-07-04 spec §4.1.1 决定把 peaks-code 保留为 `~/.peaks/skills/.system/bees/peaks-code/` 的 system-stable 路径,**这条路径在本 spec 里继续保留**——只改 skill id 和 display name,不动 pool 物理路径。理由:pool 的 6-table 存储、retention、blob dedup 都已经过 dogfood,变更物理路径需要重新跑一遍回归。user 在 brainstorm 中明确选了"保持原路径不动"。

### 1.3 三个 sub-skill 必须一起处理

`peaks-code-resume` / `peaks-code-status` / `peaks-code-test` 当前**语义上是 peaks-code 的辅助技能**(resume 切片、查 session 状态、跑测试),但**功能上是通用 primitive**——任何 bee 都会有"恢复" / "查状态" / "跑测试"的需求。继续把它们放在 peaks-code 名下会:

1. 误导用户以为"它们只服务于 peaks-code";
2. 让未来新增的 bee 必须复制这三个技能,违反 DRY;
3. 模糊 "orchestrator(主技能) vs primitive(基础设施)" 的层次。

本次 spec 一并下沉并改名为通用 primitive:`peaks-code-resume → peaks-resume`、`peaks-code-status → peaks-status`、`peaks-code-test → peaks-test`。

### 1.4 六个 role skill 全部下沉到 bee 层(2026-07-05 user 追加)

user 在 spec 复核阶段追加:"**peaks-rd 没必要存在顶层了,bee 层就行**",并明确扩大为 **peaks-prd / peaks-rd / peaks-qa / peaks-ui / peaks-sc / peaks-txt 全部下沉**。

**新分层模型:**

| 层级 | 内容 | 用户可见性 |
|---|---|---|
| 顶层 skill(user-facing slash command) | `peaks-code` / `peaks-resume` / `peaks-status` / `peaks-test` | user 可在 IDE 里 `/<name>` 调起 |
| bee 层(LLM 内部 dispatch) | `peaks-prd` / `peaks-rd` / peaks-qa` / `peaks-ui` / `peaks-sc` / `peaks-txt` | 仅 LLM 通过 `peaks sub-agent dispatch --role <role>` 调用,user 不可直接 slash |

**理由:**

1. **顶层 = 唯一 user 入口**:4.x 后 peaks-code 是 user 唯一编排器;sub-agent 角色是 LLM 的内部协调员,user 不该有权直接 `/peaks-rd` 跳过编排。
2. **避免 user 误用**:slash command `/peaks-rd` 会让 user 误以为"我可以直接让 LLM 写代码",跳过 peaks-code 的 Step 0 锚定 / Step 1 模式选择 / Step 0.6 审计等守卫。
3. **单一编排入口符合 4.x 定位**:peaks-code = code-domain loop engineering orchestrator,**唯一** user-facing 入口;其他都是 orchestrator 的内部角色。

**实现细节(影响 §2.1 / §3.6 / §5.3):**

- marketplace.json 里这六个 skill 条目加 `"userInvocable": false`
- SKILL.md frontmatter 加 `metadata.visibility: internal`(LLM-only)
- 测试里任何 `/peaks-rd` / `/peaks-prd` 等 slash trigger 字符串改为"internal trigger, do not invoke directly"
- 但**物理路径不动**:仍然在 `skills/peaks-{prd,rd,qa,ui,sc,txt}/`,与 .system/bees/ 路径解耦

---

## 2. 范围(Scope)

### 2.1 In-Scope

| 对象 | 改动 |
|---|---|
| `skills/peaks-code/` | 目录改名 `skills/peaks-code/`,`SKILL.md` 的 frontmatter `name: peaks-code` 改为 `name: peaks-code`,`description` 改为 "Code-domain loop engineering orchestrator for the Peaks-Loop skill family…" |
| `skills/peaks-code-resume/` | 目录改名 `skills/peaks-resume/`,`SKILL.md` 的 `name: peaks-code-resume` 改为 `name: peaks-resume`,description 改为通用 resume primitive |
| `skills/peaks-code-status/` | 目录改名 `skills/peaks-status/`,`name` + description 同步改 |
| `skills/peaks-code-test/` | 目录改名 `skills/peaks-test/`,`name` + description 同步改 |
| `~/.peaks/skills/.system/bees/peaks-code/manifest.json` | manifest 的 `id: "peaks-code"` 改为 `id: "peaks-code"`,`displayName` 改为 `Peaks Code`,保留物理路径 `.system/bees/peaks-code/` 不动 |
| `skills/peaks-{prd,rd,qa,ui,sc,txt}/SKILL.md`(六个 role skill) | frontmatter 加 `metadata.visibility: internal`,description 加 "(LLM-only internal role; not user-invocable. Triggered by peaks-code via `peaks sub-agent dispatch --role <role>`.)"。**id 不改,物理路径不动**——只是隐藏 slash command。 |
| `.claude-plugin/marketplace.json` | 所有 `peaks-code*` 条目 id 改名;六个 role skill 条目加 `"userInvocable": false` |
| `.claude/LOGGING.md` | 文中所有 `peaks-code` 字面提及改为 `peaks-code`(代码片段、表格项、配置示例同步) |
| 仓库内所有源代码、测试、文档、scripts | 全量 `peaks-code` 替换为 `peaks-code`,三个子技能全量替换;六个 role skill 的 slash trigger 字符串(`/peaks-rd` 等)从 user-facing 文档里移除或加 "(internal)" 标记 |
| `tests/unit/wrapper-skills.test.ts`、`tests/unit/doctor.test.ts`、`tests/fixtures/skills/pre-slim/peaks-code.SKILL.md` | fixture / 测试名同步;新加 `tests/unit/skills-role-visibility.test.ts`(验证六个 role skill 都有 `visibility: internal`) |
| `.git/sdd/*.md`(历史 brief、report) | **不动**——历史交付物按 SHA 冻结 |
| `.peaks/memory/*.md`(110 个文件) | **不动**——memory 是历史沉淀,描述过去的事实。新记忆会用 peaks-code 这个名字,旧记忆里出现 peaks-code 是合理的"历史快照" |
| Skill presence / CLI 命令(`peaks skill presence:set peaks-code …`) | 所有 CLI 调用者更新 |
| Hooks / settings.local.json 里的 matcher 字符串 | 同步;六个 role skill 不再触发 user-facing hooks |

### 2.2 Out-of-Scope

- **不动 pool 物理路径**:`.system/bees/peaks-code/` 保持(只在 manifest 的 `id` 字段改 display)。
- **不动 bee 内容**:四个技能内部 references / scripts / test-prompts.json / 逻辑代码不重写,只改 id/description/description 里的 self-reference。
- **不动版本号策略**:跟着下一个 4.x minor 出版,不需要单独 bump。
- **不写迁移脚本**:user 在 brainstorm 中明确说"我直接手动替换应该就行吧"。存量 `.peaks/_runtime/**/*.json` 里的 `skill: "peaks-code"` 字段由 user 手动 sed,LLM 这次不提供 `--migrate` 自动命令。
- **不动 OpenSpec change-id**:本 spec 是连续 work,不是新 PRD。
- **存量 `.peaks/_runtime/**/*.json` 的 `skill:` 字段由 LLM 自动迁移**:user 在 brainstorm 末尾明确"5.5 也你来吧",故 §5.5 从 user 手动 sed 改为 LLM 执行的 `peaks session migrate-skill-name` 子命令(单次跑、幂等、dry-run + apply 双模),见 §5.5 重写。

---

## 3. 设计(Design)

### 3.1 Skill 命名矩阵

| 旧名 | 新名 | 角色 |
|---|---|---|
| `peaks-code` | `peaks-code` | code-domain loop engineering orchestrator(主技能) |
| `peaks-code-resume` | `peaks-resume` | universal resume primitive |
| `peaks-code-status` | `peaks-status` | universal status primitive |
| `peaks-code-test` | `peaks-test` | universal test-runner primitive |

### 3.2 Frontmatter 模板

`skills/peaks-code/SKILL.md` 的新 frontmatter(原文示意):

```yaml
---
name: peaks-code
description: Code-domain loop engineering orchestrator for the Peaks-Loop skill family. Use when the user asks Peaks-Loop to handle a code-repo workflow end-to-end (端到端/全流程/需求开发), especially from a product document (PRD/飞书文档/Feishu doc) through implementation and validation. Coordinates peaks-prd, peaks-rd, peaks-ui, peaks-qa, peaks-sc, and peaks-txt while preserving user confirmation gates. Triggers on `/peaks-code`, "peaks code", "全流程开发", "端到端迭代". General primitives (peaks-resume / peaks-status / peaks-test) are sibling skills, not children.
---
```

`skills/peaks-resume/SKILL.md` 的新 frontmatter:

```yaml
---
name: peaks-resume
description: Universal resume primitive for any in-flight Peaks-Loop workflow (orchestrator-agnostic). Detects the current session's deepest completed gate and surfaces a resume option via AskUserQuestion. Use when ANY bee (peaks-code, future peaks-research, future peaks-content, …) needs to recover from /compact or session interruption. Triggers on "/peaks-resume", "continue the unfinished work", "继续完成", "把刚才没做完的收尾". (Replaces peaks-code-resume as a top-level primitive.)
---
```

`peaks-status` / `peaks-test` 模板同理。

### 3.3 Pool manifest 改动

`~/.peaks/skills/.system/bees/peaks-code/manifest.json`(物理路径不变):

```diff
 {
-  "id": "peaks-code",
-  "displayName": "Peaks Solo",
-  "promotionStatus": "system-stable",
-  "description": "Code-domain orchestrator (PRD/bug/coding)",
+  "id": "peaks-code",
+  "displayName": "Peaks Code",
+  "promotionStatus": "system-stable",
+  "description": "Code-domain loop engineering orchestrator (PRD/bug/coding)",
   "segments": [...unchanged...]
 }
```

### 3.4 Skill presence 转换

- `peaks skill presence --json` 输出:`active: true, skill: "peaks-code"`
- `peaks skill presence:set peaks-code --gate startup`(用户后续手动触发)
- 历史 `.peaks/_runtime/active-skill.json`(若存在 `skill: "peaks-code"`)由 user 手动 sed 替换;CLI 本次**不**做自动迁移。

### 3.5 不动 memory / 历史文件

- `.peaks/memory/` 110 个文件:全部不动。理由:memory 是事实快照,2026-07-04 之前的 memory 提到 peaks-code 是历史事实;2026-07-04 之后的新 memory 自然会用 peaks-code。一致性由"日期"维度保证,不是"命名"维度。
- `.git/sdd/*.md`:历史交付物按 commit SHA 冻结,不动。
- `openspec/`(若存在):不动。
- `CHANGELOG.md`:新增一行 `### Renamed` 段落说明。

### 3.6 Trigger 字符串同步

`/peaks-code` → `/peaks-code`(用户从 IDE 调起的 slash command)
所有 SKILL.md 里的 trigger 字符串同步;测试里 hard-coded 的 `/peaks-code` 字符串全替换。

### 3.7 Role skill visibility(2026-07-05 user 追加)

六个 role skill(`peaks-prd` / `peaks-rd` / `peaks-qa` / `peaks-ui` / `peaks-sc` / `peaks-txt`)在 marketplace 里注册但对 user 隐藏:

**marketplace.json schema 扩展(具体实现由 sub-agent 决定):**

```json
{
  "name": "peaks-rd",
  "userInvocable": false,
  "description": "...",
  "source": "./skills/peaks-rd"
}
```

`userInvocable: false` 的 skill:
- 不出现在 IDE 的 slash command 列表
- 不出现在 `/help` 输出
- 但 LLM 仍可通过 `Skill` 工具加载 SKILL.md(作为 reference 文档)
- 仍可通过 `peaks sub-agent dispatch --role rd` 触发 sub-agent 角色

**SKILL.md frontmatter 改动:**

```yaml
---
name: peaks-rd
description: |
  Research and development role for Peaks-Loop. (LLM-only internal role; not
  user-invocable. Triggered by peaks-code via `peaks sub-agent dispatch --role rd`.)
  Use when a workflow needs engineering analysis, refactor planning, project scanning...
---
```

**CLI 子命令 `peaks skill visibility`**(新增):

```bash
peaks skill visibility --list                    # 列出所有 skill 的 userInvocable 状态
peaks skill visibility --name peaks-rd           # 单查
peaks skill visibility --name peaks-rd --json    # JSON 输出
```

返回值:

```json
{
  "ok": true,
  "skills": [
    { "name": "peaks-code",     "userInvocable": true,  "visibility": "public" },
    { "name": "peaks-resume",   "userInvocable": true,  "visibility": "public" },
    { "name": "peaks-status",   "userInvocable": true,  "visibility": "public" },
    { "name": "peaks-test",     "userInvocable": true,  "visibility": "public" },
    { "name": "peaks-prd",      "userInvocable": false, "visibility": "internal" },
    { "name": "peaks-rd",       "userInvocable": false, "visibility": "internal" },
    { "name": "peaks-qa",       "userInvocable": false, "visibility": "internal" },
    { "name": "peaks-ui",       "userInvocable": false, "visibility": "internal" },
    { "name": "peaks-sc",       "userInvocable": false, "visibility": "internal" },
    { "name": "peaks-txt",      "userInvocable": false, "visibility": "internal" }
  ]
}
```

**必写测试 `tests/unit/cli/skill-visibility.test.ts`(≥ 6 个 case):**

1. `--list` 输出含 4 个 public + 6 个 internal
2. `--name peaks-rd` 返回 `userInvocable: false`
3. `--name peaks-code` 返回 `userInvocable: true`
4. 任何 internal skill 在 marketplace.json 里 `userInvocable: false`
5. 任何 public skill 在 marketplace.json 里无 `userInvocable` 字段(默认 true)
6. 加载 schema 失败时报清晰错误

**硬约束:**

- 任何 internal skill 必须能通过 `Skill` 工具加载(SKILL.md 仍对 LLM 可读,只是不能被 user 直接 slash)
- 内部 sub-agent dispatch 的 prompt 必须显式包含"你正在以 peaks-rd 角色执行,不直接对 user 暴露"的前缀

---

## 4. 影响面(Impact Surface)

### 4.1 文件计数估算(基于现有盘点)

| 类别 | 引用数 | 备注 |
|---|---|---|
| `.peaks/memory/*.md` | ~400 行提及 | **不动**——历史快照 |
| `.git/sdd/*.md` | ~80 行 | **不动**——历史交付物 |
| `.peaks/_runtime/**/*.json`(本次会话历史产物) | ~10 个文件 | user 手动 sed |
| `src/services/profiles/profile-service.ts` | 1 处 | 改 id |
| `tests/unit/wrapper-skills.test.ts` | 多处 | 改 fixture 名 + assertion |
| `tests/unit/doctor.test.ts` | 多处 | 改 |
| `tests/fixtures/skills/pre-slim/peaks-code.SKILL.md` | 1 文件 | 改名 + 内部 frontmatter |
| `.claude-plugin/marketplace.json` | 多个条目 | 改 id |
| `.claude/LOGGING.md` | 多处 | 改 |
| `docs/superpowers/specs/2026-07-04-peaks-maker-dynamic-skill-sediment-design.md` | 多处 | 改 §4.1.1 措辞(从 "preserved as alias" 改为 "renamed to peaks-code") |
| `docs/superpowers/plans/2026-07-04-peaks-4x-sediment-pool.md` | 多处 | 改 |
| `scripts/`(若有) | 多处 | 改 |
| `skills/peaks-code*/SKILL.md` | 4 个文件 | 改 frontmatter |
| `skills/peaks-code*/references/*` | 多文件 | 改 self-reference |
| `skills/peaks-code*/test-prompts.json` | 1 文件 | 改 |
| **总计(active work)** | **~1000 处文本替换**(扣除历史不动部分) | |

### 4.2 回归测试必跑

- `pnpm vitest run tests/unit/wrapper-skills.test.ts`
- `pnpm vitest run tests/unit/doctor.test.ts`
- `pnpm vitest run tests/unit/skills-skill-md-naming.test.ts`(验证 frontmatter `name:` 不出现 bare `<sid>`、axis 标签一致)
- `pnpm vitest run tests/unit/workspace/top-level-change-id-guard.test.ts`(本 spec 不动 workspace,但 skill 改名后下游 hook matcher 会受影响)
- 全量 `pnpm vitest run`

### 4.3 Dogfood 路径

按 `scripts/dogfood-sediment-cycle.sh` 现有路径:

```bash
# 先 release-build,把改完的 skill 写入 .peaks/skills/.system/bees/peaks-code/manifest.json(id 已改 peaks-code)
# 然后跑 sediment cycle(完整 roundtrip)
pnpm run dogfood:sediment
```

验证端到端:id 改后,manifest `id: "peaks-code"` 仍然能 release-show / dispose / retain,证明物理路径不动假设成立。

---

## 5. 执行步骤(Execution)

### 5.1 准备(commit 0)

- [ ] **5.1.1** 创建 branch:`git checkout -b feature/peaks-code-to-peaks-code`(基于当前 `feature/4x-sediment-pool`)
- [ ] **5.1.2** 创建 changelog 草稿条目:`### Renamed`(在 CHANGELOG.md 顶部 `## [Unreleased]` 下)

### 5.2 Source 改动(commit 1,atomic)

- [ ] **5.2.1** `git mv skills/peaks-code skills/peaks-code`
- [ ] **5.2.2** `git mv skills/peaks-code-resume skills/peaks-resume`
- [ ] **5.2.3** `git mv skills/peaks-code-status skills/peaks-status`
- [ ] **5.2.4** `git mv skills/peaks-code-test skills/peaks-test`
- [ ] **5.2.5** 4 个 SKILL.md frontmatter 同步改 `name:` + `description:`
- [ ] **5.2.6** 4 个 references 目录下的子文件,把所有 self-reference 替换
- [ ] **5.2.7** `skills/peaks-code/test-prompts.json` 内 trigger 字符串同步

### 5.3 Code 改动(commit 2,atomic)

- [ ] **5.3.1** `src/services/profiles/profile-service.ts` 的 profile id 同步
- [ ] **5.3.2** 全量 grep-replace:`rg -l "peaks-code" src/ tests/ scripts/ .claude/ .claude-plugin/ docs/`(排除 `.peaks/memory`、`openspec/`、`.git/sdd/`)
- [ ] **5.3.3** `tests/fixtures/skills/pre-slim/peaks-code.SKILL.md` 改名 `peaks-code.SKILL.md`(若 fixture 名包含子技能名,一并改)
- [ ] **5.3.4** **六个 role skill 隐藏**(2026-07-05 user 追加):
  - `skills/peaks-{prd,rd,qa,ui,sc,txt}/SKILL.md` frontmatter 加 `metadata.visibility: internal` + description 改写
  - 新增 `src/cli/commands/skill-visibility.ts`(CLI 子命令 `peaks skill visibility --list`)
  - 新增 `tests/unit/cli/skill-visibility.test.ts`(6 个 case)
  - 新增 `tests/unit/skills-role-visibility.test.ts`(验证六个 role skill 都有 `visibility: internal`)
  - `.claude-plugin/marketplace.json`:六个 role 条目加 `"userInvocable": false`
  - 所有 user-facing 文档(LESSON.md / LOGGING.md / docs/)里 `/peaks-rd` `/peaks-prd` 等 slash trigger 改为 "(internal)" 标记或完全删除

### 5.4 Docs 改动(commit 3,atomic)

- [ ] **5.4.1** `.claude-plugin/marketplace.json`:`peaks-code*` 条目 id 全改
- [ ] **5.4.2** `.claude/LOGGING.md`:全文替换
- [ ] **5.4.3** `docs/superpowers/specs/2026-07-04-peaks-maker-dynamic-skill-sediment-design.md` §4.1.1 段落改写:从"preserved as alias"改为"renamed in v4.1 to peaks-code; physical path `.system/bees/peaks-code/` preserved for backward-compat"
- [ ] **5.4.4** `docs/superpowers/plans/2026-07-04-peaks-4x-sediment-pool.md`:全量替换
- [ ] **5.4.5** `CHANGELOG.md`:`### Renamed` 段落写入

### 5.5 LLM 自动迁移(commit 4,LLM 执行)

> **2026-07-05 user override:**"5.5 也你来吧"——本节由 LLM(单 sub-agent + dogfood 验证)执行,无需 user 手动操作。HC-4 要求每一步附证据。

#### 5.5.1 新 CLI primitive:`peaks session migrate-skill-name`

设计:
```bash
peaks session migrate-skill-name --from peaks-code --to peaks-code [--apply] [--project <repo>] [--json]
```

- **默认 dry-run** —— 只输出"会改哪些文件、几处",不写盘。
- **`--apply`** —— 实际写盘。改写范围:
  - `.peaks/_runtime/active-skill.json` 的 `skill` 字段
  - `.peaks/_runtime/<sessionId>/session.json` 的 `skill` 字段
  - `.peaks/_runtime/<sessionId>/<role>/*.json`(任意 role 产物 JSON)里出现的 `"skill": "peaks-code"` 键值
  - `.peaks/_runtime/<sessionId>/txt/*.md`、`requests/*.md` 里的 `/peaks-code` 触发字符串(仅在 frontmatter `trigger:` 字段或代码块里)
- **不改:**
  - `.peaks/memory/**`(memory 是事实快照,见 §2.1)
  - `.peaks/skills/.system/bees/peaks-code/manifest.json`(manifest 的 `id` 字段改在 §5.4 doc 改动里手写改,不是这步)
  - 任何非 JSON / 非 md 的二进制产物
- **幂等**:重复跑 `--apply` 不重复改(grep 命中数为 0 时提前返回 success)。
- **`--json` 输出 schema:**
  ```json
  {
    "ok": true,
    "scannedFiles": 42,
    "modifiedFiles": 7,
    "keyValueReplacements": 9,
    "stringReplacements": 12,
    "skipped": [".peaks/memory/...", "..."],
    "errors": []
  }
  ```

#### 5.5.2 执行步骤(由 LLM 在 commit 4 里完成,必须有 dogfood 输出佐证)

- [ ] **5.5.2.1** `pnpm vitest run tests/unit/cli/session-migrate-skill-name.test.ts`(先实现 unit test,见 §5.5.3)
- [ ] **5.5.2.2** `peaks session migrate-skill-name --from peaks-code --to peaks-code --project .`(dry-run)→ 输出 `scannedFiles / modifiedFiles` 计数
- [ ] **5.5.2.3** 在 `.peaks/_runtime/` 下创建 1 个 fixture `tests/fixtures/runtime/session-with-peaks-code.json`,故意带 `"skill": "peaks-code"`,跑 `--apply` 后断言 fixture 内容已改
- [ ] **5.5.2.4** `peaks session migrate-skill-name --from peaks-code --to peaks-code --apply --project .` → 真实跑一次,捕获 stdout
- [ ] **5.5.2.5** `rg "peaks-code" .peaks/_runtime/` → 输出必须为空(或仅命中 §5.5.1 列出的"不改"白名单)
- [ ] **5.5.2.6** `peaks skill presence:set peaks-code --gate startup`(LLM 重新绑定 active skill)

#### 5.5.3 必写测试 `tests/unit/cli/session-migrate-skill-name.test.ts`

至少 8 个 case:
1. dry-run 不改盘
2. --apply 改 active-skill.json
3. --apply 改 session.json
4. --apply 改 role/*.json 嵌套
5. 跳过 .peaks/memory/**
6. 跳过 .peaks/skills/.system/bees/peaks-code/manifest.json
7. 幂等:第二次跑 --apply 返回 0 modifications
8. 错误路径:目标文件不存在 / JSON 损坏时返回清晰错误(不静默跳过)

### 5.6 回归 + 出版(commit 5+)

- [ ] **5.6.1** `pnpm vitest run` → 全绿
- [ ] **5.6.2** `pnpm run dogfood:sediment` → release-build + sediment cycle 全过
- [ ] **5.6.3** `pnpm run release:minor`(或跟随下一个 4.x minor 出版)
- [ ] **5.6.4** 在 PR 描述里写 "Breaking change: skill id `peaks-code` → `peaks-code`; sub-skill ids `peaks-code-resume / -status / -test` → `peaks-resume / -status / -test`. Pool physical path preserved. Manual migration required for `.peaks/_runtime/**/*.json` `skill:` fields."

---

## 6. 回滚方案(Rollback)

如果回归不通过,执行:

1. `git revert` 全部 6 个 commit(按时间倒序 revert)
2. `git checkout` 回到 `feature/4x-sediment-pool`
3. `peaks session migrate-skill-name --from peaks-code --to peaks-code --apply --project .`(反向迁移,新 CLI 本身支持双向)
4. `peaks skill presence:set peaks-code --gate startup`
5. 重跑 `pnpm vitest run` 确认绿

回滚时间估算:< 5 分钟(git revert + sed)。

---

## 7. 风险与缓解(Risk & Mitigation)

| 风险 | 影响 | 缓解 |
|---|---|---|
| `rg` 误命中(history / archived 文件) | 高——可能改动 110 个 memory 文件 | 5.3.2 步的 rg 命令**显式排除** `.peaks/memory/`、`openspec/`、`.git/sdd/`;落地前用 `rg -L` 验证排除集 |
| Pool manifest 路径不动但 id 改,可能引起 .system/bees/ 内部 cross-reference 失效 | 中 | 5.6.2 的 dogfood 端到端覆盖了这点 |
| 三个 sub-skill 提为通用 primitive,未来其他 bee 不知道可以复用 | 中 | 三个新 SKILL.md 的 description 写明 "universal / orchestrator-agnostic / use for any bee" |
| Skill presence 文件 user 忘记手动 sed | 高——下一次 LLM 启动读到 `skill: "peaks-code"` 会困惑 | 5.5.1 是显式 user action;5.6.4 的 PR 描述里写 "Manual migration required" |
| 旧 slash command `/peaks-code` 在 IDE 中仍然可触发,但触发到的 skill 已被 rename,IDE 报错 | 中 | 在 changelog 和 PR 描述里写明 "slash command `/peaks-code` no longer valid; use `/peaks-code`";不回退旧 trigger(回退 = 半步更名,违反 user "一次到位"决策) |
| 旧 trigger 字符串 `/peaks-code-resume` 等三个 sub-skill 的 slash command 也作废 | 中 | 同上,在 changelog 写明 |

---

## 8. 验收标准(Acceptance Criteria)

**AC-1:** `rg "peaks-code" src/ tests/ scripts/ .claude/ .claude-plugin/ skills/ docs/superpowers/` 输出为空(扣除 spec 里"renamed in v4.1 to peaks-code"这类历史叙述)。

**AC-2:** `rg "peaks-code-resume|peaks-code-status|peaks-code-test" .`(扣除 `.peaks/memory/`、`openspec/`、`.git/sdd/`) 输出为空。

**AC-3:** 四个新目录存在:
```bash
ls skills/peaks-code skills/peaks-resume skills/peaks-status skills/peaks-test
# → 全部存在
ls skills/peaks-code skills/peaks-code-resume skills/peaks-code-status skills/peaks-code-test
# → ls: No such file or directory
```

**AC-4:** 四个新 SKILL.md 的 frontmatter `name:` 字段分别等于 `peaks-code` / `peaks-resume` / `peaks-status` / `peaks-test`。

**AC-5:** `~/.peaks/skills/.system/bees/peaks-code/manifest.json` 的 `id` 字段等于 `"peaks-code"`(物理路径不动)。

**AC-6:** `pnpm vitest run` 全绿。

**AC-7:** `pnpm run dogfood:sediment` 全过(release-build + retain + diff + dispose 一条龙)。

**AC-8:** `peaks skill presence --json` 在已迁移的 session 中输出 `"skill": "peaks-code"`。

**AC-9:** CHANGELOG.md `## [Unreleased]` 段含 `### Renamed` 子段,逐条列出 4 个 id 改名 + 1 条路径保留声明。

**AC-10:** `.peaks/memory/` 与 `.git/sdd/` 内**零修改**(`git diff --stat` 在这两目录上为空)。

**AC-11:** `tests/unit/cli/session-migrate-skill-name.test.ts` 8 个 case 全绿,且 dogfood 5.5.2.5 的 `rg "peaks-code" .peaks/_runtime/` 在排除白名单后输出为空。

**AC-12:** 改完后 `peaks skill presence --json` 输出 `"skill": "peaks-code"`(LLM 已 re-bind)。

**AC-13:** `peaks skill visibility --list --json` 返回 4 个 public + 6 个 internal,且 public 列表恰好是 `peaks-code / peaks-resume / peaks-status / peaks-test`,internal 列表恰好是 `peaks-prd / peaks-rd / peaks-qa / peaks-ui / peaks-sc / peaks-txt`。

**AC-14:** `tests/unit/cli/skill-visibility.test.ts` 6 个 case 全绿,`tests/unit/skills-role-visibility.test.ts` 全绿。

**AC-15:** 6 个 role skill 的 SKILL.md frontmatter 都包含 `metadata.visibility: internal`,且 description 第一行含 "not user-invocable" 或等价措辞。

**AC-16:** `rg -L "internal" skills/peaks-{prd,rd,qa,ui,sc,txt}/SKILL.md` 输出为空(即 6 个 role skill 的 SKILL.md 都被标记为 internal)。

**AC-17:** 全量 `pnpm vitest run` 通过,包含新加的 8 + 6 + 1 = 15 个测试 case。

---

## 9. 开放问题(Open Questions)

无。本 spec 已涵盖 user 在 brainstorm 中确认的所有决策点。

---

## 10. 相关文档(References)

- `docs/superpowers/specs/2026-07-04-peaks-maker-dynamic-skill-sediment-design.md` §4.1.1(被本 spec 覆盖)
- `docs/superpowers/plans/2026-07-04-peaks-4x-sediment-pool.md`(同步)
- `.peaks/memory/peaks-loop-24h-ai-programmer-positioning.md`(4.x 定位说明)
- `.peaks/memory/4x-sediment-pool-reserves-desktop-client-entry-points.md`(本次 rename 不影响 4.x 桌面预留契约)
- `.peaks/memory/peaks-code-is-an-orchestrator-not-an-implementer-even-for-pure-doc-changes.md`(描述的主技能行为,改 id 后行为不变)