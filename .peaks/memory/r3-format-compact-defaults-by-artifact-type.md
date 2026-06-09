---
name: r3-format-compact-defaults-by-artifact-type
description: Per-artifact compact-by-default in peaks request show / peaks retrospective show / peaks project memories:show.
kind: lesson
sourceArtifact: src/cli/commands/request-commands.ts
---

# r3 — per-artifact compact-by-default

Slice 023 (R3). Only PRD and tech-doc are human-review surfaces and stay
pretty by default. All other RD/QA/TXT artifacts default to compact.

## Per-artifact default table

| Artifact type | Default format | Rationale |
|---|---|---|
| `prd` | pretty | User review surface |
| `tech-doc` | pretty | User review surface |
| `code-review` | compact | LLM-primary, repeated reads |
| `security-review` | compact | LLM-primary, repeated reads |
| `perf-baseline` | compact | LLM-primary, repeated reads |
| `bug-analysis` | compact | LLM-primary, repeated reads |
| `test-cases` | compact | LLM-primary, repeated reads |
| `test-reports` | compact | LLM-primary, repeated reads |
| `security-findings` | compact | LLM-primary, repeated reads |
| `performance-findings` | compact | LLM-primary, repeated reads |
| `handoff` | compact | LLM-primary, repeated reads |

## CLI surface

- `peaks project memories:show <name>` — default compact; `--pretty` for
  the on-disk form.
- `peaks retrospective show <id>` — default compact; `--pretty` for
  re-hydrated.
- `peaks request show <rid> --role <role>` — per-artifact default; pass
  `--pretty` or `--compact` at the show level to override uniformly
  (last flag wins when both are passed).

## Rules

- **Default**: trust the per-artifact default. Do NOT pass `--pretty` when
  loading into LLM context; the compact form preserves all semantic
  content (code fences, tables, setext headings) and only strips
  decoration (blank-line padding, decorative `---`, frontmatter
  `description:` repeat).
- **Human review**: pass `--pretty` (or `--role prd` / `rd --artifact
  tech-doc`) to get the on-disk verbatim form for editor reading.

## Why

Pretty formatting is a tax on every LLM read with no signal-to-noise
gain. Compact format preserves every meaningful construct and only
strips the decoration. Memory, retrospective, and all non-PRD/tech-doc
artifacts are LLM-primary — they're parsed and discarded; a 30-50%
context reduction is the slice's primary success metric (PRD AC11).
