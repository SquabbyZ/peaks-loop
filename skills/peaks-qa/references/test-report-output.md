# Mandatory test-report output (QA)

> Body of `## Mandatory test-report output`. Every QA invocation must produce a test-report artifact at `.peaks/_runtime/<sessionId>/qa/test-reports/<request-id>.md`. This is separate from both the test-case file and the request artifact — do not merge.

**Minimum test-report sections:**

1. **Summary** — pass/fail count, coverage %, verdict (pass / return-to-rd / blocked)
2. **Test execution results** — number of test cases executed, passed, failed, skipped
3. **Coverage evidence** — changed-files coverage %, overall project coverage %, link to coverage report
4. **Browser validation results** (frontend only) — pages validated, screenshots path, console errors found, network errors found
5. **Security findings** — issues found, severity, resolution status
6. **Performance findings** — baseline vs after numbers (build size, Lighthouse, etc. as applicable)
7. **Residual risks** — known issues not fixed, why, mitigation
8. **Red-line boundary check** — pass/fail against the approved scope