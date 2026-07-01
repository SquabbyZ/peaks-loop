---
schemaVersion: 1
templateKind: audit-output-schema
capturedAt: 2026-06-27T00:00:00.000Z
appliesTo: peaks-security-audit + peaks-perf-audit
---

# Audit Output Schema (peaks-loop v2.12.0)

> **Unified output schema** for both `peaks-security-audit` and
> `peaks-perf-audit` skills. Lives under `.peaks/project-scan/` so it is
> git-tracked. The schema below is the canonical contract that downstream
> consumers (peaks-rd aggregator, peaks-qa Gate A3/A4, peaks-txt sediment)
> read from.

## Schema

The audit output artifact (`audit/security-<rid>.md` or
`audit/perf-<rid>.md`) is a markdown file with a YAML frontmatter block
followed by markdown body sections.

### Frontmatter (required, all fields)

| Field | Type | Required | Description |
|---|---|---|---|
| `schemaVersion` | integer (currently `1`) | YES | Schema version. Bump on breaking change. |
| `artifactKind` | enum: `security-audit` \| `perf-audit` | YES | Identifies which skill produced this artifact. |
| `rid` | string (request-id format: `YYYY-MM-DD-<kebab-slug>`) | YES | The request this audit is bound to. |
| `sid` | string (session-id) | YES | The session that produced this audit. |
| `handoffHash` | string (64-char hex sha256) | YES | sha256 of the prd/handoff.md body. Validated against on read. |
| `templateVersion` | integer | YES | The version of the security-template or perf-template the audit ran against. |
| `generatedAt` | string (ISO 8601) | YES | When the audit was produced. |
| `verdict` | enum: `pass` \| `warn` \| `block` | YES | Top-level audit verdict. |
| `violationsCount` | integer | YES | Total violations across all severities. |

### Frontmatter (optional, schema-version-stable)

| Field | Type | Description |
|---|---|---|
| `parentRid` | string | When this audit supersedes a previous one (e.g. re-run after a fix), the original rid. |
| `previousHash` | string (64-char hex) | sha256 of the prior audit artifact body (chain link for re-runs). |
| `degradationNote` | string | When the audit had to fall back from the canonical template (e.g. ECC unavailable, parallel-review fan-out degraded). One of the known tokens. |

## Required fields by body section

| Section | Required for security | Required for perf |
|---|---|---|
| `## Summary` | YES | YES |
| `## Threat model coverage` | YES | NO |
| `## Baseline reference` | NO | YES |
| `## Measurement result` | NO | YES |
| `## Threshold check` | NO | YES |
| `## Findings` | YES | YES |
| `## Required fixes` | YES | YES |
| `## Recommended` | YES | NO |
| `## Verdict` | YES | YES |

## Optional fields

The body MAY include additional markdown sections beyond the required
list. Consumers MUST ignore unknown sections (forward-compatibility rule).
Consumers MUST NOT silently drop required sections (regression rule).

## Aggregation rules

When `peaks-rd` aggregates audits from multiple skills, it uses the
following rules:

1. **Verdict precedence** — `block` > `warn` > `pass`. The aggregator's
   top-level verdict is the highest of the input verdicts.
2. **CRITICAL count** — sum of `CRITICAL:` markers across `## Verdict`
   blocks. The aggregator's overall `CRITICAL:` count is the total.
3. **Required fix deduplication** — identical `(file, line, hint)` tuples
   from different audits are merged into one Required Fixes entry. The
   source audits are listed in the entry.
4. **Handoff hash consistency** — if any input audit's `handoffHash`
   differs from the canonical peaks-prd handoff hash, the aggregator
   rejects the input with `AUDIT_HANDOFF_MISMATCH`.

## Schema version policy

- Bump `schemaVersion` (int) on any **breaking** change to the frontmatter
  fields or required body sections.
- Add new optional fields without bumping (forward-compat).
- A 1-minor-release deprecation window applies: when a new schemaVersion
  is introduced, the previous version's parsers stay in the codebase for
  1 minor release, then are removed.

## Known schema variants

> This section is **append-only**. peaks-txt sediment step appends new
> rows when a downstream consumer requires a schema extension that
> doesn't fit the current version.

| # | Variant | First introduced (rid) | Source | Status |
|---|---|---|---|---|
| (empty) | — | — | — | — |

The schema for new rows is `{ #, variant description, first introduced rid, source, status }`.
The `status` enum is `active` / `superseded` / `deprecated`.
