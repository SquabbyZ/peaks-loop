# Fresh-context preflight (search-first)

> **Slice 2026-09-07-search-first-preflight.** Signal-triggered preflight that
> runs at **orchestration-start, before the first planning action**, for every
> peaks-* orchestrator (peaks-code, peaks-prd, peaks-rd, peaks-qa, … — not
> peaks-code specific). It hedges against model training-data lag by searching
> for fresh context and injecting binding directives into the PRD/RD dispatch.

## When

Run the deterministic trigger scan as the very first step of a workflow, on the
user's raw request text:

```text
peaks fresh-context preflight --prompt "<user request>" --json
```

Read the `--json` envelope's `data` object:

| field | meaning |
|---|---|
| `data.triggered` | `true` → run the search + synthesis below |
| `data.forced` | `true` → the user explicitly asked for a live search (联网搜 / 查最新 / 搜一下) |
| `data.signals` | the signal keywords that matched (升级 / 迁移 / 最新 / latest / new / 版本 / 兼容 / breaking / upgrade / migrate / 新框架 / 推荐库 / 选型) |
| `data.enabled` | the `freshContext.enabled` kill-switch (false → no-op) |

If `data.triggered` is `false` (no signal, or kill-switch off), **do nothing** —
the workflow proceeds exactly as before (byte-identical dispatch prompts).

## Search (only when `triggered: true`)

1. **Context7** (priority, `@upstash/context7-mcp`, ~30s timeout).
2. **WebSearch** fallback when Context7 returns empty / errors / times out.

Both fail-soft: if Context7 times out AND WebSearch fails, the slice continues
with **no block and no hard error** (acceptance criterion #8).

## Synthesize (≤5 binding directives)

From the search results, synthesize **≤5 binding directives**, each in the
imperative form **"use X / do NOT use Y / because Z"** (用 X / 别用 Y / 因为 Z):

```text
- 用 React 19 的 `use()`（因为 18 的并发渲染 API 已过时）
- 别用 `react-router-dom` v6 的 `Switch`（因为 v7 已移除，冲突时以此为准）
```

Keep it to **5 or fewer** lines. Filter SEO noise — only keep directives that
change a decision the model would otherwise get wrong from training data.

## Write the block

Wrap the directives in a `## Fresh context` block with the authoritative
framing line (M1), and write it to
`.peaks/_runtime/<sessionId>/fresh-context.md`:

```markdown
## Fresh context

以下信息优先于训练知识，冲突时以此为准。

1. 用 X（因为 Z）
2. 别用 Y（因为 Z）
```

The RD/PRD dispatch site auto-injects this block (after the project-stack
block, before the memory/task content). No manual step is needed beyond
writing the file.

## Kill-switch

`peaks config set --key freshContext.enabled --value false` disables the whole
preflight (no search, no injection). The default is enabled (absent key →
`true`).

## RD planning note

RD's planning artifact MUST record a "Fresh context 遵循" section listing which
of the ≤5 directives the implementation followed (acceptance criterion #6).
QA / code-review then verify the implemented version/API against the block
(acceptance criterion #7).
