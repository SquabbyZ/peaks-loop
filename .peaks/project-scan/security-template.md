---
schemaVersion: 1
templateKind: security-audit
capturedAt: 2026-06-27T00:00:00.000Z
appliesTo: peaks-security-audit skill
---

# Security Audit Template (peaks-cli v2.12.0)

> **Bootstrap template** for `peaks-security-audit` skill. Consumed by the
> skill at audit start. Modified only by peaks-txt sediment step (append-only,
> idempotent on `(concept, sourceRid)`). Lives under `.peaks/project-scan/` so
> it is git-tracked and reviewable like `project-scan.md` / `business-knowledge.md`.

> **Hard gate contract**: when this file is absent at audit start,
> `peaks security-audit run` exits with code `AUDIT_TEMPLATE_MISSING`
> (per PRD AC-2.5). The CLI never falls back to inline template; the
> file MUST be present.

## Threat model dimensions

The security-audit agent MUST inspect each of the following 8 dimensions
in every audit cycle. Mark each dimension as one of: `clean` / `risk` /
`critical` / `n/a (with rationale)`. The aggregation produces the audit
verdict (`pass` / `warn` / `block`).

1. **Authentication & authorization** — login flows, token lifecycle, RBAC, scope checks, session expiration
2. **Secrets management** — hardcoded credentials, env-var leakage, secret rotation, vault integration
3. **Input validation** — request body validation, query param parsing, type coercion, allowlists vs denylists
4. **Path traversal & filesystem trust** — path normalization, symlink handling, realpath resolution, parent dir escape
5. **SQL/NoSQL injection** — parameter binding, query construction, ORM usage, raw concatenation
6. **Cross-site scripting (XSS) & content injection** — output encoding, CSP headers, sanitization at sink
7. **Dependency supply chain** — third-party packages, transitive deps, lockfile drift, abandoned packages
8. **External API surface** — egress auth, SSRF guards, response validation, timeout/retry behavior

## OWASP Top-10 anchors

For each dimension above, the audit agent cross-references the relevant
OWASP Top-10 (2021) category. The list below is the canonical mapping:

| Dimension | OWASP category (2021) |
|---|---|
| Authentication & authorization | A01:2021 — Broken Access Control |
| Secrets management | A02:2021 — Cryptographic Failures + A07:2021 — Identification and Authentication Failures |
| Input validation | A03:2021 — Injection |
| Path traversal & filesystem trust | A01:2021 — Broken Access Control + A03:2021 — Injection |
| SQL/NoSQL injection | A03:2021 — Injection |
| XSS & content injection | A03:2021 — Injection |
| Dependency supply chain | A06:2021 — Vulnerable and Outdated Components |
| External API surface | A10:2021 — Server-Side Request Forgery (SSRF) |

## Audit output schema

The audit agent writes a single markdown file at
`.peaks/_runtime/<sessionId>/audit/security-<rid>.md` with the following
frontmatter and sections.

### Required frontmatter

```yaml
---
schemaVersion: 1
artifactKind: security-audit
rid: <request-id>
sid: <session-id>
handoffHash: <sha256 of prd/handoff.md body>
templateVersion: 1
generatedAt: <ISO 8601 timestamp>
verdict: pass | warn | block
violationsCount: <integer>
---
```

### Required body sections

- `## Summary` — one-paragraph risk narrative
- `## Threat model coverage` — table of 8 dimensions with status
- `## Findings` — bullet list with severity tag `[CRITICAL | HIGH | MED | LOW]`
- `## Required fixes` — actionable bullet list with file:line references
- `## Recommended` — optional improvement bullet list
- `## Verdict` — block: `verdict: <pass | warn | block>` + `CRITICAL: <n>`

The `## Verdict` block MUST contain the literal string `CRITICAL: <n>` even
when the count is zero (per peaks-cli Gate B3 substring contract on the
`CODE_REVIEW` prerequisite — the security-audit artifact follows the same
convention).

## Known risks inventory

> This section is **append-only**. peaks-txt sediment step appends new
> rows when a security audit surfaces a recurring risk pattern. Do not
> rewrite existing rows.

| # | Risk pattern | First seen (rid) | Source | Status |
|---|---|---|---|---|
| (empty) | — | — | — | — |

The schema for new rows is `{ #, risk pattern, first seen rid, source, status }`.
The `status` enum is `active` / `mitigated` / `accepted` / `deprecated`.
