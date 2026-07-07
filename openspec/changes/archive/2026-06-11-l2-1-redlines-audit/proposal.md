# Slice L2.1 — P0 Red Lines + `peaks audit` CLI Framework

## Why

peaks-loop's 12 SKILL.md files + .claude/rules + OpenSpec change records contain an estimated 120-150 red lines (`MANDATORY` / `BLOCKING` / `MUST NOT` / `RED LINE` markers). Per the L1+L2+L3 redesign §5.1 audit:

- ~20% are `cli-backed` (enforced by `peaks workspace init`, `peaks skill presence:set`, `peaks request transition`, etc.)
- ~30% are `partial` (gate exists but LLM can bypass)
- ~50% are `prose-only` (zero enforcement; the LLM can skip)

The L2.1 slice ships the **audit framework** (the `peaks audit red-lines` scanner) plus the **first 5 P0 enforcers** (the most-leverage red lines that flip from `prose-only` to `cli-backed`). This unblocks L2.2/2.3/2.4 which add P1 + P2 enforcers in parallel per the §9.1 critical path.

## What Changes

- **New top-level CLI** `peaks audit` (verified no existing `peaks audit` top-level per `peaks-loop-when-adding-a-new-subcommand-check-for-existing-top-level-first.md`).
- **New subcommand** `peaks audit red-lines --project <path> --json` returns `{ ok, command, data: { totalRedLines, cliBacked, partial, proseOnly, audit: [...] }, warnings, nextActions }`.
- **Audit framework** at `src/services/audit/` (types, catalog of 5 P0 entries, classifier, backing-detector, 3 tree scanners — `skills/`, `.claude/rules/`, `openspec/changes/`).
- **5 P0 enforcers** (each flips one red-line from `prose-only` to `cli-backed`):
  1. **Code-code-ban** — PreToolUse hook on `Bash` matcher, gated on `git commit` / `git apply` from a peaks-* skill. Source shipped; integration wiring deferred to L2.1.1.
  2. **no-root-pollution** — PreToolUse hook on `Write` / `Edit` matcher, allowlist of root files (README, LICENSE, package.json, .gitignore, .gitattributes, .editorconfig, openspec/, .peaks/, .claude/). Source shipped; integration wiring deferred to L2.1.1.
  3. **sub-agent-sid** — reuses `isValidSessionId` from Slice 0.5 `sid-naming-guard.ts`; called from `peaks audit red-lines` and `peaks workspace clean` (already shipped in Slice 0.5 Task 7).
  4. **tech-doc-presence** — `peaks request transition` extended to refuse `spec-locked` transition if `tech-doc.md` is missing or empty.
  5. **mock-placement** — `peaks slice check` extended with a 5th stage that scans changed files (`git diff --name-only HEAD`) for inline mock-data patterns and fails if fixtures land in `src/` or `skills/`.
- **Catalog deferred-enforcers** mechanism: the red-line catalog carries a `DEFERRED_ENFORCERS` set; matching entries have `enforcerRef` nulled so the backing-detector downgrades them to `prose-only` at runtime. When the integration lands, the entry is removed from the deferred set.
- **OpenSpec change record** at `openspec/changes/2026-06-11-l2-1-redlines-audit/` with proposal / design / tasks / spec.

## Impact

- 3 P0 red lines flip from `prose-only` to `cli-backed` in this slice (sub-agent-sid, tech-doc-presence, mock-placement). 2 remain deferred to L2.1.1 (code-code-ban, no-root-pollution — hook integration pending).
- L2.1 ships a reusable audit framework — L2.2/2.3/2.4 are pure additions (more enforcers, no framework changes).
- Unblocks §9.1's parallel fan-out: after L2.1, L2.2 / L2.3 / L2.4 / L3.1 run in parallel per the redesign critical path.
- Dogfood on current repo: `peaks audit red-lines` returns 121 red lines, 6 catalog-matched (3 cli-backed after dedup), 115 prose-only.

## Acceptance Criteria

- `peaks audit red-lines --project .` runs end-to-end in < 2s on the current repo (measured: 0.258s).
- JSON envelope shape: `{ ok, command: 'audit.red-lines', data: { totalRedLines, cliBacked, partial, proseOnly, audit: [...] }, warnings, nextActions }`.
- Scanner discovers ≥ 50 red lines across `skills/`, `.claude/rules/`, and `openspec/changes/` on the current repo.
- 3 of 5 P0 enforcers (sub-agent-sid, tech-doc-presence, mock-placement) flip from `prose-only` to `cli-backed` in the audit output. The other 2 (code-code-ban, no-root-pollution) show as `prose-only` with a clear `nextActions` note.
- `peaks request transition <rid> spec-locked` (rd role) refuses if `rd/tech-doc.md` is missing or empty; error code `TECH_DOC_MISSING`.
- `peaks slice check` returns 5 stages (typecheck, unit-tests, review-fanout, gate-verify-pipeline, mock-placement); mock-placement scans `git diff --name-only HEAD`.
- `peaks workspace clean` continues to call the sub-agent-sid enforcer (Slice 0.5 Task 7) without regression.
- All 5 new service files ≤ 250 lines (Karpathy 800-line cap, well under).
- Code coverage ≥ 80% on the new audit service (64/64 audit tests pass; verified at `pnpm vitest run tests/unit/services/audit/`).
- No new `any` types in TypeScript code.
- TypeScript `tsc --noEmit` clean.
- Backward compat: `peaks doctor`, `peaks scan *`, `peaks gate enforce`, `peaks hooks install` all unchanged.
- Branch: `feature/l2-1-redlines-audit`; identity from global gitconfig; no AI co-author trailer.
- OpenSpec validate: `peaks openspec validate 2026-06-11-l2-1-redlines-audit` returns `data.valid: true`.

## Out of Scope

- L2.2 P1 (10-15 red lines: resume detection, prototype fidelity, etc.)
- L2.3 / L2.4 P2 (25-40 red lines, ECC AgentShield integration)
- Hook auto-installation (L2.1 ships enforcers; user opts in via existing `peaks hooks install`).
- L2.1.1 (Tasks 5-6 hook wiring — code-code-ban, no-root-pollution) — these are deferred follow-up commits in the same slice.
- New top-level CLI design beyond `peaks audit` (L2.1 ships one new top-level; per `peaks-loop-when-adding-a-new-subcommand-check-for-existing-top-level-first.md` we verified no `peaks audit` top-level exists).

## Dependencies

- Node 22 stdlib (`fs`, `path`).
- Existing peaks-loop infra: `commander ^12.1.0`, `peaks-loop/result.ts`, `peaks-loop/sid-naming-guard.ts` (Slice 0.5 reuse), `peaks-loop/request-artifact-service.ts` (Task 3 integration), `peaks-loop/slice-check-service.ts` (Task 4 integration).
- No new npm dependencies.
- No headroom-ai / fzf usage in this slice (audit scanner is a straight file walk).

## Risks

- Code-code-ban / no-root-pollution are PreToolUse hooks; risk of false positives on legitimate out-of-skill commits. Mitigation: matcher pattern is exact (e.g. `git commit` only when `skill == peaks-*`), fail-open per `gate-enforcement-hook.md` trust red line. Source shipped; integration deferred to L2.1.1.
- Audit scanner covers 50+ markdown files; performance risk. Mitigation: stream-read, per-file regex, no in-memory full-text store. Measured at 0.258s end-to-end on the current repo (target: < 2s). ✓
- tech-doc-presence: `peaks request transition` runs from CWD; sid resolution uses the `existing.sessionId` from `showRequestArtifact` (which already resolves the canonical session per `src-services-session-canonical-workspace-resolver.md`).
- mock-placement regex false positives on legitimate `const xMock` variables. Mitigation: 20-char minimum, only flags `mockData: { ... }` / `fixtures = { ... }` / multi-line `const fooMock = { ... }`.
- Catalog matches may be too generous (phrase `session` is broad). Mitigation: phrase-only match policy (no marker fallback) in `findCatalogEntry`; catalog manually curated.

