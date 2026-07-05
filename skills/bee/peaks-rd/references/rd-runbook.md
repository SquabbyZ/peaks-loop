## Default runbook (RD)

> Body of `## Default runbook` + numbered runbook steps #0–#8. The default sequence the RD skill should execute for a code-touching request. Skip steps that do not apply to the request type; do not skip the artifact, coverage gate, or red-line scope steps.

```bash
# 0. confirm RD's own runbook integrity before any code edit
peaks skill runbook peaks-rd --json
peaks skill presence:set peaks-rd --project <repo>  # show persistent skill presence every turn

# 1. capture the RD request artifact and read upstream PRD / UI scope
peaks request init --role rd --id <request-id> --project <repo> --apply --json
peaks request show <request-id> --role prd --project <repo> --json
peaks request show <request-id> --role ui  --project <repo> --json   # if UI involved

# 2. standards preflight before planning any code edit
peaks standards init   --project <repo> --dry-run --json
peaks standards update --project <repo> --dry-run --json

# 3. pull OpenSpec context when openspec/ exists in the repo
peaks openspec list --project <repo> --json
peaks openspec show     <change-id> --project <repo> --json
peaks openspec validate <change-id> --project <repo> --json    # entry gate
peaks openspec to-rd    <change-id> --project <repo> --json    # acceptance + commit boundaries

# 4. project-analysis evidence — MANDATORY before implementation
peaks understand status --project <repo> --json
peaks understand show   --project <repo> --json                # when UA artifact exists
peaks codegraph context --project <repo> "<task>"
peaks codegraph affected --project <repo> <changed-files...> --json

# 4.1 read project-scan from Solo's pre-RD scan — BLOCKING if missing
# **STOP if .peaks/_runtime/<sessionId>/rd/project-scan.md does not exist.**
# **Do not write any code, do not plan any implementation, do not pass go.**
# **Create the project-scan first, then proceed.**
# NOTE: project-scan.md is a session-scoped singleton. Check if it already exists
# before regenerating (e.g. via `ls .peaks/_runtime/<sessionId>/rd/project-scan.md`). If it exists
# and is complete (has `## Archetype` and `## Project mode` sections), reuse it.
# Required sections in project-scan:
#   - build tool and framework
#   - component library (antd, MUI, shadcn, etc.) and version
#   - CSS solution (Less, Sass, TailwindCSS, CSS-in-JS) and conflicts
#   - state management, routing, data fetching libraries
#
# After writing project-scan, embed durable memory markers for stable project facts.
# Append one <!-- peaks-memory:start --> block per fact at the end of project-scan.md:
#
#   <!-- peaks-memory:start -->
#   title: <component library>
#   kind: module
#   ---
#   <Library> <version> — detected from package.json and source imports.
#   <!-- peaks-memory:end -->
#
# Embed markers for: component library, CSS solution, build tool, state management,
# routing, data fetching, and any legacy constraints. These facts are session-invariant
# and valuable for future sessions. Do NOT embed secrets, credentials, or transient state.

# 4.2 component library detection — verify against package.json, not assumptions
# WRONG: "looks like a React project, let me use shadcn/ui"
# RIGHT: check package.json for antd/@mui/@shadcn/etc., match imports in source files

# 4.3 CSS framework conflict check (CRITICAL)
# Detect conflicts BEFORE adding any CSS dependency:
# - TailwindCSS + antd → HIGH conflict (preflight reset vs antd base styles)
# - TailwindCSS + MUI → HIGH conflict (utility classes vs sx/system props)
# - Adding a second CSS-in-JS lib to a project that already has one → BLOCK
# - Adding Less/Sass to a CSS-in-JS project → wasteful, not conflicting
# If a conflict is detected, DO NOT add the conflicting dependency.
# Record the conflict in the RD artifact and propose a compatible alternative.

# 4.4 source-code component import verification
# grep source files for actual component imports to confirm library usage:
# grep -r "from 'antd'" src/ --include="*.tsx" --include="*.ts"
# grep -r "from '@mui/material'" src/ --include="*.tsx"
# grep -r "from '@/components/ui'" src/ --include="*.tsx"

# 4.5 mock data strategy — MANDATORY for frontend-only projects
# Check project-scan for the detected build tool:
#   Umi → use mock/*.ts (Umi's built-in mock directory)
#   Vite → use src/mock/ (service-layer mock files)
#   Next.js → match existing project pattern
# NEVER write mock data inline in component files.
# See "Mock data placement rules" section for the full framework mapping.

# 5. optional library docs lookup through the LLM's own tool list (Context7 MCP)
# If the Context7 MCP is present in the tool list, invoke the
# tool directly (resolve-library-id / query-docs / etc.). If absent, skip
# library docs and rely on existing project knowledge — do NOT hand-edit
# `~/.claude/settings.json` to install MCPs.

# 6. record red-line scope, slice contract, coverage status into the RD artifact, then implement

# 6.5 BEFORE tech-doc: verify EVERY path in the tech-doc against actual project structure (Peaks-Loop Gate A2)
#     ls every directory path in the tech-doc — zero "No such file" allowed
#     This is the most common RD failure mode. Do not skip it.

# 1.x API surface scan (Slice 3/6 — `peaks scan api-surface` lands)
#     Identify existing API endpoints / components / stores / mocks in the
#     project that the slice could reuse, BEFORE writing any new code. The
#     output of this step feeds directly into the tech-doc's
#     `## Existing API / Component Inventory` section (mandatory since
#     Slice 2, enforced at spec-locked gate C).
#
#     Concrete command (Slice 3 lands the CLI):
#       peaks scan api-surface --project <path> --max-per-kind 50
#     The default markdown output can be pasted directly into the tech-doc
#     section 7. For machine-readable JSON use `--format json`.
#     Ad-hoc grep fallback if the CLI is unavailable:
#       grep -r "router\.\(get\|post\|put\|delete\)" src/
#       grep -r "@Get\|@Post\|@Put\|@Delete" src/
#       grep -r "createSlice\|defineStore" src/
#       grep -r "mock\|fixture" src/
#     Record the inventory in the tech-doc section 7 (see mandatory-tech-doc.md).

# 1.y Orphan scan (Slice 4/6 — `peaks scan orphan` lands)
#     After the slice is implemented (or near-complete), scan for 4 kinds of
#     orphans that the RD may have left behind (karpathy §3 Surgical Changes
#     — "remove what your changes made unused"):
#       1. exportOrphan: declared export with no in-repo importer
#       2. importOrphan: import whose source no longer exports the symbol
#       3. cliSubcommandOrphan: `.command('x')` registered but only referenced
#          at the declaration site
#       4. docEndpointOrphan: tech-doc declares `peaks <sub>` that the codebase
#          does not implement
#
#     Concrete command (Slice 4 lands the CLI):
#       peaks scan orphan --project <path>                    # default: working-tree scope
#       peaks scan orphan --project <path> --scope all --strict  # full audit
#       peaks scan orphan --project <path> --format json     # machine-readable
#     Re-run after cleanup; pass with zero counts before `peaks request
#     transition --state qa-handoff`. The Slice 4 service is read-only and
#     uses `git diff --name-status HEAD` for working-tree scope (no git CLI
#     writes). Falls back to empty diff if git is unavailable (degraded mode).

# 1.z Karpathy scan (Slice 5/6 + Slice 6/6 — `peaks scan karpathy` + karpathy-reviewer sub-agent)
#     After the slice is implemented, scan `rd/karpathy-review.md` for the
#     4 Karpathy guidelines (Think / Simplicity / Surgical / Goal) and verify
#     the hard Karpathy-Gate (KARPATHY_REVIEW prereq in artifact-prerequisites.ts).
#     The structural scanner covers regex / file-presence checks; the semantic
#     review is owned by the karpathy-reviewer sub-agent.
#
#     Concrete commands:
#       peaks scan karpathy --project <path>                       # markdown report
#       peaks scan karpathy --project <path> --format json         # machine-readable
#       peaks scan karpathy --project <path> --scope all           # full audit (gateAction: block if missing)
#     Required output before `peaks request transition --state qa-handoff`:
#       - `rd/karpathy-review.md` exists with `## Karpathy-Gate` header
#       - 4 title-case section headers present (Think Before Coding / Simplicity First / Surgical Changes / Goal-Driven Execution)
#       - `gateAction: pass` (or `warn` with documented justification)
#
#     Sub-agent dispatch (Slice 6/6 deliverable — karpathy-reviewer sub-agent):
#       peaks sub-agent dispatch karpathy-reviewer \
#         --rid <rid> --project <repo> --json
#     The sub-agent reads `~/.claude/agents/karpathy-reviewer.md` (user-installed)
#     which is the project-internal draft at
#     `skills/peaks-rd/references/karpathy-reviewer-prompt.md` plus a
#     `rd/karpathy-reviewer-agent-handoff.md` install guide.
#     Hard gate: missing karpathy-reviewer sub-agent OR missing rd/karpathy-review.md
#     → `peaks request transition --state qa-handoff` returns `code: PREREQUISITES_MISSING`.
#     Escape hatch (assisted mode): `--allow-incomplete --confirm`.

# 6.6 BEFORE implementation: verify CLAUDE.md + .claude/rules/ exist (Peaks-Loop Gate A3)
#     Missing standards files → run `peaks standards init --project .` first
#     Without project rules, security review and code review triggers won't fire.

# 7. AFTER implementation, BEFORE QA handoff — RUN THESE GATES:
#    Peaks-Loop Gate B2: unit tests exist and pass for the changed surface → npx vitest run --changed (or project equivalent; the changed-only mode is the peaks slice check default as of run 017; use --run-tests for the full suite, or invoke /peaks-code-test to run the full suite standalone)
#    Peaks-Loop Gate B3: code review evidence → .peaks/_runtime/<sessionId>/rd/code-review.md
#    Peaks-Loop Gate B4: security review evidence → .peaks/_runtime/<sessionId>/rd/security-review.md
#    Peaks-Loop Gate B5 (NEW): RD artifact body has no unfilled placeholders.
peaks request lint <rid> --role rd --project <repo> --session-id <session-id> --json
#    Peaks-Loop Gate B6 (NEW): declared --type still matches the actual diff after implementation.
peaks scan request-type-sanity --project <repo> --type <type> --json
#    Peaks-Loop Gate B7 (NEW, repair cycles only): we have not exceeded the 3-cycle cap.
peaks request repair-status <rid> --project <repo> --session-id <session-id> --json
#    Peaks-Loop Gate B8 (NEW): every changed file matches the RD red-line scope (no out-of-bounds writes).
peaks scan diff-vs-scope --rid <rid> --project <repo> --session-id <session-id> --json
#    All six non-zero → BLOCKED. Fix and re-check before attempting the qa-handoff transition.

# 7. self-validate before QA handoff
peaks openspec validate <change-id> --project <repo> --json    # exit gate (re-run)

# 8. hand off to QA via the cross-linked request id
peaks request init --role qa --id <request-id> --project <repo> --apply --json
peaks request show <request-id> --role rd --project <repo> --json
peaks project memories:extract --session-id <session-id> --project <repo> --json  # extract durable memories
peaks skill presence:clear --project <repo>                      # handoff complete, remove presence indicator
```

For refactor work, the coverage ≥ 95% gate in `Refactor hard gates` still applies and must be recorded in the artifact before slicing begins.