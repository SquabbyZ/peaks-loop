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

## External capability guidance

Use `peaks capabilities --json` before recommending design, browser, or UI reference resources.

- shadcn/ui, React Bits, awesome-design-md, taste-skill, and ui-ux-pro-max-skill are UI references; do not treat unreviewed generated UI as finished design.
- Chrome DevTools MCP and Agent Browser can support runtime UI inspection only after the user approves the app target.
- Figma Context MCP and Penpot require user-authorized design access and must not persist tokens or private design data in project artifacts.
- Check license, accessibility, and performance before translating external visual references into Peaks UI constraints.

## Boundaries

Do not own backend architecture, non-UI implementation, runtime hook installation, or final QA acceptance.

Reference: `references/workflow.md`.
