---
name: peaks-solo-resume
description: Resume an in-flight peaks-solo slice in the current session. Use when the user says "continue the unfinished work", "继续完成", "把刚才没做完的收尾", or invokes `/peaks-solo-resume` directly. Detects the current session's deepest completed gate (via the Step 0.7 detection script at `tests/fixtures/skill-resume-mode-detect.sh`) and surfaces a resume option via `AskUserQuestion`. Triggers on `/peaks-solo-resume`, "继续完成刚才的", "resume the unfinished slice", "把刚才没做完的收尾".
---

# Peaks-Loop Solo Resume (wrapper)

Peaks-Loop Solo Resume is a thin wrapper that handles the **most common high-frequency request shape**: "I was in the middle of something, continue it." It detects the current session's deepest completed gate, surfaces a resume option, then yields to the main `peaks-solo` skill (which runs the actual workflow from the matching gate onwards).

**This is a transparent wrapper.** The user does not stay in this skill — once the resume option is confirmed, control hands off to `peaks-solo`. The wrapper exists only to (a) detect the in-flight slice without the LLM re-reading 3-5 artifact files, and (b) surface the resume option as a `AskUserQuestion` before the main loop skips ahead.

## Skill presence (MANDATORY first action)

```bash
peaks skill presence:set peaks-solo-resume --project <repo> --mode <mode> --gate startup
peaks project memories --project <repo> --json  # load durable memory
```

## Step 1: Detect the current session's in-flight slice

Use the Step 0.7 detection script (added in slice 003) to classify the current session:

```bash
# 1. Confirm the current session id
sid=$(cat .peaks/.session.json | python3 -c "import sys,json; print(json.load(sys.stdin)['sessionId'])")

# 2. Run the detection script
bash tests/fixtures/skill-resume-mode-detect.sh "$sid" .peaks
# Possible outputs: fresh | complete | resume:rd-planning | resume:qa-validation
#                  | resume:txt-handoff | in-flight:<state>
```

## Step 2: Branch on the detection

**If `fresh`**: no in-flight slice. Tell the user "No in-flight slice in this session." Then hand off to `peaks-solo` for a fresh start (set presence back, then run `peaks workspace init --project <repo> --json` and continue with Step 1 of `peaks-solo`).

**If `complete`**: the workflow is already done. Tell the user "This session is complete — your previous slice already shipped." Then suggest a fresh start (`peaks-solo`) or close-out.

**If `resume:<gate>`**: surface a resume option via `AskUserQuestion`:

| Option | What it does |
|---|---|
| Resume from `<gate>` (Recommended) | Hand off to `peaks-solo` with the gate already at the matching point. The main loop skips ahead; the existing artifacts are preserved as-is. |
| Start a fresh slice | Treat the current request as a new slice (new `rid`). Existing artifacts are preserved but not auto-resumed. |
| Abandon the in-flight slice | Mark the in-flight slice as `deferred` (`peaks request transition <rid> --role rd --state deferred --reason "user abandoned"`) and start fresh. |

**If `in-flight:<state>`**: the slice is mid-implementation. Surface a CONFIRM (not a resume):

> "The slice is mid-implementation (state: `<state>`). The only valid option is to resume the in-flight gate. Continue?"

Use `AskUserQuestion` with a single option (Confirm and resume from `<state>`). Do NOT auto-resume mid-implementation.

## Step 3: Hand off to peaks-solo

After the user confirms, **re-assert `peaks-solo` presence** so the status header reads correctly for the rest of the run:

```bash
peaks skill presence:set peaks-solo --project <repo> --mode <mode> --gate <matching-gate>
```

Then tell the user: "Resuming from `<gate>`. The main peaks-solo skill will take over from there." and yield control. The user's next message will land in the `peaks-solo` main loop, which will pick up the workflow from the matching gate.

## Hard rules (do NOT skip)

- **Never silently auto-resume.** Always use `AskUserQuestion` first. The detection is a discovery; the user's confirmation is the gate.
- **Never auto-resume mid-implementation.** For `in-flight:<state>`, the only valid option is "Confirm and resume from `<state>`" — never "Start a fresh slice" or "Abandon" without the user's explicit choice.
- **Never write code or modify files in this skill.** This is a wrapper. The actual work (PRD, RD, QA, SC, TXT) is the main `peaks-solo` skill's job.
- **Never add a new `peaks <cmd>`.** Use the existing CLI primitives: `peaks workspace init`, `peaks project dashboard`, `peaks session list`, `peaks skill runbook`, `peaks skill doctor`, `peaks scan archetype`, `peaks request transition`. The detection script (`tests/fixtures/skill-resume-mode-detect.sh`) is the only executable this skill invokes.

## Anti-patterns (do NOT do)

- Do NOT re-read 3-5 artifact files to determine the workflow state. The detection script does this in <1ms; re-reading is the bug Step 0.7 was added to prevent.
- Do NOT skip the `AskUserQuestion` even if the user says "just continue". The user might have changed their mind, or there might be multiple in-flight slices.
- Do NOT write to `.peaks/_runtime/<sid>/` files. This skill is read-only on the workspace; it only reads `.peaks/.session.json` + runs the detection script.
- Do NOT run `peaks workspace init` on a real session (would bind a new session id). Only run it on a fresh detection where no session exists.

## Cross-references

- The detection logic is canonical at `tests/fixtures/skill-resume-mode-detect.sh` (added in slice 003). The 8 vitest cases in `tests/unit/skill-resume-mode.test.ts` cover all classification outcomes.
- The SKILL.md prose at `skills/peaks-solo/SKILL.md` Step 0.7 (added in slice 003) is the same logic, written for LLM consumption. This wrapper reuses the same script — there is no parallel implementation.
- The "drives a CLI on the user's behalf" pattern (mirror of `peaks-sop`) is the closest existing precedent for this wrapper.
