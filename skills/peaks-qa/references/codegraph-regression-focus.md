# Codegraph regression focus (QA)

> Body of `## Codegraph regression focus`. QA may use `peaks codegraph affected --project <path> <changed-files...> --json` as regression-surface evidence when deciding which related modules, tests, or manual checks deserve attention. This is useful when RD provides changed files and the likely dependency impact is unclear.

External analysis cannot pass QA by itself. Treat codegraph output as untrusted supporting evidence, verify behavior through normal Peaks-Cli QA validation, and do not run upstream installer flows, configure an MCP server, mutate agent settings, or commit `.codegraph/` artifacts.