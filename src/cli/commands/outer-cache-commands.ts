/**
 * Slice 2026-08-06-session-outer-cache (G1 / G2) — per-project outer-session
 * cache CLI surface.
 *
 * Writes and reads `.peaks/_runtime/.outer-session-cache.json` so that
 * peaks CLI sub-processes (which typically do NOT inherit
 * `CLAUDE_CODE_SESSION_ID` from the parent shell) can resolve the
 * current outer session id via `getCurrentOuterSessionId(projectRoot)`
 * in `src/services/session/session-binding-bridge.ts`.
 *
 * The SessionStart hook wired by `peaks hooks install` invokes
 * `peaks outer-cache write` to keep this file in sync with the active
 * Claude Code / Trae / IDE session. The file is under `.peaks/_runtime/`
 * (gitignored), so no `.gitignore` change is required.
 *
 * Subcommand surface:
 *   - `peaks outer-cache write` (no flags) — read PEAKS_OUTER_SESSION_ID
 *     ?? CLAUDE_CODE_SESSION_ID, write the cache file, return JSON
 *     envelope with `{ outerSessionId, capturedAt, cachePath, written }`.
 *   - `peaks outer-cache read` — return
 *     `{ outerSessionId, capturedAt, cachePath }` when present or
 *     `{ missing: true, cachePath }` when not. Never throws on
 *     malformed JSON / IO error.
 *
 * Both subcommands accept `--project <path>` (defaults to cwd / git
 * root) and `--json` (default in TTY-less invocations).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';

import { atomicWriteJson } from '../../services/ide/shared/atomic-json.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { findProjectRoot } from '../../services/config/config-safety.js';

const OUTER_SESSION_CACHE_REL = join('.peaks', '_runtime', '.outer-session-cache.json');

function resolveCachePath(projectRoot: string): string {
  return join(projectRoot, OUTER_SESSION_CACHE_REL);
}

function readEnvOuter(): string | undefined {
  const peaks = process.env.PEAKS_OUTER_SESSION_ID;
  if (typeof peaks === 'string' && peaks.length > 0) return peaks;
  const claude = process.env.CLAUDE_CODE_SESSION_ID;
  if (typeof claude === 'string' && claude.length > 0) return claude;
  return undefined;
}

function readCacheFile(cachePath: string):
  | { ok: true; outerSessionId: string; capturedAt: string }
  | { ok: false; missing: true } {
  if (!existsSync(cachePath)) return { ok: false, missing: true };
  try {
    const raw = readFileSync(cachePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      typeof (parsed as { outerSessionId?: unknown }).outerSessionId === 'string' &&
      ((parsed as { outerSessionId: string }).outerSessionId).length > 0 &&
      typeof (parsed as { capturedAt?: unknown }).capturedAt === 'string'
    ) {
      return {
        ok: true,
        outerSessionId: (parsed as { outerSessionId: string }).outerSessionId,
        capturedAt: (parsed as { capturedAt: string }).capturedAt
      };
    }
    return { ok: false, missing: true };
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return { ok: false, missing: true };
  }
}

export type OuterCacheWriteOptions = {
  readonly project?: string;
  readonly json?: boolean;
};
export type OuterCacheReadOptions = {
  readonly project?: string;
  readonly json?: boolean;
};

export function registerOuterCacheCommands(program: Command, io: ProgramIO): void {
  const outerCache = program
    .command('outer-cache')
    .description(
      'Read / write the per-project outer-session cache file (.peaks/_runtime/.outer-session-cache.json). The SessionStart hook installed by `peaks hooks install` keeps this file in sync with the live Claude Code / Trae / IDE session so peaks CLI sub-processes (which typically do NOT inherit CLAUDE_CODE_SESSION_ID) can resolve the current outer session via getCurrentOuterSessionId(projectRoot).'
    );

  addJsonOption(
    outerCache
      .command('write')
      .description(
        'Write the current outer-session-id (PEAKS_OUTER_SESSION_ID ?? CLAUDE_CODE_SESSION_ID) into the per-project cache file. Idempotent: re-runs overwrite. Exits 1 with OUTER_CACHE_NO_ENV when neither env var is set.'
      )
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
  ).action((options: OuterCacheWriteOptions) => {
    const projectRoot = options.project ?? (findProjectRoot(process.cwd()) ?? process.cwd());
    const cachePath = resolveCachePath(projectRoot);
    const outerSessionId = readEnvOuter();
    if (outerSessionId === undefined) {
      printResult(
        io,
        fail(
          'outer-cache.write',
          'OUTER_CACHE_NO_ENV',
          'Neither PEAKS_OUTER_SESSION_ID nor CLAUDE_CODE_SESSION_ID is set; nothing to write',
          { cachePath, written: false, projectRoot },
          [
            'Set PEAKS_OUTER_SESSION_ID=<id> or run from inside Claude Code / Trae / IDE so CLAUDE_CODE_SESSION_ID is exported',
            'Re-run `peaks hooks install` to wire the SessionStart hook that writes this cache automatically'
          ]
        ),
        options.json === true
      );
      process.exitCode = 1;
      return;
    }
    const capturedAt = new Date().toISOString();
    const payload = { outerSessionId, capturedAt };
    try {
      // Slice 2026-08-06-session-cacde8-A.5c: atomic write (temp +
      // rename) so a power-loss mid-write cannot leave the cache file
      // truncated. `atomicWriteJson` owns its own
      // `mkdirSync(dir, { recursive: true })` so the inline mkdir
      // block is removed. The previous `writeFileSync` path was the
      // 4.0.14 carry-forward QA issue #1; the bridge's cache-miss
      // fallback treated the truncated state as a miss (safe) but
      // the file was stuck in "permanent bad state" until the next
      // SessionStart fired.
      atomicWriteJson(cachePath, payload);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      printResult(
        io,
        fail(
          'outer-cache.write',
          'OUTER_CACHE_WRITE_FAILED',
          `Failed to write outer-session cache: ${message}`,
          { cachePath, written: false, projectRoot, outerSessionId, capturedAt },
          [message]
        ),
        options.json === true
      );
      process.exitCode = 1;
      return;
    }
    printResult(
      io,
      ok(
        'outer-cache.write',
        { cachePath, written: true, projectRoot, outerSessionId, capturedAt },
        [],
        [`Wrote ${cachePath}; getCurrentOuterSessionId() will resolve to "${outerSessionId}" until the next SessionStart fires.`]
      ),
      options.json === true
    );
  });

  addJsonOption(
    outerCache
      .command('read')
      .description(
        'Read the current value of the per-project outer-session cache. Returns { missing: true, cachePath } when the file is absent / malformed / empty; never throws on IO error.'
      )
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
  ).action((options: OuterCacheReadOptions) => {
    const projectRoot = options.project ?? (findProjectRoot(process.cwd()) ?? process.cwd());
    const cachePath = resolveCachePath(projectRoot);
    const result = readCacheFile(cachePath);
    if (result.ok) {
      printResult(
        io,
        ok(
          'outer-cache.read',
          { cachePath, missing: false, projectRoot, outerSessionId: result.outerSessionId, capturedAt: result.capturedAt },
          [],
          [`outer-session-id resolved: ${result.outerSessionId} (captured ${result.capturedAt})`]
        ),
        options.json === true
      );
      return;
    }
    printResult(
      io,
      ok(
        'outer-cache.read',
        { cachePath, missing: true, projectRoot },
        ['No outer-session cache present — getCurrentOuterSessionId() will return undefined for this project.'],
        [
          'Re-run `peaks hooks install` to wire the SessionStart hook that writes this cache automatically',
          'Or set PEAKS_OUTER_SESSION_ID=<id> so env-first resolution wins without touching the cache'
        ]
      ),
      options.json === true
    );
  });
}
