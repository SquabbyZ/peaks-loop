---
name: peaks-ide-dashboard-ok-policy-workspace-only-default
description: peaks-ide skill — `peaks project dashboard --json` defaults to `ok-policy: workspace-only` (peaks-ide is a first-run / switch skill; partial-failure doctor should not block onboarding)
metadata:
  type: decision
  sourceArtifact: .peaks/_runtime/2026-06-06-session-5b1095/rd/requests/010-008-008-2026-06-07-peaks-ide-cleanup.md
---

# peaks-ide dashboard ok-policy: workspace-only (default)

## Rule

`peaks project dashboard --json` now defaults to `ok-policy: workspace-only`:
`dashboard.ok` is `true` whenever the workspace layout / runbook health is
healthy, even if 1-2 non-blocking doctor checks fail. The legacy
`ok-policy: strict` (which followed the doctor aggregate) is reachable
via the `--strict` flag, which emits `code: "PROJECT_DASHBOARD_DOCTOR_STRICT_FAIL"`
when the doctor aggregate is not green.

## Why

The peaks-ide skill is the canonical "first run" / "switch IDE" surface
(per `.peaks/memory/peaks-ide-skill-is-the-skill-first-pattern-5-step-flow-uses-existing-cli-primitives.md`).
A new user adopting peaks-cli's IDE hooks should not be blocked by a
partial-failure doctor (e.g. a single non-blocking capability probe).
The legacy `ok: doctor aggregate` semantics was too strict for a
"first-run" skill and would have made the peaks-ide Step 1 read
`dashboard.ok === false` on an otherwise-healthy workspace.

The new default unblocks peaks-ide Step 1; the `--strict` flag preserves
back-compat for any CI script that was relying on the doctor aggregate
gate.

## How to apply

- Skill prompt readers: when reading `peaks project dashboard --json`,
  trust `dashboard.ok` for the default path; only use the strict mode
  when the user has explicitly asked for a CI-grade gate.
- CLI consumers: the envelope's `okPolicy` field is the source of truth
  (`'workspace-only' | 'strict'`). When `okPolicy === 'workspace-only'`,
  the doctor may report failures that the dashboard envelope tolerates.
- Future skill work: do NOT change the default. If a different skill
  (e.g. peaks-solo) needs a stricter default, scope the change to that
  skill's command — do not flip the global default.

## Cross-reference

- Slice #2 closeout decisions: `peaks-ide-skill-is-the-skill-first-pattern-5-step-flow-uses-existing-cli-primitives.md`,
  `peaks-ide-skill-ac-10-audit-log-writer-is-a-thin-helper-not-a-separate-cli-primitive.md`.
- Slice #011 F-3 cleanup (assumed in place): the
  `build:workspace-layout-canonical` check passes on a clean repo, so
  the default `workspace-only` policy surfaces `ok: true` end-to-end.
- The dev-preference red line: "Default-no on new CLI commands". The
  `--strict` flag was added to the existing `peaks project dashboard`
  command — no new `peaks <cmd>` was introduced.
