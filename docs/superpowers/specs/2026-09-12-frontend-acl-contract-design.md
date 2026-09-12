# Frontend ACL + API contract — design (v2)

**Date:** 2026-09-12
**Status:** draft for review
**Slice label:** `frontend-acl-contract`
**Author:** peaks-code (24h autonomous run, user-granted)
**Revision:** v2 — rewritten after an adversarial review demolished v1's central thesis. See §7 for what changed and why.

---

## 1. Problem

| # | Scenario | Trigger | User's stated need |
|---|---|---|---|
| 1 | PRD **+** interface doc | Doc exists up front | Derive the anti-corruption layer from the interface doc |
| 2 | PRD only, pure frontend | Backend not ready | Proceed without waiting; when the doc lands, adaptation must be cheap and miss nothing |
| 3 | Full-stack | Both halves in one repo | Contract as a shared interface → parallel development + incremental integration |

The failure mode, in the user's words: **"适配改的时候不至于工作量很大，或者遗漏改动点"**.

### 1.1 What exists today (audited 2026-09-12, citations verified)

**EXISTS**

- `skills/bee/peaks-rd/references/frontend-acl-mapper.md` — a real ACL convention (commit `70184e1f`, 2026-09-01). Three BLOCKING rules; `:11` = one-mapper-file-per-domain; `:29` = the QA/code-review verification clause; `:17` is the one legal `UserDTO` import site.
- `skills/peaks-code/references/frontend-only-mode.md` — a thorough scenario-2 story: an 8-row mock-strategy table keyed on the project's data-fetching pattern, 5 mock-data rules, an API-contract placeholder layout (`:43`), and a mock→real migration path (`:55-62`).
  - `:39` makes `.peaks/_runtime/<sessionId>/rd/mock-plan.md` **"the source of truth for mock locations across runs"**.
  - `:62` has the TXT handoff record "mock file paths, the corresponding swagger endpoints (when known)".
- `src/services/scan/archetype-service.ts:38-47,103-115` — `SWAGGER_CANDIDATE_PATHS` (8 entries incl. `swagger.yaml`, `docs/*`) detected by `pathExists` only.
- `src/services/scan/existing-system-service.ts:25` — `HOOK_DIRS = ['src/hooks','src/hook','src/composables']`, used at `:274-278` to sample hook file **paths** by mtime.
- `src/services/audit/enforcers/mock-placement.ts` + `rl-mock-placement-001` (`red-line-catalog.ts:61-70`) — the existing frontend-facing enforcer pattern: three regexes over changed text.
- **Already-runtime dependencies**: `zod@^4.4.3`, `yaml@^2.9.0` (`package.json`, 12 runtime deps total).

**DOES NOT EXIST**

- **No ingestion.** `swagger.json` is detected by `pathExists` and **never read or parsed**. No OpenAPI parser, no codegen, no CLI.
- **No enforcement surface for the ACL.** `anti-corruption|frontend-acl` across `skills/bee/{peaks-qa,peaks-prd,peaks-ui,peaks-txt}` and `skills/peaks-code` = **0 files**; `acl|anti-corruption|mapper` in `src/services/audit/` = **0**. Referenced only from `skills/bee/peaks-rd/SKILL.md:226-230,312`.
- **Hook contents are never read.** `HOOK_DIRS` samples paths only, so no naming/return-shape convention is checkable.
- **`peaks-ui` cannot touch any of this** — `skills/bee/peaks-ui/SKILL.md:103` "Do NOT modify application code"; its design-draft sections have no API/data-fetching/hook section.
- **project-scan has no API dimension.** `skills/peaks-code/references/project-scan-checklist.md:104-137` has no `## API` section: no base-URL/env, request wrapper, interceptors, error shape, endpoint inventory, hook naming, or DTO↔VM boundary.
- **The three scenarios are not modelled.** `scan-types.ts:18` — `frontendOnly: boolean` (`:19` is `frontendOnlyReason`). Scenarios 1 and 3 collapse into scenario 2's path.

### 1.2 The diagnosis (corrected)

v1 claimed "a missed change-site is a type problem, so generate types and let `tsc` catch it". **That claim does not survive scrutiny, and the correction is the most important sentence in this document:**

> **Generated types guarantee doc↔code consistency. They cannot guarantee doc↔server consistency.**

The user's trigger is *"when the backend doc lands"*. If the doc is stale or wrong, types, client, and mappers all regenerate from the same wrong doc and **compile clean** while the UI renders `undefined`. The guarantee is therefore real but narrow, and everything below is sized to it.

There is also **no plumbing today** to make even that narrow guarantee fire: `src/services/slice/slice-check-service.ts:45` hardcodes `TYPECHECK_PREEXISTING_BASELINE = 142` against **peaks-loop's own** `tsconfig.build.json` (`:35-37,178-182`). Nothing connects a *consumer's* contract to that tsconfig.

What survives from the diagnosis: **prose cannot enforce anything**, and the existing ACL is prose. That is still why the user's failure mode persists.

---

## 2. Design

### 2.1 Start with the smallest thing that targets the stated pain

The user's literal complaint is *"the diff is big and I miss change-sites"*. The raw materials to attack that **already exist** (§1.1): `mock-plan.md` records mock locations, RD already writes `*-api.types.ts`, the TXT handoff already records the endpoint list.

So **S1 builds no new artifact.** It parses an OpenAPI/Swagger document and compares it against what the project has already recorded, then reports per-endpoint/per-field deltas plus the files mentioning either name.

A contract artifact is **deferred to S2, and only if S1 proves insufficient** — specifically, only scenario 3 (parallel full-stack, two halves needing one shared machine-readable interface) is likely to require it. Scenario 1 and 2 may be fully served by a report.

### 2.2 Layering — hooks are the seam, mappers are the protection

```
API DTO (external, volatile)
   │
   ▼  mapper — PURE function, no framework, unit-testable     ← the PROTECTION
ViewModel (internal, stable)
   │
   ▼  hook (useUser)                                           ← the DELIVERY seam
Component
```

The user proposed making the ACL hook-shaped. Half right: a hook *is* where the boundary is crossed in React/Vue, but encoding the ACL *as* hooks puts mapping inside effects and re-scatters what the mapper exists to concentrate — the failure `frontend-acl-mapper.md:11` already warns about. **Enforce the mapper; let the hook consume it.**

This is unchanged from v1 because the review did not contest it.

### 2.3 The change-site report, honestly scoped

`peaks api diff <doc>` output carries two kinds of line, **labelled differently**:

| Kind | Source | Confidence |
|---|---|---|
| `changed` / `added` / `removed` | doc vs. recorded interfaces | **Exact** — both sides are parsed |
| `mentions` | name-grep across the consumer's source and non-TS assets | **Candidate** |

v1 proposed attaching exactness to a `mapping.file` pointer. The review killed that: **`mapping.file` is authored, never verified** — a stale pointer yields a confidently wrong list, which is worse than no list. The report therefore claims nothing it cannot verify, and says out loud that a name-grep over-reports (test fixtures match) and under-reports (i18n keys, AntD `columns` arrays, `data-field` attributes, monorepo barrels).

**Also not detectable today, and the report must not imply otherwise:** a backend field whose type is unchanged but semantics changed; a removed endpoint nobody calls; a new required field the client never sends if the request body is typed loosely; and any drift where the document itself is stale.

### 2.4 Enforcement: what is actually achievable

v1's S4 proposed a regex enforcer for "a component consuming a `*DTO` directly". **That is undetectable by regex** — the real violation (`const u = resp.data; u.user_id`) matches nothing, while the one *legal* site (`import type { UserDTO }` in the mapper, `frontend-acl-mapper.md:17`) matches. The pattern cannot express a type-flow property.

v2 therefore **drops the DTO-consumption enforcer** rather than shipping a rule that fires on the wrong code. If enforcement is wanted later it requires type-aware analysis (a materially larger lift) or a different mechanism — e.g. forbidding `as`-casts at the client boundary, which *is* regex-checkable.

What survives as cheap and honest:
- **project-scan `## API` dimension** (§2.5) — a real, independent gap, cheap to close.
- **Hook *content* scan** — reading `src/hooks/**` to check naming/return-shape conventions. Note the scope question the review raised: `existing-system-service.ts` reads the **consumer** project; `src/services/audit/` reads **peaks-loop itself**. S1–S3 must state which one they join before writing code.

### 2.5 Scan + scenario model

- Add an `## API` section to the scan template: base-URL/env, request wrapper, interceptors, error shape, hook naming, endpoint inventory, existing mock strategy, DTO↔VM boundary.
- Add a tri-state integration mode alongside the existing `frontendOnly` boolean (`scan-types.ts:18`) — the boolean stays for back-compat.

### 2.6 The scenario-2 trap (must be designed for, not discovered later)

An LLM-authored contract is a **guess**. If the guess is wrong, a mock built to satisfy it compiles clean and the QA gate *passes* — the wrongness is invisible until integration, so the artifact **actively misleads** rather than merely failing to help.

Therefore any authored contract must be a **live state, not a frozen file**: something must detect "a real document now exists for this domain" and refuse to let the authored guess be treated as fulfilled. v1 had the `source.kind: "authored"` field but no slice implementing staleness detection, so the contract would silently rot — reintroducing the original failure mode with more moving parts.

**If S2 happens, staleness detection is part of S2, not a follow-up.**

---

## 3. Non-goals

- **Not** a mock server (static fixtures per `frontend-only-mode.md`); no MSW/pact runtime.
- **Not** an `openapi-typescript` replacement.
- **Not** a new `api` top-level verb group presented as if it existed — there is no `api` group today (the only near-match is `scan api-surface`, `src/cli/commands/scan-commands.ts:332`); `peaks api …` would be **brand new**, and that cost is acknowledged, not hidden.
- **Not** an expansion of `peaks-ui` — it stays design-direction only (`SKILL.md:103`).
- **Not** an invented schema format. `zod` and `yaml` are already runtime dependencies; any structured shape uses `zod` (`nullable`/`optional`/`enum`/`discriminatedUnion`/recursive arrays/`record` + `z.infer`), never a hand-rolled "loose structural description".

---

## 4. Slices

| # | Slice | Deliverable | Acceptance |
|---|---|---|---|
| S1 | **`peaks api diff <doc>`** | Parse OpenAPI 3.x (JSON+YAML via the existing `yaml` dep); compare against `mock-plan.md` + recorded `*-api.types.ts` + the handoff endpoint list; print exact `changed/added/removed` plus labelled candidate `mentions` | Runs against a real OpenAPI fixture; output distinguishes exact from candidate; a deliberately renamed field appears as `changed` |
| S2 | Integration mode + `## API` scan dimension | Tri-state mode beside `frontendOnly`; new scan section | Scan captures the new facts on this repo; boolean back-compat |
| S3 | **Contract artifact — only if S1 proves insufficient** | zod-validated `.peaks/api-contract.json`, **including staleness detection (§2.6)** | Must be justified by a demonstrated S1 shortfall; staleness detection ships in the same slice |
| S4 | Hook content scan | Read `src/hooks/**` contents; naming + return-shape conventions | Fixture hook dir with violations; scope (consumer vs peaks-loop) stated explicitly first |

**S1 ships first and S2 is independent of it. S3 is conditional — it does not get built on schedule, it gets built on evidence.**

---

## 5. Risks

| Risk | Severity | Handling |
|---|---|---|
| The report is trusted as exhaustive | **High** — recreates discipline-as-contract at one remove | Exact vs candidate labelled per line; the §2.3 non-detectable list is printed in `--help` and in the output footer |
| Doc↔server drift is outside every mechanism here | **High** — it is the user's main trigger | Stated plainly in the output and in RD guidance; not papered over |
| A brand-new `peaks api` group is real cost | Medium | Acknowledged; S1 is the only slice that adds one |
| New scan section breaks existing consumer scan fixtures | Medium | Additive only; boolean retained |
| Scope creep into mock servers / pact / codegen | Medium | §3 |
| S3 gets built because it is on a list, not because S1 failed | Medium | S3's acceptance gate is "a demonstrated S1 shortfall", verified before dispatch |

---

## 6. Assumptions made on the user's behalf

Autonomy was granted; each call is reversible.

1. **S1 is report-only and creates no artifact.** Cheapest thing that targets the literal complaint, and it reuses three things that already exist.
2. **No invented schema format** — `zod` is already a dependency and is strictly more expressive than v1's `shape`.
3. **The contract artifact is conditional, not scheduled.** If S1's report serves scenarios 1–2, S3 exists only for scenario 3.
4. **No DTO-consumption regex enforcer.** Shipping a rule that fires on the legal import and misses the real violation is worse than shipping nothing.
5. **`peaks-ui` is not expanded**; the ACL stays RD/QA territory.

## 7. What the adversarial review changed

Recorded because the reasoning matters more than the conclusion.

| v1 claim | Status | v2 |
|---|---|---|
| "Generated types make a missed change-site impossible" | **False as written** — doc↔code only, never doc↔server; and unplumbed to any consumer tsconfig | Narrowed to doc↔code; the doc↔server gap is stated as a first-class limitation (§1.2) |
| `shape` loose structural format | **Insufficient** — expresses only top-level key renames; cannot express nullable-vs-optional, enums, `oneOf`/`allOf`, arrays of nested objects (which degrade to `unknown[]` and destroy the guarantee) | Dropped; `zod` |
| "Without pulling a schema library into the dependency surface" | **Factually wrong** — `zod@^4.4.3` and `yaml@^2.9.0` are already deps | Corrected (§3) |
| S4 regex enforcer for direct DTO consumption | **Unreachable** — a type-flow property; the regex matches the legal mapper import and misses the real violation | Dropped (§2.4) |
| `mapping.file` gives exact change-sites | **Authored, never verified** — a stale pointer yields a confidently wrong list | Exactness claimed only for parsed-vs-parsed; everything else labelled candidate (§2.3) |
| Scenario 2 authored contract | **Net negative without staleness detection** — a wrong guess compiles clean and passes QA | Staleness detection is part of S3, not a follow-up (§2.6) |
| "peaks-loop already gates on tsc" | True only for peaks-loop itself | Corrected with `slice-check-service.ts:45` |
| `scan-types.ts:19` | Off by one — `frontendOnly` is `:18` | Corrected |
| "no new verb family beyond the `api` group" | Self-contradictory — no `api` group exists | Corrected (§3) |

## 8. Open questions

- Should generated types be committed, or emitted into a gitignored dir? (If S3 happens. Gitignored makes staleness silent by default.)
- For scenario 2, is the authored interface produced by `peaks-prd` (PRD time) or `peaks-rd` (RD time)? Drafted as RD.
- Does scenario 3 mean one repo or two (FE repo consuming a BE repo)? Two changes S1's input sourcing.
- Does `peaks api diff` join the consumer-project scope or peaks-loop's own? (`existing-system-service.ts` vs `src/services/audit/` — they read different projects.)
