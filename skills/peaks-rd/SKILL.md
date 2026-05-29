---
name: peaks-rd
description: Research and development skill for Peaks. Use for engineering analysis, refactor planning, project scanning, code standards, unit-test coverage gates, implementation contracts, task graphs, and RD handoffs. Always use this for Peaks-Cli refactor workflows.
---

# Peaks-Cli RD

Peaks-Cli RD owns engineering analysis, implementation planning, and refactor execution contracts.

## Skill presence (MANDATORY first action)

Before any analysis or tool call, immediately run:

```bash
peaks skill presence:set peaks-rd --project <repo> --mode <mode> --gate startup
```
Read persistent project memory via CLI (durable, LLM-authored memories):

```bash
peaks project memories --project <repo> --json
```

This returns durable memories from `.peaks/memory` — decisions, conventions, modules, and rules captured in past sessions. Filter with `--kind <decision|convention|module|rule|reference|project>`. (`.peaks/PROJECT.md` is a human-readable session timeline only.)
Then display: `Peaks-Cli Skill: peaks-rd | Peaks-Cli Gate: startup | Next: <one short action>`. Update with `peaks skill presence:set peaks-rd --project <repo> --mode <mode> --gate <gate>` when gates change. When the role's work ends, run `peaks skill presence:clear --project <repo>`.

## Responsibilities

- scan the current project before changes;
- prefer existing project standards over built-in language standards;
- enforce the 95% UT coverage refactor gate;
- split broad refactors by minimal functional slices;
- generate refactor options, risk matrix, rollback plan, and task graph preview;
- implement only after strict specs and confirmations exist.

## Mandatory per-request artifact

Every RD invocation — feature, bug, refactor, clarification — must write a durable artifact at `.peaks/<session-id>/rd/requests/<request-id>.md`. This is the canonical engineering record for that request; handoff to QA/SC is blocked while the artifact is missing or its state is `draft` or `spec-locked` without implementation evidence.

Use the `<request-id>` PRD assigned. RD companion artifacts (task graph, scan report, coverage evidence, slice spec, dry-run output, MCP call results) live alongside this file under the same `rd/` workspace and are linked from it.

Concrete template and rules: `references/artifact-per-request.md`.

## Default runbook

The default sequence the RD skill should execute for a code-touching request. Skip steps that do not apply to the request type; do not skip the artifact, coverage gate, or red-line scope steps.

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
# **STOP if .peaks/<session-id>/rd/project-scan.md does not exist.**
# **Do not write any code, do not plan any implementation, do not pass go.**
# **Create the project-scan first, then proceed.**
# NOTE: project-scan.md is a session-scoped singleton. Check if it already exists
# before regenerating (e.g. via `ls .peaks/<id>/rd/project-scan.md`). If it exists
# and is complete (has `## Archetype` and `## Project mode` sections), reuse it.
# Required sections in project-scan:
#   - build tool and framework
#   - component library (antd, MUI, shadcn, etc.) and version
#   - CSS solution (Less, Sass, TailwindCSS, CSS-in-JS) and conflicts
#   - state management, routing, data fetching libraries

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

# 5. optional library docs lookup through an installed MCP server
peaks mcp list --json
peaks mcp call --capability context7.docs-lookup --tool <name> --args-json '{...}' --json

# 6. record red-line scope, slice contract, coverage status into the RD artifact, then implement

# 6.5 BEFORE tech-doc: verify EVERY path in the tech-doc against actual project structure (Peaks-Cli Gate A2)
#     ls every directory path in the tech-doc — zero "No such file" allowed
#     This is the most common RD failure mode. Do not skip it.

# 6.6 BEFORE implementation: verify CLAUDE.md + .claude/rules/ exist (Peaks-Cli Gate A3)
#     Missing standards files → run `peaks standards init --project .` first
#     Without project rules, security review and code review triggers won't fire.

# 7. AFTER implementation, BEFORE QA handoff — RUN THESE GATES:
#    Peaks-Cli Gate B2: unit tests exist and pass → npx vitest run (or project equivalent)
#    Peaks-Cli Gate B3: code review evidence → .peaks/<id>/rd/code-review.md
#    Peaks-Cli Gate B4: security review evidence → .peaks/<id>/rd/security-review.md
#    Peaks-Cli Gate B5 (NEW): RD artifact body has no unfilled placeholders.
peaks request lint <rid> --role rd --project <repo> --session-id <sid> --json
#    Peaks-Cli Gate B6 (NEW): declared --type still matches the actual diff after implementation.
peaks scan request-type-sanity --project <repo> --type <type> --json
#    Peaks-Cli Gate B7 (NEW, repair cycles only): we have not exceeded the 3-cycle cap.
peaks request repair-status <rid> --project <repo> --session-id <sid> --json
#    Peaks-Cli Gate B8 (NEW): every changed file matches the RD red-line scope (no out-of-bounds writes).
peaks scan diff-vs-scope --rid <rid> --project <repo> --session-id <sid> --json
#    All six non-zero → BLOCKED. Fix and re-check before attempting the qa-handoff transition.

# 7. self-validate before QA handoff
peaks openspec validate <change-id> --project <repo> --json    # exit gate (re-run)

# 8. hand off to QA via the cross-linked request id
peaks request init --role qa --id <request-id> --project <repo> --apply --json
peaks request show <request-id> --role rd --project <repo> --json
peaks skill presence:clear --project <repo>                      # handoff complete, remove presence indicator
```

For refactor work, the coverage ≥ 95% gate in `Refactor hard gates` still applies and must be recorded in the artifact before slicing begins.

### Transition verification gates (MANDATORY — run the command, see the output)

You cannot declare a phase complete from memory. Each gate below is a `ls` or `grep` command you **MUST run** and whose output you **MUST see** before proceeding. If any file shows "No such file" or any command returns empty, the phase is incomplete.

> **CLI enforcement (NEW)**: the gates below are now ALSO enforced by `peaks request transition`. The CLI checks the same files before allowing the transition and fails with `code: PREREQUISITES_MISSING` if any are absent. The exact required files depend on the request type chosen at `peaks request init --type <feature|bugfix|refactor|docs|config|chore>` (default `feature`):
>
> | Type | rd:implemented requires | rd:qa-handoff also requires |
> |---|---|---|
> | feature / refactor | `rd/tech-doc.md` | `rd/code-review.md` + `rd/security-review.md` |
> | bugfix | `rd/bug-analysis.md` (lighter than tech-doc; root cause + fix + regression test plan) | `rd/code-review.md` + `rd/security-review.md` |
> | config | (none) | `rd/security-review.md` only |
> | docs / chore | (none) | (none) |
>
> The escape hatch `--allow-incomplete --reason "<text>"` still exists for one-off exceptions; the bypass is recorded in the artifact transition note.

**Peaks-Cli Gate A — After project-scan read (before any implementation):**
```bash
ls .peaks/<id>/rd/project-scan.md
# Expected output: .peaks/<id>/rd/project-scan.md
# "No such file" → STOP, create the project-scan first. Do not write code.
```

**Peaks-Cli Gate A2 — Before tech-doc write: project structure verified (PATH CORRECTNESS — CRITICAL):**
```bash
# Verify EVERY file path and directory in the tech-doc exists in the actual project.
# Do not assume paths. Do not guess directory structures. Open the files and verify.
# Example verification (adapt paths to the actual tech-doc):
ls <every-single-directory-path-in-tech-doc> 2>&1 | grep -c "No such file"
# Expected: 0 (zero "No such file" errors)
# Any "No such file" → WRONG PATH. Fix the tech-doc BEFORE writing another word.
# This gate exists because a tech-doc with wrong paths wastes QA time,
# breaks the implementation, and forces the user to correct the engineer.
```

**Peaks-Cli Gate A3 — Before implementation: project standards files exist (CLAUDE.md + .claude/rules/):**
```bash
ls CLAUDE.md .claude/rules/common/coding-style.md .claude/rules/common/code-review.md .claude/rules/common/security.md 2>&1 | grep -c "No such file"
# Expected: 0 (all four files exist)
# Any missing → BLOCKED. Run `peaks standards init --project .` to generate them FIRST.
# Do not write a single line of implementation code without standards files in place.
# Without CLAUDE.md and .claude/rules/, code review and security review triggers won't fire.
```

**Peaks-Cli Gate B — Before QA handoff:**
```bash
ls .peaks/<id>/rd/requests/<rid>.md \
   .peaks/<id>/rd/tech-doc.md
# Both must exist. Missing either → BLOCKED, do not hand off to QA
```

**Peaks-Cli Gate B2 — Before QA handoff: unit tests exist and pass:**
```bash
# Run the project's test command against changed files. Record the output.
# Example (adapt to project test runner):
npx vitest run --reporter=verbose 2>&1 | tail -20
# Expected: exit code 0, all tests passing, coverage for new/changed code recorded
# Any failing test or zero tests for new code → BLOCKED. Write tests, then re-run.
```

**Peaks-Cli Gate B3 — Before QA handoff: code review evidence exists:**
```bash
ls .peaks/<id>/rd/code-review.md 2>&1
# Expected: .peaks/<id>/rd/code-review.md
# "No such file" → BLOCKED. Run code review (use code-reviewer agent or equivalent),
# record findings, fix CRITICAL/HIGH issues, then re-check.
```

**Peaks-Cli Gate B4 — Before QA handoff: security review evidence exists:**
```bash
ls .peaks/<id>/rd/security-review.md 2>&1
# Expected: .peaks/<id>/rd/security-review.md
# "No such file" → BLOCKED. Run security review (use security-reviewer agent or equivalent),
# fix CRITICAL/HIGH issues, record findings, then re-check.
```

**Peaks-Cli Gate B5 — RD artifact body has no unfilled placeholders:**
```bash
peaks request lint <rid> --role rd --project <repo> --session-id <sid> --json
# Expected: ok=true. exit 0.
# ok=false → BLOCKED. The lint output lists every <placeholder>, "- ..." stub,
# and TBD/TODO marker with line numbers. Fill them in before attempting handoff.
```

**Peaks-Cli Gate B6 — Declared --type matches the actual diff:**
```bash
peaks scan request-type-sanity --project <repo> --type <type> --json
# Expected: consistent=true. exit 0.
# consistent=false → BLOCKED. Either the implementation scope-creeped beyond what
# the declared type covers, or the type was mis-classified at PRD time. Re-classify
# (`peaks request init` with the corrected --type) or trim the scope.
```

**Peaks-Cli Gate B7 — Repair cycle cap (only relevant during RD↔QA repair loop):**
```bash
peaks request repair-status <rid> --project <repo> --session-id <sid> --json
# Expected: atCap=false. exit 0.
# atCap=true → BLOCKED. Three repair cycles already attempted; emit a blocked TXT
# handoff via Solo rather than entering a fourth cycle.
```

**Peaks-Cli Gate B8 — Diff stays inside the declared red-line scope:**
```bash
peaks scan diff-vs-scope --rid <rid> --project <repo> --session-id <sid> --json
# Expected: ok=true. exit 0.
# violations[] non-empty → BLOCKED. A changed file matches an explicit out-of-scope
#   pattern. Revert it, or — only with PRD approval — expand the RD red-line scope.
# unclassified[] non-empty → BLOCKED. A changed file does not match any declared
#   in-scope pattern. Either add it to the in-scope list (intentional widening, requires
#   PRD approval) or revert the change.
# patternsDeclared=false → BLOCKED. The RD artifact's `## Red-line scope` section has
#   no concrete path or glob patterns. Fill it in with paths like `src/services/login/**`
#   before re-running. Auto-allowed paths (test files, .peaks/, __mocks__/) never need a pattern.
```

## Project standards preflight

Before RD planning or implementation work in a code repository, call the Peaks-Cli CLI:

- `peaks standards init --project <path> --dry-run`
- `peaks standards update --project <path> --dry-run`

If `CLAUDE.md` is missing, treat creation as the preferred path. If `CLAUDE.md` already exists, use `standards update` to decide whether to append a managed index block or surface review-only suggestions. Apply only when write authorization exists; otherwise keep the CLI output as a preflight next action. Do not hand-write standards file mutations inside the skill.

## GStack integration and code dry-runs

Use gstack as a concrete engineering workflow reference for `Think → Plan → Build → Review → Test → Ship → Reflect`:

- map plan engineering review to Peaks-Cli RD risk matrices, task graphs, and slice contracts;
- map build/review discipline to strict spec-first implementation and code-review gates;
- map investigate/careful/guard concepts to root-cause analysis, risky-action confirmation, and scoped edit boundaries;
- adapt gstack concepts into Peaks-Cli artifacts rather than invoking gstack commands as runtime dependencies.

When Peaks-Cli RD produces or changes code, dry-run repeatedly instead of only during preflight:

1. run standards dry-runs before planning or implementation;
2. run the relevant Peaks-Cli dry-run again after each meaningful implementation slice or standards-affecting decision;
3. after implementation, run required unit tests, code review, and security review before any completion claim;
4. only after those checks pass, run the relevant Peaks-Cli dry-run before handoff, review, or retention-boundary work;
5. record commands, results, coverage evidence, reviewer/security findings, dry-run result, and remaining action in the RD handoff capsule.

## Requirement boundary red-line self-check

Before every code or mock change, RD must write and then enforce a red-line scope check in the RD artifact:

1. name the exact product requirement, route, UI surface, API path, data model, and **path/glob patterns** that are in scope. Write them under the RD artifact's `## Red-line scope` section as bullets. Use `In-scope:` / `Out-of-scope:` subheaders when both lists are non-trivial, or wrap paths in backticks for clarity (e.g. `` `src/services/login/**` ``);
2. name adjacent surfaces that are explicitly out of scope, especially list pages, delete/update flows, unrelated API endpoints, existing data records, authentication, permissions, and shared runtime configuration;
3. reject any implementation that modifies, deletes, mocks, or replaces out-of-scope behavior just to make validation pass;
4. for API/mock work, mock only the exact request path and method required by the approved slice, and do not override broader collection/list endpoints unless the requirement explicitly includes them;
5. before handoff, run `peaks scan diff-vs-scope --rid <rid> --project <repo>` to deterministically verify the diff against the declared patterns (this is **Peaks-Cli Gate B8**). The CLI auto-allows test files and `.peaks/` artifacts; any other unclassified or out-of-scope file blocks RD completion until the diff is trimmed OR the scope is widened with PRD approval.

## Mandatory tech-doc output

**BLOCKING — Do not hand off to QA without this file.** Every RD invocation that touches code MUST produce a tech-doc artifact at `.peaks/<session-id>/rd/tech-doc.md`. If this file is missing at QA handoff, the handoff is invalid. The request artifact links to it; QA and SC read it for verification context.

**Minimum tech-doc sections:**

1. **Architecture decisions** — what changed, why, tradeoffs considered, alternatives rejected
2. **Component changes** — files added/modified/deleted with role (new component, refactor, bug fix)
   - **CRITICAL: Every file path in this section must be verified against the actual project.** Run `ls` on every directory path before writing it. A wrong path is worse than no tech-doc — it sends QA and future developers to non-existent files.
3. **Data flow** — how data moves through the changed surface (props, API calls, state updates, events)
4. **CSS/Style changes** — what CSS files or style blocks changed, which component-library tokens were used, any CSS framework interactions
5. **API contract changes** — new/modified request paths, request/response shapes, error states
6. **Dependencies** — new packages added, versions, why each was needed, license check

**CSS framework change rules:**
- When a component library (antd, MUI, etc.) is already in use, prefer its built-in styling APIs (antd's `token`/`className`/`styles` props, MUI's `sx`/`styled`/`theme`) over adding TailwindCSS classes
- Never add `tailwindcss` to a project that already uses a component library with its own CSS-in-JS solution unless the project-scan explicitly approves it
- If TailwindCSS is already present, use it consistently with the project's existing utility patterns; do not mix TailwindCSS utility classes with component-library `style` prop overrides on the same element

## Implementation completion gates

RD cannot mark a development slice complete until all of these are true. Each gate below maps to a hard verification gate in the Transition Verification Gates section — run the corresponding command, see the output.

0. the project-scan (`.peaks/<session-id>/rd/project-scan.md`) has been read and its component-library, CSS-framework, and build-tool findings have been applied — no implementation may start before this; **→ verified by Peaks-Cli Gate A**
0.5. NO wrong paths in tech-doc — every directory and file path has been verified with `ls` against the actual project; **→ verified by Peaks-Cli Gate A2**
0.6. CLAUDE.md and `.claude/rules/common/{coding-style,code-review,security}.md` exist in the project root; **→ verified by Peaks-Cli Gate A3**
1. OpenSpec change artifacts exist and are linked for non-trivial work when the target repo already has `openspec/`, or the user has approved adding it;
2. unit tests covering the new or changed behavior have been added or updated and run successfully; **→ verified by Peaks-Cli Gate B2**
3. if the repository is legacy and total UT coverage is below the project target, do not block on historical coverage, but require coverage evidence for newly added or changed code;
4. for frontend or UI-affecting slices, RD self-test has launched the app and used Playwright MCP for real browser end-to-end validation with visible-browser confirmation (install via `peaks mcp plan/apply --capability playwright-mcp.browser-validation --yes` if not yet present; navigate with `mcp__playwright__browser_navigate`, capture with `browser_snapshot` / `browser_take_screenshot` / `browser_console_messages` / `browser_network_requests`, sanitize route/actions and observations before retention, record acceptance result, close with `browser_close`); if login, CAPTCHA, SSO, or MFA appears, the headed browser is already visible — wait for the user to complete login and explicitly confirm completion before continuing;
5. code review has been performed with findings recorded and CRITICAL/HIGH issues fixed before progression; unresolved CRITICAL/HIGH findings only allow a blocked handoff; **→ verified by Peaks-Cli Gate B3** — evidence file must exist at `.peaks/<id>/rd/code-review.md`
6. security review has been performed for the changed surface, with CRITICAL/HIGH issues fixed before progression and particular attention to user input, file system access, external calls, auth, secrets, and dependency changes; **→ verified by Peaks-Cli Gate B4** — evidence file must exist at `.peaks/<id>/rd/security-review.md`
7. the post-check dry-run has passed and is linked in the handoff;
8. the tech-doc artifact (`.peaks/<session-id>/rd/tech-doc.md`) is written and linked from the request artifact. **→ verified by Peaks-Cli Gate B**
9. the RD request artifact body has no unfilled placeholders, TBD markers, or bare-bullet stubs (`peaks request lint <rid> --role rd`). **→ verified by Peaks-Cli Gate B5**
10. the declared `--type` is still consistent with the actual git diff (`peaks scan request-type-sanity --type <type>`). **→ verified by Peaks-Cli Gate B6**
11. the repair-cycle counter is below the cap before a repeat handoff (`peaks request repair-status <rid>`). **→ verified by Peaks-Cli Gate B7**
12. every changed file matches the RD red-line scope (no out-of-bounds writes); auto-allowed files (tests, .peaks artifacts) don't need an explicit pattern (`peaks scan diff-vs-scope --rid <rid>`). **→ verified by Peaks-Cli Gate B8**

If any gate fails, return to development for fixes or hand off as blocked. Do not describe the work as done, shippable, or ready for QA.

## Refactor hard gates

If a request is refactor, cleanup, architecture adjustment, module split, or technical debt work:

1. scan project structure and existing standards;
2. locate or run UT coverage;
3. block implementation unless coverage is >= 95%;
4. treat missing, unknown, or unverifiable coverage as failing;
5. generate intermediate artifacts before implementation;
6. call or consume peaks-prd and peaks-qa artifacts even in direct RD mode;
7. require strict slice spec before each slice;
8. require 100% acceptance for the slice;
9. require code changes and intermediate artifacts to be traceable in local `.peaks/<session-id>/` storage before continuing; commit or sync artifacts only when explicitly authorized.

## Unit-test coverage red line

The 100% coverage target on testable files is meaningful coverage, not a score to chase. RD must not write coverage-padding tests.

Rules:

1. If a missing line or branch is a **defensive guard for an unreachable case** (caller invariant, type system, upstream contract), remove the guard rather than write a test that fabricates the impossible. Simpler code beats higher line count.
2. If a missing line or branch is **IO / platform glue that cannot be tested cleanly** (real process spawn, homedir-default paths, registry side effects), add the file to `coverage.exclude` in `vitest.config.ts` with a one-line comment explaining why. This is the established Peaks-Cli pattern (`mcp-stdio-transport.ts`, `*-types.ts`, `doctor-service.ts`, `artifact-service.ts`, `workspace-service.ts`).
3. If a missing line or branch is **real behavior a caller relies on**, write the test — but frame the assertion around the user-visible behavior ("uses the wall clock when no clock is injected and writes a real timestamp into the artifact body"), not the implementation branch ("covers the `?? defaultClock` fallback"). A test that would only fail if someone deleted a single branch is a smell.
4. When the only way to reach 100% is to write a test that documents nothing a future maintainer would care about, the right answer is to **lower the target for that file via `coverage.exclude`** or to **simplify the production code to remove the dead branch**, never to write the padding test.
5. Test names must describe behavior, not coverage targets. Tests titled like "covers line 73" or "exercises the default factory branch" are red flags during code review and must be rewritten or deleted.

RD slice handoff must record the coverage verdict in the RD request artifact with one of:

- `pass: <percent>%, no exclusions added in this slice` — clean 100%
- `pass: <percent>%, added <file> to coverage.exclude — reason: <one-line>` — exclusion was the right call
- `blocked: <percent>% with no meaningful path to 100%` — escalate; do not write padding to clear the gate

## OpenSpec usage

For non-trivial RD changes, use OpenSpec when the project already has `openspec/` or the user approves adding OpenSpec. In repositories that already contain `openspec/`, missing OpenSpec change artifacts are a blocking pre-implementation issue, not an optional suggestion.

Create or update `openspec/changes/<change-id>/proposal.md`, `design.md`, `tasks.md`, and `specs/**/spec.md` before implementation slices begin. If the repository uses a different existing OpenSpec layout, follow that layout and record the file paths in the RD handoff.

OpenSpec artifacts are durable project specification files, not Peaks-Cli runtime swarm artifacts. They may live in the target repository root under `openspec/changes/...`. Swarm/runtime outputs such as task graphs, worker briefs, worker reports, reducer reports, scan reports, validation evidence, and compact handoffs must remain in the configured Peaks-Cli artifact workspace outside the target repository.

Peaks-Cli PRD/RD/QA gates remain authoritative: OpenSpec structures the durable spec, while Peaks-Cli artifacts still carry role handoffs, coverage gates, QA evidence, swarm coordination, and execution state.

## Mock data placement rules (BLOCKING — framework-aware)

When the project-scan in `.peaks/<id>/rd/project-scan.md` identifies a frontend framework, mock data MUST follow the framework's built-in mock mechanism. **Never write mock data inline in component files.**

### Framework-to-mock-directory mapping

| Project-scan finding | Mock location | Notes |
|---|---|---|
| Umi (`@umijs/max`, `.umirc.ts`) | `mock/*.ts` | Umi's built-in mock directory. Zero config, auto-reload. Write `export default { 'GET /api/...': (req, res) => { ... } }` |
| Next.js (`next.config.*`) | `__mocks__/` or MSW handlers | Match the project's existing pattern |
| Vite (`vite.config.*`) | `src/mock/` | Service-layer mock files with typed fixtures |
| CRA / Webpack | `src/__mocks__/` | Match the project's existing pattern |

### Hard rules

1. **Umi project → `mock/*.ts`**: If the project-scan says the build tool is Umi, mock data MUST go in the `mock/` directory at project root. This is Umi's built-in feature — it intercepts requests matching the defined path and method. Do NOT write `Promise.resolve(mockData)` in component files or service files for Umi projects.

2. **Never inline mock data in component files**: Mock data, fixture objects, and stub responses belong in dedicated mock files. Components should receive data through their normal channels (props, API calls via services). Writing `const mockData = [...]` inside a `.tsx` file is prohibited.

3. **Mock files must export TypeScript interfaces**: Every mock response type must be exported so RD implementation and QA test-cases can import the same contract. See peaks-solo's "Frontend-only development mode" for the full mock-to-real migration pattern.

4. **Every mock file must be marked**: Add `// MOCK: Replace with real API call when swagger.json is available` at the top of every mock file.

5. **Mock data must be realistic**: No `"test"`, `"foo"`, `"123"` values. Use plausible content that resembles production data.

### Verification gate (after mock creation)

```bash
# If project-scan detected Umi, verify mock/ directory was used
ls mock/*.ts 2>&1
# Expected: one or more .ts files in mock/
# "No such file" → BLOCKED. Umi projects must use mock/ directory.

# Verify no inline mock data in component files
grep -r "const mock\|mockData\|mock_data\|MOCK_DATA" src/ --include="*.tsx" --include="*.ts" -l 2>&1
# Expected: no matches (or only in dedicated mock files / test files)
# Any match in a component → BLOCKED. Move to mock/ (Umi) or src/mock/ (Vite).
```

## Frontend project generation

When RD work creates a frontend application and the user has not specified a technology stack, and the current scan plus existing project standards still do not establish a frontend stack, default to React + Vite + shadcn/ui with:

- `peaks shadcn init --preset [CODE] --template vite`

`[CODE]` is the preset code supplied by the shadcn registry or user workflow; if it is unknown, stop and resolve the intended preset before scaffolding.

If the user specifies a frontend stack or scaffold command, use the specified technology. If the scaffold emits JavaScript, convert generated application files to TypeScript before continuing; if conversion is not practical, ask for a TypeScript-compatible scaffold.

Application projects generated through this skill must not contain JavaScript source or config files. Generate TypeScript only (`.ts`, `.tsx`, and TypeScript config equivalents), including when adapting examples from libraries or templates.

## Artifact and standards output

When project identification or scanning produces reports, matrices, maps, plans, or validation files, write them under the configured Peaks-Cli artifact workspace. By default, use local non-git storage at `.peaks/<session-id>/rd/` in the target project or the Peaks-Cli CLI-provided local workspace. If the artifact workspace is unknown, create or request `.peaks/<session-id>/` before writing generated outputs. Use one session directory consistently so generated outputs stay grouped.

Do not default to a git-backed artifact repository, external artifact sync, or automatic commits for intermediate artifacts. Git inclusion or sync requires explicit user confirmation or an active profile that clearly authorizes it. Browser evidence must be sanitized before retention: do not store login URLs, cookies, headers, tokens, storage state, browser traces, or screenshots/logs containing PII or SSO/MFA material.

When project-local `CLAUDE.md` or project-local `.claude/rules/**` is created or updated, route the mutation through `peaks standards init` or `peaks standards update`; do not hand-write standards mutations. Derive the content from the current scan results and existing project standards. Keep only the rules that match the project's languages, frameworks, tooling, and repository layout. Do not emit generic templates, copy-pasted boilerplate, or rules unrelated to the current scan evidence. Do not update user-global `~/.claude/rules/**` from this workflow.

If the scan results are insufficient to justify a rule, leave it out or surface a review-only suggestion instead of writing it into project standards.

## Compact handoff

Before RD work stops, finishes, blocks, or hands off to another role, emit a short resumable capsule: mode, scope, coverage status, validated decisions, current slice, artifact paths, blockers, and next action. Link to scan reports, matrices, plans, and task graphs instead of restating them.

## External references

**Matt Pocock skills** (`diagnose`, `triage`, `tdd`, `improve-codebase-architecture`, `prototype`): Engineering references only. Inspect before applying; Peaks-Cli RD gates remain authoritative.

## Matt Pocock skills integration

Engineering methods from `mattpocock/skills` can inform RD work but never replace Peaks-Cli gates. Inspect upstream skill content before applying any method.

- `diagnose` — root-cause investigation before fixing
- `triage` — prioritize bug surface area
- `tdd` — drive implementation from failing tests
- `improve-codebase-architecture` — opportunistic refactor framing
- `prototype` — throwaway exploration before committing to a slice

These are references only; Peaks-Cli RD gates remain authoritative for handoff, acceptance, and slice closure.

**Understand Anything**: Consume via `peaks understand status/show --json`. Fall back to `peaks codegraph context` or local project scan when absent.

**Codegraph**: Optional local analysis via `peaks codegraph context/affected`. Output as untrusted supporting evidence; never commit `.codegraph/` artifacts.

## Codegraph project analysis

RD may use `peaks codegraph affected --project <path> <changed-files...> --json` as local project-analysis evidence to inform red-line scope boundaries before writing tech-doc or starting implementation. Treat the output as untrusted supporting evidence — verify against the actual code before relying on it.

Do not run upstream installer flows, mutate agent settings, or commit `.codegraph/` artifacts. Peaks-Cli RD gates remain authoritative for handoff and acceptance.

**Other external resources** (Context7, SearchCode, everything-claude-code, GitNexus, etc.): Use `peaks capabilities --source access-repo/mcp-server --json` for capability discovery before recommending. References only — do not execute upstream installers, do not install upstream resources, do not persist sensitive examples. Peaks-Cli RD gates remain authoritative.

**OpenSpec and MCP CLI**: Route through Peaks-Cli CLI (`peaks openspec show/to-rd/render`, `peaks mcp list/plan/apply/call`). Do not hand-edit `openspec/changes/**` or `~/.claude/settings.json`. Recipes: `references/openspec-mcp-cli.md`.

## Boundaries

Do not bypass PRD/QA artifacts. Do not install hooks, agents, MCP, or settings. Ask the Peaks-Cli CLI to handle runtime side effects.

Reference: `references/refactor-workflow.md`.
