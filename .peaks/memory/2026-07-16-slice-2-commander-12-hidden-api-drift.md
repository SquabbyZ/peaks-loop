---
name: 2026-07-16-slice-2-commander-12-hidden-api-drift
description: Commander 12.1.0 does NOT expose `.hidden()` as a chain method — use `program.command(name, { hidden: true })` constructor flag instead. Slice 2 of 4.0.0-beta.10 hit this; this sediment saves Slice 3 and future slices from re-debugging.
metadata:
  type: feedback
  driftId: D-007
  discoveredIn: slice-2-hide-role-skills
  discoveredAt: 2026-07-16
  sessionId: 2026-07-16-session-651c20
  targetRelease: 4.0.0-beta.10
---

# Slice 2 — Commander 12 `.hidden()` API drift (D-007)

## What we thought

PRD v3 §Slice 2 + RD tech-doc §1 all assumed `program.command('prd').hidden()`
chain method, on the Commander v11 / older patterns. Test
`tests/unit/workspace/top-level-change-id-guard.test.ts` was passing,
so the workspace-level flow was OK — but the API surface for hiding
commands was wrong.

## What actually happens

Commander 12.1.0 (the version peaks-loop 4.0.0-beta.10 pins) does NOT
expose `.hidden()` at runtime. Verified by:

```bash
node -e "const {Command} = require('commander'); console.log(typeof new Command().hidden)"
# → undefined
```

The first `pnpm build` after the implementer applied the `.hidden()`
chain failed with TS2339 (property `hidden` does not exist on type
`Command`). The fix is to pass `{ hidden: true }` as the second arg
to `.command()`:

```ts
// WRONG (Commander v11 idiom):
program.command('prd').hidden().description('...');

// RIGHT (Commander 12.1.0):
program.command('prd', { hidden: true }).description('...');
```

Applied across all 10 hidden CLI registrations at commit `a38a769`:
- `src/cli/commands/prd-commands.ts:68`
- `src/cli/commands/qa-commands.ts:293`
- `src/cli/commands/sc-commands.ts:8`
- `src/cli/commands/audit-commands.ts:124`
- `src/cli/commands/code-review-commands.ts:57`
- `src/cli/commands/perf-audit-commands.ts:82`
- `src/cli/commands/security-audit-commands.ts:83`
- `src/cli/commands/upgrade-commands.ts:41`
- `src/cli/commands/agent-commands.ts:40`
- `src/cli/commands/code-commands.ts:181`

(Note: `statusline-commands.ts:92` was pre-existing at commit a6e51987
from 2026-06-06, also using `{ hidden: true }` — confirming the API
shape has been stable since Commander 12 was adopted in peaks-loop.)

## Why this matters

Without this sediment, any future slice that wants to hide a
subcommand (e.g. Slice 3 `peaks ecc install` for non-LLM consumers,
or any LLM-internal subcommand) would:
1. Read RD tech-doc / PRD §Slice 2 → see `.hidden()` chain pattern.
2. Apply it.
3. `pnpm build` fails TS2339.
4. LLM asks user "should I use `{ hidden: true }` instead?" — wastes a
   turn AND violates Human-NL-Choice-Only tenet.

## How to apply

**When hiding ANY subcommand in peaks-loop (Commander 12.1.0):**
use the constructor flag `program.command(name, { hidden: true })`, NOT
the chain method `.hidden()`.

**When writing RD tech-doc / PRD for a future slice:**
the touchlist line should say `program.command('xxx', { hidden: true })`
not `program.command('xxx').hidden()`.

**Verification command** (paste into any session before recommending
a `.hidden()` chain):
```bash
node -e "const {Command} = require('commander'); console.log(typeof new Command().hidden)"
```
Expected: `undefined`. If it prints `function`, the Commander version
changed and the chain pattern may have come back — re-verify.

## Related sediment

- [[cli-cleanup-on-demand-ecc-design-2026-07-16]] — design contract for
  Slice 2/3 (RD assumed v11 `.hidden()` chain, this sediment corrects it)
- [[peaks-code-runbook-4-0-0-beta-10-skill-md-cli-d-004-d-005-d-006]] — sibling drift (sub-agent dispatch / job checkpoint / session title positional)
- [[2026-07-16-cli-surface-cleanup-slice-1-progress]] — Slice 1 bridge (no .hidden() involved)

## Slice 2 verdict impact

None — Slice 2 PASSES 8/8 AC because `{ hidden: true }` is
functionally equivalent to `.hidden()`. The deviation is documented,
the API shape is consistent across all 10 files, and the
`peaks --help` output empirically excludes the 10 names.