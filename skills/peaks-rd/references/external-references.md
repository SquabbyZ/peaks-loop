# External references (RD)

> Body of `## External references`. **Matt Pocock skills** (`diagnose`, `triage`, `tdd`, `improve-codebase-architecture`, `prototype`): Engineering references only. Inspect before applying; Peaks-Cli RD gates remain authoritative.

**Understand Anything**: Consume via `peaks understand status/show --json`. Fall back to `peaks codegraph context` or local project scan when absent.

**Codegraph**: Optional local analysis via `peaks codegraph context/affected`. Output as untrusted supporting evidence; never commit `.codegraph/` artifacts.

**Other external resources** (Context7, SearchCode, everything-claude-code, GitNexus, etc.): Use `peaks capabilities --source access-repo/mcp-server --json` for capability discovery before recommending. References only — do not execute upstream installers, do not install upstream resources, do not persist sensitive examples. Peaks-Cli RD gates remain authoritative.

**OpenSpec CLI**: Route through Peaks-Cli CLI (`peaks openspec show/to-rd/render`). Do not hand-edit `openspec/changes/**`. Recipes: `references/openspec-cli.md`.