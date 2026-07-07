# Step 0.55 — 1.x → 2.0 detection reference

> Body of `### Peaks-Loop Step 0.55`. Slice: 2026-06-12-code-step-0-55-1x-detection.

## Why this step exists

The peaks-loop 1.x → 2.0 closeout ships:

1. A postinstall that auto-detects 1.x state and dispatches the upgrade (slice 1, commit `b6e34e6`).
2. A standards-migrate path that thins `.claude/rules/**/*.md` and scaffolds `.peaks/standards/` (slice 2, commit `33dd392`).
3. **THIS STEP** — a peaks-code startup sequence probe that detects 1.x state when the user invokes `/peaks-code` directly in a 1.x consumer project, and prompts the user to upgrade.

The 1.x user experience is: "I just typed /peaks-code. Why is it not working in 2.0 mode?" Step 0.55 catches this case and surfaces an `AskUserQuestion` with a one-click upgrade.

## Detection algorithm

```bash
# 1. Read-only probe via the umbrella CLI
peaks upgrade --detect-1x --project <root> --json
```

The CLI returns:
```json
{
  "ok": true,
  "command": "upgrade.detect-1x",
  "data": {
    "isOneX": true,
    "signals": [
      "<path> has schema_version 1.0.0, expected '2.0.0'",
      "..."
    ],
    "projectRoot": "/path/to/project",
    "configPath": null
  },
  "warnings": [],
  "nextActions": [
    "Detected 1.x state. peaks-code Step 0.55 should present an AskUserQuestion to invoke `peaks upgrade --to 2.0 --auto --project /path/to/project`."
  ]
}
```

The detection logic mirrors `scripts/install-skills.mjs:detect1xProjectState` (canonical implementation) — it walks up to find `.peaks/_runtime/`, then sniffs:

1. `~/.peaks/config.json` for `version: 1.x`
2. `<projectRoot>/.claude/rules/common/dev-preference.md` for "peaks progress"
3. `<projectRoot>/.peaks/preferences.json` for missing or non-`2.0.0` `schema_version`

The TS mirror in `src/services/upgrade/1x-detector-service.ts` is the canonical entrypoint for the skill; the postinstall `.mjs` version is the canonical entrypoint for the npm-install flow. The two implementations MUST stay in parity (a parity test is in the slice's test suite).

## AskUserQuestion (only when `isOneX: true`)

| Option | What it does |
|---|---|
| Run `peaks upgrade --to 2.0 --auto --project <root>` (Recommended) | Invokes the umbrella. The user sees the 6 sub-step results in the terminal. After the upgrade, re-run peaks-code with the standing 2.0 layout. Persist `autoUpgradePrompt: opt-in` to `.peaks/preferences.json`. |
| Skip for this session | Continue with the standing 1.x layout. Persist `autoUpgradePrompt: skip-this-session` to `.peaks/preferences.json`. The next time the user invokes peaks-code in this project, the question re-asks. |
| Never ask again for this project | Persist `autoUpgradePrompt: skip-forever` to `.peaks/preferences.json`. Step 0.55 becomes a no-op for this project from now on. The user can re-enable later by removing the `autoUpgradePrompt` key from preferences.json. |

## Persistence contract

The decision is persisted via `peaks preferences set --project <root> --key autoUpgradePrompt --value <opt-in|skip-this-session|skip-forever> --apply`. Subsequent Step 0.55 invocations read the value first:

- If `opt-in` (and Step 0.55 is the first invocation in the session), the user has already opted in; auto-run the umbrella without re-asking.
- If `skip-this-session`, the user already said no this session; skip without re-asking (but re-ask next session).
- If `skip-forever`, the user said no permanently; skip without re-asking.
- If the key is absent, present the AskUserQuestion.

## What is NOT in this step

- The auto-upgrade execution itself: the umbrella is invoked via the AskUserQuestion's recommended option. The umbrella's behavior (6 sub-commands + write-upgrade-record) is documented in the umbrella's own help text.
- The postinstall auto-dispatch: that's `scripts/install-skills.mjs:autoUpgrade1xProjectIfPresent`, which fires fire-and-forget on `npm i -g peaks-loop@2.0`. Step 0.55 is the user-invoked path.
- Re-authoring the 1.x detector heuristics: the implementation is a 1:1 mirror of the canonical `.mjs` version. Drift is prevented by the parity test.

## How this integrates with the rest of the workflow

- Step 0.5 (OpenSpec opt-in) — runs first if `openspec/` is missing.
- Step 0 (anchor) — runs always.
- Step 0.7 (resume detection) — runs after Step 0.
- **Step 0.55 (1.x detection) — runs after Step 0.7, only when the project is not on a 2.0 layout.**
- Step 1 (mode selection) — runs after Step 0.55.

The 1.x detection is intentionally placed AFTER Step 0.7 because the user might already have a 1.x-converted in-flight slice; the resume flow takes precedence over the upgrade prompt.
