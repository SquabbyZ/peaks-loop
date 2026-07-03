# Peaks-Loop Default Runbook (orchestrator, full-auto profile)

> **Maintenance**: The numbered workflow list in `skills/peaks-solo/SKILL.md` (steps 0-11) is the canonical phase sequence. This runbook is the executable CLI transcription. When updating, keep both in lockstep — a change to one must be reflected in the other.
>
> **Why this is a reference, not inline**: the runbook is a stable, copy-pasteable shell (~150 lines of bash) that does not change between skill runs. Inlining it bloats the orchestrator skill body past the 800-line cap (per `common/coding-style.md`). Extracting it here keeps SKILL.md focused on flow / decisions / contracts, while the runbook stays as the canonical place for the CLI sequence.
>
> **How peaks-loop tooling reads this file**:
> - `peaks skill runbook peaks-solo` (CLI) reads the `## Default runbook` section in either SKILL.md or `references/runbook.md` (whichever has the bash code).
> - The test in `tests/unit/skill-default-runbook.test.ts` looks for `## Default runbook` in SKILL.md first, then falls back to `references/runbook.md` here.

## Default runbook — CLI sequence

The end-to-end CLI sequence for the `full-auto` profile. `assisted` and `strict` profiles pause at `[CONFIRM]` markers below. `full-auto` and `swarm` auto-proceed through all gates. See Transition Gates for artifact verification at each stage.

Canonical single-shot sub-agent dispatch (the `--prompt` flag is required):

```bash
peaks sub-agent dispatch <role> --prompt "<body>" --request-id <rid> --batch-id <uuid> --json
```

```bash
# 0. Peaks-Loop Snapshot + 0.5 Peaks-Loop Workspace + 0.6 Peaks-Loop Project scan + 0.7 Peaks-Loop Existing-system extraction
peaks doctor --json
peaks project dashboard --project <repo> --json
peaks skill runbook peaks-solo --json
peaks workspace init --project <repo> --json
peaks workspace reconcile --project <repo> --json
peaks scan archetype --project <repo> --json
# → copy archetype, frontendOnly, signals into .peaks/_runtime/<session-id>/rd/project-scan.md (Peaks-Loop Gate A)
# → copy libraries[] into .peaks/_runtime/<session-id>/rd/project-scan.md under `## Library versions`
peaks scan libraries --project <repo> --json
# → if archetype != greenfield AND archetype != unknown:
peaks scan existing-system --project <repo> --json
# → copy tokens, sources, conventions, inconsistencies into .peaks/_runtime/<session-id>/system/existing-system.md (Peaks-Loop Gate A.5)

# 1. Peaks-Loop Standards preflight + apply
#    Run dry-run first to inspect deltas, then APPLY. In full-auto and swarm modes,
#    --apply is the default — Standards files (CLAUDE.md, .claude/rules/**) live INSIDE
#    the target project and are required for downstream skill preflight, so producing
#    them is part of completing the workflow. Assisted/Strict modes pause for [CONFIRM]
#    between dry-run and apply.
peaks standards init   --project <repo> --dry-run --json
# or: peaks standards update --project <repo> --dry-run --json
peaks standards init   --project <repo> --apply --json
# or: peaks standards update --project <repo> --apply --json
# After apply, verify the files actually exist on disk (see Peaks-Loop Gate G).

# 2. Peaks-Loop PRD (Assisted/Strict: [CONFIRM] before confirmed-by-user)
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

# 3. Peaks-Loop Default sub-agent fan-out (slice 5 contract)
#    Solo computes the swarm plan from --type + frontendOnly + frontend-keyword scan,
#    writes it to .peaks/_runtime/<sid>/sc/swarm-plan.json, then writes the slice
#    DAG to .peaks/_runtime/<sid>/sc/slice-dag.json and launches ONE
#    `peaks sub-agent dispatch --from-dag <dag-file>` call. The CLI's
#    envelope.dispatchCount is N (not 1) when the DAG has >= 2 leaves at the
#    same topological level — that is the canonical "fan-out" signal. The
#    orchestrator emits N parallel `buildToolCall` descriptors in ONE response;
#    the LLM-side runner executes them concurrently.
#    See "Peaks-Loop Default sub-agent fan-out" above for the default rule and
#    exceptions; the gate logic is single-sourced in references/swarm-dispatch-contract.md.
#    Hard rule: do NOT call Skill(skill="peaks-rd" | "peaks-qa" | "peaks-ui") from
#    the Swarm phase — that's the v1.x anti-pattern. And do NOT issue N sequential
#    `peaks sub-agent dispatch <role>` calls in N separate messages when a fan-out
#    shape exists — `--from-dag` is the only path that exercises the orchestrator.
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
# 3b. Solo writes the slice DAG to a JSON file then issues ONE
#     `peaks sub-agent dispatch --from-dag <dag-file> --batch-id <id>` call.
#     The CLI envelope returns N parallel buildToolCall descriptors
#     (dispatchCount = len(swarm-plan.subAgents) when the DAG has >= 2
#     same-level leaves; 1 otherwise). Each prompt embeds the role's body
#     minus Step 0 / presence, plus the runtime args (rid / sid / mode /
#     type / paths). The orchestrator's Promise.all drives the N leaves
#     concurrently, so wall-time approximates max(per-leaf time), not sum.
peaks sc build-dag --change-id <cid> --project <repo> --json > .peaks/_runtime/<sid>/sc/slice-dag.json
peaks sub-agent dispatch --from-dag .peaks/_runtime/<sid>/sc/slice-dag.json --batch-id <id> --project <repo> --json
# 3c. After fan-out, Solo restores presence once and runs Gate B (ls checks):
peaks skill presence:set peaks-solo --project <repo> --mode <mode> --gate swarm-converged
ls .peaks/_runtime/<sid>/prd/requests/<rid>.md                # PRD artefact must exist (Gate B hard)
# feature / refactor → ls .peaks/_runtime/<sid>/rd/tech-doc.md
# bugfix             → ls .peaks/_runtime/<sid>/rd/bug-analysis.md
ls .peaks/_runtime/<sid>/qa/test-cases/<rid>.md                # QA test-cases (skipped for docs|chore)
# ui (only when in plan):
ls .peaks/_runtime/<sid>/ui/design-draft.md 2>&1               # non-blocking (Gate B info)
# Apply the degradation rules in the main SKILL.md if any artefact is missing.
# → Peaks-Loop Gate B convergence check. Assisted/Strict: [CONFIRM]

# 4. Peaks-Loop RD planning artifact (the file required by the prerequisite gate)
#    feature / refactor → write .peaks/_runtime/<id>/rd/tech-doc.md
#    bugfix             → write .peaks/_runtime/<id>/rd/bug-analysis.md
#    config             → no planning artifact required at this state
#    docs / chore       → no planning artifact required
peaks request transition <rid> --role rd --state implemented --project <repo> --json

# 5. Peaks-Loop Code review + security review BEFORE qa-handoff transition.
#    Produce the evidence files the CLI gate enforces:
#      - .peaks/_runtime/<id>/rd/code-review.md     (CRITICAL/HIGH findings + fixes; required for feature/bugfix/refactor)
#      - .peaks/_runtime/<id>/rd/security-review.md (required for feature/bugfix/refactor/config)
#    Then transition. If --type is docs/chore the gate is empty and the transition is unguarded.
peaks request transition <rid> --role rd --state qa-handoff --project <repo> --json

# 6. Peaks-Loop QA validation (AUTO-PROCEED from RD in full-auto)
#    Before each QA transition, produce the evidence files the CLI gate enforces:
#      Before qa:running        → .peaks/_runtime/<id>/qa/test-cases/<rid>.md
peaks request transition <rid> --role qa --state running --project <repo> --json
#      Before qa:verdict-issued → .peaks/_runtime/<id>/qa/test-reports/<rid>.md
#                                 + .peaks/_runtime/<id>/qa/security-findings.md
#                                 + .peaks/_runtime/<id>/qa/performance-findings.md (feature/refactor only)
peaks request transition <rid> --role qa --state verdict-issued --project <repo> --json
# → Peaks-Loop Gate D check. Assisted/Strict: [CONFIRM]

# 7. Peaks-Loop RD↔QA repair loop — if verdict is return-to-rd, re-run 4 through 6 until QA passes or blocked TXT.
#    Before invoking peaks-rd again, check the cycle count so you don't blow past the cap silently:
peaks request repair-status <rid> --project <repo> --json
# → atCap=true → STOP and emit a blocked TXT handoff. Do NOT enter another cycle.
# → remaining > 0 → safe to continue. The next transition's --reason must include "QA return-to-rd cycle N: ..."
#                   so this command keeps counting accurately.
# After RD finishes the repair, re-check that the diff is still consistent with the declared --type:
peaks scan request-type-sanity --project <repo> --type <type> --json
# → consistent=false → RD scope-creeped during repair; review before re-handoff.

# 8. Peaks-Loop SC phase
peaks sc impact --change-id <cid> --module <module> --file <path> --json
peaks sc retention --slice-id <rid> --prd <prd> --rd <rd> --qa <qa> --json
peaks sc validate --slice-id <rid> --json
peaks sc boundary --slice-id <rid> --artifact <artifact> --code <file> --json

# 9. Peaks-Loop OpenSpec archive (exit gate; only after QA pass, when openspec/ exists)
peaks openspec validate <cid> --project <repo> --json
peaks openspec archive <cid> --project <repo> --apply --json
peaks workspace reconcile --project <repo> --apply --older-than 7

# 10. Peaks-Loop TXT handoff — invoke peaks-txt which embeds memory markers (BLOCKING)
#     peaks-txt writes the handoff capsule to .peaks/_runtime/<id>/txt/handoff.md. Inside the
#     capsule body, peaks-txt embeds <!-- peaks-memory:start --> blocks for every
#     stable project fact surfaced this session. Applies to ALL modes including
#     `assisted` (audit 2026-07-03 found `assisted` previously skipped this step).
#
# 10a. Skill-side scan (do this BEFORE the AskUserQuestion below):
#      grep -n "peaks-memory:start" .peaks/_runtime/<id>/txt/handoff.md
#      Record the count. This is the skill doing the work, not a CLI command —
#      we deliberately do not ship a `peaks memory scan` because the LLM is
#      the only consumer and the LLM has grep.

# 10b. AskUserQuestion (only if 10a returned count >= 1):
#      "The TXT handoff has N peaks-memory:start blocks. Persist to .peaks/memory/?
#       (a) Apply all — `peaks memory extract --project <repo>
#                            --artifact .peaks/_runtime/<id>/txt/handoff.md --apply --json`
#       (b) Apply selectively — re-edit handoff.md first, then re-apply
#       (c) Skip for now — blocks stay in the handoff only, no .peaks/memory/ write"
#      If 10a returned 0 AND the session surfaced a stable project fact
#      (decision / convention / approved refactor), STOP — peaks-txt must go
#      back and embed at least one block before Solo can advance.

# 10c. After the user picks (a) or (b), run:
peaks memory extract --project <repo> --artifact .peaks/_runtime/<id>/txt/handoff.md --apply --json
#      --apply is REQUIRED to write .peaks/memory/; without it the command only
#      previews. The extract regenerates index.json in the same call.

# 11. Peaks-Loop Final snapshot
peaks project dashboard --project <repo> --json
peaks skill doctor --json
```

Repair loop details: see `## Mandatory RD QA repair loop` in SKILL.md for the full 5-step procedure and the 3-cycle cap. Append transition notes via `--reason` rather than rewriting artifacts during repair cycles.

```bash

# Peaks-Loop Default runbook — Job path (excerpt; full flow in references/job-loop.md)

# Step 0.8 (BLOCKING): LLM judges Job-shape, CLI records it.
# This is a RECORDER, not a detector. The LLM supplies --is-job + --rationale;
# the CLI writes .peaks/_runtime/<sid>/job-shape.json. Downstream steps call
# `peaks solo read-job-shape` to enforce the decision exists.

# (The LLM does the semantic judgement, e.g.:)
#   "The user named N=35 parallel app/ subdirs, said 'continue until all done',
#    and disavowed cost. isJob=true, rationale=..., suggestedJobId=app-ut-batch,
#    suggestedStrategy=rotating, confidence=high."
peaks solo detect-job \
  --is-job true \
  --rationale "35 parallel app/ subdirs + 'until all done' + '不用考虑费用'" \
  --suggested-job-id app-ut-batch \
  --suggested-strategy rotating \
  --confidence high

# Step 0.81-init: if Job-shaped, init BEFORE Step 1.
DECISION=$(peaks solo read-job-shape --json)
if [ "$(echo "$DECISION" | jq -r '.data.decision.isJob')" = "true" ]; then
  JID=$(echo "$DECISION" | jq -r '.data.decision.suggestedJobId')
  STRATEGY=$(echo "$DECISION" | jq -r '.data.decision.suggestedStrategy')
  # LLM-derived slice list (not CLI-derived).
  peaks job init --job-id "$JID" --slice-list "<LLM_DERIVED>" --main-loop-strategy "$STRATEGY" --rotate-every 3 --json
fi

# After Step 7 (RD+QA commit) lands AND Step 0.8 fired (state.json exists):
peaks job checkpoint --slice-id <rid> --state done --commit-sha $(git rev-parse HEAD)
# v3.1.2: `peaks job checkpoint --state done` ALSO writes
# .peaks/_runtime/<sid>/job/<jid>/progress.json. Read it on resume:
peaks job progress --job-id <jid> --json
peaks job status --job-id <jid> --json
peaks job subagent-cleanup --job-id <jid> --batch-id <bid> --force   # Step 0.87 gate
# Loop control:
#   remaining > 0  → return to Step 1 (next slice)
#   remaining == 0 → Step 8/9/10/11 (original tail)
#   blocked (strict) → peaks job block + STOP
# Rotating-mode: every rotateEvery slices → Step 0.86 (peaks session rotate + resume)

# v3.1.2 size-fear ban: refuse to emit a final handoff while remaining > 0.
# The LLM cannot bypass this; --force-under-job requires explicit user approval.
peaks solo emit-handoff --project <repo> --job-id <jid> --json

# v3.1.2 forced auto-compact: when --enforce-job-mode is set OR
# job-shape.json says isJob=true, ≥0.85 is MANDATORY auto-compact.
# Solo MUST call this without confirmation under Job mode.
peaks solo context-now --project <repo> --enforce-job-mode --json
peaks session auto-compact --execute --project <repo> --json

# v3.1.2 PreToolUse gate (installed by `peaks workspace init`):
# every Bash tool call runs `peaks solo gate-step-08` automatically.
# Exit 0 = allow (with optional Next: slice #N+1 of M line when
# progress.json exists). Exit 2 = BLOCKED; LLM must call
# `peaks solo detect-job` first.
peaks solo gate-step-08 --project <repo> --json
```
