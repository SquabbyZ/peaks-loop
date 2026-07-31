# Mac auto-compact — verify + escape hatch

> Status: fixed in peaks-loop 4.0.4+ (commits 22debcb, fa98502)
> Audience: Mac Claude Code users where auto-compact silently fails.

## TL;DR

If your `peaks code context-now --json` returns `ratio: 0` and
`source: "conservative-fallback"` on Mac, you have two paths:

1. **Wait for auto-fix**: upgrade to peaks-loop 4.0.4+ — the transcript fallback
   now walks recursively and a new `user-overridden` source takes priority over
   the missing env var.
2. **Manual override (any version)**:
   `peaks code context-now --project . --prompt-size <N> --json`, where N is your
   current context-fill in bytes.

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

## How to verify the fix

```bash
# After peaks-loop 4.0.4 install:
peaks code context-now --project . --json
```

Expected: `source: "transcript-estimate"` (not `conservative-fallback`) when a
transcript exists, or `source: "user-overridden"` if you used `--prompt-size`.

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

## Hook integration

If you maintain a custom PreToolUse hook that calls
`peaks code context-now`, set `PEAKS_PROMPT_SIZE_BYTES` in the hook environment
or pass `--prompt-size` directly. The CLI's `promptSizeBytes` P0 short-circuit
means the user override always wins over the (missing) env var.

## Caveats

- The 0.85 boundary is exact (`>=`). 222822 bytes = 0.8499984741... →
  advisory mode `soft-warn`. In Job mode (`job-shape.json isJob=true`) it
  becomes `auto-compact-now`.
- `peaks -v` should be ≥ 4.0.4. Older versions will keep returning `ratio: 0`.

## Related

- [peaks-loop-mac-auto-compact-no-env-injection](../.peaks/memory/2026-07-31-mac-auto-compact-no-env-injection.md)
- [peaks-loop-mac-auto-compact-esm-fake-green-and-fix](../.peaks/memory/2026-07-31-mac-auto-compact-esm-fake-green-and-fix.md)
