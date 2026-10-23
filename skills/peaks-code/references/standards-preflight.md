# Project standards preflight

> Body of `## Peaks-Loop Project standards preflight`. Before orchestrating an end-to-end code repository workflow, gather the project standards preflight status from RD and QA by calling the Peaks-Loop CLI:

- `peaks standards init --project <path> --dry-run`
- `peaks standards update --project <path> --dry-run`

Use `standards init` for first-time creation and `standards update` for the existing **body** file (`AGENTS.md`) append/review behavior. The bundle the CLI writes has three parts: the **body** `AGENTS.md` (always written), the **pointer** `CLAUDE.md` (written only when the IDE profile needs it — a profile that reads `AGENTS.md` directly, e.g. `--ide codex`, writes no pointer), and the **rules tree** under `.peaks/standards/**` (2.0 canonical layout) or `.claude/rules/**` (legacy 1.x project that still carries a thick `.claude/rules/` tree). In `full-auto` and `24h` profiles, `--apply` runs automatically after `--dry-run` succeeds — these files live inside the target project, are required for downstream skill preflight, and producing them is part of finishing the workflow (Peaks-Loop Gate G enforces this). `assisted` and `strict` profiles pause for explicit user confirmation between dry-run and apply.

**CRITICAL — Standards must reflect the project scan.** When generating or updating the standards bundle, the content must reference concrete findings from `.peaks/project-scan/project-scan.md`: the detected component library (e.g. "This project uses antd 5.x"), CSS solution (e.g. "Uses Less via Umi"), build tool, state management, and routing. Those findings belong in the rules-tree files under the project's rules root (`.peaks/standards/**` for the 2.0 layout, `.claude/rules/**` for a legacy 1.x project); the body file `AGENTS.md` carries the command list and points at those files, and `CLAUDE.md` is only the `@AGENTS.md` pointer. Never emit a generic template that says "read <rules-root>/..." without naming the actual project stack. If the project-scan has not been run yet, run it before standards init/update.

**Legacy projects additionally** — when archetype ∈ {legacy-frontend, legacy-fullstack, frontend-monorepo}, the standards content MUST extract concrete naming, directory, service-layer, and hooks conventions from `.peaks/_runtime/<sessionId>/system/existing-system.md` and record them as hard constraints for new code. It must also list the `## Legacy constraints` from `project-scan.md` (class components, moment, enzyme, etc.) and instruct that new code in the same module preserves those patterns unless PRD explicitly authorizes modernization. A standards bundle for a legacy project that contains only generic rule pointers without naming the actual conventions is a blocking violation — regenerate it.

Do not hand-write standards file mutations inside the skill.

For project-analysis requests such as "分析项目" / "分析下这个项目", Step 0 still applies: the workspace is initialized and `peaks-code` presence is set before any analysis output. These requests run the lightweight analysis branch (project scan + standards dry-run) rather than the full RD/QA pipeline, but they never skip workspace anchoring or exit the workflow. The handoff must include an explicit **Standards increment** section. Report the current standards status from the dry-run output as incremental deltas, not just a generic preflight note:

- the body file (`AGENTS.md`): whether it is missing, existing, planned, skipped, appended, or review-only;
- the pointer file (`CLAUDE.md`), only when the IDE profile writes one — its absence is not a delta;
- which rules-tree files are planned, existing, or skipped, under whichever root the project uses (`.peaks/standards/**` for the 2.0 layout, `.claude/rules/**` for a legacy 1.x project) — the rules tree is presence-only in both commands; `appended` / `review` are body-file states;
- whether writes were applied or intentionally left as dry-run because authorization or scope was absent;
- the exact next action if standards should be applied later.

If the dry-run output lacks enough detail to explain those deltas, say that the standards increment is unknown and keep standards application blocked until another `peaks standards init/update --dry-run` provides evidence.