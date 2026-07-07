# artifact-contracts.md

Default local artifact root: `.peaks/_runtime/<session-id>/` with role subdirectories `prd/`, `rd/`, `ui/`, `qa/`, `sc/`, and `txt/`.

Code coordinates artifact paths and handoff completeness. Keep artifacts local by default. Do not commit, sync, or move them to a git-backed artifact repository unless explicitly authorized.

## Artifact file naming conventions

Each role produces artifacts with predictable file names so cross-role references are stable:

| Role | Directory | File pattern | Produced by | Consumed by |
|---|---|---|---|---|
| PRD | `prd/requests/` | `<request-id>.md` | peaks-prd | peaks-ui, peaks-rd, peaks-qa, peaks-txt |
| UI | `ui/` | `design-draft.md` | peaks-ui | peaks-rd (implementation), peaks-qa (visual regression) |
| RD planning | `rd/` | `tech-doc.md` | peaks-rd (planning phase) | peaks-rd (implementation phase) |
| RD project scan | `rd/` | `project-scan.md` | peaks-code (pre-RD scan) | peaks-rd, peaks-ui |
| RD implementation | `rd/requests/` | `<request-id>.md` | peaks-rd | peaks-qa, peaks-sc, peaks-txt |
| QA test cases | `qa/test-cases/` | `<request-id>.md` | peaks-qa (pre-implementation) | peaks-rd (TDD guidance), peaks-qa (execution) |
| QA test reports | `qa/test-reports/` | `<request-id>.md` | peaks-qa (post-execution) | peaks-code (verdict), peaks-txt |
| QA requests | `qa/requests/` | `<request-id>.md` | peaks-qa | peaks-txt |
| SC | `sc/` | `<change-id>-impact.md`, `<slice-id>-retention.md` | peaks-sc | peaks-txt |
| TXT | `txt/` | `handoff-<request-id>.md` | peaks-txt | user (final deliverable) |

## Artifact state transitions

Each artifact has a lifecycle status tracked via `peaks request transition`:

- **PRD**: `draft` → `confirmed-by-user` → `handed-off`
- **UI**: `draft` → `direction-locked` → `handed-off`
- **RD**: `draft` → `spec-locked` → `implemented` → `qa-handoff`
- **QA**: `draft` → `running` → `verdict-issued` (pass | return-to-rd | blocked)
- **TXT**: `draft` → `finalized`

## Cross-role artifact dependencies

```
PRD (confirmed-by-user)
 ├── UI → design-draft.md        reads: PRD artifact
 ├── RD → tech-doc.md            reads: PRD artifact, project-scan.md
 ├── QA → test-cases/<id>.md     reads: PRD artifact
 │
 ↓ all three complete
 │
RD (implementation)              reads: design-draft.md + tech-doc.md + test-cases/<id>.md
 │
 ↓ implemented + qa-handoff
 │
QA (validation)                  reads: RD implementation artifact + test-cases/<id>.md
 │                                writes: test-reports/<id>.md
 ↓ verdict
 │
TXT (handoff)                    reads: all artifacts from PRD through QA
```

## Artifact content requirements

Each role artifact must include these sections at minimum:

- **PRD**: goals, non-goals, acceptance criteria, frontend delta (pages/components affected)
- **UI**: visual direction, component inventory, responsive breakpoints, accessibility notes
- **RD tech-doc**: architecture decisions, component tree, data flow, API contracts, dependencies
- **RD implementation**: slice specs, code changes summary, coverage evidence, CR findings
- **QA test-cases**: unit tests, integration tests, UI regression tests (per acceptance criterion)
- **QA test-reports**: test results, browser evidence summary, security/perf notes, verdict
- **TXT**: mode, validated decisions, artifact paths, standards deltas, open questions, next action
