PEAKS-CLI 是 AI IDE 里的工程门禁和工作流编排——把团队 SOP 变成 agent 也绕不过的可执行门控。

痛点：CLAUDE.md / CI / 人工 review 三层都有盲区。CLAUDE.md 99% 下 session 忘掉；CI 在 IDE push 前救不了；人工 review 时事故已发生。

解法：把 SOP 落成 sop.json，一行 peaks hooks install 装到 IDE 的 PreToolUse hook；agent 做不可逆动作时权限检查之前就被物理 deny，连 --dangerously-skip-permissions 也拦得住。

效果：项目自己用 peaks-loop 写——12 会话、9 PRD 闭环、CLI 自挂 hook 守发布；269 测试文件 / 2,957 用例 100% 通过。
