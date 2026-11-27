---
name: 2026-11-28-four-optimization-directions
description: Four user-chosen directions shipped in 24h mode (design fidelity, stack-aware gates, race-lane parallelism, repo-aware slicing) across 11 slices / 15 commits; records the two invisible defects they exposed (reviewer policy 'feat' vs 'feature'; the scheduler dropping every bare specifier) and the residuals deliberately left (runtime-contract coupling, fidelity role advisory, real-project calibration).
kind: project
---

Session `2026-11-28-session-8bdf67`, job `peaks-optimizations-2026-11-28`. Every direction ran a
grilling pass first (user pre-authorized "all recommendations"), then slices were implemented by RD
sub-agents and verified by the orchestrator before each commit.

## What shipped

- **Design fidelity** (`6d5d114a`, `03692353`, `f02e134c`, `0a345928`, `03eaebb9`): component
  capability inventory; component-native prototypes with `data-peaks-object` identity and
  `rejected-<direction>.html` for directions the library cannot express; captures now record
  four-sided margin/padding, four-sided spacing, peak markers, `captureVersion: "2"` and wait for
  `document.fonts.ready`; `peaks design fidelity <route>` scores prototype vs implementation per
  viewport (zero missing/extra + anchors ≥95% + tokens ≥95%); `DESIGN_FIDELITY` gates
  `rd:qa-handoff`, not-applicable without a design contract, MISSING refuses.
- **Stack-aware gates** (`26972493`, `bd30f9f6`): `reviewPlan` in the dispatch envelope; `auditPlan`
  adds dimensions per detected stack and **cannot remove** any (`AUDIT_PLAN_REMOVAL_NOT_PERMITTED`,
  `AUDIT_PLAN_BASE_NOT_COVERED`); applies only when the session's dispatch record carries a plan.
- **Race-lane parallelism** (`eb62e745`, `52ebf29a`, `5ddae75f`): read-only parallel diagnosis in
  race-code/race-design/design; `orchestrator-can-do --lane race` hands off at ≥3 subtasks, ≥8 files
  or any risk surface; `--lane fast` refuses overlapping `files[]` and `verify-files` refuses
  actual changes outside the declared union; the main window commits once.
- **Repo-aware slicing** (`0f467968`, `04402c74`): measured gap fixture; bare specifiers resolve
  against the workspace, static/`export … from`/dynamic `import()` all emit edges, and a
  package.json-only coupling gets a named `package-dependency` edge.

## Two invisible defects the work exposed

1. **`reviewerListFor` used the domain `'feat'` while the canonical request type is `'feature'`**,
   so every feature slice selected zero reviewers. It was invisible because the policy was dead code
   — only `isDeprecatedReviewer` was imported at runtime.
2. **The scheduler's import-edge runner dropped every non-relative specifier**
   (`slice-decompose-runners.ts`), and parsed only static imports, so five coupled package pairs all
   landed in one `parallelizableWithinBatch: true` batch with zero DAG edges — even though codegraph
   itself knew the plain-import edge.

## Verified at close

Whole-repo gate held with lower ceilings than at start (eslint findings 1663→1658, files over cap
77→76, excess lines 21461→21157); `tests/unit` 826 files / 9237 pass; affected integration 8 files
/ 46 pass; red-rule and BDD ratchet green.

## Deliberately not done

- Runtime-contract coupling (two packages reading one JSON schema) is not inferable from source; the
  test asserts the residual instead of inventing an edge.
- Fidelity measures geometry and spacing only — color/typography/motion are out of scope and the
  artifact says so; the role assertion is reported but does not gate.
- The real-project calibration of the 95% threshold needs the user's own repository; only the fixture
  has been measured.
- `polyrepo` (true multi-repo) was not touched: this repository has neither `.peaks/polyrepo.json`
  nor submodules, so there is nothing real to test it against.
