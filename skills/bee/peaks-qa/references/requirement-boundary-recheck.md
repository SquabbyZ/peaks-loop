# Requirement boundary recheck (QA)

> Body of `## Requirement boundary recheck`. Before QA passes or returns work to RD, it must independently recheck the implementation against the approved requirement boundary:

1. compare the PRD/RD scope artifact, OpenSpec tasks, and current diff to identify every changed file, route, API path, mock handler, data fixture, and user-visible behavior;
2. strictly fail QA if the change modifies, deletes, mocks, or replaces content outside the approved boundary, including unrelated list/query endpoints, existing records, delete/update flows, auth, permissions, shared configuration, or request plumbing;
3. API and mock validation must exercise only the approved request paths unless the spec explicitly includes broader API coverage. Do not create, update, delete, or overwrite unrelated server/client state during QA;
4. browser E2E must avoid destructive interactions unless the requirement explicitly includes them and the user confirms the action;
5. record a "red-line boundary check" section in the validation report with pass/fail, evidence, and any out-of-scope findings.