---
name: duplicate-reviewer-findings-are-the-class-confirmation
description: duplicate-reviewer-findings-are-the-class-confirmation
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-thirdparty.md
---

In this slice the karpathy review and the code review independently found the same upgrade-path gap
(both rated it MED), while QA's independent probe then reproduced it on a pre-repair copy. The
duplication was not noise: it moved a LOW-looking compatibility concern into the commit's repair
list before any commit was made.

**Why:** each reviewer is pointed at a different dimension, so a finding that survives two
dimensions is unlikely to be one reviewer's hobby-horse. The cost of reading both is smaller than
the cost of shipping the gap.

**How to apply:** when two independent reviewers name the same defect, treat it as confirmed even
if each rated it below the blocking bar; repair it in the slice rather than recording it as a
residual. Keep the reviewers' briefs different — a duplicate brief produces duplicate blind spots.
