---
name: 2026-07-16-d-013-wrapper-exit-code-fixed
description: D-013 wrapper exit-code fix landed (commit 8145f01; 4.0.0-beta.12). `peaks <unknown>` and `peaks <unknown> --help` now exit 1 with COMMAND_NOT_FOUND JSON envelope. Real CLI + in-process test paths both verified. 287/287 tests pass.
metadata:
  type: project
  date: 2026-07-16
  sessionId: 2026-07-16-session-651c20
  targetRelease: 4.0.0-beta.12
  parentRelease: 4.0.0-beta.11
  driftStatus: RESOLVED
  driftSeverity: AC3.9/AC3.10 PASS-WITH-DEFERRED → PASS
---

# D-013 wrapper exit-code fix — RESOLVED (4.0.0-beta.12)

**Date:** 2026-07-16
**Session:** 2026-07-16-session-651c20
**Commit:** `8145f01` (fix(slice-d013): wrapper exit-code — peaks <unknown> and peaks <unknown> --help exit 1 + COMMAND_NOT_FOUND envelope)
**Target release:** `4.0.0-beta.12`
**Verdict:** ✅ **D-013 RESOLVED** (was PASS-WITH-DEFERRED in beta.11)

## What was wrong

`peaks <unknown>` and `peaks <unknown> --help` returned exit 0 with the help banner. Root cause: Commander's `.exitOverride()` was set on `program.ts:253` but the catch block in `src/cli/index.ts:12-15` swallowed `commander.helpDisplayed` exit codes. Additionally, the root `.action()` in `src/cli/program.ts:211` unconditionally printed the banner when no subcommand matched (including unknown commands), with no exit code adjustment.

## What changed

### `src/cli/program.ts` (root `.action()` body)

Added an early-return check at the start of the root `.action()`:
```ts
const firstNonOption = program.args.find((arg) => !arg.startsWith('-'));
if (firstNonOption !== undefined) {
  io.stdout(JSON.stringify({
    ok: false,
    command: 'cli',
    code: 'COMMAND_NOT_FOUND',
    message: `Unknown command: ${firstNonOption}. Run \`peaks --help\` for available commands.`,
    data: { argv: firstNonOption },
    warnings: [],
    nextActions: ['Run `peaks --help` to list available commands.']
  }, null, 2));
  process.exitCode = 1;
  return;
}
```

**Critical detail:** uses `program.args` (Commander's parsed argv), NOT `process.argv`. `process.argv` is the test runner's argv in vitest integration tests, which breaks the in-process test path. `program.args` is consistent across real CLI + in-process test paths.

### `src/cli/index.ts` (pre-check for help-short-circuit case)

Commander's `--help` short-circuit fires BEFORE `commander.unknownCommand` is thrown. So `peaks xxx --help` (where `xxx` is unknown) was routed to help text + exit 0, never reaching the unknownCommand catch. Added a `setImmediate` pre-check that scans `process.argv` for a positional token + `--help`/`-h` combination:
```ts
const argv = process.argv.slice(2);
const hasHelp = argv.some((arg) => arg === '--help' || arg === '-h');
const firstPositional = argv.find((arg) => !arg.startsWith('-'));
if (hasHelp && firstPositional !== undefined) {
  setImmediate(() => {
    console.error(JSON.stringify({
      ok: false,
      command: 'cli',
      code: 'COMMAND_NOT_FOUND',
      message: `Unknown command: ${firstPositional}. Run \`peaks --help\` for available commands.`,
      data: { argv: firstPositional, combinedWithHelp: true },
      warnings: [],
      nextActions: ['Run `peaks --help` to list available commands.']
    }, null, 2));
    process.exit(1);
  });
}
```

`setImmediate` is critical — Commander's help handler runs first (prints help text); we override AFTER. If the help handler called `process.exit(0)` synchronously, the `setImmediate` never fires, but in Commander 12 it does fire (help handler returns normally). Empirically verified.

### `src/cli/index.ts` (catch block — emit COMMAND_NOT_FOUND for unknownCommand/unknownOption)

The existing catch block set `process.exitCode = 1` but didn't emit a structured envelope. Added the JSON envelope for LLM-side consumers (Human-NL-Choice-Only compliance — don't tell the human to type a CLI verb, say what the LLM can coordinate).

### `tests/unit/cli/d-013-wrapper-exit-code.test.ts` (NEW)

5 regression cases:
- D-013.A: `peaks <unknown>` → exit 1 + envelope
- D-013.B: `peaks <deleted-cmd>` → exit 1 + envelope
- D-013.C: `peaks --help` → exit 0 (legitimate)
- D-013.D: `peaks --version` → exit 0
- D-013.E: bare `peaks` → exit 0 + banner

## Verification (ALL PASS)

| Path | Before | After |
|---|---|---|
| `peaks xxx` (real CLI) | exit 0 + banner | **exit 1** + COMMAND_NOT_FOUND envelope |
| `peaks xxx --help` (real CLI) | exit 0 + help text | **exit 1** + COMMAND_NOT_FOUND envelope |
| `peaks agent run foo` (real CLI) | exit 0 + banner | **exit 1** + COMMAND_NOT_FOUND envelope |
| `peaks agent --help` (real CLI) | exit 0 + help text | **exit 1** + COMMAND_NOT_FOUND envelope |
| `peaks help xxx` (real CLI) | exit 0 + help text | **exit 1** + COMMAND_NOT_FOUND envelope |
| `peaks --help` (real CLI) | exit 0 + help text | exit 0 + help text ✅ |
| `peaks --version` (real CLI) | exit 0 + version | exit 0 + version ✅ |
| `peaks` (bare, real CLI) | exit 0 + banner | exit 0 + banner ✅ |
| In-process `runCli(['agent', 'run', 'foo'])` | exit 0 + banner | **exit 1** + COMMAND_NOT_FOUND envelope |

Test counts:
- `tests/unit/cli/d-013-wrapper-exit-code.test.ts`: 5/5 PASS
- Full CLI regression suite (`tests/unit/cli/`): 287/287 PASS

## AC verdict update

| AC | Beta.11 | Beta.12 |
|---|---|---|
| AC3.9 `peaks agent run` exits non-zero | PASS-WITH-DEFERRED | **PASS** |
| AC3.10 `peaks agent list` exits non-zero | PASS-WITH-DEFERRED | **PASS** |

**Beta.12 AC total: 27/27 PASS** (25 prior + 2 D-013 fixed).

## Files changed (6)

```
M  src/cli/program.ts                     # root .action() pre-check (program.args)
M  src/cli/index.ts                       # pre-check (setImmediate) + catch envelope
M  tests/unit/cli/d-013-wrapper-exit-code.test.ts  # NEW (5 regression cases)
M  package.json                           # version: beta.11 → beta.12
M  src/shared/version.ts                  # CLI_VERSION regenerated
M  CHANGELOG.md                           # beta.12 entry
```

## Next gate

1. User runs `npm publish --tag beta --otp=<6位OTP码>` for 4.0.0-beta.12.
2. ice-cola user re-links: `cd ice-cola && pnpm approve-builds` (already done once for beta.11; should persist for beta.12).
3. Re-run 27-AC set in ice-cola; confirm 27/27 PASS (was 25/27 + 2 deferred in beta.11).

## Hard rules carried forward (17 total)

- D-002, D-005, D-007 through D-016 (unchanged).
- **D-013 RESOLVED** — was PASS-WITH-DEFERRED; now PASS.
- D-017 (Claude Code sub-agent display recycle) — observation only.

How to apply: any future slice that introduces a new exit-code contract MUST
test it under both the real CLI binary AND the in-process `runCli` helper,
because `process.argv` differs between the two. The fix uses `program.args`
to be robust to both.