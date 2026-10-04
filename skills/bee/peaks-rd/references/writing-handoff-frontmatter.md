# Writing handoff frontmatter (peaks-rd → peaks-qa)

Every RD handoff artifact carries a **YAML frontmatter block** so peaks-qa (and downstream roles) can mechanically cross-check decisions, risks, and gate evidence. The body below the frontmatter is free-form prose (markdown).

## Path

`.peaks/_runtime/<sessionId>/prd/handoff-<rid>.md` — the canonical immutable PRD handoff path (v2.11.0+; one capsule per slice since `2026-09-14-prd-capsule-rid-scoping`). The pre-scoping `.peaks/_runtime/<sessionId>/prd/handoff.md` is still readable as the legacy tier. The handoff is written by peaks-prd, sha256-hashed in frontmatter, and verified by every downstream sub-agent against the dispatched hash before reading.

> **v2.11.0 change (Group A):** the per-session `rd/tech-doc.md` is removed; the immutable peaks-prd handoff replaces it as the slice's source-of-truth architecture document.

## Required frontmatter fields

```yaml
---
requestId: 2026-06-25-slice-topology-multipass
sessionId: 2026-06-25-session-ee2aba
schemaVersion: 2
sha256: <64 lowercase hex of the body>
handoffHash: <the same 64 hex, no prefix>
writtenAt: 2026-06-25T03:05:30.000Z
goals:
  - G1
  - G2
acceptanceCriteria:
  - AC-1
preservedBehavior:
  - P1
scope:
  - src/services/slice/schema-router.ts
  - src/services/audit/audit-goal-service.ts
files:
  - src/services/slice/schema-router.ts
  - src/services/audit/audit-goal-service.ts
handoffPath: .peaks/_runtime/<sessionId>/prd/handoff-<rid>.md
decisions:
  - id: D1
    summary: "Route v1/v2 envelopes via SchemaRouter instead of branching in prompts"
    rationale: "Single source of truth; SchemaRouter already lives in src/services/slice/"
risks:
  - id: R1
    description: "v1 fallback path untested when sliceIds collide with v2 parentSliceIds"
    mitigation: "Added 3 collision cases to v1-fallback.test.ts"
nextActions:
  - "peaks-qa reads this handoff and runs the regression matrix"
  - "If Gate C passes, transition to txt handoff"
gateEvidence:
  projectScan: .peaks/project-scan/project-scan.md
  prdHandoff: .peaks/_runtime/<sessionId>/prd/handoff-<rid>.md
  codeReview: .peaks/_runtime/<sessionId>/rd/code-review-<rid>.md
  securityReview: .peaks/_runtime/<sessionId>/audit/security-<rid>.md
  perfBaseline: .peaks/_runtime/<sessionId>/audit/perf-<rid>.md
---
```

> The `gateEvidence` block above is the **feature-shaped** set, shown because it is the largest one. It is not a template to copy by hand: the producer derives the block from the request `type` (see the `gateEvidence` rule below), so a `config` slice's carries two keys and a `docs` / `chore` slice's capsule carries no such block at all.
## Field rules

- `requestId` — kebab-case; matches the PRD `requestId`.
- `sessionId` — the session the capsule belongs to. **Required by `readHandoff`.**
- `writtenAt` — ISO 8601 at write time. **Required by `readHandoff`.**
- `goals` / `acceptanceCriteria` / `preservedBehavior` — the PRD IDs this slice binds to (`['G1','G2']`, `['AC-1']`, `['P1']`). Arrays, empty allowed, and **required by `readHandoff`** — omitting the line is a shape failure, not a declaration of nothing.
- `sha256` and `handoffHash` — the same 64 hex digits, twice, on purpose: `sha256` is the PLAIN field the gate and both independent audit loaders match at line start, `handoffHash` is the quoted field `readHandoff` reads. A capsule whose two values differ verifies as tampering.
- `scope` / `files` — repo-relative paths (`src/...`), sorted. Authored by the writer; the serializer writes them only when present (`handoff-frontmatter.ts`), so an absent field is no line rather than an empty claim.
- `handoffPath` + `handoffHash` — the immutable PRD handoff location and its sha256 hash. Sub-agents MUST verify `handoffHash` matches the file's actual sha256 before reading; mismatch → return `blocked`.
- `decisions[]` — every decision an LLM made that an implementer could question. `id` is local; `summary` is one line; `rationale` is ≤ 2 sentences.
- `risks[]` — same shape; `mitigation` is required. A risk without a mitigation is a red line (gate blocked).
- `nextActions[]` — verb-first; what peaks-qa should do next, in order.
- `gateEvidence` — paths to the gate files peaks-qa will validate. **DERIVED, never hand-written**: the producer computes it from the request `type` (`src/services/prd/gate-evidence-derivation.ts`), and Gate C reads the same `rd:qa-handoff` row, so the block and the gate cannot disagree. It declares that row's evidence, plus `projectScan` (Gate A's artifact — declared only where Gate C runs, since a path nothing verifies should not be declared):
  - `feature` / `refactor` / `bugfix` → **5 keys**: `projectScan`, `prdHandoff`, `codeReview`, `securityReview`, `perfBaseline`
  - `config` → **2 keys**: `projectScan`, `securityReview`. `CONFIG_TABLE['rd:qa-handoff']` is the security review alone, so a config slice has **no** `prdHandoff`; and its security evidence is the genuinely ridless `rd/security-review.md`, not `audit/security-<rid>.md`.
  - `docs` / `chore` → **no `gateEvidence` block at all**. Those types have no `rd:qa-handoff` row: there is no evidence to declare and nothing for Gate C to check, so the block is omitted rather than filled with an unverified statement. Such a capsule is byte-identical to a pre-B2 one.
  **The Gate C failure rule is scoped to the types above** — where that gate runs: a declared path that does not exist fails `peaks request transition --state qa-handoff` (`PREREQUISITES_MISSING`), naming the key. Two shapes are deliberately NOT failures: a capsule for a type with no `rd:qa-handoff` row (the check does not run), and an **empty** declaration (`gateEvidence: {}`) — a weak claim, not a false one, since the type's artifacts remain enforced by the table itself, so an empty map cannot open the gate. When the request type cannot be resolved at all, the block is omitted rather than half-declared.
- `schemaVersion: 2` — pinned, and written PLAIN (no quotes). The constant is `HANDOFF_SCHEMA_VERSION` in `src/services/prd/handoff-frontmatter-shape.ts` and its value is the string `'2'`; the serializer emits it unquoted, because `AUDIT_REQUIRES_HANDOFF` matches the substring `schemaVersion: 2` and a quoted `'2'` would not contain it. `readHandoff` accepts `'2'` or the bare number `2` and nothing else — **`'2.0'` is not a valid value here**, and this document said it was until it was measured against the serializer. Bump only when the field set changes.

> **v2.11.0 Group A change:** `schemaVersion` moved to version 2 (the shape that added `sha256` and AC/goal IDs). The consumers listed under §Validation anchor on it, so a file carrying anything else is rejected at read time.

## Validation

The frontmatter MUST parse as valid YAML. Two automated consumers read it, and both anchor on `schemaVersion` + `sha256`: the `AUDIT_REQUIRES_HANDOFF` prereq in `src/services/artifacts/artifact-prerequisites.ts` and the independent audit services under `src/services/audit-independent/`. The serializer that writes it is `src/services/prd/handoff-frontmatter.ts`.

What is pinned now, and what is not:

- **Pinned** by `tests/unit/prd/handoff-frontmatter-doc-contract.test.ts`: the `gateEvidence` key set in the example above against `GATE_EVIDENCE_KEYS`, each request type's declared keys against `deriveGateEvidence`, and `schemaVersion` against what the serializer actually emits. If this document drifts from the code it describes, that test goes red.
- **NOT pinned — a recorded divergence**: `scope`, `files`, `decisions[]`, `risks[]` and `nextActions[]` are listed as required fields by this file and by `peaks-qa`'s reader doc, and the serializer emits none of them (it never has). `readHandoff` additionally REQUIRES `sessionId`, `writtenAt`, `goals`, `acceptanceCriteria` and `preservedBehavior`, which neither document lists. So a capsule hand-authored from this example is rejected, and four of peaks-qa's five mechanical cross-checks read fields that are not on disk. The contract test pins the gap in both directions so it cannot be quietly re-forgotten; closing it is an open decision (give the frontmatter those fields, or re-base the checks on inputs that exist).

```bash
# `peaks prd handoff init` prints the derived gateEvidence map (dry-run and
# applied), so the key set for a given slice is readable without opening the
# serializer. It does not validate an arbitrary handoff; that is
# `peaks prd handoff verify`.
```

## Body (prose, free-form)

Markdown below the frontmatter is the implementation narrative: what changed, why this slice, what the next role should know. Do NOT restate frontmatter fields in prose.
