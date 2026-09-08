# External references (RD)

> Body of `## External references`. **Matt Pocock skills** (`diagnose`, `triage`, `tdd`, `improve-codebase-architecture`, `prototype`): Engineering references only. Inspect before applying; Peaks-Loop RD gates remain authoritative.

**Codegraph**: Project analysis is codegraph-first (`peaks codegraph context/affected`). Output as untrusted supporting evidence; never commit `.codegraph/` artifacts. When codegraph is unavailable, fall back to structural analysis (import edges + local project scan).

**Other external resources** (Context7, SearchCode, everything-claude-code, GitNexus, etc.): Use `peaks capabilities --source access-repo/mcp-server --json` for capability discovery before recommending. References only — do not execute upstream installers, do not install upstream resources, do not persist sensitive examples. Peaks-Loop RD gates remain authoritative.

**OpenSpec CLI**: Route through Peaks-Loop CLI (`peaks openspec show/to-rd/render`). Do not hand-edit `openspec/changes/**`. Recipes: `references/openspec-cli.md`.