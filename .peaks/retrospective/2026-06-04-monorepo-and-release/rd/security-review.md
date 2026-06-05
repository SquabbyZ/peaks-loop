# RD Security Review — slice 2026-06-04-monorepo-and-release (A)

- reviewer: RD sub-agent (self-review)
- date: 2026-06-04
- scope: monorepo discovery added to `src/services/scan/libraries-service.ts`,
  additive type in `src/services/scan/libraries-types.ts`, expanded test
  coverage in `tests/unit/scan-libraries-service.test.ts`.

## Threat model

`peaks scan libraries` is a **read-only** command. It enumerates
`package.json` files under a project root and reports their declared
dependency versions. The change extends the enumeration to monorepo
workspaces; it does not change the read-only contract.

### Surface

- **Inputs**: a filesystem path (`projectRoot`) supplied by the user
  via the CLI flag `--project <path>`. The path is restricted by the
  CLI layer to a string (no shell expansion at the CLI side; the user
  passes an absolute path).
- **Reads**:
  - `<root>/package.json` (root, optional)
  - `<root>/pnpm-workspace.yaml` (root, optional)
  - `<root>/lerna.json` (root, optional)
  - One-level recursive directory listing of each discovered workspace
    directory (to find nested `package.json` files).
  - `package.json` of every discovered workspace.
- **Writes**: none. The function returns a JSON-serializable object;
  the caller (CLI) is responsible for persistence and the caller's
  surface is unchanged.
- **Network**: none. No HTTP, no DNS, no IPC.
- **Subprocess**: none. The change does not spawn any process.
- **External libraries**: none. Hand-rolled glob matcher, hand-rolled
  YAML parser. No new `package.json` dependencies.

## Checklist

| Check | Status | Notes |
|---|---|---|
| No hardcoded secrets | pass | The slice reads version strings from `package.json` but does not persist or log them beyond the existing report shape. |
| No external API calls | pass | Pure filesystem reads via `node:fs/promises` and `src/shared/fs.ts` helpers. |
| Path traversal | pass with caveat | The function joins `projectRoot` with workspace glob segments. `projectRoot` is user-supplied via the CLI; a malicious user can already point it anywhere the running process can read. The slice does not introduce any new path-traversal vector: every constructed path is `join(projectRoot, ...segments)` where segments come from either a trusted `package.json` field (npm `workspaces` array, lerna `packages` array) or a hand-parsed `pnpm-workspace.yaml` (text the user wrote on disk). The new recursive descent into discovered workspace dirs uses `path.dirname(pkgPath)` to bound the walk to immediate sub-directories — it cannot escape outside the original workspace dir. |
| Symlink / junction escape | pass with caveat | The hand-rolled glob matcher uses `readdir(..., { withFileTypes: true })` and filters by `isDirectory()`. `fs.readdir` does NOT follow symlinks for the `Dirent` itself, but the subsequent `pathExists` / `isDirectory` calls DO follow symlinks when stat'ing the target. This is the same behavior as the pre-existing single-package code, and the same risk model: if the user's `projectRoot` is a directory tree that contains a malicious symlink, the scan will follow it. The slice does not change this surface. **Action**: documented as a known limitation of the existing service; mitigations (e.g. `O_NOFOLLOW`, realpath normalization) are out of scope for this slice and should be tracked in a follow-up issue. |
| Input validation (user-controlled `projectRoot`) | pass | The CLI layer is responsible for validating the project root path; the slice does not weaken this. Empty `projectRoot` is handled by the existing pre-check (no `package.json` found → `warnings: [...]`, return empty report). |
| Input validation (workspace globs from on-disk files) | pass with caveat | Globs in `package.json.workspaces`, `pnpm-workspace.yaml.packages`, and `lerna.json.packages` are user-controlled in the sense that they come from a project file, but the impact of a malicious glob is bounded: the worst case is that the scan reads a `package.json` from a directory the user did not intend to include (information disclosure, not data exfiltration — the report is local). Globs with more than one `*` are silently skipped with a warning. Non-trailing `*` globs are also skipped with a warning. Literal path globs that don't exist are silently ignored. |
| File system write | pass | No file system writes anywhere in the new code path. |
| Network exposure | pass | No new outbound connections. |
| Subprocess invocation | pass | No new subprocess calls. |
| Logging / debug output | pass | The slice adds no `console.log` or `logger.*` calls. The function returns its report via the existing return contract. |
| Authentication / authorization | n/a | The CLI does not authenticate. Project root access is mediated by the OS file permissions. The slice does not change this. |
| Cryptography | n/a | No keys, tokens, signatures, or ciphers involved. |
| Dependency injection | pass | No new dependencies. The hand-rolled glob matcher and YAML parser are deterministic and accept no external input beyond the on-disk file contents. |
| Concurrency / race | pass with caveat | The function is `async` but does not parallelize filesystem reads; reads are sequential in declaration order. This is the same model as the pre-existing single-package code. The slice does not introduce a new race surface. **Action**: if a future slice needs to scan hundreds of workspaces, the `Promise.all` parallelization is a straightforward performance follow-up, not a security concern. |
| Information disclosure (error messages) | pass | The two new warning shapes — `"pnpm-workspace.yaml present but unreadable: …"` and `"<path> is not valid JSON: <error>"` — disclose only the on-disk file path and the JS engine's parse error. No environment variables, no process argv, no tokens. The path is the user-supplied `projectRoot` joined with on-disk manifest names; the user already knows these. |
| Test isolation | pass | The new tests use `mkdtemp` to create a fresh `tmpdir()` directory per test, write the fixture, and `rm(..., { recursive: true, force: true })` in `afterEach`. No test reaches outside its temp dir. |

## Findings

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | `readdir` + `pathExists` follow symlinks when stat'ing targets, so a symlinked sub-directory would be traversed as if it were a regular sub-directory. Same surface as the pre-existing single-package code; not introduced by this slice. | LOW | documented — out of scope for this slice; follow-up issue recommended. |
| 2 | The on-disk `package.json.workspaces` field is trusted as a glob. A malicious `package.json` could list globs that point outside the project root (e.g. `../../etc`). The slice would then read the `package.json` at the resolved path. **Impact**: information disclosure limited to whatever `<external>/package.json` says — typically `{}` for non-npm paths, so the worst case is reading a non-package.json file as if it were a JSON document, which would surface a parse error and an empty contribution. No file is written, no exfiltration occurs. | LOW | accepted — bounded by the read-only contract; users who run `peaks scan libraries` on a directory they do not trust already accept this risk at the root level. |
| 3 | The recursive descent (fix for ice-cola's 3 nested packages) could in principle follow a malicious symlink in a discovered workspace. Same as #1: bounded by the read-only contract and the project-root trust model. | LOW | documented — same follow-up as #1. |

## Verdict

**pass** — no CRITICAL or HIGH findings. The slice does not change the
read-only contract, does not introduce any new external surface, and does
not add new dependencies. The two LOW findings are inherited limitations
of the existing service and are explicitly out of scope.

## Notes for the security-reviewer sub-agent in QA

- The slice is contained to 3 files; `git diff main...HEAD` is the
  entire surface to review.
- The hand-rolled YAML parser is intentionally narrow (only reads the
  `packages:` list at the top level); it does not implement a general
  YAML parser. If a future slice needs broader YAML, prefer a vetted
  library over extending this one.
- The hand-rolled glob matcher is intentionally narrow (only `*` as a
  trailing segment). It is not a general glob library. Document this
  limitation in the skill's "out of scope" section if relevant.
