/**
 * Plan 2 — Task 8: peaks-qa consumes MUT.sig from peaks-mut.
 *
 * `loadMutReport` is the read-side counterpart of `buildMutReport`
 * (which is the write-side). Both share the canonical path:
 * `.peaks/_runtime/<sessionId>/mut/mut-report.json` (per hotfix 81f00ce
 * one-axis envelope — no `.peaks/_runtime/<sessionId>/` fallback).
 *
 * Design contract (per spec lines 1292-1341):
 *   - Missing file      → `null` (gate is skipped, NOT failed)
 *   - Schema-invalid    → `null` (log via stderr; do not throw — qa is a
 *                         pre-step, not a precondition)
 *   - Schema-valid      → the parsed `MutReportJson`
 *
 * Returning `null` instead of throwing is what lets peaks-qa treat
 * "peaks mut was not run" as a no-op. If we threw, the qa gate would
 * crash on every session that hasn't run peaks-mut yet.
 */
import { readFile } from 'node:fs/promises';
import { posix as pathPosix } from 'node:path';
import { MutReportSchema, type MutReportJson } from './types.js';

export const MUT_REPORT_RELATIVE_PATH = 'mut/mut-report.json';

/**
 * Build the canonical absolute path of a session's mut-report.json.
 * Exported so the CLI surface in qa-commands can reuse the same
 * constant for diagnostic messages.
 *
 * Uses POSIX separators intentionally: the one-axis envelope is
 * documented as `.peaks/_runtime/<sid>/mut/mut-report.json` (forward
 * slashes) and that path is what the hotfix 81f00ce audit-trail
 * contract guarantees. `node:path` would produce backslashes on
 * Windows, breaking the cross-platform invariant. POSIX join is
 * correct here because the result is a logical path stored in JSON
 * artifacts and CLI diagnostics — it never gets passed to OS
 * syscalls directly (readFile / writeFile accept both forms).
 */
export function mutReportPath(sessionId: string): string {
  return pathPosix.join('.peaks', '_runtime', sessionId, MUT_REPORT_RELATIVE_PATH);
}

/**
 * Read and validate a session's mut-report.json.
 *
 * Returns `null` for any of these cases:
 *   - file does not exist (ENOENT)
 *   - file exists but JSON is malformed
 *   - file exists and parses but does not satisfy `MutReportSchema`
 *
 * Never throws. Never logs to stdout (per "no console.log in src/").
 * Schema-parse failures are reported via `process.stderr` so the
 * qa-runner operator can see why their report is being treated as
 * absent.
 */
export async function loadMutReport(sessionId: string): Promise<MutReportJson | null> {
  const path = mutReportPath(sessionId);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    // ENOENT or permission denied — both treated as "not run".
    return null;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[peaks-qa] mut-report at ${path} is not valid JSON; treating as absent: ${message}\n`
    );
    return null;
  }

  const parsed = MutReportSchema.safeParse(parsedJson);
  if (!parsed.success) {
    process.stderr.write(
      `[peaks-qa] mut-report at ${path} failed schema validation; treating as absent: ${parsed.error.message}\n`
    );
    return null;
  }

  return parsed.data;
}
