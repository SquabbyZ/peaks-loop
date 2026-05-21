---
name: peaks-ui
description: UI and experience skill for Peaks. Use when a workflow touches UI/UX, interaction design, visual direction, design systems, frontend page behavior, high-fidelity HTML prototypes, or UI regression seeds.
---

# Peaks UI

Peaks UI handles experience, interaction, visual direction, and UI-specific refactor artifacts.

## Responsibilities

- identify when UI involvement is necessary;
- produce UX flow and page-state artifacts;
- define interaction and visual constraints;
- create UI regression seeds;
- review user-facing behavior preservation.

## Refactor role

Only engage when the refactor affects UI, interaction, styling, page structure, design system, or frontend user behavior.

## GStack integration

Use gstack as a concrete design-review workflow reference for the `Plan → Review → Test` UI stages:

- map design review concepts to Peaks UX flow, page-state, interaction, and visual constraint artifacts;
- map browser walkthrough concepts to UI regression seeds when runtime validation is approved;
- keep accessibility, performance, and product-specific visual direction as Peaks UI acceptance inputs.

For frontend work, especially full-auto mode, use headed `gstack/browse/dist/browse` to inspect the running page or prototype before accepting the UI direction. Verify that a visible browser actually opened. If login, CAPTCHA, SSO, or MFA appears, wait for the user to complete login and explicitly confirm completion before continuing. Capture only sanitized visible regressions, weak hierarchy, generic template patterns, console errors, and interaction problems as UI feedback that should return to design/RD before handing off to QA; do not retain login URLs, cookies, headers, tokens, storage state, browser traces, or screenshots/logs containing PII or SSO/MFA material.

## Full-auto visual quality path

When Peaks UI is used in full-auto frontend design, default to the curated taste path instead of generic component generation:

1. use `awesome-design-md` as the visual reference source for layout, composition, rhythm, and atmosphere;
2. use `taste-skill` or the local `design-taste-frontend` skill as the critique lens for anti-template, typography, color, density, motion, and interaction quality;
3. choose a specific style direction before implementation, such as editorial, bento, Swiss, luxury, retro-futurist, glass, or product-specific system UI;
4. define design dials before generating UI: design variance, motion intensity, visual density, typography pair, palette, and interaction feel;
5. reject centered stock heroes, default card grids, unmodified shadcn/library defaults, AI purple-blue gradients, generic three-card feature rows, and safe gray-on-white pages without a point of view;
6. require loading, empty, error, hover, focus, active, and responsive states for meaningful surfaces;
7. browser-check the result with headed `gstack/browse/dist/browse`, wait for explicit user confirmation after any login challenge, and iterate until the UI looks intentional, memorable, and product-specific.

Full-auto Peaks UI output must include a short taste report: visual direction, references used, rejected generic patterns, browser observations, remaining design risks, and the next visual iteration if the page is not yet good enough.

## External capability guidance

Use `peaks capabilities --json` before recommending design, browser, or UI reference resources.

- In full-auto frontend mode, prefer the `awesome-design-md` + `taste-skill`/`design-taste-frontend` combination before shadcn/ui or generic component-library output.
- shadcn/ui, React Bits, awesome-design-md, taste-skill, and ui-ux-pro-max-skill are UI references; do not treat unreviewed generated UI as finished design.
- Chrome DevTools MCP and Agent Browser can support runtime UI inspection only after the user approves the app target.
- Figma Context MCP and Penpot require user-authorized design access and must not persist tokens or private design data in project artifacts.
- Check license, accessibility, and performance before translating external visual references into Peaks UI constraints.

## Boundaries

Do not own backend architecture, non-UI implementation, runtime hook installation, or final QA acceptance.

Reference: `references/workflow.md`.
