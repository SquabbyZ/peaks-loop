<!-- peaks-memory:start -->
---
title: 4.0.20 dogfood — CLI wiring gap + vendor detectInstalled Windows ENOENT + peaks-rd agent-type papercut
kind: lesson
date: 2026-08-11
session: 2026-08-11-session-7f7f78
rids: [rid-001]
---

# 4.0.20 dogfood 发现的 3 个缺陷

在 session `2026-08-11-session-7f7f78` 用 4.0.20 做 dogfood 时，连续暴露 3 个问题。前两个是真实 shipping 缺陷，第三个是编排器人体工学 papercut。

## 缺陷 1 — detached + vendor-detect CLI 从未注册（死代码）

**症状：** CHANGELOG 4.0.19 声称 `peaks sub-agent dispatch --mode detached` 和 `peaks vendor-detect` 已 ship，实际两者在 4.0.20 binary 上都不可达。

```
$ peaks vendor-detect
Unknown command: vendor-detect
$ peaks sub-agent dispatch --help   # 无 --mode / --vendor / --no-throttle / --max-concurrent
```

**根因：** handler 文件写了（`src/cli/commands/vendor-detect.ts`、`src/cli/commands/sub-agent/detached.ts`），但从未 import 到 commander program。`grep -rn "commands/vendor-detect" src/` 与 `grep -rn "sub-agent/detached" src/` 均为**零引用** —— 纯死代码。

**为什么测试没抓到（关键教训）：** `tests/unit/cli/sub-agent-detached.test.ts:37` 直接
`import { dispatch } from '.../sub-agent/detached'` 调函数，`vendor-detect.test.ts` 同理。
它们断言的是 **handler 返回值**，不是 **CLI 可达性**。单测全绿，用户敲命令 `Unknown command`。
这是教科书级 fake-green。

**修复（rid-001）：** 在 `dispatch-commands.ts` 的 action 内按 `options.mode === 'detached'` 分支
（lazy-import `./sub-agent/detached.js`），而不是注册兄弟命令 —— 后者会把校验管道一分为二并破坏
现存 106+ dispatch 测试。新增 2 个 **真进程** reachability 测试（`spawnSync node bin/peaks.js`）。

**防御规则（沉淀为通用规则）：**
> 任何"新增 CLI 命令/选项"的切片，验收测试必须 **spawn 真实 binary**（`node bin/peaks.js <cmd>`），
> 不得以 `import { handler }` 充当可达性证据。import handler 的测试只能证明函数逻辑，
> 永远无法证明命令注册。若切片声称"新增 CLI 表面"，QA 必须要求真进程证据。

## 缺陷 2 — VendorAdapter.detectInstalled() 在 Windows 上恒为 false

**症状：** `peaks vendor-detect --json` 返回 `{"installed": [], "recommended": null}`，
但 `claude` 明明在 PATH 上（`/c/nvm4w/nodejs/claude`，版本 2.1.227）。

**根因：** `packages/peaks-loop-internal-runtime/src/vendor/claude-adapter.ts:detectInstalled()` 用
`execFile('claude', ['--version'])` **不带 `shell: true`**。Windows 上 npm 全局 bin 是
`claude` (POSIX sh 脚本) + `claude.cmd` + `claude.ps1` 三件套；`execFile` 不走 shell 时
**不做 PATHEXT 解析**，找不到裸名 `claude` → `ENOENT`。而 `catch { return false }` 把
ENOENT 静默吞成"未安装"。

**最小复现：**
```js
execFile('claude',['--version'],{timeout:5000},cb)              // err: ENOENT / spawn claude ENOENT
execFile('claude',['--version'],{timeout:8000,shell:true},cb)   // stdout: "2.1.227 (Claude Code)\n"
```

**影响面：** 三个 adapter（claude / codex / copilot）同构，推测**全部**在 Windows 上恒返回 false。
连带后果：`vendor-detect` 永远报"无可用 vendor"，`--mode detached` 的 vendor 选择/推荐逻辑在
Windows 上不可用。**注意这是 silent catch 吞异常** —— 与 `.peaks/memory/2026-07-31-rid-001-r2-silent-catch-guard.md`
的 anti-fake-green 防御层同源，属于同一类缺陷复发。

**状态：** 已识别，rid-001 未修（超出该切片 scope，且 rid-001 明确禁止改 runtime package）。
留作后续切片。修时注意：`shell: true` + 裸名参数在 Windows 上有命令注入面，
需按 `.peaks/standards/security.md` 评估，或改用显式 PATHEXT 探测 / `where` 命令而非无脑加 shell。

## 缺陷 3 — peaks-rd 等 bee 被误当作 Agent type（编排器 papercut）

**症状：** 编排器 `Agent(subagent_type: 'peaks-rd')` → `Agent type 'peaks-rd' not found`。

**根因：** `peaks-rd` / `peaks-qa` / `peaks-prd` / `peaks-ui` / `peaks-sc` / `peaks-txt` 是
**Skill**（`Skill` 工具 / `~/.claude/skills/` junction），**不是** Claude Code 的 agent type
（后者来自 `.claude/agents/*.md`）。两者命名空间完全独立，但名字看起来同构，极易混淆。
peaks-code SKILL.md 写 "dispatch via `peaks sub-agent dispatch rd`"，而 `peaks sub-agent dispatch`
是 **dry-run descriptor 生成器**（自身文档写明 "Dry-run by design; the LLM executes the returned
toolCall in its own environment"），不是真正的派发器 —— 于是 LLM 自然地去猜 `Agent(subagent_type)`，
然后撞墙。

**正确做法：** 用 `Agent(subagent_type: 'general-purpose')`，并在 prompt 里显式要求子代理
first-action 读 `skills/bee/peaks-rd/SKILL.md` 获取角色契约。

**建议修复方向（未实施）：** 在 peaks-code SKILL.md / `references/sub-agent-dispatch.md` 里补一句
显式反模式警告："bee 是 Skill 不是 agent type；`subagent_type` 只接受 `.claude/agents/` 注册的名字"。
可考虑加 lint 规则或让 `peaks sub-agent dispatch` 的 envelope 直接在 `toolCall` 里给出正确的
`subagent_type: 'general-purpose'` + skill-read 指令，消除猜测空间。

## 附带发现

- `peaks sub-agent dispatch` 现在**强制** `--graph-node <id>`（Slice 4.0.8 RD §4 D4c, commit `f8751b56`）。
  多个 integration 测试（`dispatch-isolation-lifecycle` 3 fail / `sub-agent-dispatch-e2e` 3 fail）
  写于该变更之前，未传该 flag → 现有 test rot。非 rid-001 引入，未修。
- `peaks request init` 的 flag 是 `--id` 不是 `--request-id`，且强制 `--session-id`。
- `peaks codegraph status` 不接受 `--json`（只有 `--peaks-json`）。
<!-- peaks-memory:end -->
