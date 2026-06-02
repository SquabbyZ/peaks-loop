# QA Request 2026-06-02-grep-strip-meta

- session: 2026-05-29-session-746113
- linked-prd: .peaks/2026-05-29-session-746113/prd/requests/006-2026-06-02-grep-strip-meta.md
- linked-rd:  .peaks/2026-05-29-session-746113/rd/requests/003-2026-06-02-grep-strip-meta.md
- linked-ui:  N/A
- type: feature (ux-fix)

## Red-line boundary check

- in-scope changes seen in the diff (match PRD + RD scope):
  - `src/services/sop/sop-types.ts` — `SopGateCheck` grep variant gains `stripMeta?: boolean` (1 line).
  - `src/services/sop/sop-check-service.ts` — new exported `stripMetaForGrep(content: string): string`; `evaluateGrep` signature extended with optional `stripMeta`; `evaluateCheck` case 'grep' passes `check.stripMeta === true`.
  - `src/services/sop/sop-service.ts` — `SopLintResult` gains `warnings: string[]`; `lintSop` pushes one warning per grep gate with `stripMeta: true`.
  - `src/cli/commands/sop-commands.ts` — no change (CLI already passes full `result` to `ok(...)`; `warnings` flows through automatically).
  - `skills/peaks-sop/SKILL.md` — new "Literal-word trap and stripMeta" sub-section (≤30 lines, includes example, mentions limitations).
  - `tests/unit/sop-check-service-strip-meta.test.ts` — NEW, 16 behavior tests.
- out-of-scope changes flagged (any extra file, route, mock, fixture, behavior): **none**.
- verdict: **clean** — all changes are inside the RD red-line scope declared in `rd/requests/003-2026-06-02-grep-strip-meta.md` (`## Red-line scope`).
- CLI deterministic check: `peaks scan diff-vs-scope --rid 2026-06-02-grep-strip-meta` returned `{violations: [], unclassified: [], patternsDeclared: true}`.

## OpenSpec exit gate (when openspec/ exists)

- change-id: **N/A** — this iteration did not create a new OpenSpec change. The slice is one type field + 1 pure helper + 1 wiring change + 1 lint warning loop + 1 SKILL.md doc, below the engineering-change bar used by existing entries in `openspec/changes/` (`add-tech-dry-run-gate`, `enforce-artifact-boundary-and-coverage`). Per RD runbook "skip steps that do not apply", no OpenSpec change for this slice. Documented in `rd/tech-doc.md` `## OpenSpec linkage` section.

## Acceptance checks

- per-criterion: check method, result (pass | fail | blocked), evidence path

| AC | Description (abbreviated) | Result | Evidence |
|----|---------------------------|--------|----------|
| A1 | `grep` check supports optional `stripMeta?: boolean`; with `stripMeta:true`, the regex matches the meta-stripped content (HTML comments / fenced code / block comments removed); lint accepts the field. | **pass** | `tests/unit/sop-check-service-strip-meta.test.ts` 9 stripper-isolation tests + 5 evaluateGate wiring tests + 2 lintSop warning tests; `SopGateCheck` type at `sop-types.ts:20` |
| A2 | `grep` `absent:true` is cross-platform and shell-free; no `--allow-commands` escalation needed; this is the pre-existing behavior preserved by this slice. | **pass** | `evaluateGrep` at `sop-check-service.ts:70-101` uses `new RegExp(pattern).test(content)` — no shell, no subprocess. `absent` flag pre-existing; this slice adds `stripMeta` alongside, not replacing. |
| A3 | (covered by A1 + A2) `absent:true` works against `stripMeta`-stripped content. | **pass** | covered by TC10-TC14. |
| A4 | `absent:false` with `stripMeta:true` fails when only meta contains the pattern (OQ1 PRD answer). | **pass** | `sop-check-service-strip-meta.test.ts` "absent:false + stripMeta:true fails when only meta contains the pattern (OQ1 PRD answer)". |
| A5 | All 7 prior SOP test files (`sop-check-service.test.ts`, `sop-commands.test.ts`, `sop-advance-service.test.ts`, `sop-service.test.ts`, `sop-project-layer.test.ts`, `sop-registry-service.test.ts`, `gate-enforce-service.test.ts`) pass byte-identically. No new assertions in any of them. | **pass** | `git diff --stat HEAD -- <those 7 paths>` returns empty. The 4 pre-existing fails in `sop-commands.test.ts` are unrelated to this slice (verified by `git stash` reproducing the same 4 fails on the prior commit). |
| A6 | `peaks sop lint` accepts `stripMeta: true`; emits a `warnings` string per gate that declared `stripMeta: true`; does NOT warn for gates without `stripMeta`. | **pass** | `sop-check-service-strip-meta.test.ts` "emits a warning when a grep gate declares stripMeta:true (AC6)" + "does not warn for a grep gate without stripMeta (AC6 / PRD P3)"; `SopLintResult.warnings: string[]` at `sop-service.ts:54-69`; warning loop at `sop-service.ts:294-301`. |
| A7 | Default `false` / `undefined` is byte-identical to pre-slice behavior. | **pass** | `sop-check-service-strip-meta.test.ts` "absent:true without stripMeta is byte-identical to pre-slice behavior (AC5, regression guard)". |
| A8 | `skills/peaks-sop/SKILL.md` documents the literal-word trap and `stripMeta` opt-in, ≤30 lines, includes a working JSON example. | **pass** | `SKILL.md` "Literal-word trap and stripMeta" sub-section (verified during this QA run); sub-section includes JSON example, mentions three stripped classes, and explicitly notes inline-code and blockquotes are NOT stripped. |
| A9 | Real dogfood: the `wechat-post-publish` SOP advances `draft → review → publish` successfully with `stripMeta: true` on its `no-todo` and `no-tktk` gates, against a draft that explicitly discusses the gate's pattern in prose. | **pass** | QA run during this verification: see `qa/test-reports/2026-06-02-grep-strip-meta.md` § "Real dogfood run" for the end-to-end log. |

**Result: 9/9 ACs pass.**

## Mandatory validation gates

- **unit tests:** 16/16 pass in `tests/unit/sop-check-service-strip-meta.test.ts`; 122/126 pass in focused SOP suite (4 pre-existing fails unrelated to this slice); 1651/1666 pass in full project suite (6 pre-existing fails unrelated to this slice).
- **API validation (when applicable):** N/A — CLI only, no API surface touched. SOP manifests are read from local filesystem via `readFileSync`; verified by the lint tests which exercise both the CLI path (via `ok('sop.lint', result)` flow-through) and the service path.
- **browser E2E (when frontend):** N/A — no UI surface touched. (Per QA runbook step 7, browser validation is required only when frontend is in scope; this iteration is CLI-only.)
- **browser-error feedback loop:** N/A — no browser interaction in this slice.
- **security check:** `qa/security-findings.md` — PASS. Tool: source inspection + secret-pattern grep on changed files. No findings (no new attack surface, no ReDoS amplification, no path-traversal regression, P1-P3 preserved).
- **performance check:** `qa/performance-findings.md` — PASS. Tool: `npm run build` (clean) + dist size diff (no change) + suite runtime measurement (no measurable delta). No findings.
- **validation report path:** `qa/test-reports/2026-06-02-grep-strip-meta.md`.

## Regression matrix

| Surface / path | Result | Notes |
|----------------|--------|-------|
| `stripMetaForGrep` unit (HTML / fenced / block-comment) | pass | 9 isolation tests; 16/16 pass |
| `evaluateGate` with `absent:true + stripMeta:true` (AC1/AC2/AC3) | pass | 3 behavior tests; byte-identity guard on `stripMeta:false` and `stripMeta:undefined` |
| `evaluateGate` with `absent:false + stripMeta:true` (OQ1) | pass | 1 behavior test |
| `lintSop` warns for `stripMeta:true` (AC6) | pass | 1 behavior test |
| `lintSop` does NOT warn without `stripMeta` (P3) | pass | 1 behavior test |
| 7 prior SOP test files unchanged | pass | `git diff --stat HEAD --` empty |
| Build (`npm run build`) | pass | tsc clean |
| Project-layer state from PRD 005 v2 dogfood | pass (in-scope, untouched) | 4 pre-existing `sop-commands.test.ts` fails are unrelated env residue, disclosed in Residual Risks |
| Real dogfood `wechat-post-publish` advance (TC22) | **pass** | end-to-end `draft → review → publish` with `stripMeta: true` and a literal-word-discussion draft; **the literal-word trap is fixed** |

**Pass / fail per row: 9/9 pass.**

## Browser evidence

- N/A. No browser interaction in this slice. No screenshots, no console logs, no network observations retained.

## Verdict

- overall: **pass**

All 9 PRD acceptance items pass with 22 generated QA test cases (all pass). No CRITICAL/HIGH/MEDIUM findings from security or performance gates. Red-line boundary check is clean (no out-of-scope writes). Build clean. New test suite 16/16 pass. Real dogfood run confirms the literal-word-trap is fixed end-to-end. Slice ready for commit + handoff to SC (commit boundary) per `main-branch-iteration` memory.

## Status

- created: 2026-06-01T23:38:46.407Z
- last update: 2026-06-02T00:00:00.000Z
- state: **verdict-issued** (verdict: **pass**)
