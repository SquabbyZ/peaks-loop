---
name: 2026-07-03-v3-1-0-release-readiness
description: v3.1.0 release-readiness check found + fixed one release-blocking drift in peaks-solo/SKILL.md before publish; pre-publish checklist pattern saved for future releases
metadata:
  type: project
  createdAt: 2026-07-03
  affects: peaks-solo, peaks release flow, tests/unit/skill-external-invocation.test.ts
---

# v3.1.0 Release-Readiness Review (2026-07-03)

## Outcome

3.1.0 ready to publish. One release-blocking drift found + surgically fixed before publishing.

## Pre-publish checklist that worked

1. `pnpm run lint:silent-warning` — clean (448 files, no anti-patterns)
2. `pnpm exec tsc -p tsconfig.json --noEmit` — clean (silent)
3. `pnpm run build` (sync-version + clean-dist + tsc) — clean
4. `npm pack --dry-run` — 1.5MB / 1085 files / correct shasum
5. `npm publish --dry-run` — exercises `prepublishOnly` (sync-version + clean-dist + tsc + tar)
6. `npm view peaks-loop dist-tags` — confirms current latest (3.0.3) does not block 3.1.0 promotion
7. `pnpm exec vitest run` — **5185/5185 pass** (after the fix below)

## The drift + fix

`tests/unit/skill-external-invocation.test.ts:63` audits each ENFORCED_SKILL (`peaks-prd`, `peaks-ui`, `peaks-rd`, `peaks-qa`, `peaks-sc`, `peaks-solo`, `peaks-txt`) — if the SKILL.md mentions an external token (mattpocock/skills, Context7, MCP servers, etc.), it MUST also contain a `Peaks(-Loop|-Cli)? ... (remain|are) authoritative` / `... acceptance authority` phrase.

`peaks-solo/SKILL.md` line 277 (External references paragraph) listed mattpocock/skills, Context7, MCPs, and "Do not execute upstream installer" — but had no authority-declaration phrase. The other 5 enforced skills had it.

**One-line surgical fix:** append `Peaks-Loop Solo gates and artifacts remain authoritative.` to that paragraph. Re-ran the test → 16/16 pass.

Why the existing `The CLI is authoritative` line 174 (frontend-only mode) didn't satisfy the regex: that line says "The CLI is authoritative" without the required `Peaks-Loop` prefix, and it appears in a different paragraph than the external-references one.

## Decisions for future releases

- **Run vitest FULL suite before tagging.** Subset runs can miss SKILL.md audit tests. The job tests alone (~34 tests) plus workspace + runbook (~203 tests) plus skill audit (~16) plus core + cli + integration = full picture.
- **`tests/unit/skill-external-invocation.test.ts` is a real release gate.** If it fails, fix the skill prose, do NOT weaken the regex.
- **`PEAKS_AUTHORITATIVE_PATTERN` is strict by design.** Each ENFORCED_SKILL must satisfy it independently — no inheritance from a shared reference.
- **`peaks-solo` is the most likely drift site** because its scope is the broadest (orchestrates 6 sub-agents and references the most external resources). M7.1 review caught a 25KB-cap violation; this caught an authority-prose gap.

## Tag + publish state at hand-off

- HEAD: `aab52b7` (post-fix)
- Annotated tag `v3.1.0` created, pointing at HEAD
- Working tree clean
- `npm dist-tags.latest` on registry: 3.0.3 (no conflict)
- Author command queued for user: `git push origin main v3.1.0 && npm publish`