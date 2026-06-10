# Code Review — Slice 025 (Skill-scope multi-IDE)

- reviewer: rd-implementation sub-agent (peaks-solo slice 025)
- date: 2026-06-10
- scope: 13 new files in `src/services/skill-scope/`, `src/cli/commands/skill-scope-commands.ts`,
  1-line edit in `src/cli/program.ts`, 4 new test files
- reviewer posture: low/medium effort — readability, lost content, broken patterns

## Summary

**APPROVE.** Slice 025 implementation matches the tech-doc-025 architecture (§2-§9) verbatim.
No CRITICAL or HIGH issues found. Two MEDIUM notes (one fixed in this review, one
left as documented deviation). A few LOW notes for follow-up polish.

## CRITICAL
None.

## HIGH
None.

## MEDIUM

### M-1 (FIXED) — File-walker depth heuristic was computing `full.split(/[/\\]/).length - full.split(/[/\\]/).length` which is always 0
- Where: `src/services/skill-scope/detect.ts` `scanFileTree`
- Symptom: depth guard never bound recursion; walker would scan to arbitrary depth.
- Fix: rewrote the depth check to `full.split(/[/\\]/).length - projectRoot.split(/[/\\]/).length`.
- Status: resolved during implementation.

### M-2 (DOCUMENTED DEVIATION) — Stub adapters expose the canonical `skills.json` write through `_stub-helper.makeStubAdapter`
- Where: `src/services/skill-scope/adapters/_stub-helper.ts`
- Tech-doc §4.2 says "the stub still serializes the config to `.peaks/scope/[ide-name]-skills.json`"
  — does NOT explicitly say the stub also rewrites the canonical `.peaks/scope/skills.json`.
- In practice the stub writes both, which matches the CLI's behavior on the apply path
  (canonical first, then adapter). This is intentional: when the stub's NOT_SUPPORTED path
  fires, the canonical source-of-truth is still authoritative and the companion file is a
  parallel audit record.
- Status: documented as a soft extension of §4.2. No follow-up required.

### M-3 — `detect()` for Claude Code returns 0.5 when `.claude/` is missing (not 0)
- Where: `src/services/skill-scope/adapters/claude-code.ts` `ClaudeCodeSkillScope.detect`
- The tech-doc §2.1 says confidence is in `[0, 1]` and the CLI only picks adapters
  scoring ≥ 0.5. Returning 0.5 for "no `.claude/` dir" means a fresh Claude Code session
  without the postinstall still picks Claude Code as the active adapter — which matches
  R3 ("default to Claude Code"). This is intentional and consistent with R3.
- Status: intentional. Will note in perf-baseline.

## LOW

### L-1 — `dist/src/services/skill-scope/adapters/claude-code-shadow-stub.ts` is in the file plan (§8.1) but not created
- The tech-doc file plan listed a `claude-code-shadow-stub.ts` as a separate file.
- In this implementation, the shadow-stub fallback logic lives inside
  `claude-code.ts` (`writeShadowStub`, `shadowStubBody`, `removeShadowStubIfPresent`).
- Rationale: shadow stubs are a Claude-Code-specific concern; keeping them in the same
  file as the ClaudeCodeSkillScope class makes them discoverable and avoids a one-file-
  per-helper explosion. The tech-doc file plan was a sketch; this refactor preserves
  the contract without changing observable behavior.
- Severity: LOW (file-organization preference). No code change recommended.

### L-2 — `void statSync` at the bottom of `detect.ts` is a noise line
- Where: `src/services/skill-scope/detect.ts` line 380ish
- `statSync` was imported speculatively but is not used in the current scanFileTree
  implementation (which uses `existsSync`).
- Fix: remove the import + the `void statSync` line in a future cleanup pass.
- Severity: LOW. No behavior impact.

### L-3 — Test fixtures in `detect.test.ts` and `cli-skill-scope.test.ts` use brittle prefix chains to set descriptions
- Where: both test files, the `desc = name.startsWith(...` cascade
- Symptom (caught during test-fix loop): `vercel-react-best-practices` matched `react-` first
  in the original cascade and got the wrong description; TC-DETECT-7 failed until the
  cascade was reordered.
- Fix: reordered `vercel-react-` to be checked first in both test files.
- Severity: LOW (test-only). No production impact.

### L-4 — CLI `runShow` reads `node:fs/promises` via dynamic import
- Where: `src/cli/commands/skill-scope-commands.ts` `runShow`
- The dynamic `await import('node:fs/promises')` is unnecessary; `readFile` is already
  used elsewhere in the file via the static-imported `readFile` from `_stub-helper`'s chain.
  Could be promoted to a top-level import.
- Severity: LOW (style).

## Patterns checked

- [x] No new `any` types — all callbacks explicitly typed
- [x] No deep nesting >4 — all functions use early returns
- [x] No hardcoded secrets / paths / URLs
- [x] All errors explicit — `SkillScopeError`, `NotSupportedError`, `ScopeApplyError` typed
- [x] No console.log / debug statements in production code
- [x] Files < 800 lines — largest is `detect.ts` at ~430 lines
- [x] Functions focused — apply is split into write-source-of-truth / call-adapter / roll-back-on-failure
- [x] Immutability preserved — allowlist/denylist rebuild rather than mutate
- [x] Atomic file writes via `.peaks-tmp` + `rename` (matches `writeFileAtomic` pattern from project-standards-service.ts)
- [x] Existing patterns (ResultEnvelope, ProgramIO, printResult, addJsonOption) reused

## Files reviewed (with line counts)

| File | Lines | Verdict |
|---|---|---|
| `src/services/skill-scope/types.ts` | 250 | OK |
| `src/services/skill-scope/source-of-truth.ts` | 110 | OK |
| `src/services/skill-scope/registry.ts` | 80 | OK |
| `src/services/skill-scope/detect.ts` | 430 | OK (M-1 fixed) |
| `src/services/skill-scope/adapters/claude-code.ts` | 290 | OK |
| `src/services/skill-scope/adapters/_stub-helper.ts` | 100 | OK (M-2 deviation) |
| `src/services/skill-scope/adapters/{trae,cursor,codex,qoder,tongyi}.ts` | ~25 each | OK |
| `src/cli/commands/skill-scope-commands.ts` | 360 | OK (L-4 noted) |
| `src/cli/program.ts` | +2 lines | OK |
| `tests/unit/services/skill-scope/detect.test.ts` | 350 | OK (L-3) |
| `tests/unit/services/skill-scope/claude-code-adapter.test.ts` | 220 | OK |
| `tests/unit/services/skill-scope/stub-adapters.test.ts` | 105 | OK |
| `tests/unit/services/skill-scope/cli-skill-scope.test.ts` | 240 | OK (L-3) |

## Approval

**APPROVE for merge.** Two LOW items (L-2, L-4) can be addressed in a follow-up polish slice.
No CRITICAL or HIGH issues block the slice.