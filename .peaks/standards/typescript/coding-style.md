# TypeScript Coding Standards (2.0 canonical)

> Project-local standards, derived from the 1.x install + re-rendered with the 2.0 vocabulary.

- Apply project-local conventions before generic typescript guidance.
- Keep public APIs typed or documented according to typescript ecosystem norms.
- Do not add new `any` types; use explicit domain types, generics, or `unknown` with narrowing.
- Prefer standard tooling and existing project scripts for formatting, linting, tests, and coverage.
- peaks-rd must check this file before planning code changes in typescript projects.
