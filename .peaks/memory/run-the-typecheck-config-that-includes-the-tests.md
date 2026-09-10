---
name: run-the-typecheck-config-that-includes-the-tests
description: Run the typecheck config that includes the tests
metadata:
  type: technical-pattern
  sourceArtifact: .peaks/_runtime/2026-09-10-session-528a63/txt/handoff-s4.md
---

S4 made `PwBrowser.on` a **required** member. That broke three *other* test files
(`browser-session-manager.test.ts`, `web-daemon-browser-teardown.test.ts`,
`web-daemon-service.test.ts`) with TS2741. It stayed invisible through an implementation pass and
several orchestrator verifications because everyone ran `tsc -p tsconfig.build.json`, which **excludes
`tests/**`**. The repo's own `typecheck` script uses `tsc -p tsconfig.json`, which reported the three
errors immediately.

**Why:** a "tsc exit 0" claim from the wrong config is a false negative that looks exactly like
success. It is the type-level version of the unfalsifiable test — and it hides changes to *shared*
types, which is precisely where a localized change leaks.

**How to apply:** when you touch a type that other modules or test fakes consume, verify with the
config that includes tests. In peaks-loop that is `tsc -p tsconfig.json --noEmit`. Note it carries
**272 pre-existing errors**, so compare the *count* before and after rather than expecting exit 0 —
and treat that broken baseline as its own standing problem.
