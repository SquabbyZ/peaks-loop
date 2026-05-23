# OpenSpec Validation Gate for Peaks QA

When the target repository already has `openspec/`, QA cannot pass a change until its OpenSpec change pack passes validation. The Peaks CLI runs the validation; QA records the result in the validation report.

## Required gate

For every non-trivial change that has a corresponding `openspec/changes/<change-id>/`:

```bash
peaks openspec validate <change-id> --project <repo> --json
```

QA must check:

- `data.valid === true` — required to pass QA acceptance.
- `data.issues` — record every `error` and `warning` in the validation report. Warnings are not blockers but must be acknowledged.
- `data.source` — `internal` is the default; `openspec-cli` means the external `openspec` binary was used.

If the change does not exist (`OPENSPEC_CHANGE_NOT_FOUND`), QA blocks until RD produces or links the change pack. If `data.valid === false` (`OPENSPEC_VALIDATE_INVALID`), QA returns the work to RD with the issue list — do not silently downgrade or override.

## Optional external delegation

When the external `openspec` CLI is installed and the user authorizes it, prefer it:

```bash
peaks openspec validate <change-id> --project <repo> --prefer-external --json
```

If `openspec` is not on PATH, Peaks falls back to internal lint and records `openspec-cli-unavailable` as a warning. QA can accept that fallback when the internal lint passes.

## Internal lint rules (reference)

The internal lint is the floor; the external CLI may add rules on top. QA must understand what these mean:

- `proposal-exists` (error) — `proposal.md` must exist under the change directory.
- `what-changes-non-empty` (error) — `## What Changes` must have at least one bullet.
- `acceptance-non-empty` (error) — `## Acceptance Criteria` must have at least one bullet.
- `why-non-empty` (warning) — empty `## Why` is allowed but should be flagged in the QA report.
- `change-id-format` (error) — change directory name must match `[A-Za-z0-9][A-Za-z0-9._-]*`.
- `openspec-cli-failed` (error) — external CLI exited non-zero. QA blocks until the underlying issue is fixed.

## Archive gate

After QA passes a shipped change, QA can optionally request archival:

```bash
peaks openspec archive <change-id> --project <repo> --json            # preview
peaks openspec archive <change-id> --project <repo> --apply --json    # move to changes/archive/<id>/
```

Archive refuses to overwrite an existing archived entry. That refusal is a hard signal — investigate before forcing.

## Boundary

QA must not hand-edit or rename anything under `openspec/changes/**`. All movements and verdicts route through the Peaks CLI so the audit trail and dry-run guarantees survive.
