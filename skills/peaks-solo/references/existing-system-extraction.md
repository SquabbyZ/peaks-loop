# Existing visual & convention system extraction

Run this step when `project-scan.md` archetype is `legacy-frontend`, `legacy-fullstack`, or `frontend-monorepo`. Skip for `greenfield` and `unknown`.

Output: `.peaks/_runtime/<session-id>/system/existing-system.md`. The path lives under `system/` (not `ui/`) because the file records both UI tokens AND code conventions (service-layer signatures, hooks, naming) that backend-only or legacy-fullstack work consumes. UI design-draft and RD implementation MUST read this file and treat extracted tokens/conventions as hard constraints. New tokens or conventions may only be introduced when PRD explicitly authorizes them.

## Step 1 — Run the CLI (deterministic, source of truth)

```bash
peaks scan existing-system --project <repo> --json
```

The CLI emits stable JSON containing:

- `scanned`: `true | false` (skipped for greenfield / unknown archetypes; copy `scanSkippedReason` if false)
- `visualTokens`:
  - `colors[]`, `spacing[]`, `typography[]`, `radii[]` — each entry is `{ name, value, source }` parsed deterministically from Less/Sass variables, CSS variables, and `tailwind.config.*` color blocks
  - `sources[]` — every theme/style file the parser actually read (path + kind)
- `conventions`:
  - `componentNaming`: `PascalCase | kebab-case | mixed | unknown` (decided from real file names under the component directory)
  - `componentDir`, `serviceDir`, `hookDir` — first matching path found
  - `samples[]` — up to 5 most-recently-modified files per kind
- `inconsistencies[]` — token names that have different values across sources

Copy these fields VERBATIM into `existing-system.md`. Do not re-classify tokens; do not invent additional samples.

## Step 2 — Render the markdown

Use the template below. Every value must come from the CLI JSON; leave a section as `- (none detected)` when the CLI returned an empty array.

```markdown
# Existing visual & convention system
**Project:** <name>
**Date:** YYYY-MM-DD
**CLI command:** peaks scan existing-system --project <repo> --json
**Source files inspected:** <paste visualTokens.sources[*].path>

## Color tokens
<paste visualTokens.colors as "- {name}: {value} (source: {source})">

## Typography
<paste visualTokens.typography>

## Spacing
<paste visualTokens.spacing>

## Radius
<paste visualTokens.radii>

## Component conventions
- Naming: <conventions.componentNaming>
- Directory: <conventions.componentDir>
- Sample files: <conventions.samples filtered by kind=component>

## Service layer convention
- Directory: <conventions.serviceDir>
- Sample files: <conventions.samples filtered by kind=service>

## Hooks convention
- Directory: <conventions.hookDir>
- Sample files: <conventions.samples filtered by kind=hook>

## Detected inconsistencies
<paste inconsistencies[*] verbatim; if empty, write "- (none)">
```

## Hard rules for downstream consumers

- **UI design-draft**: every color, font, radius, spacing value used in the draft MUST come from `visualTokens.*` above. New values require an explicit `## New tokens (requested)` section with PRD justification.
- **RD implementation**: new components must match `conventions.componentNaming` and live under `conventions.componentDir`. Service and hook code must match the recorded directory.
- **QA**: regression checks must verify that no new color/spacing values escaped the recorded token set; inconsistencies from the CLI become QA acceptance items (resolve or explicitly accept).

## When the CLI returns empty results

If `scanned=true` but all token arrays are empty AND `conventions.componentDir` is null, the project has no detectable token system or component convention. Record this verbatim in `existing-system.md` under `## Detected inconsistencies → no theme system; values are hard-coded across files; no canonical component dir`. Surface it in the TXT handoff as a known risk. Do NOT invent a token system.

When `scanned=false` (archetype = greenfield or unknown), do not write `existing-system.md` at all — the greenfield path applies.

