> ⚠️ **本文档已过期（2026-09-15 标注，原文保留不删改）。**
>
> 数据冻结于 **v2.2.2 / 2026-06-14**，落后当前 **v4.0.49 约 100 个版本 / 3 个月**。
> 下方"269 测试文件 / 2,957 用例 100% 通过"与今日实测不符：实际为 **345 文件 / 3,053 用例**；
> 且该"100% 通过"的声明落在 **CI 尚不能运行的时期** —— CI 的四次修复提交全部发生在 2026-09 上旬。
> 文末的"100% 通过"应读作**当时本机运行的观测**，不是 CI 验证过的事实。
>
> 完整诊断见 `docs/diagnosis-2026-09-15-peaks-loop-state.md`。

---

PEAKS-CLI 是 AI IDE 里的工程门禁和工作流编排——把团队 SOP 变成 agent 也绕不过的可执行门控。

痛点：CLAUDE.md / CI / 人工 review 三层都有盲区。CLAUDE.md 99% 下 session 忘掉；CI 在 IDE push 前救不了；人工 review 时事故已发生。

解法：把 SOP 落成 sop.json，一行 peaks hooks install 装到 IDE 的 PreToolUse hook；agent 做不可逆动作时权限检查之前就被物理 deny，连 --dangerously-skip-permissions 也拦得住。

效果：项目自己用 peaks-loop 写——12 会话、9 PRD 闭环、CLI 自挂 hook 守发布；269 测试文件 / 2,957 用例 100% 通过。
