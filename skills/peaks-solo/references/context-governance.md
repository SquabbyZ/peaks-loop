# Context Governance — G7 + G7.7 + G8 + G9 protocol details

> Slice #010 (G7 + G7.7 + G8 + G9 context-governance push).
> See: `.peaks/memory/sub-agent-context-minimal-occupation.md` + `sub-agent-shared-channel-cross-completion.md` + `sub-agent-headroom-forced-compression-gate.md` for the red lines.

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
[peaks-solo] batch 3/3 done in 47.3s
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

## G7.7 — headroom-ai integration (opt-in)

### `--use-headroom` flag

Opt-in flag on `peaks sub-agent dispatch`. Default `false` (G7 metadata-only remains the default).

### Mode table

| Mode | tokenBudget | Use case |
|---|---|---|
| `balanced` (default) | promptSize * 0.40 / 4 | General sub-agent dispatch |
| `aggressive` | promptSize * 0.20 / 4 | Last-resort large prompt |
| `conservative` | promptSize * 0.70 / 4 | Sensitive code analysis |

### Failure mode (RL-22d / RL-32)

- headroom daemon dead / proxy unreachable / times out
- → `code: "HEADROOM_UNAVAILABLE"` warning + G7 metadata-only fallback
- → NOT blocking (warn, then continue dispatch)

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

| Threshold | Prompt size | Behavior |
|---|---|---|
| 50% (early warn) | ≥ 128KB | Soft warning, suggest `--use-headroom` |
| **75% (user red line)** | ≥ 192KB | Soft warn + mandatory suggest `--use-headroom`; `warnings: ["CONTEXT_NEAR_LIMIT"]` |
| **80% (hard reject)** | ≥ 204KB | Hard reject `code: "PROMPT_TOO_LARGE"`; `--force` allowed at CLI |
| 90% (emergency) | ≥ 230KB | Hard reject + `contextWarning: 'high'` |

### Two-layer enforcement (G9.2)

- **CLI 兜底** — `peaks sub-agent dispatch` validates prompt size; `--force` allowed.
- **PreToolUse hook** — `peaks sub-agent-dispatch-guard` re-validates; **NO `--force`** allowed at hook layer (RL-30 strict).

### `--force` semantics

- At CLI: `--force` allowed; emits `code: "FORCED_OVER_THRESHOLD"` warning + records `forcedAt: ISO8601`.
- At PreToolUse hook: `--force` is REJECTED (RL-30 strict). The hook's CLI does not declare a `--force` flag; the override path is physically not available.

## AC mapping

- AC-38..AC-43 (G7) + AC-44..AC-46 (G7.7) + AC-47..AC-49 (G8) + AC-50..AC-65 (G9)
- See PRD §Acceptance criteria.
