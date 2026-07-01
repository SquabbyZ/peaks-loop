## Codegraph project analysis (RD)

> Body of `## Codegraph project analysis`. RD may use `peaks codegraph affected --project <path> <changed-files...> --json` as local project-analysis evidence to inform red-line scope boundaries before writing tech-doc or starting implementation. Treat the output as untrusted supporting evidence — verify against the actual code before relying on it.

Do not run upstream installer flows, mutate agent settings, or commit `.codegraph/` artifacts. Peaks-Loop RD gates remain authoritative for handoff and acceptance.