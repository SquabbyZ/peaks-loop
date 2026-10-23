# peaks-loop 整体功能总览

> **版本**: v4.1.12 (`package.json` / `peaks --version` 一致)
> **生成日期**: 2026-10-20
> **代码图状态**: 本次会话已执行 `peaks codegraph index --project .` 刷新索引 —— **2,175 文件 / 38,984 节点 / 105,341 边 / 124.21 MB**(SQLite WAL),`peaks codegraph status` 复验后无 pending modified 文件。
> **本文档性质**: 功能面说明书,不是缺陷诊断书,也不排优先级。文中每个数字都可按文末「事实来源」一节复算。

---

## 0. 一句话定位

peaks-loop 是一个 **Loop Engineering 结晶系统**(Loop Engineering crystallization system),而不是一个工作流工具 —— 它把真实完成过的工作**结晶**成可复用的资产,并只允许通过 karpathy 工程化红线 + darwin 式独立评估来**演化**这些资产。

它装在用户**已经在用**的 AI 编程工具(Claude Code / Codex / Copilot / Cursor / Trae / Z Code 等)之上,**不抢** shell、prompt、IDE。用户只有两种交互形态:**说一句话**,或**在一个选项里挑一个**。所有 CLI 调用由 LLM 代跑。

三层定位,按权威性从高到低:

| 定位 | 落点 | 含义 |
|---|---|---|
| 产品定位 | `.peaks/memory/peaks-loop-positioning-loop-engineering.md` | 结晶系统,不是 workflow tool |
| 场景定位 | `.peaks/memory/peaks-cli-24h-ai-programmer-positioning.md` | 24h 不停产的 AI 程序员编排器;用户是**业务/产品审阅者**,不参与技术决策 |
| 领域边界 | `.peaks/standards/loop-engineering-guidelines.md` **RL-8** | `peaks-code` 只管代码域;其他域各自是独立 `peaks-*` skill,**不是** peaks-code 的变体 |

---

## 1. 技能家族(23 个 SKILL.md)

`skills/` 目录下共 **23 个 `SKILL.md`**,分两层:

### 1.1 面向用户的一层(14 个,`skills/<name>/SKILL.md`)

用户通过斜杠命令直接触发。**这一层是产品表面**。

| Skill | 作用 | 触发 |
|---|---|---|
| `peaks-solo` | 分诊员。用户用自然语言描述诉求但不知道选哪个 skill 时,由它读 `peaks skill search` 派发到叶子 skill | "帮我处理这个" |
| `peaks-code` | 代码域编排器(本次会话所在 skill)。PRD → RD → 实现 → QA → UI → 切片 | `/peaks-code` |
| `peaks-content` | 内容域编排器:草稿 → 编辑 → 调性 → 发布 → 归档 | `/peaks-content` |
| `peaks-doctor` | 项目体检:红线审计 + L3 doctor + 转 OpenSpec | `/peaks-doctor` |
| `peaks-issue-fix-orchestrator` | 批量修 upstream open issue:调研 → 分类 → 参考 PR → 修复 + commit + PR 草稿 | `/peaks-issue-fix-orchestrator` |
| `peaks-sop` | 把自然语言描述的流程沉淀成可执行 SOP(带可检查的门禁) | `/peaks-sop` |
| `peaks-audit` | 6 维审计 + 用户认可的 goal,RD/QA 之前的强制入口 | `/peaks-audit` |
| `peaks-final-review` | 4 维业务验收证据:功能完整 / 问题解决 / 不引入新 bug / 不破坏既有 | `/peaks-final-review` |
| `peaks-ide` | IDE 适配:装 / 切 / 查 / 卸 hooks + statusline | `/peaks-ide` |
| `peaks-resume` | 通用续跑原语:找最深的已完成门,AskUserQuestion | `/peaks-resume` |
| `peaks-status` | 通用状态原语:一屏表格 | `/peaks-status` |
| `peaks-test` | 通用跑测原语:跑对了套件并诚实报结果 | `/peaks-test` |
| `peaks-slice-decompose` | 多 pass 切片拆解 + 跨 pass 边 + LLM 仲裁轨迹 | `/peaks-slice-decompose` |
| `peaks-race-code` | 快速通道:小改动直接改,无子代理、无文书 | `/peaks-race-code` |

### 1.2 角色一层(9 个,`skills/bee/<name>/SKILL.md`)

**LLM 内部角色,用户不直接调用** —— 由 `peaks-code` 通过 `peaks sub-agent dispatch <role>` 派发。

| 角色 | 职责 |
|---|---|
| `peaks-prd` | PRD / 目标 / 非目标 / 验收标准 / 产品变更提案 |
| `peaks-rd` | 工程分析、重构规划、项目扫描、代码标准、UT 覆盖门禁、实现契约、任务图 |
| `peaks-qa` | UT 覆盖证据、回归矩阵、基线报告、验证报告、验收门禁 |
| `peaks-ui` | UI/UX、交互设计、视觉方向、设计系统、前端页面行为 |
| `peaks-sc` | 变更影响、资产留存、同步状态、回滚证据 |
| `peaks-txt` | 上下文胶囊、决策记录、假设、废弃选项、陈旧检查、教训 |
| `peaks-security-audit` | 独立安全审计(OWASP Top-10 + 8 维威胁模型) |
| `peaks-perf-audit` | 独立性能审计(6 维) |
| `peaks-reviewer` | 第三方独立代码评审(缓解单 LLM 自审盲区) |

---

## 2. CLI 命令面(124 个顶层命令)

`peaks --help` 实测 **124 个顶层命令**。全部对 LLM 开放、对用户隐藏 —— 用户永远不需要背。按能力域归并:

### 2.1 编排与切片

| 组 | 命令 |
|---|---|
| 路由 / 干跑 | `route` `autonomous` `autonomous-resume` `swarm` `swarm-plan` `swarm-plan-change-id` `autonomous-swarm` `recommend` `tech` `tech-plan` `tech-status` `refactor` `capability` `capabilities` |
| 工作流图 | `workflow`(init / graph / node / terminalize / plan / run / lint / verify-pipeline / skip) |
| 切片 | `slice`(check / decompose / pick / plan / ls) `contract` `evidence` `impact` `smoke` |
| 任务(job) | `job` `spill-demo` `outer-cache` |

### 2.2 角色产物与状态机

`request`(init / list / show / retag / transition / lint / repair-status / mark-qa-initiated)—— 每个角色产物有**独立状态机**,`peaks request transition` 是唯一的合法推进器。

`prd → confirmed-by-user → handed-off`;`rd → spec-locked → implemented → qa-handoff → handed-off`;`qa → running → verdict-issued`。

产物落盘在 `.peaks/_runtime/<sessionId>/<role>/requests/<rid>.md`,**评审态产物一律带 rid 文件名后缀**(防同一 session 内两个切片互相覆盖证据)。

### 2.3 门禁与红线

| 组 | 命令 |
|---|---|
| 门禁执行 | `gate`(SOP 门禁的 PreToolUse handler) `gate-classify` `code-gate` `sub-agent-dispatch-guard` `hook` `hooks` |
| 用户触点 | `user-touchpoints` `commit-boundary-actions` `slice-review/-score/-accept/-reject` `qa-business-review/-score/-accept/-reject` `slice-integrate` |
| 能力基线 | `baseline`(freeze / list / show / run-guard / diff / audit / freeze-update / rollback / reset) |
| 裁决 | `verdict` `prepare-final-review` `changeset` |
| 走查 | `doctor`(88 项检查)、`skill doctor`、`doctor` 绑定探针 |

### 2.4 资产 / 沉淀 / 演化

`loop`(distill / preflight / detect-pattern / check-consistency / export / import / eval / check-monotonic / spec / run)、
`asset`(crystallize / dispose / status)、
`evolution`(propose / evaluate / mark-keep / revert / status)、
`bee`(export / import)、`skill sediment`(沉淀池)、`share` —— 这几组构成 **4 层资产模型**的 CLI 面(见 §4)。

### 2.5 执行与隔离

`sub-agent`(派发原语) `worktree`(spawn / release / renew / gc / lease-status / auth) `container` `cron` / `cron-scheduler` `lease-metrics` / `lease-stats` `heartbeat` `runtime`(detect / list / compact) `adapter`(list / register) `vendor-detect` `polyrepo` `fixture`。

### 2.6 环境与集成

`codegraph`(status / init / index / query / files / context / affected / repair-*) `mcp`(serve / install / uninstall) `openspec` `shadcn` `web` `browser` `playwright` `best-practice-scan` `fresh-context` `context` `classify` `comments` `legacy-detect` `complexity-estimate` `lint` `log` `mut` `strat` / `tact` `perf` `e2e` `test` `release` `fork` `doc` `role`。

### 2.7 自然语言入口(5 个)

`make <goal>` `learn <kind>` `check <target>` `run <workflow>` `ask <question>` —— 把自然语言路由到合适的 skill,这是 **Human-NL-Choice-Only** 规则在 CLI 层的落点。

### 2.8 工作区 / 记忆 / 标准

`workspace`(init / reconcile) `session` `memory`(extract / sync / list / reindex / ingest / rotate / search) `standards`(init / update / lint) `skill`(list / sync / presence / heartbeat / search / lint / doctor) `artifacts` `profile` `config` `preferences` `binding` `proxy` `retrospective` `status` `version`。

---

## 3. 核心服务域(`src/services/`,98 个模块)

CLI 只是薄壳,业务逻辑在 `src/services/<domain>/`。按体量与重要性:

### 3.1 编排主干

| 域 | 文件数 | 职责 |
|---|---|---|
| `code/` | 28 | auto-compact(判定/编排/生命周期/历史)、DAG 编排、job-shape 判定、`orchestrator-can-do` 探针、Step 0.8 门禁、handoff 发射、用户触点分类、状态行渲染 |
| `dispatch/` | 32 | 子代理派发生命周期:派发记录写入/升级、心跳轮询、隔离租约、冲突重放、合并回滚、切片 DAG、泄漏检测、账本回收、启动超时 |
| `workflow/` | 32 | 工作流图、路由、plan/run/lint、lease 终态化、节点准备 |
| `context/` | 40 | 4 层上下文加载器(L0 全文 / L1 摘要 / L2 索引 / L3 模糊) |
| `audit/` | 46 | 审计框架 + 审计相关工具 |
| `slice/` | 20 | 6 阶段切片拆解算法、边界检查、交互式挑选(fzf)、批次应用 |
| `capability-guard-runner/` | 20 | 15 条 P0 journey 的守卫契约执行 |
| `final-review/` | 17 | 4 维业务验收证据装配 |
| `skillhub/` | 14 | SQLite 资产库(6 个 migration) |
| `loop/` | 14 | loop_release / loop_bee_relation / 单调守卫 / 运行驱动 |
| `codegraph/` | 14 | codegraph 代理 + 排除规则协调 |
| `prd/` | 14 | handoff 服务(sha256 锁定)、项目扫描读取/沉淀 |
| `ide/` | 23 | 9 个内置 IDE 适配器 + hook 协议 + 模型窗口探测 |
| `memory/` | 21 | 项目记忆读写 / 索引 / 分层留存 |
| `hooks/` | 11 | PreToolUse 门禁脚本族 |
| `audit-independent/` | 9 | 独立上下文审计 |
| `comments/` | 8 | 注释债度量 |
| `mcp/` | 8 | 只读 MCP server |
| `job/` | 8 | Job 模式:init / checkpoint / progress / rotate / block / subagent-cleanup |
| `sediment/` | 9 | 沉淀池读写 / 晋升门禁 / 索引重建 |
| `evolution/` | 7 | 演化提案 / 独立评估 / 回滚 / 棘轮状态 |
| `crystallization/` | 6 | 结晶事件写入 |
| `adapter/` | 6 | 厂商中立适配层(claude / codex / copilot + auto) |
| `share/` | 5 | `peaks.bundle/1` bundle 读写 |
| `24h-mode/` | 5 | 24h 模式状态机(5 个自动触发器 + 3 个决策桶) |
| `verdict/` | 3 | 5 个 envelope 源的裁决聚合 |
| `capability-baseline/` | 3 | 冻结基线管理 |
| `evidence/` | 2 | 每切片证据装配 |

### 3.2 门禁与证据

`code-review/`、`security/`、`perf/`(各 1 个聚合模块)、`audit/`(46)、`audit-independent/`(9)、`final-review/`(17)、`verdict/`(3)、`evidence/`(2)、`comments/`(8)、`capability-baseline/`(3) + `capability-guard-runner/`(20) + `capability-audit-service/`(6) —— 后三者构成 15 条 P0 journey 的冻结语义与守卫执行。

### 3.3 资产与演化

`skillhub/`(14,含 6 个 SQLite migration:loop_release / loop_bee_relation / loop_bee_extension / crystallization_event)、`loop/`(14)、`sediment/`(9)、`crystallization/`(6)、`evolution/`(7)、`share/`(bundle 读写,`peaks.bundle/1` 格式)。

### 3.4 环境与集成

`adapter/`(claude / codex / copilot + 自动识别)、`ide/`(9 个内置 IDE 适配器 + hook 协议 + 模型窗口探测)、`hooks/`(pre-tool-code-gate、worktree 授权门禁、管道化跑测陷阱门禁、superpowers 桥接门禁)、`mcp/`(只读 MCP server)、`codegraph/`(14)、`proxy/`、`polyrepo/`(4)、`openspec/`(10)。

### 3.5 记忆与上下文

`memory/`(21)、`context/`、`compact/` + `compact-statusline/` + `compact-history/`(自动压缩全链路)、`fresh-context/`(先搜后用 preflight)、`project-scan` 相关在 `prd/` 内。

---

## 4. 4 层资产模型(产品的核心)

这是 peaks-loop 与普通"工作流工具"的分水岭。权威定义:`.peaks/memory/peaks-loop-positioning-loop-engineering.md`。

| # | 层 | 角色 | CLI 面 |
|---|---|---|---|
| 1 | **Loop Engineering Asset** | 方法体系,一等公民;拥有 main / supporting / retired bees | `peaks loop` |
| 2 | **Bee Asset** | 可执行体,一等公民;一条或多条 loop 的运行时载体 | `peaks bee` / `peaks skill sediment` |
| 3 | **Workflow Trace** | 执行证据;每次运行的不可变记录,**不是**持久产品 | `peaks asset dispose --mode trace_only` |
| 4 | **Evolution Evaluation** | 反漂移门禁;独立打分者 + 回归怀疑者 + 棘轮 | `peaks evolution` |

**结晶只在运行真实完成后发生**(RL-2):`user_explicit` 触发器最高优先;LLM 建议需要 ≥2 个复用信号 + 具名场景 + 证据简报。**运行前预造资产被硬拒**。

**演化必须单目标单维度 + 独立评估 + 分数增量 ≥ 1.0**(RL-4/RL-5/RL-6),作者 ≠ 打分者,CLI 会硬拒自评。

**跨用户分享走 bundle**:格式 `peaks.bundle/1`,导出不含私有 run-state、`.peaks/memory/personal/`、原始 `state.db` 行;接收方导入必须是 `candidate`,进 `stable` 前必须跑独立评估(RL-9)。

---

## 5. 红线与门禁(11 条 RL)

`.peaks/standards/loop-engineering-guidelines.md` 是唯一权威源,每条红线必须写成 4 段式(`## Failure modes` / `## Rewrite` / `## Self-check` / `## Out-of-scope`),`peaks standards lint --category loop-engineering` 强制检查。闭环集合 `RL-0..RL-10`,由 lint harness 的 `EXPECTED_RED_LINE_IDS` 双向镜像。

| # | 红线 | 一句话 |
|---|---|---|
| RL-0 | karpathy × darwin 平权 | 两个层都不能省,不是先后关系 |
| RL-1 | Human-NL-Choice-Only | 用户永不手写 JSON、不打 CLI verb、不填表 |
| RL-2 | 事后结晶 | 跑完才结晶;预造资产 = 漂移 |
| RL-3 | Loop + Bee 双资产 | 不是同义词,不许降级;结晶必须同时写 loop + main bee |
| RL-4 | darwin 式棘轮 | 单目标、单维度、Δ≥1.0、需独立评估者 |
| RL-5 | 独立上下文评估 | 打分者只读评估包,不看作者完整推理 |
| RL-6 | 禁自评 | 作者 ≠ 打分者 ≠ 终审;≥2 个评估者,必含回归怀疑者 |
| RL-7 | 证据简报 | 四段式简报必填(what_happened / why_it_matters / what_learned / what_action),纯数字不算证据 |
| RL-8 | peaks-code 领域边界 | 代码域专属;别的域是独立 `peaks-*` skill |
| RL-9 | 桌面端 / 分享走 CLI | UI 只读 + 1:1 映射 CLI;导入落 `candidate` |
| RL-10 | 能力基线 / 守卫 / 审计 | 15 条 P0 journey 的外部语义被冻结;改语义需用户确认 + freeze-update |

**三条项目级硬规则**(在 `CLAUDE.md` 顶部):

1. **Human-NL-Choice-Only** —— 用户参与只允许两种形态:多选一,或自由说一句话。
2. **Two-Forms-Only** —— 用户**所有**交互(下载 skill、导入 bundle、精炼 bee、克隆、导出、留存/处置、晋升、重训)都塌缩成这两种形态。未来桌面端只是 **UI 加速器**,不构成新的动词面。
3. **Enhancement, not new AI CLI** —— 不抢 shell prompt、不注入 system prompt、不造竞争性 REPL、不替换任何 runtime 原生 skill 激活入口。厂商中立,厂商差异只活在 adapter 层。

另有 **Code-Change Red Line**:编排器(peaks-code 本体)**不得**直接 `Edit`/`Write` `src/` `tests/` `config/` `bin/` `scripts/`;两层机械拦截(`peaks code orchestrator-can-do` 探针 + `peaks code-gate` PreToolUse hook;规则只有一份实现,在 `src/services/hooks/pre-tool-code-gate.ts`,`.sh` 只是薄壳)。例外:`.peaks/**`、`skills/**/SKILL.md`、`docs/**` 可直接写。

---

## 6. 工作流主干(peaks-code 11 步)

代码域的标准顺序(完整契约见 `references/workflow-gates-and-types.md`):

```
0  快照          peaks doctor + project dashboard
0.5 工作区       peaks workspace init → .peaks/_runtime/<sid>/
0.6 项目扫描     archetype / 库版本 → .peaks/project-scan/project-scan.md
0.7 存量提取     遗留项目的视觉 token + 代码约定
1  标准预检     peaks standards init/update --dry-run → --apply
2  PRD          request init → lint → transition confirmed-by-user
2.5 最佳实践扫描 Context7 优先 / WebSearch 兜底 → 8 行对比表 + 用户确认
3  蜂群并行     sc build-dag → sub-agent dispatch --from-dag(UI + RD规划 + QA测例)
4  RD 实现      按类型消费上游产物 + TDD
5  Code review + 安全审计 + 性能审计
6  QA 验证      执行测例 + API 校验 + Playwright E2E
7  RD↔QA 修复环 最多 3 轮,超限出 blocked TXT
8  SC 阶段      impact / retention / validate / boundary
9  工作区对账   workspace reconcile
10 TXT 交接     交接胶囊 + 记忆块
11 最终快照     project dashboard + skill doctor
```

**门禁是实的**:审计不过 = 不出门,QA 不过 = 不出门,review 不过 = 不出门。

**门禁类型表**(`peaks request retag` 会自动报出所选类型对应的前置件清单):

| `--type` | RD 规划产物 | RD 证据 | QA 证据 |
|---|---|---|---|
| `feature` / `refactor` | `rd/tech-doc.md` | code-review + security + perf(rid 后缀) | test-cases + test-reports + security-findings + performance-findings |
| `bugfix` | `rd/bug-analysis-<rid>.md` | 同上 | 同上 |
| `config` | 无 | `rd/security-review-<rid>.md` | security-findings |
| `docs` / `chore` | 无 | 无 | 无 |

**扇出是强制的**:DAG 同一拓扑层 ≥2 个叶子时,必须走 `peaks sub-agent dispatch --from-dag`,一次调用发出 N 个并行派发(`dispatchCount === N`)。静默串行的逃生通道在 2.8.4 被删掉。

---

## 7. 质量与 CI

### 7.1 测试规模

| 层 | 文件数 |
|---|---|
| `tests/unit/**` | 541 |
| `tests/integration/**` | 96 |
| `tests/e2e/**` | 1(critical-paths)+ 3 个 shell 工作流 |
| `src/**/*.ts` | 1,274 |

覆盖地板由 `.husky/coverage-ratchet.mjs` 盯 `.peaks/lint/coverage-floor.json`(**单调棘轮**:只能升不能降)。c8 的 `--100` 门禁已在 2026-10-17 移除(backlog §13.4 rule 2)。

**注意**(本机实测坑):默认配置与 push 门禁**不覆盖** `tests/integration/**`,要单独跑 `npx vitest run --config vitest.config.integration.ts <file>`。

### 7.2 Git 钩子(`.husky/`,12 个 mjs + 2 个入口)

`pre-commit` / `pre-push` 之下:`peaks-gate.mjs`(门禁基线)、`peaks-gate-file-size.mjs`(**800 行文件上限**,Karpathy §2)、`peaks-gate-pipeline.mjs`(rd→qa 流水线完整性)、`peaks-gate-staged-parity.mjs`(暂存区与工作树一致)、`peaks-gate-comment-hygiene.mjs`、`peaks-gate-silent-warning.mjs`、`peaks-gate-baseline.mjs` + `-monotonic.mjs`(基线单调)、`coverage-ratchet.mjs`、`format-check-ratchet.mjs`、`lint-scope.mjs`、`scan-coverage.mjs`。

### 7.3 CI(`.github/workflows/ci.yml`)

| Job | 平台 | 作用 |
|---|---|---|
| `test` | matrix(多 OS) | vitest + build |
| `binding-store-multi-process` | ubuntu | 绑定存储多进程集成 |
| `integration-suite` | ubuntu | `tests/integration`(**默认本地不可见的那一套**) |
| `readonly-proof-sandbox` | ubuntu | 只读证明层 C(无网络 + 不可写) |
| `commit-message-red-line` | ubuntu | 全历史检查 AI 联合作者尾注 —— **SquabbyZ 是唯一作者** |
| `format-check` | ubuntu | 格式化集棘轮 |
| `coverage-ratchet` | ubuntu | 覆盖地板单调 |

另有 `publish.yml`(可信发布 / OIDC)。

---

## 8. 技术栈

| 关注点 | 选型 |
|---|---|
| 语言 | TypeScript `^5.7.2` |
| 包管理 | pnpm `10.11.0` |
| Node | `>= 24.0.0`(本机 v24.12.0) |
| 构建 | `tsc -p tsconfig.build.json` + 4 个 workspace 包各自构建 |
| CLI 框架 | commander `^12.1.0` |
| 校验 | zod `^4.6.7` |
| YAML | yaml `^2.9.1` |
| 模糊选择 | fzf `^0.5.2` |
| Glob | picomatch `4.0.7`(精确 pin) |
| 测试 | vitest `^4.1.10`(**硬锁,用户指令禁止升 5.x**) |
| 变异测试 | @stryker-mutator/core `^8.7.1` |
| 代码图 | @colbymchenry/codegraph `1.6.2` |
| 外部评审 | @alibaba-group/open-code-review `^1.13.1` |

**Workspace 包(4 个)**:

| 包 | 版本 | 职责 |
|---|---|---|
| `peaks-loop-shared` | 0.0.101 | 纯函数工具(fs / paths / result / version) |
| `peaks-loop-mut` | 0.1.66 | 变异测试 + 断言扫描 + ECC 缓存 |
| `peaks-loop-shared-channel` | 0.0.69 | 派发器中介的共享通道 + 文件系统安全原语 |
| `peaks-loop-internal-runtime` | 0.0.52 | 分离式子代理运行时:ProcessSupervisor + LifecycleOwner + VendorAdapter + 无限上下文自动压缩 |

**Archetype**: `cli`(confidence high),`frontendOnly = false`。

---

## 9. IDE 与厂商适配

`src/services/ide/ide-registry.ts` 内置 **9 个 IDE 适配器**:claude-code、trae、cursor、codex、hermes、openclaw、qoder、tongyi-lingma、zcode。注册表是单一来源 —— hook-translator、hooks install、statusline 全部从它读。

`src/services/adapter/` 是 **厂商中立层**的唯一所在地(claude / codex / copilot + auto-detect)。

**安装模型**:实体只存一份在 `~/.peaks/{skills,agents,output-styles}`,每个 IDE 目录里是 junction / 符号链接指向它。升级时链接目标不变、不需重建。有 `.peaks-managed` 边车标记的条目会被升级覆盖;没有标记的一律视为用户自建,**永不替换也永不删除**。Windows 无开发者模式时文件符号链接会退化成实体副本(内容照样跟随升级)。真源根可用 `PEAKS_HOME` 重定向。

**MCP 只读面**:对外只暴露两个工具 —— `peaks_status`、`peaks_memory_search`。工具面是**从生成的只读白名单派生**的,不是另抄一份;白名单由构建时对 Commander 注册表做内省生成,CI 对 diff 失败。schema 校验在启动时做:任何写了写操作 argv 的条目都会让 server **拒绝启动**。

---

## 10. 记忆体系

| 层 | 位置 | 内容 |
|---|---|---|
| 项目记忆(权威) | `.peaks/memory/` | 磁盘 **563 个 md**(顶层 548 + `archived/` 12 + `audit-prompts/` 3);index 收 **562 条**(排除生成的 `MEMORY.md` 自身),记 **336 hot + 226 warm**;覆盖 562/562,无孤儿、无失效指针 |
| 资产库 | `~/.peaks/`(SQLite `state.db`) | loop_release / bee_release / crystallization_event / evolution_evaluation |
| IDE 侧会话笔记 | `~/.claude/projects/<hash>/memory/` | 会话笔记,**只读**给 peaks;要用得先 `peaks memory ingest --apply` |

`peaks memory reindex` 重建 index.json;`rotate` 按分层做留存。IDE 侧笔记不自动进权威层 —— 这是"单一权威"规则的执行点。

---

## 11. 上下文与自动压缩(零停顿契约)

**这是 peaks-loop 最容易被误读的一块。** 阈值(标准模式):

| 区间 | 动作 |
|---|---|
| `< 0.80` | 正常,不动作 |
| `0.80 ≤ ratio < 0.85` | **auto-fire** —— `peaks skill presence` 每轮报的,`peaks code auto-compact` **自动执行,不问用户** |
| `0.85 ≤ ratio < 0.95` | pre-compact —— 同样自动执行,仅在有在飞子代理批次时延后到批次落地 |
| `≥ 0.95` | red-line —— 立即请求压缩,**但不阻塞**派发与推进 |

**硬禁令**:任何"请用户自己去运行 `/compact`"的文案都是回归。压缩是系统责任,不是用户动作。只有在飞子代理批次能延后它,没有"要不要压缩"这个问句。

当前会话实测:`ratioPct = 9.0%`,action = `none`。

---

## 12. 资产 / 门禁 / 记忆之外的外围能力

| 能力 | 命令组 | 说明 |
|---|---|---|
| 24h 长跑看板 | `dashboard long-run` / `summary` | 只读,5 类指标 |
| 观察性 | `observability`(status / slices / fanout / repair-cycles / report) | 每切片扇出成本、RD↔QA 修复轮次 |
| 策略链 | `strat write` → `tact write` → `tact read` | STRAT → TACT → MUT 单轴链,有 AST 门禁与签名 |
| 变异测试 | `mut run` / `asserts` / `report` | Stryker + 断言扫描 |
| 浏览器 | `browser action` / `playwright` / `web` | 5 种浏览器意图;Playwright MCP 会话管理;Core Web Vitals |
| 多仓 | `polyrepo init/status/dispatch` | 父目录扫子 git 仓库 |
| 定时任务 | `cron` / `cron-scheduler` | 常驻后台调度 |
| 复用上游 | `fork` | upstream tag 同步(fork 场景) |
| 发布 | `release` | canary → promote → watch → done / hotfix 状态机 |
| OpenSpec | `openspec` | 项目内 change 记录读写与校验 |
| 遗留嗅探 | `legacy-detect` | TODO/console.log/any/大文件/ts-ignore,出气味等级 |
| 复杂度 | `complexity-estimate` | 按 LOC + 导出数 + async → trivial/simple/complex |
| 回归关键路径 | `smoke` | 5–10 分钟轻量回归 |
| 注释债 | `comments` | 陈旧引用与流程叙述度量 |
| 审计 | `audit red-lines` / `audit prose-ratio` | 红线文案审计 |

---

## 13. 当前状态(2026-10-20 实测)

| 项 | 值 |
|---|---|
| 版本 | 4.1.12(tag `v4.1.12`) |
| `peaks doctor` | **88 passed, 0 failed** |
| 活跃 session 目录 | 20 个,全部通过 `isValidSessionId`(另有 `callers/` `change/` `_audit/` 三个非 session 目录) |
| 历史 request 产物 | 338 个 |
| 记忆文件 | 562 个(336 hot + 226 warm),全部索引,无孤儿 |
| codegraph 索引 | 2,175 文件 / 38,984 节点 / 105,341 边(本次刷新) |
| 工作区布局 | 规范 —— 无顶层 session 目录、无遗留 change-id 目录、无陈旧单槽 presence 文件 |
| 工作树 | 本次会话开始时 clean(`main` 分支);会话产出 1 个新文档 + 2 条记忆 + index 刷新 |
| dist/ | **未构建** —— 需要 `pnpm build` 填充 `dist/shared/version.js` |
| PATH 上的 peaks 二进制 | 3 个,版本均为 4.1.12 |

**已知本地环境注意**:直接跑 `bin/peaks.js` 会命中陈旧 dist;验证未提交源码要走 `node node_modules/tsx/dist/cli.mjs src/cli/index.ts …`(本会话全程如此)。

---

## 14. 事实来源(可复算)

| 结论 | 复算命令 |
|---|---|
| codegraph 索引数字 | `peaks codegraph status --project .` |
| 124 个顶层命令 | `peaks --help` |
| 88 项 doctor 检查 | `peaks doctor` |
| 15 条 P0 journey | `peaks baseline list` |
| 23 个 SKILL.md | `ls skills/**/SKILL.md` |
| archetype / 库版本 | `peaks scan archetype --project .`、`peaks scan libraries --project .` |
| 记忆条目 / 索引 | `peaks memory list --summary`、`peaks memory reindex --project .` |
| request 产物总数 | `peaks project dashboard --project .` |
| 标准文件齐备 | `peaks standards init --project . --dry-run --json` |
| 红线 4 段式合规 | `peaks standards lint --category loop-engineering` |
| 23 个 skill 的目录名匹配 | `peaks doctor`(skill 段) |
| 测试/源码文件数 | `find tests -name '*.test.ts'`、`find src -name '*.ts'` |

---

## 15. 一页速览

```
peaks-loop v4.1.12
├── 23 个 SKILL.md = 14 个用户技能 + 9 个 LLM 内部角色
├── 124 个顶层 CLI 命令(对 LLM 开放,对用户隐藏)
├── 98 个服务模块 / 1,274 个 src TS 文件 / 448 个 CLI 命令文件
├── 4 层资产模型:Loop(方法) + Bee(执行体) + Trace(证据) + Evolution(反漂移)
├── 11 条红线 RL-0..RL-10,4 段式强制格式
├── 15 条 P0 journey 语义被冻结(baseline + guard + 独立审计)
├── 11 步工作流,7 道物理门禁,审计不过 = 不出门
├── 562 条项目记忆 + SQLite 资产库 + 只读 MCP 面
├── 零停顿自动压缩:0.80 起自动触发,永不把 /compact 甩给用户
└── 9 个内置 IDE 适配器 + 厂商中立 adapter 层
```

**一句话**:它把"AI 帮你写代码"变成"AI 帮你跑完一整条工程流水线,并把跑对的东西沉淀成下次能直接复用的资产" —— 而用户全程只需要说一句话,或挑一个选项。
