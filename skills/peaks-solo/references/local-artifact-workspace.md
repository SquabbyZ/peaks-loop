# Local intermediate artifact workspace

> Body of `## Peaks-Loop Local intermediate artifact workspace` plus all sub-sections (workspace initialization gate, root pollution prohibition, git and sync policy).

## Workspace initialization gate

The workspace is created in Step 0 (Startup sequence) as a mandatory first action — before any analysis, role handoff, or artifact write, and regardless of how lightweight the request is. Session IDs are now **auto-generated** with the format `YYYY-MM-DD-session-<6位hex>` (e.g. `2026-05-26-session-a3f8b1`). The user does not provide a session ID — the system creates and persists it in `.peaks/_runtime/session.json` (the canonical home as of slice `2026-06-05-peaks-runtime-layer`; the legacy `.peaks/.session.json` is read-only back-compat for one minor release).

When `peaks workspace init` is run without `--session-id`, it automatically generates a new session ID using today's date and a random hex suffix. If a valid session binding exists at `.peaks/_runtime/session.json` (the canonical home, slice 2026-06-05-peaks-runtime-layer; the legacy `.peaks/.session.json` is read-only back-compat for one minor release), the existing session is reused. To read the active session id from a skill or sub-agent, use the `peaks session info --active --json` primitive — never `cat` the on-disk file directly (the path is internal).

**Existing old-session cleanup**: If `.peaks/` contains numeric-only or generic session directories from prior runs (e.g. `2026-05-25-auth-system`), create the new correctly-named session, migrate any reusable artifacts into it, and note the migration in the TXT handoff. Delete empty old-session directories.

```bash
peaks workspace init --project <repo> --json
```

The workspace initialization creates this structure under `.peaks/`:

```
# Canonical home for all per-project ephemeral state (active-skill
# marker, session binding, sop-state). All writes go here; reads also
# tolerate the legacy paths (`.peaks/.active-skill.json`,
# `.peaks/.session.json` — read-only back-compat for one minor release,
# `.peaks/sop-state/`) for one minor release so a fresh upgrade does
# not break in-flight workflows. Older trees are auto-migrated by
# `peaks workspace reconcile --apply`. Skills and sub-agents MUST
# NOT `cat` any of these files directly — use `peaks session info
# --active --json` (and the matching read-only primitives for the
# other two) to discover session-id / active-skill / sop-state.
.peaks/_runtime/
├── active-skill.json   # orchestrator presence marker (peaks-solo / -rd / -qa / -ui / -sc / -sop / -txt)
├── session.json        # project → session binding (the only single-session source of truth)
└── sop-state/          # current phase + history; definitions live globally in ~/.peaks

# Per-slice artifact dirs (auto-generated, one per session). Files
# inside ARE tracked by the 提交中间产物 convention.
.peaks/_runtime/<sessionId>/
prd/source/      # PRD source documents (Feishu exports, pasted content)
prd/requests/    # PRD request artifacts (goals, non-goals, acceptance, frontend delta)
ui/requests/     # UI request artifacts (visual direction, taste reports)
rd/requests/     # RD request artifacts (slice specs, coverage, CR findings)
rd/project-scan.md  # Project scan (session-scoped singleton, generated once per session)
qa/test-cases/   # QA test cases
qa/test-reports/ # QA test reports (regression matrices, browser evidence)
qa/requests/     # QA request artifacts
sc/              # SC artifacts (change-control, impact, retention, boundary)
txt/             # TXT artifacts (handoff capsules, lessons, memory extraction)
system/          # Existing-system extraction output (visual tokens, conventions)
```

Files written into these directories during the workflow (not pre-created — they appear as their step runs):

- `rd/project-scan.md` (Solo step 0.6)
- `rd/tech-doc.md` (feature/refactor planning; required by `rd → implemented` gate)
- `rd/bug-analysis.md` (bugfix planning; required by `rd → implemented` gate for `--type bugfix`)
- `rd/code-review.md`, `rd/security-review.md` (required by `rd → qa-handoff` gate for feature/bugfix/refactor; security-review only for config)
- `rd/mock-plan.md` (frontend-only mode)
- `ui/design-draft.md` (UI step)
- `system/existing-system.md` (Solo step 0.7; legacy projects only)
- `qa/test-cases/<rid>.md`, `qa/test-reports/<rid>.md`, `qa/security-findings.md`, `qa/performance-findings.md` (gated per `--type`)

## Root pollution prohibition (CRITICAL)

**NEVER write Peaks-Loop intermediate artifacts to the project root directory.** Specifically prohibited at root level:

- PRD snapshots, document extracts, or requirement notes (`feishu-doc-*.md`, `*-snapshot.md`, etc.)
- RD tech docs, scan reports, slice specs, or architecture notes
- QA screenshots, browser evidence, test reports, or validation logs (`.png`, `.jpg`)
- QA test helper files, mock servers, or fixture scripts (`qa-server.js`, etc.)
- UI design drafts, taste reports, or visual direction notes
- TXT handoff capsules or lesson files

Legitimate source files (e.g. `jest-setup.ts`, `tailwind.config.js`) belong at root — do not move them.

If you are about to Write/Edit an intermediate artifact in the project root, STOP. Create the `.peaks/_runtime/<sessionId>/` workspace first and write to the correct role subdirectory. If existing root-level artifacts from a prior run are discovered, move them into `.peaks/_runtime/<sessionId>/` and note the migration in the TXT handoff.

## Git and sync policy

Do not default to git-backed storage or automatic commits for intermediate artifacts. Git inclusion or sync requires explicit user confirmation or an active profile that authorizes it.