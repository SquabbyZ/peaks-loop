---
name: a-positive-evidence-rule-must-match-what-the-tools-actually-emit
description: A positive-evidence rule must match what the tools actually emit
metadata:
  type: project
  sourceArtifact: .peaks/_runtime/2026-11-23-session-320f58/txt/handoff-s5.md
---

S2 required every designlang payload to carry `generatedAt`/`pages`. Measured on 13.4.1, none of
`drift`, `verify-ui` or `slop` emits either — so G2 could never pass, and the tests were green only
because their fakes injected the timestamp. The pilot found it; the spike proved it. Each tool now
has its own acceptance shape: drift (verdict, driftRatio, summary totals, the echoed url and
tokensFile), verify-ui (boolean pass + onBrand), slop (score + readAt). Exit codes are mapped
per tool (verify-ui 1 fail / 2 blocked page / 3 retryable) and a parsed report outranks the code.
Also: a blank SPA shell cannot be detected from DOM/stats fields (global CSS and devtools skew
them) — a paint metric from a real capture can, but a rendered sign-in page paints like content,
so route identity remains a separate, still-open signal.
