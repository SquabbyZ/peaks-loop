# Security Review: peaks-solo SKILL.md slim + references/ extraction

- session: 2026-06-04-session-b60252
- rid: 002-2026-06-04-solo-skill-slim-extract
- type: refactor
- linked-rd: .peaks/2026-06-04-session-b60252/rd/requests/002-2026-06-04-solo-skill-slim-extract.md
- reviewer: security-reviewer (peaks-rd main-loop, full-auto profile)
- scope: `skills/peaks-solo/SKILL.md`, `skills/peaks-solo/references/runbook.md`, `skills/peaks-solo/references/workflow-gates-and-types.md`, `src/services/skills/skill-runbook-service.ts`, `tests/unit/doctor.test.ts`, `tests/unit/skill-default-runbook.test.ts`
- review date: 2026-06-04

## Summary

The refactor extracts two reference blocks from `peaks-solo/SKILL.md` to sibling files under `references/`, and adds a new `loadRunbookSection(skillPath, body)` helper in `src/services/skills/skill-runbook-service.ts` that prefers the longer of (a) the inline `## Default runbook` section in `SKILL.md`, (b) the same section in `references/runbook.md`. The two test files that read `peaks-solo/SKILL.md` for runbook self-checks now fall back to `references/runbook.md` if the inline section is just a pointer. Threat-model-wise, the only new code path is the new `readText(referencePath)` call in `loadRunbookSection` (one line, called once per `inspectSkillRunbook` invocation). The path is computed from the trusted `dirname(skillPath)` returned by `loadSkillRegistry`, which enumerates the in-repo `skills/` directory; the reference file is expected to be a static, human-authored markdown file. **No new attack surface is introduced** for an honest repo. The two residual LOW findings cover: (1) a malicious package could place a fake `references/runbook.md` in the skills dir to influence the runbook inspection output — but the registry trust boundary already requires write access to the in-repo `skills/` dir, which is the same trust boundary required to plant a malicious `SKILL.md`, and the inspection output is consumed only by `peaks skill runbook <name> --json` for human review (no exec, no shell injection, no file write); (2) the bare `catch` in `loadRunbookSection` could mask real I/O errors — but the helper's contract is "the reference is optional; silently fall through to the inline section if reading fails", and the cost of a missed error is "we return the inline section or `null`", both of which are valid behaviors. No CRITICAL, no HIGH, no MEDIUM.

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

None.

### LOW

- **L-1 (src/services/skills/skill-runbook-service.ts:47-60 — new read of a less-trusted path)**
  The new `loadRunbookSection` helper reads `<skills-dir>/<skill-name>/references/runbook.md` for every `inspectSkillRunbook` call. The path is computed from the trusted `dirname(skill.skillPath)` returned by `loadSkillRegistry`, which enumerates the in-repo `skills/` directory. A malicious package that has write access to the in-repo `skills/` directory could place a fake `references/runbook.md` to influence the runbook inspection output. **Attack surface analysis**:
  - Threat actor: a process with write access to the in-repo `skills/` directory. This is the same trust boundary required to plant a malicious `SKILL.md`, which would be picked up by `loadSkillRegistry` and execute arbitrary JavaScript at module-load time (a much higher-impact attack than influencing a JSON inspection output).
  - Impact: the inspection output is a JSON envelope containing the runbook's `peaksCommandLines`, `destructiveApplyLines`, and `hasAuthorizationNote` flags. The consumer of this output is `peaks skill runbook <name> --json` (a human-review tool) and the `ok` flag (used by the `audit:` self-checks in `tests/unit/doctor.test.ts` and `tests/unit/skill-default-runbook.test.ts`). Neither consumer executes the runbook content; both consume the metadata.
  - Mitigation: the existing trust boundary is `loadSkillRegistry`, which is the in-repo `skills/` directory enumeration. The new `references/runbook.md` read uses the same boundary. No new attack surface is added beyond what already exists for the in-repo `SKILL.md` files.
  - Recommendation: document the trust boundary in the JSDoc. The current JSDoc says "This supports skills (notably `peaks-solo`)..." but does not mention that the reference is implicitly trusted the same way as the skill body. One-line addition.
  File: `src/services/skills/skill-runbook-service.ts:32-46`

- **L-2 (src/services/skills/skill-runbook-service.ts:50-56 — bare `catch` swallows all I/O errors)**
  The new `loadRunbookSection` helper uses a bare `try { ... } catch {}` to swallow all errors when reading `references/runbook.md`. Defensive: the reference is optional, ENOENT (file missing) and EACCES (permission denied) both should silently fall through to the inline section. The bare `catch` could mask real I/O errors (e.g. EIO from a disk fault, EMFILE from a fd exhaustion) but the cost of those errors is "we return the inline section if it exists, or `null` if it doesn't" — both of which are valid behaviors. Could be tightened to narrow the catch to ENOENT/EACCES and re-throw others, but the cost/benefit is low (the failure mode is at worst a silent degradation to inline-only behavior, which is the same as pre-refactor).
  File: `src/services/skills/skill-runbook-service.ts:50-56`

## Required Fixes

None. (No CRITICAL, HIGH, or MEDIUM findings.)

## Recommended

- **L-1** (optional): Add a one-line note to the JSDoc on `loadRunbookSection` stating that `references/runbook.md` is implicitly trusted the same way as the skill body (both enumerated by `loadSkillRegistry`).
- **L-2** (optional): Narrow the `catch` to ENOENT/EACCES and re-throw other errors. Low priority — the current broad catch is documented and the failure mode is benign.

## Verdict

**verdict: pass** (0 CRITICAL, 0 HIGH, 0 MEDIUM, 2 LOW; no fixes required)
