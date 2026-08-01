# TypeScript Coding Standards (2.0 canonical)

> Project-local standards, derived from the 1.x install + re-rendered with the 2.0 vocabulary.

- Apply project-local conventions before generic typescript guidance.
- Keep public APIs typed or documented according to typescript ecosystem norms.
- Do not add new `any` types; use explicit domain types, generics, or `unknown` with narrowing.
- Prefer standard tooling and existing project scripts for formatting, linting, tests, and coverage.
- peaks-rd must check this file before planning code changes in typescript projects.

## UI library priority (effective 2026-08-01)

When the project scan identifies a frontend framework with a known UI component library
(`shadcn / ui`, `Antd`, `MUI` or any explicitly detected component library under
`.peaks/project-scan/project-scan.md`), RD and downstream implementation MUST prefer
the library's exported components over hand-rolled native DOM / HTML primitives.

Hard rules:

- If a component the library ships (or a thin composition of components) can implement
  the requested UI, do NOT reach for raw `<div>`, `<button>`, `<input>`, `<select>`,
  `<table>`, `<dialog>`, `<menu>`, or platform-default dialogs / popovers.
- Library themes, tokens, and styling conventions (Tailwind classes, Antd `ConfigProvider`,
  MUI `ThemeProvider`, etc.) are the source of truth for the visual surface.
  Do NOT introduce parallel CSS frameworks or inline styles that fight the library.
- Native DOM is acceptable ONLY for primitives the library does not ship and that
  cannot be composed from shipped primitives (e.g. a custom SVG icon, a one-off
  data-attribute hook for analytics, or accessibility wiring on top of a library
  component). When you do reach for native DOM, leave a one-line comment naming
  the library primitive that was unavailable so future slices can revisit the gap.
- Mock data and placeholder copy must come from the library's recommended
  fixtures (Antd's mock API, shadcn's `cn()` utility, MUI's `Skeleton`) — not from
  hand-written HTML.

Why this rule exists: hand-rolled DOM on top of a UI library produces visual
inconsistency, defeats the library's accessibility guarantees, and pulls a future
slice out of the library's upgrade path. Once the project scan has labelled the
project, that label binds the slice.

Verification:

- RD artifacts (`.peaks/_runtime/<sessionId>/rd/requests/<rid>.md`) MUST cite the
  detected component library under `## Red-line scope` and name the specific
  component(s) used in the slice contract.
- QA's test report MUST list at least one component-library import per slice
  whose surface is UI-bearing. Slices that touch only the empty `none` surface
  are exempt.
- `peaks audit red-lines` should not regress on the new rule; red-line writes
  may be added later as a separate slice.
