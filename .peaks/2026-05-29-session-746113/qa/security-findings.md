# Security Findings — 2026-06-02-grep-strip-meta

- reviewer: QA (reusing RD self-review, plus independent QA-side re-walk)
- review date: 2026-06-02
- verdict: **PASS** — no CRITICAL / HIGH / MEDIUM / LOW issues

## Scope reviewed

- `src/services/sop/sop-types.ts` — `SopGateCheck` grep variant gains `stripMeta?: boolean` (1 line)
- `src/services/sop/sop-check-service.ts` — new exported `stripMetaForGrep(content: string): string`; `evaluateGrep` signature extended with optional `stripMeta`; `evaluateCheck` case 'grep' passes `check.stripMeta === true`
- `src/services/sop/sop-service.ts` — `SopLintResult` gains `warnings: string[]`; `lintSop` pushes one warning per grep gate with `stripMeta: true`
- `src/cli/commands/sop-commands.ts` — no change (CLI already passes full `result` to `ok(...)`; `warnings` flows through)
- `skills/peaks-sop/SKILL.md` — doc-only addition
- `tests/unit/sop-check-service-strip-meta.test.ts` — NEW, 16 behavior tests

## Threat-model walk-through

### User input
- The new field is **opt-in** (`stripMeta: true`). Without it, behavior is byte-identical (AC5 byte-identity test guards this).
- The `pattern` field in `SopGateCheck.grep` is still passed to `new RegExp(pattern)`. Stripping does not change which patterns are accepted; it only changes which text the regex sees.
- `check.file` is still passed through `resolveInsideProject(projectRoot, file)`. No path-traversal regression: same containment invariants.

### ReDoS / regex safety
- `stripMetaForGrep` uses three `[\s\S]*?` lazy quantifiers. The first (`<!--[\s\S]*?-->`) and second (`\/\*[\s\S]*?\*\/`) are bounded by literal `-->`, `*/` end markers — they cannot run away. The third (`^```[^\n]*\n[\s\S]*?\n```[^\n]*\n?`) is bounded by the next `\n```[^\n]*` (a closing fence line).
- The combination of strip + pattern could in theory double the regex workload for a file with a long sequence, but in practice the stripper runs in O(n) and the user's pattern runs in O(n·|pattern|) — total cost is O(n + n·|pattern|), same order of magnitude as before. No new ReDoS amplifier.

### File system
- `evaluateGrep` continues to call `readFileSync(resolved, 'utf8')`. The returned `content` is then optionally passed through `stripMetaForGrep`. No new file access; no new I/O paths.
- The `stripMeta` flag is sourced from the manifest, which is JSON-parsed from a file path that is `readFileSync`-ed from a pre-validated location. No new attack surface.

### External calls
- None. No network, no subprocess. The stripper is pure string transformation in-process.

### Auth / secrets
- No auth path touched.
- No secrets path touched.
- One concrete consideration: if a SOP author writes `<!-- secret: T-O-D-O -->` in their post and enables `stripMeta`, the secret is removed from the grep evaluation domain. If a downstream consumer assumes "this content was not in the file" after a successful `absent: true` gate, they could be misled. However, `stripMeta` is opt-in per gate, and the default `false` keeps the regex domain identical to the file content. Authors who care about the raw-text invariant simply omit `stripMeta`. Documented in SKILL.md.

### Dependencies
- None. No `package.json` changes. No `node_modules` touch.

## Trust-boundary preservation (per PRD 006 P1-P3)

- **P1** (per PRD 005 v2 P1): built-in peaks-* never in custom registry — preserved (no registry/path code touched).
- **P2** (default `false` / `undefined` byte-identical): preserved; AC5 byte-identity test guards this.
- **P3** (lint warnings don't pollute findings for non-opt-in SOPs): preserved; type-guarded check at `sop-service.ts:294` only pushes warning for grep + stripMeta gates. AC6 P3 test asserts empty `warnings` for a plain grep gate.

## Secret scan (BLOCKING gate per QA Gate A3)

- Grep over the changed files for hardcoded credentials, API keys, bearer tokens, private keys, JWT patterns: **no matches**.
- Grep over the full project for `AKIA`, `gh[pousr]_`, `glpat-`, `sk-`, `-----BEGIN .* PRIVATE KEY-----`: **no new matches** beyond the existing test fixtures (which are intentionally fake values).

## Verdict

**PASS.** No new attack surface. No ReDoS amplification. No path-traversal regression. No secret-handling regression. The slice is a UX opt-in that lets content-publishing SOPs avoid the literal-word trap; it does not change the security posture of the gate evaluator in any way.
