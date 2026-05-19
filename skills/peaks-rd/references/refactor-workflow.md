# Peaks RD Refactor Workflow

## Standards loading order

1. Existing project standards.
2. Peaks language standard packs.
3. Peaks universal engineering baseline.
4. Reviewer judgment.

## Hard gates

- UT coverage must be >= 95% before implementation.
- Missing, unknown, unverifiable, or failing coverage blocks refactoring.
- Coverage success only allows analysis and spec generation.
- Broad refactors must be split into minimal functional slices.
- Each slice needs a strict verifiable spec before implementation.
- Each slice must pass 100% acceptance.
- Code and intermediate artifacts must be committed before the next slice.

## Required artifacts

- `project-scan.md`
- `engineering-constitution.md`
- `coverage-report.md`
- `feature-slice-map.md`
- `refactor-options.md`
- `risk-matrix.md`
- `rollback-plan.md`
- `slice-spec.md`
- `validation-report.md`
- `commit-required.md`
