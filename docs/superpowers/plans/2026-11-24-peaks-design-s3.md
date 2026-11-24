# peaks design — S3 Implementation Plan (gate wiring)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `peaks design check` from a report into a gate: `--gate` writes conformance evidence, a new `DESIGN_CONFORMANCE` prerequisite blocks `rd:qa-handoff` for feature/bugfix slices, and `verify-pipeline` reads the same evidence — never a pass when the check did not run.

**Architecture:** A new `src/services/design/design-evidence.ts` renders and writes `design/check-<rid>.md` + `.json` under `.peaks/_runtime/<sessionId>/`; `design-commands.ts` gains `--gate`; `artifact-prerequisites.ts` imports a new `design-conformance-prerequisite.ts` and adds it to `FEATURE_TABLE` + `BUGFIX_TABLE` `rd:qa-handoff` (REFACTOR is the same object — do not double-add); `RD_EVIDENCE_GATES` gains one row so `verify-pipeline` covers it. The check's change-set resolution (rid claims / `--files` / git base) and the unknown→`blocked` rule already exist and are not re-implemented.

**Tech Stack:** TypeScript ESM, Node ≥24 (`node:crypto`), Commander CLI, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-23-peaks-design-governance-design.md` (§7.1, §8.1, §8.2, §8.6, §13)

## Global Constraints

- **Never pass without evidence.** Missing engine/browser/URL/change set stays `blocked`; `--gate` must write the blocked verdict, never a pass.
- `--gate` is the **only writer** of `design/check-<rid>.md`; RD hand-writing that file is a violation (QA samples for it).
- The evidence path is `<sessionId>/design/check-<rid>.md`; both `<sessionId>` and `<rid>` must be a single path segment (reuse the existing single-segment rule).
- `DESIGN_CONFORMANCE` is added **once** to `FEATURE_TABLE` and **once** to `BUGFIX_TABLE`; `REFACTOR_TABLE` is a reference to `FEATURE_TABLE`. Not in `MINIMAL_TABLE` / `CONFIG_TABLE`.
- `backCompat: true` with `backCompatUntil` = the minor **after** the release that ships S3 (planning value: `v4.5.0`; rewrite only if S3 ships in a different minor).
- File-size budget: `artifact-prerequisites.ts` is 603 lines (cap 300). The new prerequisite lives in its own module; the net line count of the host file must not rise above the census, or the monotonic baseline refuses. If it does, trim an equal number of comment lines in the same file — never raise the baseline.
- BDD triple (`// given: // when: // then:`) as the first three consecutive comments; `.js` specifiers; prettier; eslint 0 on touched files; every new src file ≤300 raw lines, tests ≤500.
- Stage only in RD tasks; the orchestrator commits after QA.

## Review Focus

- **`--gate` without `--rid` or session:** must exit 3 and write nothing; a half-written evidence file would let a later gate read a stale verdict.
- **Verdict mapping:** `acceptedBy` present must emit `design-conformance: accepted` even though the result verdict is `pass`; a plain pass must not.
- **fail/blocked evidence:** the file is still written (so QA can read it) but must NOT satisfy `mustContainAny`; a fail that satisfies the gate is the worst failure mode.
- **Prereq scope:** docs/config/chore must not gain the prerequisite; `verify-pipeline` must skip it for those types via the table lookup, not a second condition.
- **Path traversal:** a `--rid` or session id containing `..`, `/` or `\` must be refused before any write.

---

### Task 1: Evidence renderer and writer

**Files:**
- Create: `src/services/design/design-evidence.ts`
- Test: `tests/unit/design/design-evidence.test.ts`

**Interfaces:**
- Produces: `ConformanceMarker = 'pass' | 'fail' | 'blocked' | 'not-adopted' | 'not-applicable' | 'accepted'`; `markerOf(result: DesignCheckResult): ConformanceMarker` (acceptedBy wins over verdict); `sha256OfResult(result: DesignCheckResult): string` (sha256 hex of `JSON.stringify` of the result with keys in declaration order); `renderConformanceMarkdown(result, meta): string`; `writeConformanceEvidence(input: { projectRoot; sessionId; rid; result; now?: () => Date }): Promise<{ markdownPath; jsonPath; sha256 }>` writing both files under `.peaks/_runtime/<sessionId>/design/`.
- Markdown shape (literal lines; `mustContain` reads them):

```md
schemaVersion: 1
rid: <rid>
session: <sessionId>
generatedAt: <ISO>
sha256: <hex>

## Design conformance
design-conformance: <marker>

## Surface
- isUi: <true|false|unknown>
- reason: <each reason>

## Checks
- g1_source: <status> (<n> findings)
- g2_render: <status>

## Findings
- (none)
```

- JSON shape: the result object plus `{ session, generatedAt, sha256, evidencePath }`.

- [ ] **Step 1: Write the failing tests**

```ts
// design-evidence.test.ts — first three comments are the BDD triple
it('when acceptedBy is set, should mark accepted rather than pass', () => {
  expect(markerOf({ ...baseResult, verdict: 'pass', acceptedBy: 'session-1' })).toBe('accepted');
});
it('when the verdict is fail, should still write evidence and carry design-conformance: fail', async () => { /* write, read md */ });
it('when the json is re-read, should carry a sha256 that matches a recomputation over the object without it', async () => { /* ... */ });
it('when rid or session contains a path separator, should refuse before writing', async () => { /* ../x, a/b */ });
it('when the session dir is missing, should create .peaks/_runtime/<sid>/design/', async () => { /* ... */ });
```

- [ ] **Step 2: Run it and confirm it fails** — `npx vitest run --config vitest.config.ts tests/unit/design/design-evidence.test.ts` → module not found.
- [ ] **Step 3: Implement the module** — `node:crypto` `createHash('sha256')`; `mkdirSync(dir, { recursive: true })`; reuse `getSessionId`'s single-segment validation (export it from acceptance if needed) or a local `/^[A-Za-z0-9._-]+$/` check that also rejects `.`/`..`.
- [ ] **Step 4: Run the tests** — the file is green; `npx tsc --noEmit` 0.
- [ ] **Step 5: Stage only** — `git add src/services/design/design-evidence.ts tests/unit/design/design-evidence.test.ts`.

---

### Task 2: `--gate` on `peaks design check`

**Files:**
- Modify: `src/cli/commands/design-commands.ts`
- Test: `tests/unit/cli/design-commands.test.ts` (extend the existing file)

**Interfaces:**
- New flags: `--gate` (boolean). With `--gate`, `--rid` is required and a session must resolve (`--session-id` or the active binding); otherwise the command exits 3 with `DESIGN_GATE_REQUIRES_RID` / `DESIGN_GATE_REQUIRES_SESSION` and writes nothing.
- On success the emitted envelope's `data` gains `evidencePath` and `sha256`; the exit code is still `exitCodeForVerdict(result.verdict)`.
- A write failure exits 3 with `DESIGN_EVIDENCE_WRITE_FAILED` (the verdict is not printed as a pass).

- [ ] **Step 1: Write the failing tests** — `--gate --files a.tsx` without rid → exit 3 and no file under `design/`; with rid + `--session-id s1` → `check-r1.md` and `.json` exist, `data.evidencePath` ends with `design/check-r1.md`; a failing G1 result still writes and exits 1 with `design-conformance: fail`.
- [ ] **Step 2: Run and confirm failure** — `npx vitest run --config vitest.config.ts tests/unit/cli/design-commands.test.ts`.
- [ ] **Step 3: Implement** — validate rid/session before `checkDesign`, write after it, then `printResult` with the extended data. Do not move the exit-code assignment.
- [ ] **Step 4: Verify** — the CLI test file green; `npx tsc --noEmit` 0; run `node node_modules/tsx/dist/cli.mjs src/cli/index.ts design check --project . --gate --rid <rid> --session-id <sid>` against this repo to confirm the evidence pair lands under `.peaks/_runtime/<sid>/design/`.
- [ ] **Step 5: Stage only.**

---

### Task 3: The `DESIGN_CONFORMANCE` prerequisite

**Files:**
- Create: `src/services/artifacts/design-conformance-prerequisite.ts`
- Modify: `src/services/artifacts/artifact-prerequisites.ts` (import + one entry in each of two tables)
- Test: `tests/unit/artifacts/design-conformance-prerequisite.test.ts`

**Interfaces:**
- Produces: `DESIGN_CONFORMANCE: ArtifactPrerequisite` with `relativePath: 'design/check-<rid>.md'`, `mustContain: ['schemaVersion: 1', 'sha256:', '## Design conformance']`, `mustContainAny: ['design-conformance: pass', 'design-conformance: not-applicable', 'design-conformance: not-adopted', 'design-conformance: accepted']`, `backCompat: true`, `backCompatUntil: 'v4.5.0'`.
- Adds it to `FEATURE_TABLE['rd:qa-handoff']` and `BUGFIX_TABLE['rd:qa-handoff']` only.

- [ ] **Step 1: Write the failing tests** — `PREREQUISITES_BY_TYPE.feature['rd:qa-handoff']` and `.bugfix` contain it; `.docs`, `.config`, `.chore` do not; `.refactor` does (alias); a body with all markers passes `checkPrerequisites`, a body with `design-conformance: fail` fails, a body missing `## Design conformance` fails; a missing file yields a `design-conformance-…` backCompat warning, not a hard failure.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement** the constant in the new module and wire the two tables.
- [ ] **Step 4: Budget check** — `node .husky/peaks-gate-baseline.mjs` must not raise `fileSizeExcessLines`; if it would, delete equal comment lines in `artifact-prerequisites.ts` and regenerate.
- [ ] **Step 5: Run the whole `tests/unit`** (whole tree, not a subset) and fix any pinned counts — report each pin you changed and why.
- [ ] **Step 6: Stage only.**

---

### Task 4: `verify-pipeline` coverage

**Files:**
- Modify: `src/services/workflow/pipeline-verify-rd-phase.ts`
- Test: `tests/unit/services/workflow/pipeline-verify-rd-gates.test.ts`

**Interfaces:**
- Adds one `RD_EVIDENCE_GATES` row: `{ name: 'design-conformance', description: 'Design conformance evidence (peaks design check --gate)', relativePath: 'design/check-<rid>.md' }`.

- [ ] **Step 1: Write the failing tests** — the production binding `rdGatesForType('feature')` names `design-conformance`; `rdGatesForType('docs')` does not (an injected synthetic lookup deliberately carries every row, so it cannot prove the conditional); a table with the path but no file fails that gate and names the path.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement** the one row (no new condition — the table lookup is the condition).
- [ ] **Step 4: Verify** — the file's tests plus `tests/unit/prd/` green; `npx tsc --noEmit` 0.
- [ ] **Step 5: Stage only.**

---

### Task 5: Repair-loop semantics and role prose

**Files:**
- Modify: `skills/bee/peaks-rd/SKILL.md`, `skills/bee/peaks-ui/SKILL.md`, `skills/bee/peaks-qa/SKILL.md`, `skills/bee/peaks-txt/SKILL.md`, `skills/peaks-design/SKILL.md`
- Test: `tests/unit/skills/loop-hygiene-block.test.ts` (must stay green — do not touch the block)

**Content (one short block each, no CLI verbs for the user):**
- `peaks-rd`: read `design/contract.md` + `paved-road.json`; deliver with `peaks design check --gate`; a `fail` returns to RD inside the existing 3-round repair budget, a `blocked` does not consume a round.
- `peaks-ui`: design-draft cites contract sections; prototypes use `componentEntrypoints`.
- `peaks-qa`: read `check-<rid>.json`; test cases include the design regression seed.
- `peaks-txt`: the context capsule records the contract version and the latest check verdict.
- `peaks-design`: gate semantics §8.6 (fail counts a round; blocked does not; 3 rounds → blocked TXT handoff).

- [ ] **Step 1: Edit the five files**; leave the `peaks:loop-hygiene` block byte-identical.
- [ ] **Step 2: Verify** — `npx vitest run --config vitest.config.ts tests/unit/skills/` green (block identity + skill presence).
- [ ] **Step 3: Stage only.**

---

### Task 6: Pilot on ModelMatrix (runs after Tasks 1–4 land)

**Files:**
- Create (outside this repo): `D:\projects\ModelMatrix-pilot` worktree on branch `pilot/peaks-design` from `origin/develop`.
- Create: `.peaks/_runtime/<sessionId>/design/pilot-report.md` (this session).

- [ ] **Step 1: Worktree** — `git -C D:\projects\ModelMatrix worktree add ..\ModelMatrix-pilot -b pilot/peaks-design origin/develop`; do not touch the local dirty tree.
- [ ] **Step 2: Baseline** — record inline-style count, raw colour count, token coverage, and designlang `slop`/`grade` when the engine is available, under `.peaks/_runtime/<sid>/design/baseline/`.
- [ ] **Step 3: `design init`** with the spec's contract root `web/design/`, `pageRoots` = `web/src/routes` + `web/src/features`, `componentEntrypoints` = `@/components/ui`, excluding `web/src/components/ui`; two exemplar archetypes (list `features/channels`, form `features/subscriptions`).
- [ ] **Step 4: Change set** — one UI change on each archetype; run `peaks design check --gate`; record verdict, findings, and the round count to green.
- [ ] **Step 5: Metrics** — fill the spec's five pilot metrics in the report; every number traces to a file or command output.

---

## Execution order

Tasks 1 → 2 → 3 → 4 → 5 are sequential (2 consumes 1; 3 and 4 are independent after 1; 5 is prose). Task 6 runs after 4 and can be deferred if the ModelMatrix worktree is unavailable — record the deferral rather than a green claim.

## Release note

S3 is a **minor** release (new gate for feature/bugfix). At release time set `backCompatUntil` to the minor after the release that ships it (`v4.5.0` if S3 ships in 4.4.0) and write the CHANGELOG entry listing the new prerequisite and its window.
