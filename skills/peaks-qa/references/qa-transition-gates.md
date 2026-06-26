# Transition verification gates (QA)

> Body of `### Transition verification gates`. You cannot declare a phase complete from memory. Each gate below is a `ls` or `grep` command you **MUST run** and whose output you **MUST see** before proceeding. If any file shows "No such file" or any command returns empty, the phase is incomplete.

> **CLI enforcement (v2.11.0 D1/D4 trim)**: the gates below are enforced by `peaks request transition`. The CLI checks the same files before allowing the transition and fails with `code: PREREQUISITES_MISSING` if any are absent. Required files depend on the request type recorded at `peaks request init --type ...`. **As of v2.11.0:** peaks-qa does NOT own security-findings or performance-findings — those are produced by peaks-rd's audit fan-out as `rd/security-review.md` and `rd/perf-baseline.md` and are referenced from the QA test report rather than required as separate files.

| Type | qa:running requires | qa:verdict-issued also requires |
|---|---|---|
| feature / refactor | `qa/test-cases/<rid>.md` | `qa/test-reports/<rid>.md` |
| bugfix | `qa/test-cases/<rid>.md` (MUST include the regression test) | `qa/test-reports/<rid>.md` |
| config | (none) | `qa/test-reports/<rid>.md` |
| docs / chore | (none) | (none) |

Security and performance evidence surface under `rd/security-review.md` and `rd/perf-baseline.md` (peaks-rd's audit fan-out) and are referenced by reference from the QA test report body. The pre-v2.11.0 `qa/security-findings.md` / `qa/performance-findings.md` files are no longer required; existing ones are kept for auditability but ignored by the gate.

**Peaks-Cli Gate A — After test-case generation:**
```bash
ls .peaks/_runtime/change/<changeId>/qa/test-cases/<rid>.md
# Expected: .peaks/_runtime/change/<changeId>/qa/test-cases/<rid>.md
# "No such file" → STOP, generate test cases first.
```

**Peaks-Cli Gate A2 — After test execution: tests actually ran (CRITICAL):**
```bash
npx vitest run --changed --reporter=verbose 2>&1 | tail -30
# Expected: exit code 0, actual test output
# "0 tests executed" or "no test files found" → BLOCKED.
```

**Peaks-Cli Gate A3 — Security review referenced (v2.11.0 D1/D4: read-only reference, NOT a separate QA file):**
```bash
# peaks-qa does NOT own a qa/security-findings.md. peaks-rd's audit fan-out
# produces rd/security-review.md; QA references it by path in the test report body.
grep -E "rd/security-review\\.md|security-review" .peaks/_runtime/<sessionId>/qa/test-reports/<rid>.md 2>&1
# Expected: at least one reference to the rd-side security review.
# Empty → BLOCKED: the test report must cite where security evidence lives.
```

**Peaks-Cli Gate A4 — Performance baseline referenced (v2.11.0 D1/D4: read-only reference, NOT a separate QA file):**
```bash
# peaks-qa does NOT own a qa/performance-findings.md. peaks-rd's audit fan-out
# produces rd/perf-baseline.md; QA references it by path in the test report body.
grep -E "rd/perf-baseline\\.md|perf-baseline" .peaks/_runtime/<sessionId>/qa/test-reports/<rid>.md 2>&1
# Expected: at least one reference to the rd-side perf baseline.
# Empty → BLOCKED: the test report must cite where perf evidence lives.
```

**Peaks-Cli Gate B — After test-report write (MUST contain execution results):**
```bash
ls .peaks/_runtime/change/<changeId>/qa/test-reports/<rid>.md
grep -c "pass\|fail\|blocked" .peaks/_runtime/change/<changeId>/qa/test-reports/<rid>.md
# Zero → the report is empty/template-only. Tests were not executed.
```

**Peaks-Cli Gate C — Before issuing verdict:**
```bash
ls .peaks/_runtime/change/<changeId>/qa/test-cases/<rid>.md \
   .peaks/_runtime/change/<changeId>/qa/test-reports/<rid>.md \
   .peaks/_runtime/change/<changeId>/qa/requests/<rid>.md
# All three must exist. Missing any → QA incomplete, verdict blocked.
# Security + perf evidence live under rd/ (peaks-rd's audit fan-out);
# QA cites them by reference from the test-report body (see Gates A3/A4).
```

**Peaks-Cli Gate E — Acceptance coverage:**
```bash
peaks scan acceptance-coverage --rid <rid> --project <repo> --session-id <session-id> --json
# Expected: ok=true. exit 0.
# uncovered[] non-empty → BLOCKED. Add `- **Acceptance:** A<N>` lines to test cases.
# invalidReferences[] non-empty → BLOCKED.
```

**Peaks-Cli Gate F — QA artifact body has no unfilled placeholders:**
```bash
peaks request lint <rid> --role qa --project <repo> --session-id <session-id> --json
# Expected: ok=true. exit 0.
```

**Peaks-Cli Gate D — Frontend browser evidence (BLOCKING when frontend is in scope):**
```bash
ls .peaks/_runtime/change/<changeId>/qa/screenshots/*.png 2>&1
# Expected: one or more .png files
# "No such file" → BLOCKED.
grep -c "browser_console_messages\|browser_network_requests" .peaks/_runtime/change/<changeId>/qa/test-reports/<rid>.md
# Expected: non-zero count
```