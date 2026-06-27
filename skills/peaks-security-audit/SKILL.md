---
name: peaks-security-audit
description: Independent security audit skill. Reads the immutable peaks-prd handoff + the project-level security-template.md, performs an OWASP Top-10 + 8-dimension threat model audit, and writes a structured envelope to `.peaks/_runtime/<sid>/audit/security-<rid>.md`. Decoupled from peaks-rd 5-way fan-out per slice v2.12.0 (Group A, Tier 2). Use when the slice introduces authn/authz, secrets, input validation, path/filesystem trust, SQL/NoSQL injection, XSS/content injection, dependency supply chain, or external API surface changes.
metadata:
  appliesTo: peaks-cli v2.12.0+
  replaces: peaks-rd 5-way fan-out security-reviewer slot (per AC-2.x)
  sources:
    - handoff: .peaks/_runtime/<sid>/prd/handoff.md (sha256-locked, schemaVersion: 2)
    - template: .peaks/project-scan/security-template.md (git-tracked, schemaVersion: 1)
    - output: .peaks/_runtime/<sid>/audit/security-<rid>.md (frontmatter schemaVersion: 1)
    - schema: .peaks/project-scan/audit-output-schema.md
---

# peaks-security-audit

> **Independent security audit skill** — separate from `peaks-rd`'s
> in-process security-reviewer sub-agent. The skill is invoked explicitly
> via `peaks security-audit run --rid <id>` and reads the immutable
> `prd/handoff.md` + the project-level `security-template.md` to produce
> a structured `security-<rid>.md` artifact. Per v2.11.0 D1 (immutable
> handoff) and v2.12.0 AC-2.1~2.8.

## Why a standalone skill (not the 5-way fan-out slot)

The `security-reviewer` slot in `peaks-rd`'s 5-way fan-out was a
**self-deceiving** review (RD reviews its own work, on a per-slice
basis, every slice paying the same token cost). v2.12.0 promotes
security review to:

1. **Project-level** — the threat model lives at `.peaks/project-scan/security-template.md`
   (git-tracked, reviewable in PRs, reusable across slices).
2. **Handoff-locked** — the audit consumes the immutable `prd/handoff.md`
   (sha256-verified) so the audit cannot drift from the agreed goals.
3. **Independent** — invoked explicitly post-`peaks-rd` implementation,
   not as a sub-agent in the same process tree.
4. **Sediment-aware** — `peaks-txt` appends new threat patterns to the
   template's `## Known risks inventory` at session end.

## When to invoke

Invoke this skill when the slice touches any of the 8 threat model
dimensions (full list in the template's `## Threat model dimensions`).
For non-security-shaped slices (pure docs / chore / config), the slice
MUST NOT invoke this skill — the `security-audit run` CLI exits with
`AUDIT_NOT_REQUIRED` (per AC-2.6).

## Workflow (5 steps)

### Step 1 — Detect (mirrors `detectEcc` from `services/code-review/ecc-bridge.ts`)

```bash
peaks security-audit detect --rid <id> --sid <sid> --project <repo>
```

Calls `detectSecurityAudit()` in `src/services/audit-independent/security-audit-service.ts`.
Returns a 5-state result:

| State | Cause | Action |
|---|---|---|
| `ready` | handoff + template + project all present | Proceed to step 2 |
| `handoff-missing` | `.peaks/_runtime/<sid>/prd/handoff.md` absent | Run `peaks prd handoff init` first |
| `template-missing` | `.peaks/project-scan/security-template.md` absent | Run `peaks project template init` first |
| `dispatch-failed` | parent LLM threw before returning envelope | Inspect prompt template; fall back to inline LLM review (degradation note) |
| `envelope-malformed` | parent LLM returned non-conforming value | Verify the skill prompt matches AC-2.x output shape |

### Step 2 — Read inputs (handoff + template)

Read both inputs via the service (returns null on missing or sha256
mismatch — see `readAndVerifyHandoff` / `readSecurityTemplate`):

- **Handoff** — the immutable PRD-agreed goal statement. The audit
  scopes itself to the in-scope surfaces named in the handoff's
  `## Goals` + `## Acceptance criteria`. The handoff is **not** edited
  by this skill.
- **Template** — the project-level threat model (8 dimensions + OWASP
  Top-10 anchors). The audit walks every dimension and marks each as
  `clean` / `risk` / `critical` / `n/a (with rationale)`.

### Step 3 — Audit (parent LLM judgement)

The parent LLM (this skill) walks the diff against the 8 dimensions,
applying the OWASP Top-10 anchors from the template. Output is a
strict-shape envelope:

```typescript
interface SecurityAuditEnvelope {
  verdict: 'pass' | 'warn' | 'block';
  violations: ReadonlyArray<{
    dimension: string;        // 1 of 8 from template
    severity: 'CRITICAL' | 'HIGH' | 'MED' | 'LOW';
    file: string;             // repo-relative or absolute
    line: number;             // 1-based
    hint: string;             // actionable, <200 chars
  }>;
  summary: string;            // 1-paragraph risk narrative
}
```

Validation lives in `isSecurityAuditEnvelope()` in the service. The
service **silently drops** non-conforming envelopes; the skill MUST
re-emit the envelope until it passes validation.

### Step 4 — Write artifact

The service renders the envelope to markdown and writes to
`.peaks/_runtime/<sid>/audit/security-<rid>.md` (atomic tmp+rename).

```bash
peaks security-audit run --rid <id> --sid <sid> --project <repo> \
  --envelope @<path-to-envelope.json>
# or pipe the envelope via stdin
peaks security-audit run --rid <id> --sid <sid> --project <repo> < envelope.json
```

The artifact body has the required sections per `.peaks/project-scan/audit-output-schema.md`:

- `## Summary` — 1-paragraph narrative
- `## Threat model coverage` — 8-dim status table
- `## Findings` — bullet list with severity tag
- `## Required fixes` — actionable bullets
- `## Recommended` — optional improvements
- `## Verdict` — block: `verdict: <pass | warn | block>` + `CRITICAL: <n>`

### Step 5 — Hand off

The `peaks-rd` aggregator picks up the artifact from
`.peaks/_runtime/<sid>/audit/` and folds it into the slice's overall
`## Verdict` per the aggregation rules in `audit-output-schema.md`:

1. Verdict precedence: `block` > `warn` > `pass`.
2. CRITICAL counts summed.
3. Required fixes deduped by `(file, line, hint)`.
4. Handoff hash consistency: reject if `handoffHash` ≠ canonical.

## Hard contracts (BLOCKING)

- **No fall-back to inline template** — the skill never synthesizes a
  threat model from scratch. If the template is missing, the CLI exits
  with `AUDIT_TEMPLATE_MISSING` (per AC-2.5).
- **No edits to the handoff** — the skill reads the handoff as
  immutable. Any inconsistency must be surfaced via `nextActions[]`
  in the detect result, not by editing the handoff.
- **No self-deception** — the skill is invoked **after** `peaks-rd`
  implementation, not during. The 5-way fan-out's `security-reviewer`
  slot is removed in v2.12.0 (Group B Tier 4).

## Cross-references

- PRD handoff: `.peaks/_runtime/<sid>/prd/handoff.md` (sha256-locked)
- Template: `.peaks/project-scan/security-template.md` (git-tracked)
- Schema: `.peaks/project-scan/audit-output-schema.md`
- Service: `src/services/audit-independent/security-audit-service.ts`
- CLI: `src/cli/commands/security-audit-commands.ts`
- Tests: `tests/unit/services/audit-independent/security-audit-service.test.ts`
- Companion: `skills/peaks-perf-audit/SKILL.md` (symmetric structure)

## Karpathy alignment

- **#1 Think Before Coding** — `## Red-line scope` of the handoff
  defines what the audit covers. The skill surfaces out-of-scope
  findings as `nextActions[]` rather than silently expanding scope.
- **#2 Simplicity First** — the service is ~440 LoC, well below the
  800-line file cap. No speculative features.
- **#3 Surgical Changes** — the skill does not edit the handoff, the
  template, or the diff under audit. It only writes a new audit artifact.
- **#4 Goal-Driven Execution** — every audit output references a
  verifiable handoff goal via the `handoffHash` field.
