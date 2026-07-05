# A2A artifact mapping (informational)

> Reference for `peaks-code` and any other peaks skill that produces durable artefacts in `.peaks/_runtime/<session-id>/`. Maps peaks's on-disk artefact vocabulary onto the A2A (Agent2Agent) protocol's vocabulary so a future peaks consumer (e.g. an external LLM agent or a downstream peaks-loop extension) can read peaks output without having to learn a brand-new schema. This is a **documentation mapping**, not a protocol implementation: peaks-loop does not speak A2A over HTTP, does not host an AgentCard endpoint, and does not advertise its capabilities via A2A's discovery mechanism. It only uses A2A's *concepts* as a shared naming layer.

## 1. Why this reference exists

The A2A protocol (https://a2acn.com) defines five core concepts: **AgentCard**, **Task**, **Artifact**, **Message**, and **Part**. peaks-loop's session workspace is a parallel vocabulary that grew up independently: `prd/requests/<rid>.md`, `rd/tech-doc.md`, `qa/test-cases/<rid>.md`, etc. The two vocabularies are *not* identical (A2A is HTTP-shaped, peaks is filesystem-shaped), but the A2A concepts are close enough that aligning peaks artefact names with A2A terms in this reference:

- gives an external consumer a single translation table instead of two schemas to learn,
- lets a peaks operator talk about "the artifact" or "the task" in mixed conversations without losing precision,
- documents what peaks output is **not** (no SSE streaming, no remote AgentCard), so the limits are explicit.

This is the kind of borrowing that costs zero code and earns some interoperability. It is **not** an integration: peaks-loop does not implement A2A, does not run an A2A server, and does not depend on the a2a-protocol package. Adopting A2A concepts here is the same as adopting any other shared nomenclature (UML, OpenTelemetry, etc.): it improves the conversation, nothing more.

## 2. Concept-to-path mapping

The mapping below uses peaks's own paths verbatim. Each row also notes where peaks **diverges** from A2A, so a reader does not assume parity.

| A2A concept | peaks artefact | Path (under `.peaks/_runtime/<session-id>/`) | Notes |
|---|---|---|---|
| **AgentCard** (capability advertisement) | `peaks-skill-output-style` + `.peaks/.active-skill.json` | `.peaks/.active-skill.json`, `.peaks/.session.json` | peaks is a *local* tool, not a service. The "card" is the active-skill file plus a peek at `.peaks/PROJECT.md` for human-readable history. There is no `/.well-known/agent-card.json` endpoint. |
| **Task** (stateful unit of work) | `peaks request` state machine for a single `<rid>` | `.peaks/_runtime/<sid>/{prd,rd,qa,ui,sc}/requests/<rid>.md` (the request artefact); `.peaks/_runtime/<sid>/<role>/session.json` (per-session metadata) | peaks's task lifecycle is `prd:confirmed-by-user → handed-off`, then per role `draft → spec-locked → implemented → qa-handoff`, then `qa:running → verdict-issued`. The full state graph is enforced by `peaks request transition`. A2A's Task object is JSON; peaks's task is **a set of files with a `state` field per role**. |
| **Artifact** (immutable output) | `rd/tech-doc.md`, `rd/code-review.md`, `rd/security-review.md`, `qa/test-cases/<rid>.md`, `qa/test-reports/<rid>.md`, `qa/security-findings.md`, `qa/performance-findings.md`, `sc/handoff.md` | as listed | peaks's artefacts are *append-once*, not strictly immutable: a `qa/test-reports/<rid>.md` may be re-emitted on repair cycles. The convention is "newest write wins; the file at the end of the workflow is the truth", which is close enough to A2A's immutable-Artifact semantics for translation purposes. |
| **Message** (non-artifact communication) | `peaks skill presence` heartbeat + transition `--reason` notes | `.peaks/.active-skill.json` (`lastHeartbeat`), transition notes in `.peaks/_runtime/<sid>/<role>/requests/<rid>.md` | peaks does **not** separate Messages from Artifacts at the storage layer; a "message" is anything that is not the artefact body (the `<!-- peaks-memory:start -->` markers, the `state` field, the `--reason` text on a transition). Treat these as inline metadata of the artefact, not as separate objects. |
| **Part** (atomic content unit) | Markdown sections within an artefact, frontmatter fields | inline within the artefact | peaks's Artifacts are single Markdown files, so the "Part" concept maps to a heading or a frontmatter field. A `Part`'s `kind` in A2A terms is `text` (the prose), `file` (a `<!-- peaks-memory:start -->` block as a structured chunk), or `data` (the frontmatter). A2A's `form` / `iframe` / video `Part` kinds are not produced by peaks. |

## 3. Field-level mapping (A2A Part ↔ peaks frontmatter)

A2A `Part` has `kind` and `metadata` (free-form) plus `content` (typed by kind). peaks's per-artifact frontmatter carries a subset:

```yaml
---
name: <slug>            # used in memory extraction; not a 1:1 A2A field
description: <title>     # roughly the A2A Artifact.description
metadata:
  type: <kind>          # A2A Artifact.kind equivalent
  sourceArtifact: <rel> # A2A Artifact.source / provenance equivalent
---
```

A consumer reading a peaks artefact and translating it to A2A can populate:

- `Artifact.name` ← peaks `name`
- `Artifact.description` ← peaks `description` (or the first H1)
- `Artifact.kind` ← peaks `metadata.type`
- `Artifact.parts[0]` ← the body text (A2A `Part{kind: "text"}`)
- `Artifact.metadata.sourcePath` ← peaks `metadata.sourceArtifact`
- `Artifact.metadata.sessionId` ← from `.peaks/.session.json`

The mapping is not 100% lossless: A2A's `Part` can carry structured forms or file references, peaks cannot. That is the explicit *non-goal* of this mapping; it would be over-claiming to assert parity where there is none.

## 4. State-graph mapping (A2A Task ↔ peaks request)

A2A's Task object has a small set of states (typically: `submitted`, `working`, `input-required`, `completed`, `failed`, `canceled`). peaks's per-role request state machine is richer and per-role:

| Role | peaks states (in order) | Closest A2A Task state |
|---|---|---|
| `prd` | `draft` → `confirmed-by-user` → `handed-off` | `submitted` → `working` → `input-required` (for the confirm gate) |
| `rd` | `draft` → `spec-locked` → `implemented` → `qa-handoff` | `working` |
| `qa` | `draft` → `running` → `verdict-issued` (verdict is `pass` / `return-to-rd` / `blocked`) | `working` → `completed` (pass) / `input-required` (return-to-rd) / `failed` (blocked) |
| `ui` | `draft` → `direction-locked` → `handed-off` | `working` → `completed` |
| `sc` | `draft` → `recorded` | `working` → `completed` |

A consumer translating peaks states to A2A should:

- collapse peaks's multi-role state machine to a *single* A2A Task state by taking the most progressed of any role,
- use the A2A `input-required` state to model **any** gate where peaks is waiting for a human (`confirmed-by-user`, `--confirm`, AskUserQuestion for a login wall, etc.),
- emit `completed` only when QA verdict is `pass` and SC has recorded the change,
- emit `failed` on `blocked` QA verdict or `blocked` handoff.

## 5. Worked example: a feature slice from start to finish

A user runs `peaks-code` for a "add user authentication" feature. Mapping the resulting files to A2A concepts:

```
.peaks/_runtime/<sessionId>/prd/requests/001.md      → A2A Artifact (kind=proposal)
.peaks/_runtime/<sessionId>/ui/requests/001.md       → A2A Artifact (kind=design-direction)
.peaks/_runtime/<sessionId>/ui/design-draft.md       → A2A Artifact (kind=visual-spec)
.peaks/_runtime/<sessionId>/rd/tech-doc.md           → A2A Artifact (kind=implementation-plan)
.peaks/_runtime/<sessionId>/qa/test-cases/001.md     → A2A Artifact (kind=test-cases)
.peaks/_runtime/<sessionId>/rd/code-review.md        → A2A Artifact (kind=review, status=fixed)
.peaks/_runtime/<sessionId>/rd/security-review.md    → A2A Artifact (kind=security-review)
.peaks/_runtime/<sessionId>/qa/test-reports/001.md    → A2A Artifact (kind=test-report, verdict=pass)
.peaks/_runtime/<sessionId>/qa/security-findings.md  → A2A Artifact (kind=security-findings)
.peaks/_runtime/<sessionId>/qa/performance-findings.md → A2A Artifact (kind=performance-findings)
.peaks/_runtime/<sessionId>/sc/handoff.md            → A2A Artifact (kind=change-record)
.peaks/_runtime/<sessionId>/txt/handoff.md           → A2A Artifact (kind=handoff-capsule)
.peaks/_runtime/<sessionId>/system/sub-agent-*.json  → A2A Message (sub-agent presence markers)
.peaks/_runtime/<sessionId>/sc/swarm-plan.json       → A2A Message (the dispatch plan)
.peaks/memory/*.md                    → A2A Artifact (kind=project-memory, persists across sessions)
```

A consumer wanting to render a single "feature" object in A2A terms picks the `test-reports/001.md` (verdict=pass) as the terminal Artifact and the rest as supporting Parts or sibling Artifacts. The mapping is intentionally loose: peaks's value is that *all of these files exist*, not that they fit A2A's object model exactly.

## 6. What peaks does NOT provide

To keep the mapping honest, peaks-loop **does not** currently provide the following A2A primitives, and consumers should not expect them:

- A2A **AgentCard** served over HTTP at `/.well-known/agent-card.json`. peaks-loop is a local CLI; its "card" is the on-disk `.peaks/.active-skill.json` plus `peaks skill doctor --json`.
- A2A **streaming** responses (SSE / WebSocket). peaks commands are synchronous and return a single JSON envelope.
- A2A **identity / auth** (OAuth, OIDC, mTLS). peaks assumes local-machine trust.
- A2A **cross-vendor discovery**. peaks has no A2A registry entry; MCP-compatible capabilities are discovered by the LLM via its own tool list (the LLM checks for `mcp__<server>__*` entries in its own function schema) and reported back to the user. Slice #016 retired the `peaks mcp *` indirection layer.
- A2A **Task delegation across the network**. peaks's "sub-agent" is a Claude Code `Task` tool call in the same process, not a remote A2A server.

These are *deliberate* omissions. peaks-loop solves a different problem (a local workflow-gating CLI for Claude Code), and adopting A2A's networking surface would add weight without addressing peaks's actual failure modes (which are around LLM bypassing gates, not around inter-agent discovery).

## 7. When to re-evaluate

Re-open this mapping in any of the following cases:

- a peaks user reports a real need to share workflow state with a non-peaks agent (e.g. an Autogen / LangChain agent that wants to read a peaks handoff capsule);
- peaks-loop ships a hosted / multi-user mode where AgentCard-style discovery becomes useful;
- the A2A protocol stabilises on a thin `Artifact` JSON schema that matches peaks's on-disk shape close enough to make translation a one-liner rather than a reference doc.

Until one of those fires, this reference doc is the entire A2A surface area of peaks-loop. Adding more is over-engineering.
