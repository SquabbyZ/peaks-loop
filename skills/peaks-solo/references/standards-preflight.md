# Project standards preflight

> Body of `## Peaks-Cli Project standards preflight`. Before orchestrating an end-to-end code repository workflow, gather the project standards preflight status from RD and QA by calling the Peaks-Cli CLI:

- `peaks standards init --project <path> --dry-run`
- `peaks standards update --project <path> --dry-run`

Use `standards init` for first-time creation and `standards update` for existing `CLAUDE.md` append/review behavior. In `full-auto` and `swarm` profiles, `--apply` runs automatically after `--dry-run` succeeds — these files live inside the target project, are required for downstream skill preflight, and producing them is part of finishing the workflow (Peaks-Cli Gate G enforces this). `assisted` and `strict` profiles pause for explicit user confirmation between dry-run and apply.

**CRITICAL — Standards must reflect the project scan.** When generating or updating `CLAUDE.md`, the content must reference concrete findings from `.peaks/<changeId>/rd/project-scan.md`: the detected component library (e.g. "This project uses antd 5.x"), CSS solution (e.g. "Uses Less via Umi"), build tool, state management, and routing. Never emit a generic template that says "read .claude/rules/..." without naming the actual project stack. If the project-scan has not been run yet, run it before standards init/update.

**Legacy projects additionally** — when archetype ∈ {legacy-frontend, legacy-fullstack, frontend-monorepo}, the `CLAUDE.md` Conventions section MUST extract concrete naming, directory, service-layer, and hooks conventions from `.peaks/<changeId>/system/existing-system.md` and record them as hard constraints for new code. It must also list the `## Legacy constraints` from `project-scan.md` (class components, moment, enzyme, etc.) and instruct that new code in the same module preserves those patterns unless PRD explicitly authorizes modernization. A `CLAUDE.md` for a legacy project that contains only generic rule pointers without naming the actual conventions is a blocking violation — regenerate it.

Do not hand-write standards file mutations inside the skill.

For project-analysis requests such as "分析项目" / "分析下这个项目", Step 0 still applies: the workspace is initialized and `peaks-solo` presence is set before any analysis output. These requests run the lightweight analysis branch (project scan + standards dry-run) rather than the full RD/QA pipeline, but they never skip workspace anchoring or exit the workflow. The handoff must include an explicit **Standards increment** section. Report the current `CLAUDE.md` and `.claude/rules/**` status from the dry-run output as incremental deltas, not just a generic preflight note:

- whether `CLAUDE.md` is missing, existing, planned, skipped, appended, or review-only;
- which `.claude/rules/**` files are planned, existing, skipped, appended, or review-only;
- whether writes were applied or intentionally left as dry-run because authorization or scope was absent;
- the exact next action if standards should be applied later.

If the dry-run output lacks enough detail to explain those deltas, say that the standards increment is unknown and keep standards application blocked until another `peaks standards init/update --dry-run` provides evidence.