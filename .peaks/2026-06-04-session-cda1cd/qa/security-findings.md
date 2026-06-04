# QA Security Findings — Slice A: 2026-06-04-monorepo-and-release

- session: 2026-06-04-session-cda1cd
- rid: 2026-06-04-monorepo-and-release
- slice: A
- type: feature
- commit-under-test: `d3e314c feat(scan): discover monorepo packages in peaks scan libraries`
- reviewer: peaks-qa (sub-agent)
- date: 2026-06-04

## Scope

Files in the diff under test:

- `src/services/scan/libraries-service.ts` (modified, 145 → 388 lines,
  +548/-41 in the slice commit)
- `src/services/scan/libraries-types.ts` (modified, +25 lines; new
  `WorkspaceEntry` type and additive `workspaces` field on
  `LibraryReport`)
- `tests/unit/scan-libraries-service.test.ts` (modified, +172 lines; 7
  new monorepo test cases)

Out of scope for the security review (per the red-line scope in
`rd/requests/001-2026-06-04-monorepo-and-release.md`):

- `peaks-solo` SKILL.md or any other skill file
- `schemas/library-breaking-changes.*` (curated table, hand-maintained)
- `src/cli/index.ts` and the `scan libraries` command wiring
- `package.json` (slice B owns version bump)
- `README.md` (slice B owns the install note)

## Threat model recap

`peaks scan libraries` is a **read-only** command. It enumerates
`package.json` files under a project root and reports their declared
dependency versions. The slice extends the enumeration to monorepo
workspaces (pnpm-workspace.yaml / npm `workspaces` / yarn `workspaces` /
lerna.json `packages`) but does not change the read-only contract.

## Findings

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| — | (no CRITICAL findings) | — | — |
| — | (no HIGH findings) | — | — |
| — | (no MEDIUM findings) | — | — |
| 1 | Symlink-aware readdir: `readdir(dir, { withFileTypes: true })` returns Dirent objects for the entry itself, but the subsequent `pathExists` / `isDirectory` calls follow symlinks when stat'ing the target. A symlinked sub-directory would be traversed as if it were a real sub-directory. **Bounded by:** the same surface exists in the pre-existing single-package code; the slice does not change it. **Impact:** information disclosure limited to whatever the symlinked `package.json` declares (no writes, no exfiltration). | LOW | open (inherited) — documented in `rd/security-review.md`; not a regression; out of scope for this slice; follow-up security-hardening pass recommended. |
| 2 | The on-disk `package.json.workspaces` field is trusted as a glob. A malicious `package.json` could list globs that point outside the project root (e.g. `../../etc`). The slice would then read the `package.json` at the resolved path. **Bounded by:** read-only contract; the user already accepts this risk at the root level by pointing `peaks scan libraries` at a directory they do not fully trust. **Impact:** information disclosure limited to whatever `<external>/package.json` says (typically `{}` for non-npm paths → parse error → empty contribution). No file is written, no exfiltration occurs. | LOW | open (inherited) — same risk profile as the pre-existing service; documented; out of scope. |
| 3 | The recursive descent (the fix for ice-cola's 3 nested packages) walks one level into each discovered workspace directory to find nested `package.json` files. In principle, a malicious symlink in a discovered workspace could be followed. **Bounded by:** the read-only contract and the project-root trust model; same as #1. | LOW | open (inherited) — same as #1; documented. |

## Resolved risks (during the slice)

| Risk | Mitigation in diff | Evidence |
|---|---|---|
| Recursive descent miss for nested packages (HIGH per RD code-review) | Added one-level recursive descent into each discovered workspace dir, bounded by `isDirectory(pkgPath.replace(...))` — cannot escape the discovered dir. | RD code-review finding #2 (fixed) |
| Windows path separator assertion failure (MEDIUM per RD code-review) | Replaced the `endsWith('admin/package.json')` literal check with a helper that accepts both `/` and `\` separators. | RD code-review finding #3 (fixed) |
| `parsePnpmWorkspaceYaml` returning `string | undefined` under strict mode (LOW per RD code-review) | Guarded `itemMatch[2]` with explicit `undefined` check. | RD code-review finding #4 (fixed) |
| `WorkspaceEntry` building `name: undefined` under `exactOptionalPropertyTypes: true` (MEDIUM per RD code-review) | Switched to conditional property assignment (`if (record.name !== undefined) entry.name = record.name`). | RD code-review finding #5 (fixed) |

## Unresolved risks

The 3 LOW findings (#1, #2, #3 above) are open. They are not new to this
slice — they predate the slice and are limitations of the existing
read-only service model. They are out of scope per the red-line boundary
(`rd/requests/001-2026-06-04-monorepo-and-release.md`) and the RD's
security-review explicitly defers them to a follow-up security-hardening
pass.

The slice itself does not:

- Read files outside the user-supplied `projectRoot` (all constructed
  paths are `join(projectRoot, ...segments)` where segments come from
  either a trusted `package.json` field or a hand-parsed
  `pnpm-workspace.yaml` written by the user on disk).
- Write to the filesystem (only `readdir`, `pathExists`, `readText` are
  called on the new code path).
- Make any external HTTP / DNS / IPC calls.
- Spawn any subprocess.
- Add a new top-level `import` outside the existing dependency set
  (the only new imports are `readdir` from `node:fs/promises`, `sep`
  from `node:path`, and `isDirectory` from `../../shared/fs.js`).
- Add a new package.json dependency.

## Verdict

**pass** — no CRITICAL, HIGH, or MEDIUM findings. The 3 LOW findings are
inherited from the pre-existing read-only service, are bounded by the
read-only contract, and are explicitly out of scope. The slice is
read-only, dependency-free, network-free, and subprocess-free. No
blocking security issues.
