---
name: peaks-on-path-is-the-installed-build-not-the-working-tree-never-verify-cli-changes-with-it
description: `peaks` on PATH is the installed build, not the working tree — never verify CLI changes with it
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-10-session-528a63/sc/tracker-reconciliation-2026-09-10.md
---

While verifying a fix to `src/cli/commands/job-commands.ts`, `peaks job status --session-id …` returned
`error: unknown option '--session-id'` even though the source plainly declared that flag 13 times and
contained the new `JOB_NOT_IN_SESSION` error. `which peaks` resolved to
`/c/nvm4w/nodejs/peaks` — a 415-byte installed shim, **not** this repository. The same command through
the source entry (`pnpm exec tsx src/cli/index.ts …`) worked first try.

**Why:** a source change to the CLI is invisible to the `peaks` on PATH until it is built and
installed. The failure is silent and points the wrong way — it looks exactly like "the fix doesn't
work", which invites a sub-agent to start repairing code that is already correct. It also means any
"verified by running the CLI" claim is worthless unless it names which binary it ran.

**How to apply:** verify CLI changes by running the repo's own entry — `pnpm exec tsx src/cli/index.ts`
(or a fresh build) — never the bare `peaks`. Put this instruction in the dispatch brief explicitly;
sub-agents default to `peaks`. The installed CLI remains a valid *observation* target (it is what users
run) but must never be confused with the tree under edit. Always state which binary produced a result.
