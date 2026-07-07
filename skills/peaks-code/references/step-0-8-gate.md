# Peaks-Loop Code — Step 0.8 (v3.1.1 + v3.1.2) Gate Deep-Dive

> Read alongside `SKILL.md` Step 0.8. The SKILL.md header is the LOCKED CONTRACT; this file is the mechanics.

## Recorder contract (`peaks code detect-job`)

The CLI does NOT judge whether the request is Job-shaped — that is the LLM's job. Keyword regexes are wrong here (too brittle, miss natural-language variants, shift the LLM's semantic understanding into code). The CLI is a **recorder and gate**: the LLM makes the judgement, writes it via `peaks code detect-job`, and downstream steps refuse to proceed until the decision file exists.

### LLM judgement criteria (read once, then call the recorder)

- N parallel targets (`app/components/*`, `app/modules/*`, `for each subdir`, "以目录为维度", "把剩下的也跑了").
- Completion phrase implying batch continuation (`until all done`, "继续执行下个 slice", "全部添加完", "all of them").
- Cost / length disavowal (`不用考虑费用`, "don't worry about cost", "一直跑").
- Explicit slice count (`25 slices`, "切分成 N 段", "拆成 N 块").

### Action sequence

1. LLM reads the user prompt and applies judgement → `isJob: boolean + rationale + suggestedJobId + suggestedStrategy + confidence`.
2. LLM calls `peaks code detect-job --is-job <bool> --rationale <text> --suggested-job-id <jid> --suggested-strategy <single|rotating> --confidence <high|medium|low> [--force]`.
3. CLI records to `.peaks/_runtime/<sessionId>/job-shape.json`.
4. If `isJob: true` → `peaks job init --job-id <jid> --slice-list <...> --main-loop-strategy <strategy> --rotate-every 3` (BEFORE Step 1).
5. Downstream steps (Step 1, Step 0.81, etc.) call `read-job-shape` to refuse if missing.

### Hard rule (v3.1.1 red-line #10)

LLM MUST NOT skip `peaks code detect-job` even when the trigger is obvious from context. If the next step's `read-job-shape` throws `JOB_SHAPE_NOT_DECIDED`, Code MUST record a decision before proceeding. Keyword-based "I already know it's a Job" is not a substitute.

## v3.1.2 mechanical gates

The recorder-only design was bypassed twice under load; the gate must be un-bypassable.

### 1. PreToolUse hook — `peaks code gate-step-08`

`peaks workspace init` installs the `Bash` matcher `peaks code gate-step-08 --project .` in `.claude/settings.local.json` (alongside the existing Write|Edit|MultiEdit matcher). The hook runs before every Bash call:

| Condition | Exit | Behaviour |
|---|---|---|
| `job-shape.json` exists | 0 (allow) | allow + emit decision; if `progress.json` exists, add `Next: slice #N+1 of M (<currentSlice>)` |
| `job-shape.json` missing AND prompt matches the fail-closed backup regex | 2 (BLOCKED) | LLM must call `peaks code detect-job` before retrying |
| `job-shape.json` missing AND no regex match | 0 (allow) | allow, no Job trigger |

### 2. Size-fear ban — `peaks code emit-handoff`

Refuses to emit a final handoff while `remaining > 0` under Job mode. Pass `--force-under-job` only with explicit user approval.

### 3. Forced auto-compact — `--enforce-job-mode`

`peaks code context-now --enforce-job-mode` (auto-enabled when `job-shape.json` says `isJob=true`) returns `action: 'auto-compact-now'` at ≥ 0.85; Code MUST call `peaks session auto-compact --execute` without confirmation.

### 4. On-disk slice progress — `progress.json`

`peaks job checkpoint --state done` writes `progress.json`. `peaks job progress --job-id <jid> [--allow-missing]` is the canonical reader; `peaks code gate-step-08` also surfaces it on every Bash call so the LLM cannot "wake up cold".

## Backup regex rationale

The fail-closed backup regex (mentioned above) exists so the gate has defense in depth: even if the recorder's downstream enforcement is bypassed, the hook catches obvious Job-shaped prompts. The regex is intentionally narrow — it MUST miss benign prompts and MUST hit obvious batches — so the LLM-side judgement remains primary.

## Hook wiring

`peaks workspace init` writes both matchers (Bash + Write|Edit|MultiEdit) atomically; if either fails the whole init fails. `peaks workspace init --remove-hooks` reverses both. The Bash matcher is required for Step 0.8; the Write|Edit|MultiEdit matcher pre-existed (Step 0 [Fact-Forcing Gate]).
