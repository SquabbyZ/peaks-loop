# Codegraph orchestration context

> Body of `## Codegraph orchestration context`. Code treats `peaks codegraph affected --project <path> <changed-files...> --json` as an optional project-analysis enhancement that informs the role handoff between PRD, RD, and QA. The output is untrusted supporting evidence — Code must not treat codegraph output as approval for scope, design, or QA verdict.

Do not run upstream installer flows, mutate agent settings, or commit `.codegraph/` artifacts into git. Peaks-Loop gates remain authoritative; codegraph context is a hint, never a substitute for role-skill output.

## Post-slice incremental re-index (slice 2026-09-01-feedback)

After each slice / task completes (RD done → QA done), the orchestrator MUST proactively run `peaks codegraph index --project <path>` to refresh the codegraph so the next slice's `affected` / `query` / `context` reflect the latest code — never a stale pre-slice graph. `index` is an incremental refresh; `peaks codegraph init` runs once per project, `index` runs after every slice.

The upstream bare `codegraph <subcommand>` binary is NOT on PATH — always route through `peaks codegraph <subcommand>`. (Upstream's own `status` output prints `Run "codegraph init" to initialize`; that bare-command hint is misleading in the peaks-loop context. A separate fix slice rewrites it to `peaks codegraph init`.)