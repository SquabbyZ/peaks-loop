# Transition verification gates (QA)

> Body of `### Transition verification gates`. You cannot declare a phase complete from memory. Each gate below is a `ls` or `grep` command you **MUST run** and whose output you **MUST see** before proceeding. If any file shows "No such file" or any command returns empty, the phase is incomplete.

> **CLI enforcement (NEW)**: the gates below are now ALSO enforced by `peaks request transition`. The CLI checks the same files before allowing the transition and fails with `code: PREREQUISITES_MISSING` if any are absent. Required files depend on the request type recorded at `peaks request init --type ...`:

| Type | qa:running requires | qa:verdict-issued also requires |
|---|---|---|
| feature / refactor | `qa/test-cases/<rid>.md` | `qa/test-reports/<rid>.md` + `qa/security-findings.md` + `qa/performance-findings.md` |
| bugfix | `qa/test-cases/<rid>.md` (MUST include the regression test) | `qa/test-reports/<rid>.md` + `qa/security-findings.md` (perf optional unless the bug is performance-related) |
| config | (none) | `qa/security-findings.md` only |
| docs / chore | (none) | (none) |

For feature / refactor, `security-findings.md` and `performance-findings.md` MUST exist — record `"no findings"` inside if truly clean rather than skipping the file.

**Peaks-Cli Gate A — After test-case generation:**
```bash
ls .peaks/<changeId>/qa/test-cases/<rid>.md
# Expected: .peaks/<changeId>/qa/test-cases/<rid>.md
# "No such file" → STOP, generate test cases first.
```

**Peaks-Cli Gate A2 — After test execution: tests actually ran (CRITICAL):**
```bash
npx vitest run --changed --reporter=verbose 2>&1 | tail -30
# Expected: exit code 0, actual test output
# "0 tests executed" or "no test files found" → BLOCKED.
```

**Peaks-Cli Gate A3 — Security test executed (NOT just a checklist item):**
```bash
ls .peaks/<changeId>/qa/security-findings.md 2>&1
# Expected: .peaks/<changeId>/qa/security-findings.md
```

**Peaks-Cli Gate A4 — Performance test executed:**
```bash
ls .peaks/<changeId>/qa/performance-findings.md 2>&1
```

**Peaks-Cli Gate B — After test-report write (MUST contain execution results):**
```bash
ls .peaks/<changeId>/qa/test-reports/<rid>.md
grep -c "pass\|fail\|blocked" .peaks/<changeId>/qa/test-reports/<rid>.md
# Zero → the report is empty/template-only. Tests were not executed.
```

**Peaks-Cli Gate C — Before issuing verdict:**
```bash
ls .peaks/<changeId>/qa/test-cases/<rid>.md \
   .peaks/<changeId>/qa/test-reports/<rid>.md \
   .peaks/<changeId>/qa/security-findings.md \
   .peaks/<changeId>/qa/performance-findings.md \
   .peaks/<changeId>/qa/requests/<rid>.md
# All five must exist. Missing any → QA incomplete, verdict blocked.
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
ls .peaks/<changeId>/qa/screenshots/*.png 2>&1
# Expected: one or more .png files
# "No such file" → BLOCKED.
grep -c "browser_console_messages\|browser_network_requests" .peaks/<changeId>/qa/test-reports/<rid>.md
# Expected: non-zero count
```