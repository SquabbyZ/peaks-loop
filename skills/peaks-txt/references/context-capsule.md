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
- staleness conditions.

Do not dump full conversations into downstream artifacts.

## Durable project memory

Only stable and reusable project facts should be marked for memory extraction. Use `.claude/memory` as the project-local primary source, and let Peaks SC sync that directory to the artifact repository at checkpoints.
