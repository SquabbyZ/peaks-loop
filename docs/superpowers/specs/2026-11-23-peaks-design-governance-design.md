# peaks design — 下游项目 UI / 设计治理

- **日期**：2026-11-23
- **状态**：设计 v4，**brainstorming + grilling（Q1–Q21）已完成，frontier 为空**；用户已确认所有推荐项，待最后一次整体确认后进入 `writing-plans`。
- **已定大方向**：**C（两层治理）** + **硬依赖引擎（`designlang` 进 `dependencies`）** + **A（`peaks-design` 兄弟泳道）**。
- **grilling 追加的关键裁决**：新增 `design` request 角色；动态 `render.url`；Tailwind v4 支持；门禁失败回 RD 计入 3 轮上限；`verify-pipeline` 加条件条目；G3 拆成同路由回归（硬）+ archetype rubric（先 advisory）。全部见 §16。
- **上游**：无（用户直接提出，非审计产物）
- **builder check**：已跑一轮（独立子代理），10 个问题 + 5 处代码偏差已裁决，见 §15。
- **约束（项目级，binding）**：
  1. **Human-NL-Choice-Only**：用户只做自然语言多选或自由描述；`peaks design *` 由 LLM 代跑，用户不敲 CLI。
  2. **Two-Forms-Only**：桌面端只是 UI 加速器，不新增动词面。
  3. **Enhancement, not new AI CLI**：`peaks design` 是既有 `peaks` CLI 的子命令；`peaks-design` 是既有技能家族的新成员，不占 shell prompt、不注入 system prompt。
  4. **外部能力只做参考**：外部包只经 Peaks CLI 封装调用；不执行上游 installer、不安装其插件/MCP/skill、不改 agent settings。
  5. **红规则**：本设计涉及的提交不得带任何 AI 署名 trailer。
  6. **硬禁**：任何产物不得落在 `.peaks/<YYYY-MM-DD-*>/`；reviewable artifact 一律走 `.peaks/_runtime/<sessionId>/design/...`。

---

## 0. 起因

用户是资深前端开发者。代码侧的质量可以靠 lint / 单测 / TDD / 复杂度卡控；但**设计与最终页面效果**没有对应的卡控手段：

- AI 产出的页面"丑"，且即使指定了 UI 库，仍然退化成**原生 DOM + 硬编码 style**；
- 与业务既有风格差距大；
- 叠加使用 design-taste-frontend / impeccable / frontend-design 等 skill 收效甚微；
- 已采用 stylelint + DESIGN.md，仍然没有改善。

用户的判断是"没有找对方向"。本设计采纳该判断，并给出机制层面的解释：

> 这些手段全都是**建议**（prompt、散文、风格指南），没有一样是**可执行、可失败、自动运行**的判定。
> 代码侧之所以有效，是因为 lint/测试会**让构建红掉**；设计侧从来不会红。

因此本能力的目标不是"让模型生成更好看的页面"，而是给下游项目补上**设计真值 + 可失败的门禁**。

---

## 1. 定位与边界

**一句话**：`peaks design` 是下游项目的**设计治理层**——建立项目设计真值（contract），并让页面产出在源码与渲染两个层面被机器判定。

**两个表面，一个能力**

| 表面 | 是什么 | 谁用 |
|---|---|---|
| `peaks-design` skill | 用户入口 / 设计域编排器 | 用户用自然语言或 `/peaks-design` 进入 |
| `peaks design` CLI | 确定性原语（init/status/check/gate） | 由 skill 或 CI 调用，用户不直接敲 |

**它是什么**

- 仓库级：一份可执行的设计契约（tokens / paved road / 范例），随产品代码走。
- 流程级：一个能接进 `peaks-code` 与 `peaks-design` 的门禁，不达标不放行；给 RD/UI/QA 提供同一份真值。
- 测量层：调用外部引擎（designlang，硬依赖）从**真实渲染的 DOM** 读设计，而不是从源码猜。

**它不是什么**

- 不是一个新的 design skill / 提示词库；不负责"生成更美的页面"；生成仍由 `peaks-ui` / RD 完成。
- 不是绝对审美裁判；它判定的是**一致性、可执行性、漂移**，不是"高级感"。
- 不是新 CLI；`peaks design` 是 `peaks` 的子命令。
- 不服务非代码领域（RL-8）：本能力只对 code repo 生效；品牌/印刷/非代码设计不在范围内。
- 不要求下游项目立刻接入：未接入（`not-adopted`）不阻塞。

**承重不变量**

> 删掉 `peaks design` 与 `peaks-design` 的一切，`peaks-code` 的既有行为不变。

唯一允许的侵入是：新增一个 `rd:qa-handoff` 的 prereq（带 back-compat 窗口）；新增一个 orchestrator 技能与它的注册项；新增一个 `design` request 角色（§8.5）。三者都被删除时，旧 session 的行为与今天一致。

---

## 2. 现有底座与缺口

| 已有 | 位置 | 缺口 |
|---|---|---|
| 源码级 visual token 抽取（Less/Sass/CSS 变量/Tailwind） | `peaks scan existing-system`，`src/services/scan/existing-system-visual-tokens.ts` | 只能看**声明**，看不到渲染后的真实样式；对 JSX 内联样式/运行时样式基本失明。**Tailwind v4 没有 `tailwind.config.*`**：`extractTailwindTokens` 抓不到 `@theme`，只有 `parseCssVars` 能抓到 `--primary` 这类 CSS 变量 |
| 项目自带 linter 形态 | eslint / stylelint / oxlint 各不相同（试点仓 ModelMatrix 用 **oxlint**，无 stylelint） | G1 不能依赖某一种；内置扫描器是唯一的共同底座 |
| 组件库 / CSS 框架探测（antd、shadcn、mui、tdesign…） | `src/services/standards/project-context.ts` / `project-context-types.ts` | 只供 standards 渲染用 |
| UI 库优先规则（"优先用库组件，别手搓原生 DOM，别用对抗库的 inline style"） | `src/services/standards/standards-render.ts:106` `renderUiLibraryPriorityRule` | **纯散文**，无任何检查 |
| UI 角色与"full-auto visual quality path" | `skills/bee/peaks-ui/references/workflow.md` | 产出 `design-draft.md` / taste report 等散文；依赖 Playwright MCP（可选、易失） |
| lint 驱动 | `src/services/lint/eslint-runner-support.ts`，`peaks lint` | **是 ESLint-only，且强制 `--config config/eslint/.peaks-rules.cjs`**，不继承项目配置；stylelint 只用于 `--print-config`。因此它**不能**作为设计规则执行器 |
| 变更集枚举 | `readGitChangeSet(projectRoot, 'HEAD')`（`src/services/scan/file-size-baseline.ts`，经 `rd-transition-gates.ts:116` 调用） | 可复用，用于判定 UI 表面 |
| 截图文约 | `peaks-ui` Contract 1（截图必须落在 `.peaks/_runtime/<sessionId>/qa/screenshots/`） | 可复用路径纪律 |

**结论**：peaks-loop 已经有"抽取"和"散文规则"，缺的是**真值文件化 + 渲染测量 + 可失败门禁 + 设计域入口**。

---

## 3. 外部引擎 `designlang`（已核实的事实）

- npm `designlang@13.4.1`，MIT，Node ≥20，8 个依赖（`playwright`、`pixelmatch`、`pngjs`、`commander`、`ora`、`chalk`、`pdf-lib`、`@modelcontextprotocol/sdk`）。
- 形态：Node CLI（bin `design-extract.js`），用 headless Chromium 打开 URL，从**活的 DOM** 抽设计。
- 输出（写入 `./design-extract-output/`，17+ 文件）：
  - `*-design-tokens.json`（W3C DTCG：primitive / semantic / composite）
  - `*-tailwind.config.js`、`*-shadcn-theme.css`、`*-variables.css`、`*-figma-variables.json`
  - `*-design-language.md`、`*-anatomy.tsx`、`*-motion-tokens.json`
  - `*-grade.html` / `*-grade.svg`、`*-site-system.json`、`*-site-consistency.md`
- 关键命令（README 原样）：
  - `npx designlang https://stripe.com` / `--full`
  - `npx designlang verify-ui localhost:3000 --brand DESIGN.md`（多断点 + 暗色；漂移 exit 1）
  - `npx designlang drift https://yourapp.com --tokens ./src/tokens.json`
  - `designlang lint ./src/tokens/design-tokens.json`
  - `npx designlang slop https://yoursite.com`（genericness 0–100）
  - `npx designlang fidelity https://stripe.com --clone http://localhost:3000 --min 90`
  - `npx designlang site stripe.com --max-pages 8`
  - `npx designlang grade https://stripe.com --badge`
- CI：`npm install` 不下载浏览器；`designlang install-browser` 或回退到系统 Chrome；`--system-chrome`；exit non-zero on failure。
- **限制**：只接受可达 URL（含 `localhost`）；**不支持 `file://`、静态 `dist/`**；受保护页面需要 cookie/header（**v1 不支持透传**）；抽取要起 Chromium。
- **未承诺**：README 没有承诺 `drift` / `verify-ui` / `slop` 的 JSON 输出，也没有列出逐页截图产物。这两点进 §11 U1/U2。
- `--smart` 分类可调用远程模型（可选，带 key）——本设计**不使用**。

**它补的是本设计最缺的一环**：从渲染结果读真实设计语言。它**不提供**铺路层（源码 AST 级禁止裸样式/绕过 UI 库）、工作流门禁、范例管理、项目标准生成、设计域编排入口。

**封装边界（硬）**

- 只调用其 CLI；**不使用**它的 MCP server、Claude Code plugin、agent skill。
- 不执行 `designlang` 的上游 installer；浏览器缺失时只报告，不自动下载。
- 不把 `designlang` 的输出当"批准"；它只是证据，Peaks 门禁才是判决。
- 不 vendor 其代码；只做适配层。

---

## 4. 引擎策略 A（硬依赖，用户已裁决）

**A = `designlang` 作为硬依赖 + 显式可用性判定 + 绝不静默降级。**

1. `designlang` 进入 `dependencies`（**不是** `optionalDependencies`），并 pin 一个受支持 major 区间。
   - 先例成立：`@colbymchenry/codegraph` 同样是硬 `dependencies`，由 peaks 封装其 CLI。
   - 后果：`npm i peaks-loop` 会安装 designlang 及其 `playwright` 依赖；但**浏览器仍不在 `npm install` 时下载**，仍由 `designlang install-browser` 或系统 Chrome 提供。
2. `peaks design status` / 每次 `check` 先做**引擎可用性三判**：
   - 包可解析？（本地/全局）
   - 可执行入口可解析？（不经 POSIX shim）
   - 浏览器就绪？（Chromium 或系统 Chrome）
3. 任一不满足 → `status: blocked`，error code 明确，**绝不返回 pass**。
   - 这是一条来自本仓既有教训的硬规则：**缺失的过程不得被读成判决**。
   - 硬依赖只保证"装上"，不保证"能用"；可用性三判仍是每次检查的第一道。
4. 进程启动约束：
   - 用 `process.execPath` + 解析出的包入口文件启动，`shell: false`；不依赖 PATH 上的 `designlang` 名字。
   - 理由：本仓有"Git Bash 的 npm shim 让本地绿、CI 红（ENOENT）"的教训。
5. 版本与输出稳定性：
   - 适配层声明支持的 major；版本超出范围 → `blocked`（`DESIGN_ENGINE_VERSION_UNSUPPORTED`）。
   - 上游输出文件名/字段变化只允许在适配层吸收，不扩散到门禁判定。

**为什么硬依赖而不是 optional**：可选依赖会让同一条命令在不同环境给出不同能力，而且 `npm install` 成功不代表能用。硬依赖 + 可用性三判把"能不能用"变成**每次检查的显式判定**，而不是安装期的不确定性；下游零安装、CI 可复现。

**为什么不是 B（纯探测后退化）**：退化路径只能回答"源码里有没有 token"，回答不了"渲染出来是不是这样"——那正是用户失败的根因。退化成 pass 等于把失败包装成成功。

**为什么不是 C（只出 schema）**：治理不闭环，把接线推给用户。

---

## 5. 总览：一个入口、两层真值、三道门

```
用户（NL 或 /peaks-design）
        │
        ▼
┌──────────────── peaks-design（orchestrator 技能）────────────────┐
│  判断设计意图 → 建契约 / 审计 / 修复计划 / 交付门禁               │
│  派遣：peaks-ui（设计制品）· peaks-rd（代码实现）· peaks-qa（验证）│
└───────────────┬──────────────────────────────────────────────────┘
                │ 调用确定性 CLI
┌───────────────▼──── 真值层（每个 app root 一次）──────────────────┐
│ design init                                                      │
│   项目扫描 + 源码 token + （可选）渲染抽取                        │
│   → design/contract.md   design/tokens.json                       │
│   → design/paved-road.json  design/engine.json                    │
│   → design/exemplars/<archetype>/（黄金范例，2 类起步）           │
│   → .peaks/standards/common/design-governance.md（独立文件）      │
└───────────────┬──────────────────────────────────────────────────┘
                │ 被消费
┌───────────────▼──── 门禁层（每次 UI 变更）───────────────────────┐
│ design check                                                     │
│   G1 源码一致性：token 合规 + 铺路规则                            │
│   G2 渲染一致性：designlang drift / verify-ui / slop              │
│   G3a 同路由回归（硬）· G3b archetype rubric（先 advisory）       │
│   → .peaks/_runtime/<sid>/design/check-<rid>.{json,md}            │
│   → design request 角色 + rd:qa-handoff 的 DESIGN_CONFORMANCE     │
└──────────────────────────────────────────────────────────────────┘
```

判定语义四态（贯穿全文）：

- `pass`：检查跑了，且通过。
- `fail`：检查跑了，且不通过。
- `blocked`：**检查没能跑**（引擎/浏览器/URL/契约/变更集缺失）。不是 pass。
- `skipped(reason)`：该项**不适用**（未接入 / 显式接受），原因是机器可读的。

---

## 6. 真值层：`design init`

### 6.1 CLI 与流程

```bash
peaks design init --project <repo> [--app <path>] [--url <url>] [--start "<cmd>"] \
  [--archetypes list,form] [--force] [--json]
```

行为：

1. 复用 `peaks project context` / `peaks scan archetype` 判定前端与组件库；非前端项目直接 `ok:false`（`DESIGN_NOT_FRONTEND`）。
2. **确定契约根**（见 6.2）：规则是"**前端 app root**"，不是"仓库根"。
   - 单 app 仓库（前端在根）→ 根 `design/`；
   - monorepo / 混合仓 → 每个前端 app root 各自一份（`apps/*`、`packages/*`，或试点仓的 `web/`；条件：自带 `package.json` + 前端证据）；`--app` 指定本次目标；
   - 试点仓 ModelMatrix 是 Go 后端 + `web/` 前端 → 契约根为 **`web/design/`**。
3. 复用 `peaks scan existing-system` 抽源码 token（"意图/声明"一侧）。
4. 引擎可用且有 URL 时，跑 designlang 抽取（"观测"一侧）；不可用则明确记录 `observed: null` 与原因，**不伪造观测**。
5. 写 `design/` 下文件（逐文件策略见 6.2）；**默认不覆盖用户拥有的文件**，`--force` 才覆盖并留 `.bak`。
6. 写 `.peaks/standards/common/design-governance.md`（独立文件，见 6.5）。
7. 输出"契约评审摘要"，由 LLM 用多选让用户确认（见 6.6）。

**dev server / URL 策略**：`init` / `check` **默认只探测 URL，不代管 dev server**；`check --start` 是显式 opt-in：由 peaks 在 `render.cwd` 拉起 `startCommand`、等就绪、结束后回收（S2 实现；见 §11 U2）。

**URL 不写死**：`engine.json` 不存固定 URL，只存 `render: { startCommand, cwd, port?, path? }`；运行期按 **`--url` > 环境变量 `PEAKS_DESIGN_URL` > `engine.json` 用户显式写过的 `url` > 从 `startCommand`/`port` 推导并探测** 的顺序解析。"我来起服务后告诉你" = 用户先起服务，LLM 用 `--url` 运行 check。

### 6.2 产物、路径与逐文件归属

**随产品代码提交（tracked）**

```
design/                       # 前端 app root：单 app 在根；monorepo/混合仓在各自 app root（如 web/）
  contract.md                 # 用户拥有：九段式设计契约；--force 才重写（留 .bak）
  tokens.json                 # 机器生成；--force 重写（留 .bak）；语义层变更需用户确认
  paved-road.json             # 机器默认 + 用户覆盖合并；--force 不动用户覆盖
  engine.json                 # 机器刷新：引擎版本、观测时间戳、render 配置
  exemplars/<archetype>/
    meta.json                 # route / 源文件 / 截图相对路径 / 生成时间
    <name>.tsx                # 黄金范例源码（用户/LLM 共同维护，不自动覆盖）
    <name>.png                # 黄金范例截图（不自动覆盖）
```

`--force` 的破坏半径：只允许重写 `contract.md` / `tokens.json`；`paved-road.json` 的 `rules` 与 `exemplars/` **永不**被 `--force` 删除。

**不提交（runtime）**

```
.peaks/_runtime/<sessionId>/design/
  requests/<rid>.md           # design 角色的 request artifact（见 §8.5）
  check-<rid>.json            # 机器判定 envelope
  check-<rid>.md              # 人读报告（prereq 读取这一份）
  screenshots/<route>-<viewport>.png
  baseline/<route>-<viewport>.png   # 视觉回归基线（gitignored；首次绿色运行建立）
```

截图路径复用 `peaks-ui` 的 Contract 1 纪律：不得落在项目根或仓库其他位置。

**截图提交纪律（Q9）**：`design/exemplars/**/*.png` 只允许**脱敏或合成**截图；含真实客户数据的截图不得提交。runtime 截图与 baseline 一律 gitignored。

### 6.3 关键 schema（草案）

`design/tokens.json`（DTCG 子集，适配层只承诺这一层稳定）：

```json
{
  "$schema": "https://design-tokens.org/schema.json",
  "color": { "primary": { "$value": "#0F62FE", "$type": "color" } },
  "space": { "4": { "$value": "16px", "$type": "dimension" } },
  "font": { "body": { "$value": "14px", "$type": "dimension" } },
  "radius": { "md": { "$value": "8px", "$type": "dimension" } }
}
```

`design/paved-road.json`：

```json
{
  "schemaVersion": 1,
  "pageRoots": ["src/pages", "src/app", "src/components"],
  "componentEntrypoints": ["@/ui"],
  "allowDirectLibraryImports": [],
  "banned": { "inlineStyle": true, "rawHex": true, "arbitraryTailwind": true },
  "rules": {
    "DESIGN_INLINE_STYLE": "fail",
    "DESIGN_RAW_COLOR": "fail",
    "DESIGN_LIBRARY_BYPASS": "fail",
    "DESIGN_ARBITRARY_VALUE": "fail",
    "DESIGN_RAW_PRIMITIVE": "fail",
    "DESIGN_TOKEN_COVERAGE": "warn"
  },
  "tokenScale": {
    "space": ["4", "8", "12", "16", "24", "32", "48"],
    "font": ["12", "14", "16", "20", "24", "32"],
    "radius": ["2", "4", "8", "12"],
    "color": ["--color-*"]
  }
}
```

`design/engine.json`：

```json
{
  "schemaVersion": 1,
  "contractVersion": "sha256:...",
  "engine": { "name": "designlang", "supportedMajor": 13 },
  "render": {
    "startCommand": "bun run dev",
    "cwd": "web",
    "port": 3000,
    "path": "/",
    "pages": ["/", "/orders"],
    "startPolicy": "never",
    "url": null
  },
  "archetypes": ["list", "form"]
}
```

`url` 默认 `null`：只有用户显式确认过某个固定地址时才写入；运行期解析顺序见 6.1。`cwd` 是相对契约根的目录（ModelMatrix 为 `web`）。

### 6.4 与 `scan existing-system` 的关系

- 源码抽取是**构建契约的输入**，不是门禁的判决依据。
- 渲染抽取是**观测证据**：`init` 时用来校正契约；`check` 时用来测量漂移。
- 两者冲突时：**契约（intended）优先**，观测差异记为 finding，不自动采纳为契约。采纳必须经过用户确认。
- `scanned=true` 但 token 全空且无组件目录时：契约可以建立（从观测/用户确认），但必须在 `contract.md` 里显式写"源码层无 token 系统"。
- **Tailwind v4（Q13，写计划时修正）**：v4 是 CSS-first，没有 `tailwind.config.*`，但 `parseCssVars` **已经**会读 `src/styles/**/*.css`（`walkStyleFiles` 的 `STYLE_DIRS` 含 `src/styles`），所以 `@theme` 里的 `--color-*` / `--spacing-*` / `--radius-*` 已经被抓到。S1 **不写第二个 parser**；需要的是：① fixture 证明 v4 被捕获；② 给含 `@theme` 的文件标注 `theme-file` 来源；③ 语义层映射（`--primary` 等 → 契约命名）。前提是 `design init` 必须按 **app root** 调用 `scanExistingSystem`（试点仓是 `web/`），不能用餐仓库根。

### 6.5 标准注入（修正：独立文件，不做渲染时改写）

**为什么不用 `coding-style.md`**：`peaks standards init/update` 对已存在文件只标 `existing`（`project-standards-service.ts` 的 `existsSync ? 'existing' : 'planned'` + `writeNewFile` 的 `O_EXCL`），渲染时注入**到不了已存在的下游项目**；而 `design init` 直接 append 又会在契约删除后留下孤儿块。

**采用**：`design init` 写独立文件 `.peaks/standards/common/design-governance.md`：

```markdown
<!-- peaks:design-governance:start -->
# Design governance (peaks-loop)
- 设计真值：`design/contract.md` + `design/tokens.json`（唯一事实源）。
- 页面代码只能从 `design/paved-road.json` 的 `componentEntrypoints` 引组件；禁止直接引 UI 库（除非在 allow 列表）。
- 禁止 inline style、裸色值（hex/rgb/hsl）、Tailwind 任意值间距/字号，除非契约显式允许。
- 交付前必须运行 `peaks design check --gate`；证据写入 `.peaks/_runtime/<sessionId>/design/check-<rid>.md`。
<!-- peaks:design-governance:end -->
```

- 幂等：块级替换；重复运行不产生第二份。
- 删除：`design uninit`（或 `init --remove`）删除该文件与契约，二者同生共死。
- `renderAgentsMd` 增加**条件行**：该文件存在时才在 "Peaks standards to read" 里出现一行；`standards update` 不管理该文件本身。
- 角色仍直接读 `design/contract.md`，即使 AGENTS 行滞后也不丢失真值。

### 6.6 用户参与（Human-NL-Choice-Only）

`design init` 需要用户决策的只有三处，全部通过 LLM 的多选或自然语言：

1. **黄金范例选哪 2 类页面**（列表 / 详情 / 表单 / 仪表盘 / 设置）。
2. **渲染入口**（开发命令/端口已知 / 我来起服务后告诉你 / 暂时没有）——不要求用户填死 URL。
3. **契约评审摘要是否认可**（认可 / 改色彩或字阶 / 重来）。

用户不运行任何 `peaks` 命令；LLM 代跑并回报。

---

## 7. 门禁层：`design check`

### 7.1 CLI 与输出

```bash
peaks design check --project <repo> [--app <path>] [--rid <rid>] [--session-id <sid>] \
  [--url <url>] [--pages /,/orders] [--files <a,b,c>] [--base <ref>] \
  [--start] [--allow-source-only --accept-note "<用户原话>"] [--skip-exemplar] [--gate] [--json]
```

**变更集解析（修正：不让空 diff 变成通过）**

1. 给了 `--rid` → 读该 rid 的 `## Changed paths` 声明（复用 `readRidChangeClaims`），再与工作树求交；
2. 给了 `--files` → 直接用；
3. 否则 → `readGitChangeSet(projectRoot, --base ?? 'HEAD')`；
4. **解析不到任何变更 → `surface.isUi = "unknown"` → 顶层 `blocked`（`DESIGN_CHANGE_SET_UNKNOWN`）**，绝不写 `not-applicable`。
   - 理由：本仓已有"缺失的过程被读成判决"的教训；空 diff 不是"没有 UI 变更"，是"这次没测到"。

**exit code**：`0` pass / `1` fail / `2` blocked / `3` usage 或内部错误。

**`--allow-source-only` 只允许交互式使用（Q3）**：无 session / `--ci` 环境直接 exit 3 拒绝；`--accept-note` 必填，证据记录 `sessionId` + 用户原话。`--skip-exemplar` 走同一模式（记录用户显式接受）。

**envelope（草案）**：

```json
{
  "ok": true,
  "command": "design.check",
  "data": {
    "schemaVersion": 1,
    "rid": "001",
    "verdict": "fail",
    "surface": { "isUi": true, "reasons": ["changed: src/pages/orders.tsx"] },
    "engine": { "available": true, "version": "13.4.1", "browserReady": true },
    "checks": {
      "g1_source": {
        "status": "fail",
        "findings": [
          { "code": "DESIGN_INLINE_STYLE", "file": "src/pages/orders.tsx", "line": 42, "severity": "fail" }
        ]
      },
      "g2_render": { "status": "pass", "pages": ["/orders"], "drift": 0.0, "slop": 18 },
      "g3_exemplar": { "status": "skipped", "reason": "no-exemplar-for-archetype" }
    },
    "evidencePath": ".peaks/_runtime/<sid>/design/check-001.md",
    "sha256": "..."
  },
  "warnings": [],
  "nextActions": []
}
```

### 7.2 G1 — 源码一致性（不依赖引擎）

**执行器（修正：不经过 `peaks lint`）**

- `peaks lint` 强制 `--config config/eslint/.peaks-rules.cjs`，不继承项目配置，且只跑 ESLint；用它会把下游项目的规则替换掉。
- G1 用**内置源码扫描器**（`src/services/design/source-scan/`，正则/AST-lite，和 `existing-system-visual-tokens.ts` 同风格）。
- 项目自带 linter 只在后续切片作为**可选增强**（显式传入项目配置并合并，而不是替换）。
- 内置扫描器无法覆盖该文件族 → `blocked`（`DESIGN_SOURCE_CHECK_DEGRADED`），不报 pass。

在**变更集中的页面文件**上检查（页面根来自 `paved-road.json.pageRoots`）：

| 规则 | 代码 | 默认 severity |
|---|---|---|
| inline style（`style={{...}}` / `style="..."`） | `DESIGN_INLINE_STYLE` | fail |
| 裸色值（hex / rgb / hsl，非 token 定义处） | `DESIGN_RAW_COLOR` | fail |
| 直接引 UI 库（不在 `componentEntrypoints`，且不在 allow 列表） | `DESIGN_LIBRARY_BYPASS` | fail |
| Tailwind 任意值（`w-[123px]`、`text-[#fff]`） | `DESIGN_ARBITRARY_VALUE` | **fail** |
| 原生元素（`<button>` / `<input>` / `<select>` / `<table>`）且 DS 已覆盖 | `DESIGN_RAW_PRIMITIVE` | **fail** |
| token 覆盖率 < 阈值（默认 0.9） | `DESIGN_TOKEN_COVERAGE` | warn |

**severity 的来源**：`paved-road.json.rules`（见 6.3），缺省取发布级默认值。用户要调级时由 LLM 代跑 `peaks design rule set --rule <code> --severity <warn|fail>`，用户只做 NL 决策。

**`DESIGN_TOKEN_COVERAGE` 的口径（Q7）**：只统计**变更集中的页面文件**里的硬编码 color / font-size / spacing / radius 字面量；值等于 `tokens.json` 的 token 值或引用 token 变量才算覆盖；`components/ui` 等 DS 内部不计；阈值 0.9。渲染层的覆盖由 G2 负责，不在 G1 重复计算。

**`DESIGN_ARBITRARY_VALUE` / `DESIGN_RAW_PRIMITIVE` 是硬失败**：这两条直接对应"UI 库在手边却硬编码"的症状，不能靠降级吸收。误报必须靠**检测精度**解决（S1 的 allow-list、组件映射表、精度测试），而不是把规则改成 warn。per-project 下调只作为用户显式裁决的例外，不能是默认值。

### 7.3 G2 — 渲染一致性（依赖 designlang）

对 `engine.json.render.pages`（或 `--pages`）逐页执行：

| 检查 | 命令 | 判定 |
|---|---|---|
| token 漂移 | `designlang drift <url> --tokens design/tokens.json` | 非零退出 → fail |
| 品牌/断点/暗色 | `designlang verify-ui <url> --brand design/contract.md` | 非零退出 → fail |
| 通用化程度 | `designlang slop <url>` | 首版 warn；校准后阈值 fail |
| 设计评分 | `designlang grade <url>` | 首版 warn；仅展示，不门禁 |

**dev server**：默认只探测 URL；`--start` 才由 peaks 在 `render.cwd` 拉起 `startCommand`、等就绪、结束后回收；进程树回收在 Windows 与 POSIX 分别有测试。

**URL 信任（Q4）**：默认只允许 loopback（`localhost` / `127.0.0.1`）和 `engine.json` 中经用户确认的 URL；其他 host 每次都要显式接受并记录。v1 **不支持 `--cookie` / `--header` 透传**；任何 cookie/header 不得写入 tracked 文件或证据。

**正向证据（Q5）**：`designlang` exit 0 不足以判 pass；必须产出一个正向产物（输出文件或可解析摘要，至少含被测页面数与时间戳）。没有正向产物 → `blocked`（`DESIGN_RENDER_NO_EVIDENCE`），不报 pass。

**截图**：designlang 的文档输出**不包含逐页截图**。因此：
- G2 不依赖截图出判决，只依赖 exit code + 归一化摘要；
- 黄金范例截图由 `peaks-ui` 在 init/评审时抓取并落到 `design/exemplars/`；
- 若某项检查要求截图而没有任何生产者 → `blocked`，不静默跳过；
- S2 的 spike 先确认 `verify-ui` / `drift` 是否有可用的机器输出（§11 U1）。

不可用矩阵：

| 情况 | 结果 |
|---|---|
| 包缺失 | `blocked` / `DESIGN_ENGINE_UNAVAILABLE` |
| 浏览器缺失 | `blocked` / `DESIGN_BROWSER_UNAVAILABLE` |
| 无 URL 配置 | `blocked` / `DESIGN_RENDER_URL_MISSING` |
| URL 不可达 | `blocked` / `DESIGN_RENDER_UNREACHABLE` |
| 登录/CAPTCHA/SSO/MFA 墙 | `blocked`（复用 `peaks-ui` Contract 2，等用户确认） |
| URL 不在信任范围且未显式接受 | `blocked` / `DESIGN_URL_UNTRUSTED` |
| exit 0 但无正向产物 | `blocked` / `DESIGN_RENDER_NO_EVIDENCE` |
| 用户显式 `--allow-source-only --accept-note "..."` | `skipped(explicitly-accepted)`；证据记录 `sessionId` + 用户原话 |

`--allow-source-only` 缺少 `--accept-note` → exit 3（usage），不写证据。

### 7.4 G3 — 范例保真（可选，S4）

拆成两条（Q21）：

**G3a 同路由视觉回归（硬门禁）**

- 同一路由的 before/after，用 `designlang fidelity <baseline-url> --clone <candidate-url> --min 90`；低于 90 → **fail**。
- 动画禁用、易抖元素遮罩；baseline 存 `.peaks/_runtime/<sid>/design/baseline/`（gitignored），首次绿色运行时建立。
- 只对存在 baseline 的路由生效。

**G3b archetype 保真（先 advisory）**

- 候选页 vs 黄金范例（内容不同），**不用像素差**；用 VLM 按 rubric 打分（布局节奏 / 字阶 / 色彩纪律 / 状态齐全 / 响应式 / a11y，各 1–5）。
- 首版 advisory；校准后阈值 = 总分 ≥ 32/40 且无单项 < 3。

**范围**：只对"本次变更路由且存在对应 exemplar"的页面自动启用；`--skip-exemplar` 需要记录用户显式接受（与 Q3 同一模式）。不启用时 `skipped(no-exemplar-for-archetype)`。

### 7.5 判定矩阵（顶层）

| 契约 | 变更集 | UI 表面 | 引擎 | 渲染 URL | 结果 |
|---|---|---|---|---|---|
| 未接入 | 任意 | 任意 | 任意 | 任意 | `not-adopted`（skipped，附 next action） |
| 已接入 | 未知/空 | — | — | — | `blocked`（`DESIGN_CHANGE_SET_UNKNOWN`） |
| 已接入 | 已知 | 否 | 任意 | 任意 | `not-applicable` |
| 已接入 | 已知 | 是 | 不可用 | — | `blocked` |
| 已接入 | 已知 | 是 | 可用 | 无/不可达/不信任 | `blocked`（除非显式接受） |
| 已接入 | 已知 | 是 | 可用 | 可达且信任 | G1 + G2（+G3）→ pass/fail |

---

## 8. 与 peaks-code 的接线

### 8.1 新 prereq `DESIGN_CONFORMANCE`

在 `src/services/artifacts/artifact-prerequisites.ts` 的 **`FEATURE_TABLE`** 的 `rd:qa-handoff` 中新增**一次**：

```ts
const DESIGN_CONFORMANCE: ArtifactPrerequisite = {
  relativePath: 'design/check-<rid>.md',
  description:
    'Design conformance evidence (peaks design check --gate). Accepts pass / not-applicable / not-adopted / explicitly-accepted; a missing engine or render is blocked, never a pass.',
  mustContain: ['schemaVersion: 1', 'sha256:', '## Design conformance'],
  mustContainAny: [
    'design-conformance: pass',
    'design-conformance: not-applicable',
    'design-conformance: not-adopted',
    'design-conformance: accepted'
  ],
  backCompat: true,
  backCompatUntil: '<发布 S3 的下一版>'
};
```

- **`REFACTOR_TABLE` 是 `FEATURE_TABLE` 的别名**（同一对象引用），加一次即可，不要重复 append。
- `BUGFIX_TABLE` 单独加一次。
- `MINIMAL_TABLE`（docs/chore）与 **`CONFIG_TABLE`**（config 有独立表）都不加。
- **`backCompatUntil` 不写死**：规则是"发布 S3 的那个 minor 的下一版"（若 S3 在 4.3.0 发布，则写 `v4.4.0`）。写死 `v4.3.0` 会让窗口为零。
- **`verify-pipeline` 会覆盖（Q20）**：在 `RD_EVIDENCE_GATES` 加一条 `design-conformance`（`relativePath: 'design/check-<rid>.md'`）。`deriveRdGates` 用请求类型的 prereq 表做 look-up（`pipeline-verify-rd-phase.ts:102`），表里没有该路径的类型（docs/config/chore）自动跳过——**条件性是免费的**；body 检查走 `prerequisiteBodyViolations`，与 transition 门共用同一套 marker。

### 8.2 UI 表面判定

`peaks design check` 自行判定，不要求 RD 声明：

- 变更路径的扩展名命中 `{tsx,jsx,vue,svelte,css,scss,sass,less,html}`，或
- 变更路径落在 `paved-road.json.pageRoots` 下，或
- 变更涉及组件目录（复用 `scan existing-system` 的 `componentDir`）。

三者任一为真 → `surface.isUi = true`，并在 envelope 里给出 `reasons`。
变更集未知 → `blocked`（见 7.1），不返回 `not-applicable`。

### 8.3 反伪造与已知限制

- 证据文件带 `schemaVersion: 1` + `sha256:` + 固定段标题；手写 stub 仍可能满足 substring 检查——这是与本仓其他 prereq 相同的已知限制，不单独提高门槛。
- `check --gate` 是唯一写入者；RD 直接手写证据属于违规，由 QA 抽样发现。
- 不把 `designlang` 的分数写进"批准"路径；分数只是证据，verdict 由 Peaks 计算。

### 8.4 角色消费

| 角色 | 消费方式 |
|---|---|
| `peaks-design` | 读契约与门禁 envelope；编排设计域流程（见 §9） |
| `peaks-ui` | 读 `design/contract.md` + `paved-road.json`；design-draft 必须引用契约章节；原型必须用 `componentEntrypoints` |
| `peaks-rd` | 读同一份真值；实现只用 DS 组件；交付前跑 `peaks design check --gate` |
| `peaks-qa` | 读 `check-<rid>.json`；测试用例必须含设计回归种子（截图/范例） |
| `peaks-sc` | `design/**` 视为 tracked 产品真值；runtime 截图与 envelope 不提交 |
| `peaks-txt` | 把契约版本与最近一次 check 写入上下文胶囊 |

### 8.5 `design` request 角色（Q1 / Q11）

新增第六个 request role：`design`。落点四处：

1. `src/services/artifacts/artifact-templates.ts:19` 的 `RequestArtifactRole` 增加 `'design'`；
2. `src/cli/commands/request-format-helpers.ts:92` 的 `VALID_ROLES` 增加 `'design'`；
3. `artifact-templates.ts:248` 的模板 switch 增加 `design` 分支；
4. role 目录解析（`.peaks/_runtime/<sid>/design/requests/`）与 `request init/show/transition` 的 role 校验。

**模板固定五段**：`## Scope` / `## Contract status` / `## Conformance` / `## Changed paths` / `## Acceptance`。

- 沿用现有六态状态机；
- `design/check-<rid>.md` 仍是**机器证据**，不是 request artifact；
- 一个 rid 由 `design` owning，peaks-ui / rd / qa 的 artifact 挂同一 rid；
- **纯审计（不改代码）也建 `design` request**，gate 判 `not-applicable`。

### 8.6 门禁失败后的修复循环（Q19）

- `design check --gate` 返回 `fail` → 同一 rid 回 RD 修复，**计入现有 3 轮修复上限**（`skills/peaks-code/references/micro-cycle.md:235`），不新开计数器/request。
- `blocked` **不算**一轮：它表示检查没跑成，先修环境（引擎/浏览器/URL/信任）再重跑；消耗修复轮次会造成假阻塞。
- 3 轮后仍 fail → blocked TXT handoff，把设计 findings 列为已知阻塞项。
- `not-adopted` / `not-applicable` / `accepted` → 直接放行。

---

## 9. 用户入口：`peaks-design` skill（兄弟泳道，用户已裁决 A）

### 9.1 定位

`peaks-design` 是与 `peaks-code` **同级的 orchestrator 技能**，不是 bee，**不被 peaks-code 派遣**。它服务**设计域**的端到端工作；peaks-code 仍是**功能开发**的端到端编排器。

| 问题 | 路由 |
|---|---|
| "把设计系统建起来 / 审计页面一致性 / 把某页改到符合业务风格" | `peaks-design` |
| "开发一个需求 / 从 PRD 到上线 / 修一个业务 bug" | `peaks-code` |
| 功能开发里包含 UI 实现 | `peaks-code` 照常派遣 `peaks-ui`，并消费 `design/` 与门禁 |

两者**互不派遣**，但会**互认**：`peaks-code` 在请求是设计形状时建议切到 `peaks-design`；`peaks-design` 在请求是功能形状时建议切到 `peaks-code`。这保持了「orchestrator / bee 两层」的既有模型。

### 9.2 职责

**拥有**

- owning `design` request（§8.5）；设计域的 gate 转换由它驱动
- 建立/修订设计契约（`design init` 的 LLM 侧编排、契约评审摘要、用户确认）
- 设计审计：`design check` + 渲染证据 + 一致性/漂移解读
- 系统性 UI 修复的计划与验收（不自己写代码）
- 黄金范例的登记、评审与更新
- 交付前的设计门禁（`design check --gate`）

**派遣**

- `peaks-ui`：设计方向、原型、页面状态、设计制品
- `peaks-rd`：任何 `src/**` / `tests/**` 代码修改（**Code-Gate 与 peaks-code 相同：orchestrator 不直接 Edit/Write 源码**）
- `peaks-qa`：验证与回归证据
- `peaks-prd`：仅当设计变更需要需求框架时

**与 peaks-ui 的分工（Q16）**

peaks-design 拥有**设计系统与契约**；peaks-ui 在契约之上负责**美感与工艺**。peaks-ui 可以**提议**新 token / 变体，但采纳必须经 peaks-design + 用户确认；通用 taste 规则只在**没有契约**时生效。两者不抢权：一致性归 peaks-design，美感归 peaks-ui。

**不做**

- 不直接改代码（硬红线）
- 不签发 QA verdict
- 不替代 peaks-code 做功能开发的端到端流程
- 不处理非代码设计（品牌、印刷、演示文稿）
- 不允许 peaks-ui 的通用 taste 规则越过项目契约

### 9.3 默认流程

1. 识别请求是设计形状；读 `.peaks/standards/loop-engineering-guidelines.md` 与项目 `design/contract.md`（若存在）。
2. `peaks design status --project .` 判定是否已接入。
3. 未接入 → 走 `design init`（6.6 的三处用户选择）→ 用户确认契约。
4. 设计审计 → `peaks design check`（可能 `blocked`；按 blocked 原因处理，**不跳过、不伪造**）。
5. 需要改代码 → 派遣 `peaks-rd`，把 `contract.md`、`paved-road.json`、findings 作为硬约束；实现后派遣 `peaks-qa`。
6. 交付 → `peaks design check --gate` 写证据；`fail` 回 RD 并计入 3 轮上限，`blocked` 先修环境、不占轮次（§8.6）。
7. 收尾 → 更新范例（用户确认后）、`peaks memory extract`。
8. 契约修订只在用户确认后走 `design init --refresh`；`design status` 显示契约年龄 + 最近一次观测漂移，**绝不自动采纳**（Q8）。

### 9.4 注册面（机械清单）

新增目录 `skills/peaks-design/`（`SKILL.md` + 可选 `references/` + `test_prompts.json`）。必须挂进：

| 位置 | 改动 |
|---|---|
| `src/services/skills/presence-role.ts` | 加入 `ORCHESTRATOR_ROLE_SKILLS` |
| `.claude/output-styles/peaks-skill-swarm.md:56` | orchestrator 列表加入 `peaks-design` |
| `src/services/skills/skill-conformance-service.ts` | `SKILL_NAMES` 加入 `peaks-design` |
| `src/cli/commands/_super.ts` | `ROUTES.make` 增加 `design/ui/设计系统` 词路由 |
| `skills/**/SKILL.md` **全部** | loop-hygiene 块内的 "Edit one, edit all 25" → `26`，26 份必须**原子**同改（`tests/unit/skills/loop-hygiene-block.test.ts` 强制逐字节一致） |
| `tests/unit/skills/presence-role-coverage.test.ts` | 无需改，但必须变绿（它会对 shipped skills 与两份列表做交叉校验） |
| `peaks skill lint --category loop-engineering-readiness --path skills/peaks-design` | 必须通过 |

`skills/**` 已在 `package.json` 的 `files` 中，无需打包改动。安装器按目录发现技能（实现时确认 `scripts/install-skills*.mjs`）。

### 9.5 与其他 orchestrator 的差异

- `peaks-code`：功能开发全流程；拥有 PRD→RD→QA 的 gate 转换。
- `peaks-design`：设计治理域；同样拥有 gate 转换，但只在设计形状的请求内，且其代码改动必须经 `peaks-rd`。
- `peaks-doctor`：项目健康检查，不改代码、不改契约。
- `peaks-race-code`：小改动的快泳道；不承担设计治理。

---

## 10. 非目标 / 反目标

**非目标**

- 不生成页面、不生产设计稿、不做 Figma 同步。
- 不判定"美不美"的绝对分数；`grade`/`slop` 只作证据与趋势。
- 不覆盖非前端项目。
- 不要求所有下游项目接入。
- 不提供 hosted 服务。

**反目标（发生即视为失败）**

- 引擎/浏览器/URL/变更集缺失时返回 `pass`。
- 把观测到的离群值自动写进契约。
- 让用户手写 CLI、JSON 或证据文件。
- vendor `designlang` 源码，或安装它的 plugin/MCP/skill。
- 把 `.peaks/_runtime/**` 或截图提交进 git。
- 让 `peaks-code` 的核心流程依赖一个可选 MCP。
- 让 `peaks-design` 变成第二个 peaks-code：直接改源码、或接管功能开发。
- 让 peaks-ui 的通用 taste 规则越过项目契约。
- 把含客户数据的截图提交进 git。
- 在没有校准的情况下把 `slop`/`grade` 变成硬失败。

---

## 11. 风险与未知

| # | 风险 / 未知 | 处置 |
|---|---|---|
| U1 | designlang 的 `drift` / `verify-ui` / `slop` 是否有稳定机器输出？README 未承诺 | S2 先做 spike；无 JSON 时只依赖 exit code + 归一化 stdout 摘要；分数保持 advisory |
| U2 | 逐页截图无 documented 产物；`--start` 的进程生命周期（端口/超时/孤儿回收/Windows） | S2 spike 确认；无截图生产者时 `blocked`；`--start` 先在单平台实现并补 Windows 测试 |
| U3 | CI 无 Chromium / 下载体积 | `install-browser` 不自动跑；`status` 明确报告；CI 文档给 `--system-chrome` 路线 |
| U4 | 受登录墙保护的页面无法抽取 | 复用 `peaks-ui` Contract 2：`blocked` + 用户确认，不静默降级 |
| U5 | G1 启发式误报（原生元素、任意值） | 这两条**默认 fail**；精度靠 S1 的 allow-list、组件映射表与误报样例测试保证；per-project 下调需用户显式裁决，不能作为默认 |
| U6 | slop/grade 主观性强 | 默认 advisory；在 ≥3 个下游仓库校准后再考虑门禁 |
| U7 | 上游版本漂移 | 适配层声明 supportedMajor；超范围 `blocked`；pin 到 lockfile |
| U8 | 大站点抽取慢 | `check` 只渲染 `engine.json.render.pages` / `--pages`；`site` 全站爬取只在 `init --max-pages` |
| U9 | 源码 token 与渲染 token 冲突 | 契约优先；冲突进 findings；采纳需用户确认 |
| U10 | 内置扫描器覆盖不足 | `blocked`（`DESIGN_SOURCE_CHECK_DEGRADED`），不 pass |
| U11 | 证据文件可被手写伪造 | 与既有 prereq 同等限制；列入 QA 抽样，不假装已解决 |
| U12 | 两个 orchestrator 的门禁语义漂移 | 同一份 `design/` 真值、同一个 `DESIGN_CONFORMANCE` prereq、同一个证据格式；`peaks-design` 不得自建第二套判定 |
| U13 | 契约根判断错误（混合仓 / monorepo） | 默认 per 前端 app root；`--app` 显式覆盖；试点仓是"Go 后端 + `web/` 前端"，契约根 `web/design/`；多 app 仓库留待 S3 之后验证 |
| U14 | 26 份 loop-hygiene 块未原子更新导致 CI 红 | 新增技能与 "25→26" 同一次提交完成 |
| U15 | 硬依赖带来安装体积与供应链面（designlang 8 个直接依赖，含 playwright / MCP SDK） | S2 记录 lockfile diff、license 与依赖树；不自动下载浏览器；发布说明写清这条新增依赖 |
| U16 | Tailwind v4 无 `tailwind.config.*`；`extractTailwindTokens` 抓不到 `@theme` | 但 `parseCssVars` 已覆盖 `@theme`（`walkStyleFiles` 含 `src/styles`）；S1 补 fixture + `theme-file` 来源标注 + 语义映射；关键是按 app root 调用，不能用餐仓库根 |
| U17 | 试点仓工作树脏、本地 develop 领先远端 3 个提交 | 从 `origin/develop` 建 worktree（`D:\projects\ModelMatrix-pilot`，分支 `pilot/peaks-design`），原 checkout 不动 |
| U18 | G3a 像素回归易抖（字体/抗锯齿/动画） | 禁用动画、遮罩易抖元素、固定视口与缩放；先单平台跑稳再加 Windows |
| U19 | designlang 访问任意 URL 带来 SSRF/敏感页风险 | 默认 loopback + 已确认 URL；v1 无 cookie/header 透传；外部 host 需显式接受 |

---

## 12. 切片

**S1 — 真值层（无引擎也能交付）**

- `peaks design init` / `status` / `uninit` / `init --refresh`
- 契约渲染：`contract.md`、`tokens.json`（源码 + 用户确认）、`paved-road.json`（含 `rules`）、`engine.json`
- 前端 app root 契约根：单 app 在根；monorepo/混合仓（`--app`）在各自 app root
- **Tailwind v4 `@theme` fixture + `theme-file` 来源标注**（`parseCssVars` 已覆盖解析）
- `design-governance.md` 独立文件 + AGENTS 条件行
- 黄金范例登记与截图脱敏检查
- G1 内置扫描器 + `peaks design check --source-only` + `DESIGN_TOKEN_COVERAGE` 口径
- **`design` request 角色四处扩展 + 五段模板（§8.5）**
- **URL 信任默认值**（loopback + 已确认 URL）
- `peaks-design` skill 骨架 + 注册面（§9.4）

**S2 — 引擎适配层**

- `designlang` 进 `dependencies`
- 可用性三判 + 版本闸
- `extract` / `drift` / `verify-ui` / `slop` 封装
- **动态 URL 解析**（`--url` > `PEAKS_DESIGN_URL` > 显式 url > startCommand/port 推导）
- **正向证据要求**（exit 0 不够，必须有产物）
- 渲染 envelope + 截图/进程纪律
- `check` 完整矩阵
- **前置 spike（U1/U2）**：确认机器输出与截图/进程能力，再定适配层解析策略

**S3 — 门禁接线**

- `DESIGN_CONFORMANCE` prereq（只加 `FEATURE_TABLE` 一次 + `BUGFIX_TABLE` 一次）
- `RD_EVIDENCE_GATES` 加 `design-conformance`（条件性由 prereq 表免费提供）
- `check --gate` 写证据；变更集解析三路线
- **门禁失败回 RD 的循环语义（§8.6）**
- `peaks-ui` / `peaks-rd` / `peaks-qa` / `peaks-txt` 散文更新
- 试点：ModelMatrix `pilot/peaks-design` worktree（见 §13）

**S4（可选）— 范例保真**

- G3a 同路由回归（`fidelity --min 90`，硬）
- G3b archetype rubric（先 advisory，校准后 32/40 且无单项 < 3）
- 阈值校准与告警；baseline 抖动治理

---

## 13. 验收与试点

**功能验收**

1. 未接入项目：`check` 返回 `not-adopted`，不阻塞。
2. 已接入的非 UI 变更：`not-applicable`。
3. **变更集为空/未知**：`blocked`，绝不 `not-applicable`。
4. 已接入的 UI 变更 + 引擎缺失：`blocked`，exit 2，绝不 pass。
5. 已接入的 UI 变更 + 引擎可用：至少能抓到一处真实的 inline style / 裸色值；`DESIGN_ARBITRARY_VALUE` 与 `DESIGN_RAW_PRIMITIVE` 的样例必须判 `fail`。
6. `--allow-source-only` 缺 `--accept-note`：exit 3，不写证据。
7. `init` 幂等：重复运行不覆盖用户 prose；`--force` 只重写 `contract.md` / `tokens.json` 且留 `.bak`。
8. 非前端项目：`DESIGN_NOT_FRONTEND`，不生成任何文件。
9. `peaks-design` 技能：`/peaks-design` 可激活；presence header 的 Role 为 `orchestrator`；`peaks skill lint --category loop-engineering-readiness` 通过；26 份 loop-hygiene 块逐字节一致。
10. `peaks-design` 不直接改源码：对它尝试 Edit `src/**` 时 Code-Gate 必须拒绝。
11. `design` 角色：`peaks request init --role design` 可用，模板含五段；纯审计不改代码也能建 request 并判 `not-applicable`。
12. URL 信任：非 loopback 且未显式接受的 URL → `blocked`；v1 不存在 `--cookie` / `--header` 透传。
13. 正向证据：一个"exit 0 但不产出任何文件"的假 designlang → `blocked`，不 pass。
14. G3：同路由 fidelity < 90 → fail；archetype rubric 首版只 advisory。

**试点执行（Q10 / Q14 / Q15 / Q17 / Q18）**

- 仓库：`D:\projects\ModelMatrix`（Go 后端 + `web/` 前端；React 19 / TanStack Router / Tailwind v4 / shadcn / rsbuild）。
- 分支：从 `origin/develop` 建 worktree `D:\projects\ModelMatrix-pilot`，分支 `pilot/peaks-design`；本地 `develop` 的脏工作树与 3 个未推送提交不动。
- 契约根：`web/design/`；`pageRoots` = `web/src/routes` + `web/src/features`；`componentEntrypoints` = `@/components/ui`；排除 `web/src/components/ui`。
- 两类页面：列表 `features/channels`；表单 `features/subscriptions`。
- 基线（init 之前，存 `.peaks/_runtime/<sid>/design/baseline/`）：inline style 数、裸色值数、token 覆盖率、designlang slop/grade（引擎可用时）。

**试点指标（ModelMatrix）**

- 裸样式节点占比（check 前后）
- token 覆盖率
- `slop` 分数变化
- `check` 的误报率（人工抽检 20 条 findings）
- 从"生成完"到"门禁通过"的迭代轮数

**成功判据**

- 至少一条真实违规被门禁拦住；
- 没有任何一次"没跑却通过"；
- 试点仓库能接受日常使用，而不是靠人工豁免。

---

## 14. 备选方案与裁决理由

| 方案 | 内容 | 为什么不选 |
|---|---|---|
| 只出更强 design skill | 再写一份 prompt/规范 | 用户已证明无效；prompt 不是门禁 |
| 只做仓库审计 | 只检查仓库，不做流程门禁 | 生成期仍会跑偏，问题不会减少 |
| 只做流程门禁 | 只在交付时截图评分 | 没有项目真值，评分没有参照物 |
| **C：两层 + 引擎硬依赖 + 入口 A** | **真值层 + 门禁层 + 兄弟泳道入口；引擎为硬依赖，可用性每次显式判定** | **用户已裁决** |

`peaks-design` 的三种关系备选：**A 兄弟泳道（选定）** / B 嵌套阶段（打破 1 级 bee 模型）/ C 薄封装（不解决治理闭环）。

---

## 15. builder-check 裁决记录

独立子代理核对了文档中的代码断言，确认以下为真：`renderUiLibraryPriorityRule` 位置与条件渲染；`readGitChangeSet`；`design/check-<rid>.md` 解析路径；`.peaks/_runtime/` 被 gitignore 而根 `design/` 不被忽略；`designlang@13.4.1` 为最新；`mustContain` / `mustContainAny` / `backCompat` 语义。

| # | 问题 | 裁决 |
|---|---|---|
| 1 | G2 的 dev server 谁负责？ | 默认只探测 URL；`--start` 显式 opt-in 才拉起/回收；`startCommand` 只记录 |
| 2 | 逐页截图谁产出？ | S2 spike 确认；无生产者则 `blocked`；范例截图由 `peaks-ui` 在 init 时抓 |
| 3 | 变更集用哪个？ | `--rid` 用 changed-paths；否则工作树 vs `--base`；**空/未知 → blocked** |
| 4 | 治理块怎么写入/移除？ | 独立 `design-governance.md`，`design init` 幂等写、`design uninit` 删；不依赖 `standards update` 重写已存在文件 |
| 5 | monorepo 一份还是多份？ | 每个前端 app root 一份；`--app` 指定；单 app 回落根 |
| 6 | G1 走 `peaks lint` 吗？ | 不走；内置扫描器为主；项目 linter 只作后续可选增强 |
| 7 | severity 如何调级？ | `paved-road.json.rules` 的 severity；缺省发布级默认（两条硬失败）；LLM 代跑 `design rule set` |
| 8 | `--allow-source-only` 的接受者怎么记？ | 必须 `--accept-note "<用户原话>"`；证据记 `sessionId` + 原话；缺 note → exit 3 |
| 9 | `backCompatUntil` 写什么？ | 规则："发布 S3 的下一版"；发布时填，不写死 |
| 10 | tracked `design/` 的逐文件归属 | 见 §6.2；`contract.md`/`tokens.json` 可 `--force` 重写留 `.bak`，`exemplars/` 与 `rules` 永不删 |

**已修正的代码偏差**

1. `peaks lint` 强制自有 `--config`、只跑 ESLint、stylelint 仅 `--print-config` → G1 改内置扫描器。
2. `peaks standards init/update` 对已存在文件只标 `existing`（`O_EXCL`）→ 不采用"渲染时注入 `coding-style.md`"。
3. `REFACTOR_TABLE` 是 `FEATURE_TABLE` 的别名 → prereq 只加一次。
4. `verify-pipeline` 枚举固定 `RD_EVIDENCE_GATES`，但 `deriveRdGates` 会按 prereq 表过滤 → 加一条 `design-conformance` 即可条件覆盖（grilling Q20 修正了初版判断）。
5. `config` 使用独立的 `CONFIG_TABLE`，不是 `MINIMAL_TABLE` → 文档措辞修正。
6. codegraph 是硬 `dependencies` → 与本次 `designlang` 硬依赖一致，先例成立（早前"可选依赖"版本已按用户 review 撤回）。

---

## 16. 用户裁决记录

- **2026-11-23**：选择 **C（两层治理）**；认可 `designlang` 作为测量引擎（GitHub `Manavarya09/design-extract`，npm `designlang`）。
- **2026-11-23**：先选 A′（optionalDependencies + 显式可用性判定）；**用户 review 后改为硬依赖：`designlang` 进 `dependencies`**。"可用性三判 + 绝不静默降级"保留不变。
- **2026-11-23**：`DESIGN_ARBITRARY_VALUE` 与 `DESIGN_RAW_PRIMITIVE` 的默认 severity 由 `warn` 改为 **`fail`**。
- **2026-11-23**：选择 **A（`peaks-design` 兄弟泳道）**——新建上层技能，与 `peaks-code` 同级，调用 `peaks-ui` 相关能力；两者互不派遣。

**grilling 三轮（Q1–Q21，全部按推荐采纳）**

| 轮 | 问题 | 裁决 |
|---|---|---|
| R1 | Q1 请求归属 | **B**：新增 `design` request 角色 |
| R1 | Q2 单仓/monorepo | 两者都适配；契约根 = 前端 app root |
| R1 | Q3 `--allow-source-only` | **A**：保留，仅交互式 + `--accept-note`；CI 拒绝 |
| R1 | Q4 URL 信任 | **A**：loopback + 已确认 URL；不做 cookie/header；**render.url 动态解析** |
| R1 | Q5 G2 正向证据 | **A**：exit 0 不够，必须有产物 |
| R1 | Q6 审美权威 | **A**：契约优先；peaks-ui 在契约之上做美感 |
| R1 | Q7 token 覆盖率 | **A**：变更页面文件的硬编码字面量；DS 内部不计；阈值 0.9 |
| R1 | Q8 契约修订 | **A**：`design status` 显示年龄/漂移；`init --refresh` 仅用户确认；不自动采纳 |
| R1 | Q9 截图提交 | **A**：只提交脱敏/合成截图；runtime 与 baseline gitignored |
| R1 | Q10 试点 | ModelMatrix；list + form |
| R2 | Q11 `design` 角色形态 | 五段模板；六态；check 证据分离；纯审计也建 request |
| R2 | Q12 动态 URL | `--url` > `PEAKS_DESIGN_URL` > 显式 url > startCommand/port 推导 |
| R2 | Q13 Tailwind v4 | S1 加 fixture + `theme-file` 来源标注（`parseCssVars` 已覆盖解析） |
| R2 | Q14 试点分支 | 从 `origin/develop` 建 worktree；`pilot/peaks-design` |
| R2 | Q15 ModelMatrix 契约根 | `web/design/`；pageRoots/routes+features；entrypoints `@/components/ui` |
| R2 | Q16 peaks-ui 边界 | 可提议 token/变体；采纳需 peaks-design + 用户；通用规则只在无契约时 |
| R2 | Q17 试点页面 | 列表 `features/channels`；表单 `features/subscriptions` |
| R2 | Q18 基线 | init 前留 baseline（inline/裸色/覆盖率/slop） |
| R3 | Q19 失败路由 | `fail` 回 RD 计入 3 轮；`blocked` 不占轮次 |
| R3 | Q20 verify-pipeline | 加 `design-conformance`；条件性由 prereq 表提供 |
| R3 | Q21 G3 | G3a 同路由回归硬（<90 fail）；G3b archetype rubric 先 advisory |

- **grilling 结论**：frontier 为空，无未决问题。待用户对 v4 做最后一次整体确认后，进入 `superpowers:writing-plans`。
