# Peaks Hooks — Output Contract & Audit

**Status:** canonical (slice 003-2026-06-16-hook-governance)
**Audience:** peaks-loop maintainers, hook authors, integrators
**Source of truth:** `src/services/hooks/output.ts` (TypeScript); this doc is the human-readable mirror. When the two diverge, the code wins; open a PR to update the doc.

This doc is the single source of truth for the peaks hook output contract.
Every peak-managed hook command MUST follow the contract; every direct
`io.stdout` / `io.stderr` / `process.stdout.write` in a hook command entry
point MUST go through one of the three helpers in
`src/services/hooks/output.ts` (enforced by code review per AC2).

---

## 1. Exit-code semantics

| Exit code | Meaning                                                              | Caller action |
|----------:|----------------------------------------------------------------------|---------------|
| `0`       | **Allow** — host proceeds with the tool call (default).              | Normal.       |
| `2`       | **Block** — host MUST prevent the tool call. `emitBlock` sets this.  | Refuse.       |
| Other     | **Hook error** — host treats as `PreToolUse:Bash hook error` noise.  | Log + allow.  |

`emitBlock` is the only helper that sets a non-zero `process.exitCode`
(currently `2`; see `HOOK_BLOCK_EXIT_CODE`). `emitHint` and `emitDecision`
leave `process.exitCode` alone — the host reads the decision from stdout.

### Why exit-2 matters (Fact-Forcing Gate)

The Claude Code permission system reads `permissionDecision: "deny"` from
the stdout JSON BEFORE its own permission prompts. Setting `process.exitCode = 2`
is the "hard block" fallback for IDEs that don't parse stdout. The previous
"PreToolUse:Bash hook error" rendering was caused by a hook that emitted a
deny decision via exit-code WITHOUT the stdout JSON envelope, so Claude Code
interpreted the failure as a hook error rather than a deliberate block.

---

## 2. stdout / stderr discipline

| Stream  | What goes here                                                          | What MUST NOT go here |
|---------|-------------------------------------------------------------------------|-----------------------|
| stdout  | The decision JSON (allow with `""`, or deny with the `hookSpecificOutput` envelope). Read by the host as the decision signal. | Debug text, log lines, warnings. Anything non-JSON on stdout is a malformed decision. |
| stderr  | Hints, warnings, error diagnostics, the reason a block was issued.       | The decision JSON. The host never reads stderr for the decision. |

The helpers enforce this:
- `emitHint` writes to `io.stderr` only.
- `emitBlock` writes the deny JSON to `io.stdout` AND surfaces the reason to `io.stderr`.
- `emitDecision` writes the (pre-shaped) decision JSON to `io.stdout` only.

### Trailing newline

Every emission ends with `\n` so the host's line-buffered CLI does not
glue the next emission onto the current line. The helpers append `\n`
when the caller omits it; double-newline is collapsed to a single.

---

## 3. JSON decision mode

Claude Code and Trae use the same envelope shape; only `hookEventName` differs:

```jsonc
// Claude Code
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Blocked by Peaks gate: ..."
  }
}

// Trae
{
  "hookSpecificOutput": {
    "hookEventName": "beforeToolCall",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Blocked by Peaks gate: ..."
  }
}
```

`emitBlock` always emits the Claude-Code shape (canonical contract).
`emitDecision` accepts a caller-built object so per-IDE dispatch via
`formatDecisionResponse(ide, ...)` keeps the adapter-specific `hookEventName`.

Escape discipline: `JSON.stringify` is the canonical escape; the helpers
rely on it for `permissionDecisionReason`. Never use string concatenation
or template literals to build the decision JSON; that's the path back to
the [Fact-Forcing Gate] noise.

---

## 4. Cross-platform behavior

The contract is **platform-independent** by design:
- The helpers write to `ProgramIO.stdout` / `ProgramIO.stderr` only.
- No path separators, no shell escaping, no line-ending variants.
- On win32, Node's `process.stdout` / `process.stderr` are UTF-8 and binary-safe.
  The contract uses `\n` (LF), not `\r\n`.

The cross-platform test (`tests/unit/hooks/contract.test.ts`) mocks
`process.platform` to `darwin` / `linux` / `win32` and asserts that the
deny JSON bytes are byte-for-byte identical on all three. A future
regression that introduces `\r\n` or a path leak will fail this test
on the affected platform.

### Windows shell quoting (memory: `windows-shell-quoting-divergence`)

When a Windows test wants to exercise the actual `peaks` hook command,
prefer `peaks ...` from a Bash tool whose escaping matches Node spawn
(Git Bash or PowerShell) over hand-constructed `cmd //c "..."` strings.
The hook runs via Node `child_process.spawn`, so the test should match
that spawn shape, not the shell that wraps it.

---

## 5. Test seam: `PEAKS_HOOK_STDIN`

The `PEAKS_HOOK_STDIN` environment variable is the test seam for stdin
(memory: `peaks-hook-stdin-test-seam-pattern`). When set, the hook
command reads the env-var value as the stdin payload instead of
reading `process.stdin`. Production runs never set this var.

```ts
// gate-commands.ts / hook-handle.ts
const override = process.env.PEAKS_HOOK_STDIN;
if (override !== undefined) return override;
// else: read process.stdin ...
```

Tests inject a JSON payload via env without hanging on real stdin:

```ts
const result = await runCommand(['gate', 'enforce'], {
  PEAKS_HOOK_STDIN: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push' } })
});
```

DO NOT add a `NODE_ENV` guard — the seam is reachable from any process
env, but the payload still routes through `enforceBashCommand` SOP gate,
so practical impact is bounded (security-review M-1).

---

## 6. Hook command audit table

Every peak-managed hook entry the user might install. Each row covers:
**Purpose** (what the hook does), **Owner** (the source file that
defines the command and its output contract), **Trigger** (when the
host invokes it), **Output** (what the hook writes to stdout/stderr and
the exit code), and **Test coverage** (the unit / integration test that
pins the contract).

| Command                                              | Matchers (in `.claude/settings.json` / Trae) | Owner                                                | Trigger                  | Output                                              | Test coverage                                                  |
|------------------------------------------------------|----------------------------------------------|------------------------------------------------------|--------------------------|-----------------------------------------------------|----------------------------------------------------------------|
| `peaks gate enforce --project "${CLAUDE_PROJECT_DIR}"` | `PreToolUse` `Bash`                          | `src/cli/commands/gate-commands.ts` (claude-code)    | every Bash call          | `emitBlock` deny JSON on stdout, exit=2; `emitHint` on stderr for warnings / debug envelope | `tests/unit/gate-commands.test.ts` (10 tests) + `tests/unit/hooks/contract.test.ts` (cross-platform) |
| `peaks hook handle --project ...`                    | `PreToolUse` (per-IDE `toolMatcher`); Trae uses `beforeToolCall` event name | `src/cli/commands/hook-handle.ts`                   | per-IDE hook event       | `emitDecision` for the IDE-shaped envelope; `emitHint` for warnings / debug; `emitBlock` reserved for the no-root-pollution deny path | `tests/unit/hooks/output.test.ts` (12 tests) + `tests/unit/hooks/contract.test.ts` |
| `peaks code-gate --json` (`.claude/settings.json`, written by `peaks hooks install`) | `PreToolUse` `Edit\|Write\|MultiEdit`         | `src/cli/commands/code-gate-command.ts` → `src/services/hooks/pre-tool-code-gate.ts`; non-Node sibling `src/services/hooks/pre-tool-code-gate.sh` | every `Edit` / `Write` / `MultiEdit` call | `emitBlock` deny JSON + exit=2 on a hard-blocked path family; exit 0 (no decision) otherwise. Vendor-neutral: it reads the standard `{tool, input}` payload and never an IDE env var. | `tests/unit/services/hooks/code-gate.test.ts` + `tests/integration/hooks-install-preserves-workspace-init.test.ts` |
| ~~`node "…/services/hooks/write-gate.js"`~~ **RETIRED (TEMPLATE_VERSION 1.8.0, S10)** | ~~`PreToolUse` `Write\|Edit\|MultiEdit`~~ (`.claude/settings.local.json`) | was `src/services/hooks/write-gate.js`, emitted by `src/services/workspace/claude-settings-template.ts`. The script and its install site are **deleted**; `mergeTemplateOwnedHooks` drops the entry from files an earlier release wrote. | was: every file write | **The abstention rationale is kept because it is WHY this was deleted and not repaired.** The handler always abstained: exit 0, no stdout/stderr, on every path. Never returned 2, and deliberately never returned any other non-zero code either — because in the Claude Code hook protocol only exit 2 blocks and only stderr of a blocking hook is surfaced to the model; any other non-zero exit is a NON-BLOCKING ERROR that the transcript reports as `hook error` / `Failed with non-blocking status code:` once per edit. The contract before it said "exit 1 = fall through to the gate" — there is no fall-through: all matching PreToolUse hooks run in parallel and their results merge (`deny` > `defer` > `ask` > `allow`), so abstaining neither approves the call nor suppresses a sibling's deny. Correct abstention, but an INSTALLED no-op — and installation was what made it wrong: it put a `node "C:/…/nvm/v24.14.0/…"` command in every consumer's file, pinned to whichever Node version directory the install resolved, plus a `shell: powershell` pin. The `.peaks/**` exemption this handler was originally written for is declared by the `env` block (`EXTERNAL_GATE_EXEMPT_ENV`) and is unaffected by the deletion. | was `tests/unit/workspace/write-gate-decision-table.test.ts`; retirement is pinned by `tests/unit/workspace/settings-local-hooks-entry-ownership.test.ts` |

### 6.1 Who owns which `.claude/` settings file (and how the two writers coexist)

`PreToolUse` entries for a Claude Code consumer come from **two writers writing
two different files**. Neither deletes the other's entries.

| File | Committed? | Writer | Owns |
|---|---|---|---|
| `.claude/settings.json` | yes (shared with the team) | `peaks hooks install` → `src/services/skills/hooks-settings-service.ts` | the peaks-managed entries whose `shell` is machine-independent, notably `peaks code-gate --json` on `Edit\|Write\|MultiEdit`. Merge is by **sentinel**: peaks-managed entries are stripped and re-emitted from `resolveHookEntries(ide)`; every non-peaks entry is preserved verbatim. |
| `.claude/settings.local.json` | no (gitignored, machine-local) | `peaks workspace init` → `src/services/workspace/workspace-claude-settings-materializer.ts`; second writer `installAutoCompactHook` | the two shell-pinned `Bash` entries (`peaks code gate-step-08`, `peaks gate enforce`) plus the `env` exemption block. Merge is **per entry**: the template owns the entries IT DECLARES and carries every other on-disk entry across verbatim (`mergeTemplateOwnedHooks`). |

Rules that keep them from fighting:

1. **A command belongs to the file whose `shell` it needs.** A handler that must
   be shell-pinned on Windows goes in the machine-local file — a `shell:
   "powershell"` entry in the committed file would break every macOS / Linux
   teammate, who has no `pwsh`.
2. **One matcher, one owner per file.** `Edit|Write|MultiEdit` is owned by the
   committed file (the code gate). The template emits no entry on that matcher
   — before S10 it emitted a second one, spelled `Write|Edit|MultiEdit`, i.e.
   the same regex in a different order and a duplicate gate on the same calls.
   That duplicate is what S10 removed. **If a future slice needs a second gate
   on this matcher, put it in `settings.json` (one writer), not here.**
3. **Matcher spelling is `Edit|Write|MultiEdit`** (alternation order is
   semantically inert, which is exactly why it drifted unnoticed). Any entry on
   that matcher is written by `peaks hooks install`; it reads the spelling from
   `HOOK_CODE_GATE_MATCHER` in `src/services/skills/hooks-codegate-superpowers.ts`.
4. **`peaks hooks install` does not refresh `.claude/settings.local.json`, and
   `peaks workspace init` does not refresh `.claude/settings.json`.** Only
   `peaks workspace init` converges a stale local file; nothing converges a
   stale installed template copy except `peaks upgrade --apply-init` (see
   `.peaks/docs/mac-auto-compact.md` and the generated-artifact stamp).

### Companion hooks (out of scope per NG5)

The companion (`peaks companion ...`) family has a separate contract
documented in `peaks-companion-*` memories (QR / notification wrappers).
The slice does not touch it.

### Global `.claude/settings.json` (best-effort enumeration per R1)

The global settings file lives at `~/.claude/settings.json`. If the user
has installed peaks hooks globally (`peaks hooks install --global`),
the same `peaks gate enforce` entry is injected there. The local
`peaks hooks status --global` command is the canonical enumerator.

---

## 7. How to add a new hook command

1. **Plan the contract.** Decide: is this a hint (diagnostic), a block
   (hard stop), or a decision (allow/deny JSON)?
2. **Use the helpers.** `emitHint(io, text)`, `emitBlock(io, reason)`,
   or `emitDecision(io, decision)`. Never call `io.stdout` /
   `io.stderr` / `process.stdout.write` directly in a hook command
   entry point.
3. **Add a TDD red test** in `tests/unit/hooks/output.test.ts` (or a
   new file under `tests/unit/hooks/`) that fails until your
   implementation lands.
4. **Add the cross-platform invariant test** to
   `tests/unit/hooks/contract.test.ts` for any new helper.
5. **Update the audit table** above (this doc) with the new row.
6. **Update the README "Hooks" section** with the user-facing contract.

Code review (per AC2): when a hook command diff appears, immediately
verify every emission goes through one of the three helpers. The grep:

```sh
git grep -nE 'io\.stdout|io\.stderr|process\.stdout\.write' src/cli/commands
```

should return only the helper implementation in `src/services/hooks/output.ts`.

---

## 8. Why this matters (PRD G1 motivation)

The original symptom: a Fact-Forcing Gate `[Fact-Forcing Gate]` line
rendered as `PreToolUse:Bash hook error` in the host UI. Root cause:
the gate hook was emitting a deny decision via exit-code only, with no
stdout JSON, so the host classified the non-zero exit as a hook error
instead of a deliberate block. The fix that worked for one hint (PRD
2026-06-16-fact-forcing-gate-format) is now generalised: every hook
command goes through the helpers, the contract is pinned in a
cross-platform test, and the audit table is the single place to look
up "what does this hook do?".
