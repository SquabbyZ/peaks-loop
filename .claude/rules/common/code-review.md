# Code Review Standards

Source: Peaks curated baseline; everything-claude-code reference: https://github.com/affaan-m/everything-claude-code
Scope: project-local standards for peaks-rd, peaks-qa, and peaks-solo workflow preflight.
- Review diffs for correctness, maintainability, test coverage, and regression risk.
- Treat missing tests for changed behavior as a blocker unless the change is documentation-only.
- Verify code paths that handle filesystem, external APIs, credentials, user input, or generated artifacts.
- peaks-qa must use this guidance as part of code workflow preflight and final verification.
