---
name: execsync-goes-through-cmd-on-windows
description: execSync 在 Windows 走 cmd.exe，find/ls/cat 是另一套程序；测试遍历文件要用 fs
metadata:
  type: project
  node_type: memory
  originSessionId: 29601951-8e04-4525-8107-125180abe7b4
  modified: 2026-09-11T13:38:14.013Z
---

**2026-09-11 被 CI 抓到。** `tests/unit/skills/loop-hygiene-block.test.ts` 用
`execSync('find skills -name SKILL.md')` 找 22 个 SKILL.md。CI 的 windows-latest 报：

```
Error: Command failed: find skills -name SKILL.md
FIND: Parameter format not correct
```

`execSync` **走平台 shell**：Windows 上是 `cmd.exe`，`find` 解析到 `System32\find.exe`
（另一个程序，不认 `-name`）。本地能过，只因为 Git Bash 的 `find` 在 PATH 上胜出 ——
**典型的"测试断言的是这台笔记本"**，而 CI 第一次推就露。

**做法：测试里遍历目录用 `fs.readdirSync(..., {withFileTypes:true})` 递归，`spawnSync('git', [args])`
不传 shell。** 绝不用 `execSync('find …' / 'ls' / 'cat' / 'grep')`。

**注意：本地复现不了。** `cmd //c "find …"` 在 Git Bash 里仍继承 MSYS 的 PATH，所以
本地照样成功。判断靠的是**错误文本本身**（`FIND: Parameter format not correct` 是
Windows find.exe 的原话），不是本地复现 —— 别把"本地没复现"当成"诊断不成立"。

相关：[[per-turn-obligations-belong-in-per-turn-output]]、[[peaks-loop-consumer-project-gaps]]
