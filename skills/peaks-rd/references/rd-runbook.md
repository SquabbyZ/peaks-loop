# Default runbook (RD)

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
# before regenerating (e.g. via `ls .peaks/<changeId>/rd/project-scan.md`). If it exists
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

# 6.5 BEFORE tech-doc: verify EVERY path in the tech-doc against actual project structure (Peaks-Cli Gate A2)
#     ls every directory path in the tech-doc — zero "No such file" allowed
#     This is the most common RD failure mode. Do not skip it.

# 6.6 BEFORE implementation: verify CLAUDE.md + .claude/rules/ exist (Peaks-Cli Gate A3)
#     Missing standards files → run `peaks standards init --project .` first
#     Without project rules, security review and code review triggers won't fire.

# 7. AFTER implementation, BEFORE QA handoff — RUN THESE GATES:
#    Peaks-Cli Gate B2: unit tests exist and pass for the changed surface → npx vitest run --changed (or project equivalent; the changed-only mode is the peaks slice check default as of run 017; use --run-tests for the full suite, or invoke /peaks-solo-test to run the full suite standalone)
#    Peaks-Cli Gate B3: code review evidence → .peaks/<changeId>/rd/code-review.md
#    Peaks-Cli Gate B4: security review evidence → .peaks/<changeId>/rd/security-review.md
#    Peaks-Cli Gate B5 (NEW): RD artifact body has no unfilled placeholders.
peaks request lint <rid> --role rd --project <repo> --session-id <session-id> --json
#    Peaks-Cli Gate B6 (NEW): declared --type still matches the actual diff after implementation.
peaks scan request-type-sanity --project <repo> --type <type> --json
#    Peaks-Cli Gate B7 (NEW, repair cycles only): we have not exceeded the 3-cycle cap.
peaks request repair-status <rid> --project <repo> --session-id <session-id> --json
#    Peaks-Cli Gate B8 (NEW): every changed file matches the RD red-line scope (no out-of-bounds writes).
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