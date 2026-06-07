---
name: sub-agent-context-minimal-occupation
description: Sub-agent context minimal-occupation red line — metadata-only dispatch records + 按需 Read, 主 LLM 净占用从 MB 级降到 ~200 字符/sub-agent
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-06-06-session-5b1095/prd/requests/002-2026-06-07-sub-agent-dispatch-decouple.md
---

User hard rule (2026-06-07 1:38 + 1:40 GMT+8): "**子 agent 会把上下文撑爆吧**" + "**能不能让子 agent 不占用上下文,或者极少的占用呢**". This is the **context minimal-occupation** red line for peaks agentTeam's pseudo-swarm model. It is orthogonal to G1..G6; registered as G7 in slice #009 PRD.

## Why

peaks agentTeam sub-agents produce artifacts (rd/tech-doc.md, qa/test-cases/<rid>.md, ui/design-draft.md etc.). If those artifacts are **inlined into dispatch records** and **fed back to the main LLM during reduce**, 3 sub-agents × 1MB artifacts = 3MB context, plus 6 sub-agents × 1MB = 6MB. The main LLM will silently truncate, lose data, or reject. The user's literal phrasing: "**能不能让子 agent 不占用上下文,或者极少的占用呢**" — emphasis on "不占" (don't occupy) over "少占" (occupy little).

The architecture-level fix is **metadata-only dispatch records + 按需 Read**: sub-agent writes artifact to disk at a known path; dispatch record holds only `path + size + sha256 + summary` (~200 chars per sub-agent); main LLM reads the dispatch record, decides whether to `Read <path>` for full content.

## The rule (RL-17..RL-22 + G7.4 metadata-only protocol)

**Path convention (G7.4.c)** — `.peaks/_sub_agents/<sid>/artifacts/<rid>-<role>-<idx>.<ext>`:
- `rid` = request id (e.g. `002-2026-06-07`)
- `role` = dispatch role string (e.g. `rd`, `qa-business-api`)
- `idx` = sequence number when same role is dispatched multiple times in one batch
- `ext` = file extension (default `.md`; chosen by sub-agent)

**ArtifactMeta schema (G7.3 / AC-34 / G7.4.d)** — what dispatch record stores per artifact:
```ts
interface ArtifactMeta {
  readonly path: string;             // e.g. .peaks/_sub_agents/<sid>/artifacts/002-rd-001.md
  readonly size: number;             // bytes
  readonly sha256: string;           // audit + de-dup
  readonly status: 'created' | 'finalized' | 'partial';
  readonly contentInlined: false;    // EXPLICITLY false; main LLM does NOT see content via record
  readonly summary: string | null;   // sub-agent's 1-2 sentence description (≤ 200 chars); allowed in main context
}
```

**Main LLM view (G7.4.e)** — what the main LLM actually sees after a batch:
```
[peaks-solo] batch 3/3 done in 47.3s
- rd → .peaks/_sub_agents/2026-06-06-session-5b1095/artifacts/002-rd-001.md (12KB, sha256:abc123) summary: "wrote RD tech-doc with 4 sub-roles and dispatcher interface"
- qa-business → .../artifacts/002-qa-business-001.md (8KB, sha256:def456) summary: "wrote 12 API test cases covering happy + 3 error paths"
- qa-perf → .../artifacts/002-qa-perf-001.md (5KB, sha256:ghi789) summary: "wrote perf baseline; p95 latency target ≤ 200ms"
```

Main LLM net context increase per batch ≈ 600 chars (3 × 200) instead of 3MB. **3000-5000× improvement.**

**ContextImpact tracking (G7.3 / RL-21 / AC-34)** — dispatch record adds:
```ts
interface ContextImpact {
  readonly promptSize: number;                  // bytes
  readonly artifactSizes: readonly number[];   // each artifact's bytes
  readonly batchTotalSize: number;             // sum
}
```
- `batchTotalSize > 4MB` OR any `artifactSize > 1MB` → `contextWarning: 'high'`
- Dispatcher can warn or split batches proactively

**`peaks sub-agent dispatch --write-artifact <path>` (AC-41)** — opt-in flag on existing dispatch CLI:
- sub-agent calls after writing the artifact file
- CLI computes sha256 + size + writes ArtifactMeta to record
- fire-and-forget async (RL-14); write failure → warning, not blocked
- File not found → `code: "ARTIFACT_NOT_FOUND"` warning

**Path safety (RL-18 / AC-40)**:
- Artifacts must be in `.peaks/_sub_agents/<sid>/artifacts/` (R-2 guard)
- Reject: `..` / absolute paths / symlink escape
- Reject empty files (0 bytes → status: 'failed')
- Soft warning on file names that don't match `<rid>-<role>-<idx>.<ext>` pattern

**SKILL.md protocol (G3 + G7.4.g / AC-42)**:
- peaks-solo / peaks-rd / peaks-qa SKILL.md fan-out sections must say: "sub-agent 产物 size ≤ 1MB, 超出请精简或拆多个 artifact"
- Sub-agent prompt template: "完成后: 1) 写产物到 `.peaks/_sub_agents/<sid>/artifacts/<rid>-<role>-<idx>.<ext>`, 2) 调 `peaks sub-agent heartbeat --status done --progress 100 --summary "<1-2 句>"`
- Main LLM reducer: "收齐 sub-agent 产物后, emit metadata-only 视图, 不灌内容; 需详情时显式 `Read <path>`"

## Numerical budget

| 方案 | Per sub-agent net main-context | 3-sub-agent batch | 6-sub-agent batch |
|---|---|---|---|
| Old: inline full content | 1MB typical | 3MB | 6MB |
| G7.2 head+tail (withdrawn) | 400 chars (200+200) | 1.2KB | 2.4KB |
| **G7.4 metadata-only (this rule)** | ~200 chars (path + size + sha + summary) | **600 chars** | **1.2KB** |

Main LLM full-slice context net increase: < 10KB for 5 batches × 6 sub-agents.

## How to apply

For every sub-agent dispatched by peaks-solo / peaks-rd / peaks-qa SKILL.md:

1. Sub-agent writes its artifact to `.peaks/_sub_agents/<sid>/artifacts/<rid>-<role>-<idx>.<ext>` (path convention mandatory for human/audit readability)
2. Sub-agent calls `peaks sub-agent dispatch --write-artifact <path>` (or heartbeat done with summary) to register ArtifactMeta
3. Main LLM reduces the batch and sees ONLY the metadata view (~200 chars per sub-agent)
4. Main LLM decides whether to `Read <path>` for full content (LLM tool call, not via peaks CLI)

For dispatch record writers:

1. Default `contentInlined: false` (强制)
2. Old records missing `contentInlined` / `ArtifactMeta` fields → read with defaults (backward compat, AC-34)
3. 0-byte artifact → `status: 'failed'`, not silent success
4. `sha256` is mandatory for audit + de-dup

For SKILL.md / sub-agent prompt templates:

1. Always include the artifact path convention in sub-agent prompts
2. Always include "产物 size ≤ 1MB, 超出请精简" guidance
3. Always include the metadata-only protocol in main LLM reducer sections

## What does NOT satisfy the rule

- "Sub-agent just inlines a 2MB artifact in dispatch record JSON" (violates the entire point — main LLM gets 2MB)
- "Sub-agent doesn't write a file at all; main LLM parses the dispatch record's prompt field" (violates RL-22 — sub-agent 产物应该**精炼**, not "everything including log dump")
- "Use head/tail summary" as default (withdrawn; was G7.2 RL-20 — was supposed to be a stopgap, but user rejected "少占" in favor of "不占")
- "Main LLM auto-Reads every artifact" (defeats the purpose — main LLM context still grows)
- "Sub-agent decides its own artifact path arbitrarily" (violates G7.4.c path convention — readability + audit requires convention)

## Cross-reference

- **PRD #009** G7 段 + G7.7 段 (headroom 集成路线) + AC-38..AC-43 + R-10
- **RD request #009** G7 in-scope + tech-doc outline 12
- [[sub-agent-heartbeat-progress-red-line]] — companion G6 rule; G6 covers liveness visibility, G7 covers artifact content visibility
- [[sub-agent-resource-lifecycle-red-line]] — companion G5 rule; G5 covers create/dispose, G7 covers content occupation
- [[sub-agent-headroom-forced-compression-gate]] — slice #010 跟进; G9 强制压缩门控在 G7 metadata-only 之上加 headroom 通道

## Why this is additive, not a replacement

G5 governs **create + dispose + reclaim** (resource lifecycle). G6 governs **liveness visibility** (heartbeat + poller). G7 governs **artifact content occupation** (metadata-only + 按需 Read). Three orthogonal axes:

| | G5 (resource) | G6 (liveness) | G7 (content) |
|---|---|---|---|
| Concern | Create + dispose + reclaim | Run + heartbeat + stale | Artifact content in main context |
| Question | Did we leak? | Is sub-agent alive? | Does main LLM context explode? |
| Failure mode | Orphan records pile up | User thinks dead, Ctrl-C | Main LLM silent-truncates artifacts |
| Mitigation | Record + reducer dispose | Heartbeat + poller + status | Metadata-only + 按需 Read |

A slice can pass G5 + G6 and still violate G7 — clean lifecycle, alive sub-agent, but the main LLM still gets 3MB of artifacts and silently truncates. All three rules must pass.
