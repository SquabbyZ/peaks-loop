# Step 0 — Anchor the workflow

> Body of `### Peaks-Cli Step 0: Anchor the workflow`. The instant Peaks-Cli Solo is invoked, **before** the mode-selection question, before any analysis, and before you decide whether the request "needs" the full pipeline, you MUST run these two commands and see their output:

```bash
# Session ID is auto-generated when omitted; the command returns it in the JSON output.
# Do NOT pass --session-id manually — the CLI is the single source of truth for the
# project session binding. To look up the active session id from a skill / sub-agent,
# use `peaks session info --active --json` (read-only, no side effects). To avoid
# the "two sessions in .peaks/" confusion that bites Solo, always omit --session-id
# here and let the CLI auto-generate.
peaks workspace init --project <repo> --json
peaks skill presence:set peaks-solo --project <repo> --gate startup
```

> `<repo>` is the **git project root** (the directory containing `.git`). In a monorepo / single-repo-multi-package layout, this is the repo root, NOT a sub-package — `.peaks/` lives at the repo root so every package shares one workspace. If unsure, run `git rev-parse --show-toplevel` and use that path. Never let `.peaks/` land inside a sub-package directory.

**There is no request too lightweight to skip this.** "分析下这个项目", "看一下代码", "分析项目", "解释一下架构", a one-line question — all of them still create the workspace and set presence first. The workspace is cheap; a missing `.peaks/` is the #1 reported failure.

**Anti-bail-out rule (BLOCKING):** You MUST NOT exit the peaks-solo workflow, hand control back, or produce a final answer before Step 0 has run. If you catch yourself thinking "this is just analysis, I don't need the workflow" — STOP. Run Step 0, set presence, then continue. A pure-analysis request runs the **lightweight analysis branch** (project scan + standards dry-run + handoff with a Standards-increment section), but it still anchors the workspace and keeps presence active. Declining to anchor is a workflow violation.

**Session conflict resolution (read once, internalise):** If `peaks workspace init` returns `code: "CONFLICTING_SESSION"` with a body like
`{"existingSessionId":"<Y>","requestedSessionId":"<X>"}`, the project is already bound to a different in-flight session `<Y>` (the one you or a prior run was working on). The fix is **NOT** to pass `--allow-session-rebind` to clobber `<Y>` — that destroys an active session's data. Instead: finish or abandon `<Y>` first (use `peaks session list --json` to see what it is, then `peaks session finish --id <Y>` or `peaks session abandon --id <Y>` — see your session command's help for the exact verbs). Only after `<Y>` is closed should you re-run `peaks workspace init`. The same rule applies to `peaks workspace init --session-id "<manually-forged>"` — do not pre-forge session ids; the CLI's auto-generated value is the binding.

`presence:set` accepts no `--mode` here on purpose — mode is unknown until Step 1. It is re-run with the selected mode in Step 2. Setting presence early guarantees the status header/line shows `peaks-solo` from the very first turn even if the user never reaches mode selection.