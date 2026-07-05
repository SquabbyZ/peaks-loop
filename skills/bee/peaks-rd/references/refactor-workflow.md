# Peaks RD Refactor Workflow

## Standards loading order

1. Existing project standards.
2. Peaks language standard packs.
3. Peaks universal engineering baseline.
4. Reviewer judgment.

## Hard gates

- UT coverage must be >= 95% before refactor implementation.
- Missing, unknown, unverifiable, or failing coverage blocks refactoring.
- For non-refactor development in legacy repos with pre-existing low coverage, require focused unit-test coverage for new or changed code.
- Coverage success only allows analysis and spec generation.
- Broad refactors must be split into minimal functional slices.
- Each slice needs a strict verifiable spec before implementation.
- Existing `openspec/` repos require OpenSpec change artifacts before non-trivial implementation.
- Each implemented slice must pass unit tests, code review, and security review before RD dry-run.
- The post-check dry-run runs after tests, CR, and security review, not before them.
- Each slice must pass 100% acceptance.
- Code changes and sanitized intermediate artifacts must be traceable in local `.peaks/_runtime/<session-id>/` storage before the next slice; commit or sync sanitized artifacts only when explicitly authorized. Browser evidence must not retain login URLs, cookies, headers, tokens, storage state, browser traces, or screenshots/logs containing PII or SSO/MFA material.

## Required artifacts

- `project-scan.md`
- `engineering-constitution.md`
- `coverage-report.md`
- `feature-slice-map.md`
- `refactor-options.md`
- `risk-matrix.md`
- `rollback-plan.md`
- `slice-spec.md`
- `openspec-change-paths.md` when OpenSpec is required
- `code-review-report.md`
- `security-review-report.md`
- `post-check-dry-run.md`
- `validation-report.md`
- `retention-boundary.md` documenting local `.peaks/_runtime/<session-id>/` traceability, browser-evidence sanitization, and any explicitly authorized commit/sync requirement
