# Statusline `Peaks o empty` Fix — Design

**Date:** 2026-08-04
**Status:** Approved design; implementation not started
**Author:** SquabbyZ (sole author; no `Co-Authored-By` trailer per project red rule)
**Supersedes:** none (root-cause brief lives at
`.peaks/_runtime/2026-08-03-session-1b6cf3/rd/requests/001-statusline-empty-fix-spec-plan.md`)
**Related:**
- Root-cause brief: `.peaks/_runtime/2026-08-03-session-1b6cf3/rd/requests/001-statusline-empty-fix-spec-plan.md`
- Companion implementation plan: `docs/superpowers/plans/2026-08-04-statusline-empty-fix.md`
- Data path docs: `src/services/skills/skill-statusline-service.ts:25-149`,
  `src/services/skills/skill-presence-service.ts:314-436`,
  `src/services/skills/hooks-settings-service.ts:82-311`,
  `skills/peaks-code/SKILL.md` (Step 0 prompt instruction),
  `CLAUDE.md:36` (presence guidance paragraph).

## Context

In the peaks-loop 4.0.8 project itself, the Claude Code status bar shows
`Peaks o empty → peaks-loop` instead of the expected
`Peaks ● peaks-code [full-auto] → peaks-loop`. Other peaks-loop consumer
projects render the active skill correctly.

The root-cause brief (linked above, §1) verified the data path: `peaks statusline`
is invoked by the IDE on every turn, reads `.peaks/_runtime/active-skill.json`,
and renders `${idle-glyph} empty` when `presence === null`. The peaks-loop project
itself **never** ran `peaks skill presence:set peaks-code`, so `active-skill.json`
does not exist. Other downstream projects render correctly only because some past
LLM session in those trees happened to run `peaks skill presence:set`, leaving the
marker on disk.

The current prompt-only instruction at `CLAUDE.md:36` ("read presence then show
status header") does **not** direct the LLM to *write* presence; neither does
`peaks-code/SKILL.md` Step 0. `peaks hooks install` installs only the
`PreToolUse Bash → peaks gate enforce` entry; the four internal `peaks hook handle`
enforcers (code-ban / gate-enforce / root-pollution / login-gate) and the
`presence-marker-detector` post-tool hook are **read-only** diagnostics, never
writers. `setSkillPresenceForCaller` (D6) only writes the per-caller file, not
the legacy marker. The reader at `skill-statusline-service.ts:82-112` still
prefers the legacy `.peaks/_runtime/active-skill.json` path.

Net: nothing on the system writes the legacy presence marker in response to a
fresh `/peaks-code` invocation unless the LLM itself runs the CLI verb. The fix
must make presence writes transparent to the LLM and survive project re-clones.

## Problem

A fresh clone of any peaks-loop project that runs `peaks hooks install` and then
invokes `/peaks-code` (or any peaks skill) renders the statusline as
`Peaks o empty` because `.peaks/_runtime/active-skill.json` is never written by
the harness. The defect is invisible in projects where some earlier session
happened to call `peaks skill presence:set`; it is reproducible in any freshly
cloned tree. The fix must:

1. Auto-populate the legacy marker from an IDE event that the LLM cannot bypass.
2. Stay transparent — must not change user-facing CLI output, statusline
   rendering rules, or the canonical 4.0.8 lease path (`presence-lease-service.ts`).
3. Stay surgical — at most one new file + one modified file in production code.
4. Stay harmless — must not introduce a new npm dependency and must not regress
   any of the existing 8 hooks-install integration tests.

## Goals

- **G1 — Auto-bootstrap presence.** A `UserPromptSubmit` hook (Claude Code) /
  `beforeSubmitPrompt` hook (Trae) writes the active skill marker from harness
  env vars (`PEAKS_OUTER_SESSION_ID` / `CLAUDE_CODE_SESSION_ID` /
  `PEAKS_PRESENCE_SKILL`) without any LLM action.
- **G2 — Idempotent + rate-limited.** The bootstrap fires at most once per
  5-minute window per `(sessionId, skill)` tuple to avoid fs thrash on every
  user prompt.
- **G3 — Idempotent install / uninstall.** `peaks hooks install` always writes
  the bootstrap entry alongside the gate-enforce entry. Existing hooks-install
  integration tests stay green (byte-level compatible after `--upgrade`).
- **G4 — Prompt-only override.** `CLAUDE.md` L36 + `peaks-code/SKILL.md` Step 0
  gain a one-line explicit instruction: "to override the auto-bootstrapped
  presence, run `peaks skill presence:set peaks-<role> --mode <m> --gate <g>`".
  This is a *secondary* channel — the LLM never has to do it.
- **G5 — No new npm dep.** Reuse the existing `peaks skill presence:set`
  subcommand (`src/cli/commands/core/skill-command.ts:197-263`) as the writer.
  No external packages introduced.
- **G6 — No canonical-lease drift.** Do **not** modify
  `src/services/skills/presence-lease-service.ts`. The bootstrap is a thin
  shim that calls into the existing `setSkillPresence` path; the lease
  canonical write still wins inside `setSkillPresence`.

## Non-Goals

- NG1 — Changing the `peaks statusline` renderer logic (`renderStatusLine`,
  `renderActive`, `renderIdle`).
- NG2 — Changing `presence-lease-service.ts` (canonical lease format / DR / D6).
- NG3 — A breaking change to `peaks hooks install` for users who already have
  the gate-enforce entry installed. The new `UserPromptSubmit` entry lands only
  via explicit `peaks hooks install --upgrade` opt-in for existing projects.
- NG4 — A new presence schema, a new presence file path, or a new presence
  renderer entry. The legacy `.peaks/_runtime/active-skill.json` marker is the
  target of the bootstrap write; it remains the source of truth for the
  statusline reader (with one-minor-release back-compat to
  `.peaks/.active-skill.json`).
- NG5 — Adjusting the 4.0.8 canonical lease / per-caller behaviour introduced in
  slice 020. Those paths are unchanged.
- NG6 — User-driven compaction prompts. The zero-pause contract
  (`peaks-code/SKILL.md` §Step N+2) is not touched.
- NG7 — Touching `peaks-code/SKILL.md` Step 0 mode-select flow or any user
  surface that surfaces a CLI verb.

## Two solution options + recommendation

### Option A — SKILL.md / CLAUDE.md 引导层修 (L1 prompt-only)

In `peaks-code/SKILL.md` Step 0, **prepend** a hard instruction before the
existing Step 0.5-0.87 sequence:

```text
LIFETIME GATE 0.0 (BLOCKING): every /peaks-code invocation MUST first invoke
`peaks skill presence:set peaks-code --mode <auto|assisted|swarm|strict> --gate step-N-startup`.
Failure aborts the workflow. Re-run on every user prompt until an active skill
marker exists under `.peaks/_runtime/active-skill.json`.
```

The matching paragraph in `CLAUDE.md:36` is amended to read:

```text
Active Peaks-Loop skill presence: …, and — when a /peaks-code workflow starts —
write presence via `peaks skill presence:set peaks-code` BEFORE displaying the
status header. Read the marker via `peaks skill presence --json`; never assume
the file is missing.
```

**Pros:** zero IDE hook changes; no install-time side effects on existing
projects; fully reversible via prose edit; no new code path.

**Cons:** still prompt-only; the LLM can still skip the verb in deep-loop
contexts, when a slice touches `.peaks/_runtime/` itself, or when a sub-agent
fan-out forgets to write; one more thing the LLM has to remember, against a
project rule that asks the LLM to *forget* CLI verbs (Human-NL-Choice-Only).

### Option B — hooks 层修 (UserPromptSubmit bootstrap)

Extend `peaks hooks install` so the gate-enforce entry gains a companion
`UserPromptSubmit` (Claude Code) / `beforeSubmitPrompt` (Trae) entry whose
command is `peaks skill presence:set peaks-code --mode ${PEAKS_PRESENCE_MODE:-full-auto} --gate ${PEAKS_PRESENCE_GATE:-step-0} --project "${CLAUDE_PROJECT_DIR}"`.
The bootstrap lives in a new file
`src/services/hooks/presence-bootstrap-hook.ts` and is wired into
`src/services/skills/hooks-settings-service.ts:resolveHookEntries` so install
emits both entries side by side.

The hook is fail-closed: if `peaks skill presence:set` exits non-zero, the
underlying IDE ignores the exit code (we surface `warn`, not `error`,
because the LLM should still proceed) but still log to
`.peaks/_runtime/<sid>/presence-bootstrap.log`. The hook enforces a 5-minute
rate limit by `(sessionId, skill)` derived from `PEAKS_OUTER_SESSION_ID`
fallback `CLAUDE_CODE_SESSION_ID`.

**Pros:** transparent to the LLM — the marker is written before the LLM ever
sees the user prompt; survives `/compact`, sub-agent dispatch, and re-clones;
deterministic on every fresh `peaks hooks install`; closes the regression in
all current and future peaks-loop projects; provides a `--upgrade` opt-in for
already-installed trees.

**Cons:** adds one hook entry per install; needs an adapter mapping for Trae
(`beforeSubmitPrompt`); the upgrade path needs a clear migration story
(default off; `--upgrade` opt-in for existing projects); one new file in
production.

### Recommendation — Option B + Option A as override channel

**Pick Option B as the primary path**, with Option A's prompt addition retained
as an **explicit LLM override** channel. Reasoning:

1. **Defense in depth.** Option B alone eliminates the root cause at the
   harness layer; Option A's prompt-only addition alone is the same regression
   waiting to happen. Combining them makes the LLM-side verb a documented
   override, not the default mechanism.
2. **Symmetric with existing peak-loop conventions.** The `peaks hooks install`
   surface is already the canonical "what does the harness do for every
   session" knob (PreToolUse gate-enforce + Worktree L2-extended deny +
   SUPERPOWERS_DENIED_SKILLS). Adding a presence-bootstrap entry is in the
   same category: it is something the harness always does, never something the
   LLM has to remember.
3. **Idempotent + cheap.** A 5-minute rate-limit per `(sessionId, skill)` caps
   fs writes to ~12 / hour regardless of how chatty the user is; the boot-strap
   is a single `peaks skill presence:set` invocation, not a sub-shell.
4. **Non-breaking on legacy projects.** Default `peaks hooks install` for a
   tree that already has a gate-enforce entry does NOT auto-add the
   `UserPromptSubmit` entry; users opt in with `peaks hooks install --upgrade`.
   This matches the `skipProgress` opt-in pattern from slice #013/#014.
5. **Closes a real defect, not a theoretical one.** The brief explicitly shows
   the regression on the canonical peaks-loop repo itself; Option B makes that
   regression structurally impossible on every fresh install.
6. **No new dep, no canonical-lease drift, no statusline renderer change.** All
   three "red lines" stay green. The change is exactly the file budget allowed
   by the surgical-changes rule.

## Acceptance Criteria

Each criterion is testable from a fresh shell. Pass = the literal command
produces the literal output.

- **AC1 — Fresh install auto-bootstraps presence.**

  ```bash
  rm -rf /tmp/statusline-fix-ac1 && mkdir -p /tmp/statusline-fix-ac1
  PEAKS_CALLER_ID=ac1-test node bin/peaks.js workspace init --project /tmp/statusline-fix-ac1 --json
  node bin/peaks.js hooks install --project /tmp/statusline-fix-ac1 --ide claude-code --json
  CLAUDE_CODE_SESSION_ID=ac1-session PEAKS_PRESENCE_SKILL=peaks-code \
    node bin/peaks.js hooks run-presence-bootstrap --project /tmp/statusline-fix-ac1 --json
  cat /tmp/statusline-fix-ac1/.peaks/_runtime/active-skill.json
  ```

  Expected: JSON output with `"skill":"peaks-code"` and
  `"mode":"full-auto"` (fallback mode when `PEAKS_PRESENCE_MODE` is unset).

- **AC2 — Statusline reflects the bootstrap within 30 s.**

  ```bash
  CLAUDE_PROJECT_DIR=/tmp/statusline-fix-ac1 \
    echo '{"workspace":{"project_dir":"/tmp/statusline-fix-ac1"},"session_id":"ac1-session"}' \
    | node bin/peaks.js statusline
  ```

  Expected: line starts with `Peaks ● peaks-code` (or the renderer-equivalent
  glyph for the active state) — NOT `Peaks o empty`.

- **AC3 — Rate-limit prevents fs thrash.**

  Run the `hooks run-presence-bootstrap` command from AC1 twice within
  5 minutes; second invocation returns `{ ok: true, data: { skipped: true,
  reason: 'rate-limited', lastWriteAt: <ISO> } }` and writes nothing. A
  third invocation after `PEAKS_PRESENCE_RATE_LIMIT_MS=100` and a 200 ms
  sleep MUST succeed and re-stamp `setAt`.

- **AC4 — Legacy install stays single-entry; `--upgrade` adds the bootstrap.**

  On a tree where `peaks hooks install` was already run *before* this slice
  landed, running `peaks hooks install --project /tmp/legacy --json` returns
  `{ ok: true, data: { applied: false, entries: [gate-enforce] } }`. Running
  `peaks hooks install --upgrade --project /tmp/legacy --json` returns
  `{ ok: true, data: { applied: true, entries: [gate-enforce, presence-bootstrap] } }`.

- **AC5 — Uninstall removes both entries; re-install restores only the
  baseline gate-enforce.**

  After AC4, `peaks hooks uninstall --project /tmp/legacy --json` removes
  both. Re-running `peaks hooks install --project /tmp/legacy --json` adds
  gate-enforce only — the bootstrap entry requires `--upgrade` again (this
  matches the `--upgrade` opt-in contract).

- **AC6 — `peaks doctor` reports the install as healthy.**

  ```bash
  node bin/peaks.js doctor --project /tmp/statusline-fix-ac1 --json
  ```

  Expected: `data.checks.hooks.status === 'pass'` AND
  `data.checks.presence.status === 'pass'` (a new doctor check).

- **AC7 — All 8 existing hooks-install integration tests stay green.**

  ```bash
  pnpm vitest run tests/integration/hooks-install tests/unit/cli/hooks-status.test.ts
  ```

  Expected: PASS, with no test name change (the byte-level install shape
  without `--upgrade` is preserved).

- **AC8 — No new npm dep in `package.json` / `pnpm-lock.yaml` diff.**

  ```bash
  git diff -- package.json pnpm-lock.yaml | grep -E '"[a-z@/-]+":'
  ```

  Expected: empty output (only SquabbyZ-authored prose + code changes land).

- **AC9 — `peaks doctor --project <repo> --json` on the peaks-loop repo
  itself reports `presence-bootstrap: pass` after running
  `peaks hooks install --upgrade`.**

  Expected: the doctor envelope contains
  `data.checks.presenceBootstrap: { status: 'pass', entryCount: 1 }`.

## Migration / Compatibility

- **M1 — Default install behaviour preserved.** A user running
  `peaks hooks install` on a tree that already has the gate-enforce entry
  receives `applied: false` (current behaviour). The bootstrap entry is **not**
  written by default.
- **M2 — Explicit `--upgrade` opt-in.** To pick up the bootstrap entry on a
  tree that was installed before this slice, the user (or the LLM on their
  behalf) runs `peaks hooks install --upgrade`. The flag is documented in the
  CLI help and in `peaks hooks status` output (a hint when only the
  gate-enforce entry is present).
- **M3 — Fresh installs include the bootstrap by default.** A fresh
  `peaks hooks install` on a tree that has no peaks-managed hooks writes
  *both* entries (gate-enforce + presence-bootstrap). This matches the brief's
  AC for fresh `git clone`.
- **M4 — 4.0.8 legacy markers preserved.** The bootstrap writes the legacy
  `.peaks/_runtime/active-skill.json` file (the path the statusline reader
  prefers). The legacy `.peaks/.active-skill.json` fallback remains for one
  minor release, unchanged from the current 4.0.8 back-compat window.
- **M5 — Adapter parity.** For `claude-code` the event is `UserPromptSubmit`;
  for `trae` it is `beforeSubmitPrompt`. Other adapters (`cursor`, `codex`)
  fall back to a sentinel-only install (no bootstrap entry) until they add an
  adapter-declared `promptEvent`; the README documents this.
- **M6 — `--upgrade` is idempotent.** Running `peaks hooks install --upgrade`
  twice yields the same final state; the second call reports
  `applied: false` once the file converges on the desired shape.

## Risks

- **R1 — `UserPromptSubmit` runs every user message.** Without rate-limiting,
  fs writes would thrash (~tens per minute on a chatty session). Mitigation:
  the bootstrap enforces a 5-minute window per `(sessionId, skill)` tuple;
  the second invocation within the window returns `{ ok: true, skipped: true }`
  without a write.
- **R2 — `peaks skill presence:set` can fail (`PEAKS_SESSION_NOT_BOUND`,
  `PEAKS_CALLER_NOT_RESOLVED`).** Mitigation: the bootstrap surfaces a
  `warn` (not `error`) and continues — the LLM still proceeds with the user's
  prompt; the failure is logged to
  `.peaks/_runtime/<sid>/presence-bootstrap.log` for retrospective diagnosis.
  The fix is to run `peaks workspace init` once; the bootstrap does not
  auto-create a session (avoiding silent side effects).
- **R3 — Trae `beforeSubmitPrompt` event name may shift across versions.**
  Mitigation: the adapter registry (`src/services/ide/ide-registry.ts`) is the
  single source of truth for `hookEvent` and gains a sibling `promptEvent`
  field with a stable fallback (`UserPromptSubmit` for claude-code,
  `beforeSubmitPrompt` for trae, empty string = no bootstrap for the
  adapter).
- **R4 — Two competing presence writes could clobber each other.** If the
  bootstrap and the LLM run `peaks skill presence:set` in the same window,
  the rate-limit allows only one write per window per skill. Mitigation: the
  rate-limit key is `(sessionId, skill)`, so different skills (e.g.
  `peaks-code` vs `peaks-qa`) still race correctly; same-skill writes use
  the more recent `setAt`. The 4.0.8 canonical lease write inside
  `setSkillPresence` always wins for the per-caller file (unchanged).
- **R5 — `--upgrade` opt-in may surprise users.** Mitigation: `peaks hooks
  status` prints a one-line "presence-bootstrap: not installed (run with
  --upgrade)" hint whenever the bootstrap is missing, so the user (or the LLM)
  knows the entry exists without being on a fresh install.
- **R6 — Presence-bootstrap log file could leak session identifiers.**
  Mitigation: the log is gitignored (already under `.peaks/_runtime/`) and
  contains only `{ at, sessionId-hash, skill, mode, gate, result }`. The
  `sessionId-hash` is a 16-hex digest, not the raw session id. No PII, no
  secrets.

## Out of scope

- Touching `src/services/skills/presence-lease-service.ts` (canonical 4.0.8
  lease path; unchanged).
- Touching the statusline renderer (`renderStatusLine`, `renderActive`,
  `renderIdle`); the renderer already renders `active` correctly when the
  marker is present.
- Touching `peaks-code/SKILL.md` Step 0 mode-select flow.
- Adding a desktop UI accelerator for the bootstrap install; CLI opt-in via
  `--upgrade` is the canonical surface for now.
- Adding a new presence schema, presence file, or presence format.
- Touching `peaks statusline --json` envelope shape.

## Component changes

| File / area | Change |
|---|---|
| `src/services/hooks/presence-bootstrap-hook.ts` (new) | `runPresenceBootstrap({ projectRoot, env, now, rateLimitMs })` — pure function: reads sessionId from env, rate-limits by `(sessionId, skill)`, shells out to `peaks skill presence:set` via dynamic-imported `setSkillPresence` (NOT raw unlink). |
| `src/services/skills/hooks-settings-service.ts` (modify) | `resolveHookEntries(ide, _skipProgress, opts?)` gains an optional `presenceBootstrap: boolean` flag (driven by `--upgrade`); when true, appends the `UserPromptSubmit` (claude-code) / `beforeSubmitPrompt` (trae) entry. `HOOK_COMMAND_BY_IDE` gains a `promptCommand` + `promptSentinel` column. `withHooksInstalledForIde` merges both event arrays idempotently. |
| `src/services/ide/ide-registry.ts` (modify) | Adapter gains an optional `promptEvent` field; default `''` means the bootstrap entry is omitted for that adapter. |
| `src/cli/commands/hooks-commands.ts` (modify) | `peaks hooks install` parses a new `--upgrade` flag (default false); on upgrade, `presenceBootstrap: true` is passed to `applyHookInstall`. `peaks hooks status` prints the missing-bootstrap hint. New subcommand `peaks hooks run-presence-bootstrap [--project] [--rate-limit-ms <ms>]` for AC1 / AC3 manual tests + post-mortem replay. |
| `src/cli/commands/core/skill-command.ts` (no change) | Re-uses the existing `presence:set` subcommand path as the writer; no new code in this file. |
| `src/services/doctor/` (modify, doctor check) | New check `presenceBootstrap` — verifies the bootstrap entry is present when `peaks hooks status` reports the upgrade hint. |
| `tests/unit/cli/hooks-install-presence-bootstrap.test.ts` (new, ≥5 cases) | AC1 + AC3 + AC4 + AC5 + AC7. |
| `tests/unit/hooks/presence-bootstrap-hook.test.ts` (new, ≥5 cases) | rate-limit windows, sessionId resolution, fail-open on `setSkillPresence` throwing, missing-env graceful no-op, legacy marker presence. |
| `tests/integration/hooks-install-upgrade.test.ts` (new, ≥3 cases) | install → upgrade → uninstall cycle; legacy project bootstrap; Trae adapter parity. |
| `docs/superpowers/plans/2026-08-04-statusline-empty-fix.md` (this plan's sibling) | The 5-task implementation plan. |
| `.peaks/memory/2026-08-04-statusline-empty-fix.md` (new) | Sediment after slice close. |

## Karpathy 4 准则自检 (RD self-check)

- **#1 Think Before Coding.** This design anchors on the verified root-cause
  brief (4 components, 6 file paths, 1 historical accident explanation). The
  recommendation picks Option B because it eliminates the failure mode at the
  harness layer rather than trusting LLM behaviour.
- **#2 Simplicity First.** Zero new npm dep. The bootstrap is a 1-file new
  module that delegates to the existing `setSkillPresence` writer; the hook
  installer gains a single boolean flag (`--upgrade`) and one optional
  adapter field (`promptEvent`).
- **#3 Surgical Changes.** Production code touches ≤ 3 files
  (`presence-bootstrap-hook.ts` new + `hooks-settings-service.ts` modify +
  `ide-registry.ts` modify). Tests live in 3 new files; the doctor check is a
  small addition to the existing doctor flow.
- **#4 Goal-Driven Execution.** AC1–AC9 each carry a CLI command + literal
  expected output; AC3 explicitly proves the rate-limit; AC4 proves the
  `--upgrade` opt-in; AC7 proves no regression on the 8 existing
  hooks-install integration tests; AC8 proves no new npm dep.