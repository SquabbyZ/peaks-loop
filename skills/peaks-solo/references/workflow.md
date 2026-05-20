# Peaks Solo Workflow

Peaks Solo is a facade over role skills. It keeps the workflow moving without absorbing role-specific responsibility.

## Modes

- Solo: default, single controller with soft gates.
- Assisted: role skills contribute artifacts without broad swarm execution.
- Swarm: multiple subagents work in parallel when the CLI-managed profile is enabled.
- Strict: hook/profile guarded mode for high-risk work.

## Required code workflow evidence

A code workflow is not complete until Solo has linked or summarized:

1. standards preflight;
2. PRD/RD scope and OpenSpec artifacts when required;
3. RD implementation evidence;
4. unit-test evidence for new or changed behavior;
5. code-review evidence;
6. security-review evidence;
7. RD post-check dry-run evidence;
8. QA API validation when applicable;
9. QA `gstack/browse/dist/browse` browser E2E evidence for frontend projects, preferably with headed/handoff visible-browser confirmation;
10. QA security, performance, and validation report evidence;
11. TXT handoff capsule.

For legacy repositories with pre-existing low UT coverage, do not require historical coverage cleanup as part of an unrelated change, but do require focused coverage evidence for the new or changed code.

## Capability discovery

Before using `find-skills`, explain the benefit and token cost unless the active profile permits automatic discovery.
