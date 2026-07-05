---
name: memory-search-y2-rerank-2026-06-19-decision
description: Slice Z-A LLM rerank spike decision — NO-GO. The L2 (fuzzy + rerank + headroom) pipeline averages -48.2% savings vs the recall-equivalent baseline at the current 68-memory corpus size; rerank upstream cost is not recovered. Stay on fuzzy + headroom (L1). Revisit when corpus grows >5x or a free/local LLM becomes available.
metadata:
  type: decision
  sourceArtifact: src/services/memory/llm-reranker.ts
  createdAt: 2026-06-19
  supersededBy: null
  supersedes: null
---

# Slice Z-A — LLM Rerank Spike Decision

**Date:** 2026-06-19
**Verdict:** ❌ **NO-GO**
**Decision owner:** peaks-code (inline-assisted, peaks-rd mode)
**Locked status:** This decision **supersedes** the GO bias in the original 2026-06-18 proposal (`.peaks/memory/2026-06-18-peaks-zvec-spike-proposal.md`).

## TL;DR

Z-A spike ran the proposed L2 pipeline (fuzzy top-10 → LLM rerank → top-5 + headroom) against 9 representative peaks-loop queries on the actual 68-memory corpus. Aggregate L2-vs-L1W savings: **-48.2%** (i.e. L2 costs **48% MORE** tokens than the recall-equivalent baseline). Threshold was ≥20% savings. Verdict: **NO-GO**.

**Action:** Do NOT proceed to Z-B. Stay on the current L1 (fuzzy + headroom) path. Defer LLM rerank integration until either (a) memory corpus grows >5x (≈350 entries) so the L1W baseline gets large enough to amortize the rerank input cost, or (b) a free / local LLM becomes available so the rerank call cost approaches zero.

## What Was Built (Spike Artifacts)

| Artifact | Lines | Purpose |
|---|---|---|
| `src/services/memory/llm-reranker.ts` | 374 | `rerank()` service with chat-function injection, fail-open fallbacks (parse-fail / chat-fail / timeout), pure `renderRerankPrompt` + `parseRerankResponse` |
| `tests/unit/memory/llm-reranker.test.ts` | ~190 | 22 unit tests covering happy path, parse edge cases, timeout, chat-fail, duplicate indices, top-N cap |
| `scripts/bench/memory-search-token-cost.mjs` | ~280 | Self-contained benchmark; 4 pipelines × 10 queries × 68 memories; emits markdown report |

All artifacts are within the 800-line file cap. 22/22 unit tests pass. Zero new npm deps. Zero new API keys. Zero new IDE integration code (the chat injection interface is a deliberate abstraction — see "Z-B prerequisites" below).

## Measurement (AC-ZA-5, the gating AC)

**Corpus:** 68 memories from `.peaks/memory/*.md` (peaks-loop's own project memory).
**Queries:** 10 representative peaks-loop keywords (idempotency, sub-agent context, audit decision, headroom compression, red line rule, workspace underscore, ide adapter, gitignore peaks, rerank LLM, skill first CLI).
**Token heuristic:** 1 token ≈ 4 bytes (matches `headroom-client.ts:60`).
**Headroom mode:** balanced (0.40 ratio, per `headroom-client.ts:104-106`).
**Real LLM call:** None. Substring overlap is used as a conservative proxy for both fuzzy relevance and LLM rerank quality — see Caveat 1.

### Per-Query Token Cost

| Query | L1 (fuzzy top-5 + headroom) | L1W (fuzzy top-15 + headroom) | L2 (rerank top-5 + headroom) | L3 (rerank top-5, no headroom) | L2 vs L1W savings |
|-------|------:|------:|------:|------:|------:|
| `idempotency` | 0 | 0 | 80 | 80 | n/a (L1W=0) |
| `sub-agent context` | 273 | 453 | 676 | 598 | **-49.2%** |
| `audit decision` | 222 | 222 | 461 | 397 | **-107.7%** |
| `headroom compression` | 156 | 156 | 347 | 302 | **-122.4%** |
| `red line rule` | 325 | 1102 | 869 | 776 | **+21.1%** ✓ |
| `workspace underscore` | 241 | 241 | 493 | 424 | **-104.6%** |
| `ide adapter` | 264 | 751 | 737 | 661 | **+1.9%** |
| `gitignore peaks` | 567 | 1246 | 1284 | 1122 | **-3.0%** |
| `rerank LLM` | 418 | 418 | 797 | 677 | **-90.7%** |
| `skill first CLI` | 296 | 1059 | 842 | 757 | **+20.5%** ✓ |

### Aggregate

- Queries measured: **9 of 10** (degenerate zero-hit query `idempotency` excluded)
- **Average L2 vs L1W savings: -48.2%**
- Threshold (AC-ZA-5): ≥ 20%
- **Verdict: NO-GO** ❌

## Why L2 Loses at This Corpus Size

The rerank call has a fixed cost floor of ~80 tokens (RERANK_PROMPT_OVERHEAD_TOKENS=30 + RERANK_RESPONSE_TOKENS=50) plus the per-candidate input (~20-50 tokens each, top-10 = 200-500 tokens). Total per-call cost: ~300-600 tokens.

For L2 to save ≥20% vs L1W, the downstream savings from sending top-5 vs top-15 candidates through headroom must exceed this overhead. Headroom's balanced ratio is 0.40, so the downstream savings are 60% of (L1W_downstream - L2_downstream) tokens. At 68 memories with avg description ~80 chars, top-15 ≈ 1100 tokens → headroom saves 660 tokens vs top-5 ≈ 325 tokens → headroom saves 195 tokens. Net L2 overhead ≈ 600 - 195 = ~+400 tokens. **L2 is 400 tokens MORE than L1W at this corpus size.**

To break even, the L1W downstream would need to be ~1000+ tokens AND the per-call rerank cost would need to be <~200 tokens. Both require either:
- Corpus growth (more candidates → larger top-15 → more headroom savings)
- Cheaper rerank (free / local LLM)

## Caveats (read before contesting the verdict)

1. **No real LLM call.** The benchmark uses substring overlap as a proxy for both fuzzy relevance and LLM rerank quality. A real LLM would likely **improve L2** by re-ranking more aggressively on semantic queries (e.g. "idempotency" which substring-misses completely). But the substring proxy is *conservative* for L2 — even with conservative proxy, L2 still loses. A real LLM wouldn't flip the verdict from NO-GO to GO; it would only narrow the gap.
2. **Headroom ratio is approximate.** The 0.40 ratio is the SDK target; real headroom output varies with prompt structure.
3. **Token heuristic is 4-bytes-per-token.** Matches peaks-loop's existing approximation. Undercounts CJK content (Chinese text is denser per byte), so L2's negative savings are likely understated for CJK-heavy corpora.
4. **`Idempotency` query shows L1W=0.** No fuzzy hits at all → L2 still pays rerank cost → "infinite loss" relative to L1W. Excluded from the aggregate. In a real peaks-loop session, a query with zero fuzzy hits would also be a sign to the LLM that it has nothing to rerank — the fail-open `skipped-no-chat-fn` path already handles this.

## Erratum: RERANK_PROMPT_OVERHEAD_TOKENS Underestimates L2 Cost (Audit R4 Finding)

**Discovered in the 5-round audit (2026-06-19, post-decision):** the benchmark originally used `RERANK_PROMPT_OVERHEAD_TOKENS = 30` for the fixed prompt preamble, but the actual `renderRerankPrompt()` preamble ("Query: ...", instruction line, "Candidates:" header) measures **56 tokens** at 4-bytes-per-token (223 bytes measured directly). The benchmark therefore underestimated L2's input cost by **26 tokens per call**.

**Fix applied:** `RERANK_PROMPT_OVERHEAD_TOKENS` raised from 30 → 56 in `scripts/bench/memory-search-token-cost.mjs`. Re-ran the benchmark with the same query set.

**Corrected per-query numbers (post-fix, corpus=69 memories):**

| Query | L1W | L2 | Reported savings (pre-fix) | Corrected savings (post-fix) |
|---|---:|---:|---:|---:|
| `idempotency` | 0 | 106 | n/a (L1W=0) | n/a (L1W=0) |
| `sub-agent context` | 453 | 702 | -49.2% | **-55.0%** |
| `audit decision` | 352 | 710 | -107.7% | **-101.7%** |
| `headroom compression` | 286 | 596 | -122.4% | **-108.4%** |
| `red line rule` | 1028 | 1011 | +21.1% ✓ | **+1.7% ✗** (now BELOW 20% threshold) |
| `workspace underscore` | 241 | 519 | -104.6% | **-115.4%** |
| `ide adapter` | 751 | 763 | +1.9% | **-1.6%** (now negative) |
| `gitignore peaks` | 1246 | 1310 | -3.0% | **-5.1%** |
| `rerank LLM` | 548 | 979 | -90.7% | **-78.6%** |
| `skill first CLI` | 1059 | 868 | +20.5% ✓ | **+18.0% ✗** (now BELOW 20% threshold) |

**Aggregate (post-fix):** -49.6% (was -48.2% reported initially — slightly worse, not the -56.2% my hand-calc predicted, because the per-query L1W values shifted with corpus growth from 68 to 69 memories).

**Bottom line:** The NO-GO verdict is **strengthened, not weakened** by the preamble correction. The two queries that were barely above the 20% threshold (`red line rule` at +21.1% and `skill first CLI` at +20.5%) now drop well below it (+1.7% and +18.0% respectively). With the corrected preamble, **zero of the 9 comparable queries clear the 20% savings threshold** — the verdict is unanimous NO-GO.

**Additional bias (in the same direction, not corrected yet — flagged for Z-B if NO-GO is overturned):** the benchmark uses `${name}: ${description}` for the per-candidate token sum, but the actual `renderRerankPrompt()` uses `${name} — ${description (truncated 240)}` (em-dash, 3 bytes vs colon 1 byte) plus a `[i]` prefix. Including this correction would push the aggregate to roughly **-55 to -60%**. NO-GO is robust under both bias directions — the gap is wide enough that no plausible bias direction flips the verdict.

## AC Status (Z-A Proposal)

| AC | Status | Notes |
|---|---|---|
| AC-ZA-1 (zero new deps) | ✅ | 0 new npm packages. Verified by `package.json` diff (empty). |
| AC-ZA-2 (IDE chat smoke) | ⚠️ partial | Mock chat injection interface designed. **Real chat wiring is a Z-B prerequisite — see below.** |
| AC-ZA-3 (LLMReranker impl) | ✅ | 374 lines, 22 unit tests pass. |
| AC-ZA-4 (full pipeline) | ⚠️ partial | Mock LLM end-to-end works. Real LLM end-to-end blocked on Z-B chat wiring. |
| **AC-ZA-5 (token measurement)** | ❌ **NO-GO** | Average -48.2% savings (need ≥20%). See table above. |
| AC-ZA-6 (cache layer) | ⏭️ skipped | YAGNI per proposal — only build if AC-ZA-5 GO. Skipped. |
| AC-ZA-7 (Apache NOTICE) | N/A | Zero new deps, no NOTICE obligation. |
| AC-ZA-8 (fail-open fallbacks) | ✅ | Three-tier (no chat fn / chat fail / parse fail) tested in unit tests. |
| AC-ZA-9 (skill-driven orchestration) | ⏭️ deferred | Z-B scope. SKILL.md edits pending Z-B GO. |
| AC-ZA-10 (multi-skill helper) | ⏭️ deferred | Z-B scope. |

**Verdict per the proposal's GO/NO-GO matrix:** Z-A in NO-GO because AC-ZA-5 fails. Per the proposal: "任意不满足 → NO-GO — 写 memory `memory-search-y2-rerank-2026-06-19-no-go.md` 记录失败原因 + 测量数据 — ship 现状（fuzzy only），DEFER Y2 rerank 集成".

## Z-B Prerequisites (Only If NO-GO Is Overturned Later)

If the corpus grows >5x OR a free / local LLM becomes available, Z-B would need to address the **`IdeAdapter.chat()` gap** that Z-A surfaced:

- **Current state:** `IdeAdapter` interface (`src/services/ide/ide-types.ts:48-110`) has NO `chat()` method. `SubAgentDispatcher` (`src/services/dispatch/sub-agent-dispatcher.ts:76-112`) returns IDE-private tool-call descriptors for *sub-agent dispatch*, not direct chat.
- **Original proposal's claim:** "复用 `SubAgentDispatcher` 已有的 chat 通道". **This claim is wrong** — there is no chat channel in SubAgentDispatcher. Z-A's `rerank()` takes a `RerankChatFn` injection specifically to keep the spike honest about this gap.
- **Two ways to close the gap for Z-B:**
  1. **Add `chat(): Promise<string>` to `IdeAdapter`** — cleanest, but requires touching all 5 IDE adapter implementations (claude-code, trae, codex, cursor, hermes, openclaw). Probably the right call.
  2. **Route the rerank through `SubAgentDispatcher` with a `rerank` role** — heavier (dispatches a sub-agent just to ask the LLM a question), but reuses existing infrastructure. May double the per-call cost.
- **Both require real dogfood** — Z-B cannot close this gap via mocks alone.

## Why We Keep the Spike Artifacts (Not Delete)

Per the proposal's NO-GO flow: "ship 现状（fuzzy only），DEFER Y2 rerank 集成 — 不动 `memory-search-service.ts`". The spike artifacts are kept because:

1. **The `LLMReranker` service is good code.** It has clean fail-open fallbacks, a testable chat injection, and 22 passing tests. If a future LLM becomes available, Z-B can pick it up directly.
2. **The benchmark is a reusable tool.** When the corpus grows or a new LLM is integrated, re-running `node scripts/bench/memory-search-token-cost.mjs` against the new state is the gating check for the Z-B GO/NO-GO decision.
3. **The decision rationale is durable.** This memory is the canonical record of why LLM rerank was deferred. Future agents / sessions reading `.peaks/memory/` will see this and not re-litigate.

## Cross-References

- Original proposal: `.peaks/memory/2026-06-18-peaks-zvec-spike-proposal.md` (now partially superseded — see "Locked Decisions" caveat above)
- `src/services/memory/llm-reranker.ts` — spike implementation
- `src/services/memory/memory-search-service.ts` — fuzzy backend (unchanged, per proposal red line)
- `src/services/context/headroom-client.ts:60` — BYTES_PER_TOKEN = 4 (used by both rerank + benchmark)
- `src/services/ide/ide-types.ts:48-110` — `IdeAdapter` interface (the chat() gap)
- `src/services/dispatch/sub-agent-dispatcher.ts:76-112` — `SubAgentDispatcher` (no chat channel)
- `scripts/bench/memory-search-token-cost.mjs` — re-runnable benchmark
- `tests/unit/memory/llm-reranker.test.ts` — 22 unit tests for the spike service
