/**
 * Slice 2026-06-14-cc-connect-weixin (slice 1) — cc-connect state
 * parser. Reads `~/.cc-connect/state.json` (written by the
 * cc-connect binary itself when the iLink pairing flow runs) and
 * returns a structured snapshot the rest of the companion code
 * path can use for status reporting + setup progress polling.
 *
 * We do NOT read or write iLink tokens / WeChat cookies. The
 * binary owns those. We only read public pairing state.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CompanionPairingState } from './companion-types.js';

export const CC_CONNECT_HOME_DIRNAME = '.cc-connect';
export const CC_CONNECT_STATE_FILENAME = 'state.json';

export type CompanionStateSnapshot = {
  /** Absolute path to the state file we read. */
  statePath: string;
  /** Last-modified time of the state file (ms since epoch), or null when the file is absent. */
  mtimeMs: number | null;
  /** Normalized pairing state. */
  state: CompanionPairingState;
  /** ilink bot account id, when present. */
  accountId: string | null;
  /** Last successful login timestamp (iso8601), when present. */
  lastLogin: string | null;
  /** Error message from the binary, when present. */
  error: string | null;
};

export function ccConnectHomeDir(home: string = homedir()): string {
  return join(home, CC_CONNECT_HOME_DIRNAME);
}

export function ccConnectStateFile(home: string = homedir()): string {
  return join(ccConnectHomeDir(home), CC_CONNECT_STATE_FILENAME);
}

/** Map a raw `pairing_state` string from cc-connect's state.json to our normalized enum. */
export function normalizePairingState(raw: unknown): CompanionPairingState {
  if (typeof raw !== 'string') return 'unknown';
  switch (raw) {
    case 'not_scanned':
    case 'not-scanned':
    case 'pending':
      return 'not-scanned';
    case 'scanned_waiting_confirm':
    case 'scanned-waiting-confirm':
    case 'awaiting_confirm':
      return 'scanned-waiting-confirm';
    case 'logged_in':
    case 'logged-in':
    case 'active':
    case 'paired':
      return 'logged-in';
    case 'expired':
    case 'token_expired':
      return 'expired';
    case 'error':
    case 'failed':
      return 'error';
    default:
      return 'unknown';
  }
}

/** Read a cc-connect state snapshot. Returns a typed snapshot for both file-absent and file-present cases. */
export function readCcConnectState(home: string = homedir()): CompanionStateSnapshot {
  const statePath = ccConnectStateFile(home);
  if (!existsSync(statePath)) {
    return {
      statePath,
      mtimeMs: null,
      state: 'unknown',
      accountId: null,
      lastLogin: null,
      error: null
    };
  }
  let mtimeMs: number | null = null;
  try {
    mtimeMs = statSync(statePath).mtimeMs;
  } catch {
    mtimeMs = null;
  }
  let parsed: Record<string, unknown> = {};
  try {
    const raw = readFileSync(statePath, 'utf8');
    const obj = JSON.parse(raw) as unknown;
    if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
      parsed = obj as Record<string, unknown>;
    }
  } catch {
    return {
      statePath,
      mtimeMs,
      state: 'error',
      accountId: null,
      lastLogin: null,
      error: 'state.json is not valid JSON'
    };
  }
  return {
    statePath,
    mtimeMs,
    state: normalizePairingState(parsed['pairing_state'] ?? parsed['state']),
    accountId: typeof parsed['account_id'] === 'string' ? parsed['account_id'] : null,
    lastLogin: typeof parsed['last_login'] === 'string' ? parsed['last_login'] : null,
    error: typeof parsed['error'] === 'string' ? parsed['error'] : null
  };
}
