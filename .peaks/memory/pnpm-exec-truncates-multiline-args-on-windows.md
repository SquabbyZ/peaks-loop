---
name: pnpm-exec-truncates-multiline-args-on-windows
description: pnpm exec 在 Windows 上把任何含换行的参数截断到第一行；多行 --prompt 会被静默摧毁
metadata:
  type: project
  node_type: memory
  originSessionId: bd89a11a-b66d-443c-b8b7-e9aa813190c2
  modified: 2026-09-12T15:53:07.744Z
---

**`pnpm exec <cmd> "<arg>"` 在 Windows 上把参数截断在第一个换行处。**

2026-09-12 实测（`argv-probe.mjs` 打印 `process.argv[2].length`）：

| 参数 | `node` 直连 | `pnpm exec tsx` |
|---|---|---|
| 3 行、16 字符 | 16 ✓ | **5 ✗**（只剩 `alpha`） |
| 6047 字符、**无换行** | 6047 ✓ | 6047 ✓ |
| 6047 字符、多行 | 6047 ✓ | **60 ✗** |

**不是长度限制，是换行处理缺陷。** 无换行的同等长度参数完好，所以容易误判成"参数太长"。根因族同 [[execsync-goes-through-cmd-on-windows]]：pnpm 在 Windows 上是 `.cmd` shim，经 cmd.exe 重新解析命令行。**绕行：`node --import tsx src/cli/index.ts …`**（实测 6047 字符完好）。

**Why:** peaks-loop 的派发前导**明文规定** LLM 用 `pnpm exec tsx src/cli/index.ts`（禁止裸 `peaks`）。而 `peaks sub-agent dispatch --prompt <text>` 的任务文本**必然多行**。于是：

- `--prompt` 被静默截成第一行 → 子代理收到残缺任务；
- **`ok: true`、exit 0、无任何报错** —— 又是静默成功；
- 同一根因还毁掉了同一条命令里的 `--request-id`，dispatch 记录变成 `dispatch-unknown-rid-*.json`。

**How to apply:** 任何经 `pnpm exec` 传给 CLI 的多行参数都不可信 —— 先量长度再相信结果。修法方向：给 `peaks sub-agent dispatch` 加 `--prompt-file <path>`，让多行文本永不经过 argv。参见 [[single-observation-is-not-a-property]]（本次是"量出 8629 字节"与"CLI 收到 60 字符"在**同一次调用**里并存，才定位到中间层）。
