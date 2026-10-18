---
name: remove-a-dead-type-alias-only-after-proving-no-package-reexport
description: remove-a-dead-type-alias-only-after-proving-no-package-reexport
metadata:
  type: decision
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-policy.md
---

Three type aliases were dropped from the export list after: zero `grep -rnw` importers across
`src/`, `packages/`, `scripts/`, `skills/`, `tests/`; no package entry naming the module; and a
declaration emit that compiles with the aliases non-exported. The aliases remain module-internal for
the file's own signatures.

**Why:** removing an export is a public-API break only if something outside the module can see it. For
an internal module with no re-export, the grep + emit is the proof; for a package entry, it would not
be enough.

**How to apply:** remove a dead export only after checking the package's entry points and running the
declaration emit. Keep the alias internal if the file still uses it.
