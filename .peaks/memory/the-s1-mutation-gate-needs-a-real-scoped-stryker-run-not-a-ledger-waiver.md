---
name: the-s1-mutation-gate-needs-a-real-scoped-stryker-run-not-a-ledger-waiver
description: The S1 mutation gate needs a real scoped Stryker run, not a ledger waiver
metadata:
  type: project
  sourceArtifact: .peaks/_runtime/2026-11-23-session-320f58/txt/handoff.md
---

The artifact-contract commit gate requires `mut/mut-report.json`, but
`backcompat-acceptance-seed.test.ts` asserts the ledger contains only the third-party
entry and explicitly forbids the mut path. Do not add a mut waiver — the seed test
fails. Run the scoped mutation command with `--input-sig` (a sha256 of the QA
test-cases satisfies the chain in a session with no TACT artifact) and `--out
.peaks/_runtime/<sid>/mut/mut-report.json`; harden tests to the 0.8 kill-rate
threshold. In S1 this took the kill rate from 49.2% to 89.1%.
