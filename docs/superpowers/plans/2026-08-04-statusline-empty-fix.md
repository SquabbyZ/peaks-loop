# Statusline `Peaks o empty` Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-populate `.peaks/_runtime/active-skill.json` from an IDE `UserPromptSubmit` (Claude Code) / `beforeSubmitPrompt` (Trae) hook so the statusline renders the active skill on every fresh project; preserve the `--upgrade` opt-in for already-installed projects; ship 5 tasks × 5 slices with no new npm dep and ≤ 3 production files touched.

**Architecture:** One new pure module `src/services/hooks/presence-bootstrap-hook.ts` (rate-limited, fail-open); one minimal change to `src/services/skills/hooks-settings-service.ts` (gains an optional `presenceBootstrap` flag wired through `resolveHookEntries`); one tiny change to `src/services/ide/ide-registry.ts` (adapter gains `promptEvent` field); three new test files (unit + integration). The bootstrap re-uses the existing `peaks skill presence:set` CLI path via `setSkillPresence` — no new dep, no canonical-lease drift, no renderer change.

**Tech Stack:** TypeScript ESM, Node `node:fs` / `node:path` / `node:os`, existing `setSkillPresence` writer, vitest 4.1.10 (locked — no 5.x). No new dependency.

## Global Constraints

- Every commit is SquabbyZ sole-author; **no** `Co-Authored-By: Claude` or `Co-Authored-By: Anthropic` trailer anywhere in this repository.
- `Human-NL-Choice-Only` (project red rule effective 2026-07-04): the LLM does **not** prompt the user to run a CLI verb; the bootstrap is harness-driven and transparent.
- `Two-Forms-Only`: bootstrap install is opt-in via `peaks hooks install --upgrade`; the LLM picks the option via `AskUserQuestion` on the user's behalf.
- vitest is locked at **4.1.10** — do not propose `vitest@^5`, `@vitest/coverage-v8@^5`, `@vitest/coverage-istanbul@^5`.
- Zero new npm dep. The bootstrap uses `peaks skill presence:set` as the writer; no new package is added to `package.json` or `pnpm-lock.yaml`.
- Do **not** modify `src/services/skills/presence-lease-service.ts` (canonical 4.0.8 lease path).
- Do **not** modify the `peaks statusline` renderer (`renderStatusLine`, `renderActive`, `renderIdle`).
- Do **not** auto-create a peaks session inside the bootstrap (`peaks workspace init` remains a separate, user-driven flow).
- 5 tasks × 5 slices; each task lands a commit; no squashing.

---

## File map

- `src/services/hooks/presence-bootstrap-hook.ts` (new, ~120 lines): `runPresenceBootstrap({ projectRoot, env, now, rateLimitMs })` — pure: rate-limit key `(sessionId, skill)`, env-driven sessionId resolution, delegates to `setSkillPresence`, returns `{ ok, skipped?, reason?, lastWriteAt? }`.
- `src/services/skills/hooks-settings-service.ts` (modify, +30 lines): `resolveHookEntries(ide, _skipProgress, opts?)` accepts `opts.presenceBootstrap`; new `HOOK_COMMAND_BY_IDE` columns `promptCommand` + `promptSentinel`; `withHooksInstalledForIde` merges the `UserPromptSubmit` / `beforeSubmitPrompt` arrays idempotently; `shapeMatchesDesired` gains awareness of the optional presence-bootstrap column; `removeHookInstall` strips both entries.
- `src/services/ide/ide-registry.ts` (modify, +3 lines per adapter): adds optional `promptEvent: string` field. `claude-code` → `'UserPromptSubmit'`; `trae` → `'beforeSubmitPrompt'`; `cursor` / `codex` → `''` (no bootstrap for these adapters).
- `src/cli/commands/hooks-commands.ts` (modify, +60 lines): `peaks hooks install` parses `--upgrade` (default false); `peaks hooks status` prints a one-line `presence-bootstrap: not installed (run with --upgrade)` hint when missing on a tree that has a gate-enforce entry. New subcommand `peaks hooks run-presence-bootstrap [--project] [--rate-limit-ms <ms>]` for AC1 / AC3 manual test + post-mortem replay.
- `src/services/doctor/` (modify, +20 lines): new doctor check `presenceBootstrap` — verifies the bootstrap entry is present when `peaks hooks status` reports the upgrade hint; surfaces `data.checks.presenceBootstrap: { status: 'pass' | 'warn', entryCount: 0 | 1 }`.
- `tests/unit/hooks/presence-bootstrap-hook.test.ts` (new): rate-limit windows, sessionId resolution, fail-open on `setSkillPresence` throwing, missing-env graceful no-op, legacy marker presence. **≥ 5 cases.**
- `tests/unit/cli/hooks-install-presence-bootstrap.test.ts` (new): AC1, AC3, AC4, AC5, AC7 from the spec. **≥ 5 cases.**
- `tests/integration/hooks-install-upgrade.test.ts` (new): install → upgrade → uninstall cycle; legacy project bootstrap; Trae adapter parity. **≥ 3 cases.**
- `docs/superpowers/specs/2026-08-04-statusline-empty-fix-design.md` (already written): design anchor.
- `.peaks/memory/2026-08-04-statusline-empty-fix.md` (new, post-slice): sediment.

---

## Slice 1 — Bootstrap module + unit tests

### Task 1: `presence-bootstrap-hook.ts` pure module

**Files:**
- Create: `src/services/hooks/presence-bootstrap-hook.ts`
- Test: `tests/unit/hooks/presence-bootstrap-hook.test.ts`

**Type signatures:**

```ts
// src/services/hooks/presence-bootstrap-hook.ts

export interface PresenceBootstrapInput {
  readonly projectRoot: string;
  readonly env: NodeJS.ProcessEnv;       // read-only env snapshot
  readonly now: number;                   // epoch ms (test seam)
  readonly rateLimitMs?: number;          // default 5 * 60 * 1000
  readonly skill?: string;                // override default 'peaks-code'
  readonly mode?: string;                 // override default 'full-auto'
  readonly gate?: string;                 // override default 'step-0'
}

export type PresenceBootstrapResult =
  | { readonly ok: true;  readonly skipped: false; readonly setAt: string; readonly sessionIdHash: string; readonly skill: string; readonly mode: string; readonly gate: string }
  | { readonly ok: true;  readonly skipped: true;  readonly reason: 'rate-limited' | 'no-session-id' | 'no-skill'; readonly lastWriteAt?: string }
  | { readonly ok: false; readonly code: 'WRITE_FAILED'; readonly message: string };

export function runPresenceBootstrap(input: PresenceBootstrapInput): PresenceBootstrapResult;

export function resolveSessionIdHash(env: NodeJS.ProcessEnv): string | null;
```

**Rules:**
- `resolveSessionIdHash` reads `PEAKS_OUTER_SESSION_ID` → falls back to `CLAUDE_CODE_SESSION_ID` → returns `null` if both are missing. Returns the first 16 hex chars of a sha256 of the raw value (NOT the raw id — protects against leaking session identifiers into logs).
- Rate-limit cache lives at `<projectRoot>/.peaks/_runtime/.presence-bootstrap-cache.json` (gitignored; small fixed shape `{ [sessionIdHash:skill]: lastWriteAtIso }`). Reads / writes are atomic (read-modify-write under a per-process mutex; OK to skip in concurrent runs because rate-limit is *advisory*).
- `runPresenceBootstrap` calls `setSkillPresence(skill, mode, gate, projectRoot)` from `skill-presence-service.ts`. Failures throw `PEAKS_SESSION_NOT_BOUND` or `PEAKS_CALLER_NOT_RESOLVED` — these are caught and surfaced as `ok: true, skipped: true, reason: 'no-session-id'` or `no-skill` so the IDE never blocks the user's prompt.
- All FS reads / writes are wrapped in try / catch; on any unexpected IO error the function returns `{ ok: false, code: 'WRITE_FAILED', message: <text> }` so the hook caller can log it without blocking the IDE.

**Test cases (`tests/unit/hooks/presence-bootstrap-hook.test.ts`, ≥ 5):**
1. Cold call writes a `SkillPresence` to `.peaks/_runtime/active-skill.json` and stamps the cache.
2. Second call within the rate-limit window returns `{ ok: true, skipped: true, reason: 'rate-limited', lastWriteAt }` and writes nothing.
3. Third call after `rateLimitMs=100` and a 200 ms sleep succeeds and re-stamps `setAt`.
4. Missing `PEAKS_OUTER_SESSION_ID` AND `CLAUDE_CODE_SESSION_ID` returns `{ ok: true, skipped: true, reason: 'no-session-id' }`.
5. `setSkillPresence` throws `PEAKS_SESSION_NOT_BOUND` → result is `{ ok: true, skipped: true, reason: 'no-skill' }`, no fs write.

**Verification:**
```bash
pnpm vitest run tests/unit/hooks/presence-bootstrap-hook.test.ts
# Expected: PASS, 5/5
pnpm doctor --project . --json
# Expected: no new warnings (doctor has no presence-bootstrap check yet)
```

**Commit:**
```bash
git add src/services/hooks/presence-bootstrap-hook.ts tests/unit/hooks/presence-bootstrap-hook.test.ts
git commit -m "feat(hooks): add rate-limited presence-bootstrap module"
```

---

## Slice 2 — Hook installer (`--upgrade` + presence-bootstrap entry)

### Task 2: Adapter `promptEvent` field

**Files:**
- Modify: `src/services/ide/ide-registry.ts` (add optional `promptEvent` field per adapter)
- Test: existing `tests/unit/ide/ide-registry.test.ts` (no new test required; the existing shape test covers the new optional field)

**Change:**
- `claude-code`: `promptEvent: 'UserPromptSubmit'`
- `trae`: `promptEvent: 'beforeSubmitPrompt'`
- `cursor` / `codex` / `hermes` / `openclaw`: `promptEvent: ''` (sentinel "skip bootstrap for this adapter")

**Verification:**
```bash
pnpm vitest run tests/unit/ide/ide-registry.test.ts
# Expected: PASS, existing tests untouched
```

**Commit:**
```bash
git add src/services/ide/ide-registry.ts
git commit -m "feat(ide-registry): add promptEvent per-adapter field"
```

---

### Task 3: `hooks-settings-service.ts` gain `presenceBootstrap` flag

**Files:**
- Modify: `src/services/skills/hooks-settings-service.ts`
- Test: `tests/unit/cli/hooks-install-presence-bootstrap.test.ts` (new, ≥ 5 cases)

**Type signatures (added / changed):**

```ts
export type HookInstallOptions = {
  readonly ide?: IdeId;
  readonly skipProgress?: boolean;
  readonly presenceBootstrap?: boolean;       // NEW: drives --upgrade
};

interface ResolvedHookSpec {
  readonly hookEnforceCommand: string;
  readonly hookEnforceSentinel: string;
  readonly hookEnforceMatcher: string;
  readonly hookEnforceEvent: string;
  // NEW (optional — only when the adapter has a promptEvent):
  readonly promptCommand?: string;
  readonly promptSentinel?: string;
  readonly promptMatcher?: string;             // '.*' or empty
  readonly promptEvent?: string;
}

const HOOK_COMMAND_BY_IDE: ... = {
  'claude-code': {
    command: 'peaks gate enforce',
    sentinel: 'peaks gate enforce',
    promptCommand: 'peaks skill presence:set peaks-code --mode ${PEAKS_PRESENCE_MODE:-full-auto} --gate ${PEAKS_PRESENCE_GATE:-step-0} --project "${CLAUDE_PROJECT_DIR}"',
    promptSentinel: 'peaks skill presence:set'
  },
  'trae': {
    command: 'peaks hook handle',
    sentinel: 'peaks hook handle',
    promptCommand: 'peaks skill presence:set peaks-code --mode ${PEAKS_PRESENCE_MODE:-full-auto} --gate ${PEAKS_PRESENCE_GATE:-step-0} --project "${CLAUDE_PROJECT_DIR}"',
    promptSentinel: 'peaks skill presence:set'
  },
  'cursor':     { command: 'peaks hook handle', sentinel: 'peaks hook handle' }, // no promptEvent
  'codex':      { command: 'peaks hook handle', sentinel: 'peaks hook handle' },
  'hermes':     { command: 'peaks gate enforce', sentinel: 'peaks gate enforce' },
  'openclaw':   { command: 'peaks gate enforce', sentinel: 'peaks gate enforce' }
};

function resolveHookEntries(ide: IdeId, _skipProgress = false, opts?: { presenceBootstrap?: boolean }): PeaksHookEntry[] {
  const spec = resolveHookSpec(ide);
  const entries: PeaksHookEntry[] = [
    { sentinel: spec.hookEnforceSentinel, matcher: spec.hookEnforceMatcher, command: spec.hookEnforceCommand, event: spec.hookEnforceEvent }
  ];
  if (opts?.presenceBootstrap && spec.promptCommand && spec.promptEvent) {
    entries.push({
      sentinel: spec.promptSentinel ?? 'peaks skill presence:set',
      matcher: '',
      command: spec.promptCommand,
      event: spec.promptEvent
    });
  }
  return entries;
}
```

`withHooksInstalledForIde`, `applyHookInstall`, `removeHookInstall`, and `shapeMatchesDesired` accept the new `opts.presenceBootstrap` flag and propagate it through `resolveHookEntries`. `applyHookInstall` reports the new entry in its `desiredCommand` / `sentinel` / `matcher` fields.

**Test cases (`tests/unit/cli/hooks-install-presence-bootstrap.test.ts`, ≥ 5):**
1. Fresh install writes **both** entries (gate-enforce + presence-bootstrap) by default when `presenceBootstrap: true` is passed.
2. Fresh install with `presenceBootstrap: false` writes only the gate-enforce entry.
3. `applyHookInstall` is idempotent — calling it twice with the same `presenceBootstrap` flag converges on the desired shape.
4. `removeHookInstall` strips both entries.
5. `resolveHookEntries('claude-code', false, { presenceBootstrap: true })` returns 2 entries; `resolveHookEntries('cursor', false, { presenceBootstrap: true })` returns 1 (no promptEvent).
6. `shapeMatchesDesired` returns true only when both entries match the desired set (one for `presenceBootstrap: false`, two for `true`).

**Verification:**
```bash
pnpm vitest run tests/unit/cli/hooks-install-presence-bootstrap.test.ts
# Expected: PASS, 6/6
pnpm vitest run tests/integration/hooks-install tests/unit/cli/hooks-status.test.ts
# Expected: PASS, AC7 (no regression)
```

**Commit:**
```bash
git add src/services/skills/hooks-settings-service.ts tests/unit/cli/hooks-install-presence-bootstrap.test.ts
git commit -m "feat(hooks-install): add presence-bootstrap entry + --upgrade flag"
```

---

## Slice 3 — CLI plumbing + `run-presence-bootstrap` subcommand

### Task 4: `hooks-commands.ts` — `--upgrade` flag + new subcommand + status hint

**Files:**
- Modify: `src/cli/commands/hooks-commands.ts`
- Test: existing `tests/unit/cli/hooks-status.test.ts` (extend; ≥ 1 new case for the upgrade hint)

**Changes:**
- `peaks hooks install` parses `--upgrade` (default false). When set, `applyHookInstall(scope, projectRoot, { ide, presenceBootstrap: true })` is invoked.
- `peaks hooks status` reads the new `presenceBootstrap` entry's sentinel (`peaks skill presence:set`) out of the settings file. If `gate-enforce` is present but `presence-bootstrap` is missing AND the IDE has a `promptEvent`, the status command prints a one-line hint: `presence-bootstrap: not installed (run with --upgrade)`. The hint is a `nextActions` array entry on the JSON envelope, never a free-form LLM instruction.
- New subcommand `peaks hooks run-presence-bootstrap [--project <path>] [--rate-limit-ms <ms>]` shells out via `runPresenceBootstrap` and prints the result envelope.

**Verification:**
```bash
pnpm vitest run tests/unit/cli/hooks-status.test.ts
# Expected: PASS, status-hint case green
node bin/peaks.js hooks run-presence-bootstrap --project /tmp/foo --json
# Expected: { ok: true, data: { skipped: true, reason: 'no-session-id' } }  (env vars missing in shell)
PEAKS_OUTER_SESSION_ID=ac4-sess node bin/peaks.js hooks run-presence-bootstrap --project /tmp/foo --json
# Expected: { ok: true, data: { skipped: false, setAt: <ISO>, skill: 'peaks-code', mode: 'full-auto', gate: 'step-0' } }
```

**Commit:**
```bash
git add src/cli/commands/hooks-commands.ts tests/unit/cli/hooks-status.test.ts
git commit -m "feat(hooks-cli): add --upgrade + run-presence-bootstrap subcommand + status hint"
```

---

## Slice 4 — Integration tests + doctor check

### Task 5: Integration test for the install / upgrade / uninstall cycle

**Files:**
- Create: `tests/integration/hooks-install-upgrade.test.ts`

**Cases (≥ 3):**
1. Fresh project: `hooks install` (no `--upgrade`) installs gate-enforce only; status envelope shows `presenceBootstrapInstalled: false`.
2. Same project: `hooks install --upgrade` upgrades to both entries; status envelope shows `presenceBootstrapInstalled: true`. The settings.json on disk has the `UserPromptSubmit` array with one entry whose command contains `peaks skill presence:set`.
3. Same project: `hooks uninstall` removes both entries; re-running `hooks install` (no `--upgrade`) brings back only the gate-enforce entry (AC5). Trae adapter parity is exercised with `--ide trae --upgrade`.

**Verification:**
```bash
pnpm vitest run tests/integration/hooks-install-upgrade.test.ts
# Expected: PASS, 3/3
```

**Commit:**
```bash
git add tests/integration/hooks-install-upgrade.test.ts
git commit -m "test(hooks-install): add install-upgrade-uninstall integration cycle"
```

---

## Slice 5 — Doctor check + memory sediment + smoke

### Task 6: Doctor `presenceBootstrap` check

**Files:**
- Modify: `src/services/doctor/` (add `presenceBootstrap` check, ~20 lines)
- Test: existing `tests/integration/doctor.test.ts` (extend; ≥ 1 new case)

**Rule:**
- The check reads `peaks hooks status --project <p> --json`; if `data.presenceBootstrapInstalled === false` AND the IDE adapter has a `promptEvent`, the check returns `{ status: 'warn', message: 'presence-bootstrap entry not installed; run `peaks hooks install --upgrade` to enable auto-presence' }`. If the IDE has no `promptEvent`, the check returns `{ status: 'skip', message: 'no promptEvent for this IDE' }`. If the entry is present, `{ status: 'pass' }`.

**Verification:**
```bash
pnpm vitest run tests/integration/doctor.test.ts
# Expected: PASS, presenceBootstrap case green
node bin/peaks.js doctor --project /tmp/statusline-fix-ac1 --json | jq '.data.checks.presenceBootstrap'
# Expected on a fresh install: { "status": "pass", "entryCount": 1 }
# Expected without --upgrade: { "status": "warn", "message": "..." }
```

**Commit:**
```bash
git add src/services/doctor/ tests/integration/doctor.test.ts
git commit -m "feat(doctor): add presenceBootstrap check + warn hint"
```

---

### Task 7: Smoke test (full pipeline)

**Files:** none new.

**Verification commands (all from a fresh shell):**
```bash
# 1. Build the package so dist/ exists.
pnpm build
# Expected: build green, no warnings on the touched files.

# 2. Full unit + integration suite.
pnpm vitest run
# Expected: PASS — all pre-existing tests + the new 12 cases (5 + 6 + 3 + 1 from doctor - 13 in total).

# 3. Real statusline render (AC2).
mkdir -p /tmp/smoke && cd /tmp/smoke
node "$REPO/bin/peaks.js" workspace init --project . --json
node "$REPO/bin/peaks.js" hooks install --upgrade --project . --json
PEAKS_OUTER_SESSION_ID=smoke-sess node "$REPO/bin/peaks.js" hooks run-presence-bootstrap --project . --json
CLAUDE_PROJECT_DIR="$PWD" \
  echo '{"workspace":{"project_dir":"'$PWD'"},"session_id":"smoke-sess"}' \
  | node "$REPO/bin/peaks.js" statusline
# Expected: line contains "peaks-code" — NOT "empty".

# 4. Doctor on the smoke project.
node "$REPO/bin/peaks.js" doctor --project . --json | jq '.data.checks | {hooks, presenceBootstrap}'
# Expected: { "hooks": { "status": "pass" }, "presenceBootstrap": { "status": "pass", "entryCount": 1 } }

# 5. No new dep.
git diff -- package.json pnpm-lock.yaml | grep -E '"[a-z@/-]+":'
# Expected: empty output.

# 6. No Co-Authored-By trailer anywhere in the new commits.
git log --format='%(trailers:key=Co-Authored-By)' -n 7
# Expected: empty output.
```

**Commit (sediment only, after Task 7 verification passes):**
```bash
git add .peaks/memory/2026-08-04-statusline-empty-fix.md
git commit -m "docs(memory): sediment for statusline-empty fix"
```

---

## Karpathy 4 准则自检 (Plan self-check)

- **#1 Think Before Coding.** Tasks are sequenced fail-first (write test → run
  red → implement → run green → commit) so the bug surface is bounded to one
  task at a time. The brief's root-cause analysis is cited inline at Task 1.
- **#2 Simplicity First.** Zero new npm dep. The bootstrap is a 1-file pure
  module that re-uses `setSkillPresence`. The hook installer gains a single
  boolean flag (`presenceBootstrap`) and the CLI gains a single boolean flag
  (`--upgrade`).
- **#3 Surgical Changes.** Production code touches ≤ 3 files
  (`presence-bootstrap-hook.ts` new + `hooks-settings-service.ts` modify +
  `ide-registry.ts` modify). Tests live in 3 new files; the doctor check is
  a small addition to the existing doctor flow.
- **#4 Goal-Driven Execution.** Every task's Verification block lists the
  literal CLI commands and the expected output. Slice 5's smoke test (Task 7)
  runs the *real* statusline render and the *real* doctor check, not just
  unit tests, so AC2 + AC6 + AC8 + AC9 are covered end-to-end.