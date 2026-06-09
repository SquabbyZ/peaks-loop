# Skill presence (QA)

> Body of `## Skill presence (MANDATORY first action — main-loop context only)`. When this skill is running in the main Claude session (not as a sub-agent), before any analysis or tool call, immediately run:

```bash
peaks skill presence:set peaks-qa --project <repo> --mode <mode> --gate startup
```

On the first presence:set in a project, ensure the out-of-band status bar is installed so the user can see at a glance that Peaks is orchestrating — it renders the active skill in Claude Code's terminal status line, independent of model output:

```bash
peaks statusline install --project <repo>   # idempotent; skips if already installed
```

Read persistent project memory via CLI (durable, LLM-authored memories):

```bash
peaks project memories --project <repo> --json
```

This returns durable memories from `.peaks/memory` — decisions, conventions, modules, and rules captured in past sessions. Filter with `--kind <decision|convention|module|rule|reference|project>`. (`.peaks/PROJECT.md` is a human-readable session timeline only.)
Then display: `Peaks-Cli Skill: peaks-qa | Peaks-Cli Gate: startup | Next: <one short action>`. Update with `peaks skill presence:set peaks-qa --project <repo> --mode <mode> --gate <gate>` when gates change. When the role's work ends, run `peaks skill presence:clear --project <repo>`.