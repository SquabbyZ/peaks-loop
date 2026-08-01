# Mac auto-compact — verify + escape hatch

> Status: fixed in peaks-loop 4.0.4+ (commits 22debcb, fa98502)
> Auto-fire closed in 4.0.4.x (slice 2026-07-31-rid-mac-transcript-estimate-trigger).
> Audience: Mac Claude Code users where auto-compact silently fails.

## TL;DR

On peaks-loop 4.0.4.x+, the auto-compact orchestrator now fires
**automatically** from the transcript-estimate source on Mac. No manual
override needed.

Verify your install:

```bash
peaks code context-now --project . --json
# Expected: source: "transcript-estimate", ratio: 0.86 (when your
# transcript is ~222.5KB), action: "auto-compact-now"
```

If you are on an older version that still returns `ratio: 0`,
`source: "conservative-fallback"`, see [The escape hatch (--prompt-size)](#the-escape-hatch--prompt-size).

## Why Mac was broken

`CLAUDE_CONTEXT_USAGE_PERCENT` (the env var Claude Code Windows injects into
PreToolUse hook sub-shells) is not propagated to hook sub-shells on the Mac
Claude Code build. The `~/.claude/statusline-state.json` poll path is also
absent on most Mac installs. Combined with a flat `readdirSync` that could not
find Claude Code's nested transcript jsonl, peaks-loop's `readContextPercent`
returned `ratio: 0` and the auto-compact orchestrator stayed in the `none`
zone.

Verified locally: `echo $CLAUDE_CONTEXT_USAGE_PERCENT` is empty inside Bash
tool sub-shells even when the main `/context` slash command shows 199% (that
runs in-process, not via env injection).

## How auto-fire works now

On 4.0.4.x the orchestrator's `evaluateAutoCompactDecision` carries a
1-line source-tag-aware carve-out: when `source === 'transcript-estimate'`
(the only signal Mac exposes) and `ratio >= 0.85`, the verdict is
`shouldCompact: true, reason: 'pre-compact'`. This is the auto-fire
half of the B-route closure — no user intervention required when your
transcript crosses ~222.5KB (256KB ≈ 100%).

## How to verify the fix

```bash
# After peaks-loop 4.0.4.x install:
peaks code context-now --project . --json
```

Expected: `source: "transcript-estimate"` (not `conservative-fallback`) when a
transcript exists; `source: "user-overridden"` if you used `--prompt-size`.

## The escape hatch (--prompt-size)

If the auto-compact pathway is still silent on your Mac (for example, you have
no transcript jsonl yet), pipe your real context bytes in:

```bash
# Rough: count your conversation JSONL bytes
ls -l ~/.claude/projects/*/<sessionId>.jsonl | awk '{print $5}'

# Then:
peaks code context-now --project . --prompt-size <bytes> --json
```

When `bytes / 262144 >= 0.85`, `action: "auto-compact-now"` fires. When `<
0.85`, the envelope reports `action: "ok"` or `"soft-warn"`.

The Mac Claude Code team has not yet fixed the env-var injection, so
`--prompt-size` is the recommended workaround until they ship a fix upstream.
On 4.0.4.x the same threshold auto-fires without `--prompt-size` as long as
a transcript is present.

## Hook integration

If you maintain a custom PreToolUse hook that calls
`peaks code context-now`, set `PEAKS_PROMPT_SIZE_BYTES` in the hook environment
or pass `--prompt-size` directly. The CLI's `promptSizeBytes` P0 short-circuit
means the user override always wins over the (missing) env var.

## Caveats

- The 0.85 boundary is exact (`>=`). 222822 bytes = 0.8499984741... →
  advisory mode `soft-warn`. In Job mode (`job-shape.json isJob=true`) it
  becomes `auto-compact-now`.
- The 256KB ≈ 100% approximation is a token-vs-byte approximation: 256KB of
  raw JSONL bytes does NOT equal 256K tokens (Opus 4.1 is 200K tokens ≈ 800KB
  jsonl). On Mac, where only the byte count is observable, the carve-out will
  trigger earlier than the env-driven path on Windows/Linux. The
  carve-out documents the approximation; a token-accurate Mac signal (statusline
  state, system prompt probe) would supersede it once Claude Code ships one.
- `peaks -v` should be ≥ 4.0.4.x. 4.0.4 (without the `.x`) keeps the manual
  `--prompt-size` escape hatch but does NOT auto-fire on
  `source: 'transcript-estimate'` alone.

## Related

- [peaks-loop-mac-auto-compact-no-env-injection](../.peaks/memory/2026-07-31-mac-auto-compact-no-env-injection.md)
- [peaks-loop-mac-auto-compact-esm-fake-green-and-fix](../.peaks/memory/2026-07-31-mac-auto-compact-esm-fake-green-and-fix.md)
