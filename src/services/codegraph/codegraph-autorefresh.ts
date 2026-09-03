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
// The refresh is best-effort and FAIL-SILENT — it never throws and never
// blocks the checkpoint/transition ok envelope:
//   - No `<projectRoot>/.codegraph/` directory → skip (codegraph was
//     never initialized for this project; `peaks codegraph init` is a
//     one-time setup the orchestrator owns).
//   - The upstream index exits non-zero → return `index-failed` with a
//     human-readable note.
//   - Any unexpected error → return `unavailable` with a note.
//
// We deliberately do NOT auto-init: `codegraph init` can prompt / take a
// long time on first run, which would make the background side-effect
// block the slice boundary. Projects that want auto-refresh first run
// `peaks codegraph init` once (per the orchestration doc).

import { statSync } from 'node:fs';
import { join } from 'node:path';
import {
  CODEGRAPH_DIR_NAME,
  createCodegraphInvocation,
  executeCodegraphInvocation,
  type CodegraphProcessRunner,
} from './codegraph-service.js';

export type CodegraphAutorefreshResult =
  | { refreshed: true }
  | { refreshed: false; reason: 'no-codegraph-dir' | 'index-failed' | 'unavailable'; note: string };

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
    const invocation = createCodegraphInvocation({ subcommand: 'index', project: projectRoot, quiet: true });
    const result = await executeCodegraphInvocation(invocation, runner);
    if (result.exitCode !== 0) {
      return {
        refreshed: false,
        reason: 'index-failed',
        note: `auto codegraph refresh failed (exit ${String(result.exitCode)}): ${firstMeaningfulLine(result.stderr || result.stdout)}`,
      };
    }
    return { refreshed: true };
  } catch (error) {
    return {
      refreshed: false,
      reason: 'unavailable',
      note: `auto codegraph refresh unavailable: ${errorMessage(error)}`,
    };
  }
}
