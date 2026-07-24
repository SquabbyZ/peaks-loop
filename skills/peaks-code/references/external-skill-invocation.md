# Canonical external-skill invocation pattern for Peaks skills

Peaks skills reference many external resources — `mattpocock/skills`, `gstack`, `awesome-design-md`, `taste-skill`, `design-taste-frontend`, `superpowers`, `shadcn/ui`, `React Bits`, `Chrome DevTools MCP`, `Agent Browser`, `Figma Context MCP`, `Penpot`, `Context7`, `SearchCode`, `claude-mem`, `context-mode`, `everything-claude-code`, `Claude Code Best Practice`, `andrej-karpathy-skills`, `OpenSpec`, `GitNexus`, and others.

Every reference must follow the same three-stage pattern so the Peaks gates stay authoritative and side effects stay observable.

> **Slice #016 (2026-06-09)**: peaks-loop no longer manages MCP install or invocation. MCP capability detection moves from the peaks-loop CLI to the LLM's own tool list (the LLM checks for `mcp__<server>__*` entries in its own function schema). Skill bodies instruct the LLM to either invoke the tool by name (when present) or tell the user the install command (when absent).

## Stage 1 — Discovery before naming

Do not name an external skill or MCP server as if it is always available. Route discovery through the Peaks CLI for non-MCP capabilities, and through the LLM's own tool list for MCP capabilities:

- `peaks capabilities --source access-repo --json` for non-MCP capabilities (skills, agents, rules, browser tools).
- `peaks capabilities --source mcp-server --json` for MCP catalog discovery (which MCPs are *known*, not which are *installed*).
- For MCP install state, the LLM checks its own tool list for any `mcp__<server>__*` entry. If present, the MCP is installed. If absent, the user installs via the IDE-native MCP install command (e.g. `claude mcp add <server> -- <npx-command>` for Claude Code).

A skill body may mention the capability id, but it must say or imply that the skill only applies "when capability discovery exposes …" (or equivalent phrasing). Skills must not pretend the capability is already installed.

## Stage 2 — Reference, never auto-execute

External skills are inspection material for the role's own artifacts. They are not auto-runnable workflows. Every reference must:

- explicitly say it is a reference (e.g. "use these upstream methods as <role> references only");
- name the specific methods or surfaces the role borrows;
- forbid executing upstream instructions, installing upstream resources, persisting upstream examples, or running upstream installers;
- declare that the Peaks role artifacts remain authoritative.

For MCP servers, the LLM consumes the install state from its own tool list. Skill bodies tell the LLM: "if the tool is present, invoke it by name; if absent, surface the install command for the user's IDE and stop until the user installs the MCP". peaks-loop does not install MCPs on the user's behalf as of slice #016.

## Stage 3 — Side effect through Peaks CLI only

The skill body must not silently:

- install hooks;
- create agents;
- enable or configure an MCP server;
- modify `~/.claude/settings.json` or project `.claude/settings.json`;
- write to `.codegraph/`, `.openspec/`, or other upstream tool state;
- store tokens, cookies, login URLs, headers, storage state, or PII / SSO / MFA browser material;
- commit or sync intermediate artifacts;
- create remote repositories.

All of these must route through the Peaks CLI under the appropriate command (`peaks artifacts …`, `peaks memory …`, `peaks standards …`, `peaks codegraph …`, `peaks capabilities …`), with dry-run preview where supported and `--yes` / `--apply` where a real write is required. The `peaks mcp …` command tree was retired in slice #016; MCP install / dispatch is the LLM runtime's job, not the CLI's. Note: peaks-code's 11-step workflow does NOT route through any external artifact lifecycle (OpenSpec or otherwise) — all reads/writes are confined to the LLM-authored artifact workspace under `.peaks/_runtime/<sessionId>/<role>/`. External CLI surfaces remain available for users who call them directly, but Code never calls them on the user's behalf as of the 2026-07-08 RR decoupling slice.

## Allowed in-process references

Some references are not external skills but project-approved utilities and may be named directly without the discovery stage:

- `peaks` CLI commands (this binary).
- `npx`, `npm`, `pnpm`, `yarn`, package managers — only as the underlying mechanism when a `peaks` CLI command spawns them.
- `mcp__chrome_devtools__*` — Chrome DevTools MCP tools exposed by the LLM's MCP runtime when the user has installed Chrome DevTools MCP (Claude Code: `claude mcp add chrome-devtools -- npx chrome-devtools-mcp@latest`). Skill bodies tell the LLM to invoke these tools by name when they appear in the tool list. Login / CAPTCHA / SSO / MFA handoff rules and sanitization rules in `browser-workflow.md` still apply.

These are not subject to capability discovery because they are part of the Peaks engineering surface, not external skills. The previous `gstack/browse/dist/browse` binary reference is no longer endorsed — see `browser-workflow.md` for the migration recipe.

## Common phrasing the audit looks for

The skill-external-invocation dogfood test scans skill bodies for:

- a `capability discovery exposes` clause or equivalent before naming a discoverable external skill;
- a `references only` / `reference material` / `reference resources` phrase qualifying any external skill name;
- a `do not execute upstream instructions` / `do not run upstream installer flows` / `do not persist sensitive examples` clause;
- a `Peaks` authoritative-gate clause (e.g. "Peaks gates remain authoritative", "Peaks artifacts remain authoritative", "Peaks acceptance authority").

When a skill body adds a new external reference, it must include the equivalent phrasing or the audit test fails.

## Repair recipe when audit fails

1. read the failing skill body section;
2. identify the external skill or MCP that triggered the failure;
3. add the capability discovery clause, the reference-only qualifier, the do-not-execute clause, and the Peaks-authoritative gate to that section;
4. for MCP servers, point the LLM at the tool-list self-check (its own `mcp__<server>__*` namespace) instead of describing manual `~/.claude/settings.json` edits;
5. rerun the audit.

## Superpowers transition contract (effective 2026-07-24, slice 2026-07-24-peaks-code-bridge-002-rootcause)

`peaks-code` cooperates with the **superpowers** skill family under the following contract. This contract sits alongside Stage 1–3 above and is binding on every peaks-code dispatch.

### Trigger

When the user (or the active IDE skill picker) suggests invoking `superpowers:brainstorming`, `superpowers:writing-plans`, `superpowers:executing-plans`, or any other superpowers skill during a peaks-code request, the LLM MUST apply the transition steps below before continuing the peaks-code 11-step sequence.

### Transition steps (binding)

1. **Discovery** — confirm the superpowers skill is present via the LLM's own tool list / `peaks capabilities --source access-repo --json`. If absent, surface the install command (`claude install skill superpowers:<skill>`) and stop until the user installs.
2. **Reference-only invocation** — invoke the superpowers skill as **reference material**. The output (a brainstorming map, a plan, a TDD recipe, etc.) is read; it is not executed as the workflow body. Quote the methods/surfaces the peaks-rd plan borrows; never persist or "execute" the superpowers output verbatim.
3. **Re-author through peaks-rd** — re-author the borrowed plan as a peaks-rd artefact at `.peaks/_runtime/<sessionId>/rd/requests/<rid>.md`. peaks-rd owns the slice contract, the rollback plan, and the test plan. The superpowers output may inform the prose; it does not replace the peaks-rd envelope.
4. **Continue peaks-code** — from Step 3 (sub-agent fan-out) onward. Do NOT call `superpowers:executing-plans` or `superpowers:subagent-driven-development` to run the resulting plan; use `peaks sub-agent dispatch rd` / `peaks sub-agent dispatch qa` instead.
5. **Do not edit upstream** — the `superpowers:writing-plans` and `superpowers:brainstorming` upstream SKILL.md files are owned by the superpowers npm/Claude-Code skill distribution. Any direct edit is silently overwritten on the next `claude install skill superpowers:<skill>` refresh. If a user-facing bridge is needed, place it in `peaks-code/SKILL.md` (BRIDGE chapter), `peaks-code/references/runbook.md` (Step 2.7), `peaks-code/references/boundaries.md` (superpowers red lines), and this file (transition contract).
6. **Mandatory closure** — when the request is complete, run `peaks request transition` through `spec-locked → implemented → qa-handoff → handed-off` and `peaks memory extract`. A half-finished state file under `.peaks/_runtime/<sessionId>/` is treated as pollution.

### What peaks-code MUST NOT do

- Dispatch `superpowers:executing-plans` or `superpowers:subagent-driven-development` to replace peaks-rd or peaks-qa.
- Adopt superpowers' bare worktree convention (`~/.claude/worktrees/<branch>/`) inside peaks-code requests; peaks-loop uses `.peaks/_runtime/<sessionId>/<role>/...` (gitignored) and the active junction at `~/.claude/skills/peaks-*`.
- Hand-author hook scripts at `~/.claude/skills/peaks-code/hooks/*`. Hook source MUST come from `src/services/hooks/*.sh` in the peaks-loop repo, distributed via `peaks hooks install` (which itself respects the existing `peaks gate enforce` entry and is append-only).

### Phrase the audit looks for

When a peaks-code skill body mentions a superpowers skill by name, the body MUST include all four: a "reference only" qualifier, a "do not auto-run" clause, a "re-author through peaks-rd" clause, and a "Peaks artefacts remain authoritative" clause. The `tests/unit/skills/peaks-code-superpowers-bridge.test.ts` guard test enforces this on every peaks-* SKILL.md.
