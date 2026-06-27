# QA Security Findings — Slice 023 (R3)

- session: 2026-06-09-session-9bd407
- request-id: 023-2026-06-09-retrospective-index-and-format-compact
- role: qa (validation sub-phase, security sub-section)
- type: refactor
- date: 2026-06-09
- reviewer: qa-validation sub-agent (full-auto)

## Verdict: PASS

Re-verified the RD's `security-review.md` (which reported 0 findings, 0 OWASP Top 10 hits). All findings re-confirmed.

## Findings

None. 0 CRITICAL / 0 HIGH / 0 MEDIUM / 0 LOW.

## Re-checked surface

The slice introduced:

1. Two pure helpers: `src/shared/format-md-compact.ts`, `src/shared/stale-policy.ts`
2. Three retrospective services: `src/services/retrospective/{retrospective-index,retrospective-show,retrospective-search-service}.ts`
3. CLI extensions: `src/cli/commands/retrospective-commands.ts` (new), `src/cli/commands/project-commands.ts` (modified), `src/cli/commands/request-commands.ts` (modified)
4. Modified memory service: `src/services/memory/project-memory-service.ts` (added `readProjectMemoryBody`)
5. Live artifact: `.peaks/retrospective/index.json` (no separate archive — slice 2026-06-27-archive-feature-removal retired the legacy archive dir)
6. Two lesson memories: `.peaks/memory/r3-*.md`

## Re-checked findings

### Injection / eval

Re-grepped for `eval(`, `Function(`, `vm.runIn*`, `child_process.exec(` in the new code:

- `format-md-compact.ts`: pure string manipulation. No eval, no Function, no vm. PASS.
- `stale-policy.ts`: pure `Date.parse` + arithmetic. No eval. PASS.
- `retrospective-index.ts`: `JSON.parse(fs.readFileSync(...))` only. No eval. PASS.
- `retrospective-show.ts`: synthesizes body from `entry.artifactPaths[]` paths. No eval. PASS.
- `migrate-from-md.ts`: `child_process.spawn('tar', [...])` with an arg array (not a shell string). Args are entry IDs (validated `^[a-z0-9-]+$`) and the archive path (constant). No shell interpolation. PASS.

### Symlink / junction escape

- `index.json` write uses `fs.rename` after atomic tmp file (POSIX-atomic on same FS; NTFS-rename atomic for tmp → final). No partial-write risk. PASS.
- `tar` is invoked with `cwd` set to the source dir and a relative archive path (workaround for the Windows `tar.exe` "Cannot connect to C: resolve failed" bug). This is portable and does not change the threat model. PASS.
- `readProjectMemoryBody` uses `assertSafeProjectMemoryDir` which checks `.peaks/memory` is not a symlink and resolves through `realpathSync` + `isInsidePath` guard. PASS.
- No new symlink writes introduced. PASS.

### Path traversal

- Entry IDs in `index.json` are validated against `^[a-z0-9-]+$`. PASS.
- `entry.artifactPaths[]` paths are joined with `path.resolve` against the project root and asserted to stay inside it (existing pattern). PASS.
- CLI flags `--stale-days`, `--include-stale`, `--pretty`, `--compact` are boolean / numeric / enum. No path-injection surface. PASS.

### Secrets / credentials

- No new secret handling. PASS.
- No env vars, tokens, API keys introduced. PASS.
- No network calls (all operations are local fs). PASS.

### Input validation

- `--stale-days <N>`: validated as `N > 0` (positive integer) at CLI layer (`project-commands.ts:241`). Rejects 0 and negative. PASS.
- Entry IDs: `^[a-z0-9-]+$` (existing convention). PASS.
- `index.json` parsing: `JSON.parse` (no eval). PASS.

## OWASP Top 10 cross-check

| OWASP | Status |
|---|---|
| A01 Broken Access Control | N/A (local CLI, no multi-user surface) |
| A02 Cryptographic Failures | N/A (no secrets) |
| A03 Injection | CLEAN (no SQL, no shell exec, no eval, no path traversal) |
| A04 Insecure Design | CLEAN (atomic write + archive-gated deletion) |
| A05 Security Misconfiguration | CLEAN (no new config knobs) |
| A06 Vulnerable Components | N/A (no new npm packages) |
| A07 Identification & Auth Failures | N/A (local CLI) |
| A08 Software & Data Integrity Failures | CLEAN (rollback path documented in tech-doc §8; archive verified before deletion) |
| A09 Security Logging & Monitoring Failures | N/A (CLI tool, not long-running) |
| A10 SSRF | N/A (no network) |

## Identity discipline

- No `Co-Authored-By: Claude ...` trailer in any commit (RD did not commit; this is QA validation only).
- Identity is the global gitconfig; no per-repo `user.*` overrides.

## Open items

None. The 2 advisory issues raised in `test-reports/023-...md` (AC1 size budget, r3 memory parser bug) are not security issues.

## Hand-off

- to peaks-solo: security re-verification passed; ready for end-to-end workflow verification.
