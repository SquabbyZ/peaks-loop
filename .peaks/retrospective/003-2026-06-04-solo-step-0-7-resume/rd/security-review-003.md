# Security Review: 003-2026-06-04-solo-step-0-7-resume

- session: 2026-06-04-session-b60252
- rid: 003-2026-06-04-solo-step-0-7-resume
- type: refactor
- linked-rd: `.peaks/2026-06-04-session-b60252/rd/requests/003-2026-06-04-solo-step-0-7-resume.md`
- reviewer: security-reviewer (peaks-rd main-loop, full-auto profile)
- scope: `skills/peaks-solo/SKILL.md`, `tests/fixtures/skill-resume-mode-detect.sh`, `tests/unit/skill-resume-mode.test.ts`
- review date: 2026-06-04

## Summary

The slice adds a new `Step 0.7: Detect unfinished work and offer resume` sub-section to `skills/peaks-solo/SKILL.md`. The new step reads `.peaks/<sid>/{prd,rd,qa}/requests/*.md` files and classifies the session. Threat-model-wise, the only new code path is the new bash loop in the SKILL.md body, which is mirrored in `tests/fixtures/skill-resume-mode-detect.sh`. The read paths are computed from the trusted `<repo>/.peaks/.session.json` (which contains the session id) and walk into `.peaks/<sid>/` which is gitignored workspace state. **No new attack surface is introduced** for an honest repo. The one residual LOW finding covers: a malicious process with write access to the in-repo `.peaks/` dir could plant fake `state:` fields to influence the resume classification — but `.peaks/` is gitignored workspace state, and the malicious-write trust boundary is the same as the prior slice (peaks-solo/SKILL.md L124 already established that `.peaks/` lives at the repo root, in a gitignored dir, controlled only by the local user). The detection is advisory (it surfaces a resume option to the user via `AskUserQuestion`); the user must confirm before any state change. No CRITICAL, no HIGH, no MEDIUM.

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

None.

### LOW

- **L-1 (tests/fixtures/skill-resume-mode-detect.sh:30-46 — reads `.peaks/<sid>/` files that may be controlled by a malicious process)**
  The bash script reads `.peaks/<sid>/{prd,rd,qa}/requests/*.md` files to extract the `state:` field. A malicious process with write access to the in-repo `.peaks/` directory could plant fake `state:` fields (e.g., `- state: complete` in a directory with no actual slice artifacts) to influence the classification. **Attack surface analysis**:
  - Threat actor: a process with write access to the in-repo `.peaks/` directory. This is the same trust boundary required to plant a malicious `SKILL.md` or `.peaks/.session.json`, both of which would have higher-impact effects (the SKILL.md is loaded by the orchestrator; the session json binds the workspace).
  - Impact: the detection is advisory only — it surfaces a resume option to the user via `AskUserQuestion`, and the user must confirm before any state change. Even if the classification is wrong, the worst case is the user is asked to resume from a wrong gate, and they can pick "Start a fresh slice" instead.
  - Mitigation: `.peaks/` is gitignored workspace state (per `CLAUDE.md` and the peaks-solo skill's "Local intermediate artifact workspace" section). The trust boundary is the local user's filesystem permissions. A malicious process that has write access to the local filesystem has many higher-impact options than planting a fake `state:` field.
  - Recommendation: Out of scope for this slice. The detection is a deterministic, read-only probe; the result is surfaced to the user; the user must confirm. No code change required.

## Required Fixes

None. (No CRITICAL, HIGH, or MEDIUM findings.)

## Recommended

- **L-1** (out of scope): No action required. The trust boundary is documented in the SKILL.md; the detection is advisory; the user confirms before any state change.

## Verdict

**verdict: pass** (0 CRITICAL, 0 HIGH, 0 MEDIUM, 1 LOW; no fixes required)
