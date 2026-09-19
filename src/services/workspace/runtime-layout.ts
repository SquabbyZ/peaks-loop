/**
 * The canonical top-level layout of `.peaks/_runtime/`.
 *
 * WHY THIS MODULE EXISTS
 *
 * `.peaks/_runtime/` holds two populations whose names look identical:
 *
 *   1. SESSION DIRS — `<YYYY-MM-DD>-session-<hex>`, one per peaks session.
 *      Anything else that *looks* like a session id but is not one is a
 *      defect (a test that passed `--session-id x`, a typo, an old
 *      `unknown-sid` bucket).
 *   2. SYSTEM ENTRIES — dirs and files the code itself writes there on
 *      purpose: `callers/`, `change/`, `benchmarks/`, `session.json`, …
 *
 * The doctor check `L3:l3-orphan-sessions` must flag (1) and tolerate (2),
 * and the only thing that can tell them apart is a list of the system
 * entries. That list used to live inside the check as a hand-maintained
 * `new Set(['change'])` — and it had already drifted: `callers/` is a
 * designed location (`caller-binding-service.ts` stores
 * `.peaks/_runtime/callers/<callerId>.json`), was never added, and made
 * `peaks doctor` exit non-zero on a clean workspace *permanently*
 * (`4 orphan session(s) …: callers, cli, unknown-sid, x`). The check's own
 * doc comment asked future maintainers to keep a *second* list — the prose
 * `RUNTIME_SYSTEM_SUBDIRS_DOC` — in sync by hand. Prose cannot enforce
 * itself, so the two lists diverged exactly as you would expect.
 *
 * WHY DERIVATION WAS REJECTED AND A REGISTRY IS THE SOURCE OF TRUTH
 *
 * A derivation would have to classify a bare name as "system" or "bogus"
 * without a list. There is no signal to derive from: `callers` (system) and
 * `x` (bogus) are the same shape — a lowercase word. The session-id regex
 * separates them from `2026-09-16-session-5bcf09`, not from each other. So
 * the alternatives were (a) keep a literal in the check, or (b) put the
 * literal *and its consumers* in one place. This module is (b): the check
 * imports the set instead of re-declaring it, and
 * `tests/unit/workspace/runtime-layout-drift-guard.test.ts` parses `src/**`
 * and fails when the code writes a `_runtime` child that is not registered
 * here. The registry can no longer drift silently — it can only drift loudly,
 * as a red test.
 *
 * The guard parses ASTs rather than grepping, because this repository
 * documents the layout in prose constantly: `migrate-1-4-1-service.ts` has an
 * array whose two adjacent string literals are `'_runtime', '_sub_agents'`
 * (they are two *separate* SKIP entries), and `evidence-generator.ts`
 * describes a past escape as `` `.peaks/_runtime/pwned.md` `` inside a
 * comment. Both are false positives for a text scan and invisible to an AST
 * walk. See `tests/unit/runtime/no-runtime-input-guard.test.ts` for the same
 * decision made the same way.
 */

/**
 * `dir` entries are scanned by `L3:l3-orphan-sessions` and must not be
 * flagged. `file` entries are never flagged by that check — it only reads
 * directories — and are registered so the drift guard can classify them and
 * so this module stays an honest census of the tree rather than half of one.
 */
export type RuntimeEntryKind = 'dir' | 'file';

export interface RuntimeSystemEntry {
  /** The exact top-level name under `.peaks/_runtime/`. */
  readonly name: string;
  readonly kind: RuntimeEntryKind;
  /** What writes it and why it is legitimate. */
  readonly purpose: string;
}

/**
 * Reserved top-level dir for session-less command output.
 *
 * `peaks baseline audit` runs with no bound session (it is the only scorer
 * that can run inside the secretless OIDC publish gate), so it has no
 * `<sid>` to write under. It used to pass the literal `'cli'` as its
 * sessionId, which made `.peaks/_runtime/cli/capability-audit/*.json` look
 * exactly like a session dir that failed validation — `peaks doctor` has
 * been red on this repository ever since. The name is underscore-prefixed to
 * match the tree's existing convention for "machinery, not a session"
 * (`_runtime`, `_sub_agents`) and to make it impossible to mistake for a
 * session id.
 */
export const RUNTIME_SESSIONLESS_SCOPE = '_audit';

/**
 * Every legitimate top-level entry under `.peaks/_runtime/`.
 *
 * This is the list `L3:l3-orphan-sessions` tolerates. Adding an entry that
 * nothing writes is a red test (the drift guard's reverse direction); writing
 * an entry that is not here is also a red test. Both directions are pinned in
 * `tests/unit/workspace/runtime-layout-drift-guard.test.ts`.
 */
export const RUNTIME_SYSTEM_ENTRIES: readonly RuntimeSystemEntry[] = [
  {
    name: 'change',
    kind: 'dir',
    purpose:
      'change-id routing root for reviewable artifacts (workflow/artifact-paths.ts, prd/prd-blocks-checker.ts, workspace/reconcile-service.ts)'
  },
  {
    name: 'callers',
    kind: 'dir',
    purpose:
      'per-caller binding files `.peaks/_runtime/callers/<callerId>.json` (session/caller-binding-service.ts)'
  },
  {
    name: 'benchmarks',
    kind: 'dir',
    purpose:
      '`peaks slice benchmark` artifacts `<rid>.benchmark.json` (cli/commands/slice-commands.ts)'
  },
  {
    name: 'prd',
    kind: 'dir',
    purpose:
      'read-only PRD artifact root `.peaks/_runtime/prd/requests/<rid>.md` (prd/prd-blocks-checker.ts); the writer lives outside this repo, the check tolerates it'
  },
  {
    name: 'playwright-userdata',
    kind: 'dir',
    purpose: 'per-terminal browser profile dirs (cli/commands/playwright-commands.ts)'
  },
  {
    name: 'playwright-sessions',
    kind: 'dir',
    purpose: 'playwright session records `<terminalId>.json` (cli/commands/playwright-commands.ts)'
  },
  {
    name: 'test-cache',
    kind: 'dir',
    purpose: 'per-test fingerprint cache (cli/commands/test-commands.ts)'
  },
  {
    name: 'sop-state',
    kind: 'dir',
    purpose:
      'SOP state migrated from `.peaks/sop-state/` (cli/commands/workspace/reconcile-command.ts)'
  },
  {
    name: RUNTIME_SESSIONLESS_SCOPE,
    kind: 'dir',
    purpose:
      'capability-audit output for session-less runs `.peaks/_runtime/_audit/capability-audit/*.json` (cli/commands/baseline-commands.ts)'
  },
  {
    name: 'session.json',
    kind: 'file',
    purpose: 'project-global session binding (session/session-binding-service.ts)'
  },
  {
    name: 'active-skill.json',
    kind: 'file',
    purpose: 'active-skill presence marker (skills/skill-presence-service.ts)'
  },
  {
    name: 'generated-artifacts.json',
    kind: 'file',
    purpose:
      'stamp describing which generated artifacts exist on this machine, so a refresh can tell "stale" from "never generated" (services/workspace/generated-artifacts-stamp.ts)'
  },
  {
    name: '.outer-session-cache.json',
    kind: 'file',
    purpose:
      'outer (IDE) session cache for CLI sub-processes (cli/commands/outer-cache-commands.ts, session/session-binding-bridge.ts)'
  },
  {
    name: '.rebuild-binding.lock',
    kind: 'file',
    purpose: 'binding-store rebuild lock (session/binding-store.ts)'
  }
];

/**
 * The set `L3:l3-orphan-sessions` filters with. Derived from the registry
 * above so the check and the census cannot disagree about the same name.
 */
export const RUNTIME_SYSTEM_SUBDIRS: ReadonlySet<string> = new Set(
  RUNTIME_SYSTEM_ENTRIES.filter((entry) => entry.kind === 'dir').map((entry) => entry.name)
);
