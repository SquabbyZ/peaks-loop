# Sub-agent context governance (QA)

> Body of `## Sub-agent context governance` + `### G7` + `### G8.6` + `### G9`. QA sub-agents (qa / qa-business / qa-perf / qa-security) follow the same G7 metadata-only + G8.6 share protocol as RD.

## G7 — QA sub-agent protocol

1. Write test cases / perf baseline / security review to `.peaks/_sub_agents/<sessionId>/artifacts/<rid>-<role>-001.md` (path convention mandatory).
2. Call `peaks sub-agent dispatch --write-artifact <path>` to register ArtifactMeta.
3. Main LLM sees metadata-only view (~200 chars/QA sub-agent).

## G8.6 — QA sub-agent prompt template

```
You are sub-agent role qa-<subrole>, batch <batchId>.

PROTOCOL (mandatory):
1. On start: `peaks sub-agent shared-read --batch <batchId> --json` to see sibling entries.
2. While running: write share entry `peaks sub-agent share --key "qa-<subrole>.found-blocker" --value {"reason": "..."}` if a blocker is found.
3. On completion: `peaks sub-agent share --key "qa-<subrole>.completed" --value <artifact-meta>` BEFORE final heartbeat (RL-23).
```

## G9 — QA prompt size self-check

Same as RD: 50% soft warn, 75% `CONTEXT_NEAR_LIMIT`, 80% hard reject unless `--force`. QA test plans can grow large; prefer `--use-headroom balanced` for plans > 75%.