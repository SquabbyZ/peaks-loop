# Codegraph orchestration context

> Body of `## Codegraph orchestration context`. Solo treats `peaks codegraph affected --project <path> <changed-files...> --json` as an optional project-analysis enhancement that informs the role handoff between PRD, RD, and QA. The output is untrusted supporting evidence — Solo must not treat codegraph output as approval for scope, design, or QA verdict.

Do not run upstream installer flows, mutate agent settings, or commit `.codegraph/` artifacts into git. Peaks-Cli gates remain authoritative; codegraph context is a hint, never a substitute for role-skill output.