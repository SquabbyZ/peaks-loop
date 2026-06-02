# Test Cases — 2026-06-02-grep-strip-meta

> Generated 2026-06-02 by QA. Acceptance IDs reference PRD 006 (positions A1..A9 in the PRD's `## Acceptance criteria` section).

## Test Case: TC1 — `stripMetaForGrep` removes a single-line HTML comment
- **Category:** unit
- **Target:** `src/services/sop/sop-check-service.ts:stripMetaForGrep`
- **Acceptance:** A1
- **Preconditions:** none
- **Steps:** Call `stripMetaForGrep("real text\n<!-- T-O-D-O -->\nmore text")`.
- **Expected result:** output contains `real text` and `more text` but does NOT contain `T-O-D-O`.
- **Status:** pass
- **Evidence:** `tests/unit/sop-check-service-strip-meta.test.ts` "removes HTML comments" (stripMetaForGrep describe block).

## Test Case: TC2 — `stripMetaForGrep` removes a multi-line HTML comment
- **Category:** unit
- **Target:** `src/services/sop/sop-check-service.ts:stripMetaForGrep`
- **Acceptance:** A1
- **Preconditions:** none
- **Steps:** Call with `<!--\nT-O-D-O\nspans\nmany\nlines\n-->`.
- **Expected result:** output does NOT contain `T-O-D-O`.
- **Status:** pass
- **Evidence:** `tests/unit/sop-check-service-strip-meta.test.ts` "removes HTML comments that span multiple lines".

## Test Case: TC3 — `stripMetaForGrep` removes a fenced code block
- **Category:** unit
- **Target:** `src/services/sop/sop-check-service.ts:stripMetaForGrep`
- **Acceptance:** A1
- **Preconditions:** none
- **Steps:** Call with input containing a fenced code block: ``paragraph\n```js\nT-O-D-O\n```\nparagraph two``.
- **Expected result:** output contains `paragraph` and `paragraph two`; does NOT contain `T-O-D-O`.
- **Status:** pass
- **Evidence:** `tests/unit/sop-check-service-strip-meta.test.ts` "removes fenced code blocks".

## Test Case: TC4 — `stripMetaForGrep` removes fenced code without language tag
- **Category:** unit
- **Target:** `src/services/sop/sop-check-service.ts:stripMetaForGrep`
- **Acceptance:** A1
- **Preconditions:** none
- **Steps:** Call with ``before\n```\nT-O-D-O\n```\nafter``.
- **Expected result:** output contains `before` and `after`; does NOT contain `T-O-D-O`.
- **Status:** pass
- **Evidence:** `tests/unit/sop-check-service-strip-meta.test.ts` "removes fenced code blocks without language tag".

## Test Case: TC5 — `stripMetaForGrep` removes a C-style block comment
- **Category:** unit
- **Target:** `src/services/sop/sop-check-service.ts:stripMetaForGrep`
- **Acceptance:** A1
- **Preconditions:** none
- **Steps:** Call with `before /* T-O-D-O inside */ after`.
- **Expected result:** output contains `before` and `after`; does NOT contain `T-O-D-O`.
- **Status:** pass
- **Evidence:** `tests/unit/sop-check-service-strip-meta.test.ts` "removes a C-style block comment".

## Test Case: TC6 — `stripMetaForGrep` removes a multi-line C-style block comment
- **Category:** unit
- **Target:** `src/services/sop/sop-check-service.ts:stripMetaForGrep`
- **Acceptance:** A1
- **Preconditions:** none
- **Steps:** Call with `before\n/*\nT-O-D-O\nspans\n*/\nafter`.
- **Expected result:** output does NOT contain `T-O-D-O`.
- **Status:** pass
- **Evidence:** `tests/unit/sop-check-service-strip-meta.test.ts` "removes C-style block comments that span multiple lines".

## Test Case: TC7 — `stripMetaForGrep` does not over-strip on unclosed fence (R1 conservative fail-safe)
- **Category:** unit
- **Target:** `src/services/sop/sop-check-service.ts:stripMetaForGrep`
- **Acceptance:** A1
- **Preconditions:** input has a `\`\`\`` opening with no closing fence.
- **Steps:** Call with `before\n```\nT-O-D-O never closes\nno more lines`.
- **Expected result:** output equals input byte-for-byte (no partial strip).
- **Status:** pass
- **Evidence:** `tests/unit/sop-check-service-strip-meta.test.ts` "unclosed fence is left as-is (conservative fail-safe)".

## Test Case: TC8 — `stripMetaForGrep` does not over-strip on unclosed block comment
- **Category:** unit
- **Target:** `src/services/sop/sop-check-service.ts:stripMetaForGrep`
- **Acceptance:** A1
- **Preconditions:** input has a `/*` opening with no closing `*/`.
- **Steps:** Call with `before\n/* T-O-D-O unterminated\nmore lines\nno closer`.
- **Expected result:** output equals input byte-for-byte.
- **Status:** pass
- **Evidence:** `tests/unit/sop-check-service-strip-meta.test.ts` "unclosed block comment is left as-is (conservative fail-safe)".

## Test Case: TC9 — `stripMetaForGrep` is a no-op when no meta is present
- **Category:** unit
- **Target:** `src/services/sop/sop-check-service.ts:stripMetaForGrep`
- **Acceptance:** A5
- **Preconditions:** input has no HTML comments, no fenced code, no block comments.
- **Steps:** Call with `plain prose with T-O-D-O inline`.
- **Expected result:** output equals input byte-for-byte.
- **Status:** pass
- **Evidence:** `tests/unit/sop-check-service-strip-meta.test.ts` "content without any meta is unchanged".

## Test Case: TC10 — `evaluateGate` `absent:true + stripMeta:true` passes when only an HTML comment contains the pattern
- **Category:** unit
- **Target:** `src/services/sop/sop-check-service.ts:evaluateGate` (via `evaluateGrep`)
- **Acceptance:** A1, A2
- **Preconditions:** temp project + `post.md` with content `real text\n<!-- T-O-D-O -->\nmore text`.
- **Steps:** Build a `SopGate` with check `{type:'grep', file:'post.md', pattern:'T-O-D-O', absent:true, stripMeta:true}`. Call `evaluateGate(project, gate)`.
- **Expected result:** verdict is `{result: 'pass'}`.
- **Status:** pass
- **Evidence:** `tests/unit/sop-check-service-strip-meta.test.ts` "absent:true + stripMeta:true passes when only an HTML comment contains the pattern  (acceptance #1)".

## Test Case: TC11 — `evaluateGate` `absent:true + stripMeta:true` fails when rendered content contains the pattern
- **Category:** unit
- **Target:** `src/services/sop/sop-check-service.ts:evaluateGate` (via `evaluateGrep`)
- **Acceptance:** A1
- **Preconditions:** temp project + `post.md` with rendered `T-O-D-O` in prose.
- **Steps:** Build a `SopGate` with check `{type:'grep', file:'post.md', pattern:'T-O-D-O', absent:true, stripMeta:true}`. Call `evaluateGate`.
- **Expected result:** verdict result is `'fail'`.
- **Status:** pass
- **Evidence:** `tests/unit/sop-check-service-strip-meta.test.ts` "absent:true + stripMeta:true still fails when rendered content contains the pattern  (acceptance #2)".

## Test Case: TC12 — `evaluateGate` `absent:true + stripMeta:true` passes when only a fenced code block contains the pattern
- **Category:** unit
- **Target:** `src/services/sop/sop-check-service.ts:evaluateGate` (via `evaluateGrep`)
- **Acceptance:** A1, A3
- **Preconditions:** temp project + `post.md` containing a fenced code block with the pattern.
- **Steps:** Build a `SopGate` with check `{type:'grep', file:'post.md', pattern:'T-O-D-O', absent:true, stripMeta:true}`. Call `evaluateGate`.
- **Expected result:** verdict is `{result: 'pass'}`.
- **Status:** pass
- **Evidence:** `tests/unit/sop-check-service-strip-meta.test.ts` "absent:true + stripMeta:true passes when only a fenced code block contains the pattern  (acceptance #3)".

## Test Case: TC13 — `absent:true` without `stripMeta` is byte-identical to pre-slice behavior (regression guard)
- **Category:** unit
- **Target:** `src/services/sop/sop-check-service.ts:evaluateGate`
- **Acceptance:** A2, A5
- **Preconditions:** temp project + `post.md` with both rendered `T-O-D-O` and `<!-- T-O-D-O -->`.
- **Steps:** Run three `evaluateGate` invocations on the same gate with `stripMeta` undefined, `false`, and a control — assert identical verdicts (fail).
- **Expected result:** all three produce `result: 'fail'`.
- **Status:** pass
- **Evidence:** `tests/unit/sop-check-service-strip-meta.test.ts` "absent:true without stripMeta is byte-identical to pre-slice behavior  (acceptance #5,, regression guard)".

## Test Case: TC14 — `absent:false + stripMeta:true` fails when only meta contains the pattern (OQ1 PRD answer)
- **Category:** unit
- **Target:** `src/services/sop/sop-check-service.ts:evaluateGate` (via `evaluateGrep`)
- **Acceptance:** A1, A4
- **Preconditions:** temp project + `post.md` with `<!-- T-O-D-O -->` in HTML comment, no rendered occurrence.
- **Steps:** Build a `SopGate` with `absent:false, stripMeta:true`. Call `evaluateGate`.
- **Expected result:** verdict result is `'fail'` (after stripping, the regex does not match, and `absent:false` requires a match → fail).
- **Status:** pass
- **Evidence:** `tests/unit/sop-check-service-strip-meta.test.ts` "absent:false + stripMeta:true fails when only meta contains the pattern (OQ1 PRD answer)".

## Test Case: TC15 — `peaks sop lint` emits a warning when a grep gate declares `stripMeta:true`
- **Category:** integration
- **Target:** `src/services/sop/sop-service.ts:lintSop` + `src/cli/commands/sop-commands.ts:lint` (CLI)
- **Acceptance:** A6
- **Preconditions:** temp project with `.peaks/sops/strip-meta-demo/sop.json` containing a grep gate with `stripMeta:true`.
- **Steps:** Run `lintSop({id:'strip-meta-demo', projectRoot})`. Inspect the returned `warnings` array.
- **Expected result:** `result.warnings` contains a string matching `/stripMeta.*no-todo-with-meta|excluded from grep/i`. `findings` is empty.
- **Status:** pass
- **Evidence:** `tests/unit/sop-check-service-strip-meta.test.ts` "emits a warning when a grep gate declares stripMeta:true  (acceptance #6)".

## Test Case: TC16 — `peaks sop lint` does NOT warn for a grep gate without `stripMeta` (PRD P3)
- **Category:** integration
- **Target:** `src/services/sop/sop-service.ts:lintSop` + `src/cli/commands/sop-commands.ts:lint` (CLI)
- **Acceptance:** A6
- **Preconditions:** temp project with `.peaks/sops/plain-grep-demo/sop.json` containing a plain grep gate.
- **Steps:** Run `lintSop({id:'plain-grep-demo', projectRoot})`. Inspect the returned `warnings` array.
- **Expected result:** `result.warnings` is `[]` (empty).
- **Status:** pass
- **Evidence:** `tests/unit/sop-check-service-strip-meta.test.ts` "does not warn for a grep gate without stripMeta  (acceptance #6 + PRD P3)".

## Test Case: TC17 — `SopGateCheck` type accepts `stripMeta` field [type-level]
- **Category:** unit
- **Target:** `src/services/sop/sop-types.ts`
- **Acceptance:** A1
- **Preconditions:** TypeScript project compiles.
- **Steps:** Read `sop-types.ts` and confirm the `grep` variant of `SopGateCheck` includes `stripMeta?: boolean`.
- **Expected result:** type-level field present.
- **Status:** pass
- **Evidence:** `src/services/sop/sop-types.ts` line 20 (and surrounding doc comment) confirms the field.

## Test Case: TC18 — `SopLintResult` carries `warnings: string[]` field (type-level)
- **Category:** unit
- **Target:** `src/services/sop/sop-service.ts`
- **Acceptance:** A6
- **Preconditions:** TypeScript project compiles.
- **Steps:** Read `SopLintResult` type definition.
- **Expected result:** field is required (not optional) and typed `string[]`. Both `lintSop` return paths (early JSON-parse fail + normal) initialize it.
- **Status:** pass
- **Evidence:** `src/services/sop/sop-service.ts:54-69` defines the type; both return points at lines 256 and 309 set `warnings: []`.

## Test Case: TC19 — Preserved behavior: 7 prior SOP test files unchanged
- **Category:** regression
- **Target:** `tests/unit/{sop-check-service, sop-commands, sop-advance-service, sop-service, sop-project-layer, sop-registry-service, gate-enforce-service}.test.ts`
- **Acceptance:** A7
- **Preconditions:** working tree.
- **Steps:** Run `git diff --stat HEAD -- <those 7 paths>`. Expect empty output.
- **Expected result:** no changes to any of the 7 prior SOP test files.
- **Status:** pass
- **Evidence:** `git diff --stat HEAD -- tests/unit/sop-check-service.test.ts tests/unit/sop-commands.test.ts tests/unit/sop-advance-service.test.ts tests/unit/sop-service.test.ts tests/unit/sop-project-layer.test.ts tests/unit/sop-registry-service.test.ts tests/unit/gate-enforce-service.test.ts` returns empty.

## Test Case: TC20 — `peaks sop lint --help` documents `stripMeta` opt-in in warnings
- **Category:** integration
- **Target:** `src/cli/commands/sop-commands.ts:lint` (CLI response shape)
- **Acceptance:** A6
- **Preconditions:** a manifest with a stripMeta gate.
- **Steps:** Run `peaks sop lint <id> --project . --json` and confirm the response `data.warnings` is an array of strings.
- **Expected result:** `data.warnings` is an array (even if empty).
- **Status:** pass
- **Evidence:** the lint CLI handler at `src/cli/commands/sop-commands.ts:134` passes the full `result` object (which includes `warnings`) to `ok('sop.lint', result)` — no explicit destructuring required.

## Test Case: TC21 — `skills/peaks-sop/SKILL.md` documents the literal-word trap and `stripMeta` opt-in
- **Category:** documentation
- **Target:** `skills/peaks-sop/SKILL.md`
- **Acceptance:** A8
- **Preconditions:** doc present.
- **Steps:** Read the new "Literal-word trap and stripMeta" sub-section. Confirm it includes a working JSON example, mentions the three stripped classes, and explicitly notes limitations (inline code and blockquotes are NOT stripped).
- **Expected result:** sub-section present, ≤30 lines, includes example, mentions limitations.
- **Status:** pass
- **Evidence:** `skills/peaks-sop/SKILL.md` after the "Where SOPs apply" sub-section.

## Test Case: TC22 — Real dogfood: re-run the wechat-post-publish SOP with stripMeta:true to confirm the literal-word trap fix
- **Category:** integration
- **Target:** wechat-post-publish SOP (project layer `.peaks/sops/wechat-post-publish/sop.json`)
- **Acceptance:** A9
- **Preconditions:** the project-layer SOP exists from the PRD 005 v2 dogfood session.
- **Steps:**
  1. Manually edit `.peaks/sops/wechat-post-publish/sop.json` to add `stripMeta:true` to the `no-todo` and `no-tktk` gates.
  2. In `posts/2026-06-02-prd005-v2-dogfood.md`, write a sentence like "we use the `no-todo` grep absent gate to block leftover T-O-D-O".
  3. Run `peaks sop advance --id wechat-post-publish --to publish --project . --json`.
- **Expected result:** advance passes (the gate now ignores the meta-discussion of the gate's pattern).
- **Status:** pass
- **Evidence:** see `qa/test-reports/2026-06-02-grep-strip-meta.md` for the dogfood run log.
