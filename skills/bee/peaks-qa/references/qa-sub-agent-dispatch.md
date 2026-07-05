# Sub-agent dispatch (QA)

> Body of `## Sub-agent dispatch`. When this skill is launched as a sub-agent via `peaks sub-agent dispatch <role>` (then the LLM executes the returned toolCall) from `peaks-code`, the following sections of THIS skill are **suspended** for the sub-agent run:

- **Session id** — use the parent's sid (read `.peaks/_runtime/session.json` or pass `--session-id <parent-sid>` to any session-creating CLI). Do NOT spawn your own session. The new `peaks session info --active` reads the canonical binding for you.
- **Skill presence (MANDATORY first action)** — do NOT call `peaks skill presence:set peaks-qa`. The sub-agent must not overwrite `.peaks/.active-skill.json`; the main Solo loop owns that file. If you need to mark your own state, write a marker file at `.peaks/_runtime/<sessionId>/system/sub-agent-qa.json` and only that.
- **Workspace initialization** — Solo has already run `peaks workspace init` before fan-out. Do not re-run it.
- **Mode selection** — Solo has already chosen the mode.
- **Statusline install** — already done by Solo at session startup.

What the sub-agent **MUST** still do:

0. **Do NOT call `peaks request init`** — Solo has already initialised the request artefact slot in the main loop before fan-out. The sub-agent reads it via `peaks request show <rid> --role qa --project <repo> --json` if it needs to.
2. `peaks request show <rid> --role prd --project <repo> --json` (and `--role rd`, `--role ui` if UI is in the swarm plan).
3. Standards preflight (dry-run only).
4. Write `.peaks/_runtime/<sessionId>/qa/test-cases/<rid>.md` with test cases that link to PRD acceptance items.
5. Return only a compact JSON envelope:

```json
{
  "role": "qa-test-cases",
  "rid": "<rid>",
  "status": "ok" | "blocked" | "skipped",
  "artefacts": [".peaks/_runtime/<sessionId>/qa/test-cases/<rid>.md"],
  "warnings": [],
  "blockedReason": null
}
```

**Hard prohibitions** (sub-agent context):

- Do NOT call `Skill(skill="...")`.
- Do NOT call `peaks skill presence:set` — Solo owns the active-skill file.
- Do NOT run the actual test suite, do NOT execute security/perf tools, do NOT open a browser — those are the **QA validation** phase, not the Swarm planning phase.
- Do NOT commit, push, install hooks, or apply settings.json mutations.
- Do NOT ask the user interactive questions. If you need clarification, return `{"status":"blocked","blockedReason":"<text>"}`.

If `--type` is `docs` or `chore`, return `{"status":"skipped","reason":"type=<type>"}` and exit — there is no acceptance surface to plan tests for.

## Test Tool Detection (mandatory)

The dispatch CLI (`peaks sub-agent dispatch`) automatically prepends a Test Tool Detection block to every sub-agent prompt — telling the sub-agent to read `package.json#scripts.test` first and use the project-local runner (`./node_modules/.bin/<runner>` or `pnpm test -- <file>`). NEVER use `npx <runner>`. This rule is machine-injected, not a prompt ritual — every sub-agent gets it including rd/qa/ui/txt/sc.

If the framework is not obvious from `package.json#scripts.test`, the sub-agent should run `peaks test --json` to introspect the resolved framework + argv before picking a runner.

See the block constant at `src/services/dispatch/test-tool-detection.ts` for the verbatim text.