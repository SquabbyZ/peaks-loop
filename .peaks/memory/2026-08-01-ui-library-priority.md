---
name: 2026-08-01-ui-library-priority
kind: feedback
---

# UI library priority (effective 2026-08-01, no exceptions)

Once `.peaks/project-scan/project-scan.md` has identified a frontend framework with a known UI component library (currently `shadcn / ui`, `Antd`, `MUI`), every RD slice on that project MUST prefer the library's exported components over hand-rolled native DOM.

**Why:** Hand-rolled DOM on top of a UI library produces visual inconsistency, defeats the library's accessibility guarantees, and pulls a future slice out of the library's upgrade path. Once the scan has labelled the project, that label binds the slice.

**How to apply:**

- RD artifacts MUST cite the detected component library under `## Red-line scope` and name the specific components used in the slice contract.
- Native DOM is acceptable only for primitives the library does not ship, and a one-line comment must name the library primitive that was unavailable.
- Library themes and tokens are the source of truth; no parallel CSS frameworks or inline styles that fight the library.
- QA's test report lists at least one component-library import per UI-bearing slice.
- The rule is encoded in `.peaks/standards/typescript/coding-style.md` §UI library priority. Future red-line catalog entries may surface it but the prose anchor is sufficient for v1.
