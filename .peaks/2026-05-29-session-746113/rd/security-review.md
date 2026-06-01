# Security Review — RD 2026-06-02-sop-global-reuse-ux-v2

- reviewer: RD self-review (single-line CLI default + test, no new attack surface)
- review date: 2026-06-02
- verdict: **PASS** (no CRITICAL/HIGH/MEDIUM issues; no new attack surface)

## Scope reviewed

- `src/cli/commands/sop-commands.ts` — one-line `.option()` default-value addition on `sop registry`.
- `tests/unit/sop-commands.test.ts` — one new test using `process.chdir` to a temp project, writing a registry.json fixture, and asserting merged-view output.

## Threat model walk-through

### User input

- New surface: `--project <path>` option's **default** value is now `'.'` (was `undefined`).
- Before: omitting the flag passed `undefined` into `readRegistry(undefined)` → global-only view.
- After: omitting the flag passes `'.'` (the current working directory) into `readRegistry('.')` → reads `<cwd>/.peaks/sops/registry.json` and merges.
- **No new user input is accepted.** The flag's value semantics are unchanged (it is still an arbitrary path provided by the user when explicitly passed). The only new behavior is "what value the option has when the user does not pass it," and the value is the process's own cwd, which is already part of the CLI's trust model (the process trusts its own cwd — every other `peaks sop` execution command already does this; this slice is the last one to catch up).

### File system

- The default `'.'` resolves to `process.cwd()` via Commander's default-value handling. `readRegistry` then calls `realpath` on the joined path (`sop-registry-service.ts:55-65`). No path-traversal regression: the same containment invariants (`isInsidePath` in `path-utils.ts`) that already protect the project and global layers are unchanged.
- The new test uses `makeProject` (a temp dir under the mocked home) and writes only to `join(project, '.peaks', 'sops', 'registry.json')` — same patterns as the rest of the test suite.

### External calls

- None. No network, no subprocess. `sop registry` is read-only against the filesystem.

### Auth / secrets

- No auth path. No secrets path. `registry.json` is a public list of SOP ids and gate counts; it is not a credentials store (see `token-encrypted-storage-decision` memory — credentials are explicitly out of scope here, and this slice doesn't change that).

### Dependencies

- None. No `package.json` changes. No new transitive attack surface.

## Trust-boundary preservation (per PRD 005 v2 P1-P7)

- **P1** (built-in peaks-* never in custom registry): preserved. `readRegistry` only reads from the two filesystem layers (global, project). Built-in peaks-* gates are not stored in either layer; they are evaluated by the gate-evaluation layer, not counted. Default change does not touch this boundary.
- **P2** (command gate safety): preserved (no command-gate code path touched).
- **P3** (range-3 blocking): preserved (no gate-evaluation code path touched).
- **P4** (file-exists / grep paths pinned inside project root): preserved (no check-evaluation code path touched).
- **P5** (grep default semantic unchanged): preserved (no grep code path touched).
- **P6** (PRD 004 Slice 2 project-first + merged registry): preserved — this slice's default change is precisely what makes the merged view the default for the `sop registry` consumer, which aligns with Slice 2's design intent.
- **P7** (init `--project` semantics): preserved — `init` / `lint` / `register` do **not** get a default `'.'` (P7 explicitly says they keep "global as default, --project commits into repo"). The new default applies only to the four execution-style commands (`check` / `advance` / `gate enforce` / `registry`).

## Verdict

PASS. No new attack surface. No path-traversal regression. No secret-handling regression. The change is a UX-default alignment (one command joins the same default the other three execution commands already use), with the underlying security checks unchanged.
