# peaks-security-audit — Audit Protocol Reference

> **Operational reference** for the `peaks-security-audit` skill. This
> file is the parent LLM's step-by-step playbook: how to read the
> inputs, walk the 8 dimensions, score severity, and emit the envelope.
> The service (`security-audit-service.ts`) handles the I/O; this
> reference handles the **judgement**.

## Inputs

| Input | Source | Required | Notes |
|---|---|---|---|
| Handoff | `.peaks/_runtime/<sid>/prd/handoff.md` | YES | sha256-locked; verify before reading body |
| Template | `.peaks/project-scan/security-template.md` | YES | 8 dimensions + OWASP anchors |
| Diff | git working tree vs. `HEAD` | YES | The slice's changed files |
| Red-line scope | handoff's `## Red-line scope` | YES | Out-of-scope surfaces go to `nextActions[]`, not violations |

## Output envelope (strict shape)

```typescript
interface SecurityAuditEnvelope {
  readonly verdict: 'pass' | 'warn' | 'block';
  readonly violations: ReadonlyArray<{
    readonly dimension: string;        // 1 of 8 from template
    readonly severity: 'CRITICAL' | 'HIGH' | 'MED' | 'LOW';
    readonly file: string;             // repo-relative
    readonly line: number;             // 1-based
    readonly hint: string;             // <200 chars, actionable
  }>;
  readonly summary: string;            // 1-paragraph risk narrative
}
```

The service's `isSecurityAuditEnvelope()` rejects any deviation. The
skill MUST re-emit until it passes; if a violation cannot be expressed
in this shape, surface via `nextActions[]` in the detect result.

## Walking the 8 dimensions

For each dimension, the skill MUST do the following:

1. **Read the dimension's scope** — what files / paths in the diff
   touch this dimension.
2. **Apply the OWASP anchor** — use the anchor table in
   `security-template.md` to map the dimension to the relevant OWASP
   category.
3. **Mark the dimension** — exactly one of:
   - `clean` — no risk; no violations under this dimension.
   - `risk` — at least one `MED` or `LOW` violation; the dimension
     stays in the audit but does not block.
   - `critical` — at least one `HIGH` or `CRITICAL` violation; the
     dimension is escalated.
   - `n/a (with rationale)` — the dimension does not apply to this
     slice; rationale required (e.g. "no external API surface
     touched").
4. **Emit violations** — one entry per finding, with `(file, line,
   hint)` tuple. The `(file, line, hint)` triple is the dedup key in
   the aggregator.

### Dimension-by-dimension checklist

#### 1. Authentication & authorization (OWASP A01:2021)

- [ ] Login flow's session lifecycle (create / refresh / expire)
- [ ] Token scope checks; RBAC enforcement
- [ ] Authorization on every state-changing route
- [ ] Failure modes: invalid token, expired token, revoked token

#### 2. Secrets management (OWASP A02 + A07:2021)

- [ ] No hardcoded credentials in code or test fixtures
- [ ] Env vars for secrets, never inlined
- [ ] Secret rotation policy
- [ ] Vault integration (or equivalent); no plaintext secret storage

#### 3. Input validation (OWASP A03:2021)

- [ ] Request body validation at the boundary (zod / valibot / etc.)
- [ ] Query param parsing with type coercion
- [ ] Allowlist over denylist for untrusted strings
- [ ] Length limits, charset restrictions, recursive structure caps

#### 4. Path traversal & filesystem trust (OWASP A01 + A03:2021)

- [ ] Path normalization (`path.resolve` or equivalent)
- [ ] Symlink handling; `realpath` resolution
- [ ] Parent dir escape prevention (no `..` leak)
- [ ] Filesystem trust: which paths are user-controlled?

#### 5. SQL/NoSQL injection (OWASP A03:2021)

- [ ] Parameter binding for all queries
- [ ] No raw concatenation in query construction
- [ ] ORM usage consistent; raw queries only with parameter binding
- [ ] For NoSQL: object key injection (`$gt`, `$ne`) blocked

#### 6. XSS & content injection (OWASP A03:2021)

- [ ] Output encoding at the sink (not the source)
- [ ] CSP headers set; `default-src 'self'` baseline
- [ ] Sanitization at the rendering layer
- [ ] URL context escaping for `href` / `src`

#### 7. Dependency supply chain (OWASP A06:2021)

- [ ] Lockfile drift; `npm ci` reproducible
- [ ] No abandoned packages (last release >2 years + unpatched CVE)
- [ ] Transitive deps: no known unpatched CVEs
- [ ] Pin major versions; allow patch + minor

#### 8. External API surface (OWASP A10:2021)

- [ ] Egress auth (mTLS / bearer / signed requests)
- [ ] SSRF guards: no user-controlled URLs in fetch()
- [ ] Response validation (shape + status)
- [ ] Timeout + retry with backoff; circuit breaker for repeated failure

## Severity scoring

| Severity | Trigger |
|---|---|
| `CRITICAL` | Direct exploit path in the in-scope surface; no preconditions; data exfiltration or RCE |
| `HIGH` | Exploit path with preconditions (e.g. authenticated user, specific config); or auth bypass on non-sensitive operation |
| `MED` | Hardening gap; defense-in-depth; not directly exploitable |
| `LOW` | Style / hygiene; future-risk; not exploitable in current scope |

When in doubt, mark one severity lower and add a `Recommended:` entry
explaining the escalation reason. Do not over-flag.

## Verdict aggregation

| Condition | Verdict |
|---|---|
| Any `CRITICAL` violation | `block` |
| Any `HIGH` violation (no `CRITICAL`) | `block` |
| Any `MED` violation (no `HIGH` / `CRITICAL`) | `warn` |
| Only `LOW` violations | `warn` |
| No violations | `pass` |

A dimension marked `critical` MUST produce at least one `HIGH` or
`CRITICAL` violation; otherwise the dimension marking is inconsistent
and the skill re-marks.

## Sediment (peaks-txt handoff)

At session end, `peaks-txt` sediment step (Group C) appends new
recurring risk patterns to the template's
`## Known risks inventory` table. The skill's `## Recommended` section
is the source of new sediment rows; the format is:

```
| # | Risk pattern | First seen (rid) | Source | Status |
| N | <one-line pattern> | <rid> | peaks-security-audit | active |
```

The schema for new rows is documented in the template itself.

## Failure modes

- **Handoff sha256 mismatch** — `readAndVerifyHandoff` returns null.
  The skill MUST surface this via `nextActions[]` in the detect
  result; do not proceed to step 2.
- **Template missing** — `readSecurityTemplate` returns null. The
  skill surfaces via `nextActions[]` pointing to
  `peaks project template init`.
- **Envelope rejected by service** — `isSecurityAuditEnvelope` returns
  false. The skill re-emits until valid; do not write a malformed
  artifact.

## Cross-references

- Service: `src/services/audit-independent/security-audit-service.ts`
- Template: `.peaks/project-scan/security-template.md`
- Schema: `.peaks/project-scan/audit-output-schema.md`
- Companion: `skills/peaks-perf-audit/references/audit-protocol.md`
