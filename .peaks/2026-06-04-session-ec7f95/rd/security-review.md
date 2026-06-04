# RD Security Review: 2026-06-04-workflow-resilience / Slice 1 (W2)

- session: 2026-06-04-session-ec7f95
- rid: 2026-06-04-workflow-resilience
- slice: 1 (chore → better-fit: config)
- commit: 5f30353318a022dd70a3be755c5bf7b6bc335343
- type: chore (per `peaks request init`); **note**: the post-commit `peaks scan request-type-sanity --type chore` classified the diff as `config` (not `chore`), per the type-classification table's rule for `package.json` scripts. Recorded here as a lesson; the work itself is safe regardless of type.

## Scope of change

Single-file edit to `package.json`: added 3 new `pre*` script entries (`predev`, `pretest`, `prepublish`) that each invoke `node ./scripts/sync-version.mjs`. No other scripts modified. No dependencies added, no version bump, no source-code change.

## Security review

The change is **build-time tooling only** with no runtime impact on CLI behavior or external surface. Findings:

- **No new external attack surface.** The hooks only invoke an existing local script (`sync-version.mjs`) that reads `package.json` and writes a single generated file (`src/shared/version.ts`). No network, no subprocess, no shell, no env-var passthrough.
- **No new dependency.** Hand-rolled; no `find-up` / `pkg-dir` / etc. added.
- **Idempotent and fail-closed.** `sync-version.mjs` throws on malformed `package.json` and exits 0 on no-op. pnpm/npm propagate the non-zero exit through the `pre*` hook, so `pnpm dev` / `pnpm test` / `npm publish` fail fast with a clear error if the version source is broken.
- **No new file-system surface.** The hooks write only to `src/shared/version.ts` (already a known, expected file). Symlink / path-traversal concerns are bounded by `node:path.resolve('package.json')` and `node:path.resolve('src/shared/version.ts')`, both anchored to the package root.
- **No new permissions or capabilities.** Hooks are invoked by the user's own pnpm/npm invocation, not by remote code.

## Findings

- 0 CRITICAL
- 0 HIGH
- 0 MEDIUM
- 0 LOW

## Residual risks

None known. The change reduces risk (by preventing the prior W2 failure mode where `peaks --version` silently lagged behind `package.json`).

## Verdict

**Pass.** No security action required. The slice is complete at commit `5f30353`.

## Lesson: type classification (carried into TXT handoff)

- `peaks scan request-type-sanity --type chore` returned `consistent: false` for a `package.json`-scripts-only change.
- The skill's type-classification table says `config` is the right type for "Modify config / infrastructure files only: `tsconfig.json`, `eslint`, CI YAML, **`package.json` scripts**, env defaults, CORS/CSP rules, build config, Docker, deployment manifests."
- Future slice with `package.json`-only changes: init with `--type config` from the start. The gate matrix for `config` requires a `security-review.md` (RD) and `security-findings.md` (QA); this slice produced the security review proactively.
- No action required for this slice — the work is correct, the type metadata is slightly off, and the scanner's `consistent: false` is recorded for the audit trail.