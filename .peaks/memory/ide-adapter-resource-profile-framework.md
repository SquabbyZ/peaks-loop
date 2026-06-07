---
name: ide-adapter-resource-profile-framework
description: IdeAdapter extended with standardsProfile + skillInstall — framework-first cross-IDE dispatch (Claude Code reference impl; Trae UNVERIFIED for 1.3.2)
metadata:
  type: decision
  sourceArtifact: .peaks/_runtime/2026-06-06-session-5b1095/rd/tech-doc-011-2026-06-07-ide-adapter-resource-profile.md
  predecessors:
    - trae-adapter-values-verified-against-1x
    - peaks-ide-skill-is-the-skill-first-pattern-5-step-flow-uses-existing-cli-primitives
  appliesTo: src/services/ide/ide-types.ts, src/services/ide/adapters/*.ts, src/services/ide/resource-profile.ts, scripts/install-skills.mjs
  status: shipped-1.3.2-framework
  followUps: slice-012-trae-real-install, slice-013-cursor-codex-qoder-lingma
---

# IdeAdapter resource-profile framework (slice #011)

## Decision (2026-06-07, slice #011, peaks-solo full-auto)

The `IdeAdapter` shape in `src/services/ide/ide-types.ts` is extended (purely additive) with two new `readonly?` optional fields:

```ts
IdeAdapter {
  // ... 12 existing fields unchanged ...
  standardsProfile?: IdeStandardsProfile  // { rootFile, rulesDir, rulesFileGlob, autoLoaded, format, migrationHint }
  skillInstall?: IdeSkillInstall          // { skillsDir, outputStylesDir, installStrategy, envVarOverride }
}
```

Both fields are optional. Adapters that don't declare them trigger a fallback path (legacy Claude Code write + stderr warning). The shape is purely additive — no existing adapter field changes.

## Why

Three cross-IDE hardcodes in peaks-cli 1.3.3 blocked Trae (and future Cursor / Codex / Qoder / Tongyi Lingma) adoption:

1. `peaks standards init` wrote `CLAUDE.md` + `.claude/rules/**` regardless of the user's IDE.
2. `peaks-solo` standards preflight read those same files.
3. `scripts/install-skills.mjs` (the npm `postinstall` hook) symlinked skills to `~/.claude/skills/` regardless of IDE.

Trae users got the work done at paths Trae does not auto-read — the result was invisible to their IDE. The fix had to be **generic**: future adapters should be one-entry registrations on the existing `IdeAdapter` shape, not per-IDE codepath rewrites.

The user's design preference (verbatim, 2026-06-07 18:15 GMT+8): "做成较为通用的话，后面其他的 LLM 适配就会更简单些" / "通用化" = framework first, per-IDE values are follow-up slices gated on real-install dogfood.

## What landed (slice #011 = 1.3.2 framework)

| Layer | Change | Byte-stable on Claude Code? |
|---|---|---|
| `IdeAdapter` type | + 2 new optional fields, 2 new interfaces | n/a (type only) |
| `CLAUDE_CODE_ADAPTER` | filled both new fields with current Claude Code paths | ✅ |
| `TRAE_ADAPTER` | `// Standards: UNVERIFIED — see slice #012+` annotation only | ✅ |
| `src/services/ide/resource-profile.ts` (new) | `getStandardsProfile` + `getSkillInstall` + `detectAllResourceTargets` accessors | n/a |
| `src/services/standards/ide-aware-standards-service.ts` (new) | thin wrapper that dispatches on `IdeRegistry.detect()` | ✅ for Claude Code path |
| `peaks standards init/update` | routes through the new wrapper; `--ide <id>` override flag | ✅ |
| `scripts/install-skills.mjs` | IDE-aware dispatch in `installBundledSkills` + `installBundledOutputStyles`; env-var back-compat | ✅ for default + env-var |
| 3 new test files | 31 new tests, all passing | n/a |
| `pnpm typecheck` | exit 0 | ✅ |
| 39 pre-existing Windows EPERM failures | unchanged | ✅ |

## Follow-up slices (out of scope for #011)

| Slice | Scope | Gate |
|---|---|---|
| **#012+** Trae real-install dogfood | Fill `TRAE_ADAPTER.standardsProfile` + `TRAE_ADAPTER.skillInstall` from real Trae 1.x install; remove UNVERIFIED annotation | User has access to a real Trae 1.x install (or CI fixture) |
| **#013+** Cursor | One-entry registration on the registry | Cursor docs available |
| **#013+** Codex | One-entry registration | Codex docs available |
| **#013+** Qoder | One-entry registration | Qoder docs available |
| **#013+** Tongyi Lingma | One-entry registration | Lingma docs available |
| **#014+** Trae MCP decouple | Change `capabilities.mcpInstall: false` to `true` after real dogfood | Slice #012 done |

## How to apply (for future adapter authors)

When adding a new IDE adapter (Cursor, Codex, Qoder, Lingma, or any new one):

1. Create `src/services/ide/adapters/<id>-adapter.ts` with the 12 existing `IdeAdapter` fields (slice #1 contract).
2. Add `standardsProfile` if the IDE auto-reads project-level agent instructions (Trae does not, per slice #011). Include `migrationHint` so the fallback warning tells the user where to manually move the file.
3. Add `skillInstall` if the IDE auto-loads skills from a known directory. Use `installStrategy: 'symlink'` if the IDE hot-reloads symlinks (Claude Code does); `'copy'` if not.
4. Add `mcpInstall: true` to `capabilities` only after a real install dogfood verifies the MCP install path on this IDE (per the Trae `mcpInstall: false` lesson).
5. Each new adapter is a one-entry registration on the registry — `peaks-cli`'s dispatch, postinstall, and CLI commands all go through the registry without codepath changes.

## Inverse rule (do not regress)

When a future slice changes the dispatch chokepoint (`resource-profile.ts` accessor, `install-skills.mjs` dispatch block, `ide-aware-standards-service.ts` wrapper), the change must:
- Preserve Claude Code byte-stability (PRD AC-2 / QA verdict).
- Preserve the env-var back-compat (PRD AC-5).
- Preserve the fallback warning when an adapter lacks the new field.
- Not add a new top-level `peaks <cmd>` (dev-preference red line).

If any of these are at risk, the slice is not "framework extension" — it is a "behavior change" slice and needs a fresh PRD with explicit preserved-behavior section.

## Cross-references

- Slice #011 PRD: `.peaks/_runtime/2026-06-06-session-5b1095/prd/requests/011-2026-06-07-ide-adapter-resource-profile.md`
- Slice #011 RD plan: `.peaks/_runtime/2026-06-06-session-5b1095/rd/tech-doc-011-2026-06-07-ide-adapter-resource-profile.md`
- Slice #011 QA verdict: pass, 0 findings
- Slice #011 TXT handoff: `.peaks/_runtime/2026-06-06-session-5b1095/txt/handoff-011-2026-06-07-ide-adapter-resource-profile.md`
- Predecessors: `trae-adapter-values-verified-against-1x` (Trae fields verified), `peaks-ide-skill-is-the-skill-first-pattern-5-step-flow-uses-existing-cli-primitives` (peaks-ide cross-IDE abstraction)
- Sibling slices in #011+ batch: F-3 cleanup, MCP decoupling, peaks-ide cleanup, Trae dogfood (already shipped in earlier commits per session log)
