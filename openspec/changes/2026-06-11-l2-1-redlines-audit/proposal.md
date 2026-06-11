# Slice L2.1 — P0 Red Lines + `peaks audit` CLI Framework

## Why

peaks-cli's 12 SKILL.md files + .claude/rules + OpenSpec change records contain an estimated 120-150 red lines (`MANDATORY` / `BLOCKING` / `MUST NOT` / `RED LINE` markers). Per the L1+L2+L3 redesign §5.1 audit:

- ~20% are `cli-backed` (enforced by `peaks workspace init`, `peaks skill presence:set`, `peaks request transition`, etc.)
- ~30% are `partial` (gate exists but LLM can bypass)
- ~50% are `prose-only` (zero enforcement; the LLM can skip)

The L2.1 slice ships the **audit framework** (the `peaks audit red-lines` scanner) plus the **first 5 P0 enforcers** (the most-leverage red lines that flip from `prose-only` to `cli-backed`). This unblocks L2.2/2.3/2.4 which add P1 + P2 enforcers in parallel per the §9.1 critical path.

## What changes

- **New top-level CLI** `peaks audit` (verified no existing `peaks audit` top-level per `peaks-cli-when-adding-a-new-subcommand-check-for-existing-top-level-first.md`).
- **New subcommand** `peaks audit red-lines --project <path> --json` returns `{ ok, command, data: { totalRedLines, cliBacked, partial, proseOnly, audit: [...] }, warnings, nextActions }`.
- **5 P0 enforcers** (each flips one red-line from `prose-only` to `cli-backed`):
  1. **Solo-code-ban** — PreToolUse hook on `Bash` matcher, gated on `git commit` / `git apply` from a peaks-* skill.
  2. **no-root-pollution** — PreToolUse hook on `Write` / `Edit` matcher, allowlist of root files (README, LICENSE, package.json, .gitignore, .gitattributes, .editorconfig, openspec/, .peaks/, .claude/).
  3. **sub-agent-sid** — reuses `isValidSessionId` from Slice 0.5 `sid-naming-guard.ts`; called from `peaks workspace clean` (already shipped in Slice 0.5 Task 7) AND `peaks audit red-lines`.
  4. **tech-doc-presence** — `peaks request transition` extended to refuse `spec-locked` transition if `tech-doc.md` is missing.
  5. **mock-placement** — `peaks slice check` extended with a 5th check that scans changed files for mock-data patterns and fails if fixtures land in src/ or skills/.
- **OpenSpec change record** at `openspec/changes/2026-06-11-l2-1-redlines-audit/` with proposal / design / tasks / spec.

## Impact

- 5 P0 red lines flip from `prose-only` to `cli-backed`, reducing the prose-only ratio from ~50% to ~45% (8-12 red lines classified; 5 enforcers added).
- L2.1 ships a reusable audit framework — L2.2/2.3/2.4 are pure additions (more enforcers, no framework changes).
- Unblocks §9.1's parallel fan-out: after L2.1, L2.2 / L2.3 / L2.4 / L3.1 run in parallel per the redesign critical path.

## Out of scope

- L2.2 P1 (10-15 red lines: resume detection, prototype fidelity, etc.)
- L2.3 / L2.4 P2 (25-40 red lines, ECC AgentShield integration)
- Hook auto-installation (L2.1 ships enforcers; user opts in via existing `peaks hooks install`).

## Risk

- Solo-code-ban / no-root-pollution are PreToolUse hooks; risk of false positives on legitimate out-of-skill commits. Mitigation: matcher pattern is exact (e.g. `git commit` only when `skill == peaks-*`), fail-open per `gate-enforcement-hook.md` trust red line.
- Audit scanner covers 50+ markdown files; performance risk. Mitigation: use a `fzf` index or per-file regex (no in-memory full-text store), target < 2s on the current repo.
- tech-doc-presence: `peaks request transition` runs from CWD; sid resolution needs the canonical resolver per `src-services-session-canonical-workspace-resolver.md` memory.
