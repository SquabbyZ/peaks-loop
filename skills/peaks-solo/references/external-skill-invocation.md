# Canonical external-skill invocation pattern for Peaks skills

Peaks skills reference many external resources — `mattpocock/skills`, `gstack`, `awesome-design-md`, `taste-skill`, `design-taste-frontend`, `superpowers`, `shadcn/ui`, `React Bits`, `Chrome DevTools MCP`, `Agent Browser`, `Figma Context MCP`, `Penpot`, `Context7`, `SearchCode`, `claude-mem`, `context-mode`, `everything-claude-code`, `Claude Code Best Practice`, `andrej-karpathy-skills`, `OpenSpec`, `GitNexus`, and others.

Every reference must follow the same three-stage pattern so the Peaks gates stay authoritative and side effects stay observable.

## Stage 1 — Discovery before naming

Do not name an external skill or MCP server as if it is always available. Route discovery through the Peaks CLI first:

- `peaks capabilities --source access-repo --json` for non-MCP capabilities (skills, agents, rules, browser tools).
- `peaks capabilities --source mcp-server --json` for MCP servers.
- `peaks mcp list --json` for currently configured MCP servers in `.claude/settings.json`.

A skill body may mention the capability id, but it must say or imply that the skill only applies "when capability discovery exposes …" (or equivalent phrasing). Skills must not pretend the capability is already installed.

## Stage 2 — Reference, never auto-execute

External skills are inspection material for the role's own artifacts. They are not auto-runnable workflows. Every reference must:

- explicitly say it is a reference (e.g. "use these upstream methods as <role> references only");
- name the specific methods or surfaces the role borrows;
- forbid executing upstream instructions, installing upstream resources, persisting upstream examples, or running upstream installers;
- declare that the Peaks role artifacts remain authoritative.

For MCP servers, additionally state that installation goes through `peaks mcp plan` then `peaks mcp apply --yes` (with `--claim` only when the user authorizes overwriting a non-peaks-managed entry), and that `peaks mcp call` is the only invocation path for tool invocation.

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

All of these must route through the Peaks CLI under the appropriate command (`peaks mcp …`, `peaks artifacts …`, `peaks memory …`, `peaks openspec …`, `peaks standards …`, `peaks codegraph …`, `peaks capabilities …`), with dry-run preview where supported and `--yes` / `--apply` where a real write is required.

## Allowed in-process references

Some references are not external skills but project-approved utilities and may be named directly without the discovery stage:

- `gstack/browse/dist/browse` — a project-approved headed browser binary; the path-style reference is intentional. Login / CAPTCHA / SSO / MFA handoff rules still apply, and screenshots/cookies/tokens/storage state must be sanitized before retention.
- `peaks` CLI commands (this binary).
- `npx`, `npm`, `pnpm`, `yarn`, package managers — only as the underlying mechanism when a `peaks` CLI command spawns them.

These are not subject to capability discovery because they are part of the Peaks engineering surface, not external skills.

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
4. for MCP servers, point the user at `peaks mcp plan/apply/call` instead of describing manual `.claude/settings.json` edits;
5. rerun the audit.
