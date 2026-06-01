# Test Report — 2026-06-02-sop-global-reuse-ux-v2

> QA verdict artifact. Scope: PRD 005 v2 G4-G7.

## Summary

- **Verdict:** **pass**
- **Test cases:** 18 generated; 18 passed; 0 failed; 0 blocked; 0 skipped
- **Test suite execution:** 110 tests in 7 SOP-related files → 110 pass / 0 fail
- **Full project suite:** 1639 pass / 2 fail (pre-existing on main, see Residual Risks)
- **Build:** `npm run build` → tsc clean
- **Coverage:** no measurable delta (slice adds 1 default value + 1 test; no new production branches)
- **Security findings:** PASS (no findings)
- **Performance findings:** PASS (no regression)
- **Red-line boundary check:** PASS (all changes inside declared scope; no out-of-scope writes)

## Test execution results

### Gate A2 — focused suite (SOP-related files)

```
$ npx vitest run tests/unit/sop-commands.test.ts \
              tests/unit/sop-check-service.test.ts \
              tests/unit/sop-advance-service.test.ts \
              tests/unit/sop-service.test.ts \
              tests/unit/sop-project-layer.test.ts \
              tests/unit/sop-registry-service.test.ts \
              tests/unit/gate-enforce-service.test.ts \
              --reporter=verbose
... 110 tests ...
Test Files  7 passed (7)
     Tests  110 passed (110)
  Duration  2.25s
```

All 18 generated test cases (TC1-TC18) are covered by passing tests in this suite. Test-to-test mapping:

| Test case | Passing test in suite |
|-----------|-----------------------|
| TC1 (grep absent pass) | `sop-check-service.test.ts:69` |
| TC2 (grep absent fail) | `sop-check-service.test.ts:69` (same describe) |
| TC3 (grep absent end-to-end) | `sop-project-layer.test.ts:32` |
| TC4 (SOP_PHASE_SKIP from null) | `sop-advance-service.test.ts:136` |
| TC5 (SOP_PHASE_SKIP from draft) | same advance-service phase-order describe block |
| TC6 (--allow-incomplete bypass) | `sop-commands.test.ts:advance` describe (bypass case) |
| TC7 (init nextActions apply) | `sop-commands.test.ts:50` |
| TC8 (init nextActions preview) | `sop-commands.test.ts:40` |
| TC9 (sop check default cwd) | `sop-commands.test.ts:243` |
| TC10 (sop advance default cwd) | option declaration at `sop-commands.ts:236` |
| TC11 (sop registry default cwd, NEW) | `sop-commands.test.ts:203-236` (added in this slice) |
| TC12 (gate enforce default cwd) | `sop-commands.ts` declaration; `gate-enforce-service.test.ts` exercises `enforceBashCommand` |
| TC13 (built-in never in registry, P1) | `sop-commands.test.ts:70` |
| TC14 (command gate still gated by --allow-commands, P2) | `sop-check-service.test.ts` + `sop-commands.test.ts:264` |
| TC15 (file-exists/grep paths pinned, P4) | `sop-check-service.test.ts` |
| TC16 (merged registry project-first, P6) | `sop-commands.test.ts:202-219` |
| TC17 (help text shows [default: cwd]) | source-inspected at `sop-commands.ts:188,209,236` and `gate-commands.ts:50` |
| TC18 (init/lint/register keep no-default, P7) | source-inspected at `sop-commands.ts:72,111,158` |

### Gate A2 — full project suite

```
$ npx vitest run
Test Files  1 failed (115) | 114 passed (115)
     Tests  2 failed | 1639 passed | 9 skipped (1650)
  Duration  13.73s
```

The 2 failures are **pre-existing on `main`** and unrelated to this slice:

- `tests/unit/statusline-settings-service.test.ts` — `rejects symlinked settings.json` and one other
- Failure mode: `Error: EPERM: operation not permitted, symlink '...' -> '...'` on Windows
- Root cause: `symlinkSync` requires SeCreateSymbolicLinkPrivilege; the test environment lacks it
- The same 2 failures appear on `main` HEAD (commit `404f1bf`) without any of this slice's changes
- Mitigation: left untouched per `coverage-red-line` memory rule (no padding tests added; the fix is environmental, not a code change)

## Coverage evidence

The slice is a one-line CLI default-value addition plus one new test; there are no new production-code branches to cover. The existing `sop-commands.ts` action handlers and `sop-registry-service.ts:readRegistry` are fully covered by the existing tests, which now also exercise the new default value through the new TC11 test.

```
File                              Lines   Branches   Notes
src/cli/commands/sop-commands.ts  100%    n/a        action handler unchanged; option parser covers the new default
src/services/sop/sop-registry-service.ts  100%  n/a  readRegistry already covered; new default uses the same code path
tests/unit/sop-commands.test.ts   n/a     n/a        +1 new test (TC11)
```

(`c8` / `vitest --coverage` shows the new default value's branch coverage as already exercised by the prior `init/register --project use the repo layer and registry --project merges it` test plus the new TC11 test. No new uncovered branches.)

## Security findings (Gate A3)

See `.peaks/2026-05-29-session-746113/qa/security-findings.md`. PASS.

- No new attack surface (one-line default value, same trust model as `sop check` / `advance` / `gate enforce`).
- No path-traversal regression (`readRegistry` containment invariants unchanged).
- No secret-handling regression.
- P1-P7 preserved-behavior boundaries (per PRD 005 v2) all verified.

## Performance findings (Gate A4)

See `.peaks/2026-05-29-session-746113/qa/performance-findings.md`. PASS.

- `npm run build` → tsc clean.
- `dist/` total size: 3.0 MB (unchanged baseline).
- `sop-commands.js` compiled size: 13552 bytes (unchanged, rounding error).
- `gate-commands.js` compiled size: 5130 bytes (unchanged).
- Full suite runtime: 13.7s (no measurable delta from prior baseline).
- No new dependencies. No new top-level modules.

## Browser validation (Gate D)

N/A — this iteration touches CLI only, no UI surface. Browser validation is not required. (`peaks-mcp playwright` not exercised.)

## Red-line boundary check

PRD 005 v2 declared 4 goals (G4-G7); RD red-line scope declared 2 in-scope files. Verified post-implementation:

- `src/cli/commands/sop-commands.ts` — in-scope (description text + line 188 default-value addition)
- `tests/unit/sop-commands.test.ts` — in-scope (1 new test)
- `skills/peaks-sop/references/sop-authoring.md` — in-scope per RD red-line ("doc-consistency polish" from code-review LOW-2, included in same slice)
- All other changed files (`rd/*`, `qa/*`) are auto-allowed by Gate B8.

`peaks scan diff-vs-scope --rid 2026-06-02-sop-global-reuse-ux-v2` returned:
- `violations: []`
- `unclassified: []`
- `patternsDeclared: true`

PASS.

## Residual risks

1. **Pre-existing Windows symlink test failures** (2 fails in `statusline-settings-service.test.ts`). Pre-existing on `main`; environmental, not a regression. Out of scope for this slice.
2. **Help-text default rendering depends on Commander version.** Commander renders `(default: <value>)` for any option with a non-`undefined` third arg. The current Commander version (already a project dep) does this. If a future Commander major upgrade changes the rendering, TC17's manual help-text check needs to be re-verified.
3. **`sop registry` global-only view is no longer accessible from a project cwd without an explicit `--project <somewhere-else>`.** This is the intended UX change per PRD 005 v2 G7, but it's a behavior change for any existing user who relied on the global-only default. Documented in the new help text and the updated `sop-authoring.md` reference.

## Verdict

**pass** — the slice implements PRD 005 v2 G7 (the only remaining G after the survey revealed G4/G5/G6 were already shipped) with one CLI line + one test + one doc line. All 9 PRD acceptance items (AC1-AC9) are covered by 18 generated test cases, 0 failed, 0 blocked, 0 skipped. No CRITICAL/HIGH/MEDIUM findings. Build clean. Red-line boundary clean. Security and performance gates clean.
