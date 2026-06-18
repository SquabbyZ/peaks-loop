---
name: audit-decision-record-convention
description: Red-line audit snapshots persisted by `peaks audit static --record` land at `.peaks/memory/audit-decisions/<slug>.md` with `kind: decision` frontmatter and auto-sync into `hot.decision[]`. Slug pattern: `audit-decision-<date>[-<rid>]`.
metadata:
  type: convention
  sourceArtifact: src/services/audit/decision-writer.ts
  createdAt: 2026-06-19
---

Red-line audit snapshots produced by `peaks audit static --record` are persisted as project-memory decisions at `.peaks/memory/audit-decisions/<slug>.md`. The memory service auto-indexes them into `hot.decision[]` on next read, so they show up in `peaks memory search "audit decision"` and `peaks project memories --kind decision` without manual index edits.

**Why:** Before 2.8.0, audit runs only lived in process memory (the CLI JSON envelope) and as one-off context chatter. There was no machine-readable record of "we audited project X on date Y and saw N red lines" that survived across sessions. Persisting as a project-memory decision makes audits queryable, diff-able, and auditable — the existing memory infra already handles index, search, and hot/warm layering.

**How to apply:**

1. **Generating a decision** — run `peaks audit static --project <root> --record [--rid <id>]`. The `--rid` flag disambiguates multiple audits on the same day (slug becomes `audit-decision-<date>-<rid>`); without it, slug is `audit-decision-<date>` and re-running on the same day overwrites the prior file.
2. **Reading a decision** — `peaks memory search "audit decision"` (fuzzy) or `peaks project memories --kind decision` (full list). Each entry's `filePath` points at `.peaks/memory/audit-decisions/<slug>.md`; `peaks memory show <slug>` prints the full body.
3. **Schema invariants** — every decision file has `name: audit-decision-<date>[-<rid>]`, `metadata.type: decision`, and the canonical counter fields (`totalRedLines`, `cliBacked`, `partial`, `proseOnly`, `enforcerFailures/Warnings/Passes`). The body has three sections: Summary (count table), Per-Rule Decisions (one row per `RedLineEntry`), Enforcer Findings (one row per `EnforcerFinding`).
4. **No `context` field** — `RedLineSource.context` is an intermediate artifact used only by `backing-detector.ts` for partial classification (`detectPartial(entry.source.context)`). The final classification is captured by `RedLineEntry.backing`, so the raw context has no consumer downstream and is intentionally omitted from the persisted record.
5. **Not for sessions, only for projects** — decisions live under the project's `.peaks/memory/`, NOT under `.peaks/_runtime/<sessionId>/`. They are git-tracked source-of-truth per the `.peaks/_*/` gitignore convention. Re-running on the same `(date, rid)` pair overwrites the file (idempotent at the slug level); this matches the "one audit run = one decision record" model.

**Cross-references:** [[workspace-underscore-convention]] (gitignore convention; decisions are git-tracked), `src/services/audit/decision-writer.ts` (writer implementation + JSDoc on the no-context decision), `src/services/audit/static-service.ts` (audit producer), `src/cli/commands/audit-commands.ts` (`--record` / `--rid` flag wiring).