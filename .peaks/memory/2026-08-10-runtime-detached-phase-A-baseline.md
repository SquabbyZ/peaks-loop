---
name: phase-A-baseline-stub-2026-08-10
description: Phase A efficiency baseline placeholder — real numbers to be filled before publish
metadata:
  type: project
  createdAt: 2026-08-10
---

# Phase A baseline — STUB (fill before ship)

Gate items per spec §5.2:

| Gate | Target | Actual |
|---|---|---|
| orchestrator context saving | ≥ 60% | _TBD_ |
| parallel wall-time saving (N=5) | ≥ 30% | _TBD_ |
| token cost saving | ≥ 20% | _TBD_ |
| qa verdict rate | ≥ baseline | _TBD_ |

Run via: `pnpm exec tsx benchmarks/runtime-detached/baseline.ts`
Update this file before `pnpm changeset version`.