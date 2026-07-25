# Design: peaks-tech dry-run gate

## Goal

Implement the smallest CLI-first technical gate that can produce and inspect approved technical-plan artifacts before RD swarm planning.

## Data Model

Define focused TypeScript types under a new tech service area, for example `src/services/tech/`:

- `TechPlanRequest`
  - `changeId: string`
  - `goal: string`
  - `swarm: boolean`
  - `dryRun: true`
- `TechTaskGraph`
  - `changeId`
  - `goal`
  - `waves`
  - `tasks`
  - `artifactRoot`
  - `blockedReasons`
  - `nextActions`
- `TechTask`
  - `taskId`
  - `wave`
  - `workerKind`
  - `purpose`
  - `inputs`
  - `outputs`
  - `conflictGroup`
  - `dependsOn`
- `TechStatus`
  - `changeId`
  - `status: unavailable | missing | blocked | approved`
  - `requiredArtifacts`
  - `missingArtifacts`
  - `approvalRecord`
  - `blockedReasons`
  - `nextActions`

Keep identifiers stable and English-keyed. User-facing messages may be localized later.

## Wave Template

`peaks tech plan` MUST include these dry-run waves:

1. Technical fact scan
   - `tech-architecture-scan`
   - `tech-frontend-scan`
   - `tech-backend-scan`
   - `tech-contract-scan`
   - `tech-test-scan`
   - `tech-platform-scan`
   - `tech-security-scan`
   - `tech-ci-scan`
2. Technical documents
   - `tech-frontend-doc-worker`
   - `tech-backend-doc-worker`
   - `tech-contract-doc-worker`
   - `tech-test-doc-worker`
   - `tech-platform-doc-worker`
   - `tech-security-doc-worker`
   - `tech-ci-doc-worker`
   - `tech-migration-doc-worker`
3. Technical review
   - `tech-architecture-reviewer`
   - `tech-contract-reviewer`
   - `tech-security-reviewer`
   - `tech-test-reviewer`
   - `tech-platform-reviewer`
   - `tech-risk-reviewer`
4. Reducer
   - `tech-reducer`

## Artifact Layout

Plan output paths are relative to the Peaks artifact workspace:

```text
.peaks/changes/<change-id>/architecture/tech-task-graph.json
.peaks/changes/<change-id>/architecture/waves/*.json
.peaks/changes/<change-id>/architecture/workers/<task-id>/brief.md
.peaks/changes/<change-id>/architecture/tech-review-checklist.md
.peaks/changes/<change-id>/architecture/tech-approval-record.template.md
```

Status additionally checks for the human-reviewed target artifacts:

```text
.peaks/changes/<change-id>/architecture/frontend-tech-doc.md
.peaks/changes/<change-id>/architecture/backend-tech-doc.md
.peaks/changes/<change-id>/architecture/contract-tech-doc.md
.peaks/changes/<change-id>/architecture/test-tech-doc.md
.peaks/changes/<change-id>/architecture/platform-tech-doc.md
.peaks/changes/<change-id>/architecture/security-tech-doc.md
.peaks/changes/<change-id>/architecture/ci-tech-doc.md
.peaks/changes/<change-id>/architecture/migration-tech-doc.md
.peaks/changes/<change-id>/architecture/tech-review-report.md
.peaks/changes/<change-id>/architecture/tech-approval-record.md
```

## Approval Parsing

`peaks tech status` MUST only return `approved` when `tech-approval-record.md` exists and contains an explicit approved state. Accept one canonical machine marker first, such as:

```text
status: approved
```

Do not infer approval from free-form prose such as "looks good".

## CLI Shape

Add subcommands without growing `src/cli/program.ts` into a large file. Prefer small command registration helpers if existing patterns allow it.

```bash
peaks tech plan --change-id <id> --goal "<goal>" --swarm --dry-run --json
peaks tech status --change-id <id> --json
```

`--dry-run` is required for MVP. If omitted, return an explicit unsupported-mode error.

## Validation

- Validate `change-id` at the CLI/service boundary.
- Reject empty goals for plan commands.
- Reject path traversal and separators in `change-id`.
- Return explicit unavailable status when artifact workspace is not configured.

## Testing

Use TDD. Cover:

- Valid plan output waves and task count.
- Worker brief paths are artifact-relative and normalized with `/`.
- Artifact workspace unavailable returns next actions and does not write.
- Invalid `change-id` fails.
- Status missing artifacts.
- Status blocked when approval is missing or not approved.
- Status approved only with canonical marker.
- CLI JSON envelope for plan and status.

All included modules must reach 100% statements, branches, functions, and lines.
