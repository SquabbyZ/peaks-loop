---
name: a-packaged-asset-is-not-at-the-consumer-project-root
description: a-packaged-asset-is-not-at-the-consumer-project-root
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-residuals.md
---

Making the reviewer's `schemaPath` load-bearing first resolved it against the consumer project root,
which broke every consumer: the schema ships inside the peaks-loop package, and a normal project has
no `schemas/` directory. The first implementation passed its own tests because the test roots seeded
the file — the fixture encoded the bug.

**Why:** a default that names a packaged asset has two homes: the package that ships it and the
project that configures it. "Project root" is only one of them.

**How to apply:** resolve packaged assets in a stated order — absolute path, then the project copy
(a deliberate override), then `<packageRoot>/<relative>` derived from `import.meta.url` with the
same climb in `src/` and `dist/`. Test the consumer shape with a project root that has NO
`schemas/` directory; do not seed the asset in the fixture.
