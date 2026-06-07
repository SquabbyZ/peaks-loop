---
name: subagent-tool-matcher-per-ide
description: IdeAdapter.subAgentToolMatcher is a per-IDE string field; future adapters declare their own sub-agent tool name without touching hooks-settings-service
metadata:
  type: decision
---

Per-IdeAdapter.subAgentToolMatcher is a string field declared in `src/services/ide/ide-types.ts`. The `peaks progress start` PreToolUse hook (installed by `peaks hooks install`) uses this field as the `matcher` for the hook entry in the IDE's settings.json.

**Why:** slice `2026-06-06-sub-agent-spawn-bug-and-decouple` G3 (commits d493006 + 5257dca) added the field. The previous hardcoded `'Task'` literal in `resolveHookSpec` was a Claude-Code-specific assumption that had been duplicated in two branches of `hooks-settings-service.ts` plus a fallback in `hooks-commands.ts`. Cursor/Codex/Qoder/Tongyi-lingma may call their sub-agent tool something else (e.g. `SubAgent`, `Agent`); the previous design forced future adapters to either inherit Claude's name (wrong) or edit the service file (governance violation).

**How to apply:**
- When adding a new IDE adapter, set `subAgentToolMatcher` to the actual tool name that IDE uses to dispatch a sub-agent (Claude Code → `Task`, Trae → `Task` UNVERIFIED, others → TBD on dogfood).
- Do NOT add `if (ide === 'new-ide')` branches in `hooks-settings-service.ts`. The per-IDE dispatch goes through `adapter.subAgentToolMatcher`.
- Treat the byte-level install output as a contract: when changing `subAgentToolMatcher` for claude-code or trae, ensure the resulting `.claude/settings.json` / `.trae/settings.json` matches the prior install (modulo new adapters).
- Trae's `'Task'` is UNVERIFIED — matches the prior hardcoded literal. A future slice should dogfood a real Trae install to confirm.

**Cross-references:**
- `[[slim-ideadapter-shape-is-the-contract]]` — the IdeAdapter shape is "fill the table"
- `[[trae-adapter-sets-mcpinstall-false-trae-mcp-integration-is-unverified]]` — precedent for UNVERIFIED adapter fields
- slice tech-doc: `.peaks/_runtime/2026-06-06-session-5b1095/rd/requests/001-2026-06-06-sub-agent-spawn-bug-and-decouple.md`
