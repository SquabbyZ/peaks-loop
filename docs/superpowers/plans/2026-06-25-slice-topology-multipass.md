# Slice Topology Multi-Pass + 10/90 Paradigm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Plan split on 2026-06-25 (post Wave 1 merge cleanup).** The original 1626-line plan exceeded the 800-line file cap (per `rules/common/coding-style.md`). Split into 8 per-phase files below; each is well under the cap. Cross-references that pointed to this path (e.g., `Spec: docs/superpowers/plans/2026-06-25-slice-topology-multipass.md` in the handoff module) still resolve correctly because this file remains the canonical entry point.

> **Status:** Wave 1 (Tasks 1-4) merged into `feature/slice-topology-multipass` and pushed to origin on 2026-06-25. Wave 2+ pending.

## Index

| # | File | Lines | Coverage |
|---|------|------:|----------|
| 0 | [`preamble`](./2026-06-25-slice-topology-multipass-preamble.md) | 116 | Title, Intro, Global Constraints, File Structure |
| 1 | [`phase-1`](./2026-06-25-slice-topology-multipass-phase-1.md) | 641 | Foundation Types and Schemas (Tasks 1-4 + Slice 3 Handoff) |
| 2 | [`phase-2`](./2026-06-25-slice-topology-multipass-phase-2.md) | 406 | Algorithm Components (Tasks 5-9) |
| 3 | [`phase-3`](./2026-06-25-slice-topology-multipass-phase-3.md) | 80 | CLI Integration (Tasks 10-11) |
| 4 | [`phase-4`](./2026-06-25-slice-topology-multipass-phase-4.md) | 178 | New Skills (Tasks 12-14) |
| 5 | [`phase-5`](./2026-06-25-slice-topology-multipass-phase-5.md) | 116 | Existing Skill Updates (Tasks 15-19) |
| 6 | [`phase-6`](./2026-06-25-slice-topology-multipass-phase-6.md) | 109 | Integration + Final Verification (Tasks 20-22) |
| 7 | [`self-review`](./2026-06-25-slice-topology-multipass-self-review.md) | 44 | Self-Review + Execution options |

**Total**: 1690 lines across 9 files (vs. 1626 in the single-file original; +64 lines from per-file HTML comment headers and this index).

## Wave 1 merge evidence

- **Branch**: `feature/slice-topology-multipass` @ `805d329` (post-merge QA fix)
- **4 --no-ff merge commits**: T1 (17f583f), T2 (64c8f6e), T3 (22adfd3), T4 (1b489fb)
- **Quality gates**: `tsc --noEmit` exit 0, `vitest` 105/105 passed
- **Origin push**: 21 commits ahead of `develop`, tracking set

## How to navigate

- For **Wave 1 implementation details** → [`phase-1.md`](./2026-06-25-slice-topology-multipass-phase-1.md) (Tasks 1-4)
- For **global constraints / file structure** → [`preamble.md`](./2026-06-25-slice-topology-multipass-preamble.md)
- For **Wave 2+ planning** → [`phase-2.md`](./2026-06-25-slice-topology-multipass-phase-2.md) onwards
- For **execution options** → [`self-review.md`](./2026-06-25-slice-topology-multipass-self-review.md)
