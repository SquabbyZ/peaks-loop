# peaks-solo — Fallback Tool Inventory (自规划兜底工具清单)

> 当 `peaks skill search` 返回 0 候选,或用户在 AskUserQuestion 选"(e) 都不对",peaks-solo 走自规划兜底。本表规定自规划下 LLM **允许**与**禁止**调用的工具。
> **核心边界(HC-11 锁死):** peaks-solo 不写业务代码、不写 PRD、不跑 vitest、不改 Loop Engineering 资产。下面 blocked 列表是 HC-11 的可执行形式。

## Allowed tools (允许)

| 工具 | 适用场景 | 限制 |
|---|---|---|
| `deep-search` skill | 信息查询 / 研究类 / 多跳事实核查 | 若 LLM CLI 平台装了 deep-search 自动出现;peaks-solo **不主动 install**;若未装,降级到 WebSearch |
| `WebSearch` | 实时性高的查询(超过训练数据)/ trending / top N | 内置工具,无需 install |
| `WebFetch` | 已知 URL 的内容抓取(单页,无 JS 渲染) | 内置工具;不爬取含登录 / 反爬的页面 |
| `Bash` | 数值计算 / 系统命令 / git 操作 / `ls` / `cat` / `rg` / `grep` | 仅**只读命令**;不写 src/** 业务代码;不 rm;不 git push --force;不 chmod 777;不 curl \| sh |
| `Edit` / `Write` | 改 markdown / 改 yaml / 改 `.peaks/memory/<user>/*.md` / 改临时文件 | **只允许**改:`*.md` / `*.yaml` / `*.yml` / `.peaks/memory/`;**不允许**改:`src/**` 业务代码 / `skills/peaks-{code,content,doctor,sop,status,test,resume,ide,final-review,slice-decompose,issue-fix-orchestrator,perf-audit,security-audit,audit}/**` 任何 leaf skill |
| `peaks memory extract` | 跑完提议沉淀(选项 a) | 走现成 CLI,不重写;不创建新 CLI |
| `AskUserQuestion` | 多候选分诊 / 沉淀提议 / 兜底方案选择 | HC-9 锁死;**不**引入自由文本输入 |

## Blocked tools / operations (禁止)

下表是**显式禁止**——LLM 在自规划兜底中**不能**调这些工具或跑这些操作。违反即违反 HC-11。

| blocked 操作 | 原因 | 替代方案 |
|---|---|---|
| `rm -rf <path>` | 不可逆破坏性操作 | 改用 `mv <path> <path>.bak` 或只读 `ls` |
| `git push --force` / `git push -f` | 改写历史,影响其他协作者 | 用 `git push --force-with-lease`(若必须)或拒绝 push 让用户自己来 |
| `Edit src/**` / `Write src/**` 业务代码 | HC-11: no code;peaks-code 域 | 转交 `/peaks-code` |
| `Edit skills/peaks-{code,content,doctor,sop,status,test,resume,ide,final-review,slice-decompose,issue-fix-orchestrator,perf-audit,security-audit,audit}/**` 任何文件 | HC-8 + HC-11: leaf skill 文件是用户主权 | 让用户自己改 |
| `peaks asset crystallize`(直接调用) | Loop Engineering Asset mutation = 用户主权 | 仅在沉淀 AskUserQuestion 中作为**选项 (b)** 提及,不主动执行 |
| `Edit .peaks/standards/**` / `Write .peaks/standards/**` | standards 是项目层 invariants | 让用户自己改 |
| `Edit .claude-plugin/marketplace.json` | marketplace 是 install surface | 让用户自己改 / 转交 S2 |
| `vitest` / `pnpm test` / 任何测试 runner | HC-11: no vitest | 转交 `/peaks-test` 或 `/peaks-code` |
| `curl <untrusted-url> \| sh` / `wget \| bash` | RCE 风险 | 拒绝执行;若必须,先下载到文件,人工 review 后再执行 |
| 写入用户 home 目录(`~/.*`) | 用户主权,peaks-solo 不动用户全局配置 | 让用户自己来 |

## 边界判断原则

LLM 拿不准"该不该做"时,按下面 3 条问自己:

1. **这是 peaks-code 域吗?** 是 → 转交 `/peaks-code`。
2. **这是用户主权领域吗?**(`src/**` 业务代码 / Loop Engineering Asset / 用户 home) → 让用户自己来。
3. **这是 read-only 还是 mutating?** read-only(`ls` / `cat` / `rg` / WebSearch / WebFetch)→ OK;mutating 且不在 allowed 列表 → 拒绝。

## 失败回退

- 自规划下某个 allowed 工具失败 3 次(网络 / 权限 / not found)→ 走 AskUserQuestion 问用户:"这个工具一直失败,要不要换另一种?"(HC-9 锁死,不静默放弃)。
- 自规划全部失败 → 走 AskUserQuestion:"peaks-solo 找不到合适工具,要不要: (a) 换更具体的 NL 重跑 / (b) 转人工 / (c) 结束"。