// src/services/codegraph/codegraph-autorefresh.ts
//
// Slice 2026-09-03-codegraph-autorefresh — Option 1: CLI-internal
// auto codegraph refresh at the slice-complete boundary.
//
// `peaks codegraph index` is incremental + idempotent, so re-running it
// after a slice that changed code is cheap and safe. Rather than rely on
// the orchestrator LLM to remember the prose rule in
// `skills/peaks-code/references/codegraph-orchestration.md` ("MUST
// proactively run `peaks codegraph index --project <path>` after each
// slice"), the checkpoint/transition command itself triggers the refresh
// right before it returns its ok envelope. This is the vendor-neutral
// CLI-internal form of "hook on slice-complete": it is un-bypassable
// (fires even when the LLM dispatches the command through any IDE / no
// hook install surface needed), fires exactly once at the true slice
// boundary, and needs no IDE hook plumbing.
//
// The refresh is best-effort and never throws, and it never blocks the
// checkpoint/transition ok envelope:
//   - No `<projectRoot>/.codegraph/` directory → skip (codegraph was
//     never initialized for this project; `peaks codegraph init` is a
//     one-time setup the orchestrator owns).
//   - `.codegraph/` present WITH `codegraph.db` → `index` (incremental).
//   - `.codegraph/` present with the peaks-loop marker but NO
//     `codegraph.db` (dangling) → self-heal: `init` then `index`.
//   - `.codegraph/` present without a marker and without `codegraph.db`
//     (foreign schema) → skip; never touch a foreign store.
//   - The upstream index exits non-zero → return `index-failed` with a
//     human-readable note.
//   - Any unexpected error → return `unavailable` with a note.
//
// A2 (`2026-09-17-codegraph-msg-and-refresh`). The old header said
// "FAIL-SILENT", and it was: both call sites discarded this result's `note`,
// so a refresh that DID NOT HAPPEN and one that did were indistinguishable
// to the operator — the same silent-failure class this job exists to close.
// "Never blocks the caller" is the correct half and is KEPT; "never tells
// anyone" was not.
//
// The two halves are split by whether a refresh was EXPECTED:
//   - `no-codegraph-dir` → the project has no codegraph store (or has a
//     foreign, never-initialized one). Nothing was expected, so nothing is
//     reported: warning on every slice boundary of every project that never
//     opted in is noise that trains the reader to skip the line that
//     matters. The note is still in the JSON envelope.
//   - `index-failed` / `unavailable` → a store EXISTS and is in use, so the
//     refresh was expected and did not happen. That is a real failure and
//     `codegraphRefreshNotice` turns it into an operator-visible warning
//     naming the reason and the remedy.
//
// We do NOT auto-init a genuinely fresh (no `.codegraph/` dir) project:
// the orchestrator owns that one-time setup. The dangling self-heal above
// IS an auto-init, but `codegraph init` (WITHOUT `--index`) is fast (~1 s)
// and offline-safe — it only `Parser.init()`s WASM grammars that resolve
// from node_modules. The slow/offline concern applies to `index` (full
// build), not `init`.

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  CODEGRAPH_DIR_NAME,
  CODEGRAPH_MARKER_NAME,
  createCodegraphInvocation,
  executeCodegraphInvocation,
  isCodegraphInitialized,
  type CodegraphProcessRunner,
} from './codegraph-service.js';
import { repairCodegraphExcludeFromProject } from './codegraph-exclude-repair.js';

export type CodegraphAutorefreshResult =
  | { refreshed: true }
  | { refreshed: false; reason: 'no-codegraph-dir' | 'index-failed' | 'unavailable'; note: string };

/**
 * The operator-facing line for a refresh that did not happen, or `null` when
 * there is nothing to report. The ONE place the report/no-report rule lives,
 * shared by both slice-boundary call sites (`peaks job checkpoint --state
 * done` and `peaks request transition rd:qa-handoff`) so the two cannot
 * drift into disagreeing about what counts as visible.
 *
 * Returns the result's own `note` verbatim rather than rebuilding a
 * sentence: that note is where the reason (exit code / upstream error line)
 * and the remedy live, and a second wording here would be a second truth.
 *
 * `no-codegraph-dir` is deliberately SILENT — see the header's A2 note. A
 * store that exists and did not refresh is a warning; a project that never
 * set codegraph up is not a defect to report at every slice boundary.
 */
export function codegraphRefreshNotice(result: CodegraphAutorefreshResult): string | null {
  if (result.refreshed) return null;
  if (result.reason === 'no-codegraph-dir') return null;
  return result.note;
}

/**
 * True when `<projectRoot>/.codegraph/` exists and is a directory.
 * Pure fs probe; never throws.
 */
export function isCodegraphPresent(projectRoot: string): boolean {
  try {
    return statSync(join(projectRoot, CODEGRAPH_DIR_NAME)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * True when `<projectRoot>/.codegraph/` carries the peaks-loop marker
 * (i.e. peaks-loop manages it, as opposed to a foreign tool). Pure fs
 * probe; never throws.
 */
function isCodegraphPeaksLoopManaged(projectRoot: string): boolean {
  return existsSync(join(projectRoot, CODEGRAPH_DIR_NAME, CODEGRAPH_MARKER_NAME));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// A2: the remedy half of an operator-visible failure note. Phrased like the
// existing follow-up-index warning in `codegraph-exclude-repair.ts` so the
// two read as one voice; it names the command the LLM/orchestrator re-runs,
// never a verb the user is asked to type (Human-NL-Choice-Only — the same
// posture that warning already ships with).
const REFRESH_REMEDY =
  'Run `peaks codegraph index --project <root>` to refresh the codegraph index.';

function firstMeaningfulLine(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 'no upstream output';
  const first = trimmed.split(/\r?\n/)[0];
  return first !== undefined ? first.slice(0, 200) : 'no upstream output';
}

/**
 * Run a best-effort `codegraph index` refresh for `projectRoot` after a
 * slice-complete boundary. NEVER throws — every failure path returns a
 * non-refreshed result so the caller keeps its ok envelope.
 *
 * The optional `runner` is a test seam mirroring
 * `CodegraphProcessRunner`; when omitted the real process runner is used.
 */
export async function refreshCodegraphAfterSlice(
  projectRoot: string,
  runner?: CodegraphProcessRunner,
): Promise<CodegraphAutorefreshResult> {
  if (!isCodegraphPresent(projectRoot)) {
    return {
      refreshed: false,
      reason: 'no-codegraph-dir',
      note: `auto codegraph refresh skipped: no ${CODEGRAPH_DIR_NAME} directory at ${join(projectRoot, CODEGRAPH_DIR_NAME)}. Run \`peaks codegraph init\` once to enable post-slice auto-refresh.`,
    };
  }

  try {
    // A `.codegraph/` dir without a `codegraph.db` is uninitialized:
    //   - NOT peaks-loop-managed → foreign schema, never touch it.
    //   - peaks-loop-managed → the dangling state left by the pre-fix
    //     rid-CG-001 auto-stake (marker stamped, no upstream init). Run
    //     init (fast, offline-safe — no full index) so the subsequent
    //     index has a schema to write into.
    if (!isCodegraphInitialized(projectRoot)) {
      if (!isCodegraphPeaksLoopManaged(projectRoot)) {
        return {
          refreshed: false,
          reason: 'no-codegraph-dir',
          note: `auto codegraph refresh skipped: ${CODEGRAPH_DIR_NAME}/ exists without a codegraph.db and is not peaks-loop-managed. Run \`peaks codegraph init\` once to enable post-slice auto-refresh.`,
        };
      }
      const initResult = await executeCodegraphInvocation(
        createCodegraphInvocation({ subcommand: 'init', project: projectRoot }),
        runner,
      );
      if (initResult.exitCode !== 0) {
        return {
          refreshed: false,
          reason: 'index-failed',
          note: `auto codegraph refresh self-heal init failed (exit ${String(initResult.exitCode)}): ${firstMeaningfulLine(initResult.stderr || initResult.stdout)}. ${REFRESH_REMEDY}`,
        };
      }
      // That init just wrote upstream's 99-rule default `exclude`
      // template, some of which block tracked source files — the same
      // self-heal the CLI's `peaks codegraph init` performs, via the
      // same shared helper. Skipped, this path would stamp the
      // peaks-loop marker over an incomplete index that no later
      // `init` (it would no-op) could ever repair.
      //
      // Never throws (the helper catches everything), and
      // `reindex: false` because the index call below covers the
      // recovered files.
      await repairCodegraphExcludeFromProject(projectRoot, runner, { reindex: false });
    }

    const invocation = createCodegraphInvocation({ subcommand: 'index', project: projectRoot, quiet: true });
    const result = await executeCodegraphInvocation(invocation, runner);
    if (result.exitCode !== 0) {
      return {
        refreshed: false,
        reason: 'index-failed',
        note: `auto codegraph refresh failed (exit ${String(result.exitCode)}): ${firstMeaningfulLine(result.stderr || result.stdout)}. ${REFRESH_REMEDY}`,
      };
    }
    return { refreshed: true };
  } catch (error) {
    return {
      refreshed: false,
      reason: 'unavailable',
      note: `auto codegraph refresh unavailable: ${errorMessage(error)}. ${REFRESH_REMEDY}`,
    };
  }
}
