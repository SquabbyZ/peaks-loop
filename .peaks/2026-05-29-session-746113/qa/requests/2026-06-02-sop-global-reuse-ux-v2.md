# QA Request 2026-06-02-sop-global-reuse-ux-v2

- session: 2026-05-29-session-746113
- linked-prd: .peaks/2026-05-29-session-746113/prd/requests/2026-06-02-sop-global-reuse-ux-v2.md
- linked-rd:  .peaks/2026-05-29-session-746113/rd/requests/002-2026-06-02-sop-global-reuse-ux-v2.md
- linked-ui:  N/A
- type: feature (ux-fix)

## Red-line boundary check

- in-scope changes seen in the diff (match PRD + RD scope):
  - `src/cli/commands/sop-commands.ts` — description text update + one-line `.option('--project <path>', 'help', '.')` addition on `sop registry` (lines 187-188).
  - `tests/unit/sop-commands.test.ts` — one new test `registry without --project defaults to cwd and merges the project layer when present (AC6)` in the `peaks sop register / registry commands` describe block.
  - `skills/peaks-sop/references/sop-authoring.md` — one-line doc clarification.
- out-of-scope changes flagged (any extra file, route, mock, fixture, behavior): **none**.
- verdict: **clean** — all changes are inside the RD red-line scope declared in `rd/requests/002-2026-06-02-sop-global-reuse-ux-v2.md` (`## Red-line scope`).
- CLI deterministic check: `peaks scan diff-vs-scope --rid 2026-06-02-sop-global-reuse-ux-v2` returned `{violations: [], unclassified: [], patternsDeclared: true}`.

## OpenSpec exit gate (when openspec/ exists)

- change-id: **N/A** — this iteration did not create a new OpenSpec change. The slice is one CLI default-value addition + one test, below the engineering-change bar used by other entries in `openspec/changes/` (e.g. `add-tech-dry-run-gate`, `enforce-artifact-boundary-and-coverage`). Per RD runbook "skip steps that do not apply", no OpenSpec change for this slice. Documented in `rd/tech-doc.md` `## OpenSpec linkage` section.

## Acceptance checks

- per-criterion: check method, result (pass | fail | blocked), evidence path

| AC | Description (abbreviated) | Result | Evidence |
|----|---------------------------|--------|----------|
| A1 | grep absent:true gates pass when pattern absent, fail when present; lint accepts the field | **pass** | `tests/unit/sop-check-service.test.ts:69` (asserts `result === 'pass'` on `clean-no-todo`; `result === 'fail'` with reason matching `/must be absent but was found/` on `dirty-no-todo`); `tests/unit/sop-commands.test.ts:125` confirms lint acceptance. |
| A2 | grep absent:true expresses "must not contain X" without `--allow-commands` or `sh` | **pass** | `evaluateGrep` uses `new RegExp(pattern).test(content)` only — no `execFileSync`, no shell, no `--allow-commands` path. Test on `sop-check-service.test.ts:69` exercises this without `--allow-commands`. |
| A3 | phase skip `null→publish` and `draft→publish` both throw `SOP_PHASE_SKIP`; `--allow-incomplete --reason` bypasses | **pass** | `tests/unit/sop-advance-service.test.ts:136` (asserts `caught.code === 'SOP_PHASE_SKIP'`); bypass path covered by `tests/unit/sop-commands.test.ts:advance` describe ("a forward skip can be forced with --allow-incomplete --reason (AC5)"). |
| A4 | phase-skip error response includes the expected next phase (or hints `--allow-incomplete`) | **pass** | `SopPhaseSkipError` (sop-advance-service.ts) carries `expectedNext`; surfaced via `getErrorMessage` in CLI; bypass hint is in the error message string. |
| A5 | `sop init <id>` apply response includes `nextActions` with edit-sop.json + sop-lint pointers | **pass** | `tests/unit/sop-commands.test.ts:50-61` (assertions on lines 59-60: `output.nextActions?.some((a) => /Edit .*sop\.json/.test(a))` and `/sop lint/`). |
| A6 | `sop check/advance/gate enforce/registry` all default `--project` to cwd; the new default for `sop registry` is the only code change in this slice; merged-view is correct | **pass** | `tests/unit/sop-commands.test.ts:203-236` (new TC11 test, RED → GREEN during RD; seeds a unique project-only entry `cwd-only`, asserts merged-view contains it, cross-checks explicit-flag parity, cross-checks service-level `readRegistry`). |
| A7 | `sop init/lint/register` do NOT get the new default; preserved behavior for the three definition-class commands | **pass** | source inspection: those three `.option('--project ...')` declarations have no third argument (`src/cli/commands/sop-commands.ts:72,111,158`); `sop-authoring.md:11` doc clarifies. |
| A8 | All existing SOP tests still pass; new tests are real behavior assertions (no padding) | **pass** | focused suite 110/110 pass; new TC11 seeds a unique project-only entry, asserts merged-view contains it, cross-checks explicit-flag parity, cross-checks service-level `readRegistry` — not a branch-coverage test. |
| A9 | `--help` on the four execution commands shows `(default: current directory)` for `--project`; definition-class commands do not | **pass** | source inspection of all four option declarations: `sop-commands.ts:188,209,236` and `gate-commands.ts:50` each pass `'.'` as the third argument to `.option('--project <path>', 'help', '.')`; definition-class commands do not. |

**Result: 9/9 ACs pass.**

## Mandatory validation gates

- **unit tests:** focused suite 7 files / 110 tests / 0 fail. Full suite 1639 pass / 2 fail (the 2 are pre-existing on `main` in `statusline-settings-service.test.ts` — Windows `symlinkSync EPERM`, unrelated to this slice; documented in `qa/test-reports/002-2026-06-02-sop-global-reuse-ux-v2.md`).
- **API validation (when applicable):** N/A — CLI only, no API surface touched. SOP manifests are read from local filesystem via `readFileSync`; verified by TC11 which exercises both the CLI path and the service path (`readRegistry`).
- **browser E2E (when frontend):** N/A — no UI surface touched. (Per QA runbook step 7, browser validation is required only when frontend is in scope; this iteration is CLI-only.)
- **browser-error feedback loop:** N/A — no browser interaction in this slice.
- **security check:** `qa/security-findings.md` — PASS. Tool: source inspection + secret-pattern grep on changed files. No findings (no new attack surface, no path-traversal regression, no P1-P7 boundary regression).
- **performance check:** `qa/performance-findings.md` — PASS. Tool: `npm run build` (clean) + dist size diff (no change) + suite runtime measurement (no measurable delta). No findings.
- **validation report path:** `qa/test-reports/002-2026-06-02-sop-global-reuse-ux-v2.md`.

## Regression matrix

| Surface / path | Result | Notes |
|----------------|--------|-------|
| `peaks sop init` (preview + apply + reserved id) | pass | `sop-commands.test.ts:29-77` |
| `peaks sop lint` (fresh + missing + grep absent acceptance) | pass | `sop-commands.test.ts:79-133` |
| `peaks sop register` (record + dry-run + allow-commands + unregistrable) | pass | `sop-commands.test.ts:136-194` |
| `peaks sop registry` (fresh + project-layer + new default-cwd + corrupt) | pass | `sop-commands.test.ts:196-249` (new TC11 is the new-row case) |
| `peaks sop check` (pass/fail + gate-not-found + allow-commands) | pass | `sop-commands.test.ts:251+` |
| `peaks sop advance` (gate-blocked + advance + phase-skip + bypass + reason-required + dry-run + cap) | pass | `sop-commands.test.ts:advance` describe (10+ cases) |
| `sop-check-service` (file-exists + grep absent + command blocked + timeout + unknown) | pass | `sop-check-service.test.ts` |
| `sop-advance-service` (phase order no-skip + bypass) | pass | `sop-advance-service.test.ts` |
| `sop-registry-service` (read global + merge) | pass | `sop-registry-service.test.ts` |
| `gate-enforce-service` (PreToolUse handler) | pass | `gate-enforce-service.test.ts` |
| Built-in peaks-* never in custom registry (P1) | pass | source inspection + TC13 |
| `command` gate still requires `--allow-commands` (P2) | pass | `sop-check-service.test.ts:command` describe + TC14 |
| File/grep paths pinned inside project root (P4) | pass | TC15 + `sop-check-service.test.ts` |
| Merged registry project-first (P6) | pass | `sop-commands.test.ts:202-219` (TC16) |

**Pass / fail per row: 13/13 pass.**

## Browser evidence

- N/A. No browser interaction in this slice. No screenshots, no console logs, no network observations retained.

## Verdict

- overall: **pass**

All 9 PRD acceptance items pass with 18 generated QA test cases (all pass). No CRITICAL/HIGH/MEDIUM findings from security or performance gates. Red-line boundary check is clean (no out-of-scope writes). Build clean. Focused suite 110/110 pass. Slice ready for commit + handoff to SC (commit boundary) per `main-branch-iteration` memory.

## Status

- created: 2026-06-01T16:37:56.789Z
- last update: 2026-06-02T00:47:00.000Z
- state: **verdict-issued** (verdict: **pass**)
