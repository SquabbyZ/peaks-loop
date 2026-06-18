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

7. **Slice DAG** — every slice that touches the dispatcher surface MUST publish its dependency plan as a DAG. Required content (both visual and text forms are mandatory — the visual is for humans, the text is for the orchestrator). The RD MUST write this section as `## Slice DAG` in their `rd/tech-doc.md` (h2 form, byte-stable for the enforcer gate C check). Required sub-bullets:
   - **Visual (mermaid)**: a `flowchart LR` or `graph TD` block where every node carries `{id, role, label}` and every edge is `{from -> to}` (meaning "to depends on from"). The diagram MUST be parseable by `peaks sub-agent dispatch --from-dag` and the LLM MUST NOT publish a mermaid block that contradicts the text table.
   - **Text table**: a markdown table with columns `| id | role | label | prompt? | depends-on | contractHash? |`. The `depends-on` column is a comma-separated list of upstream slice IDs (or `-` for roots). The `contractHash?` column is the SHA-256 contract hash once the slice has run at least once; otherwise `-`.
   - **Mandatory fields per row**: `id`, `role`, `depends-on`. Missing any of these is a hard tech-doc violation (the enforcer will refuse spec-locked transition).
   - **Optional fields**: `label`, `prompt` (override for the dispatch placeholder), `contractHash` (post-run).
   - **Cross-reference**: the DAG hash (SHA-256 of `serializeDag`, computed by `src/services/dispatch/slice-dag.ts#hashDag`) MUST be appended at the end of the section as `dagHash: <64-hex>` so reviewers can diff the plan across revisions.
   - **Failure-rollback note**: if any leaf in a level fails, the entire level's in-flight slices are reported as `cancelled` and downstream levels are NOT advanced. The DAG section MUST surface this fact in a one-line trailing note (e.g. `rollback: any-leaf-fail -> level-cancel`).

**Mandatory self-check sections (Slice 2/6 karpathy-enforcement — enforced by `peaks request transition spec-locked` gate C):**

8. **Existing API / Component Inventory** — enumerate the API endpoints / components / stores / mocks the slice will reuse before adding anything new. Required questions (answer at least these 3):
   1. List every API endpoint / component / store / mock this slice is adding. If the slice adds none, say "no additions" and explain why.
   2. For each addition, name the existing API / component / store / mock it reuses, with file path + line number. If it does not reuse anything, name the candidate it considered and the reason for rejection (interface mismatch / type mismatch / performance / business logic gap).
   3. For each "decided not to reuse" decision, write the concrete reason in one sentence.
   4. (If the slice adds mock data) state where the mock lands (per the framework's built-in mock directory rule — never inline in component files).

8. **Simplicity self-check** — the karpathy §2 5-anti-pattern self-check. Required answers (one sentence per item):
   1. Did this slice add any feature that was NOT asked for? If yes, list it and the reason for keeping it; if no, say "no unrequested features".
   2. Did this slice introduce any abstraction used only once? If yes, list it and the reason for keeping it; if no, say "no single-use abstractions".
   3. Did this slice introduce any configurability that was NOT asked for? If yes, list it and the reason for keeping it; if no, say "no unrequested configurability".
   4. Did this slice add error handling for an impossible scenario? If yes, list it and the reason for keeping it; if no, say "no speculative error handling".
   5. Did this slice end up larger than it needed to be? (the 200→50 rule of thumb) If yes, state the cut plan; if no, say "size proportional to scope".

9. **Reuse / Consolidate plan** — declare how the slice handles the existing-but-scattered code. Required answers:
   1. Did this slice introduce new code with >80% functional similarity to an existing component / function? If yes, list the pair; if no, say "no similar pairs".
   2. For each similar pair, pick ONE of: `merge into existing` / `extract shared helper` / `rename to clarify the difference` / `delete one of them`. State the choice in one sentence.
   3. Did this slice merge any previously scattered utility / hook / type definition? If yes, give the before/after path; if no, say "no merge opportunities taken".
   4. (If a merge happened) what regression tests cover the merged surface?

The Slice 2 enforcer (`src/services/audit/enforcers/tech-doc-mandatory-sections.ts`) reads the resulting tech-doc.md at spec-locked transition time and refuses the transition with `TECH_DOC_MANDATORY_SECTIONS_MISSING` if any of sections 7–9 are missing. The error message points back to this file so RD can read the contract.

**CSS framework change rules:**
- When a component library (antd, MUI, etc.) is already in use, prefer its built-in styling APIs (antd's `token`/`className`/`styles` props, MUI's `sx`/`styled`/`theme`) over adding TailwindCSS classes
- Never add `tailwindcss` to a project that already uses a component library with its own CSS-in-JS solution unless the project-scan explicitly approves it
- If TailwindCSS is already present, use it consistently with the project's existing utility patterns; do not mix TailwindCSS utility classes with component-library `style` prop overrides on the same element