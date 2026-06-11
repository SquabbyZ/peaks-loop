---
name: staged-enforcer-delivery-via-deferred-enforcers-set
description: Staged enforcer delivery via DEFERRED_ENFORCERS set
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-06-11-session-f0312d/txt/handoff.md
---

For multi-commit enforcer delivery (source shipped first, integration wired in a follow-up commit), use a `DEFERRED_ENFORCERS` set in the red-line catalog. `findCatalogEntry` returns a copy of the entry with `enforcerRef: null` for deferred ids; the backing-detector's `existsSync` check then downgrades them to `prose-only` at runtime. This keeps the catalog as a single source of truth (one entry per rule, not duplicated for deferred state) and ensures the audit output is honest. L2.1 ships 3 of 5 P0 enforcers integrated + 2 source-only; both styles live in the catalog; the audit's cli-backed vs prose-only counts reflect reality.
