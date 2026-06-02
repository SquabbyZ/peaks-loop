# PRD Request 2026-06-02-grep-strip-meta

- session: 2026-05-29-session-746113
- type: feature (ux-fix)
- source: dogfood feedback `.peaks/memory/dogfood-2026-06-02-wechat-post-sop.md` + PRD 003 v2 G4 (`grep absent:true`) 真实链路踩到
- raw input (sanitized): 在 wechat-post-publish SOP 的 dogfood 中,作者在 post 草稿里"讨论 gate 命中词" 本身会被同 gate 拦下。清草稿需要绕"字面词陷阱",与 PRD 003 "通用流程门禁" 定位不符 —— 应让 manifest 显式声明 "我关心的是渲染给读者的内容,不关心元描述",而不是强迫作者改名 / 拆词 / 用 marker。

## Background

PRD 003 (sop global reuse) → PRD 004 Slice 2 (gate hook) → PRD 005 v2 (4 UX fixes,已 ship 8 文件 2 commits)。

PRD 005 v2 dogfood 暴露真实 gap:在 `peaks-cli/posts/2026-06-02-prd005-v2-dogfood.md` 这篇"草稿" 里,
- 第 1 次写 post 时,内容里带 "T-O-D-O" 提示标记,被 `no-todo` gate 正确拦下。
- 第 2 次清掉 T-O-D-O,但在结果段"我们用 grep absent gate 拦 T-O-D-O" 这样的描述,触发**自指**命中,再次被拦下。
- 第 3 次把 T-O-D-O 改成 "T-O-D-O" 拆词 + 改 "我们用 grep absent 拦讨论词" 描述,但其它段落又触发了。
- 第 4 次彻底把所有讨论段改写,才通过。

这个问题在**内容发布域**特别突出:作者在写"为什么这里不该有 X" 时,必然要写 X 一次。在代码评审域少见(代码评审写 "fix T-O-D-O in handler.ts" 不太自指)。但 peaks-sop 的产品定位是"通用流程门禁"(见 memory `custom-sop-domain-agnostic-positioning`),不是"代码评审专用"。

## Goals

- **G1**: `grep` check 新增可选 `stripMeta: true` 字段。开启后,evaluator 在 `regex.test` 之前先把文件内容做 meta-strip:
  - HTML/XML 注释 `<!-- ... -->` 整段去掉。
  - Fenced code blocks ` ``` ... ``` ` 整段去掉(语言不限,3+ 反引号闭合)。
  - 多行 `/* ... */` 注释整段去掉。
- **G2**: `stripMeta: true` 与现有 `absent: true` 正交可叠加。组合语义:`absent: true, stripMeta: true` = "在剥离元描述后的内容里,pattern 必须不存在"。两个布尔字段独立。
- **G3**: 默认 `stripMeta: false` 严格保留现有 behavior(G1 v2 P5 兜底)。Manifest 升级路径:**只对声明 `stripMeta: true` 的 gate 生效**,其余 gate 一字不变。
- **G4**: Lint 接受 `stripMeta: true` 字段;schema 校验;`peaks sop lint` 列出所有声明了 `stripMeta: true` 的 gate id,供 author 复核。
- **G5**: SOP dogfood 链路可重跑验证。重新跑 wechat-post-publish SOP,在草稿里**写"我们用 grep absent 拦 T-O-D-O" 这类 meta 讨论**也能过 publish gate(只要真实的"渲染给读者的内容" 里没有 T-O-D-O)。

## Non-goals

- N1: 不做"内容相似度""语义匹配"之类的 LLM 评估;只做机械的 meta 剥离。
- N2: 不动 `file-exists` / `command` 两种 check 类型的语义。
- N3: 不动 PRD 004 Slice 2 的 project-first + merged registry + PreToolUse hook。
- N4: 不引入新的依赖(纯字符串处理,Node 内置)。
- N5: 不在 stripMeta 实现里去掉 inline code(`` `T-O-D-O` ``)或引用块(`> T-O-D-O`)。两者是"作者明确想让读者看到的内嵌内容",属于渲染层关注。Meta-strip 范围严格限定 HTML 注释 / fenced code / 块注释三种。如果 dogfood 后续发现 inline code 也自指,另起一个 PRD。
- N6: 不动 SKILL.md / sop-authoring.md 的现有章节,只加一段 "literal-word trap 与 stripMeta" 解释。

## Preserved behavior (QA 必须回归)

- **P1** (per PRD 005 v2 P1-P7 全部保留):内置 peaks-* 不入注册表 / command 仍需 `--allow-commands` / range-3 仍阻断 / file-grep 路径仍钉在项目根 / 既有 `grep` (找到即 pass) 语义不变(对 `absent:false` gate) / 双层 registry 行为不变 / `sop init/lint/register` 不动。
- **P2** (`stripMeta: undefined` 或 `stripMeta: false`):evaluator 行为与今天完全一致,逐字节相同。这是 G3 的兜底,也是 backward-compat 的硬性要求 —— 现有 7 个 sop-*.test.ts 文件**不能**因为这个 PRD 改任何行为。
- **P3** (lint 行为):manifest 里不声明 `stripMeta` 字段的 gate,lint 输出**不含**任何新文本。lint 增加的输出只在"声明了 `stripMeta: true` 的 gate" 上出现,避免对没升级的 SOP 制造 noise。

## Acceptance criteria

- AC1: manifest `check: { type: "grep", file, pattern, absent: true, stripMeta: true }`,文件含 `<!-- T-O-D-O -->` HTML 注释 → gate pass(注释里命中被 strip)。
- AC2: 同上,文件里**渲染内容**部分含 T-O-D-O 字符串 → gate fail(剥离只去 meta,真实内容里的命中仍然 fail)。
- AC3: 同上,文件里 fenced code block ``` \nT-O-D-O\n``` → gate pass(代码块整段被 strip)。
- AC4: `stripMeta: true` 与 `absent: false` 组合(找到 pattern 才 pass):文件**只**在 HTML 注释里命中 T-O-D-O、渲染内容里没命中 → 评估时先剥离 meta,剥离后内容里没有 T-O-D-O,因此 `absent: false`(找到才 pass)语义下 gate fail。这是 OQ1 倾 (a) 的直接表现 —— meta-strip 是 evaluator 的一致前处理,与 `absent` 字段共同作用。
- AC5: `stripMeta: false` 与 `stripMeta: undefined` 与没声明此字段,在 fixture 上行为字节级相同(用 `tests/unit/sop-check-service.test.ts:69` 现有测试 + 新增 "no stripMeta" 对照测试)。
- AC6: `peaks sop lint` 接受 `stripMeta: true`;**只**在 gate 声明了 `stripMeta: true` 时,lint 输出新增一行 "stripMeta: meta content (HTML comments / fenced code / block comments) is excluded from grep evaluation"(放在 `warnings` 数组,不放 `findings` —— OQ3)。不声明的 gate 不出现。
- AC7: 全部既有 SOP 测试(7 个 sop-*.test.ts 文件)**字节级不变通过**。新加的 stripMeta 测试单独放在 `tests/unit/sop-check-service-strip-meta.test.ts` 之类独立文件,与既有测试隔离,避免 cross-pollution。
- AC8: 重新跑 wechat-post-publish SOP dogfood,manifest 的两个 grep absent gate 都加 `stripMeta: true`,草稿里"我们用 grep absent 拦 T-O-D-O" 这类 meta 讨论能过 publish gate(只要真实的"渲染给读者的内容" 里没有 T-O-D-O);同样的草稿在 `stripMeta: false` 下不能过(作为对照)。这是真实修复的"过桥"验证。
- AC9: doc-only 单行:在 `skills/peaks-sop/SKILL.md` 的 "Where SOPs apply" 或新增 "literal-word trap 与 stripMeta" 子节,加一段说明。`< 30` 行。

## Unresolved questions (留给 RD)

- **OQ1**: AC4 的存疑 —— 注释里命中 pattern 但真实内容里没命中时,`absent: false` 行为应该是什么?
  - (a) fail(剥离后没找到,按"找到即 pass"语义就是 fail) —— 与"先剥离再找"的直觉一致
  - (b) pass(看文件原文有命中,剥离不改变"absent: false"的语义)
  - **PRD 倾 (a)**:meta-strip 应当是 evaluator 的一致前处理,与 `absent` 字段共同作用。`absent: false` 的"找 pattern 才 pass" 是在 strip 之后的应用域里找。这与 markdown / html 渲染层"先排除 meta 再渲染"的语义一致。
- **OQ2**: 多行 `/* ... */` 块注释对 .md 文件有意义吗?(markdown 没有原生块注释)
  - 倾 (yes) —— peak-sop 用户场景里 .ts / .js / .c / .cpp 也会用 grep absent(比如 "发布前 .ts 文件里不能有 console.log"),块注释剥离对这些语言是必要的。
  - 倾 (no) —— 只做 HTML 注释 + fenced code,够覆盖 dogfood 案例;块注释另起 PRD。
  - **PRD 倾 yes** —— 一次到位,避免后续再开。
- **OQ3**: AC6 提到的 lint 输出具体格式?要 `findings` 数组(影响 machine 解析)还是 `warnings` 数组(纯信息)?
  - 倾 `warnings` —— 与现有 lint 的 `findings` 严格分离(findings = 错误,lint 必须报告;warnings = 提示,作者可忽略)。

## Risks

- **R1**: meta-strip 实现细节里有没有 bug?HTML 注释 `<!-- ... -->` 跨行、Fenced code 不闭合(EOF)、块注释嵌套 —— 任何 edge case 都可能让"剥离"本身 fail-open。R1 mitigation:剥离函数纯字符串处理,空内容/不闭合的 fence 当作"未剥离"(conservative),用清晰的单测覆盖三个语种的 happy path + 不闭合的 sad path。
- **R2**: 这是内容域的 UX 修复,不是"通用流程门禁"的硬约束。风险在于 dogfood 之外的领域(代码评审、CI 流水线)如果作者**依赖** "原文里出现 pattern" 才会 fail 的语义,stripMeta 会让他的 gate 行为漂移。R2 mitigation:`stripMeta` 是 opt-in,默认 false;lint 在 author 升级到 `true` 时明确 warnings 提示。
- **R3**: 用户可能期望 "把所有 meta 都剥离" 而不只是 HTML 注释 + fenced code + 块注释。R3 mitigation:本 PRD 明确只覆盖三种,且在 SKILL.md 写明"不覆盖 inline code / 引用块";如果 dogfood 后续发现其他自指源,另开 PRD。

## Handoff

- to peaks-rd: `.peaks/2026-05-29-session-746113/rd/requests/2026-06-02-grep-strip-meta.md`
- to peaks-qa: `.peaks/2026-05-29-session-746113/qa/requests/2026-06-02-grep-strip-meta.md`
- to peaks-ui: N/A(CLI only)
- to peaks-solo: 收尾需把 `.peaks/memory/dogfood-2026-06-02-wechat-post-sop.md` 状态从 "this iteration: OUT" 推进到 "this iteration: DONE by PRD 006",并把"literal-word trap"反馈闭环。

## Status

- created: 2026-06-01T17:14:56.478Z
- last update: 2026-06-02T01:15:00.000Z
- state: confirmed-by-user (2026-06-02 01:18)

## User confirmation record

- 2026-06-02 01:15 verbal (this turn): "继续下一轮" + 选择 "修 literal-word trap (PRD 006)"
- (auto-confirm 待用户在 `peaks request show` 流程中 sign-off,或下一轮 peaks-rd 启动时视为 implicit confirm)
