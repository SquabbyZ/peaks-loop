---
name: active-skill-cli-routing
description: LLM reads active-skill via `peaks skill presence --json`, not by Read-ing the file directly. The CLI handles canonical-path + legacy-back-compat resolution.
metadata:
  type: feedback
---
<!-- peaks-feedback-promoted: layer=A -->

# Active-skill reads go through the CLI

When checking the active Peaks skill (for the status header / gate display), **always invoke `peaks skill presence --json`**. Never `Read .peaks/.active-skill.json` or `Read .peaks/_runtime/active-skill.json` directly.

## Why

There are two on-disk paths for the same logical marker:

- **Canonical** (current write target): `.peaks/_runtime/active-skill.json`
- **Legacy** (one-minor-release back-compat read fallback): `.peaks/.active-skill.json`

The dual-path is **intentional** — see `src/services/skills/skill-presence-service.ts:86-87`, `src/services/skills/skill-statusline-service.ts:22-23`, `src/services/sc/sc-service.ts:228-229`, `src/services/workspace/reconcile-service.ts:335-336`. The CLI's `getSkillPresence()` reads new → legacy; the legacy fallback exists for older workspaces that haven't migrated.

If you `Read` either path directly:

- Reading `.peaks/.active-skill.json` → ENOENT in current projects (the file moved in R3 session-dir refactor) → header never displays.
- Reading `.peaks/_runtime/active-skill.json` → works today, but couples the LLM to a path that may move again. The CLI is the contract; the path is implementation detail.

`peaks skill presence --json` returns `{ ok, command, data: { active, skill, sessionId, outerSessionId, setAt, lastHeartbeat } }`. The CLI is the seam — it owns path resolution, the LLM owns interpretation.

## How to apply

- **Every response** in a Peaks-skill-driven session: run `peaks skill presence --json` once at the top, parse the JSON, render the compact status header from `data.skill` / `data.gate` / `data.nextAction`.
- **Never** add a `Read` of `.peaks/**/active-skill.json` to your tool list.
- **If the CLI returns `{ data.active: false }` or an error envelope**: do not show the header. Don't fall back to a direct file read.

## Where this is codified

Three instruction surfaces were updated to remove the direct-read instruction:

- `CLAUDE.md` line 18 (the project root instruction)
- `src/services/standards/project-standards-service.ts` lines 235 + 243 (the generated standards block in Chinese + English)
- `.claude/output-styles/peaks-skill-swarm.md` line 54 (the output-style persistence rule)

Other references to `.peaks/.active-skill.json` in `skills/peaks-*/references/*.md` were **intentionally left untouched** — those describe the legacy path in context (sub-agent single-writer rule, migration direction, tolerance of legacy paths), not "go read this file". Rewriting them would lose those semantics.

## Dogfood evidence (2026-06-10 micro-cycle)

- `peaks skill presence --json` returns the active skill correctly: `{ active: true, skill: "peaks-solo", sessionId: "2026-06-10-session-c4a2be", ... }`
- Tests: 18 + 42 + 8 + 15 = **83 tests pass** across `project-standards-service`, `skill-presence-service`, `skill-statusline-service`, `session-dir-canonical`. 1 pre-existing skip.
- `tsc --noEmit`: **0 errors**.
- No test asserts the old "Read `.peaks/.active-skill.json`" string, so the doc-only change did not break any test.

## Cross-reference

- Skill-first rule (`.claude/rules/common/dev-preference.md`): CLI earns its keep when the consumer needs structured JSON to gate a decision. The active-skill header is exactly that pattern — one JSON probe per turn, no path coupling.
- Future path migrations: change the canonical path in `skill-presence-service.ts` + run `peaks workspace migrate --apply` for existing workspaces. **Do not** also have to update CLAUDE.md / standards / output-style — they reference the CLI, not the path.