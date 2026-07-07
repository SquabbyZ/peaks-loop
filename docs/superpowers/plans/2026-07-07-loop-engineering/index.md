# Loop Engineering Crystallization — Multi-slice Implementation Plan (Index)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan slice-by-slice. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **For the slice driver:** implement slices in M-order. Each M-slice is independently shippable; do not start M-(N+1) until M-N's exit conditions are green.

**Goal:** Upgrade peaks-loop from "sediment workflow / bee" to a self-evolving method system: a four-layer asset model (Loop Engineering + Bee + Workflow Trace + Evolution Evaluation) with karpathy-engineered principles × darwin-verified improvements, post-run crystallization, and a locked extension surface for the future desktop client and cross-user share.

**Architecture:** Multi-slice layered delivery. Each M-slice lands one asset layer (or its CLI / skill surface) end-to-end: schema + service + CLI + tests + docs + red-line update. No M-slice leaves the tree in a partially-built state. M0 is foundation (karpathy guideline file + lint harness). M1..M4 add the asset layers. M5..M6 are the user-facing surfaces. M7 is the receiver-side and bundle integrity guarantees. M8 is dogfood on the peaks-loop project itself. M9 demotes `peaks-workflow` (ADR 0007) and updates the README / memory / project positioning to "loop engineering" narrative.

**Tech Stack:** TypeScript (existing), Commander (existing), Zod (existing), better-sqlite3 (existing), Vitest (existing), existing `peaks` CLI. No new dependencies. No new external services.

**Inherits from:** `docs/superpowers/specs/2026-07-07-peaks-loop-loop-engineering-crystallization-design.md` (the spec this plan implements). All ACs in spec §11 are tracked in the per-slice plan files.

**External references (advisory, never vendored, never authoritative):**
- https://github.com/alchaincyf/darwin-skill — ratchet / independent-context evaluation
- https://github.com/multica-ai/andrej-karpathy-skills — guideline engineering methodology

---

## Slice Map (M0..M9)

| M | Slice | Landed asset / surface | Spec sections covered | Spec ACs | Exit condition |
|---|---|---|---|---|---|
| M0 | Karpathy guideline file + lint harness | `.peaks/standards/loop-engineering-guidelines.md` + `peaks standards lint --category loop-engineering` | §8.3, §8.4, §10 (template), §11.G | AC-21, AC-22, AC-23 | Lint passes; 4-section form enforced; no RL is missing a section |
| M1 | Loop Release schema | `loop_release` table + `loop_release` Zod schema + service | §3, §4.1, §11.A | AC-1, AC-3 | Service round-trip; existing 4.x `bee_release` rows still readable |
| M2 | Loop–Bee relation | `loop_bee_relation` table + relation service | §3, §4.6, §11.A | AC-2, AC-3 | A loop can be linked to a main bee and supporting bees; integrity test green |
| M3 | Bee Release extended fields | `loop_release.shareable / share_excluded_paths / desktop_visible / export_bundle_format`; `bee_release.shareable / desktop_visible` | §4.1, §4.2 | AC-1, AC-3 | Field set round-trip; `shareable=false` is enforced at export boundary (defer full enforcement to M7) |
| M4 | Evolution Evaluation schema + ratchet enforcement | `evolution_evaluation` table + `peaks evolution propose / evaluate / revert` + minimum evaluator team enforcement | §3, §4.4, §6, §11.C, §11.D | AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14 | Self-score attempt blocked; score-delta threshold enforced; multi-object/multi-dimension proposal blocked |
| M5 | Crystallization Event + prompt + brief | `crystallization_event` table + `peaks asset crystallize` + `peaks asset dispose` + `peaks asset status` + `evidence_brief` projection | §4.5, §4.7, §5, §11.B, §11.E | AC-4, AC-5, AC-6, AC-7, AC-15, AC-16, AC-17 | After a successful run, the prompt exposes the 4-section brief; pre-run attempts to create a stable loop are blocked; LLM does not write JSON |
| M6 | peaks-maker re-positioning | `peaks-maker` SKILL.md re-narration; `peaks skill lint --category loop-engineering-readiness` for any new peaks-* skill | §7.5, §8.4, §11.F | AC-19, AC-20 | peaks-maker's SKILL.md references the guideline file; lint catches a new peaks-* skill that does not import it |
| M7 | Share bundle + desktop extension surface | `peaks loop export/import`, `peaks bee export/import`, `peaks.bundle/1` format, `peaks skill sediment export/import` aliases, run-state read-only contract | §7A, §10 RL-9, §11.H | AC-24, AC-25, AC-26 | Bundle round-trip; import lands as `candidate`; promotion blocked without `evolution_evaluation` |
| M8 | Dogfood — run peaks-loop's own crystallization end-to-end | One real task on the peaks-loop repo (the one we just did: spec + plans) crystallized into a `loop_release` + `bee_release`; brief saved as a memory entry | §5, §8.1, §10 RL-2, §10 RL-7 | AC-4, AC-5, AC-7, AC-15, AC-16 | Crystallization event written; brief reviewed by SquabbyZ; user-side verdict saved |
| M9 | Demote peaks-workflow + update narrative | ADR 0007 v3 demotion section; `peaks-workflow` doc tweaks; README.md / README-en.md / memory updates to lead with "Loop Engineering"; peaks-code SKILL.md RL-8 self-description | §7.6, §0.4, §0.5, §11.F | AC-18 | peaks-code SKILL.md self-identifies as code-domain; ADR 0007 has §"v3 demotion" |

---

## File Structure (pre-task map)

| File / dir | Action | Owned by M-slice |
|---|---|---|
| `.peaks/standards/loop-engineering-guidelines.md` | create | M0 |
| `src/services/standards/loop-engineering-lint.ts` | create | M0 |
| `src/cli/commands/standards-loop-engineering.ts` | create | M0 |
| `tests/unit/standards/loop-engineering-guidelines.test.ts` | create | M0 |
| `src/services/loop/loop-release-types.ts` | create | M1 |
| `src/services/loop/loop-release-store.ts` | create | M1 |
| `src/services/loop/loop-release-service.ts` | create | M1 |
| `tests/unit/loop/loop-release.test.ts` | create | M1 |
| `src/services/loop/loop-bee-relation-types.ts` | create | M2 |
| `src/services/loop/loop-bee-relation-store.ts` | create | M2 |
| `src/services/loop/loop-bee-relation-service.ts` | create | M2 |
| `tests/unit/loop/loop-bee-relation.test.ts` | create | M2 |
| `src/services/loop/bee-release-extension.ts` | create | M3 |
| `tests/unit/loop/bee-release-extension.test.ts` | create | M3 |
| `src/services/evolution/evolution-types.ts` | create | M4 |
| `src/services/evolution/evolution-store.ts` | create | M4 |
| `src/services/evolution/evolution-service.ts` | create | M4 |
| `src/services/evolution/independent-evaluator-runner.ts` | create | M4 |
| `src/services/evolution/regression-skeptic-runner.ts` | create | M4 |
| `src/cli/commands/evolution-commands.ts` | create | M4 |
| `tests/unit/evolution/*.test.ts` | create | M4 |
| `src/services/crystallization/crystallization-types.ts` | create | M5 |
| `src/services/crystallization/crystallization-store.ts` | create | M5 |
| `src/services/crystallization/crystallization-service.ts` | create | M5 |
| `src/services/crystallization/evidence-brief-builder.ts` | create | M5 |
| `src/cli/commands/asset-commands.ts` | create | M5 |
| `tests/unit/crystallization/*.test.ts` | create | M5 |
| `skills/bee/peaks-maker/SKILL.md` | modify (re-narrate) | M6 |
| `src/services/standards/loop-engineering-readiness-lint.ts` | create | M6 |
| `tests/unit/standards/loop-engineering-readiness.test.ts` | create | M6 |
| `src/services/share/bundle-types.ts` | create | M7 |
| `src/services/share/bundle-writer.ts` | create | M7 |
| `src/services/share/bundle-reader.ts` | create | M7 |
| `src/services/share/run-state-contract.ts` | create | M7 |
| `src/cli/commands/loop-commands.ts` (extends) | modify | M7 |
| `src/cli/commands/bee-commands.ts` (new) | create | M7 |
| `tests/unit/share/*.test.ts` | create | M7 |
| `tests/integration/share-bundle-roundtrip.test.ts` | create | M7 |
| `.peaks/_runtime/2026-07-07-session-2af05f/dogfood/crystallization-event.json` | create (artifact) | M8 |
| `.peaks/memory/2026-07-07-loop-engineering-first-crystallization.md` | create | M8 |
| `docs/adr/0007-peaks-workflow-primitive.md` | modify (add §"v3 demotion") | M9 |
| `README.md` | modify (lead with "Loop Engineering") | M9 |
| `README-en.md` | modify (lead with "Loop Engineering") | M9 |
| `skills/peaks-code/SKILL.md` | modify (RL-8 self-description) | M9 |
| `.peaks/memory/peaks-loop-positioning-loop-engineering.md` | create | M9 |

No new npm dependency. No public API change beyond the new CLI verbs listed in the per-slice plans.

---

## Slice Dependency Graph

```text
M0 ──┬──> M1 ──> M2 ──> M3
     │                 │
     │                 v
     ├──> M4 ───────────────> M5 ──> M8
     │                                 │
     └──> M6 ──────────────────────────┴──> M7 ──> M9
```

- **M0** is foundation; required by M4, M5, M6, M7 (every later slice must consume the karpathy-engineered guideline file).
- **M1 → M2 → M3** are sequential (loop release → relation → extended fields).
- **M4** is independent of M1..M3 (Evolution Evaluation is its own table) but consumes M0.
- **M5** consumes M1, M2, M3, M4 (the crystallization prompt must reference all existing layers).
- **M6** consumes M0 only (lint readiness for future peaks-* skills).
- **M7** consumes M1, M2, M3 (the export bundle references the asset layers).
- **M8** consumes M5 (the dogfood crystallization writes a real `crystallization_event`).
- **M9** consumes everything (final narrative + ADR + README + memory).

A slice driver must not start a downstream slice until the upstream slice's exit conditions are green. Each per-slice plan re-states this.

---

## Cross-slice Conventions (locked now, copied verbatim into every per-slice plan)

- **No commit message contains** `Co-Authored-By: Claude`, `Co-Authored-By: Anthropic`, or any equivalent AI-assistant trailer. The author of every commit is `SquabbyZ <601709253@qq.com>` via global gitconfig (do not set per-repo `user.name` / `user.email`).
- **TypeScript coding standards (2.0 canonical)**: no new `any`; explicit domain types or generics; immutable updates unless mutation is the convention; boundary validation via Zod; preserve existing conventions when stricter.
- **Test design**: real assertions, no `expect(true).toBe(true)`; no `.skip` for fixing regressions; Vitest; `peaks test` runs the suite.
- **No big JSON BLOB**: any new table follows the relational + content-addressed `blobs/` sidecar pattern. Schema is decomposed.
- **Schema versioning**: every new table carries `schema_version`. Migrations are non-breaking for 4.x `bee_release` rows.
- **Path safety**: never create `.peaks/_runtime/<YYYY-MM-DD-*>/` siblings of `.peaks/_runtime/`. Always `.peaks/_runtime/<sessionId>/...` (the v2.8.3 hard ban).
- **Human-NL-Choice-Only**: any new CLI verb ships with the LLM-driven `peaks *` driver; user-facing strings are NL or choice-based; no JSON / manifest / CLI-verb hand-authoring exposed.
- **Karpathy 4-section red-line form** (see spec §8.0): every new red line introduced in any M-slice uses failure modes / imperative→declarative rewrite / self-check questions / out-of-scope.
- **No self-scored evolution** (RL-6): any code path that scores a proposal must be in a sub-agent call that did not author the proposal.
- **Single editable asset per round** (RL-4): a slice is one object; multi-object changes are split.
- **Single optimization dimension per round** (RL-4): if a slice improves more than one dimension, split.
- **Evidence brief required** (RL-7): any user-facing prompt or recommendation in the slice's CLI output includes the 4-section brief.
- **peaks-code domain boundary** (RL-8): no non-code capability is added to `peaks-code` in any M-slice. If a slice would need it, the slice is wrong; it goes to a new peaks-* skill (out of this plan).

---

## Self-Review (pre-commit)

**Spec coverage** (spec § → M-slice that implements it):

| Spec section | M-slice |
|---|---|
| §0 project tenet | M9 (README / SKILL.md / memory) |
| §0.4 domain boundary | M6 (lint), M9 (peaks-code SKILL.md) |
| §0.5 karpathy × darwin co-equal | M0 (template), all slices reference it |
| §1 problem statement | M9 (memory entry) |
| §2 goals & non-goals | M0..M9 collectively |
| §3 architecture | M1 (loop), M2 (relation), M3 (extensions), M4 (evolution), M5 (crystallization) |
| §4 asset model | M1, M2, M3, M4, M5, M7 |
| §5 lifecycle | M5 (crystallization prompt + brief), M8 (dogfood) |
| §6 evolution mechanism | M4 |
| §7 SkillHub upgrade | M1, M2, M3, M4, M5 (new tables) |
| §7.5 peaks-maker re-positioning | M6 |
| §7.6 peaks-workflow demotion | M9 |
| §7A extension surface | M7 |
| §8 karpathy-style engineering | M0 |
| §8.4 peaks-* skill import contract | M6 |
| §9 layered external references | M0 (reference, not vendored) |
| §10 red lines | M0 (file), M4 (RL-4..6 enforcement), M5 (RL-2, RL-3, RL-7), M6 (RL-8), M7 (RL-9), M9 (RL-1 README) |
| §11 ACs | A → M1, M2; B → M5; C,D → M4; E → M5; F → M6, M9; G → M0; H → M7 |
| §12 risks | tracked in each per-slice plan |
| §13 out of scope | enforced by every M-slice's "Out of scope" subsection |
| §14 decision log | M9 (memory) |
| §15 open questions | M8 (closes default-threshold questions empirically) |
| §16 related designs | M9 (cross-link memory) |

**Placeholder scan:** no `TBD` / `TODO` / "fill in details" / "implement later" in this index. Each per-slice plan avoids them too.

**Type consistency:** types and method names used across the file map are consistent (`loop_release_id`, `bee_release_id`, `loop_bee_relation_id`, `evolution_evaluation_id`, `crystallization_event_id`, `evidence_brief`, `peaks.bundle/1`, `peaks.loop/1`, `peaks.bee/1`, `peaks.evolution/1`, `peaks.crystallization/1`).

---

## Execution

After the per-slice plans are saved, the user picks subagent-driven or inline execution per the writing-plans skill's "Execution Handoff" step.

**End of index. Per-slice plans:**
- `m0-karpathy-guidelines.md`
- `m1-loop-release.md`
- `m2-loop-bee-relation.md`
- `m3-bee-release-extension.md`
- `m4-evolution-evaluation.md`
- `m5-crystallization-and-brief.md`
- `m6-peaks-maker-readiness.md`
- `m7-share-and-desktop.md`
- `m8-dogfood-crystallization.md`
- `m9-narrative-and-demote.md`
