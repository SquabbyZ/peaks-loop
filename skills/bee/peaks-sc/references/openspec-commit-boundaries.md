# OpenSpec-Derived Commit Boundaries for Peaks SC

Peaks SC owns commit boundaries and artifact retention. When the change pack lives in `openspec/changes/<id>/tasks.md`, SC must derive the commit boundaries from that file via the Peaks CLI rather than reinvent them.

## Pulling commit boundary candidates

```bash
peaks openspec to-rd <change-id> --project <repo> --json
```

The response includes:

```json
"commitBoundaries": [
  { "heading": "1. Discovery", "todos": ["..."], "doneItems": ["..."] },
  { "heading": "2. Implementation", "todos": ["..."], "doneItems": ["..."] }
]
```

Rules SC applies:

- One commit per `heading` is the default. Do not combine unrelated sections into a single commit.
- `todos[]` items are the in-scope work for that commit. If implementation produced diffs outside any todo description, surface that as an out-of-scope finding before SC closes.
- `doneItems[]` describes already-shipped sub-tasks; SC may close them out in the same commit only when the current diff actually touches the same surface.
- Each commit message should reference the change-id and the section heading (e.g. `feat: M3 implement <change-id> 2. Implementation`).

## Wiring with RD slice contracts

When RD has split a change into multiple slices, SC must align each commit with one RD slice and one OpenSpec tasks section. The OpenSpec section heading is the canonical commit boundary name; the RD slice id is the internal reference. If they disagree, return to RD before committing.

## Boundary

SC must not hand-edit `openspec/changes/**` or rewrite history to match a desired boundary. If the OpenSpec tasks list is wrong, raise it as an RD/QA issue and have RD regenerate the change pack through `peaks openspec render` before SC commits.
