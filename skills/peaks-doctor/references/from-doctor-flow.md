# from-doctor flow (peaks-doctor skill reference)

End-to-end path from a doctor finding to an OpenSpec change record.

## Flow

```
peaks doctor --json                  # 1. discover findings
  ↓
match: any check where ok=false
  ↓
peaks openspec from-doctor \
  --project <repo> \
  --check-id <id>                   # 2. generate draft proposal
  ↓
openspec/changes/<date>-fix-<slug>/proposal.md   # 3. LLM reviews + edits
  ↓
peaks openspec validate <change-id>  # 4. gate
  ↓
[next slice: peaks-rd implements the change per the proposal]
```

## Example

```bash
# Discover
$ peaks doctor --json | jq '.data.checks[] | select(.ok==false) | .id'
"L3:l3-memory-health"

# Generate draft
$ peaks openspec from-doctor \
    --project . \
    --check-id L3:l3-memory-health \
    --json
{
  "ok": true,
  "command": "openspec.from-doctor",
  "data": {
    "changeId": "2026-06-11-fix-l3-l3-memory-health",
    "proposalPath": ".../openspec/changes/2026-06-11-fix-l3-l3-memory-health/proposal.md",
    "created": true
  }
}

# LLM reviews + edits the draft (in this case: add a Why section
# explaining the missing schema_version field; add an Acceptance
# Criterion that requires peaks doctor to return ok=true for the check)

# Validate
$ peaks openspec validate 2026-06-11-fix-l3-l3-memory-health --json
{
  "ok": true,
  "data": { "valid": true, "issues": [] }
}

# Implement (peaks-rd)
$ /peaks-rd 2026-06-11-fix-l3-l3-memory-health
```

## Edge cases

- **CHECK_ALREADY_PASSING**: `--check-id` matches a passing check. The CLI returns code CHECK_ALREADY_PASSING. Pick a failing check.
- **CHECK_NOT_FOUND**: `--check-id` doesn't match any check id. Run `peaks doctor --json | jq '.data.checks[].id'` to list.
- **OPENSPEC_FROM_DOCTOR_FAILED**: filesystem write error (e.g. openspec/ not initialized). Run `peaks openspec init --apply` first.
