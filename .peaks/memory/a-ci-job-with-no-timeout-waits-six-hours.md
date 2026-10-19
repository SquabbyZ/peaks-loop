---
name: a-ci-job-with-no-timeout-waits-six-hours
description: a-ci-job-with-no-timeout-waits-six-hours
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-ci.md
---

GitHub Actions applies a 360-minute default to a job with no `timeout-minutes`. A hung step
therefore burns six hours of runner time and delays every dependent check. Every job in
`.github/workflows/ci.yml` now carries a bound derived from its measured or structurally bounded
runtime (20–60 minutes), leaving headroom for a slow runner.

**Why:** the default is invisible in the workflow file, so a job that never sets a timeout does not
look wrong in review.

**How to apply:** when adding a workflow job, set `timeout-minutes` at the job level from the job's
worst plausible runtime — not the platform default — and verify the whole file parses with the same
number of numeric values as jobs.
