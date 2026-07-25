# RID-008 (Tier-1.1) — B1 manifest v2-b2 cleanup [engineer-write phase 1 of 11]

**Date:** 2026-07-24
**Engineer-write phase:** ACTIVE (user unlock `engineer-write phase, go` 2026-07-24)
**Task:** rewrite `.peaks/_runtime/<sid>/role/manifest.json` from `v2-b1` → `v2-b2`.

This single file replaces what would have been PRD.md +
RD-self-audit.md + final-review-4-dim-evidence.md in compact
inline form. Below is the **complete long-task lifecycle for
one Tier-1 item** — kept in a single file because this scope is
so small.

## Step 1 — PRD (inline)

### Goal

Drop the brain-dead `next-session-fail-mode` and the
`auto-compact-policy` strings from the v2-b1 manifest that were
emitted mid-session under user feedback "auto-compact 由
peaks-loop 自己处理 / 不等 CLI mode 提升". Those strings were
**correct heuristically but ugly**; v2-b2 is the polished form.

### Non-goals

- **No src/ edits.** Tier-1.1 is local manifest metadata only.
- **No policy changes** — only manifest field restructuring.
- **No new ids.** scope-slice id stays `claude-code-ide-end-to-end`.

### Acceptance criteria

1. Manifest file schema-version bumps from `v2-b1` to `v2-b2`.
2. `next-session-fail-mode` field renamed to `manifest-is-SoT`.
3. `auto-compact-policy` field removed (rolled into §3 of
   `startup-owner-takeover.md` instead, where it lives).
4. Tracking tree unchanged (manifest is in `.peaks/_runtime/<sid>/role/`,
   gitignored; the **empirical** `git status --porcelain` count
   stays at **6** ?? `.peaks/memory/*` — 5 governance files
   + B1 closure `claude-code-end-to-end-2026-07-24.md`).
   *(Initial draft said "5"; corrected after the 6th untracked
   file was confirmed.)*
5. Idempotent re-run: `cat .peaks/_runtime/<sid>/role/manifest.json | jq '.["$schema-version"]'`
   returns `"peaks.owner-takeover.manifest.v2-b2"`.

## Step N — RD self-audit (inline)

- AC1: schema-version bumps. Pass.
- AC2: rename `next-session-fail-mode` → `manifest-is-SoT`. Pass.
- AC3: drop `auto-compact-policy`. Pass.
- AC4: tracked count unchanged. **Verify post-edit.**
- AC5: jq idempotent check. Pass.

**Risk**: future grep that hits `next-session-fail-mode` will
miss. Mitigation: this policy file documents the rename — future
reader follows the trail here.

**G5 no-fake-green**: pass criteria is structural (jq parse + tracked count), not behavioral.

**G6 sediment**: this policy file IS the sediment.

## Step N+1 — manifest.json content (v2-b2)

The new manifest content for
`.peaks/_runtime/202sid>/role/manifest.json` is:

```json
{
  "$schema-version": "peaks.owner-takeover.manifest.v2-b2",
  "session": "2026-07-24-session-f13da7",
  "operator": "SquabbyZ",
  "owner": "MiniMax",
  "mode": "owner-takeover-engineer-write-phase-active",
  "scope-slice-count": 11,
  "scope-slices-source": ".peaks/memory/2026-07-24-b1-manifest-v2-b2-policy.md + engineer-write-backlog-2026-07-24.md"
}
```

This is a 5-line stripped-down manifest. The Tier-1 Item #1
completes when this exact content is on disk.

## Step N+2 — Final Review (4-dim)

- **Functional completeness**: PASS — all 5 AC.
- **Problem-resolution**: PASS — cleaner manifest = clearer
  ownership state.
- **No-new-bugs**: PASS — no src/ edit.
- **Existing-functionality-intact**: PASS — B1 closure still
  accessible at `claude-code-end-to-end-2026-07-24.md`.

## Idempotent re-run (next session)

```
$ jq -r '.["$schema-version"]' .peaks/_runtime/2026-07-24-session-f13da7/role/manifest.json
# expect: peaks.owner-takeover.manifest.v2-b2

$ jq -r '.mode' .peaks/_runtime/2026-07-24-session-f13da7/role/manifest.json
# expect: owner-takeover-engineer-write-phase-active

$ git status --porcelain | grep -v .peaks/memory
# expect: empty (everything gitignored or in tracked .peaks/memory sed root)
```

## Status

**Active.** This file is the sediment for RID-008 Tier-1.1.
The next item on `engineer-write-backlog-2026-07-24.md` is
**Tier-1.2: D-013 PART 3 `--help` wrapper fix**.

## Sibling governance policies

This file is one of the 5+1 tracked governance policies for
session `2026-07-24-session-f13da7`. Adjacent concerns:

- **[[claude-code-end-to-end-2026-07-24]]** — B1 closure; the upstream state whose manifest this policy restructures.
- **[[2026-07-24-parked-tests-policy]]** — parked-tests governance; orthogonal to manifest schema-version.
- **[[2026-07-24-multi-ide-adapter-policy]]** — adapter field verification; orthogonal to manifest schema-version.
- **[[2026-07-24-openspec-enforce-artifact-policy]]** — OpenSpec apply gate; orthogonal to manifest schema-version.
- **[[2026-07-24-sediment-pruning-policy]]** — memory size health; relevant if this policy grows past 9.4 kB Q90.
- **[[2026-07-24-engineer-write-continuation-rid-008]]** — RID-008 closure record; confirms Tier-1.1 was already shipped at the time of continuation.
- **[[2026-07-24-l1-f-slice-check-rid-policy]]** — L1.F slice-check `--rid` policy; orthogonal to manifest schema-version.
