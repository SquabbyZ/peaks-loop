---
name: 2026-09-10-peaks-web-s1-s3-shipped-s4-queued
description: peaks-web job at 3/4 — S1/S2/S3 committed and E2E-verified, S4 (persistent login + cookie-rule amendment) not started, AC2's page-dependent ratio still an open user decision
metadata:
  type: project
  sourceArtifact: .peaks/_runtime/2026-09-10-session-528a63/txt/handoff.md
---

# peaks-web — 3 of 4 slices shipped, E2E-verified (2026-09-10)

**Job:** `peaks-web`. Slices S1–S4 from `2026-09-07-session-245530/sc/design-web-playwright.md`.

| slice | commit | state |
|---|---|---|
| S1 core commands | `4134757` | committed, E2E-verified |
| S2 daemon lifecycle + isolation | `f4b5e34` | committed, E2E-verified |
| S3 acquisition + disable gate + degradation | `97d44ca7` | committed, E2E-verified |
| S4 persistent login + `browser-workflow.md` amendment | — | **not started** |

Also shipped separately: `4637baa8` (Windows console-window fix for the peaks `Bash` hooks).

Each slice was reviewed by three independent lenses before commit, and every slice had at least one
blocking defect that reading the code would not have found: S1's storage-state guard made all six
verbs fail behind a green 48-test suite; S2's liveness oracle spawned a second daemon and broke Q8
(reproduced); S3's package loader executed an unverified package off `PATH` (RCE, reproduced).
**Treat "tests green" as evidence about assertions, never about the criterion.**

## Open decision — AC2 (the user's, not RD's)

AC2 reads *"同一页面 `peaks web snap` ≤ MCP a11y snapshot ÷ 5"* and **names no page**. Measured:
**33.5× on a content-rich page**, **0.59× on a minimal one** (315-byte denominator). On a minimal
page `1/5` is below what any structurally faithful snapshot can produce, so the criterion is not a
property of the implementation alone. Options: name a reference page, reword, or report it as
page-dependent. **Do not reword it silently.**

## Queued

1. **S4** — `peaks web login --profile` (explicit user request only, Q5/Q9) + amend
   `skills/peaks-code/references/browser-workflow.md` §"Sensitive data sanitization" from
   "Never persist … Cookies …" to "default: never persist; exception: explicit user-requested
   `--profile`" with the risk inline. **S4's acceptance requires that diff be shown.**
2. **S5** — rebuild the deleted `tests/unit/services/session/session-dir-canonical.test.ts`
   (user-assigned; see `findings-repo-defects.md` §G1). Separate commit, not part of peaks-web.
3. **`tests/unit/_setup/io.ts`'s `withEnv` does not restore intra-file** — empirically confirmed,
   17 call sites in 5 files, can cause false passes.
4. **CLI/job-loop defects recorded but unfixed** — `findings-cli-defects.md` (D1 `orchestrator-can-do`
   false negative on sub-agent availability; D2 `sub-agent finalize` rejects its own record;
   D3 `best-practice-scan` is a stub), `findings-job-loop-defects.md` (D6 `peaks job` has no
   `--session-id` and follows the shared binding; D7 `--slice-id <label>` is silently accepted and
   no-ops), `findings-repo-defects.md` §G5 (`peaks slice check`'s typecheck stage can never pass).

## Environment facts that will bite the next session

- **`wmic` does not exist in this shell** — use `powershell -NoProfile -Command "Get-CimInstance …"`.
- **No git identity is configured**; commits used `git -c user.name="SquabbyZ" -c user.email=…`.
- **Another Claude session shares this project root**; `.peaks/_runtime/session.json` is a single
  per-project binding and can be taken over mid-job (it was). Always pass `--session-id` explicitly
  to `peaks sub-agent dispatch`; never call `peaks workspace init` from a sub-agent.
- Acceptance evidence: `qa/e2e-acceptance-2026-09-10.md`. AC1/AC3/AC4/AC5/AC6 pass; the four
  preserved-behavior items were checked by hand per the user's choice (no AC7 added).

**Related:** [[verify-a-cross-module-premise-before-asserting-it-in-a-dispatch-brief]],
[[a-measurement-whose-command-failed-silently-is-not-a-pass]],
[[removing-a-tool-removes-the-guarantees-it-made-implicitly]],
[[2026-09-10-peaks-web-design-accepted]]
