# Security Findings — 2026-06-02-sop-global-reuse-ux-v2

- reviewer: QA (reusing RD self-review, plus independent QA-side re-walk)
- review date: 2026-06-02
- verdict: **PASS** — no CRITICAL / HIGH / MEDIUM / LOW issues

## Scope reviewed

- `src/cli/commands/sop-commands.ts` (description text + one-line default-value addition on `sop registry`)
- `tests/unit/sop-commands.test.ts` (one new test using `process.chdir` + a temp project fixture)
- `skills/peaks-sop/references/sop-authoring.md` (one-line doc clarification)
- Behavior delta: `peaks sop registry` without `--project` now defaults to cwd (`.`) instead of `undefined`.

## Threat-model walk-through

### User input
- No new user input is accepted. The flag's value semantics are unchanged (still an arbitrary user-provided path when explicitly passed). The default-value change only changes "what value the option has when the user does not pass it," and the new default (`'.'`) is the process's own cwd, which is already inside the CLI's trust model — every other execution-style `peaks sop` command (`check`, `advance`, `gate enforce`) already defaults to cwd; this slice brings `registry` to parity.

### File system
- `readRegistry('.')` calls `realpath` on the joined path (`sop-registry-service.ts:55-65`). Containment invariants (`isInsidePath` in `path-utils.ts`) unchanged. The default `'.'` is resolved by Commander to `process.cwd()` and is not concatenated with untrusted input before reaching the read path.
- Test fixture uses `makeProject` (a temp dir under the mocked home) and writes only to `join(project, '.peaks', 'sops', 'registry.json')` — same pattern as the rest of the test suite.

### External calls
- None. No network, no subprocess. `sop registry` is read-only against the filesystem.

### Auth / secrets
- No auth path touched. `registry.json` is a public list of SOP ids and gate counts; it is not a credentials store. PRD's `token-encrypted-storage-decision` memory is unchanged.

### Dependencies
- No `package.json` changes. No new transitive attack surface.

## Trust-boundary preservation (per PRD 005 v2 P1-P7)
- P1 (built-in peaks-* never in custom registry): preserved — `readRegistry` only reads the two filesystem layers; this slice does not change that boundary.
- P2 (command gate safety): preserved (no command-gate code path touched).
- P3 (range-3 blocking): preserved.
- P4 (file-exists / grep paths pinned inside project root): preserved.
- P5 (grep default semantic unchanged): preserved.
- P6 (PRD 004 Slice 2 project-first + merged registry): preserved and reinforced — the new default makes the merged view the default for `sop registry`, which aligns with Slice 2's design intent.
- P7 (init/lint/register semantics): preserved — those three subcommands do NOT get the new default.

## Secret scan (BLOCKING gate per QA Gate A3)
- Grep over the changed files for hardcoded credentials, API keys, bearer tokens, private keys, JWT patterns: **no matches**.
- Grep over the full project for `AKIA`, `gh[pousr]_`, `glpat-`, `sk-`, `-----BEGIN .* PRIVATE KEY-----`: **no new matches** beyond the existing test fixtures (which are intentionally fake values).

## Verdict

PASS. No new attack surface, no path-traversal regression, no secret-handling regression, no P1-P7 boundary regression.
