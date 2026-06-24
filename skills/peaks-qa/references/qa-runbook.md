## Default runbook (QA)

> Body of `## Default runbook` + numbered runbook steps #0–#9. The default sequence the QA skill should execute. Do not skip the boundary check, the unit test gate, the validation report, or — when frontend is in scope — the Playwright MCP browser gate.

```bash
# 0. confirm QA's own runbook integrity before validating anything
peaks skill runbook peaks-qa --json
peaks skill presence:set peaks-qa --project <repo>  # show persistent skill presence every turn

# 1. capture the QA request artifact and read upstream scope
peaks request init --role qa --id <request-id> --project <repo> --apply --json
peaks request show <request-id> --role prd --project <repo> --json
peaks request show <request-id> --role rd  --project <repo> --json
peaks request show <request-id> --role ui  --project <repo> --json   # if UI involved

# 2. standards preflight and red-line boundary check against the diff
peaks standards init   --project <repo> --dry-run --json
peaks standards update --project <repo> --dry-run --json
peaks codegraph affected --project <repo> <changed-files...> --json   # regression-surface hint

# 3. OpenSpec exit gate when openspec/ exists
peaks openspec validate <change-id> --project <repo> --json
peaks openspec validate <change-id> --project <repo> --prefer-external --json   # optional

# 4. generate test cases — MANDATORY, write to .peaks/_runtime/<sessionId>/qa/test-cases/<request-id>.md
#    categories: unit, integration, UI regression (frontend only)
#
#    Optimization (slice 004): peaks-rd's parallel fan-out now includes a 4th
#    sub-agent (`qa-test-cases-writer`) that pre-drafts this file at the
#    end of RD implementation. If `.peaks/_runtime/<sessionId>/qa/test-cases/<rid>.md`
#    already exists when QA's main loop reaches this step, **QA does NOT
#    re-draft it** — it just verifies the file is present and the
#    per-criterion `ts` snippets are syntactically valid, then proceeds
#    to step 5 (EXECUTE). Fallback: if the file is missing, QA drafts it inline.

# 5. EXECUTE tests against the actual implementation — Peaks-Cli Gate A2
#    Run the project test command. Record output. Tests on paper are worthless.
#    Peaks-Cli Gate A3: Run security review → .peaks/_runtime/change/<changeId>/qa/security-findings.md
#    Peaks-Cli Gate A4: Run performance check → .peaks/_runtime/change/<changeId>/qa/performance-findings.md
#    CRITICAL: Peaks-Cli Gate A3 and Peaks-Cli Gate A4 are NON-NEGOTIABLE.
#    Before running A4, read the RD's perf-baseline at
#    .peaks/_runtime/change/<changeId>/rd/perf-baseline.md (if present) and use the
#    captured thresholds as the comparison baseline.

# 6. write test-report — MANDATORY, write to .peaks/_runtime/<sessionId>/qa/test-reports/<request-id>.md
#    MUST contain actual execution results (pass/fail counts, coverage %, findings).

# 7. frontend browser validation (when frontend is in scope)
# Slice #016: peaks-cli no longer manages MCP install/dispatch. The LLM
# checks its own tool list for any Playwright MCP entry. If absent,
# QA reports the missing tool and tells the user the install command
# (`claude mcp add playwright -- npx @playwright/mcp@latest`).
# DEV-SERVER REQUIREMENT (BLOCKING): a running dev server is REQUIRED for browser E2E.
# The same lifecycle applies to ANY service QA starts: capture PID on startup, validate, then kill.
# NEVER substitute a production build for browser E2E. After browser validation completes, KILL the dev server.
# Playwright MCP MUST simulate real user operations — not just take static screenshots.
# The LLM invokes the tools by name from its own tool list.

# 8. write per-criterion acceptance results, regression matrix, security/performance findings,
#    and the final verdict into the QA request artifact. Mark state=verdict-issued.
#    BEFORE the transition, run the QA quality-gate CLI checks (see Peaks-Cli Gate E/F):
peaks scan acceptance-coverage --rid <rid> --project <repo> --json
# → ok=false → BLOCKED. Some PRD acceptance items have no linked test case.
peaks request lint <rid> --role qa --project <repo> --json
# → ok=false → BLOCKED. The QA artifact body has unfilled <placeholders> or "..." stubs.

# 9. on verdict=return-to-rd, route findings back through the request id; otherwise close.
peaks request show <request-id> --role qa --project <repo> --json
peaks openspec archive <change-id> --project <repo> --json   # preview, then --apply on full pass
peaks project memories:extract --session-id <session-id> --project <repo> --json  # extract durable memories
peaks skill presence:clear --project <repo>                      # QA complete, remove presence indicator
```

Verdict `pass` is blocked until every applicable validation gate has evidence in the artifact.