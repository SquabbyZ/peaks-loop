# Quality-gate commands (CLI cheat sheet)

> Body of `## Peaks-Loop Quality-gate commands`. These commands harden the workflow against silent skips. Use them in the runbook at the points indicated; they all support `--json` and `--session-id`.

| Command | Purpose | When to run | Non-zero exit when |
|---|---|---|---|
| `peaks request lint <rid> --role <role> --project <path>` | Scan artifact body for unfilled `<placeholder>`, bare `- ...` bullets, TBD/TODO markers | Before every transition out of `draft` / before role handoff | Any `error`-severity finding (unfilled placeholder, bare-dot bullet) |
| `peaks request repair-status <rid> --project <path>` | Count RD↔QA repair cycles from `--reason` transition notes ("QA cycle N: ...") | Before every RD repair iteration in step 7 | Cycle count reached the 3-cycle cap |
| `peaks scan request-type-sanity --project <path> --type <type>` | Cross-verify declared `--type` against the actual `git diff` file mix (catches "feature mis-declared as docs" workflow violations) | After PRD type lock-in AND after each RD repair iteration | Declared type disagrees with the file mix |
| `peaks scan libraries --project <path>` | Enumerate every dependency + devDependency + peerDependency + optionalDependency with parsed major version; output goes to `## Library versions` in `rd/project-scan.md`. Read-only. | At Code step 0.6 (alongside `peaks scan archetype`) | Always exits 0 (warnings in JSON envelope; never blocks) |
| `peaks slice check [--rid <rid>] [--project <path>]` | 4-stage slice 边界 check (typecheck + unit-tests + review-fanout + gate-verify-pipeline). Aggregate pass/fail; non-zero exit if any stage fails. See "Slice 边界 check" below for usage rules (boundary only, never inside a micro-cycle). | At slice 边界（post-micro-cycle, pre-peaks-qa）| Any stage fails |

Together with `peaks request transition` (which already CLI-enforces per-type artifact prerequisites), these five commands form the runtime quality net. SKILL.md prose is descriptive; the CLI is what physically blocks bad workflows.