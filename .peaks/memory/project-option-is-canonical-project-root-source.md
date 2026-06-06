---
name: project-option-is-canonical-project-root-source
description: --project option is canonical project-root source
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-06-06-session-22f08c/txt/handoff.md
---

The `peaks <cmd> --project <path>` option is the canonical project-root source. `process.env[adapter.envVar]` (e.g. `CLAUDE_PROJECT_DIR`) is only an env-var override for `peaks hook handle` (auto-detected by IDE). CLI commands like `peaks gate enforce` and `peaks statusline install` take only `--project`, NOT the env var. The hard rule (per slice #1 RD): if both are available, `--project` wins; env var is a fallback for `hook handle` only.
