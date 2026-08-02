---
"peaks-loop": patch
"peaks-loop-shared": patch
---

## 4.0.7 — 2026-08-02 dogfood repairs (ice-cola surface probe)

A 24h-mode dogfood pass on the downstream `ice-cola` monorepo (4 sub-packages:
admin / server / client / hermes-agent) surfaced 25 real CLI / runtime /
documentation defects across peaks-loop 4.0.6. They are fixed in this release.

### P0 ship-blocker (2)

- **`peaks audit red-lines` no longer reports false-positive enforcerRef
  orphans on consumer projects.**

  Root cause: `classifyBacking` in `src/services/audit/backing-detector.ts`
  resolved every `enforcerRef` against the audited `--project` root, but
  `enforcerRef` paths are written **relative to the peaks-loop source
  itself** (catalog lives at `src/services/audit/red-line-catalog.ts`, every
  enforcer lives at `src/services/audit/enforcers/<name>.ts`). Auditing any
  downstream project therefore reported all 26 enforcer files as "missing on
  disk" (88 enforcerFindings on ice-cola).

  Fix: `classifyBacking` now resolves `enforcerRef` against the peaks-loop
  install root (resolved via `import.meta.url` + 4-step upward walk to find
  `package.json#name === 'peaks-loop'`), with a `--project` override
  preserved for tests. Downstream audits no longer report the catalog's
  enforcer files as orphans; the bug is detected inside peaks-loop's own
  audit (peaks-loop as `--project` shows 0 orphan findings).

  Test: `tests/unit/audit/backing-detector-resolve-root.test.ts` (8 cases,
  including: ice-cola as project → 0 orphan; peaks-loop as project → 0
  orphan; relative path outside catalog dir → catalog not found; explicit
  override wins).

- **`peaks code {detect-job,read-job-shape}`, `peaks workflow plan read`,
  and `peaks route` now resolve the canonical session id from
  `.peaks/_runtime/session.json`.**

  Root cause: each of these 4 CLIs called into its own `findActiveSession`
  / `findProjectRoot` and rejected with `NO_ACTIVE_SESSION` even when
  `.peaks/_runtime/session.json` had a valid `sessionId`. Only the
  `peaks session *` family read the binding.

  Fix: a single shared resolver
  (`src/services/session/resolve-active-session.ts`) is now the canonical
  source of truth; all 4 CLIs + 3 internal call sites route through it.
  Behavior: when the binding file exists, the `sessionId` field is read;
  when the file is missing, the resolver returns `NO_ACTIVE_SESSION` only
  if no `--session-id` override is passed (and prints the next-action hint
  to run `peaks workspace init`).

  Tests: `tests/unit/session/resolve-active-session.test.ts` (10 cases,
  including: missing file → NO_ACTIVE_SESSION; valid file → returns
  sessionId; invalid JSON → falls back to NO_ACTIVE_SESSION; explicit
  `--session-id` override always wins; multiple sessions in dir → uses the
  binding file, not the most recent by mtime).

### P1 high (3)

- **`peaks code should-pause` no longer false-positives in 24h-mode.**

  The `stale-presence: no-presence` check now first reads
  `.peaks/_runtime/<sid>/24h-state.json`; if `state === '24H_ACTIVE'`, the
  stale-presence gate is skipped. Without this fix, every 24h-mode session
  hit a `shouldPause: true` wall at Step 1 even though 24h-mode is
  explicitly designed to be a no-AskUserQuestion mode.

  Test: `tests/unit/code/should-pause-24h-bypass.test.ts` (4 cases:
  24H_ACTIVE + no-presence → no pause; 24H_ACTIVE + valid-presence → no
  pause; IDLE + stale-presence → pause; IDLE + valid-presence → no pause).

- **SKILL.md Drift Index D-001 is rewritten to match 4.0.6 reality.**

  D-001 used to say "`peaks code detect-job --is-job ...` rejected with
  `error: unknown option '--is-job'`" — but in 4.0.6 the CLI **requires**
  `--is-job <bool>` and reports `required option '--is-job <bool>' not
  specified` when missing. The fix is to rewrite D-001 (now points to
  `peaks code detect-job --is-job <bool> --rationale <text>` as the canonical
  path), and to remove the legacy "use `peaks job init`" stub from the
  inline hint.

- **SKILL.md Step N+2 examples now include `--project .`.**

  The canonical example `peaks code context-now --json` in Step N+2 was
  rejected by the CLI with `required option '--project <path>' not
  specified` when run from a fresh project. The fix is a doc-only
  change: every `peaks code context-now` example in SKILL.md now passes
  `--project .` (or `--project <path>`). The CLI itself is unchanged —
  the explicit `--project` requirement is correct (avoids hidden cwd
  resolution surprises in monorepos and CI), and the doc was the bug.

### P2 batch (5 of 5 — all implemented in 4.0.7)

- `peaks standards init` / `detectLanguage` is now monorepo-aware: a
  monorepo root with no `tsconfig.json` but with
  `packages/<name>/tsconfig.json` is now classified as `typescript`.
  Pre-rid ice-cola (4-package TypeScript monorepo) was misclassified
  as `javascript` because the root scan saw no `tsconfig.json`.

- `peaks scan archetype` now reads `packages/<name>/package.json` to
  surface backend frameworks (NestJS / Next.js) that live in
  sub-packages. Ice-cola now reports
  `hasBackendFramework: true, backendFrameworks: ["@nestjs/core",
  "@nestjs/common"]` (was `false`).

- `peaks sub-agent dispatch` prompt template now branches on
  monorepo detection: if `<root>/pnpm-workspace.yaml` exists, the
  template tells the sub-agent to run `pnpm -r --filter @<pkg>/<name> test`
  for a single sub-package instead of root `pnpm test` (which would
  fan out to the full monorepo).

- `peaks slice check` typecheck stage now runs
  `pnpm -r typecheck` (or `pnpm -r --parallel exec tsc --noEmit` as
  fallback) when the project has a `pnpm-workspace.yaml`, and surfaces
  the per-package failure in `data.failedPackages` (an array of
  `{ package, exitCode, stderrTail }`).

- `peaks sub-agent dispatch` context window block no longer misleads
  on fallback probes: when the probe source is `conservative-fallback`
  (or any untrusted value), the block short-circuits to "no probe
  available — treat the displayed ratio as unverified" instead of
  rendering "0.0% used (100.0% free)" as if it were a real measurement.

### Compatibility

- All command names, options, and exit codes are preserved.
- `peaks audit red-lines` on peaks-loop itself shows 0 orphan findings
  (it had 381 before the fix because every catalog entry hit the same
  bug).
- Auto-compact 0.85 / 0.95 contract unchanged.

### How to verify

```bash
# Inside peaks-loop source root (after `pnpm build`):
peaks audit red-lines --project . --json
# expect: enforcerFindings: 0

# Inside a downstream project that has peaks-loop as a devDep:
peaks audit red-lines --project . --json
# expect: enforcerFindings: 0 (was 88+ before)

# 24h-mode + should-pause (peaks-loop source root):
peaks session 24h-mode transition --state 24H_ACTIVE
peaks code should-pause --step step-1-mode-select --json
# expect: shouldPause: false, reason does NOT include "stale-presence"

# detect-job CLI:
peaks code detect-job --is-job false --rationale "x" --suggested-job-id n-a
# expect: ok, recorded to .peaks/_runtime/<sid>/job-shape.json
```

Source: `.peaks/memory/2026-08-02-ice-cola-dogfood-surface-probe.md` (full
25-finding sediment).
