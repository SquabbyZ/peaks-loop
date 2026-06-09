/**
 * PLATFORM_FALLBACKS — the Level 3 fallback table for caller-id resolution.
 *
 * Slice 020 (D3): when neither `--caller-id` nor `PEAKS_CALLER_ID` is
 * set, the resolver walks this table top-to-bottom and takes the
 * first non-empty entry. Today there is exactly one entry: Claude
 * Code (`CLAUDE_CODE_SESSION_ID`).
 *
 * To add a new platform (Cursor, Windsurf, peaks-ide, etc.):
 *
 *   1. Add a new entry below.
 *   2. Bump the contract doc's A5 acceptance criterion
 *      (`.peaks/_runtime/2026-06-09-session-8bfe7d/prd/source/caller-id-contract.md`).
 *   3. Add a regression test that asserts the new entry resolves
 *      correctly under D4 priority.
 *
 * The contract's A5 test (`tests/unit/services/session/caller-id-resolution.test.ts`)
 * asserts `PLATFORM_FALLBACKS.length === 1`; adding a new entry will
 * fail that test, forcing the contract bump.
 *
 * Adding an entry does NOT require code changes to read points
 * (statusline, doctor, sc, session-info) — they all call the same
 * resolver. Each entry is a one-line additive change.
 */

export interface PlatformFallback {
  readonly envVar: string;
  readonly description: string;
  /** Semver this entry was added in (e.g. "1.3.7"). */
  readonly addedIn: string;
}

export const PLATFORM_FALLBACKS: ReadonlyArray<PlatformFallback> = [
  {
    envVar: 'CLAUDE_CODE_SESSION_ID',
    description: 'Claude Code session id',
    addedIn: '1.3.7'
  }
  // Future entries (do NOT add without bumping the contract's A5):
  // { envVar: 'CURSOR_SESSION_ID', description: 'Cursor session id', addedIn: 'TBD' },
  // { envVar: 'WINDSURF_SESSION_ID', description: 'Windsurf session id', addedIn: 'TBD' },
  // { envVar: 'PEAKS_IDE_SESSION_ID', description: 'peaks-ide session id', addedIn: 'TBD' },
];
