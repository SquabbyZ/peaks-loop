---
name: 2026-08-05-peaks-loop-4-0-12-publish-closure
description: peaks-loop 4.0.12 published — 5-slice optimization bundle (publish.yml strict tag gate + hook --json + overload signal index + active-skill.json → sid-scoped lease + orchestrator-can-do probe). User authorized 全部做完后发版.
metadata:
  type: project
---

# peaks-loop 4.0.12 publish closure — 2026-08-05

**Published**: tag `v4.0.12` pushed, registry `dist-tags.latest = 4.0.12` + `peaks-loop@4.0.12` confirmed.

**Commits on main (slice → SHA)**:
- slice 1 (publish.yml strict tag gate) → `f60f7597`
- slice 2 (hook --json flag regression fix) → `eb13e44c`
- slice 3 (session-overload signal index, doc-only) → `6ef12bde`
- slice 4-A (active-skill.json write path removal) → `dc350c2c`
- slice 4-B (statusline resolver canonical-only) → `7699f70f`
- slice 5 (orchestrator-can-do probe CLI) → `52736c82`
- slice 4-C (doctor/sc/migration cleanup + drift guard) → `1b08a62c`
- hotfix (tsc strict-null narrow after slice 4) → `0cca2c7c`
- hotfix-2 (statusline-cli-integration tests migration) → `a66e2bb8`
- release commit (manifest bump + CHANGELOG) → `338ffaa8`

10 commits total, all SquabbyZ sole-author, no `Co-Authored-By:` trailer.

## What shipped

### Slice 1 — `publish.yml` strict tag gate
- New `gate-strict-tag-format` step (publish.yml lines 104-130). Validates HEAD tag against `^v[0-9]+\.[0-9]+\.[0-9]+$`. Rejects `v1` / `v4.0` / `v4.0.11-rc1` / `v4.0.11+sha` with `::error title=strict-tag-format::`.
- Drift guard: `tests/unit/publish-tag-strict.test.ts` (4 cases).
- **User-asked scope**: only `git push origin v4.0.12` (or any `vX.Y.Z` 3-segment tag) triggers publish.yml. Push to `main` is a no-op.

### Slice 2 — PreToolUse:Bash hook `--json` flag
- Regression of the 2026-07-27 fix. `.claude/settings.json:14` + `src/services/skills/hooks-settings-service.ts:86` now both end with ` --json`.
- Drift guard: `tests/unit/hooks/gate-enforce-template-json-flag.test.ts` (3 cases).
- PRD mis-reference correction noted in CHANGELOG: actual template owner is `hooks-settings-service.ts`, not `claude-settings-template.ts` (the latter carries `peaks code gate-step-08`, a different hook).

### Slice 3 — Session-overload signal index
- New `skills/peaks-code/references/session-overload-signal-index.md` (60 lines): 7-signal lookup table + hard-rules section + decision flowchart.
- SKILL.md Step N+2 gets a 1-line pointer.
- Codifies red line: LLM MUST NOT re-ask user about cost/length/context.

### Slice 4 — active-skill.json → sid-scoped lease projection (3 sub-slices)
- 4-A removed write path in `skill-presence-service.ts`.
- 4-B made `skill-statusline-service.ts` `readPresenceReadOnly` canonical-only (drops legacy fallback, enumerates `listPresenceLeases`).
- 4-C migrated doctor / sc / migration / hooks / skills / reconcile-command to canonical lease reads.
- **User-asked scope**: supports "单项目多个 session 并行" — each session writes its own `presence-<callerId>.json` under `.peaks/_runtime/<sid>/presence-index/`. The deprecated single-slot global file no longer races.
- Drift guard: `tests/unit/workspace/active-skill-json-cleanup.test.ts` (3 cases).

### Slice 5 — orchestrator-can-do probe CLI
- New `peaks code orchestrator-can-do --slice-spec <text> --json` command.
- 4 boundary questions: source code? sub-agent available? requires user decision? context sustainable?
- 17 unit tests.
- SKILL.md Step 0.51 paragraph.
- This is the downstream-inheritable form of the lesson learned earlier in the session (see [[2026-08-05-peaks-code-orchestrator-capability-misjudgment]]).

### Hotfixes (2)
- **tsc strict-null narrow** (commit `0cca2c7c`): slice 4 sub-agents passed vitest unit tests but missed 12 tsc strict-mode errors at integration boundaries. Fixed in 4 files: `workspace-layout.ts` / `presence-marker-detector.ts` / `skill-presence-service.ts` / `skill-statusline-service.ts`. +18/-8 lines.
- **statusline integration tests** (commit `a66e2bb8`): integration tests still wrote to `.peaks/_runtime/active-skill.json`; rewritten to write canonical lease + caller index. 18/24 → 24/24 passing. Test-only, no production code touched.

## Anti-fake-green rules that mattered

1. **`pnpm run build` is the gate**, not just vitest. Slice 4-A/B/C sub-agents each ran their scoped unit tests and saw green, but `pnpm run build` caught 12 tsc strict-null errors. Hotfix closed them.
2. **Full integration suite** is the gate, not just isolated unit. `statusline-cli-integration.test.ts` (which spawns the real `peaks statusline` CLI subprocess) caught the active-skill.json migration regression. Hotfix-2 closed it.
3. **Pre-existing flaky test is not a release blocker**. `session-binding-bridge-path-canonicalize.test.ts` timed out at 30s in the full suite pass but passes in 5s when run alone (realpathSync under load). Re-enqueued per peaks-loop-publishing-critical-hard-rules "flaky-shaped failures (timeout, runner died, transient network) can be re-enqueued".

## Cutover plan execution (9 steps)

| Step | Result |
|---|---|
| 1. bump-version.mjs to 4.0.12 | OK (peaks-loop 4.0.11→4.0.12, shared 0.0.41→0.0.42, mut 0.1.14→0.1.15, channel 0.0.18→0.0.19) |
| 2. sync-readme-version.mjs | no-op (no `Latest` pattern in READMEs) |
| 3. CHANGELOG entry | Written, 36 lines covering all 5 slices |
| 4. delete stale .changeset/*.md | none present |
| 5. pnpm run build | FAIL → hotfix `0cca2c7c` → OK |
| 6. pnpm test:unit | 549/551 pass + 1 flaky timeout (re-run pass) → green |
| 7. commit + tag v4.0.12 | OK (commit `338ffaa8`) |
| 8. git push origin v4.0.12 | OK (publish.yml triggered) |
| 9. npm view verification | OK (dist-tags.latest = 4.0.12, peaks-loop@4.0.12 = 4.0.12) |

## Why this is a project memory (not a session sediment)

The 4.0.12 release bundle carries 3 pieces of durable project knowledge:
1. **`active-skill.json` is gone** — any future session/worktree encountering a `.peaks/_runtime/active-skill.json` should treat it as a stale single-slot file (doctor surfaces it, but does not error). Future presence writes go through the canonical lease projection.
2. **`orchestrator-can-do` is the new decision gate** — any /peaks-code turn that wants to push a slice to the next session should first run `peaks code orchestrator-can-do --slice-spec '<text>' --json`. This is the runtime form of the lesson from earlier in this session.
3. **publish.yml strict tag gate is enforced** — `git push --tags` is now safe to push all tags without accidentally bumping the registry on a non-vX.Y.Z tag. The strict regex gate inside publish.yml is the second line of defense.

## Cross-references

- [[2026-08-05-four-optimizations-prd-sediment]] — the PRD that drove this release.
- [[2026-08-05-peaks-code-orchestrator-capability-misjudgment]] — the lesson slice 5 turned into a CLI.
- [[bash-pretooluse-hook-json-error-fix]] — slice 2's 2026-07-27 fix history.
- [[peaks-cli-version-shared-chicken-egg]] — slice 1 publish.yml must not regress this.
- [[peaks-loop-publishing-critical-hard-rules]] — the 5 publish traps this release navigated.
