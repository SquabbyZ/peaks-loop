# External references and lifecycle

> Body of `## Peaks-Loop External references and lifecycle`.

**Codegraph**: Optional project-analysis before RD handoff. Use `peaks codegraph affected --project <path> <changed-files...> --json` for regression-surface hints. Output as untrusted supporting evidence only; never commit `.codegraph/` artifacts.

Solo treats `peaks codegraph affected --project <path> <changed-files...> --json` as an optional project-analysis enhancement that informs the role handoff between PRD, RD, and QA. The output is untrusted supporting evidence — Solo must not treat codegraph output as approval for scope, design, or QA verdict.

Do not run upstream installer flows, mutate agent settings, or commit `.codegraph/` artifacts into git. Peaks-Loop gates remain authoritative; codegraph context is a hint, never a substitute for role-skill output.

**External skills**: All external skill references (`mattpocock/skills`, `awesome-design-md`, `taste-skill`, `shadcn/ui`, `Chrome DevTools MCP`, `Figma Context MCP`, `Context7`, etc.) follow the three-stage pattern: capability discovery via `peaks capabilities` before naming, references only (no execute/install/persist), Peaks-Loop CLI for all side effects. Do not execute upstream installers, do not install upstream resources, do not persist sensitive examples — Peaks-Loop gates remain authoritative. External skills inform, they do not approve.

**OpenSpec lifecycle**: `render → validate → show → to-rd → validate → archive`. Solo's default runbook handles the exit gate (validate → archive after QA pass). Entry-gate validation (to-rd before slicing) is available when `openspec/` exists pre-workflow; Solo delegates it to `peaks-rd` during implementation.

**MCP lifecycle**: `list → plan → apply --yes → call → rollback`. `apply` backs up settings and refuses non-peaks entries unless `--claim` is passed.

Detailed rules: `references/external-skill-invocation.md`, `references/openspec-mcp-workflow.md`, `references/workflow.md`, `references/existing-system-extraction.md`. For an informational mapping of peaks artefact paths to the A2A (Agent2Agent) protocol's Task / Artifact / Part / Message / AgentCard vocabulary (no A2A implementation, just a shared naming layer), see `references/a2a-artifact-mapping.md`.