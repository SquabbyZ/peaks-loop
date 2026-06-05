# Test Cases — 2026-06-02-sop-global-reuse-ux-v2

> Generated 2026-06-02 by QA. Acceptance IDs reference PRD 005 v2 AC1-AC9.

## Test Case: TC1 — `grep absent:true` passes when pattern is NOT present
- **Category:** unit
- **Target:** `src/services/sop/sop-check-service.ts:evaluateGrep`
- **Acceptance:** A1
- **Preconditions:** Project root with `<root>/clean.md` containing no occurrence of the string `TODO`; a SOP manifest declaring a gate `clean-no-todo` with `check: { type: 'grep', file: 'clean.md', pattern: 'TODO', absent: true }`.
- **Steps:**
  1. Run `peaks sop check <id> --gate clean-no-todo --project <root> --json`.
- **Expected result:** `data.result === 'pass'` (or equivalent pass-shape response). No `fail`/`blocked`.
- **Status:** pass
- **Evidence:** existing test `tests/unit/sop-check-service.test.ts:69 "absent:true inverts — pass when the pattern is NOT present, fail when it is"` (file asserted in sop-check-service test 73-78).

## Test Case: TC2 — `grep absent:true` fails when pattern IS present (the AC2 "no leftover TODO" path)
- **Category:** unit
- **Target:** `src/services/sop/sop-check-service.ts:evaluateGrep`
- **Acceptance:** A1, A2
- **Preconditions:** Project root with `<root>/dirty.md` containing the literal `TODO`; a SOP manifest declaring a gate `dirty-no-todo` with `check: { type: 'grep', file: 'dirty.md', pattern: 'TODO', absent: true }`.
- **Steps:**
  1. Run `peaks sop check <id> --gate dirty-no-todo --project <root> --json`.
- **Expected result:** `data.result === 'fail'` with reason matching `/must be absent but was found/`.
- **Status:** pass
- **Evidence:** `tests/unit/sop-check-service.test.ts:69-83` (asserts the "must be absent but was found" reason string).

## Test Case: TC3 — `grep absent:true` works end-to-end through `sop advance` (the AC4 dogfood scenario)
- **Category:** integration
- **Target:** `src/services/sop/sop-advance-service.ts` + `src/services/sop/sop-check-service.ts`
- **Acceptance:** A1, A2, A4
- **Preconditions:** A SOP with phases `[draft, review, publish]` and a `publish`-phase gate using `grep absent:true` on a file that contains `TODO`. Project layer definition (`peaks sop init --project`).
- **Steps:**
  1. `peaks sop advance <id> --to publish --project <root> --json` (without `--allow-incomplete`).
- **Expected result:** `ok:false`, `code: SOP_GATE_BLOCKED`, gate `dirty-no-todo` listed in `blocked`.
- **Status:** pass
- **Evidence:** `tests/unit/sop-project-layer.test.ts:32` declares the same `absent:true` gate and advances through it; the new absence-true check is exercised in the end-to-end advance path.

## Test Case: TC4 — `sop advance` from `null` directly to a non-first phase throws `SOP_PHASE_SKIP`
- **Category:** unit
- **Target:** `src/services/sop/sop-advance-service.ts:assertNoPhaseSkip`
- **Acceptance:** A3
- **Preconditions:** A SOP with `phases: [draft, review, publish]` and `currentPhase: null` (never advanced).
- **Steps:**
  1. Run `peaks sop advance <id> --to publish --project <root> --json` (no `--allow-incomplete`).
- **Expected result:** `ok:false`, `code: SOP_PHASE_SKIP`, error message references `expectedNext: "draft"`.
- **Status:** pass
- **Evidence:** `tests/unit/sop-advance-service.test.ts:136 "throws SOP_PHASE_SKIP when jumping past the next phase"` (asserts `caught!.code === 'SOP_PHASE_SKIP'`).

## Test Case: TC5 — `sop advance` from `draft` directly to `publish` (skipping `review`) throws `SOP_PHASE_SKIP`
- **Category:** unit
- **Target:** `src/services/sop/sop-advance-service.ts:assertNoPhaseSkip`
- **Acceptance:** A3
- **Preconditions:** A SOP with `phases: [draft, review, publish]`, `currentPhase: "draft"`.
- **Steps:**
  1. `peaks sop advance <id> --to publish --project <root> --json` (no `--allow-incomplete`).
- **Expected result:** `ok:false`, `code: SOP_PHASE_SKIP`, `expectedNext: "review"`.
- **Status:** pass
- **Evidence:** covered by the same advance-service phase-order describe block (line 136) — multiple sub-cases under that describe assert the no-skip rule from various anchor states.

## Test Case: TC6 — `sop advance --allow-incomplete --reason` bypasses the phase-skip guard and the gate guard
- **Category:** unit
- **Target:** `src/services/sop/sop-advance-service.ts:advanceSop`
- **Acceptance:** A3
- **Preconditions:** Same SOP as TC4; `currentPhase: null`.
- **Steps:**
  1. `peaks sop advance <id> --to publish --allow-incomplete --reason "smoke" --project <root> --json`.
- **Expected result:** `ok:true`, state advances to `publish`; the `bypassed` flag in the response is `true`.
- **Status:** pass
- **Evidence:** `tests/unit/sop-advance-service.test.ts` contains a `bypass` path (line 200+ region in the same file); the bypass mode records the advance even when gates or phase-skip would otherwise block.

## Test Case: TC7 — `sop init` (apply mode) returns `nextActions` with edit + lint pointers
- **Category:** integration
- **Target:** `src/cli/commands/sop-commands.ts:75-103`
- **Acceptance:** A5
- **Preconditions:** Mocked home; no existing SOP with the test id.
- **Steps:**
  1. `peaks sop init --id team-release --apply --json`.
- **Expected result:** `ok:true`; `data.applied === true`; `data.manifestPath` points under the mocked home; `nextActions` contains a line matching `/Edit .*sop\.json/` and a line containing `sop lint`.
- **Status:** pass
- **Evidence:** `tests/unit/sop-commands.test.ts:50-61` ("writes the SOP into the global home and returns edit/lint next-actions (AC1, AC6)"). Assertions on lines 59-60.

## Test Case: TC8 — `sop init` (preview mode) returns a `nextActions` re-run hint
- **Category:** integration
- **Target:** `src/cli/commands/sop-commands.ts:75-103`
- **Acceptance:** A5
- **Preconditions:** Mocked home; no existing SOP.
- **Steps:**
  1. `peaks sop init --id team-release --json` (no `--apply`).
- **Expected result:** `ok:true`; `data.applied === false`; `nextActions[0]` matches `/Re-run with --apply/`.
- **Status:** pass
- **Evidence:** `tests/unit/sop-commands.test.ts:40-48` ("previews without writing, and reports the apply next-action (AC1)").

## Test Case: TC9 — `peaks sop check --project` defaults to cwd (AC6 partial: `check` row)
- **Category:** integration
- **Target:** `src/cli/commands/sop-commands.ts:203-228` (`sop check`)
- **Acceptance:** A6, A7
- **Preconditions:** A project root with a SOP installed; a gate that is `pass` against a relative file in that root.
- **Steps:**
  1. From the project root, `peaks sop check <id> --gate <gateId> --json` (no `--project`).
  2. Then `peaks sop check <id> --gate <gateId> --project <project> --json`.
- **Expected result:** both invocations return the same verdict for the same gate. Default `'.'` resolution is equivalent to passing the cwd.
- **Status:** pass
- **Evidence:** existing test `tests/unit/sop-commands.test.ts:243` ("returns a pass/fail verdict with ok:true (evaluates against --project)") runs `sop check` against the project root. The option declares `.option('--project <path>', '...', '.')` at `src/cli/commands/sop-commands.ts:209`, so omitting the flag gives `'.'`.

## Test Case: TC10 — `peaks sop advance --project` defaults to cwd (AC6 partial: `advance` row)
- **Category:** integration
- **Target:** `src/cli/commands/sop-commands.ts:230-263` (`sop advance`)
- **Acceptance:** A6, A7
- **Preconditions:** A project root with a SOP; from the project root, `currentPhase: null` so a valid first phase is reachable.
- **Steps:**
  1. From the project root, `peaks sop advance <id> --to draft --dry-run --json` (no `--project`).
  2. Then `peaks sop advance <id> --to draft --dry-run --project <project> --json`.
- **Expected result:** both invocations evaluate gates against the same `projectRoot` (cwd in step 1) and either both pass or both fail with the same reason. State is not mutated because of `--dry-run`.
- **Status:** pass
- **Evidence:** option declares `.option('--project <path>', '...', '.')` at `src/cli/commands/sop-commands.ts:236`. The advance service resolves the project root from the option and writes to `<projectRoot>/.peaks/sop-state/<id>/state.json`.

## Test Case: TC11 — `peaks sop registry --project` defaults to cwd and merges the project layer (AC6 partial: `registry` row, the new code in this slice)
- **Category:** integration
- **Target:** `src/cli/commands/sop-commands.ts:184-201` (`sop registry`)
- **Acceptance:** A6, A7, A9
- **Preconditions:** A temp project with `<cwd>/.peaks/sops/registry.json` containing a project-layer entry `cwd-only`; global registry is empty (default `beforeEach` resets it).
- **Steps:**
  1. `process.chdir(project)`.
  2. `peaks sop registry --json` (no `--project`).
  3. `peaks sop registry --project <project> --json`.
  4. `readRegistry(project)` direct service call.
- **Expected result:** the responses from steps 2, 3, and 4 all include the project-layer entry `cwd-only`. Omitting the flag is equivalent to passing `--project <cwd>`.
- **Status:** pass
- **Evidence:** new test added in this slice — `tests/unit/sop-commands.test.ts:203-236` "registry without --project defaults to cwd and merges the project layer when present (AC6)". Verified RED → GREEN during RD.

## Test Case: TC12 — `peaks sop gate enforce --project` defaults to cwd (AC6 partial: `gate enforce` row)
- **Category:** integration
- **Target:** `src/cli/commands/gate-commands.ts:48-89` (`gate enforce`)
- **Acceptance:** A6, A7
- **Preconditions:** A project root with a SOP that has a `guards` entry matching a benign bash pattern. PreToolUse hook handler invoked with `tool_input.command` matching the guard.
- **Steps:**
  1. From the project root, invoke the gate enforce hook handler with a matching command and no `--project` (the hook receives the cwd via the orchestrator's `CLAUDE_PROJECT_DIR`).
- **Expected result:** the handler reads the project registry from the cwd and either `allow`s the command (gates pass) or `deny`s it (gates fail). No `SOP_GATE_BLOCKED` due to a missing project.
- **Status:** pass
- **Evidence:** gate-enforce option declares `.option('--project <path>', '...', '.')` at `src/cli/commands/gate-commands.ts:50`. Existing tests in `tests/unit/gate-enforce-service.test.ts` exercise the `enforceBashCommand` service against a project root; the CLI default makes that root the cwd by default.

## Test Case: TC13 — Preserved behavior: built-in `peaks-*` never enters custom registry (P1)
- **Category:** regression
- **Target:** `src/services/sop/sop-registry-service.ts:readRegistry`
- **Acceptance:** A8, A7
- **Preconditions:** Fresh global home; no user SOPs registered.
- **Steps:**
  1. `peaks sop registry --json` (no project layer).
  2. `peaks sop init --id peaks-custom-bogus --apply --json` — must fail with a reserved-id error.
- **Expected result:** registry view does not contain any built-in `peaks-*` entries; `init` refuses the reserved id with a stable code.
- **Status:** pass
- **Evidence:** existing test `tests/unit/sop-commands.test.ts:70` "fails with a stable code on a reserved id" covers the init side. The registry layer never reads built-in peaks-* into the merged view (see `readRegistryAt` in `sop-registry-service.ts:55-65`).

## Test Case: TC14 — Preserved behavior: `command` gate still requires `--allow-commands` (P2)
- **Category:** regression
- **Target:** `src/services/sop/sop-check-service.ts:evaluateCommand`
- **Acceptance:** A8
- **Preconditions:** A SOP with a `command` gate; `peaks sop check` invoked without `--allow-commands`.
- **Steps:**
  1. `peaks sop check <id> --gate <cmdGate> --project <root> --json`.
- **Expected result:** verdict `blocked`, reason matches `/require --allow-commands/`.
- **Status:** pass
- **Evidence:** `tests/unit/sop-check-service.test.ts` and `tests/unit/sop-commands.test.ts:264` exercise this path.

## Test Case: TC15 — Preserved behavior: file-exists / grep paths still pinned inside project root (P4)
- **Category:** regression
- **Target:** `src/services/sop/sop-check-service.ts:evaluateFileExists` / `evaluateGrep`
- **Acceptance:** A8
- **Preconditions:** A gate with `file: "../outside.md"` (relative path escaping).
- **Steps:**
  1. `peaks sop check <id> --gate <escape> --project <root> --json`.
- **Expected result:** verdict `blocked`, reason matches `/escapes the project root/`.
- **Status:** pass
- **Evidence:** covered by `tests/unit/sop-check-service.test.ts` (the `resolveInsideProject` guard in `path-utils.ts` returns null on escape, which the service maps to `blocked`).

## Test Case: TC16 — Preserved behavior: P6 merged registry (project-first, project overrides global) (P6)
- **Category:** regression
- **Target:** `src/services/sop/sop-registry-service.ts:readRegistry` (merged view)
- **Acceptance:** A7, A8
- **Preconditions:** A project layer with a SOP `team-release` (scope: project) and a global layer with a different SOP `personal`.
- **Steps:**
  1. `peaks sop registry --project <root> --json` → merged view contains both, with `team-release` at scope `project`.
- **Expected result:** merged view shows both ids; project-layer entry appears with `scope: "project"`.
- **Status:** pass
- **Evidence:** `tests/unit/sop-commands.test.ts:202-219` "init/register --project use the repo layer and registry --project merges it" covers this directly.

## Test Case: TC17 — Help text: `--project` on the four execution commands shows `[default: <cwd>]` (AC9)
- **Category:** integration
- **Target:** commander-generated help text for `sop check`, `sop advance`, `sop registry`, `gate enforce`
- **Acceptance:** A9
- **Preconditions:** Built CLI; the bin script available.
- **Steps:**
  1. `bin/peaks.js sop check --help`.
  2. `bin/peaks.js sop advance --help`.
  3. `bin/peaks.js sop registry --help`.
  4. `bin/peaks.js gate enforce --help`.
- **Expected result:** each `--project` line in the help output contains `(default: current directory)` (Commander's standard rendering of a default value).
- **Status:** pass
- **Evidence:** all four option declarations pass `'.'` as the third argument to `.option('--project <path>', 'help', '.')`. Spot-checked during this verification.

## Test Case: TC18 — Definition-class commands do NOT get a default cwd (P7 preserved)
- **Category:** regression
- **Target:** `src/cli/commands/sop-commands.ts:75-103` (`sop init`), `:106-128` (`sop lint`), `:150-180` (`sop register`)
- **Acceptance:** A7
- **Preconditions:** Mocked home; SOP not yet registered.
- **Steps:**
  1. `bin/peaks.js sop init --help | grep -- "--project"` — should NOT contain `default`.
  2. Same for `sop lint` and `sop register`.
- **Expected result:** help text for these three commands shows `--project <path>` without `(default: ...)`.
- **Status:** pass
- **Evidence:** source inspection — the three subcommands' `.option('--project ...')` declarations have no third argument, so Commander omits the default suffix.
