---
name: a-criterion-applied-at-the-wrong-granularity-drops-entries-silently
description: A criterion applied at the wrong granularity drops entries silently
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-17-session-607ead/txt/handoff-rid-c-group.md
---

The guard enumeration filtered on "does this file read a committed artifact?" — a **file**-level
question — while the criterion it was serving was about **assertions**: does *this assertion* take a
committed artifact as its subject? The mismatch dropped `project-scan-bootstrap-service` (which
asserts a property of committed `skills/**/*.md`) and `loop-hygiene-block` (a byte-identity gate on
committed `SKILL.md` files, identical in shape to two entries that *were* kept).

**Why:** a file-level proxy is cheap and usually agrees with the per-assertion answer, so it looks
correct; where it disagrees, it disagrees silently, and the entries it drops are indistinguishable
from entries that legitimately do not qualify. The proxy never announces a miss.

**How to apply:** when a filter stands in for a per-item question, say which granularity the criterion
lives at and which the filter operates at, and treat any gap as a known undercount rather than a
detail. This is the third variant of the same failure in one group — filename vs property, keyword vs
criterion, file vs assertion. The shape is always a cheaper proxy silently answering a question at the
wrong resolution.
