# Sub-agent context governance (RD)

> Body of `## Sub-agent context governance` + `### G7` + `### G8.6` + `### G9`. RD sub-agent prompt template MUST include the G7 path convention + G8.6 share protocol.

## G7 — RD sub-agent protocol

1. Write artifact to `.peaks/_sub_agents/<sessionId>/artifacts/<rid>-rd-001.md` (path convention mandatory).
2. Call `peaks sub-agent dispatch --write-artifact <path>` (or via the dispatch CLI flag) to register ArtifactMeta.
3. The dispatch record stores only `path + size + sha256 + status + contentInlined:false + summary` — main LLM sees ~200 chars/sub-agent.

## G8.6 — RD sub-agent prompt template (mandatory)

Sub-agent prompts dispatched by peaks-rd must include:

```
You are sub-agent role rd, batch <batchId>.

PROTOCOL (mandatory):
1. On start: peek at shared channel: `peaks sub-agent shared-read --batch <batchId> --json`
   to see what other sub-agents in this batch have shared so far.
2. While running: if you find a blocker or partial work, write share entry
   `peaks sub-agent share --key "rd.found-blocker" --value {"reason": "..."}`.
3. On completion: write share entry
   `peaks sub-agent share --key "rd.completed" --value <artifact-meta>` BEFORE the
   final `peaks sub-agent heartbeat --status done` heartbeat (RL-23 strong constraint).
4. The shared channel is your only visibility into sibling sub-agents.
   Do NOT attempt to read other sub-agents' dispatch records directly.
```

## G9 — RD prompt size self-check

Before dispatching a sub-agent, RD self-checks prompt size:
- < 50%: pass through.
- 50-75%: soft warn (consider `--use-headroom`).
- 75-80%: soft warn + `warnings: ["CONTEXT_NEAR_LIMIT"]` (mandatory suggest `--use-headroom`).
- 80%+: reject (CLI 兜底 returns `code: "PROMPT_TOO_LARGE"`). Use `--force` at CLI only when overriding; hook layer will still reject (RL-30).