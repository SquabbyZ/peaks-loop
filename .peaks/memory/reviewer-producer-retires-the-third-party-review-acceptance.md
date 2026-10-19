---
name: reviewer-producer-retires-the-third-party-review-acceptance
description: reviewer-producer-retires-the-third-party-review-acceptance
metadata:
  type: decision
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff.md
---

`peaks reviewer run --write` is the producer that lets the third-party-review commit-leg
acceptance (`.peaks/lint/backcompat-expired-acceptance.json`, keyed on the declared
`rd/third-party-review-<rid>.md` path, `reviewBy: v4.2.0`) be retired. The
acceptance is a time-bounded debt record, not a permanent exemption; the producer exists only when a
reviewer is configured AND the run produced a real verdict (a skip writes nothing).

**Why:** §16's gate enforces the closed window at the commit leg; retiring the acceptance without a
producer would just make the commit fail.

**How to apply:** to retire the entry, configure >=2 reviewer providers with `peaks reviewer config`,
produce `rd/third-party-review-<rid>.md` (and its `.json` sibling) via `peaks reviewer run --write`,
then remove the entry. The bare `rd/third-party-review.md` is only the legacy tier accepted under the
back-compat window. Do not hand-write the artifact.
