# Multi-IDE Adapter Policy — peaks-loop governance for adapter field verification

**Date:** 2026-07-24
**Session:** `2026-07-24-session-f13da7`
**Rid:** `2026-07-24-rid-002-b1-n3-adapter-policy`
**Source:** `.peaks/_runtime/.../analysis/N3-ide-adapter-readiness-2026-07-24.md`

> Governance policy for the 7 currently-registered IDE adapters
> and 2 type-literal placeholders (`qoder`, `tongyi-lingma`) that
> do not yet have adapter files. Future LLM or user encountering
> an adapter request should follow this policy.

## 1. State table at policy freeze

| IDE id | Adapter file present? | Verified-vs-1.X? | UNVERIFIED fields count |
|---|---|---|---|
| `claude-code` | ✅ | VERIFIED (MVP) | 0 |
| `trae` | ✅ | VERIFIED (slice 009 fixture) | 0 (originally 4, all re-verified) |
| `cursor` | ✅ | 2 UNVERIFIED | 2 |
| `codex` | ✅ | 2 UNVERIFIED | 2 |
| `hermes` | ✅ | 4 UNVERIFIED (placeholder) | 4 |
| `openclaw` | ✅ | UNVERIFIED | (audit not in N3) |
| `zcode` | ✅ | (largest file, 222 lines) | (specific count pending) |
| `qoder` | ❌ | n/a | (Type-literal only) |
| `tongyi-lingma` | ❌ | n/a | (Type-literal only) |

Gap: type alias has 9 entries; runtime registry has 7.

## 2. Escalation SOP — LLM-executable

### Scenario A — user requests a specific IDE

1. Cross-reference the table in §1.
2. If the IDE is `claude-code` / `trae`: defer to existing audit at `B1` / `B1-Trae`; no policy action.
3. If the IDE is `cursor` / `codex` / `hermes` / `openclaw` / `zcode`: warn user about UNVERIFIED fields; offer to either (i) run real-install dogfood to promote fields to VERIFIED, or (ii) keep fallback path (legacy Claude Code + stderr warning).
4. If the IDE is `qoder` / `tongyi-lingma`: file a NEW rid with change-id `2026-07-24-rid-NNN-ship-<IDE>` per §3's checklist.

### Scenario B — user reports "X adapter has wrong settings.json shape"

1. Check `src/services/ide/adapters/<ide>-adapter.ts` docstring for VERIFIED/UNVERIFIED status.
2. If UNVERIFIED → the framework fallback is intentional; do not patch the adapter without first running real-install dogfood.
3. Sediment under `.peaks/memory/<date>-<ide>-adapter-drift-<slug>.md` with `[[2026-07-24-multi-ide-adapter-policy]]`.

### Scenario C — user asks "should I deprecate `qoder` / `tongyi-lingma` type literals?"

1. **No** unless a future slice explicitly re-pins the type-literal. Removing the literal is a typed-API break; downstream `getAdapter('qoder')` callers (in tests, refactor candidates) would fail typecheck.
2. If user wants fewer IDEs in `IdeId`: file a slice to (i) deprecate `qoder`/`tongyi-lingma` (mark `@deprecated`), (ii) drop the runtime test mock for them, (iii) one release later, remove. This is a multi-release evolution, not a single slice.

### Scenario D — `peaks skill sync --platform <IDE>` reports an unexpected adapter

1. `listAdapterIds()` returns the registry, not the type alias. Compare:
   ```
   $ grep -E "^\s*'[^']+'," src/services/ide/ide-types.ts  # type literal
   $ grep -E "\[.+, .+" src/services/ide/ide-registry.ts  # registry
   ```
2. If the IDE is in the literal but absent from the registry → it's a placeholder (`qoder`, `tongyi-lingma`); sync reports "no adapter registered".

## 3. Ship-a-new-IDE checklist (LLM-executable SOP)

Provided here so a future slice can produce a complete IDE
shipment; do NOT execute without an explicit user PRD.

1. **Author adapter file** — `src/services/ide/adapters/<ide>-adapter.ts` modeled after `claude-code-adapter.ts` (~105 lines for reference, but as little as `hermes-adapter.ts` 54 lines suffices for placeholders).
2. **Add to `IdeId` union** in `src/services/ide/ide-types.ts:16-25`.
3. **Register in map** at `src/services/ide/ide-registry.ts:23-31`.
4. **Add adapter test** at `tests/unit/ide/<ide>-adapter.test.ts` (no file exists yet for qoder / tongyi-lingma).
5. **Real-install dogfood**: REQUIRED before marking any field VERIFIED. See Trae slice 009 template (`tests/fixtures/trae/trae-1x-payload.json`).
6. **Sediment** at `.peaks/memory/<date>-<ide>-adapter-verified-against-1x.md`.
7. **(Optional) Migrate any fallback consumers** (postinstall path that depends on `~/.claude/skills` as default; migrate per-IDE only after VERIFIED).

**Cost**: ~3-5 days per IDE per the Trae slice 009 dogfood.

## 4. Idempotent re-run (next session)

```
$ ls src/services/ide/adapters/*.ts | wc -l   # expect 7 (or more after a new ship)
$ grep -c "^export const.*ADAPTER:" src/services/ide/adapters/*.ts | grep ':1$' | wc -l   # expect 7
$ head -25 src/services/ide/ide-types.ts | grep -E "^\s*'[^']+'," | wc -l   # expect 9 (with 2 placeholders)
$ head -45 src/services/ide/ide-registry.ts | grep -oE "\['[^']+'" | wc -l   # expect 7
$ cat .peaks/memory/MEMORY.md | grep -E "multi-ide-adapter-policy|2026-07-24"   # expect at least 1 hit
```

If counts diverge, re-pin via §1 of the policy.

## 5. Status

**Active.** This policy is the formal governance surface for
multi-IDE adapter work in peaks-loop. N3 audit-trail remains
the technical provenance.

## 6. Sibling governance policies

This file is one of the 5+1 tracked governance policies for
session `2026-07-24-session-f13da7`. Adjacent concerns:

- **[[claude-code-end-to-end-2026-07-24]]** — B1 closure; the verified IDE this policy treats as the baseline.
- **[[2026-07-24-parked-tests-policy]]** — parked-tests governance; relevant when adapter changes affect pinned test contracts.
- **[[2026-07-24-openspec-enforce-artifact-policy]]** — OpenSpec apply gate; relevant if a multi-IDE ship attempts an OpenSpec-backed adapter change.
- **[[2026-07-24-sediment-pruning-policy]]** — memory size health; relevant if this policy grows past 9.4 kB Q90.
- **[[2026-07-24-b1-manifest-v2-b2-policy]]** — RID-008 Tier-1.1 inline PRD; orthogonal to adapter work.
- **[[2026-07-24-engineer-write-continuation-rid-008]]** — RID-008 closure record; documents when this policy was last reconciled.
- **[[2026-07-24-l1-f-slice-check-rid-policy]]** — L1.F slice-check `--rid` policy; orthogonal to adapter work but relevant when shipping a new IDE requires a slice-check pass.

End.
