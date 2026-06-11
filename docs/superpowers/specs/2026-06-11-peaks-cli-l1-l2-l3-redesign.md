# peaks-cli L1+L2+L3 战略重设计 — Design Spec

- **Date**: 2026-06-11
- **Status**: Brainstorming complete, awaiting spec review
- **Owner**: peaks-rd → peaks-qa → peaks-solo (10-slice orchestration)
- **Targets**: peaks-cli 1.4.x → 2.0.x
- **Related**:
  - `docs/superpowers/specs/2026-06-10-fuzzy-matching-design.md` (前置 slice)
  - `.claude/rules/common/dev-preference.md` (skill-first + dogfood + commit-identity 三条红线)
  - `openspec/changes/2026-06-10-fuzzy-matching/` (前置 OpenSpec)

---

## 1. Problem Statement

用户在脑暴中提出 4 个相互纠缠的痛点，根因是一个：

### 4 个表层痛点

| # | 痛点原话 | 技术翻译 |
|---|---|---|
| #1 | "LLM 没有深刻理解项目，缺性能优化视角、代码写法治理" | **项目级判断缺失**——peaks-cli 缺少独立于用户经验之外、能从项目客观信号派生判断的角色 |
| #2 | "LLM 也会偷懒能跳过就跳过，需要极客精神" | **LLM 行为漂移**——peaks-cli 的 MANDATORY / BLOCKING 红线大多 prose-only，LLM 可轻易绕过 |
| #3 | "改个简单 bug 要半小时，即使使用蜂群模式也很慢" | **gate 颗粒度与任务颗粒度不匹配**——所有任务（typo / bug / feature）走同一套 gate，开销 >> 实际工作量 |
| #4 | "context 怎么动态精简，但怕拖累效率和让 LLM 漂移" | **context 体积失控**——peaks-cli 当前 L2/L3 context 大半全量 load，没有按需检索机制 |

### 根因 (Root Cause)

> **peaks-cli 是"流程主义"——所有任务走一样的流程，所有 gate 一样的颗粒度，所有圈定一样的来源 (用户经验)。**

这导致：
- 流程统一颗粒度 → #3 慢
- 流程靠 prose 防偷懒 → #2 漂移
- 流程没有"项目层"角色 → #1 项目盲区
- 流程统一 context 颗粒度 → #4 失控

### 关键张力 (User-articulated)

> "我还在以人的视角教 LLM 做事，但是我不以人的视角去圈定的话，更容易漂移。"

这不是个人困惑，是 AI Coding 工具链的**根本性悖论**。peaks-cli 当前**完全偏向"圈定"那一边**（skill-first / red-line gates / memory / retrospective / dev-preference.md 全部是用人的视角圈定 LLM），代价是：**它原样继承了用户的盲区**。

---

## 2. Design Philosophy

### 2.1 Reframe: 不是"要不要圈定"，是"圈定的依据是什么"

LLM 工作的 4 种圈定依据：

| 依据 | 强项 | 弱项 | peaks-cli 当前覆盖 |
|---|---|---|---|
| **A. 用户经验** (人的判断) | 项目特化、品味、责任承担 | 受限于用户盲区 | ✅ 重度 (skill / red-line / memory) |
| **B. 项目客观信号** (代码的事实) | 不受用户盲区影响、可验证 | 需要工具读懂项目 | ⚠️ 极薄 (只有 codegraph 提供结构) |
| **C. 行业通识** (LLM 内置 + 文档) | 广度、最佳实践 | 跟项目特化错配 | ✅ Context7 / 文档查询 |
| **D. 历史决策** (memory / retrospective) | 一致性、避免重复犯错 | 只有 bootstrap 后才有用 | ✅ 重度，fuzzy-matching slice 进一步打磨 |

**本设计补 B 栏的彻底薄弱。**

### 2.2 Joint Probability Framing

AI Coding 的"准确性"不是单点能力，是链路联合概率：

```
用户意图 (模糊) → 翻译成 NL (有损) → LLM 解读 (概率分布) → 选择行动 (再分布)
               → 产出结果 → 用户理解结果 (又一次有损)
```

每段 70-90% 不致命，但 80% × 70% × 80% × 90% ≈ 32%。**单点不强不要紧，任何一环弱乘积就崩。** 本设计逐环拉高概率。

### 2.3 Karpathy 4 原则 (Hard Inlined, 零依赖)

[multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills) 4 原则与 L1 设计完美对齐，直接内化为本设计的哲学注脚：

| Karpathy 原则 | 在本设计中的实现 |
|---|---|
| **Think Before Coding** | L1a CLI-back 强制 plan gate（没有 PRD/spec/AC 不能进 RD） |
| **Simplicity First** | L1a 不自动升级级别（该 typo 就 typo，升级要给理由） |
| **Surgical Changes** | L1c context 分层（只载需要的，fuzzy 检索按需） |
| **Goal-Driven Execution** | L1a 强制要求 acceptance criteria 才能进 gate |

不引入 plugin / skill / runtime 依赖。

---

## 3. Architecture Overview

### 3.1 三层架构

```
┌────────────────────────────────────────────────────────────────┐
│  L1: 任务分级 + 自适应 gate + 自适应 context 分层 (三位一体)        │
│  ├── L1a: 任务分级权威 (混合机制)                                  │
│  ├── L1b: 配套 gate set (typo/bug/feature/refactor/migration)    │
│  └── L1c: 配套 context layer (按级别选 L0/L1/L2/L3)              │
│  解 #3 效率 + #4 context                                         │
└────────────────────────────────────────────────────────────────┘
                          │
                          ▼ 让 L3 不拖累小任务
┌────────────────────────────────────────────────────────────────┐
│  L2: CLI-backed 反偷懒                                            │
│  ├── audit 框架: peaks audit red-lines                            │
│  ├── ECC AgentShield 静态规则集成 (102 条)                        │
│  └── peaks-cli 自有红线 CLI 兜底 (~120-150 条 prose-only red lines)│
│  解 #2 LLM 偷懒                                                   │
└────────────────────────────────────────────────────────────────┘
                          │
                          ▼ 让 L3 诊断不被 LLM 跳过
┌────────────────────────────────────────────────────────────────┐
│  L3: 项目医生 (Project Doctor)                                    │
│  ├── 输入: UA knowledge-graph + ECC agents + peaks-cli 内置诊断器  │
│  ├── 处理: severity 判定 + 路由分发                                │
│  └── 输出: CRITICAL→openspec, HIGH→red-line, MEDIUM→advice, LOW→memory │
│  解 #1 项目盲区                                                   │
└────────────────────────────────────────────────────────────────┘
```

### 3.2 依赖关系

```
fuzzy-matching slice (前置) ──→ L1c 按需检索的基础设施
L2 (CLI-back) ──→ L1c 漂移防线 (精简才敢精简)
L1 (任务分级) ──→ L3 不拖累小任务 (feature-gate 才触发 L3)
L2 (audit 框架) ──→ L3 诊断结果可路由为 red-line (不被跳过)
UA + ECC ──→ L3 三引擎编排的两个外部引擎
```

### 3.3 误判代价不对称

降级误判（feature → typo）的代价 >> 升级误判（typo → feature）。

- 降级误判 → 漂移、偷懒、漏检 → 质量塌方
- 升级误判 → 慢，但安全

**所有 default 偏严，所有 override 需 guardrail。**

### 3.4 Multi-Platform Compatibility (基础原则)

**peaks-cli 不是 Claude-Code 专属工具。** 本设计在 L1/L2/L3 三层之上**显式声明**多 AI agent CLI 支持要求, 复用 peaks-cli 1.3.3+ 引入的 IDE 适配层 (`src/services/ide/`)。

#### 必须支持的 8 个平台

| # | 平台 | 当前 adapter 状态 | 来源 |
|---|---|---|---|
| 1 | **Claude Code** | ✅ `claude-code` (已注册) | `src/services/ide/adapters/claude-code-adapter.ts` |
| 2 | **Codex** | ✅ `codex` (IdeId 已声明) | `ide-types.ts` |
| 3 | **Trae** | ✅ `trae` (已注册) | `src/services/ide/adapters/trae-adapter.ts` |
| 4 | **Cursor** | ✅ `cursor` (IdeId 已声明) | `ide-types.ts` |
| 5 | **Qoder** | ✅ `qoder` (IdeId 已声明) | `ide-types.ts` |
| 6 | **通义灵码 (tongyi-lingma)** | ✅ `tongyi-lingma` (IdeId 已声明) | `ide-types.ts` |
| 7 | **Hermes** | ❌ **未支持** — 本设计 Slice 0.7 新增 | (待添加) |
| 8 | **OpenClaw** | ❌ **未支持** — 本设计 Slice 0.7 新增 | (待添加) |

新增 adapter 工作量**极小** (per `ide-types.ts` 注释: "新 IDE 适配变成'填表'"), 因为 peaks-cli 已经把 IDE 私有 hook 协议归一化, 每个 adapter 只需要填:
- `IdeSettingsLocation` (settings.json 路径)
- `envVar` (项目根 env 变量名)
- `hookEvent` + `toolMatcher` (hook 事件名 + 匹配器)
- `subAgentDispatcher` (per-IDE sub-agent dispatch 实现)
- `promptSizeAware` (G9 hook 是否适用)

#### L1/L2/L3 各组件的平台依赖

| 组件 | 平台相关性 | 实现方式 |
|---|---|---|
| **L1a 任务分级 (`peaks classify`)** | ✅ 平台无关 | 纯 CLI, 不依赖 agent |
| **L1b gate set (`peaks slice check`)** | ✅ 平台无关 | 纯 CLI, 文件系统检查 |
| **L1c context 分层 — L0/L1 加载** | ⚠️ 平台相关 | adapter 决定 settings 文件位置和加载方式 (Claude: `CLAUDE.md`; Codex: `AGENTS.md`; Trae: 各自约定) |
| **L1c context 分层 — L2/L3 检索** | ✅ 平台无关 | 文件系统 fuzzy 检索, 不依赖 agent |
| **L2 audit 框架 (`peaks audit red-lines`)** | ✅ 平台无关 | 纯 CLI, 扫描静态文件 |
| **L2 ECC AgentShield** | ✅ 平台无关 | npm package, 跨平台 |
| **L2 红线 CLI 兜底 (commit hook / gate)** | ⚠️ 平台相关 | adapter.hookEvent + adapter.toolMatcher 决定 hook 安装到哪个事件 |
| **L3 doctor scan core** | ✅ 平台无关 | 纯 CLI, 编排 UA / ECC / 内置诊断 |
| **L3 doctor router (CRITICAL→openspec, HIGH→red-line, ...)** | ✅ 平台无关 | 文件系统操作 |
| **L3 UA 集成** | ✅ 平台无关 | 只读 `.understand-anything/knowledge-graph.json`; UA 自己跨 13 平台 (包括 hermes / openclaw / 等) |
| **L3 UA 选装 UX (install 命令推荐)** | ⚠️ 平台相关 | adapter 检测当前环境, 推荐对应 `/plugin install` 或 install.sh 命令 |
| **L3 OpenSpec 集成** | ✅ 平台无关 | 文件系统 (`openspec/changes/`) |
| **Sub-agent dispatch** | ⚠️ 平台相关 | adapter.subAgentDispatcher 决定如何调用 (Claude: Task tool; Codex: 不同机制; Trae: 不同机制) |
| **Skill 调用机制** | ⚠️ 平台相关 | 每平台有不同的 skill / slash command 格式; peaks-cli 提供 CLI 后端, skill 前端各平台独立 |
| **Workspace migration (`peaks config migrate`)** | ✅ 平台无关 | 纯文件系统 |
| **`.peaks/preferences.json` + `_state/`** | ✅ 平台无关 | 纯文件系统 |

**比例**: 11 个组件平台无关 + 5 个组件需 adapter (但 adapter 已是"填表"层级)。

#### 验证机制

每个平台必须通过 smoke test:
- `peaks audit red-lines --ide <id> --json` 能跑且符合 schema
- `peaks classify --ide <id> --json` 能跑且符合 schema
- `peaks doctor scan --ide <id> --json` 能跑 (退化版即可, 不强制装 UA)
- `peaks sub-agent dispatch <role> --ide <id> --dry-run` 返回正确的 per-IDE tool-call descriptor

新增 adapter (Hermes / OpenClaw) 必须 dogfood 通过这 4 个 smoke test 才算 Slice 0.7 完成。

### 3.5 Skills Architecture Reorganization (与 CLI 同步整改)

**peaks-cli 的产品是 CLI + Skills 双轨**——CLI 是命令行原语, Skills 是编排 prompt。L1+L2+L3 重设计不仅改 CLI, 还必须同步整改 skills, 否则 CLI 改了但 skill 仍以旧 model 工作, **架构整体不一致**。

#### 现状审计 (`c:/Users/smallMark/Desktop/peaks-cli/skills/`)

12 个 SKILL.md + ~80 个 references/*.md:

| Skill | 当前角色 | L1+L2+L3 重设计后的整改 |
|---|---|---|
| **peaks-solo** | 总编排器 | 加 Step 0.6 任务分级 (L1a) + Step 0.8 task-level 路由 (L1b) |
| **peaks-rd** | RD 角色 | gate set 按 task level 走 (L1b), tech-doc/perf-baseline 是否必经按 level |
| **peaks-qa** | QA 角色 | 同上, 性能/安全/E2E 是否必经按 level |
| **peaks-ui** | UI 工作 | UI work 通常 ≥ feature, 简化 typo/bug 分支 |
| **peaks-prd** | PRD 编写 | PRD 长度信号给 L1a CLI 客观扫描使用 |
| **peaks-sc** | skill connections | 待评估 task-level 关联 |
| **peaks-sop** | SOP 编写 | SOP 工作流通常 ≥ refactor |
| **peaks-txt** | TXT compact handoff | handoff 按 task level 走 (typo 极简, feature 完整) |
| **peaks-ide** | IDE adapter 管理 | 多平台 adapter 管理 (§3.4 直接落地点), 加 Hermes/OpenClaw adapter 编排 |
| **peaks-solo-resume / -status / -test** | 工具型 sub-skill | 不直接受影响, 但要复检 references 路径 (workspace reorg 后) |
| **(待新增)** | — | **peaks-doctor**: L3 项目医生 orchestration |

#### 5 个维度的 skill 整改

1. **L1 task-level awareness** (每个 skill 显式声明适用 task level)
   - 在 SKILL.md frontmatter 增加: `applicableTaskLevels: [typo, bug, feature, refactor, migration]`
   - skill 主体根据 task level 跳过不适用的步骤 (例如 peaks-qa 在 typo level 跳过性能/安全测试)

2. **L2 CLI-back 注解** (每条 MANDATORY/BLOCKING 标注 enforce 它的 CLI)
   - 现状: 红线纯 prose ("MANDATORY: 必须在 commit 前跑测试")
   - 整改: 每条红线后加 `CLI-enforced-by: peaks slice check --requires-tests` 注解
   - 配套: `peaks audit red-lines` 扫到 MANDATORY 无 CLI-enforced-by 注解的, 报告为 prose-only

3. **L1c lazy-load references** (references 标 always / on-demand)
   - 现状: SKILL.md 在 prose 里引用 references, LLM 经常全量 load (因为不知道哪些是 must-read)
   - 整改: 每个 reference frontmatter 加 `loadStrategy: always | on-demand`
   - SKILL.md 主体只载 `always`, `on-demand` 的留 fuzzy search 钩子 (`peaks reference search`)
   - 配套效果: L1c context layer 实际生效, 单 turn context 体积压缩 30-60%

4. **新增 peaks-doctor skill** (L3 项目医生 orchestration)
   - SKILL.md: orchestrate `peaks doctor scan` + `peaks doctor route` + UA 选装 UX + ECC agent 编排
   - references/: ua-integration.md / ecc-agent-orchestration.md / severity-rules.md / openspec-proposal-authoring.md
   - 触发: peaks-solo 在 feature/refactor/migration gate 里 dispatch peaks-doctor (typo/bug 不 dispatch)

5. **multi-platform distribution** (skills/ 是 source of truth)
   - 现状: skills/ 复制到 `~/.claude/skills/` (Claude Code 专属位置)
   - 整改: skills/ 是仓库内 canonical source; `peaks skills sync --ide <id>` 按平台格式分发:
     - `claude-code` → `~/.claude/skills/`
     - `codex` → Codex 对应路径 (Slice 0.7 调研)
     - `cursor` → `.cursor-plugin/`
     - `trae` / `qoder` / `tongyi-lingma` / `hermes` / `openclaw` → 各自平台路径
   - 配套: `peaks skills sync --ide all` 一键全平台分发; `peaks skills doctor --ide <id>` 检查同步状态

6. **Output Style Discipline** (统一 skill 回答风格, 让 LLM 输出简洁)
   - 现状: CLAUDE.md 隐含 `Peaks-Cli Skill: <skill> | Peaks-Cli Gate: <gate> | Next: <action>` header, 但散在各 skill 中, 强度不一
   - 整改: 在 SKILL.md frontmatter 加 `outputStyle: peaks-concise-v1` 字段, 所有 skill 遵守统一公约:
     - 始终先 status header (1 行)
     - 然后**决策 / 结果 / 数据** (table / list / code-block 优先于 prose)
     - 不复述用户输入
     - 不空话 / 客套 / 礼貌寒暄
     - 长篇分析放 reference 文件, 主体只放结论
     - 必要时使用 `AskUserQuestion` 多选, 而非"你想要 A 还是 B 还是 C?" 自然语言追问
   - 与 headroom-ai 区分: headroom 压 input prompt, output style 公约管 LLM response — **两者正交, 一起省 token**
   - 配套验证: `peaks audit output-style --skill <name> --json` 静态扫 SKILL.md 是否遵守公约 (例如检查有无空话模板"我将...让我..."等)

#### 整改触点矩阵 (与现有 slice 配合)

| Slice | 这个 slice 顺便干的 skill 整改 |
|---|---|
| #2 L1a+L1b | peaks-solo / peaks-rd / peaks-qa / peaks-txt 加 task-level frontmatter + 主体分支 |
| #3 L1c | 全 ~80 references 加 loadStrategy frontmatter; SKILL.md 主体精简; **memory/retrospective search 加 `--use-headroom`** |
| #4-#7 L2.1-L2.4 | 全 12 SKILL.md 的 MANDATORY/BLOCKING 加 CLI-enforced-by 注解 |
| #9 L3.2 项目医生 MVP | doctor scan 加 `--compress-output`, doctor route 加 `--compress-proposal-draft` |
| **#11 (新)** | **peaks-doctor SKILL.md authoring** (L3.2 配套) |
| **#12 (新)** | **Skill Family Alignment Pass** — 整体复检 / multi-platform distribution / 800-line 上限 / 红线注解 100% 覆盖率 / **outputStyle: peaks-concise-v1 frontmatter 100% 覆盖 + `peaks audit output-style` 静态扫** |

#### 验证

- SKILL.md 文件大小 ≤ 800 行 (硬上限, 已是项目约定)
- references 在 SKILL.md 主体只引用 `always`, `on-demand` 走 fuzzy search 钩子
- `peaks audit red-lines` 报告 MANDATORY/BLOCKING 100% 有 CLI-enforced-by 注解 (或 P0/P1/P2 backlog 显式记录)
- peaks-doctor SKILL.md 通过 `peaks skill runbook peaks-doctor --json` 校验
- `peaks skills sync --ide all --dry-run` 8 平台分发预演无错误

### 3.6 Swarm Algorithm Architecture (蜂群编排升级)

#### 现状

peaks-cli 现有蜂群机制 (sub-agent dispatch + 3-way fan-out via Solo) 在效率上有明确瓶颈:

| 瓶颈 | 现状 | 后果 |
|---|---|---|
| **固定 3-way fan-out** | 总是 peaks-ui / peaks-rd / peaks-qa 三个 | 不考虑任务实际依赖, 浪费并发 |
| **Barrier 等待** | 主 LLM 等所有 sub-agent 返回才下一步 | slowest agent 决定 critical path |
| **每个 sub-agent 走完整 gate** | 不论任务大小 sub-agent 内部都跑完整 RD-QA-review | gate 开销线性放大 |
| **无投机执行** | sub-agent 必须确认依赖才能启动 | 串行启动延迟 |
| **无收敛判定** | 找不完就跑到 max retries | 浪费 + 不可预测 |

#### 调研结论 (主流框架对比)

| 框架 | 用 peaks-cli 角度评估 |
|---|---|
| [OpenAI Swarm](https://github.com/openai/swarm) | ❌ Python only + 被 Agents SDK 取代 |
| [LangGraph](https://github.com/langchain-ai/langgraph) | ⚠️ 可借鉴 DAG 算法, 不宜整体引入 (TS 版有, 但跟 peaks-cli 的"orchestrator of orchestration"角色重复) |
| [AutoGen](https://github.com/microsoft/autogen) | ❌ 维护模式, 被 MS Agent Framework 取代 |
| [CrewAI](https://github.com/crewAIInc/crewAI) | ❌ Python only |

**关键诊断**: peaks-cli 是 **orchestrator of orchestration** (生成 toolCall descriptor 让平台 AI agent runtime 执行), 直接引入运行时 agent 框架会跟平台 agent runtime 重复, 还要绕 IPC。

**正确路径**: **借用算法模式, 不引入运行时依赖**。

#### 推荐: 5 个开源经典模式 (零依赖, 借用 not import)

| 模式 | 来源 | 解什么 | peaks-cli 落点 |
|---|---|---|---|
| **1. DAG dispatch** | LangGraph (Pregel/Beam) | 内容派生 fan-out, 不固定 3-way | `peaks swarm plan --content <prd-id> --json` 派生 DAG; sub-agent 按 DAG 拓扑序+依赖并发启动 |
| **2. Pipeline (no barrier)** | Workflow 文档 / Apache Beam | 让快的 sub-agent 流到下一阶段, 不等慢的 | `peaks swarm pipeline --stages "rd,qa,review"`; 每个 item 独立穿过多阶段, wall-clock = slowest single chain 而非 sum-of-slowest-per-stage |
| **3. Speculative dispatch** | Tree of Thoughts / Speculative Decoding | 高概率 sub-agent 提前启动, 不需要时杀掉 | `peaks swarm dispatch --speculative --kill-if-unused`; 用 codegraph / 历史决策预测下一步需求 |
| **4. Adversarial verification cone** | GAN harness / multi-judge | N skeptics 并行验证, 投票决定 | `peaks swarm verify --skeptics 3 --consensus 2`; 给关键 finding 加 3-skeptic 验证而非 1-pass review |
| **5. Loop-until-dry** | Workflow 文档 / 收敛检测 | K 轮空才停, 不靠固定次数 | `peaks swarm loop --until-dry --max-rounds 5`; L3 doctor / L2 audit 用这个收敛 |

5 个模式互相正交, 可独立实现, 互相组合产生复合效果。

#### 与 L1+L2+L3 的联动

```
L1 task-level (Slice 2)
   ↓ (告诉 swarm 这个任务大小)
DAG dispatch (Slice 13.1)
   ↓ (按任务内容派生 fan-out 形状)
Per-sub-agent task-level inheritance
   ↓ (每个 sub-agent 内部也用 L1b gate set, typo 不跑 review/QA)
Pipeline (Slice 13.2)
   ↓ (快的 sub-agent 不等慢的, 流到下一阶段)
Speculative dispatch (Slice 13.3, optional)
   ↓ (高概率下一阶段 sub-agent 提前启动)
Adversarial verification (Slice 13.4, optional)
   ↓ (关键 finding 走 3-skeptic 投票)
Loop-until-dry (Slice 13.5, 配 L3 doctor)
   ↓ (L3 doctor 收敛判定)
```

#### 预期效果

| 场景 | 当前 critical path | 升级后 critical path |
|---|---|---|
| 改 typo | ~30 分钟 (走全 gate) | ~1 分钟 (L1 typo-gate + L1c 最小 context) |
| 改 bug | ~30 分钟 (蜂群也慢) | ~7-10 分钟 (L1b + DAG + Pipeline) |
| 加 feature | hours | ~1 小时 (DAG + Pipeline + Speculative) |
| L3 doctor 全项目扫 | 一次扫到底 | 收敛即停, 平均缩 30-40% |

### 3.7 Agent Loop Architecture (L4 — 跨 slice 学习层)

#### 概念定位

L1 / L2 / L3 是**每个任务内部**的能力提升; L4 Agent Loop 是**多个任务之间**的能力沉淀:

| 层 | 范围 | 解什么 |
|---|---|---|
| L1 | per-task | gate 颗粒度 / context 分层 (效率 + 准确性) |
| L2 | per-action | CLI back red-line (反偷懒) |
| L3 | per-project | 项目客观信号诊断 (项目盲区) |
| **L4** | **per-session 跨 slice** | **沉淀 + 复用 + 防漂移 + 提效率** |

#### 用户 4 个目标 → L4 对应实现

| 用户目标 | L4 实现 |
|---|---|
| **沉淀** | retrospective auto-distill: slice 完成自动汇总成 lesson, 进 memory index |
| **省 token** | (a) slice 启动 preflight: 同类已有 lesson 不重让 LLM 推 (b) distill 多个 retrospective → 1 lesson (减检索负担) |
| **减漂移** | self-consistency check: 当前决策跟历史 decision log 矛盾 → 阻断 transition / 报警 |
| **提效率** | pattern detection: 同类失败 ≥ N 次 → 自动生成新 red-line / hook / SKILL.md 更新 |

#### peaks-cli 现状: 有零件, 缺回路

```
现状 (各自独立, 没连成回路):
  memory/        ← LLM-authored 静态 fact
  retrospective/ ← slice 完成记录
  micro-cycle    ← slice 内 TDD
  request transition ← slice 状态机
  fuzzy-matching slice ← 检索基础设施 (在飞)

缺失 (回路本身):
  ❌ slice retrospective → memory 自动汇总
  ❌ slice 启动时自动 read 相关 retrospective + adjust context
  ❌ pattern detection (多次同类失败 → 自动生成 red-line)
  ❌ self-consistency check (当前决策 vs 历史 decision)
  ❌ working memory (跨 slice 持久缓存)
```

#### 4 个核心 sub-feature (Slice 14)

**14.1 Retrospective auto-distill** (沉淀)
- 触发: `peaks request transition` → done 时自动调
- CLI: `peaks loop distill --rid <rid> --apply --json`
- 行为: scan retrospective → 抽 lesson → 写 `.peaks/memory/lessons/auto-<rid>.md` + 更新 memory index
- 输出 JSON: `{ lessonsCreated: N, lessonsMerged: N, skipped: N, reasonsSkipped: [...] }`
- 与 headroom 联动: distill 用 conservative mode (保留事实精度)

**14.2 Slice-launch context auto-load (preflight)** (省 token + 沉淀复用)
- 触发: `peaks request init` (新 slice 开始)
- CLI: `peaks loop preflight --rid <rid> --task-level <level> --json`
- 行为: fuzzy 检索相关 retrospective / memory / decision log → 注入 L1c L2 layer
- 输出 JSON: `{ entriesInjected: N, hitRate: 0.X, tokensSavedEstimate: N }`
- 与 fuzzy-matching slice 联动: 用 memory/retro search 做检索

**14.3 Pattern detection** (提效率)
- 触发: 累积 N 次同类失败 (默认 N=3, preference 可调)
- CLI: `peaks loop detect-pattern --threshold 3 --json`
- 行为: 识别 pattern → 输出 suggested fix (新 red-line / 新 hook / SKILL.md 更新)
- 输出 JSON: `{ patterns: [...], severity: CRITICAL|HIGH|MEDIUM, suggestedFixes: [...] }`
- 路由: 进入 L3 doctor 路由 (CRITICAL → openspec proposal 草稿)

**14.4 Self-consistency check** (减漂移)
- 触发: `peaks request transition` (slice 完成时, transition 前)
- CLI: `peaks loop check-consistency --rid <rid> --json`
- 行为: 比较当前 decision log 跟 memory 中 historical decision, 矛盾 → 报警
- 输出 JSON: `{ consistent: bool, conflicts: [...], severity: CRITICAL|HIGH }`
- 阻断: CRITICAL 矛盾直接阻断 transition; HIGH 警告但允许 (可 `--override` flag)

#### 14.5 Autonomous orchestration — 借力平台原生 `/goal`

**Claude Code 一等公民 `/goal` (v2.1.139+, [官方文档](https://code.claude.com/docs/zh-CN/goal))** 提供了干净的 condition-driven turn chaining 原语。peaks-cli L4 直接借力, **不重复发明**:

| `/goal` 特性 | peaks-cli L4 14.5 利用方式 |
|---|---|
| condition-driven turn chaining | peaks 生成 condition: "所有 N slice 完成, 每个 dogfood 通过, request_status 全 done" |
| immediate next turn (no waiting) | 不等 user confirm, 直达 §9.3 AI 24/7 极限 |
| evaluator (Haiku) 判定 done | peaks `peaks request status --json` / `peaks slice check --json` 输出是 evaluator 可读的客观信号 |
| `--resume` 跨 session 恢复 condition | turn count 重置但 condition 在 → 跟 14.1 distill 联动, 重启 preflight 直接吃前段 lesson |
| inline 限制 ("or stop after N turns") | peaks 生成 condition 时自动加 "or stop after 200 turns" 作为 runaway 上限 |
| `/goal clear` 退出 (aliases: stop/off/reset/none/cancel) | 用户随时可中断 |

**CLI 整合**: `peaks goal compose --rid <rid> --json` 生成 condition 字符串 (含 200-turn 上限 + 退出条件), 用户用 `/goal <peaks-generated-condition>` 触发 autonomous turn chain。

**多平台姿态** (跟 §3.4 一致):

| 平台 | 等价机制 | adapter 实现 |
|---|---|---|
| Claude Code | 原生 `/goal` (v2.1.139+) | `claude-code-adapter.goalCommand = (cond) => '/goal ' + cond` |
| Cursor / Codex / Trae / Qoder / tongyi-lingma | 暂不清楚 (Slice 0.7 调研) | adapter `goalCommand` capability (各自实现或 fallback) |
| Hermes / OpenClaw | 调研中 (Slice 0.7) | 同上 |
| 任一平台无等价 | fallback | `peaks goal compose --output-only --json` 输出 condition 字符串, 用户手动复制粘贴启动 |

**默认仍 disabled**: preference `loopAutonomousEnabled: false`, 启用需 explicit confirm + 显示 condition 让用户审阅再 `/goal <cond>`。

#### 与 L1+L2+L3 + Slice 13 swarm 的联动

```
slice 启动 (peaks request init)
  → 14.2 preflight (fuzzy 吸入历史 retrospective)
  → L1a 任务分级 (preflight 数据可调 classify default)
  → L1b gate set (preflight 数据可调推荐 gate)
  → L1c context (preflight 注入 lesson 进 L0/L1)
  → Slice 13 swarm dispatch (DAG / Pipeline / Speculative)
  → RD/QA 执行
  → L3 doctor scan (含 14.3 pattern detection)
  → 14.4 consistency check
  → peaks request transition → done (consistency 通过)
  → 14.1 auto-distill (slice 结束自动汇总 → next slice preflight 输入)
```

#### 与外部 loop 生态的关系 (借用, 不引入)

| 外部 | 姿态 |
|---|---|
| `superpowers:autonomous-loops` skill | 算法模式参考, 不 import |
| `claude-mem:do` skill (working memory) | 模式参考, 不 import |
| Claude Code `CronCreate` / `ScheduleWakeup` | adapter 层包装 (Slice 0.7 + adapter 触点) |
| Claude Code `/loop` slash command | 同上 |
| ECC `peaks-loop-operator` agent | 可作 sub-agent dispatch 后端 (现有 dispatch 路径复用) |

#### 风险控制

- **runaway loop**: 14.5 默认人触发; preference `loopAutonomousEnabled: false` 全局关闭
- **noise 堆积**: distill 有去重 + 合并; pattern detection threshold = 3 不一次性误判
- **consistency check 假阳性**: 默认仅 CRITICAL 阻断; HIGH 是警告; `--override` 可绕开

---

## 4. L1: 任务分级 + 自适应 gate + context 分层

### 4.1 L1a: 任务分级权威 (混合机制)

**决策**: CLI 客观为底 + 用户可 override (需 CLI 二次校验) + LLM 只能升不能降

```
                  peaks classify (CLI 客观扫描)
                       │
                       ▼
                  默认任务级别
                       │
              ┌────────┴────────┐
              │                 │
              ▼                 ▼
       用户可 override      LLM 可建议升级
       (--override <level>)  (单方向, 不可降级)
       CLI 二次校验合理性    
              │                 │
              └────────┬────────┘
                       ▼
                  最终任务级别
                       │
                       ▼
                  路由到对应 L1b gate set + L1c context layer
```

#### CLI 客观扫描信号 (`peaks classify --json`)

| 信号 | typo 候选 | bug 候选 | feature 候选 | refactor / migration 候选 |
|---|---|---|---|---|
| diff 涉及文件数 | ≤2 | 3-10 | >10 | 任意（看 schema/migration） |
| diff 代码行数 | <10 | 10-100 | >100 | 任意 |
| 涉及目录类型 | 仅 docs/README | src/ | 关键架构目录 (services/, core/) | 跨目录 |
| 是否触动 schema/migration | 否 | 否 | 否 | **是 → 强制 ≥ refactor** |
| 关键字检测 | 无 | "bug"/"fix" | "feature"/"新增" | "重构"/"refactor"/"迁移"/"migrate" |
| PRD/spec 长度 | <100 字 | 100-500 | >500 | >500 + 涉及多模块 |

**最终 default 级别 = 各信号产出的候选级别中取最严。**

#### 用户 override 校验 (`peaks classify override --level <level>`)

- 用户声明 typo 但 diff 跨 20 个文件 → **拒绝 override**，强制 ≥ bug
- 用户声明 typo 但只改 README → **接受 override**
- 用户声明 feature 但只改 1 行 → 接受 override（升级安全）
- 任何升级 → 全部接受（误判代价低）

#### LLM 行为约束

- LLM 看 spec/PRD/diff 后，**可调用 `peaks classify upgrade --reason "<text>"` 申请升级**
- LLM **不可降级**——任何 `peaks classify downgrade` 调用都被 CLI 拒绝
- LLM 申请升级时必须附 reason，进 audit log

#### 任务级别枚举

```typescript
type TaskLevel = "typo" | "bug" | "feature" | "refactor" | "migration";
```

### 4.2 L1b: 配套 gate set

每个 task level 走精确匹配的 gate set，**不再一刀切**：

| Gate | typo | bug | feature | refactor | migration |
|---|---|---|---|---|---|
| 输入产物存在 (PRD/spec) | — | ✓ | ✓ | ✓ | ✓ |
| 单元测试覆盖 (TDD) | — | ✓ | ✓ | ✓ | ✓ |
| 静态分析 (AgentShield) | — | ✓ | ✓ | ✓ | ✓ |
| code review (sub-agent / inline) | — | inline 简版 | ✓ full | ✓ full | ✓ full |
| security review | — | inline 关键字扫 | ✓ full | ✓ full | ✓ full |
| QA 功能测试 | — | ✓ | ✓ | ✓ | ✓ |
| QA 性能测试 | — | — | ✓ (when user-visible) | ✓ | ✓ |
| QA 安全测试 | — | — | ✓ | ✓ | ✓ |
| L3 项目医生扫描 | — | 抽样 | ✓ | ✓ | ✓ |
| OpenSpec proposal/spec 必经 | — | — | ✓ | ✓ | ✓ |
| 回归 E2E | — | — | ✓ | ✓ | ✓ |
| TXT compact handoff | — | ✓ 简版 | ✓ | ✓ | ✓ |

**预期效果对比 (改个简单 bug)**:

| 项目 | 当前 (统一 gate) | 升级后 (bug-gate) |
|---|---|---|
| 总 gate 数 | 12 | 5 |
| 估算时间 | 30 分钟 | 7-10 分钟 |
| 关键 gate 保留 | 全部 | 单测 / 静态分析 / 功能测试 / 简版 review |
| 跳过的 gate | 无 | OpenSpec / 性能 / 项目医生 / E2E |

### 4.3 L1c: 配套 context 分层

#### Context 4-Layer 模型

| Layer | 粘性 | 内容 | 加载策略 |
|---|---|---|---|
| **L0 永久约束** | 永远在场 | red lines, 安全规则, 项目身份, **`.peaks/preferences.json`**, **`.peaks/_state/*`** | 全量 load (project CLAUDE.md + preferences/state) |
| **L1 流程指南** | active skill 在场 | 当前 SKILL.md + 必读 references | 全量 load (skill 切换时换) |
| **L2 任务上下文** | 仅任务需要在场 | 当前文件、相关 memory、相关 retrospective | **fuzzy 检索按需** (依赖 fuzzy-matching slice) |
| **L3 历史检索** | 按工具调用 | memory / retrospective 全集 | 按 `peaks memory search` / `peaks retrospective search` 调用 |

#### Context layer 映射到 task level

| Task level | 加载的 Layer | 体积估算 |
|---|---|---|
| typo | L0 + L1 | ~5K-8K tokens |
| bug | L0 + L1 + L2(按需) | ~10K-15K tokens |
| feature | L0 + L1 + L2 + L3(按需) | ~15K-25K tokens |
| refactor | L0 + L1 + L2 + L3 | ~20K-30K tokens |
| migration | L0 + L1 + L2 + L3 + 跨模块 codegraph | ~25K-40K tokens |

#### 漂移防线 (回应用户 #4 担心)

> "精简过头会让 LLM 漂移"——这个担心由 **L2 (CLI-back) 兜底**：即使 context 漏了 dev-preference.md，commit 时 `peaks slice check` 仍然拒绝带 AI trailer 的 commit。**漂移防线不靠 context，靠 CLI gate。** 这是为什么 L2 必须先做。

---

## 5. L2: CLI-backed 反偷懒

### 5.1 现状审计 (本设计 brainstorm 阶段已完成)

| 来源 | red line 总数 |
|---|---|
| 12 个 SKILL.md | 58 处 MANDATORY / BLOCKING / MUST NOT / RED LINE |
| ~80 个 references/*.md | 估计 50-80 处 |
| dev-preference.md | 2 处显式 + 多处隐式 |
| `.claude/rules/common/*.md` (ECC baseline) | 未单独计数, 估计 15-20 处 |
| **总计** | **~120-150 prose-only red lines** |

抽样发现的分布：

| 类型 | 占比 | 例子 |
|---|---|---|
| ✅ CLI-backed (已强制) | ~20% | `peaks workspace init`, `peaks skill presence:set`, `peaks request transition` |
| ⚠️ Partially CLI-backed (易绕开) | ~30% | tech-doc handoff, perf-baseline, Gate A 拒绝 design-draft |
| ❌ Prose-only (零兜底) | ~50% | Solo Code-Change Red Line, no-root-pollution, sub-agent session sharing, mock-data placement, prototype fidelity, login gate, ASCII wireframe |

### 5.2 audit 框架: `peaks audit red-lines`

新 CLI 命令，扫所有 SKILL.md / dev-preference.md / .claude/rules，产出未兜底 red line 报告：

```bash
peaks audit red-lines --project <path> --json
# Output: { totalRedLines: 137, cliBacked: 28, partial: 41, prose-only: 68, audit: [...] }
```

每条 red line 状态：
- `cli-backed`: 有 CLI 命令直接 enforce
- `partial`: 有 gate 但 LLM 可绕开 (需补 hook 或 commit check)
- `prose-only`: 零 enforcement

### 5.3 ECC AgentShield 集成 (Soft Optional)

[ECC AgentShield](https://github.com/affaan-m/ECC) 提供 1282 tests + 102 静态分析规则，**npm-installable**。

```
peaks audit static (L2 静态分析入口)
   │
   ├── 检测 ECC AgentShield 是否安装 (npx ecc-agentshield --version)
   │
   ├── 已装 → 直接调用 AgentShield 102 条规则
   │
   └── 未装 → 询问用户是否安装 (复用 UA 的"用户选装"UX, 见 §7.2):
              ├── a) 我想装 (显示 npm install 命令)
              ├── b) 这次不装 (用 peaks-cli 退化版简单 lint)
              ├── c) 永远不装
              └── d) 先了解一下
```

### 5.4 sub-slice 拆分 (4 个)

| Slice | 范围 | red lines 数 | 时间 |
|---|---|---|---|
| **L2.1 P0 + audit 框架** | Solo-code-ban, no-root-pollution, sub-agent-sid, tech-doc-presence, mock-placement + `peaks audit red-lines` CLI 框架 | 8-12 | 2-3 天 |
| **L2.2 P1** | Resume detection, prototype fidelity, design-draft confirm, pre-RD scan, login gate | 10-15 | 2-3 天 |
| **L2.3 P2-a** | 第一批 lint-style red lines (ASCII wireframe, 各 SKILL.md 小红线) + ECC AgentShield 集成 | 25-40 | 2-3 天 |
| **L2.4 P2-b** | 第二批 lint-style red lines (references/*.md 内的小红线) + audit 回归 | 25-40 | 2-3 天 |

### 5.5 实施模式 (每个 sub-slice)

对每条 red line：

1. **审视**：red line 是否还应该 enforce (有些可能已过时)
2. **选择 enforcement 机制**：
   - 静态规则 → AgentShield rule 或 peaks-cli ESLint rule
   - 启动时检查 → PreToolUse hook
   - commit 时检查 → `peaks slice check` 扩展
   - workflow 转移时检查 → `peaks request transition` 扩展
3. **写 TDD 测试**
4. **集成 + dogfood**
5. **跑 `peaks audit red-lines` 验证状态变 `cli-backed`**

---

## 6. L3: 项目医生 (Project Doctor)

### 6.1 三引擎编排

```
┌─────────────────────────────────────┐
│  UA (Understand-Anything)           │
│  → knowledge-graph.json             │  结构理解
│  → diff-impact.json                 │
│  → domain-analysis.json             │
└──────────────┬──────────────────────┘
               │
┌─────────────────────────────────────┐
│  ECC agents (64 个)                  │
│  → security-reviewer                 │  领域诊断
│  → code-reviewer                     │
│  → typescript-reviewer / python-... │
└──────────────┬──────────────────────┘
               │
┌─────────────────────────────────────┐
│  peaks-cli 内置诊断器 (MVP 阶段 1-2 个)│
│  → React 反模式扫描                  │  补 ECC 不覆盖的
│  → 重复 hook / 重复 component        │  项目特化诊断
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  peaks doctor (L3 编排器)             │
│  → 收集所有引擎输出                   │
│  → severity 判定 (CLI 内置规则)       │
│  → 输出统一 JSON                     │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  peaks doctor route (L3 路由器)       │
└──────┬──────┬──────────┬────────────┘
       │      │          │
   CRITICAL HIGH       MEDIUM        LOW
       │      │          │             │
       ▼      ▼          ▼             ▼
  openspec/  red-lines  advice        memory/
  changes/   _runtime/  _runtime/     lessons/
  (草稿)     <sid>/     <sid>/        (持久)
```

### 6.2 Severity 判定规则 (CLI 内置, 不让 LLM 判)

| Severity | 判定条件 |
|---|---|
| **CRITICAL** | 安全漏洞 / 数据丢失风险 / 编译失败 / 测试失败 / .gitignore 漏配导致敏感文件入 git |
| **HIGH** | 跨多个文件的重复实现 / prop drilling > 3 层 / bundle 缺 code splitting / 测试覆盖率跌破 80% |
| **MEDIUM** | 命名风格不一致 / 注释覆盖率低 / 性能优化机会 / 文档过时 |
| **LOW** | 风格小问题 / 可优化的代码模式 / 治理建议 |

### 6.3 输出 JSON Schema

```typescript
interface DoctorFinding {
  type: string;                      // e.g., "duplicate-hook" / "missing-code-split"
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  location: {                        // 必填 evidence
    file: string;
    line?: number;
    range?: [number, number];
  };
  evidence: string;                  // 具体证据 (不是猜测)
  suggested_fix: string;             // 修复建议
  source: "ua" | "ecc-<agent>" | "peaks-<diagnoser>";
  detected_at: string;               // ISO timestamp
}

interface DoctorReport {
  schema_version: "1.0.0";
  scan_id: string;
  findings: DoctorFinding[];
  summary: Record<DoctorFinding["severity"], number>;
}
```

### 6.4 路由分发规则

| Severity | 路由结果 | 持久性 | 谁执行 |
|---|---|---|---|
| **CRITICAL** | 生成 `openspec/changes/<date>-doctor-<id>/proposal.md` 草稿 | 持久 (写盘) | **人审 + 手动 promote 到 active** |
| **HIGH** | 写入 `.peaks/_runtime/<sessionId>/red-lines/<finding-id>.md` | 半持久 (sid 生命周期) | 自动 (下次 task 启动时 load 为 L0 context) |
| **MEDIUM** | 写入 `.peaks/_runtime/<sessionId>/advice/<finding-id>.md` | 半持久 | 可选 (LLM planning 时看, 不强制) |
| **LOW** | 写入 `.peaks/memory/lessons/doctor-<finding-id>.md` | 持久 (跨 session) | 累积到一定阈值时触发"项目治理 slice"提议 |

### 6.5 触发时机 (与 L1b 联动)

| Task Level | L3 触发策略 |
|---|---|
| typo | **不触发** (节省时间) |
| bug | **抽样触发** (10% 概率, 防止积压) |
| feature | **必触发** |
| refactor | **必触发** |
| migration | **必触发** |

### 6.6 反向流动 (回归诊断)

`openspec/changes/<id>/` archive 时, 触发 `peaks doctor scan --rescan-module <module>`, 确认 CRITICAL 修复是否解决问题, 是否引入新问题。

---

## 7. External Integrations

### 7.1 UA (Understand-Anything) — Soft Optional + 用户选装

**关键约束**: UA 没有 npm package / 无 standalone CLI binary / 无 MCP server。只能通过 AI agent CLI (Claude Code / Copilot CLI / Cursor 等) 的 slash command 触发。

**集成模式**: peaks-cli **不调用** UA pipeline, 只**读** `.understand-anything/knowledge-graph.json`。

#### 用户选装 UX flow

```
peaks doctor (L3) 第一次调用 / peaks audit static 第一次调用
   │
   ▼
检测 .understand-anything/knowledge-graph.json 是否存在?
   │
   ├── 存在 → ✅ 使用 UA graph + ECC agents + peaks-cli 内置诊断 → JSON 输出 → 路由
   │
   └── 不存在 → 查 .peaks/preferences.json:uaPrompt 状态
                │
                ├── "skip-forever" → 静默 fallback 到内置 @colbymchenry/codegraph (退化版)
                │
                ├── "skip-this-session" → 本 session 退化, 下 session 再问
                │
                └── (未设置) → AskUserQuestion 4 选项:
                              ├── a) 我想装 UA → 检测当前环境, 显示精确 install 命令
                              ├── b) 这次跳过 (不写持久 preference)
                              ├── c) 永远不装 (写 preferences.json:uaPrompt=skip-forever)
                              └── d) 先了解一下 → 显示简介 + README 链接
```

#### 配套机制

| 机制 | 设计 |
|---|---|
| 环境检测 | 检测 `~/.claude/`, `~/.copilot/`, `.cursor-plugin/` 等, 推断 AI agent 环境, 推荐对应 install 命令 |
| 完成检测 | peaks doctor 在 `.understand-anything/` 出现时自动用 UA |
| 降级保底 | UA 未装时 peaks-cli 用 `@colbymchenry/codegraph` (已在 deps) 跑退化版 L3 |
| 持久化 | `.peaks/preferences.json` 记录 `uaPrompt` 状态 |
| 重新询问 | `peaks doctor preferences --reset-ua-prompt` 重启选择 |

### 7.2 ECC (Everything-Claude-Code) — 分维度集成

| ECC 维度 | 集成姿态 | 理由 |
|---|---|---|
| **rules/common + rules/<lang>** | **Hard required** (维持现状) | peaks-cli `.claude/rules/` 已基于 ECC baseline, 持续 sync |
| **AgentShield** (102 静态规则 + 1282 测试) | **Soft Optional** | 装了 L2 直接用; 不装退化到简单 lint。复用 UA 同款"用户选装"UX |
| **64 agents** (诊断器) | **Soft Optional** | 装了 L3 直接调; 不装 L3 退化到 peaks-cli 自有少数核心诊断 |
| **261 skills** | **Reference only** | 作为参考材料 (像 README 链接), 不引入 runtime |

#### ECC AgentShield 集成接口

```bash
# 检测
npx ecc-agentshield --version

# 调用 (在 L2 静态分析阶段)
npx ecc-agentshield scan --target <path> --json
```

#### ECC 64 agents 集成接口

```bash
# 用 ECC consult 选择合适的 agent
npx ecc consult "<topic>" --target claude

# 在 L3 诊断阶段调度 ECC agent
npx ecc agent run security-reviewer --target <path> --json
```

### 7.3 Karpathy 4 原则 — Hard Inlined (零依赖)

4 原则已编进 §2.3 设计哲学, 不引入 plugin / skill / runtime。

### 7.4 Headroom-AI — 多触点 Prompt 压缩 (token 节省)

#### 现状 (已用)

`headroom-ai@0.22.4` (Apache-2.0) 已在 deps 里。**仅** 在 sub-agent dispatch (G7.7) 用过, 通过 `peaks sub-agent dispatch --use-headroom --headroom-mode <mode>`。3 模式: balanced (40% 预算) / aggressive (20%) / conservative (70%)。失败语义 `fallback: true`, 不可用时退化, **不阻塞**。

#### 扩展用法 (本设计新增触点)

| 触点 | 触发 CLI | 默认模式 | 节省预期 |
|---|---|---|---|
| **L1c L2 检索结果注入** | `peaks memory search --use-headroom [--headroom-mode]` | balanced | 大 memory entry 压缩 30-50% |
| **L1c L2 检索结果注入** | `peaks retrospective search --use-headroom [--headroom-mode]` | balanced | 大 retro entry 压缩 30-50% |
| **L3 doctor 输出落地** | `peaks doctor scan --compress-output` | balanced | 大 evidence 压缩后写 red-lines/advice |
| **L3 doctor 路由 OpenSpec proposal** | `peaks doctor route --compress-proposal-draft` | conservative | proposal 草稿压缩 (但保留 evidence 完整度) |
| **L0/L1 context 加载** | (不支持) | — | **deferred — 不安全** (skill 指令压缩可能 mangle 关键 MANDATORY/BLOCKING 语义) |

#### 按 task level 自动选模式 (与 L1b 联动)

| Task level | L1c 检索 default | L3 doctor default |
|---|---|---|
| typo | 不触发检索 | 不触发 doctor |
| bug | conservative (准确性优先) | (抽样, 用 balanced) |
| feature | balanced | balanced |
| refactor | aggressive (大量上下文) | balanced |
| migration | aggressive (跨模块上下文) | conservative (诊断精度优先) |

#### 失败保底

- 若 headroom-ai 不可用 (proxy 死/包未装), `result.compressed === false` + warning `HEADROOM_UNAVAILABLE`
- peaks-cli 自动 fallback 到不压缩, 继续工作 — **永远不阻塞**
- 用户可以通过 `peaks preferences set headroomEnabled false` 全局关闭

#### 配套 preference (写入 `.peaks/preferences.json`)

```json
{
  "headroomEnabled": true,
  "headroomDefaultMode": "balanced",
  "headroomPerTouchpoint": {
    "memorySearch": "balanced",
    "retrospectiveSearch": "balanced",
    "doctorScan": "balanced",
    "doctorRoute": "conservative"
  }
}
```

#### 不做的事 (与 Output Style 区分)

**headroom-ai 压 prompt, 不压 response**。要让 LLM 回答风格简洁是 **skill output style 公约**, 不是 headroom-ai 工作 — 见 §3.5 维度 6。

---

## 8. Workspace & Config Reorganization (前置基础)

### 8.1 现状审计

#### `.peaks/` (project-local) 现状问题

| 问题 | 证据 | 影响 |
|---|---|---|
| **`_runtime/` 累积无清理** | 5 个 session dir (2026-06-09 / 2026-06-10), 1.6M | 体积无控制, fuzzy 检索成本上升 |
| **`_sub_agents/` 畸形 sid** | 存在 `sid-3` / `sid-h` / `sid-r` / `unknown-sid` 目录 | **违反 two-axis naming convention** (本 spec §0 强调的 "NEVER bare `<sid>`") |
| **顶层 dotfiles 散落** | `.peaks-init-hooks-decision.json` / `.peaks-openspec-opt-in.json` 散在 `.peaks/` 顶层 | 顶层混乱, 无收纳目录 |
| **缺 `preferences.json`** | 不存在 | 新设计 (UA 选装 / AgentShield 选装 / classify rules override) 无落脚点 |
| **缺 `_state/` 收纳目录** | 不存在 | 一次性决策与运行时状态混在一起 |

#### `~/.peaks/config.json` (global) 现状问题

```json
{
  "version": "1.4.2",          ← 用 schema_version, 不要跟 appVersion 混淆
  "currentWorkspace": null,    ← 但 workspaces 数组也空, 不一致
  "workspaces": [],
  "language": "en",
  "model": "sonnet",
  "economyMode": true,         ← 这是 per-project 偏好, 不应该是 global
  "swarmMode": true,           ← 同上
  "tokens": {},                ← 敏感数据, 不应该跟非敏感 mix
  "providers": { "minimax": { "model": "minimax-2.7" } },  ← 不规范的 key
  "proxy": {}                  ← 网络配置, 应独立
}
```

**根因**: 一个文件塞所有东西 (global 偏好 / per-project 偏好 / 敏感凭证 / 网络配置 / workspace 注册表), **关注点不分**。

### 8.2 整改原则 (用户要求: 瘦身)

1. **single source of truth**: 不重复存储, 能从 fs 推导的不存
2. **only store overrides**: 默认值不存, 仅在用户 override 时持久化
3. **separate concerns by sensitivity**: 凭证 / 偏好 / 网络 / workspace 注册各自独立文件
4. **per-project state stays project-local**: `economyMode` / `swarmMode` 这种 per-project 偏好移出 global, 进 `.peaks/preferences.json`

### 8.3 整改后 `~/.peaks/` 结构 (global)

> **YAGNI 立场**: 不为还没出现的需求开抽象。global config 只留 `version` 用于将来 migration; 其它字段全部移除或归档。`credentials.json` / `providers.json` / `network.json` / `workspaces/` 是**前瞻设计 (deferred)**, 仅在 §8 列出意图, **本次 Slice 0.5 不实现**, 待使用深度证明需要时再迭代添加。

```
~/.peaks/                       ← 本次 Slice 0.5 实际产出
├── config.json                 ← 只剩 1 个 key: { "version": "2.0.0" }
└── config.json.1.x.bak         ← 旧字段全量保留为备份, 供将来取回
```

```
~/.peaks/                       ← 未来 (deferred, 按需迭代, 不在本次 slice 范围)
├── config.json                  (本次产出)
├── credentials.json            ← deferred: 真出现 tokens / api keys 需求时再加 (0600)
├── providers.json              ← deferred: 真出现多 provider 配置需求时再加
├── network.json                ← deferred: 真出现 proxy / dns 需求时再加
└── workspaces/                 ← deferred: 真出现多 workspace 切换需求时再加
    └── <workspace-name>.json
```

#### Slim `config.json` schema 2.0 (只 1 个 key)

```json
{
  "version": "2.0.0"
}
```

**对比**:

| 阶段 | key 数 | 内容 |
|---|---|---|
| 1.x (当前) | 10 | version / currentWorkspace / workspaces / language / model / economyMode / swarmMode / tokens / providers / proxy |
| **2.0 (本次)** | **1** | **version** |
| 2.x+ (deferred, 按需) | 1 + 按需 | 仅当真需求出现时加字段 / 拆文件 |

**字段去向 (1.x → 2.0)**:

| 1.x 字段 | 2.0 去向 |
|---|---|
| `version` | **保留** (`~/.peaks/config.json`) |
| `currentWorkspace` | 移除 (从 `~/.peaks/workspaces/` 推导或运行时检测); 备份在 `.1.x.bak` |
| `workspaces` | 移除 (deferred 设计); 备份在 `.1.x.bak` |
| `language` | 移除 (默认 "en", 真有 i18n 需求时再加); 备份在 `.1.x.bak` |
| `model` | 移除 (运行时由 AI agent harness 决定); 备份在 `.1.x.bak` |
| `economyMode` | **迁移**到 `<workspace>/.peaks/preferences.json` (per-project) |
| `swarmMode` | **迁移**到 `<workspace>/.peaks/preferences.json` (per-project) |
| `tokens` | 移除 (deferred credentials.json 设计); 备份在 `.1.x.bak` |
| `providers` | 移除 (deferred providers.json 设计); 备份在 `.1.x.bak` |
| `proxy` | 移除 (deferred network.json 设计); 备份在 `.1.x.bak` |

**核心原则**: 任何 1.x 字段都不丢——要么 (a) 保留, 要么 (b) 迁移到 project-local, 要么 (c) 归档到 `.1.x.bak` 等需要时取回。

### 8.4 整改后 `.peaks/` 结构 (project-local)

```
.peaks/
├── PROJECT.md                          ← 不动
├── preferences.json                    ← NEW: 项目级偏好 (含 uaPrompt / agentShieldPrompt / classifyRules / economyMode / swarmMode)
├── _state/                             ← NEW: 收纳一次性决策 dotfiles
│   ├── peaks-init-hooks-decision.json
│   ├── peaks-openspec-opt-in.json
│   └── ua-detection.json               ← NEW (UA install 检测结果)
├── _runtime/                           ← 整改: TTL 自动清理
│   └── <sessionId>/
│       ├── rd/, qa/, ui/, sc/, ...    (现有)
│       ├── red-lines/                  ← NEW: L3 HIGH severity 落地
│       └── advice/                     ← NEW: L3 MEDIUM severity 落地
├── _sub_agents/                        ← 整改: 删畸形 sid, 加 naming guard
│   └── <sessionId>/                    (严格符合 two-axis convention)
├── _archive/                           ← 整改: 按 yyyy-mm/ 分目录
│   └── <yyyy-mm>/
│       └── <sessionId>/
├── issues/                             ← 不动
├── memory/                             ← 不动 (fuzzy-matching slice 解检索)
├── retrospective/                      ← 不动
├── project-scan/                       ← 不动
├── perf-baseline/                      ← 不动
└── sops/                               ← 不动
```

#### `preferences.json` schema (项目级, peaks-cli 2.0)

```json
{
  "schema_version": "2.0.0",
  "economyMode": true,
  "swarmMode": true,
  "uaPrompt": "unset",
  "agentShieldPrompt": "unset",
  "classifyConservatism": "default",
  "classifyRules": {
    "feature_threshold_files": 10,
    "feature_threshold_lines": 100
  }
}
```

`uaPrompt` / `agentShieldPrompt` 取值: `unset` | `skip-this-session` | `skip-forever`

### 8.5 配套 CLI 命令

| CLI | 作用 |
|---|---|
| `peaks workspace clean --runtime --older-than 7d --apply` | 清理过期 `_runtime/<sessionId>/`, 移到 `_archive/yyyy-mm/` |
| `peaks workspace clean --sub-agents --invalid --apply` | 删除畸形 sid 目录 (`sid-3` / `sid-h` / `unknown-sid` 等) |
| `peaks workspace archive --session <sid> --apply` | 手动把 session 从 `_runtime/` 归档到 `_archive/yyyy-mm/` |
| `peaks config migrate --from 1.x --to 2.0 --apply` | global config schema 升级 (config.json 拆分到 4 个文件) |
| `peaks config migrate --dry-run` | 预演迁移, 不写盘 |
| `peaks preferences set --key <k> --value <v>` | 项目级 preferences 增改 |
| `peaks preferences get --key <k>` | 读项目级 preferences |
| `peaks preferences reset --key <k>` | 删 override 回到默认 |

### 8.6 Migration 流程 (1.x → 2.0, YAGNI 版)

```
peaks config migrate --from 1.x --to 2.0 --dry-run    # 预演
  │
  ▼
读 ~/.peaks/config.json (1.x, 10 个 key)
  │
  ├─→ economyMode + swarmMode → 对当前 workspace, 写入 <workspace-path>/.peaks/preferences.json
  │   (只迁这两个 per-project 字段, 其它一律归档)
  │
  ├─→ 全量复制原文件到 ~/.peaks/config.json.1.x.bak
  │
  └─→ 新 ~/.peaks/config.json 只写 { "version": "2.0.0" }

peaks config migrate --from 1.x --to 2.0 --apply        # 真正执行
peaks config rollback --to 1.x                          # 回退 (恢复 .bak)
```

**关键约束**:
- 不主动设计 credentials / providers / network / workspaces 抽象 (deferred)
- 不丢任何 1.x 字段 (全量 .bak 保留)
- per-project 字段 (economyMode / swarmMode) 迁移到 `.peaks/preferences.json`
- 其它字段躺在 `.1.x.bak` 里, 等真需求出现时再加 CLI 取回

### 8.7 Naming guard (复用 L2 audit 机制)

新增一条 L2 red line: `.peaks/_sub_agents/` 下不允许 bare sid (`sid-3` / `sid-h` / `unknown-sid` 等), **必须**是 `<yyyy-mm-dd>-session-<6chars>` 格式 (符合 two-axis naming convention)。

- 静态检查: `peaks audit red-lines` 扫到立即报告
- 运行时检查: `peaks workspace init` / `peaks sub-agent dispatch` 路径校验, 写畸形 sid 直接拒绝
- 清理工具: `peaks workspace clean --sub-agents --invalid --apply` 删畸形目录

这条 red line 归到 L2.1 P0 (因为它违反 SKILL.md §0 强调的核心 naming convention)。

---

## 9. 10-Slice 实施路径

| # | Slice | 范围 | 时间 | 依赖 |
|---|---|---|---|---|
| 1 | **fuzzy-matching** (T4-T8 剩余) | memory/retro fuzzy CLI | 3-5h | (在飞) |
| **0.5** | **Workspace & Config Reorg (YAGNI)** | `~/.peaks/config.json` 瘦到只剩 `version` + `.peaks/` 加 `_state/` 和 `preferences.json` + migration CLI + naming guard。**不**实现 credentials.json/providers.json/network.json/workspaces/ (deferred) | 1 天 (YAGNI 化后减时) | #1 |
| **0.7** | **Hermes + OpenClaw IDE Adapter** | 新增 `hermes-adapter.ts` + `openclaw-adapter.ts` + `IdeId` 类型扩展 + adapter registry 注册 + 4 个 smoke test (audit/classify/doctor/sub-agent dispatch) per platform | 1 天 (按 ide-types.ts 注释 "填表"工作量) | 无 |
| 2 | **L1a + L1b** | 任务分级 + gate set 全 5 级 | 1-2 天 | #0.5 (依赖 `preferences.json` 存 classifyRules) |
| 3 | **L1c** | context 4-layer + 加载策略 | 1-2 天 | #1 fuzzy-matching, #0.5 |
| 4 | **L2.1 P0 + audit 框架** | 8-12 P0 red lines + `peaks audit red-lines` CLI + 包含 §8.7 sub-agent naming guard | 2-3 天 | #0.5 (audit 要扫到 `.peaks/_sub_agents/`) |
| 5 | **L2.2 P1** | 10-15 P1 red lines | 2-3 天 | #4 |
| 6 | **L2.3 P2-a** | 25-40 P2 red lines + ECC AgentShield 集成 | 2-3 天 | #4 |
| 7 | **L2.4 P2-b** | 25-40 P2 red lines + audit 回归 | 2-3 天 | #4 |
| 8 | **L3.1 UA 集成 + 退化版基础设施** | UA detection + 选装 UX + 内置 codegraph fallback | 2-3 天 | #4, #0.5 (依赖 `preferences.json:uaPrompt`) |
| 9 | **L3.2 项目医生 MVP** | 1-2 个诊断器 + ECC agent 编排 + JSON 输出 + severity router | 2 天 (因为复用 ECC, 不写诊断器) | #4, #8 |
| 10 | **L3.3 OpenSpec 集成** | CRITICAL → proposal 草稿生成 | 1-2 天 | #9 |
| **11** | **peaks-doctor SKILL.md** | 新增 peaks-doctor skill (orchestrate L3) + references/ + skill runbook 验证 | 1-2 天 | #9 (L3.2 落地后才能编排) |
| **12** | **Skill Family Alignment Pass** | 全 12 SKILL.md 整体复检: task-level frontmatter / CLI-back 注解 100% 覆盖 / loadStrategy on-demand 标注 / 800-line 上限 / `peaks skills sync` 8 平台分发 / **outputStyle: peaks-concise-v1 frontmatter 100% 覆盖 + `peaks audit output-style` 静态扫** | 2-3 天 | #2, #3, #4-#7 (各 slice 已陆续触动 skills, 这里收尾对齐) |
| **13** | **Swarm Algorithm Upgrade** | 5 个模式落地: 13.1 DAG dispatch (`peaks swarm plan`) / 13.2 Pipeline (`peaks swarm pipeline`) / 13.3 Speculative (`peaks swarm dispatch --speculative`) / 13.4 Adversarial verify (`peaks swarm verify --skeptics N`) / 13.5 Loop-until-dry (`peaks swarm loop --until-dry`) | 3-4 天 (5 个 sub-feature, 每个 0.5-1 天) | #2 (L1b task-level 是输入), #9 (L3 doctor 用 13.5 收敛) |
| **14** | **Agent Loop Integration (L4)** | 5 个 sub-feature: 14.1 distill (`peaks loop distill`) / 14.2 preflight (`peaks loop preflight`) / 14.3 pattern (`peaks loop detect-pattern`) / 14.4 consistency (`peaks loop check-consistency`) / **14.5 autonomous via `/goal` (`peaks goal compose`)** | 2.5-3.5 天 (5 个 sub-feature) | #1 fuzzy-matching, #9 L3.2 (pattern→severity router), #0.7 IDE adapter (goalCommand capability) |

### 9.1 并行优化后 critical path

```
#1 fuzzy-matching ──→ #3 L1c
   #2 L1a+L1b
   #4 L2.1 + audit 框架 ──┬──→ #5 L2.2
                          ├──→ #6 L2.3 (并行)
                          ├──→ #7 L2.4 (并行)
                          └──→ #8 L3.1 (并行)
   #8 L3.1 ──→ #9 L3.2 ──→ #10 L3.3
```

**串行 critical path: #1 → #3 → 然后 #4 → #8 → #9 → #10 = ~12-15 天**
**总工作量: ~18-26 天 (含并行不在 critical path 上的 #2/#5/#6/#7)**

### 9.2 每个 slice 独立可交付

每个 slice 完成后:
- 走完 RD → QA → TXT compact handoff 全套
- commit 到 main (复用 dev-preference.md identity + 红线)
- 写 retrospective
- 进入下一个 slice

不允许"为了搭后续 slice, 先把这个 slice 不交付就开始下一个"。

### 9.3 AI 24/7 自主执行估时 (full-auto mode)

§9 主表 (17-22 天) 是**人类日历估时** (8h/5d, 含 review/approval 等待)。在 **AI 24/7 自主 + full-auto** 模式下, 估时大幅压缩:

#### 6 个加速因子

| 因子 | 倍数 |
|---|---|
| 24/7 vs 8h/5d 时钟扩展 | 4.2x |
| L1 task-level gate skip (typo/bug 跳大半 gate) | 1.5-2x |
| Slice 13 swarm DAG + pipeline (真并行) | 1.5-2x |
| L4 preflight (5+ slice 后复用 lesson) | 1.2-1.3x |
| L1c context 分层 + headroom (减 retry) | 1.1x |
| full-auto mode (不等 user confirm) | 1.5-2x |

**复合**: 比人类日历估时 **5-10x 更快**。

#### 三种估时对比

| 模式 | Critical path | 假设 |
|---|---|---|
| **人类日历** (原 §9 主表) | 17-22 天 | 8h/5d, 串行 review |
| **AI 24/7 串行 full-auto** | ~2-3 天 | 不间断, 不等 review, 串行 slice |
| **AI 24/7 并行 full-auto** | ~1-1.5 天 | 并行子 slice + swarm DAG, critical path ~24-36h |
| **AI 24/7 + `/goal` autonomous** | **~16-24 小时** | 上面 + 借力 Claude Code `/goal` (Slice 14.5), 无 turn 间手动 continue |

#### 不可消除瓶颈 (即使 AI 24/7)

1. **真测试运行 wall-clock**: pnpm install / tsc / vitest 每次 30s-3min, 不可压缩
2. **外部服务延迟**: UA install 网络 / headroom proxy / ECC AgentShield 安装
3. **真 dogfood 验证**: dev-preference.md "dogfood-on-every-adjustment" 红线强制, 不可跳

**绝对地板 ≈ 1 天 (24h)** — 含必跑的 wall-clock 工作。

#### 执行模式选择

| Profile | 触发 | 适用 |
|---|---|---|
| `full-auto` | `peaks-solo` 启动时选 | AI 24/7 自主, 不等 confirm, 适合本场景 |
| `swarm` | `peaks-solo` 启动时选 | 并行 sub-agent, 跟 full-auto 复合 |
| `assisted` | 默认 | 人在环, 每个 gate 等 confirm |
| `strict` | 高风险任务 | 严格 confirm, 不跳任何 gate |

**本设计目标用户场景**: `full-auto` + `swarm` 复合, 配合 Slice 13 swarm DAG + L4 preflight, 接近 1 天地板。

---

## 10. Acceptance Criteria

### 10.1 L1 验收

- [ ] `peaks classify --json` 给任意 diff 产出 default 任务级别, 信号来源可追溯
- [ ] 5 个 task level 各自有 gate set 定义, `peaks slice check` 按级别跑不同 gate
- [ ] `peaks classify override --level <level>` CLI 校验 override 合理性 (反例可拒绝)
- [ ] `peaks classify upgrade --reason "<text>"` LLM 可申请, audit log 记录
- [ ] `peaks classify downgrade` CLI 永远拒绝
- [ ] context 体积按 task level 实测分布在 §4.3 表格预期范围 (±30%)
- [ ] 改个 bug 的 critical path 从当前 ~30 分钟降到 ~7-10 分钟 (dogfood 实测)

### 10.2 L2 验收

- [ ] `peaks audit red-lines --json` 扫所有 SKILL.md / dev-preference.md / .claude/rules, 产出 cliBacked/partial/prose-only 分类
- [ ] L2.1 完成时, 8-12 P0 red lines 状态从 `prose-only` 变 `cli-backed`
- [ ] L2.4 完成时, prose-only 比例 < 10% (从当前 ~50% 降下来)
- [ ] ECC AgentShield 集成 dogfood pass: 装 ECC 时 L2 用 AgentShield, 不装时退化版能跑
- [ ] LLM 偷懒尝试 dogfood: 故意让 LLM 跳过单测, `peaks slice check` 直接拒绝 commit

### 10.3 L3 验收

- [ ] `peaks doctor scan --json` 输出符合 §6.3 schema, severity 分布合理
- [ ] `peaks doctor route` CRITICAL 生成 `openspec/changes/<date>-doctor-<id>/proposal.md`, 需人审 promote
- [ ] HIGH 写入 `.peaks/_runtime/<sid>/red-lines/`, 下次 task 启动时被 L0 context 加载
- [ ] UA 未装时 4 选项 UX 触发, 用户选 a 后显示精确 install 命令
- [ ] UA 装了之后 `peaks doctor` 自动检测并用 UA graph
- [ ] L3 MVP 触发时机正确 (typo 不跑, feature 必跑, bug 抽样)
- [ ] `peaks doctor preferences --reset-ua-prompt` 能重启 UA 选装询问

### 10.4 Workspace & Config 验收

- [ ] `peaks config migrate --dry-run` 预演迁移, 字段映射可追溯, 不写盘
- [ ] `peaks config migrate --apply` 真正执行后: 旧 `config.json` 全量备份为 `config.json.1.x.bak` (零字段丢失), 新 `config.json` 只含 `{ "version": "2.0.0" }`
- [ ] `economyMode` / `swarmMode` 字段从 global 迁移到当前 workspace 的 `.peaks/preferences.json`
- [ ] 其它 1.x 字段 (`currentWorkspace` / `workspaces` / `language` / `model` / `tokens` / `providers` / `proxy`) **不出现**在新 `config.json` 中, 但全量保留在 `.1.x.bak`
- [ ] `peaks config rollback --to 1.x` 能从 `.1.x.bak` 完整恢复原 `config.json`
- [ ] `.peaks/preferences.json` 创建并含 economyMode / swarmMode / uaPrompt / agentShieldPrompt / classifyConservatism / classifyRules
- [ ] `peaks workspace clean --runtime --older-than 7d --apply` 把过期 session 从 `_runtime/` 移到 `_archive/<yyyy-mm>/<sid>/`
- [ ] `peaks workspace clean --sub-agents --invalid --apply` 删除所有 bare sid (sid-3 / sid-h / unknown-sid) 目录 (实际是移动到 `_archive/invalid-sids/`)
- [ ] `peaks workspace init` 路径校验拒绝写非 two-axis convention 的 sid
- [ ] `peaks audit red-lines` 扫到 `.peaks/_sub_agents/` 下的畸形 sid 立即报告
- [ ] dogfood: 在 peaks-cli 本仓库跑全套迁移, `~/.peaks/config.json` 缩到 1 个 key, `.peaks/preferences.json` 正确写入, 旧 session 归档到 `_archive/2026-06/`
- [ ] **YAGNI 验证**: Slice 0.5 不产出 `credentials.json` / `providers.json` / `network.json` / `workspaces/` 任何文件 (这些是 deferred)

### 10.5 整体验收

- [ ] 在后端架构薄弱场景做 dogfood (例如新增一个 Express API), 验证 L3 项目医生输出对用户有价值 (减少 #1 项目盲区被动感)
- [ ] 在改 typo 场景做 dogfood, 验证 L1 typo-gate 在秒级完成 (减少 #3 慢)
- [ ] 故意让 LLM 偷懒 (跳过测试, 跳过 review), 验证 L2 CLI 兜底 (减少 #2 偷懒)
- [ ] 在 feature 场景做 dogfood, 验证 context 体积按 L1c 分层分布, 不爆 (减少 #4 失控)
- [ ] **多平台 smoke test**: `peaks audit red-lines` / `peaks classify` / `peaks doctor scan` / `peaks sub-agent dispatch` 在以下 8 平台都能跑且 JSON 符合 schema:
  - [ ] claude-code (已注册)
  - [ ] codex (已注册)
  - [ ] trae (已注册)
  - [ ] cursor (已注册)
  - [ ] qoder (已注册)
  - [ ] tongyi-lingma (已注册)
  - [ ] **hermes** (Slice 0.7 新增)
  - [ ] **openclaw** (Slice 0.7 新增)

### 10.6 Skills 整改验收

- [ ] 13 个 SKILL.md (12 现有 + 1 新增 peaks-doctor) 全部 ≤ 800 行
- [ ] 每个 SKILL.md frontmatter 含 `applicableTaskLevels` 字段
- [ ] 全 ~80 references 的 frontmatter 含 `loadStrategy: always | on-demand` 字段
- [ ] `peaks audit red-lines` 报告所有 MANDATORY/BLOCKING 100% 有 `CLI-enforced-by` 注解 OR 显式归入 P0/P1/P2 backlog
- [ ] `peaks skill runbook peaks-doctor --json` 校验通过
- [ ] `peaks skill doctor --json` 35 项检查全绿
- [ ] `peaks skills sync --ide all --dry-run` 8 平台分发预演无错误
- [ ] dogfood: 在 peaks-cli 仓库执行 `peaks skills sync --ide claude-code --apply`, 验证 `~/.claude/skills/peaks-*/SKILL.md` 与仓库 skills/ source 字节一致
- [ ] dogfood: 在另一平台 (例如 cursor) 执行同步, 验证分发格式适配
- [ ] **每个 SKILL.md frontmatter 含 `outputStyle: peaks-concise-v1`**
- [ ] **`peaks audit output-style --json` 100% 通过** (无空话模板 / 无客套寒暄 / status header 在场)

### 10.7 Headroom-AI 扩展验收

- [ ] `peaks memory search --use-headroom --json` 返回压缩 entry, `tokensSaved > 0` 且 `compressed: true` (proxy 可用时)
- [ ] `peaks retrospective search --use-headroom --json` 同上
- [ ] `peaks doctor scan --compress-output --json` evidence 字段比未压缩版小
- [ ] `peaks doctor route --compress-proposal-draft` 生成的 openspec proposal 草稿比未压缩版小
- [ ] **退化保底**: 故意把 headroom proxy 杀掉, 所有上述命令仍能跑且 `warning: HEADROOM_UNAVAILABLE`, **不阻塞**
- [ ] `peaks preferences set headroomEnabled false` 后所有触点不再调 headroom (验证 preference 生效)
- [ ] **task-level 自动模式**: typo 不触发, refactor 用 aggressive, migration 用 aggressive (memory/retro) + conservative (doctor)
- [ ] dogfood: 在 peaks-cli 仓库跑一次 feature gate, 测量主循环 input token 总量降低 ≥ 15% (基准: 关 headroom 跑一次, 开 headroom 跑一次, 对比)

### 10.8 Swarm Algorithm 升级验收

- [ ] `peaks swarm plan --content <prd-id> --json` 按 PRD 内容派生 DAG (含 nodes / edges / 拓扑序), 不再固定 3-way
- [ ] `peaks swarm pipeline --stages "rd,qa,review"` 每个 item 独立穿过多阶段, fast item 不等 slow item (dogfood 实测 wall-clock < sum-of-stage-max)
- [ ] `peaks swarm dispatch --speculative --kill-if-unused` 启动后预测命中率 ≥ 70%, 误启动的 sub-agent 被 kill 不浪费下游
- [ ] `peaks swarm verify --skeptics 3 --consensus 2` 对 L3 doctor CRITICAL finding 强制 3-skeptic 投票, 单 skeptic 反对不阻塞
- [ ] `peaks swarm loop --until-dry --max-rounds 5` L3 doctor 收敛后停, 不跑满 5 轮
- [ ] **效果验收**: 改 bug critical path 从 ~30 分钟降到 ~7-10 分钟 (dogfood 实测, 比 Slice 2 L1+L1b 单独的效果再降 30%+)
- [ ] **效果验收**: feature 任务的总耗时从 hours 降到 ≤ 1 小时
- [ ] 5 个 swarm CLI (`plan` / `pipeline` / `dispatch --speculative` / `verify` / `loop`) 每个有独立单测 + 集成测试
- [ ] 不引入新 runtime 依赖 (5 个模式纯算法实现, 不 import LangGraph / CrewAI / 等)

### 10.9 Agent Loop (L4) 验收

- [ ] `peaks loop distill --rid <rid> --apply --json` slice 完成后自动汇总, 输出 `lessonsCreated > 0` (有有效内容时), `lessonsMerged > 0` (有相似 lesson 时), 不丢关键 evidence (sample 10 个对比, 100% 保留 evidence)
- [ ] `peaks loop preflight --rid <rid> --task-level <level> --json` slice 启动时注入相关 retrospective, **命中率 ≥ 60%** (在跑过 5+ slice 后), `tokensSavedEstimate > 0`
- [ ] `peaks loop detect-pattern --threshold 3 --json` 同类失败 ≥ 3 次时识别 pattern, `severity` 合理, `suggestedFixes` 不空; **false-positive < 20%** (跑 20 个测试场景, ≤ 4 个误报)
- [ ] `peaks loop check-consistency --rid <rid> --json` 当前决策跟历史 decision 矛盾时, CRITICAL 阻断 transition, HIGH 警告但允许; `--override` flag 可绕开 (但记录到 audit log)
- [ ] **联动验证**: slice 结束 → `peaks request transition done` 自动触发 14.1 distill + 14.4 consistency
- [ ] **联动验证**: slice 启动 → `peaks request init` 自动触发 14.2 preflight
- [ ] **联动验证**: 14.3 pattern detection 输出的 CRITICAL pattern 进入 L3 doctor 路由 (生成 openspec proposal 草稿)
- [ ] **runaway 防护**: 14.5 autonomous 默认 disabled; preference `loopAutonomousEnabled: false` 生效
- [ ] **多平台 smoke**: 8 平台都能跑 `peaks loop distill/preflight/detect-pattern/check-consistency --json`
- [ ] dogfood: 在 peaks-cli 仓库跑 5 个连续 slice, 验证 (a) memory/lessons/auto-*.md 累积 (b) 5 slice 后 preflight 命中率从 0 升到 ≥ 60% (c) 跨 slice 决策一致性无矛盾
- [ ] `peaks goal compose --rid <rid> --json` 输出符合 `/goal` 条件格式, 含 (a) 完成判定信号 (b) "or stop after N turns" runaway 上限 (c) 退出条件清单
- [ ] adapter `goalCommand` capability 在 8 平台至少 1 个 (Claude Code) 实现完整; 其它平台返回 fallback (`peaks goal compose --output-only`)
- [ ] dogfood: 在 Claude Code 用 peaks 生成的 condition 跑 `/goal <cond>`, 验证 (a) autonomous 模式 ◎ 状态条出现 (b) 条件达成时自动 clear (c) `--resume` 后 condition 恢复

---

## 11. Risks

| 风险 | 级别 | 缓解 |
|---|---|---|
| UA upstream schema 变 | 中 | schema_version lock + 兼容层 |
| ECC AgentShield 升级 break | 中 | 锁定 major version, 升级前 dogfood 回归 |
| ECC 64 agents 输出格式异构 | 中 | L3 编排层做 adapter, 不同 agent 不同 parser |
| `peaks classify` 信号规则在某些项目不适用 | 中 | 允许 project-local override (`.peaks/preferences.json:classifyRules`) |
| L2 sub-slice 4 个跨度长, 中间被打断 | 高 | 每个 sub-slice 独立可交付, 中断不影响已交付的部分 |
| L1c context 分层精简过头致 LLM 漂移 | 高 | **由 L2 CLI gate 兜底**, 不靠 context (本设计核心理念) |
| 用户拒绝装 UA 后体验差 | 低 | 退化版 codegraph 满足基础 L3 能力 |
| 用户拒绝装 AgentShield 后 L2 弱 | 低 | 退化版简单 lint 至少覆盖 P0 |
| L3 CRITICAL 误判炸 openspec 队列 | 中 | 默认人审 promote, 不会自动进 active |
| 10-slice 总工期 18-26 天太长 | 中 | 并行优化后 critical path ~12-15 天; 也可酌情停在 L1+L2.1 阶段先发布 |
| **Migration 1.x→2.0 破坏现有 workspaces** | **中** (降级, 因 YAGNI 化后 migration 只剩 economyMode/swarmMode 迁移) | `--dry-run` 强制预演; `--apply` 全量备份 `config.json.1.x.bak` (零字段丢失); 提供 `peaks config rollback --to 1.x` 一键还原 |
| **`peaks workspace clean --runtime --apply` 误删活跃 session** | **高** | 默认 dry-run; `--apply` 前列出待清理 sid; 检测最近活跃心跳; 拒绝清理 < 24h 的 session |
| **畸形 sid 删除影响历史追溯** | 中 | `_sub_agents/<bare-sid>/` 删之前先移到 `_archive/invalid-sids/`; 不直接 rm |
| **用户后续真有 tokens/providers/proxy 需求, 但被 .bak 锁住** | 低 | 提供 `peaks config restore --field <name>` 单字段从 `.1.x.bak` 取回; deferred 文件 (credentials.json 等) 真要时迭代加, 不阻塞 |
| **用户已有自定义 schema (例如手改过 config.json)** | 低 | migration 全量备份, 不解析未知字段; deferred 设计本身已对未知字段宽容 |
| **多平台 (8 个 IDE) 行为漂移** | 中 | 平台无关组件占 11/16, 跨平台风险已大幅压低; adapter 5 个触点全部有 smoke test 兜底; 新增 adapter 强制走 "填表" 标准化模板; CI 跑全 8 平台矩阵 |
| **Hermes / OpenClaw adapter 信息不足** | 中 | Slice 0.7 启动时先做调研 (查官方 settings 路径 / env 变量 / hook 接口); 若信息不足允许 MVP 实现 (gate enforce + settings only, sub-agent dispatch 退化) |
| **UA 在某些平台不支持 (例如 Hermes / OpenClaw)** | 低 | L3 默认走 UA + 退化版 fallback (内置 codegraph); 不强制每个平台都跑 UA |
| **Skills 整改让现有 12 个 SKILL.md 同时 churn** | 高 | 整改分散到 #2/#3/#4-#7 各 slice 中触动相关部分, #12 做收尾对齐; 不一次性重写; 每个 slice 内的 skill 改动有独立 dogfood |
| **`peaks skills sync` 把 source 同步覆盖用户本地修改** | 中 | `sync` 默认 dry-run; `--apply` 前 diff 用户本地与 source, 让用户确认; 提供 `--preserve-user-edits` flag |
| **per-platform skill 格式差异翻译失败 (例如 Cursor 的 .cursor-plugin)** | 中 | Slice 0.7 调研 Hermes/OpenClaw 时一并调研其它非 Claude 平台的 skill 格式; 翻译失败时报错并保留 Claude-Code 格式 |
| **peaks-doctor skill 新增后 peaks-solo 编排会变重** | 中 | peaks-doctor 仅在 feature/refactor/migration 触发 (typo/bug 不触发, L1b 控制); 让 sub-agent dispatch 替代 inline 执行 |
| **headroom-ai proxy 不可用让 L1c/L3 退化** | 低 | `fallback: true` 默认开, 不阻塞; warning `HEADROOM_UNAVAILABLE` 上报; preference `headroomEnabled: false` 全局关 |
| **headroom 压缩过度导致 memory/retro 检索精度下降** | 中 | per-task-level 选模式 (bug=conservative, refactor=aggressive); 用户可在 preferences 里 override; doctor route 默认 conservative |
| **Output Style 公约不能机器 100% 检查 (自然语言模式难穷举)** | 中 | `peaks audit output-style` 只检查可静态判定的 (空话模板 / 客套寒暄 / status header 缺失); 主观风格靠 review |
| **Swarm 5 个模式同时上手太复杂** | 中 | Slice 13 拆 5 个 sub-feature 渐进上线; 任何 sub-feature 出问题可单独 disable; 默认所有 swarm CLI 都有 `--legacy-fan-out` 退化到当前 3-way |
| **Speculative dispatch 浪费 token (误启动 sub-agent)** | 中 | `--kill-if-unused` 实时杀掉; preference `swarmSpeculativeMaxConcurrent: 2` 限制最大并发投机数; 命中率 < 50% 自动关闭 |
| **DAG dispatch 让 sub-agent 依赖关系复杂化, 调试难** | 中 | `peaks swarm plan --debug --visualize` 输出 DAG 图; 失败时 `peaks swarm replay --trace-id <id>` 重放; 默认 DAG 深度限制 4 层 |
| **Loop-until-dry 在病态项目下不收敛** | 中 | `--max-rounds 5` 硬上限; 单轮超时 60s; 用户可 `peaks swarm loop --abort` 手动中断 |
| **L4 distill 把 retrospective 压成 lesson 时丢 evidence** | 高 | distill 强制保留 evidence 段; sample 100% 检测; 用 headroom conservative mode (保精度); 可 `peaks loop distill --no-compress` 退化 |
| **L4 preflight 注入的 lesson 跟当前任务无关 (false hit)** | 中 | fuzzy 检索 top-K 限制 (默认 K=3); 用户可 `peaks loop preflight --no-inject` 跳过; preflight 命中数据进 audit log 可后期调阈值 |
| **L4 pattern detection 误报 (3 次同类不一定是 pattern)** | 中 | threshold 可调 (preference); pattern 走 doctor severity router, MEDIUM 仅建议不强制; HIGH/CRITICAL 才走 red-line/spec |
| **L4 consistency check 阻断 transition 误伤** | 高 | 默认仅 CRITICAL 阻断, HIGH 警告; `--override --reason "<text>"` 可绕但写 audit log; 每次 override 进 distill 学习 |
| **L4 autonomous (14.5) 万一被人开启后跑飞** | 中 | preference `loopAutonomousEnabled: false` 默认; 启用需 explicit confirm; max-iterations 硬上限; 失败 N 次后自动 disable; `peaks goal compose` 自动加 "or stop after 200 turns" inline 限制 |
| **`/goal` evaluator (Haiku) 误判 condition 满足** | 中 | peaks 生成的 condition 用客观 CLI 信号 (`peaks request status --json` exit 0 / `peaks slice check --json` green) 而非主观判断, 减少 Haiku evaluator 歧义 |
| **`/goal` 在非 Claude Code 平台无原生支持** | 中 | adapter `goalCommand` capability 在 Slice 0.7 调研; 真无等价的平台 fallback 到手动复制 condition 启动 |

## 12. Open Questions

1. **`peaks classify` 信号规则的初始 default 是否需要按项目类型微调?** (例如前端项目和后端项目的"feature" 阈值可能不同)
2. **ECC AgentShield 102 条规则跟 peaks-cli 自有 lint 规则的优先级冲突时, 谁覆盖谁?**
3. **L3 项目医生扫描多频繁? 每次 feature gate 触发, 还是按时间间隔 (每天/每 commit)?** (本 spec 暂定每次 feature gate; 可在 dogfood 后调)
4. **OpenSpec doctor-generated proposal 草稿是否要自动 archive 旧的同类 proposal?** (避免堆积)
5. **L1c context 分层中, 何时把 L3 检索结果"提升"到 L2 缓存?** (减少重复检索)
6. **`peaks classify upgrade --reason` 的 reason 文本质量怎么管控?** (防止 LLM 写"because I think so" 这种水文)
7. **dev-preference.md 的 commit-identity red line 在 L2 audit 中应该归 P0 还是单列?** (它跨多个 SKILL.md)
8. **`config.json.1.x.bak` 留多久才删?** (30 天? 永久? 用户可配置?)
9. **`preferences.json` 是否进 git?** (项目共享团队偏好 vs 个人偏好的边界)
10. **`_archive/` 累积无上限怎么办?** (是否要 `peaks workspace archive prune --older-than 90d`?)
11. **`_sub_agents/` naming guard 是否反过来兼容现有畸形 sid (sid-3 / sid-h)?** (本 spec 立场: 一律迁移到 `_archive/invalid-sids/`, 不兼容)
12. **deferred 文件 (credentials/providers/network/workspaces) 真要加时是 Slice 1.x 还是按需独立 slice?** (本 spec 立场: 按需独立 slice, 不预先排期)
13. **Hermes / OpenClaw 的 settings 文件路径 / env 变量 / hook 接口具体是什么?** (Slice 0.7 启动前的调研任务)
14. **`peaks classify` / `peaks doctor` 的输出 schema 是否在所有 8 平台保持二进制相同?** (本 spec 立场: schema 平台无关, IDE 字段是元数据)
15. **当用户在 Hermes 用 peaks-cli, 但项目里同时安装了 Claude Code 的 hooks 配置, 如何处理冲突?** (优先级: 当前活跃 IDE > 其它残留)
16. **多平台 CI 矩阵要不要全跑 8 个?** (8 × 各 slice 测试矩阵会很大; 建议 nightly 跑全量, PR 只跑当前 IDE)
17. **Skills 在 cursor/trae/qoder/tongyi-lingma/hermes/openclaw 等非 Claude-Code 平台的 skill format 是什么?** (Slice 0.7 调研 IDE adapter 时一并调研 skill 格式)
18. **`peaks skills sync` 是否要在 peaks-solo Step 0 自动触发, 还是手动?** (本 spec 倾向: 手动, 避免 startup 开销; 但若用户切平台后忘了 sync 会用旧 skill)
19. **peaks-doctor 是新建 SKILL.md, 还是合并到 peaks-qa 里作为 L3 sub-mode?** (本 spec 立场: 新建 SKILL.md, 因为 doctor 的工作不限于 QA 阶段)
20. **现有 ~80 references 中, 哪些应该升级为 `loadStrategy: always`?** (Slice 3 启动时需要逐个评估; 默认 on-demand)
21. **`peaks audit output-style` 检测规则集应该多严格?** (太严格会误报 prose 段落; 太松无效。本 spec 立场: 先实现 5-10 条最明显的模式检测, 看 false positive 比例再调)
22. **headroom-ai 是否应该自动为每个 sub-agent dispatch 都启用?** (本 spec 立场: 不自动, 因为 conservative mode 也可能影响 sub-agent 输出精度; 仍走 G7.7 opt-in)
23. **headroom 压缩比预期目标是多少?** (15% input token 节省是 conservative 目标; 实际 dogfood 数据可能更高或更低, 需调)
24. **DAG dispatch 的内容→图算法用什么?** (本 spec 立场: 启发式规则 + 项目 scan 信号; LLM 派生 DAG 太重 + 不可重复)
25. **Speculative dispatch 的"高概率"如何判定?** (Slice 13.3 启动前调研: 用历史相似任务 hit rate / 用 codegraph 依赖链 / 用 user pattern)
26. **Adversarial verification 3 skeptics 的 prompt 怎么差异化?** (避免 N 个相同 prompt 出 N 个相同 answer; 借鉴 Workflow 文档"perspective-diverse verify"模式)
27. **L3 doctor 用 loop-until-dry 收敛时, 什么算"空"?** (本 spec 立场: 无新 finding + 无 evidence 升级 + 无新 severity 跳变)
28. **L4 distill 的 lesson 抽取策略是什么?** (LLM 抽 vs 规则抽; 本 spec 立场: 规则抽 + LLM 仅做合并消歧, 避免 hallucination)
29. **L4 preflight 注入哪些 layer?** (注入 L0 永久太重; 注入 L2 任务最合理; 本 spec 立场: 默认 L2, preference 可调)
30. **L4 pattern detection 的 "同类失败" 怎么判定?** (用错误类型 + 涉及文件类型 + 决策 hash; 本 spec 立场: 三者交集 ≥ 2 才算同类)
31. **L4 consistency check 跟历史 decision 矛盾时, 默认 severity 是?** (本 spec 立场: 默认 HIGH 警告; CRITICAL 留给"违反 dev-preference.md red line" 场景)
32. **`peaks goal compose` 生成的 condition 措辞模板用什么?** (本 spec 立场: 客观 CLI 信号优先, e.g. "`peaks request status` exits 0 and 所有 slice transition 到 done")
33. **非 Claude Code 平台 (Cursor/Codex/Trae/Qoder/tongyi-lingma/Hermes/OpenClaw) 哪些有 `/goal` 等价机制?** (Slice 0.7 调研 IDE adapter 时一并调研 goalCommand capability)
34. **`/goal` 跨 session 恢复时 turn count 重置 (官方文档明确), 是否影响 14.5 inline runaway 限制 ("or stop after 200 turns")?** (本 spec 立场: 是, 重启后 200 turn 计数重置; 用户需要意识到这点)

## 13. Out of Scope (本设计明确不做)

- 不重写 peaks-solo / peaks-rd / peaks-qa / peaks-txt 等现有 skill (本设计在它们之上叠加新能力, 不替代)
- 不引入新的状态机替代 `peaks request transition` (沿用现有)
- 不做 web dashboard (UA 已有, 不重复造)
- 不做 MCP server (除非未来明确需要)
- 不做付费版 / 商业化 (peaks-cli 保持开源)
- L3 项目医生 MVP 阶段只做 1-2 个 peaks-cli 内置诊断器 (剩余靠 ECC agents 编排), 不做 ECC 之外的全套诊断
- **`~/.peaks/credentials.json` / `providers.json` / `network.json` / `workspaces/`** 是前瞻设计, **本设计 Slice 0.5 不实现**, 等真需求出现时再独立 slice 迭代加
- **不绑定任何单一 AI agent CLI** (peaks-cli 是 multi-platform orchestration 工具, 不是 Claude-Code-only)。所有 L1/L2/L3 核心组件必须通过 IDE 适配层 (`src/services/ide/`) 在 8 个目标平台上工作: claude-code / codex / trae / cursor / qoder / tongyi-lingma / hermes / openclaw。
- **不为某个平台单独优化** (例如不为 Claude Code 加 hard-coded path), 所有平台特异性走 adapter
- **不为现有 SKILL.md 做一次性重写** (整改分散到各 slice 中, Slice 12 做收尾对齐, 避免一次性 churn 12 个 skill 文件)
- **不替代现有 skill** (例如 peaks-doctor 是新增 skill, 不替代 peaks-qa)
- **不引入运行时 agent 框架依赖** (LangGraph / CrewAI / AutoGen / OpenAI Swarm 都不 import — peaks-cli 是 orchestrator of orchestration, 不跟平台 agent runtime 重叠。Slice 13 借用算法模式, 不引入运行时依赖)
- **不实现 BYOA (Bring Your Own Agent runtime)** — 用户用什么平台 (Claude Code / Codex / Cursor / ...) 就走平台的 agent runtime, peaks-cli 只生成 toolCall descriptor
- **L4 14.5 autonomous orchestration 借力 Claude Code 原生 `/goal`** — 不重写 turn chaining 引擎, peaks 只生成 condition 字符串; 非 Claude Code 平台 adapter 提供等价或 fallback (Slice 0.7 调研)
- **不做 self-modifying skill** (L4 pattern detection 输出建议而非直接改 SKILL.md; 改动走 openspec proposal 人审)
