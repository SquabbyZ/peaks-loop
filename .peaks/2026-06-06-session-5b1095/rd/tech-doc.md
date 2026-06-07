# RD tech-doc 003-2026-06-07-sub-agent-context-governance

> Full content in `.peaks/_runtime/2026-06-06-session-5b1095/rd/tech-doc-2026-06-07-sub-agent-context-governance.md`.
> This file is the symlink target for the `peaks request transition` gate.

## Red-line scope

Slice #010 implements G7 + G7.7 + G8 + G9 (4 architectural red lines
registered at slice #009 closeout). The slice contract is bounded by
28 acceptance criteria (AC-38..AC-65) and 0 new top-level CLI commands.
See the full tech-doc at
`.peaks/_runtime/2026-06-06-session-5b1095/rd/tech-doc-2026-06-07-sub-agent-context-governance.md`
for the architecture, G7.4 metadata-only design, G7.7 headroom bridge,
G8 SharedChannel file format, G9 threshold table + hook install,
type signatures, and key algorithms.

## Files (8 new + 2 modified + 5 SKILL.md + 2 references + 7 tests)

- 6 new `src/services/context/*` files
- 1 new `src/cli/commands/sub-agent-dispatch-guard.ts` (internal atom)
- 1 new `src/hooks/pre-tool-use-sub-agent.ts`
- 2 modified: `src/cli/commands/sub-agent-commands.ts` (additive flags +
  sub-verbs), `src/services/ide/ide-types.ts` (additive `promptSizeAware`)
- 5 SKILL.md updates + 2 new references
- 7 new test files (5 unit + 2 integration)
- 1 new dep: `headroom-ai@0.22.4` (Apache-2.0, MIT-compatible)

## 8 incremental commits (no AI trailer; global gitconfig identity)

2a65ff2 | feat(context): add G7 ArtifactMeta + path safety + sha256 helpers
e1a0ddf | feat(context): add G9 threshold constants + context-guard + --force semantics
32a10e9 | feat(dispatch): add --write-artifact, --use-headroom, --force flags + share/shared-read
85f4536 | feat(hooks): add peaks sub-agent-dispatch-guard + PreToolUse hook for G9
a78389c | test(context): add G7 + G9 unit tests
6855f2a | test(context): add G8 + G9.5 hook + integration dogfood tests + THIRD_PARTY_LICENSES
aa8c658 | feat(skills): add G7 + G7.7 + G8 + G9 segments to peaks-solo/rd/qa/ui/txt SKILL.md
88dbb7f | chore(cli): add --prompt-length DOGFOOD ONLY flag for large-prompt dogfood

## Test results

- pnpm typecheck: PASS
- 98 new tests: PASS (49 G7+G9 unit + 25+9 G8 unit + 14 G9.5 integration + 4 G7+G8 dogfood integration)
- PB-3 baseline: 30-fail Windows EPERM preserved (no regression)

## 5 mandatory dogfood paths verified end-to-end

1. 75% warning: 200KB → CONTEXT_NEAR_LIMIT, dispatch allowed
2. 80% reject: 210KB → PROMPT_TOO_LARGE, hard reject
3. 80% + --force: 210KB → FORCED_OVER_THRESHOLD + forcedAt
4. Hook layer: 210KB → allow: false (NO --force at hook layer per RL-30)
5. Headroom fallback: 200KB + --use-headroom → HEADROOM_UNAVAILABLE + G7 fallback
