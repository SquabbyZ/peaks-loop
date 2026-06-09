# Mandatory tech-doc output (RD)

> Body of `## Mandatory tech-doc output`. **BLOCKING — Do not hand off to QA without this file.** Every RD invocation that touches code MUST produce a tech-doc artifact at `.peaks/_runtime/<sessionId>/rd/tech-doc.md`. If this file is missing at QA handoff, the handoff is invalid. The request artifact links to it; QA and SC read it for verification context.

**Minimum tech-doc sections:**

1. **Architecture decisions** — what changed, why, tradeoffs considered, alternatives rejected
2. **Component changes** — files added/modified/deleted with role (new component, refactor, bug fix)
   - **CRITICAL: Every file path in this section must be verified against the actual project.** Run `ls` on every directory path before writing it. A wrong path is worse than no tech-doc — it sends QA and future developers to non-existent files.
3. **Data flow** — how data moves through the changed surface (props, API calls, state updates, events)
4. **CSS/Style changes** — what CSS files or style blocks changed, which component-library tokens were used, any CSS framework interactions
5. **API contract changes** — new/modified request paths, request/response shapes, error states
6. **Dependencies** — new packages added, versions, why each was needed, license check

**CSS framework change rules:**
- When a component library (antd, MUI, etc.) is already in use, prefer its built-in styling APIs (antd's `token`/`className`/`styles` props, MUI's `sx`/`styled`/`theme`) over adding TailwindCSS classes
- Never add `tailwindcss` to a project that already uses a component library with its own CSS-in-JS solution unless the project-scan explicitly approves it
- If TailwindCSS is already present, use it consistently with the project's existing utility patterns; do not mix TailwindCSS utility classes with component-library `style` prop overrides on the same element