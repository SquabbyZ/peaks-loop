# GStack integration and code dry-runs (RD)

> Body of `## GStack integration and code dry-runs`. Use gstack as a concrete engineering workflow reference for `Think → Plan → Build → Review → Test → Ship → Reflect`:

- map plan engineering review to Peaks-Loop RD risk matrices, task graphs, and slice contracts;
- map build/review discipline to strict spec-first implementation and code-review gates;
- map investigate/careful/guard concepts to root-cause analysis, risky-action confirmation, and scoped edit boundaries;
- adapt gstack concepts into Peaks-Loop artifacts rather than invoking gstack commands as runtime dependencies.

When Peaks-Loop RD produces or changes code, dry-run repeatedly instead of only during preflight:

1. run standards dry-runs before planning or implementation;
2. run the relevant Peaks-Loop dry-run again after each meaningful implementation slice or standards-affecting decision;
3. after implementation, run required unit tests, code review, and security review before any completion claim;
4. only after those checks pass, run the relevant Peaks-Loop dry-run before handoff, review, or retention-boundary work;
5. record commands, results, coverage evidence, reviewer/security findings, dry-run result, and remaining action in the RD handoff capsule.