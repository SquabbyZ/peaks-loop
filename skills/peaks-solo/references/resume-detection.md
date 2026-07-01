# Step 0.7 — Detect unfinished work and offer resume

> Body of `### Peaks-Loop Step 0.7`. After Step 0 has anchored the workspace and presence, before Step 1 mode selection, run the resume-detection probe. If the current session has in-flight slice artifacts, the user is most likely "continuing" — surface resume options instead of starting a fresh PRD.

**Why this is a separate step** (per `feedback_peaks_solo_natural_language_primary` — a high-frequency request shape, see also the user's "继续完成刚才为完成的" pattern from session `2026-06-04-session-b60252`): the LLM was previously re-reading 3-5 artifact files to determine workflow state, wasting 3-5k tokens per resume request. This step replaces that work with a single deterministic read.

**Detection logic** (all read-only, no side effects; uses only existing CLIs):

```bash
# 1. Confirm the current session id via the read-only CLI primitive
#    (the on-disk binding file is internal — never `cat` it directly)
sid=$(peaks session info --active --project "$(git rev-parse --show-toplevel)" --json | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['sessionId'])")

# 2. Enumerate the session's artifact tree (one `find` call, no new CLI)
find ".peaks/$sid/" -type f 2>/dev/null | sort

# 3. For each role request artifact present, read its `state:` field
#    (one-pass grep; only files that exist)
for f in .peaks/$sid/prd/requests/*.md .peaks/$sid/rd/requests/*.md .peaks/$sid/qa/requests/*.md; do
  [ -f "$f" ] && echo "$f: $(grep -m1 '^state:' "$f" | awk '{print $2}')"
done

# 4. Compute "deepest completed gate" by file-presence + state mapping
#    (see classification table below)
```

**Classification table** (file-presence + state → "deepest completed gate"):

| Files present | State | Deepest completed gate | Resume point (if any) |
|---|---|---|---|
| only `.peaks/$sid/.session.json` | (no slice) | (none) | fresh — skip to Step 1 |
| `prd/requests/<rid>.md` | `state: handed-off` | Gate B (swarm converged) | resume at Step 3 (swarm) — but if swarm already ran and produced `rd/tech-doc.md` / `qa/test-cases/<rid>.md`, drop to deepest |
| `rd/requests/<rid>.md` | `state: qa-handoff` | Gate C (RD done) | resume at Step 6 (QA validation) |
| `qa/requests/<rid>.md` | `state: verdict-issued` | Gate D (QA done) | resume at Step 10 (TXT handoff) |
| `txt/handoff.md` | (any) | Gate E (workflow complete) | this session is closed — user is starting new work |

**Other resume triggers** (file-presence, no state read needed):

| Missing file | Resume at |
|---|---|
| `rd/tech-doc.md` (for `feature`/`refactor`) or `rd/bug-analysis.md` (for `bugfix`) | Step 3b (RD planning) |
| `rd/code-review.md` or `rd/security-review.md` | Step 5 (RD review fan-out) |
| `rd/perf-baseline.md` (for `feature`/`refactor`) | Step 5 (perf baseline) |
| `qa/test-cases/<rid>.md` | Step 6 (QA test-case generation) |
| `qa/test-reports/<rid>.md` or `qa/security-findings.md` or `qa/performance-findings.md` | Step 6 (QA execution) |
| `txt/handoff.md` | Step 10 (TXT handoff) |

**AskUserQuestion** (only if a resume is detected; default option is "Resume from the deepest missing gate"):

| Option | What it does |
|---|---|
| Resume from `<gate>` (Recommended) | Skip ahead to the matching step, preserving all existing artifacts. The LLM does NOT re-read the existing artifacts — it trusts the classification and proceeds. |
| Start a fresh slice | Keep the workspace, treat the current user request as a new slice (new rid). Existing artifacts are preserved but not auto-resumed. |
| Abandon the in-flight slice | Mark the in-flight slice as `deferred` (`peaks request transition … --state deferred`); start a new one. |

**Hard rule: never silently auto-resume.** Resume detection is the discovery; AskUserQuestion is the confirmation. Even if the user's request is "继续完成刚才为完成的" (continue the unfinished work), the skill must run this detection, surface the options, and wait for user confirmation before skipping ahead.

**Hard rule: never auto-resume a slice that is mid-implementation.** Resume only when the deepest completed gate is in {B, C, D, E}. For mid-implementation states (RD `state: implemented`, RD `state: running`, RD `state: spec-locked`, QA `state: running`, QA `state: blocked`), the slice is still in flight — the only valid option is "Resume from in-flight gate" (the user must confirm).

**Strict quality guarantee (per user's hard rule: "严格要保证不能比当前的效果差")**:
- If no in-flight slice is detected, this step is a no-op: zero extra commands beyond the existing Step 0 probe, zero extra token cost.
- If an in-flight slice is detected, the cost is one `find` + one `grep` loop (sub-millisecond) + one `AskUserQuestion` (one round-trip). The savings are 3-5k tokens (the cost of manually re-reading 3-5 artifact files).
- The dogfood test in `tests/unit/skill-resume-mode.test.ts` (8 cases, bash-fixture shim — the legacy interface used by `skills/peaks-solo-resume`) and `tests/unit/services/skill/resume-detector.test.ts` (24 cases, the canonical TypeScript classifier at `src/services/skill/resume-detector.ts`) together cover: (a) fresh / complete / resume:rd-planning / resume:qa-validation / resume:txt-handoff state-based classifications, (b) the "Other resume triggers" overrides (missing `rd/tech-doc.md` → `rd-planning`; missing `rd/code-review.md` or `rd/security-review.md` → `rd-review-fanout`; missing `qa/test-reports/<rid>.md` → `qa-execution`), (c) the mid-implementation distinction (`spec-locked` / `implemented` / `running` / `blocked` all return `in-flight:<state>`), (d) the primary-vs-abandoned filter (multiple RDs → spec-locked wins; single blocked RD stays primary; 2+ all-abandoned → fresh), (e) the legacy `.peaks/_runtime/<sessionId>/` path fallback, and (f) determinism across two invocations on the same fixture.