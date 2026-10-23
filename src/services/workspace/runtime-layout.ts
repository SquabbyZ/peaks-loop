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

import { isValidSessionId as canonicalIsValidSessionId } from './sid-naming-guard.js';

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
  },
  {
    name: 'classify-audit.jsonl',
    kind: 'file',
    purpose:
      "append-only classify audit log at the runtime root (cli/commands/classify-signals.ts); the path is built dynamically, so the drift guard's AST scan never saw it as a child — the census is what catches it"
  }
];

/**
 * The set `L3:l3-orphan-sessions` filters with. Derived from the registry
 * above so the check and the census cannot disagree about the same name.
 */
export const RUNTIME_SYSTEM_SUBDIRS: ReadonlySet<string> = new Set(
  RUNTIME_SYSTEM_ENTRIES.filter((entry) => entry.kind === 'dir').map((entry) => entry.name)
);

// ---------------------------------------------------------------------------
// THE CENSUS
// ---------------------------------------------------------------------------
//
// WHY THE REGISTRY WAS NOT ENOUGH. The registry is a list of NAMES the code
// writes at the runtime root. Until now, only ONE of the two guards could see
// the tree it governs:
//
//   - `L3:l3-orphan-sessions` reads DIRECTORIES only. It could never see a
//     stray FILE at the root, so unregistered files accumulated unbounded
//     (204 of them on 2026-10-24) with no product check able to name them.
//   - `tests/unit/workspace/runtime-layout-drift-guard.test.ts` walks `src/**`,
//     not the working tree. It proved the CODE does not write an unregistered
//     child — it said nothing about what is actually sitting on disk.
//
// The census below closes the gap: it reads the REAL tree, compares it with
// the registry above, and reports every top-level entry that is neither a
// session dir nor a registered system entry — files included.
//
// IT IS PURE ON PURPOSE. The caller reads the entries off disk and hands them
// in; this module does no IO. That is what makes the decision unit-testable
// without a filesystem, and it keeps the registry module a registry.

/**
 * Every registered top-level name — dirs AND files.
 *
 * Derived from the registry above so the census and the registry cannot
 * disagree about what "registered" means.
 */
export const RUNTIME_SYSTEM_ENTRY_NAMES: ReadonlySet<string> = new Set(
  RUNTIME_SYSTEM_ENTRIES.map((entry) => entry.name)
);

/** One top-level entry under the runtime root, as the census sees it. */
export interface RuntimeRootEntry {
  /** The exact top-level name. */
  readonly name: string;
  /** `dir` for a directory, `file` for everything else. */
  readonly kind: RuntimeEntryKind;
}

/** One top-level entry that is neither a session dir nor a registered system entry. */
export interface RuntimeRootViolation {
  readonly name: string;
  readonly kind: RuntimeEntryKind;
}

/**
 * What a read of the runtime root produced.
 *
 * `unreadable` is a first-class outcome, not an exception: a sweep that cannot
 * look must not report "clean" — the one answer it is not entitled to give
 * (see `services/audit/enforcers/root-scratch-artifacts.ts`).
 */
export type RuntimeRootRead =
  | { readonly status: 'read'; readonly entries: readonly RuntimeRootEntry[] }
  | { readonly status: 'unreadable'; readonly reason: string };

/**
 * The census verdict. `clean` is reachable ONLY for a tree that was read.
 */
export type RuntimeRootCensus =
  | { readonly status: 'clean'; readonly entryCount: number }
  | { readonly status: 'violations'; readonly violations: readonly RuntimeRootViolation[] }
  | { readonly status: 'undetermined'; readonly reason: string };

/**
 * The census: every top-level entry of the runtime root that is neither a
 * session dir nor a registered system entry.
 *
 * Three classes, in this order:
 *
 *   1. a DIRECTORY whose name is a valid session id — legal. A FILE wearing a
 *      session-shaped name is NOT legal: only a directory can be a session
 *      home, so such a file is a stray.
 *   2. a name in `RUNTIME_SYSTEM_ENTRIES` — legal, whatever its kind. The
 *      registry is the authority on which names may sit at the root.
 *   3. everything else — a violation, reported with its name AND its kind.
 */
export function censusRuntimeRoot(input: {
  readonly read: RuntimeRootRead;
  /** Defaults to the canonical validator; the doctor injects its own. */
  readonly isValidSessionId?: (sid: string) => boolean;
}): RuntimeRootCensus {
  if (input.read.status === 'unreadable') {
    return { status: 'undetermined', reason: input.read.reason };
  }
  const isValidSessionId = input.isValidSessionId ?? canonicalIsValidSessionId;
  const violations = input.read.entries
    .filter((entry) => !RUNTIME_SYSTEM_ENTRY_NAMES.has(entry.name))
    .filter((entry) => !(entry.kind === 'dir' && isValidSessionId(entry.name)))
    .map((entry) => ({ name: entry.name, kind: entry.kind }));
  if (violations.length > 0) {
    return { status: 'violations', violations };
  }
  return { status: 'clean', entryCount: input.read.entries.length };
}
