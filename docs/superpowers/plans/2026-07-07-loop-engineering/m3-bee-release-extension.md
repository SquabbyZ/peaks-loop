# M3 — Bee Release Extension Fields

**Goal:** Add the optional share/desktop fields to `loop_release` and `bee_release` (spec §4.1 / §4.2). All default to "true" / empty; `shareable=false` is the only enforcement this slice writes (full export enforcement is M7).

**Architecture:** Schema-only addition. Migration is non-breaking: new columns are nullable / have defaults. The fields:
- `loop_release.shareable: boolean` (default `true`)
- `loop_release.share_excluded_paths: string[]` (default `[]`)
- `loop_release.desktop_visible: boolean` (default `true`)
- `loop_release.export_bundle_format: 'peaks.bundle/1'` (fixed constant, CLI-written)
- `bee_release.shareable: boolean` (default `true`)
- `bee_release.desktop_visible: boolean` (default `true`)

**File Structure (M3):**
- `src/services/loop/bee-release-extension.ts` (Zod + migration)
- `tests/unit/loop/bee-release-extension.test.ts` (round-trip + default values)

**Validation (M3 exit):** AC-1, AC-3 (non-breaking migration; defaults applied). M7 will add the `peaks loop export` hard-block on `shareable=false`.

**Karpathy 4-section form (M3 introduces no new red line; the existing RL-9 is the rule):**
- Failure modes: a future export bundle leaks a release marked `shareable=false`; a user hides a loop from the desktop but it keeps appearing.
- Rewrite: every export reads `shareable` and refuses if false; every desktop list reads `desktop_visible` and filters out false.
- Self-check: `loop_release.shareable === false` ⇒ `peaks loop export --loop <id>` is rejected with `LOOP_NOT_SHAREABLE`.
- Out-of-scope: a public SkillHub registry (future slice).
