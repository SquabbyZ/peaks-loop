---
name: fzf-for-js-api-semantics-used-by-peaks-loop-fuzzy-matching
description: fzf-for-js API semantics (used by peaks-loop fuzzy-matching)
metadata:
  type: reference
  sourceArtifact: .peaks/_runtime/2026-06-10-session-6bcac7/txt/handoff-2026-06-10-fuzzy-matching-implementation.md
---

When wrapping `fzf` (npm) in TypeScript, the relevant API surface is:

- `import { Fzf } from 'fzf'`
- `new Fzf(items, { selector, limit, casing })` — `selector: (item) => string` is required when items are not strings. `casing: 'smart-case' | 'case-sensitive' | 'case-insensitive'`. Default `casing` is `'smart-case'`, NOT case-insensitive; pass `'case-insensitive'` explicitly to honor spec-style "case-insensitive default" semantics. `caseSensitive: true` maps to `'case-sensitive'`.
- `fzf.find(query)` returns `FzfResultItem<T>[]` with `{ item, start, end, score, positions: Set<number> }`.
- **`score` is HIGHER-is-better** (not lower-is-better as the Go CLI does). Normalize as `entry.score / topScore` so top = 1.0; others in [0, 1].
- **`positions` is `Set<number>`**, not `number[]`. Convert to a sorted `number[]` for JSON envelopes.
- Zero runtime deps. BSD-3-Clause license. Latest version at time of writing: 0.5.2 (~70KB unpacked). Used by `src/services/fuzzy-matching/fuzzy-match-service.ts` (peaks-loop).
