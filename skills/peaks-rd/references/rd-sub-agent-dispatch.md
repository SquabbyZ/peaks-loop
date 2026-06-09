# Sub-agent dispatch (RD)

> Body of `## Sub-agent dispatch`. When this skill is launched as a sub-agent via `peaks sub-agent dispatch <role>` (then the LLM executes the returned toolCall) from `peaks-solo`, the following sections of THIS skill are **suspended** for the sub-agent run:

- **Session id** — use the parent's sid (read `.peaks/_runtime/session.json` or pass `--session-id <parent-sid>` to any session-creating CLI). Do NOT spawn your own session. The new `peaks session info --active` reads the canonical binding for you.
- **Skill presence (MANDATORY first action)** — do NOT call `peaks skill presence:set peaks-rd`. The sub-agent must not overwrite `.peaks/.active-skill.json`; the main Solo loop owns that file. If you need to mark your own state, write a marker file at `.peaks/_runtime/<sessionId>/system/sub-agent-rd.json` and only that.
- **Workspace initialization** — Solo has already run `peaks workspace init` before fan-out. Do not re-run it.
- **Mode selection** — Solo has already chosen the mode. Read it from the prompt arguments (or from `.peaks/.active-skill.json` if you can, but do not write it).
- **Statusline install** — already done by Solo at session startup; do not re-run.

What the sub-agent **MUST** still do, from this skill's contract:

0. **Do NOT call `peaks request init`** — Solo has already initialised the request artefact slot in the main loop before fan-out (the runbook has the exact `peaks request init --role rd --id <rid> --project <repo> --apply --type <type> --json` call). The sub-agent reads the slot via `peaks request show <rid> --role rd --project <repo> --json` if it needs to. Note: `peaks request init` is **dry-run by default**. Pass `--apply` to actually create the artifact.
2. `peaks request show <rid> --role prd --project <repo> --json` (and `--role ui` if UI is in the swarm plan).
3. Standards preflight (dry-run only; Solo owns the apply step).
4. Project-scan read; create `rd/project-scan.md` only if Solo flagged it missing in the dispatch prompt.
5. Write the planning artefact: `rd/tech-doc.md` (feature/refactor) or `rd/bug-analysis.md` (bugfix). If `--type` is `config|docs|chore`, **no planning artefact is required** — return immediately with `{"role":"rd-planning","status":"skipped","reason":"type=<type>"}`.
6. Return only a compact JSON envelope — Solo will run the convergence gate (`ls` checks):

```json
{
  "role": "rd-planning",
  "rid": "<rid>",
  "status": "ok" | "blocked" | "skipped",
  "artefacts": [".peaks/_runtime/<sessionId>/rd/tech-doc.md"],
  "warnings": [],
  "blockedReason": null
}
```

**Hard prohibitions** (sub-agent context, in addition to general red lines):

- Do NOT call `Skill(skill="...")` from inside the sub-agent — that defeats the fan-out.
- Do NOT call `peaks skill presence:set` — Solo owns the active-skill file.
- Do NOT commit, push, install hooks, or apply settings.json mutations.
- Do NOT ask the user interactive questions. If you need clarification, return `{"status":"blocked","blockedReason":"<text>"}` and let Solo handle the user message.
- Do NOT modify code (the Swarm phase is planning only; code edits happen in the RD implementation phase, which is a separate sub-agent or inline run after Gate B).

After returning, Solo re-checks Gate B (`ls .peaks/_runtime/<sessionId>/rd/tech-doc.md` etc.) and proceeds to RD implementation, which is a different sub-agent or inline run.