# Peaks-Cli Default Runbook (orchestrator, full-auto profile)

> **Maintenance**: The numbered workflow list in `skills/peaks-solo/SKILL.md` (steps 0-11) is the canonical phase sequence. This runbook is the executable CLI transcription. When updating, keep both in lockstep — a change to one must be reflected in the other.
>
> **Why this is a reference, not inline**: the runbook is a stable, copy-pasteable shell (~150 lines of bash) that does not change between skill runs. Inlining it bloats the orchestrator skill body past the 800-line cap (per `common/coding-style.md`). Extracting it here keeps SKILL.md focused on flow / decisions / contracts, while the runbook stays as the canonical place for the CLI sequence.
>
> **How peaks-cli tooling reads this file**:
> - `peaks skill runbook peaks-solo` (CLI) reads the `## Default runbook` section in either SKILL.md or `references/runbook.md` (whichever has the bash code).
> - The test in `tests/unit/skill-default-runbook.test.ts` looks for `## Default runbook` in SKILL.md first, then falls back to `references/runbook.md` here.

## Default runbook

The end-to-end CLI sequence for the `full-auto` profile. `assisted` and `strict` profiles pause at `[CONFIRM]` markers below. `full-auto` and `swarm` auto-proceed through all gates. See Transition Gates for artifact verification at each stage.

```bash
# 0. Peaks-Cli Snapshot + 0.5 Peaks-Cli Workspace + 0.6 Peaks-Cli Project scan + 0.7 Peaks-Cli Existing-system extraction
peaks doctor --json
peaks project dashboard --project <repo> --json
peaks skill runbook peaks-solo --json
peaks workspace init --project <repo> --json
peaks workspace reconcile --project <repo> --json
peaks scan archetype --project <repo> --json
# → copy archetype, frontendOnly, signals into .peaks/<session-id>/rd/project-scan.md (Peaks-Cli Gate A)
# → copy libraries[] into .peaks/<session-id>/rd/project-scan.md under `## Library versions`
peaks scan libraries --project <repo> --json
# → if archetype != greenfield AND archetype != unknown:
peaks scan existing-system --project <repo> --json
# → copy tokens, sources, conventions, inconsistencies into .peaks/<session-id>/system/existing-system.md (Peaks-Cli Gate A.5)

# 1. Peaks-Cli Standards preflight + apply
#    Run dry-run first to inspect deltas, then APPLY. In full-auto and swarm modes,
#    --apply is the default — Standards files (CLAUDE.md, .claude/rules/**) live INSIDE
#    the target project and are required for downstream skill preflight, so producing
#    them is part of completing the workflow. Assisted/Strict modes pause for [CONFIRM]
#    between dry-run and apply.
peaks standards init   --project <repo> --dry-run --json
# or: peaks standards update --project <repo> --dry-run --json
peaks standards init   --project <repo> --apply --json
# or: peaks standards update --project <repo> --apply --json
# After apply, verify the files actually exist on disk (see Peaks-Cli Gate G).

# 2. Peaks-Cli PRD (Assisted/Strict: [CONFIRM] before confirmed-by-user)
# Classify the request type from the PRD: feature | bugfix | refactor | docs | config | chore
# This drives RD/QA gate strictness — see "Mandatory RD QA repair loop" for the matrix.
peaks request init --role prd --id <rid> --project <repo> --apply --type <type> --json
# Cross-verify the chosen --type against the current git diff (only meaningful if RD has started writing code;
# safe to run early too, just expect "no changes" rationale until code lands).
peaks scan request-type-sanity --project <repo> --type <type> --json
# → consistent=false → re-classify before continuing. consistent=true → proceed.
# Lint the PRD artifact before transitioning out of draft.
peaks request lint <rid> --role prd --project <repo> --json
# → ok=false → fill in <placeholders>, then re-run.
peaks request transition <rid> --role prd --state confirmed-by-user --project <repo> --json
peaks request transition <rid> --role prd --state handed-off --project <repo> --json

# 3. Peaks-Cli Swarm parallel — sub-agent fan-out (Task tool, NOT Skill tool)
#    Solo computes the swarm plan from --type + frontendOnly + frontend-keyword scan,
#    writes it to .peaks/<sid>/sc/swarm-plan.json, then launches one
#    Task(subagent_type="general-purpose", ...) call per sub-agent in the same message.
#    See "Peaks-Cli Swarm parallel phase" above for the full decision table and the
#    prompt template; the role's required artefact paths are listed there.
#    Hard rule: do NOT call Skill(skill="peaks-rd" | "peaks-qa" | "peaks-ui") from
#    the Swarm phase — that's the v1.x anti-pattern.
#
# 3a. Pre-fan-out: Solo initialises every role's request artefact slot in the main
#     loop so sub-agents find a stable rid <-> artefact binding. Each role's
#     sub-agent may also call peaks request init itself (idempotent on the same rid);
#     Solo's call here is the source of truth. Only init roles that are in the
#     swarm plan — roles not in the plan do not get a slot yet.
peaks skill presence:set peaks-solo --project <repo> --mode <mode> --gate swarm-fan-out
# for each role in swarm-plan.subAgents:
# peaks request init --role ui --id <rid> --project <repo> --apply --type <type> --json
# peaks request init --role rd --id <rid> --project <repo> --apply --type <type> --json
# peaks request init --role qa --id <rid> --project <repo> --apply --type <type> --json
# e.g. if plan = [ui, rd, qa]: run init for ui, rd, qa.
# If plan = [rd, qa]: run for rd, qa only.
# If plan = [] (config|docs|chore skip): no inits here, jump to step 4 directly.
# 3b. Solo issues N Task(subagent_type="general-purpose", ...) calls in ONE message
#     (N = len(swarm-plan.subAgents)). Each prompt embeds the role's body minus
#     Step 0 / presence, plus the runtime args (rid / sid / mode / type / paths).
# 3c. After fan-out, Solo restores presence once and runs Gate B (ls checks):
peaks skill presence:set peaks-solo --project <repo> --mode <mode> --gate swarm-converged
ls .peaks/<sid>/prd/requests/<rid>.md                # PRD artefact must exist (Gate B hard)
# feature / refactor → ls .peaks/<sid>/rd/tech-doc.md
# bugfix             → ls .peaks/<sid>/rd/bug-analysis.md
ls .peaks/<sid>/qa/test-cases/<rid>.md                # QA test-cases (skipped for docs|chore)
# ui (only when in plan):
ls .peaks/<sid>/ui/design-draft.md 2>&1               # non-blocking (Gate B info)
# Apply the degradation rules in the main SKILL.md if any artefact is missing.
# → Peaks-Cli Gate B convergence check. Assisted/Strict: [CONFIRM]

# 4. Peaks-Cli RD planning artifact (the file required by the prerequisite gate)
#    feature / refactor → write .peaks/<id>/rd/tech-doc.md
#    bugfix             → write .peaks/<id>/rd/bug-analysis.md
#    config             → no planning artifact required at this state
#    docs / chore       → no planning artifact required
peaks request transition <rid> --role rd --state implemented --project <repo> --json

# 5. Peaks-Cli Code review + security review BEFORE qa-handoff transition.
#    Produce the evidence files the CLI gate enforces:
#      - .peaks/<id>/rd/code-review.md     (CRITICAL/HIGH findings + fixes; required for feature/bugfix/refactor)
#      - .peaks/<id>/rd/security-review.md (required for feature/bugfix/refactor/config)
#    Then transition. If --type is docs/chore the gate is empty and the transition is unguarded.
peaks request transition <rid> --role rd --state qa-handoff --project <repo> --json

# 6. Peaks-Cli QA validation (AUTO-PROCEED from RD in full-auto)
#    Before each QA transition, produce the evidence files the CLI gate enforces:
#      Before qa:running        → .peaks/<id>/qa/test-cases/<rid>.md
peaks request transition <rid> --role qa --state running --project <repo> --json
#      Before qa:verdict-issued → .peaks/<id>/qa/test-reports/<rid>.md
#                                 + .peaks/<id>/qa/security-findings.md
#                                 + .peaks/<id>/qa/performance-findings.md (feature/refactor only)
peaks request transition <rid> --role qa --state verdict-issued --project <repo> --json
# → Peaks-Cli Gate D check. Assisted/Strict: [CONFIRM]

# 7. Peaks-Cli RD↔QA repair loop — if verdict is return-to-rd, re-run 4 through 6 until QA passes or blocked TXT.
#    Before invoking peaks-rd again, check the cycle count so you don't blow past the cap silently:
peaks request repair-status <rid> --project <repo> --json
# → atCap=true → STOP and emit a blocked TXT handoff. Do NOT enter another cycle.
# → remaining > 0 → safe to continue. The next transition's --reason must include "QA return-to-rd cycle N: ..."
#                   so this command keeps counting accurately.
# After RD finishes the repair, re-check that the diff is still consistent with the declared --type:
peaks scan request-type-sanity --project <repo> --type <type> --json
# → consistent=false → RD scope-creeped during repair; review before re-handoff.

# 8. Peaks-Cli SC phase
peaks sc impact --change-id <cid> --module <module> --file <path> --json
peaks sc retention --slice-id <rid> --prd <prd> --rd <rd> --qa <qa> --json
peaks sc validate --slice-id <rid> --json
peaks sc boundary --slice-id <rid> --artifact <artifact> --code <file> --json

# 9. Peaks-Cli OpenSpec archive (exit gate; only after QA pass, when openspec/ exists)
peaks openspec validate <cid> --project <repo> --json
peaks openspec archive <cid> --project <repo> --apply --json
peaks workspace reconcile --project <repo> --apply --older-than 7

# 10. Peaks-Cli TXT handoff — invoke peaks-txt which embeds memory markers and extracts
#     peaks-txt writes the handoff capsule to .peaks/<id>/txt/handoff.md. Inside the
#     capsule body, peaks-txt embeds <!-- peaks-memory:start --> blocks for every
#     stable project fact surfaced this session.
#
# 10a. Skill-side scan (do this BEFORE the AskUserQuestion below):
#      grep -n "peaks-memory:start" .peaks/<id>/txt/handoff.md
#      Record the count. This is the skill doing the work, not a CLI command —
#      we deliberately do not ship a `peaks memory scan` because the LLM is
#      the only consumer and the LLM has grep.

# 10b. AskUserQuestion (only if 10a returned count >= 1):
#      "The TXT handoff has N peaks-memory:start blocks. Persist to .peaks/memory/?
#       (a) Apply all — `peaks memory extract --project <repo>
#                            --artifact .peaks/<id>/txt/handoff.md --apply --json`
#       (b) Apply selectively — re-edit handoff.md first, then re-apply
#       (c) Skip for now — blocks stay in the handoff only, no .peaks/memory/ write"
#      If 10a returned 0 AND the session surfaced a stable project fact
#      (decision / convention / approved refactor), STOP — peaks-txt must go
#      back and embed at least one block before Solo can advance.

# 10c. After the user picks (a) or (b), run:
peaks memory extract --project <repo> --artifact .peaks/<id>/txt/handoff.md --apply --json
#      --apply is REQUIRED to write .peaks/memory/; without it the command only
#      previews. The extract regenerates index.json in the same call.

# 11. Peaks-Cli Final snapshot
peaks project dashboard --project <repo> --json
peaks skill doctor --json
```

Repair loop details: see `## Mandatory RD QA repair loop` in SKILL.md for the full 5-step procedure and the 3-cycle cap. Append transition notes via `--reason` rather than rewriting artifacts during repair cycles.
