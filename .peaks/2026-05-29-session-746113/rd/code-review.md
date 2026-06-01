# Code Review — RD 2026-06-02-sop-global-reuse-ux-v2

- reviewer: code-reviewer agent (adae801f52c7a6e72)
- review date: 2026-06-02
- verdict: **APPROVE**

## Scope reviewed

| File | Change |
|------|--------|
| `src/cli/commands/sop-commands.ts` line 187-188 | Update `sop registry` subcommand description; add `'.'` as third arg to `.option('--project ...')` |
| `tests/unit/sop-commands.test.ts` lines 203-236 | New test: `registry without --project defaults to cwd and merges the project layer when present (AC6)` |
| `skills/peaks-sop/references/sop-authoring.md` line 11 | Doc: clarify execution reads (`check`/`advance`/`gate enforce`/`registry`) default `--project` to cwd |

## Severity summary

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 0 | — |
| LOW | 2 | both addressed post-review (description text + skill doc note) |
| INFO | 6 | informational only |

## Findings detail

### LOW-1: Stale `sop registry` subcommand description

- **Where**: `src/cli/commands/sop-commands.ts:187`
- **Before**: `'List registered SOPs and gates (global; --project merges in the repo layer)'`
- **After**: `'List registered SOPs and gates (global; merges in the cwd project layer by default)'`
- **Status**: fixed in same commit.

### LOW-2: SKILL.md / reference help text not updated for new default

- **Where**: `skills/peaks-sop/references/sop-authoring.md:11`
- **Before**: `execution reads (check/advance/enforce) and sop registry --project see the merged view.`
- **After**: `execution reads (check / advance / gate enforce / registry) default --project to the current directory, so they see the merged view without an explicit flag.`
- **Status**: fixed in same commit.

### INFO (informational, no action required)

- Default-value pattern (`.option('--flag <arg>', 'help', '<default>')`) matches existing convention at lines 209 (`sop check`) and 236 (`sop advance`).
- Backward compatibility preserved: explicit `--project <path>` still wins; explicit `--project .` is now equivalent to omitting the flag (harmless).
- Test is a meaningful behavior assertion (seeds a unique project-only entry, asserts merged-view contains it; cross-checks explicit-flag parity; cross-checks service-level `readRegistry`). Not a branch-coverage padding test, per `coverage-red-line` memory.
- `process.chdir` is properly try/finally-scoped; no cross-test pollution risk in vitest's per-file worker isolation.
- Built-in peaks-* family never enters the custom registry (P1 invariant); default change preserves this boundary — `readRegistry` only reads from the two filesystem layers, both of which are user-authored.
- Help text in option description (`'... (default: current directory)'`) matches the convention used at lines 209 and 236.

## Reviewer recommendation

APPROVE. No CRITICAL or HIGH issues. The change is a minimal, correct default-value injection that follows the established pattern in the same file, is exercised by a meaningful behavior test, and preserves all existing invocations. Both LOW findings were addressed in the same implementation commit (description + doc).
