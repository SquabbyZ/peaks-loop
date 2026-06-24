# Context Capsule

A context capsule is the smallest durable context needed by downstream roles.

## Contents

- original request;
- goals and non-goals;
- confirmed decisions;
- assumptions;
- discarded options;
- risks;
- role-specific slices;
- skill-usage lessons and workflow habits worth reusing;
- staleness conditions.

Do not dump full conversations into downstream artifacts.

## Durable project memory

Only stable and reusable project facts should be marked for memory extraction. Use `.claude/memory` as the project-local primary source. Keep TXT capsules and skill-usage lessons in local `.peaks/_runtime/<session-id>/txt/` by default; let Peaks SC sync or commit them only after explicit authorization or an active profile that clearly permits it.
