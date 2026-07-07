# M7 — Share Bundle + Desktop Extension Surface

**Goal:** Lock the on-ramp for the future desktop client and cross-user share flow (spec §7A, RL-9). Ship `peaks loop export / import` and `peaks bee export / import` with the `peaks.bundle/1` format; keep `peaks skill sediment export / import` as aliases for one release cycle.

**Architecture:**
- `src/services/share/bundle-types.ts` — Zod schema for `peaks.bundle/1` (manifest + relations + evidence_briefs + blobs).
- `src/services/share/bundle-writer.ts` — writes a tarball; refuses to write a release with `shareable=false`; never includes private `run_state`, `.peaks/memory/personal/`, or raw `state.db` rows.
- `src/services/share/bundle-reader.ts` — reads a tarball; imports as `candidate`; refuses to import a major-version schema mismatch; minor-version mismatch is a warn.
- `src/services/share/run-state-contract.ts` — locks the read-only shape (`bee_id, status, current_step, started_at, updated_at, last_evaluator_verdict, last_user_choice`).
- `src/cli/commands/loop-commands.ts` (extend) — `export / import`.
- `src/cli/commands/bee-commands.ts` (new) — `export / import`.
- `peaks skill sediment export / import` aliased to the new verbs; a deprecation warning is logged.

**File Structure (M7):**
- `src/services/share/bundle-types.ts`
- `src/services/share/bundle-writer.ts`
- `src/services/share/bundle-reader.ts`
- `src/services/share/run-state-contract.ts`
- `src/cli/commands/loop-commands.ts` (modify)
- `src/cli/commands/bee-commands.ts` (create)
- `src/cli/commands/skill-sediment.ts` (modify, add alias)
- `tests/unit/share/*.test.ts` (3 files)
- `tests/integration/share-bundle-roundtrip.test.ts` (AC-25, AC-26)

**Validation (M7 exit):** AC-24, AC-25, AC-26 — bundle round-trip; import lands as `candidate`; promotion blocked without `evolution_evaluation`; `shareable=false` blocks export.

**Karpathy 4-section form (M7 enforces the existing RL-9; introduces no new red line):**
- Failure modes: UI writes to `state.db` directly; import-to-stable bypass; bundle leak; schema mismatch without warn.
- Rewrite: every `peaks loop export` reads `shareable` and `desktop_visible`; every `peaks loop import` lands as `candidate`; promotion requires an `evolution_evaluation` row with `independent_scorer_verdict`.
- Self-check: `bundle.format === 'peaks.bundle/1' && bundle.format_version_major === 1`; `loop_release.shareable !== false`; `crystallization_event.status === 'candidate'` after import.
- Out-of-scope: real-time collaboration; marketplace; cross-machine sync; the desktop implementation itself.
