# Peaks-Loop Step 11 — Memory sediment (substep details)

Companion to `SKILL.md` §"Peaks-Loop Step 11". This file holds the substep-by-substep bash + flow + sediment history; the SKILL.md only carries the hard-rule one-liner and the link.

## Blocking rule

Code MUST NOT declare a workflow complete until Step 11 has produced ≥ 1 file in `.peaks/memory/` OR the user has explicitly approved a no-sediment outcome via AskUserQuestion. Applies to **all modes** including `assisted` and `strict`.

## Substeps

### 11a — Gate A (txt/ inventory)

```bash
find .peaks/_runtime/<sessionId>/txt/ -type f -name '*.md' | head
```

If **0 files** → STOP. Dispatch `peaks-txt` first to write `handoff.md`, then return to 11c.

### 11b — Gate B (memory block embed scan)

```bash
grep -c 'peaks-memory:start' .peaks/_runtime/<sessionId>/txt/handoff.md || true
```

If **0 AND this session surfaced a stable project fact** (decision / convention / approved refactor / hard rule), STOP and tell peaks-txt to embed at least one `<!-- peaks-memory:start -->` block first.

### 11c — Canonical extract

```bash
peaks memory extract --project <repo> --artifact .peaks/_runtime/<sessionId>/txt/handoff.md --apply --json
```

`--apply` is REQUIRED (without it the command only previews — no files land).

> **CLI reality check (D-010 sediment, 2026-07-09):** The `<!-- peaks-memory:start -->` block must be followed immediately by a **YAML frontmatter** (`title: ...`, `kind: lesson | decision | convention`) and a `---` separator. Each block must close with `<!-- peaks-memory:end -->`. A bare `peaks-memory:start` without the YAML fields is parsed but produces no `plannedWrites` — the CLI silently returns `extractedCount: 0`.

### 11d — Gate C (zero-write outcome)

If `extractedCount === 0` after 11c, fire AskUserQuestion:

> "本次 code 未沉淀任何 `.peaks/memory` 文件。可选: (a) 回去在 handoff.md 嵌入至少 1 个 `peaks-memory:start` block 后重试; (b) 显式接受 no-sediment 并记录为 lesson; (c) 取消完成。"

> **D-010 fix root cause check:** When firing 11d, first inspect whether the block has the YAML frontmatter (`title:` + `kind:` + `---`). If the `<!-- peaks-memory:start -->` exists but no `title:` line follows, fix the block format and re-run 11c — don't ask the user yet. Default option = (a). Code MUST NOT silently accept (b) without user pick.

## Why Step 11 exists

Audit 2026-07-03 confirmed 2 consecutive sessions produced zero `.peaks/memory/` files despite completing RD + QA + handoff artifacts; `assisted` mode silently skipped runbook Step 10 (no STOP condition).

## Why `peaks memory extract` (not `peaks project memories:extract`)

The artifact-scoped extract is canonical; the batch-scoped sibling is for non-handoff flows. Always use `peaks memory extract --apply`.

## Related

- `references/runbook.md` §Step 11 — full bash + flow.
- `references/project-memory-loading.md` — Step 2.3 memory loading (read-side).