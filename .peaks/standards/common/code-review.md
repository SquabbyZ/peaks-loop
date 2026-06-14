# Code Review Standards (2.0 canonical)

- Review diffs for correctness, maintainability, test coverage, and regression risk.
- Treat missing tests for changed behavior as a blocker unless the change is documentation-only.
- Verify code paths that handle filesystem, external APIs, credentials, user input, or generated artifacts.
