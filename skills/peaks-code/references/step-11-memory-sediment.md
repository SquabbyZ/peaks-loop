# Peaks-Loop Step 11 — Memory sediment (substep details)

Companion to `SKILL.md` §"Peaks-Loop Step 11". This file holds the substep-by-substep bash + flow + sediment history; the SKILL.md only carries the hard-rule one-liner and the link.

## Blocking rule

Code MUST NOT declare a workflow complete until Step 11 has produced ≥ 1 file in `.peaks/memory/` OR the user has explicitly approved a no-sediment outcome via AskUserQuestion. Applies to **all modes** including `assisted` and `strict`.

## Single authority (2026-09-09)

**Inside a peaks-code workflow, sedimenting memory writes to `.peaks/memory/`. The IDE-side memory dir is a session note, not the authority.**

- `.peaks/memory/` is peaks-owned and authoritative. Every sediment action ends there.
- Claude Code's per-project memory dir (`~/.claude/projects/<project-hash>/memory/*.md`) is the IDE's own scratch memory. It is **read-only** for peaks — never write there (same rule as `~/.claude/agents/`).
- If a session note was written to the IDE-side dir instead of `.peaks/memory/`, pull it in with `peaks memory ingest --apply` (LLM-run; read-only on the IDE side, normalizes frontmatter to `metadata.type`, idempotent by filename stem). Conflicts leave both copies in place — resolve by hand.
- Never let a memory exist only in the IDE-side dir when the workflow claims the memory was sedimented.

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

### 11e — Index hygiene (run after any sediment)

```bash
peaks memory reindex --project <repo> --json          # drift report (dry run)
peaks memory reindex --project <repo> --apply --json  # rebuild index.json + MEMORY.md
```

`reindex` re-scans **every** `.peaks/memory/*.md` (including `archived/`), resolves each file's kind as `metadata.type` → top-level `kind:` → top-level `type:`, rebuilds `index.json` deterministically, and regenerates `MEMORY.md` (generated banner; do not hand-edit). It reports, never silently drops:

- `unclassified[]` — files with no resolvable kind (add `metadata.type` to fix);
- `orphanIndex[]` — index entries whose `sourcePath` no longer exists;
- `orphanDisk[]` — files on disk the rebuilt index does not contain.

Run it whenever Step 11 wrote or imported memories, so the machine index and `MEMORY.md` never drift apart again.

### 11f — Pull in IDE-side session notes (only when needed)

If a memory was written to Claude Code's own memory dir during the session instead of `.peaks/memory/`:

```bash
peaks memory ingest --project <repo> --json          # preview
peaks memory ingest --project <repo> --apply --json  # write into .peaks/memory
```

Source defaults to `~/.claude/projects/<project-hash>/memory/` (read-only). Import is idempotent by filename stem; differing destinations are reported as conflicts and both copies are left in place. Files whose kind cannot be resolved are reported as needing classification — never invented.

## Why Step 11 exists

Audit 2026-07-03 confirmed 2 consecutive sessions produced zero `.peaks/memory/` files despite completing RD + QA + handoff artifacts; `assisted` mode silently skipped runbook Step 10 (no STOP condition).

## Why `peaks memory extract` (not `peaks project memories:extract`)

The artifact-scoped extract is canonical; the batch-scoped sibling is for non-handoff flows. Always use `peaks memory extract --apply`.

## Related

- `references/runbook.md` §Step 11 — full bash + flow.
- `references/project-memory-loading.md` — Step 2.3 memory loading (read-side).