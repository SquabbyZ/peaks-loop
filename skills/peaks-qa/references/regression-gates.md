# Peaks QA Regression Gates

QA must be involved before refactor implementation.

## Required evidence

- coverage report or reason for blocking;
- regression matrix;
- baseline report;
- acceptance checks;
- API validation evidence when API behavior is in scope;
- `gstack/browse/dist/browse` browser E2E evidence when a frontend exists or UI is in scope, preferably from headed/handoff mode with visible-browser confirmation;
- security check evidence;
- performance check evidence;
- validation report;
- residual risk report.

## Refactor threshold

UT coverage below 95%, missing coverage, or unverifiable coverage blocks refactor implementation. For non-refactor work in legacy projects whose total coverage is already below the project target, QA may accept the legacy baseline only when new or changed code has focused unit-test coverage evidence.

## Frontend failure rule

If browser validation shows page errors, console exceptions, failed critical network requests, or visible regressions, QA returns the change to RD with evidence and reruns the browser path after the fix.
