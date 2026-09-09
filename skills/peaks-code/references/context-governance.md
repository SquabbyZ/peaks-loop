# Context Governance — G7 + G8 + G9 protocol details

> Slice #010 (G7 + G8 + G9 context-governance push).
> See: `.peaks/memory/sub-agent-context-minimal-occupation.md` + `sub-agent-shared-channel-cross-completion.md` for the red lines.

## G0 — orchestrator large-tool-output discipline (slice 2026-09-10-context-audit-and-discipline)

### The measurement (session `2026-09-07-session-245530`, ~68% of a 1M window)

The real token cost is the ORCHESTRATOR's own context — not dispatch boilerplate:

| Offender | Volume | Cost |
|---|---|---|
| 4 × full `peaks memory reindex --json` unclassified array | ≈ 160 KB | ≈ 40K tokens |
| 20 × sub-agent final reports | ≈ 60 KB | ≈ 15K tokens |
| several `cat` of large docs | ≈ 15 KB | ≈ 4K tokens |

`peaks code context-now` reports a RATIO only. `peaks code context-audit --project <root> --json` reports WHAT fills the window — top-N groups of `{tool, key, bytes, pctOfTotal, count}` — so the next session can name the offender instead of guessing. Read-only, fail-soft (`available: false` + reason; never blocks, never exits non-zero).

### The rule (BLOCKING)

- Tool output **> 2 KB** MUST NOT be dumped into the orchestrator's context.
- Prefer the opt-in `--summary` flag, which emits counts + names-of-first-N (≤ 2 KB) instead of the full array:
  - `peaks memory reindex --summary`
  - `peaks memory list --summary`
  - `peaks doctor --summary` (JSON envelope)
  - `peaks request list --summary`
- When a command has no `--summary`, write the output to a file and `Read` only the needed slice (offset/limit), or pipe through a filter before it reaches the orchestrator.
- Default (no flag) envelopes are byte-identical to before — `--summary` is strictly opt-in, so back-compat is preserved.

### Quality guard (binding)

`--summary` is an ADDITIVE view. It removes no information: every path, name and count remains on disk and is re-readable by re-running the same command without the flag. Silently dropping data is forbidden; shrinking the in-context copy is the goal. The sub-agent FINAL report cap (≤ 40 lines / 2 KB, detail in the artifact the parent can `Read`) follows the same principle — see the dispatch prompt's `## Final report cap (mandatory)` block.

## G7 — sub-agent context minimal-occupation (metadata-only + 按需 Read)

### Path convention

```
.peaks/_sub_agents/<sid>/artifacts/<rid>-<role>-<idx>.<ext>
```

### ArtifactMeta schema

```ts
interface ArtifactMeta {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
  readonly status: 'created' | 'finalized' | 'partial' | 'failed';
  readonly contentInlined: false;  // mandatory literal
  readonly summary: string | null; // ≤ 200 chars
  readonly writtenAt: string;
  readonly rid: string;
  readonly role: string;
  readonly idx: number;
}
```

### Sub-agent completion protocol (G3 + G7.4.g)

```
On completion:
1. Write artifact to .peaks/_sub_agents/<sid>/artifacts/<rid>-<role>-<idx>.<ext>
2. Call `peaks sub-agent dispatch --write-artifact <path>` (or via --write-artifact on dispatch)
   → CLI computes sha256 + size + writes ArtifactMeta to record
3. Call `peaks sub-agent share --key "<role>.completed" --value <artifact-meta>` (G8.6)
```

### Main LLM reducer view (G7.4.e)

```
[peaks-code] batch 3/3 done in 47.3s
- rd → .peaks/_sub_agents/2026-06-06-session-5b1095/artifacts/003-rd-001.md (12KB, sha256:abc123) summary: "wrote RD tech-doc with 4 sub-roles and dispatcher interface"
- qa-business → .../artifacts/003-qa-business-001.md (8KB, sha256:def456) summary: "wrote 12 API test cases covering happy + 3 error paths"
- qa-perf → .../artifacts/003-qa-perf-001.md (5KB, sha256:ghi789) summary: "wrote perf baseline; p95 latency target ≤ 200ms"
```

### Numerical budget

| 方案 | Per sub-agent | 3-sub-agent batch | 6-sub-agent batch |
|---|---|---|---|
| Old: inline full content | 1MB typical | 3MB | 6MB |
| **G7 metadata-only (this slice)** | ~200 chars | **600 chars** | **1.2KB** |

3000-5000× improvement. Main LLM full-slice context net increase: < 10KB for 5 batches × 6 sub-agents.

## G8 — cross sub-agent shared channel

### Path convention

```
.peaks/_sub_agents/<sid>/shared/<rid>-<batchId>.json
```

### Two new CLI atoms

```
peaks sub-agent share --batch <batchId> --key <k> --value <json> --json
  Writes a shared entry. Last-write-wins by key. value ≤ 1KB soft warn, ≥ 64KB rejected.

peaks sub-agent shared-read --batch <batchId> [--since <iso>] [--key <pattern>] --json
  Reads entries. --key is a glob pattern with * wildcard.
```

### Sub-agent prompt template (G8.6)

```
You are sub-agent role <role>, batch <batchId>.

PROTOCOL (mandatory):
1. On start: peek at shared channel: `peaks sub-agent shared-read --batch <batchId> --json`
   to see what other sub-agents in this batch have shared so far.
2. While running: if you find a blocker or partial work, write share entry
   `peaks sub-agent share --key "<role>.found-blocker" --value {"reason": "..."}`
   so other in-flight sub-agents can avoid duplicating effort.
3. On completion: write share entry
   `peaks sub-agent share --key "<role>.completed" --value <artifact-meta>`
   BEFORE the final `peaks sub-agent heartbeat --status done` heartbeat.
4. The shared channel is your only visibility into sibling sub-agents.
   Do NOT attempt to read other sub-agents' dispatch records directly.
```

### RL-23 completion-time mandatory write

- When sub-agent calls `peaks sub-agent heartbeat --status done`, it MUST also call `peaks sub-agent share --key "<role>.completed" --value <artifact-meta>`.
- If sub-agent omits the share, heartbeat still succeeds but emit warning `code: "COMPLETED_WITHOUT_SHARE"`.

## G9 — forced compression gate

### Threshold table (256K default context capacity)

> **Slice 2026-06-23-audit-4th #F4:** the canonical source is
> `src/services/context/threshold.ts` (4 tiers: `ok` / `soft-warn` /
> `near-limit` / `hard-reject` / `emergency`). When editing this
> table, ALSO edit the constants in `threshold.ts` — drift between
> the two is a contract bug. Pre-#F4 the doc listed
> `+ contextWarning: 'high'` for 90%, which did NOT match the
> in-code `code: "PROMPT_EMERGENCY"`. The row below is the
> post-#F4 fix.

| Threshold | Prompt size | Behavior |
|---|---|---|
| 50% (early warn) | ≥ 128KB | Soft warning, suggest trimming the prompt |
| **75% (user red line)** | ≥ 192KB | Soft warn + mandatory trim/split suggestion; `warnings: ["CONTEXT_NEAR_LIMIT"]` |
| **80% (hard reject)** | ≥ 204KB | Hard reject `code: "PROMPT_TOO_LARGE"`; `--force` allowed at CLI |
| **90% (emergency)** | ≥ 230KB | Hard reject `code: "PROMPT_EMERGENCY"`; `--force` STILL rejects at 90% (no override) |

### Two-layer enforcement (G9.2)

- **CLI 兜底** — `peaks sub-agent dispatch` validates prompt size; `--force` allowed.
- **PreToolUse hook** — `peaks sub-agent-dispatch-guard` re-validates; **NO `--force`** allowed at hook layer (RL-30 strict).

### `--force` semantics

- At CLI: `--force` allowed; emits `code: "FORCED_OVER_THRESHOLD"` warning + records `forcedAt: ISO8601`.
- At PreToolUse hook: `--force` is REJECTED (RL-30 strict). The hook's CLI does not declare a `--force` flag; the override path is physically not available.

## AC mapping

- AC-38..AC-43 (G7) + AC-47..AC-49 (G8) + AC-50..AC-65 (G9)
- See PRD §Acceptance criteria.

---

### G7 — sub-agent context minimal-occupation (metadata-only + 按需 Read)

> Body of `### G7`. Sub-agent artifacts (rd/tech-doc.md, qa/test-cases/&lt;rid&gt;.md, ui/design-draft.md) MUST NOT be inlined into dispatch records and fed back to the main LLM during reduce.

- Sub-agent writes artifact to disk at a known path (path convention: `.peaks/_sub_agents/<sessionId>/artifacts/<rid>-<role>-<idx>.<ext>`).
- Sub-agent calls `peaks sub-agent dispatch --write-artifact <path>` (or via dispatch CLI flag). The CLI computes sha256 + size + writes `ArtifactMeta` to record.
- Main LLM reduces the batch and sees ONLY the metadata view (~200 chars per sub-agent, vs ~1MB if content were inlined) — a 3000-5000× reduction.
- Main LLM decides whether to `Read <path>` for full content (LLM tool call, NOT via peaks CLI).

Main LLM view format (G7.4.e):
```
[peaks-code] batch 3/3 done in 47.3s
- rd → .peaks/_sub_agents/2026-06-06-session-5b1095/artifacts/003-rd-001.md (12KB, sha256:abc123) summary: "wrote RD tech-doc with 4 sub-roles"
- qa-business → .../artifacts/003-qa-business-001.md (8KB, sha256:def456) summary: "wrote 12 API test cases"
- qa-perf → .../artifacts/003-qa-perf-001.md (5KB, sha256:ghi789) summary: "p95 latency target ≤ 200ms"
```

### G8 — cross sub-agent shared channel (dispatcher-mediated indirect signal)

> Body of `### G8`. Sub-agent A's completion **immediately** writes a shared entry; sub-agent B (still in flight) can read shared entries from sibling sub-agents. **This is NOT peer-to-peer messaging.** The dispatcher stores, the sub-agents read/write; A and B never directly talk.

- Path: `.peaks/_sub_agents/<sessionId>/shared/<batchId>.json`.
- Two new CLI atoms (NO new top-level CLI): `peaks sub-agent share` + `peaks sub-agent shared-read`.
- RL-23 strong constraint: when sub-agent calls `peaks sub-agent heartbeat --status done`, it MUST also call `peaks sub-agent share --key "<role>.completed" --value <artifact-meta>`.

### G9 — forced compression gate (CLI 兜底 + hook double-guard)

> Body of `### G9`. Threshold table (256K default context capacity):

| Threshold | Prompt size | Behavior |
|---|---|---|
| 50% (early warn) | ≥ 128KB | Soft warning, suggest trimming the prompt |
| **75% (user red line)** | ≥ 192KB | Soft warn + `warnings: ["CONTEXT_NEAR_LIMIT"]` |
| **80% (hard reject)** | ≥ 204KB | Hard reject `code: "PROMPT_TOO_LARGE"`; `--force` allowed at CLI |
| 90% (emergency) | ≥ 230KB | Hard reject + `contextWarning: 'high'` |

Two layers:
- **CLI 兜底** — `peaks sub-agent dispatch` validates prompt size; `--force` allowed.
- **PreToolUse hook** — `peaks sub-agent-dispatch-guard` re-validates; **NO `--force`** at hook layer (RL-30 strict).

The sub-agent prompt template (G8.6 + G9 self-check) is in `references/context-governance.md`.
