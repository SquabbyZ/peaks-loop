---
name: 2026-08-01-agent-worktree-governance-bypass
kind: lesson
---

# Agent isolation bypassed Peaks worktree governance

During the statusline auto-compact implementation, six `Agent` calls used harness-level `isolation: worktree`. Claude Code created them under `.claude/worktrees/agent-*`, while Peaks reported no lease store, no lease events, and zero active/leaked leases. This bypassed the previously shipped Peaks L2 lifecycle path under `.peaks/_runtime/<sessionId>/worktree-leases` and left large worktree directories behind after agent completion.

## Evidence

- `git worktree list --porcelain` showed six live `.claude/worktrees/agent-*` worktrees plus five prunable stale registrations.
- `peaks worktree list --json` returned `leases: []`, `storeMissing: true`.
- `peaks lease-stats --json` returned zero sessions/events.
- `peaks lease-metrics --rate --json` returned zero lease-kind events.
- All implementation commits had patch-equivalent cherry-picked commits on `main`, but worktree commit ancestry differed because cherry-pick creates new SHAs.
- Windows `git worktree remove --force` failed with `Filename too long`; `\\?\` long-path deletion was required before pruning and branch removal.

## Root cause

The orchestration used the harness Agent tool's built-in `isolation: worktree`, not `peaks sub-agent dispatch --isolation worktree` / `peaks worktree spawn`. Peaks L1/L2/L3 governance cannot observe or auto-release a worktree created entirely by the host harness outside the Peaks CLI path.

## Rule

For Peaks-managed workflows, never request Agent-tool worktree isolation directly. Dispatch through the Peaks isolation primitive so lease spawn, heartbeat, terminal auto-release, metrics, and cleanup all execute. If the host harness requires its own worktree isolation, Peaks must add an adapter bridge before using it; otherwise run the sub-agent without host worktree isolation and use explicit ownership in the main tree.

## Cleanup

The six live directories, five stale registrations, and all `worktree-agent-*` branches were removed after explicit user authorization. Final state: only the main worktree remains; `.claude/worktrees/` is empty; Peaks lease state remains empty because the bypassed runs were never registered.
