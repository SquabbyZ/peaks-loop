PEAKS-CLI 成效说明（参赛稿）

配套 CONTEST-INTRO.md 使用。按 "提质增效 / 降本节流 / 创新与兼容性 / 个人使用成效" 讲 你用上之后的世界会变成什么样。

截止 v2.2.2（2026-06-14）。所有数字与代码路径都可复核。


1. 提质增效

· SOP 不能跳步：SOP 散在三处，agent 看不到全貌。peaks-sop + peaks hooks install 装 hook——门控不通过 → 物理 deny，--dangerously-skip-permissions 也绕不过。
· 新成员 30 秒上手：新人读 5-10 份文档重建上下文平均 2-4 小时/人；peaks-solo 覆盖 ≥ 90% 场景 + peaks-solo-resume 跳过已完成 gate——效率 ↑ ≈ 99%。
· 项目记忆随 git 流转：70 条决策 / 踩坑落盘 .peaks/memory/，git clone 即见；带 index.json，IDE / CI / agent 可搜索。


2. 降本节流

· 不可逆动作事故成本 → 0：CI 只在合并时拦，agent git push --force / rm -rf / 删 .env 那 1 秒没人挡。peaks hooks install 一行——不可逆动作在权限检查前被 hook deny，连 --dangerously-skip-permissions 也拦得住。
· 续接场景 token 省 60-80%：续接切片，agent 重读 + 重建上下文，3-5k token；peaks-solo-resume 跳过已完成 gate。
· 多 AI 工具规范维护 ↓ ≈ 75%：4 套 AI 工具并存（Claude Code / Cursor / Trae / 通义灵码），每加一种多维护一份。peaks-loop 1 套 SOP 源覆盖多 IDE——4 份 × M 次 → 1 份 × M 次。


3. 创新与兼容性

· 门禁拦截的"时机"——从提示到契约：传统三层都盲区：CLAUDE.md 下 session 忘掉；CI 在 IDE push 救不了；人工 review 事已发生。peaks-loop 的 PreToolUse hook 走 action-time——权限检查前 deny。"工程纪律"从纸面变契约——没人占这层。
· 跨平台 + 跨 IDE：macOS / Windows / Linux 契约测试 11 项 全绿；Claude Code 全量交付（11 技能 + hook + statusline），Trae 已注册 IdeAdapter，Codex / Cursor / Qoder / 通义灵码 在路线图；npm i -g peaks-loop ≡ npx skills add SquabbyZ/peaks-loop。
· 标准化产出物：每切片在 .peaks/_runtime/<sessionId>/ 有可机读源；commit 标 PRD#N；项目记忆 index.json + 70 条——评审 / CI / session 都可继承。


4. 给我个人带来的效果

peaks-loop 使用者还比较少，dogfood 主要来自开发者本人。下面是 我自己用上之后的真实体感。

· 多终端并行：3-4 个终端同时挂 peaks-solo，各跑不同 PRD，session 独立绑定。一人撑起一个小团队吞吐量——白天主线，夜里 sub-agent 跑回归。
· 更高的代码质量：peaks-sop 兜住 TODO / 漏测试；peaks-qa 跑三关。省 review + 省返工。
· 精力放回业务 / 体验打磨：写脚手架 / 跑测试 / 改 lint 占 50%，被 peaks-solo 跑完——省下的时间投到"用户看了什么反应"、"这一步他会不会卡"。
· 学习预算：peaks-solo 在终端跑 routine，我读 Context7 / GitHub / arxiv；看中了，30 分钟 peaks-sc 评估 + peaks-sop 落 SOP + peaks-hooks 装上——前沿从"看新闻"变"周级别落地"。
