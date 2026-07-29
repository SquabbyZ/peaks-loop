# Worktree governance — 3-layer design

> **Source of truth.** This document is the canonical reference for peaks-loop's worktree posture. The SKILL.md `## Worktree governance` chapter carries the heading + 1-line pointers; the full design lives here. Editing peaks-loop source propagates to every consumer project on `npm install`.

## The problem this solves

Sub-agents using raw `git worktree add` to escape governance:

1. The superpowers chain ends in `superpowers:using-git-worktrees` SKILL.md line 96 (`git worktree add "$path" -b "$BRANCH_NAME"`). An LLM that follows `brainstorming` → `writing-plans` → `subagent-driven-development` → `using-git-worktrees` will land on raw `git worktree add` without ever touching peaks-loop's hooks.
2. Worktrees created outside peaks-loop's governance are invisible to `peaks worktree auth grant|revoke|status` — the L2 hook gate cannot deny or grant them.
3. Worktree-only artifacts (`.peaks/_runtime/<sessionId>/<role>/requests/<rid>.md` written from inside a worktree) may be lost when the worktree is pruned mid-run. Lesson 1 of [[2026-07-27-rid-016-monorepo-delete-5-subpackages]] documents the failure mode.

## Three-layer design (defence in depth)

| Layer | Mechanism | Strength | Failure mode |
|---|---|---|---|
| L1 | Sub-agent system prompt `MUST NOT` on the superpowers chain | Weak — LLM may forget | Prose-only; no enforcement |
| L2 | PreToolUse hook → `peaks gate enforce` → `evaluateWorktreeAuth` | Medium — sees every tool call but cannot intercept Skill selection | Hook bypassed if user disables `peaks hooks install` |
| L3 | IDE `permissions.deny: ["UseSkill(superpowers:using-git-worktrees)"]` | Strongest — IDE refuses Skill BEFORE LLM sees it | Requires `peaks hooks install` to have run; bypassed by `--dangerously-skip-permissions` |

The 3 layers stack. L3 is the strongest because it operates BELOW the LLM's tool-call decision: the Skill never appears in the LLM's tool list, so the LLM cannot choose to invoke it.

## L1 — Sub-agent system prompt

The explicit `MUST NOT` block lives in:
- `peaks-rd/references/rd-sub-agent-dispatch.md`
- `peaks-qa/...`
- `peaks-ui/...`
- `peaks sub-agent dispatch` CLI prompt template

Each prompt template carries the block:
> MUST NOT follow the superpowers chain (`brainstorming` → `writing-plans` → `subagent-driven-development` → `using-git-worktrees`) for worktree decisions. The chain is reference material, not a workflow. For worktree operations, use `peaks worktree spawn --rid <id> --ttl <duration> --purpose <text>` (or, until that ships, fall back to L2 hook gate + manual `peaks worktree auth grant`).

L1 is the weakest layer because the LLM is the decision-maker and may forget the block under load. L3 exists to catch L1 failures.

## L2 — Hook + lifecycle gate

`peaks hooks install` writes a PreToolUse hook that calls `peaks gate enforce` BEFORE the IDE permission system. For worktree operations:

```bash
# User authorizes a worktree operation
peaks worktree auth grant \
  --rid rid-2026-07-29-worktree-spawn \
  --reason "RD sub-agent for worktree spawn slice" \
  --ttl 5m
# Output: grant token, single-use by default
```

The token authorizes exactly one `git worktree add` matching the granted scope (path / branch / rid). 5 deny codes:
- `REQUIRED` — no grant on file, request denied
- `EXPIRED` — TTL elapsed, re-authorize
- `REQUEST_MISMATCH` — git args don't match the granted scope
- `CONSUMED` — token already used (single-use)
- `FILE_INVALID` — grant file unreadable / corrupted

Implementation: `src/services/hooks/worktree-authorization-gate.ts`. Sediment: `.peaks/memory/2026-07-27-worktree-user-auth-hard-gate.md`.

## L3 — IDE `permissions.deny`

`peaks hooks install` ALSO writes a `permissions.deny` block into the IDE settings.json:

```json
{
  "permissions": {
    "deny": [
      "UseSkill(superpowers:using-git-worktrees)"
    ]
  }
}
```

The deny entry is wrapped in the IDE's `UseSkill(...)` envelope (Claude Code's permission-system syntax). Claude Code refuses to invoke any Skill listed there BEFORE the LLM sees the Skill's name in the available-tool list.

Single source of truth: `SUPERPOWERS_DENIED_SKILLS` in `src/services/skills/hooks-settings-service.ts`. To deny a new skill, append its id there and re-run `peaks hooks install`.

Sediment: `.peaks/memory/2026-07-29-worktree-layer3-deny.md`.

## Sub-agent worktree contract (mandatory)

Every sub-agent dispatched by peaks-rd / peaks-qa / peaks-ui / peaks-sc / peaks-txt MUST:

1. **Use `peaks worktree spawn --rid <rid> --ttl <duration> --purpose <text>`** for any worktree operation. Raw `git worktree add` is forbidden.
2. **Treat the superpowers chain as reference material only.** It MAY inform PRD / RD planning but MUST NOT drive tool selection.
3. **Write artifacts under `.peaks/_runtime/<sessionId>/<role>/requests/` in the MAIN checkout.** Dispatch with `--project .` (the main workdir), NOT `--project .claude/worktrees/...`. Worktrees are ephemeral; main is durable.

## Operator runbook

- **Manual authorization**: `peaks worktree auth grant|revoke|status` (L2 surface).
- **Inspect L3 state**: `peaks hooks status` reports `permissionsDenyEntries` (desired) + `permissionsDenyOnDisk` (reality).
- **Refresh L3 deny block**: `peaks hooks uninstall && peaks hooks install` re-writes the block from `SUPERPOWERS_DENIED_SKILLS`.
- **Diagnose L3 failures**: the on-disk `permissions.deny` is the source of truth. If a Skill bypasses the deny, the IDE permission system is broken (not peaks-loop's problem).

## Future rid path

| rid | Layer | Goal | Status |
|---|---|---|---|
| rid-L1 | L1 | Hard-coded prompt hardening across all dispatch templates | Pending |
| rid-L2-extended | L2 | `peaks worktree spawn` with lease lifecycle, removing manual `peaks worktree auth grant` loop | Pending |
| rid-L3-extended | L3 | Append new deny skills to `SUPERPOWERS_DENIED_SKILLS` as needed | Trigger-only |

## Related memories

- [[2026-07-27-worktree-user-auth-hard-gate]] — L2 baseline, shipped earlier.
- [[2026-07-29-worktree-layer3-deny]] — L3 Minimal Viable rationale.
- [[2026-07-27-rid-016-monorepo-delete-5-subpackages]] — Lesson 1: worktree-only artifact fragility.
- [[2026-07-24-peaks-code-bridge-002-rootcause]] — peaks-code ↔ superpowers bridge baseline.