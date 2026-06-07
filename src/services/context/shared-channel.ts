/**
 * G8 — cross sub-agent shared channel (RL-23..RL-26, AC-47..AC-49).
 *
 * Dispatcher-mediated indirect signal: sub-agent A writes a shared entry,
 * the dispatcher stores it in a per-batch JSON file, sub-agent B (still
 * in flight) reads it. A and B never directly talk. This is the
 * pseudo-swarm property 3 upgrade; it is NOT peer-to-peer messaging.
 *
 * Path convention (G8.3):
 *   `.peaks/_sub_agents/<sid>/shared/<rid>-<batchId>.json`
 *
 * The file is atomic-write (tmp + rename). Last-write-wins by key. Value
 * size limit: ≤ 1KB soft warn, ≥ 64KB hard reject. File size cap: 1MB
 * with LRU eviction.
 *
 * See: `.peaks/memory/sub-agent-shared-channel-cross-completion.md` for
 * the full G8 rule.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { assertSafeSharedChannelPath, sharedChannelPath } from './dispatch-context-guard.js';

export interface SharedChannelEntry {
  readonly at: string;                                         // ISO8601
  readonly from: string;                                       // sub-agent role string
  readonly key: string;                                        // '<role>.<event>' convention
  readonly value: Readonly<Record<string, unknown>>;           // ≤ 1KB soft warn, ≥ 64KB rejected
  readonly valueSize: number;                                  // bytes
}

export interface SharedChannel {
  readonly batchId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly entries: Readonly<Record<string, SharedChannelEntry>>;  // key → entry (last-write-wins)
}

export const SHARED_CHANNEL_MAX_VALUE_BYTES = 64 * 1024;       // 64KB hard reject
export const SHARED_CHANNEL_SOFT_VALUE_WARN = 1024;             // 1KB soft warning
export const SHARED_CHANNEL_MAX_FILE_BYTES = 1024 * 1024;      // 1MB LRU cap
export const SHARED_CHANNEL_TTL_DAYS = 30;                     // 30-day TTL on orphan channels

export type WriteSharedEntryResult =
  | {
      readonly ok: true;
      readonly entry: SharedChannelEntry;
      readonly channelSize: number;
      readonly lastWriteWins: boolean;
      readonly softWarning: boolean;
    }
  | {
      readonly ok: false;
      readonly code: 'VALUE_TOO_LARGE' | 'INVALID_BATCH_ID' | 'WRITE_ERROR';
      readonly message: string;
    };

/**
 * Write a shared entry to the per-batch channel file. Atomic-write
 * (tmp + rename). Returns the new entry + channel size + last-write-wins
 * flag (true if the key already existed; the new value overwrites).
 *
 * RL-25 size limit: `value ≥ 64KB` is hard-rejected with `VALUE_TOO_LARGE`.
 * `value > 1KB and < 64KB` is a soft warning (returned in the result).
 */
export function writeSharedEntry(opts: {
  projectRoot: string;
  sid: string;
  rid: string;
  batchId: string;
  key: string;
  from: string;
  value: Record<string, unknown>;
}): WriteSharedEntryResult {
  if (typeof opts.key !== 'string' || opts.key.length === 0) {
    return { ok: false, code: 'INVALID_BATCH_ID', message: 'key must be non-empty' };
  }
  if (typeof opts.from !== 'string' || opts.from.length === 0) {
    return { ok: false, code: 'INVALID_BATCH_ID', message: 'from must be non-empty' };
  }
  if (opts.value === null || typeof opts.value !== 'object' || Array.isArray(opts.value)) {
    return {
      ok: false,
      code: 'INVALID_BATCH_ID',
      message: 'value must be a JSON object (not array, not primitive)'
    };
  }

  const valueSize = Buffer.byteLength(JSON.stringify(opts.value), 'utf8');
  if (valueSize >= SHARED_CHANNEL_MAX_VALUE_BYTES) {
    return {
      ok: false,
      code: 'VALUE_TOO_LARGE',
      message: `value size ${valueSize} bytes exceeds limit ${SHARED_CHANNEL_MAX_VALUE_BYTES} bytes (RL-25)`
    };
  }
  const softWarning = valueSize > SHARED_CHANNEL_SOFT_VALUE_WARN;

  const channelFile = sharedChannelPath(opts.projectRoot, opts.sid, opts.rid, opts.batchId);
  assertSafeSharedChannelPath(channelFile, opts.projectRoot);

  let channel: SharedChannel;
  try {
    channel = readChannelOrEmpty(channelFile, opts.batchId);
  } catch (err) {
    return {
      ok: false,
      code: 'WRITE_ERROR',
      message: `failed to read existing channel: ${(err as Error).message}`
    };
  }

  const lastWriteWins = Object.prototype.hasOwnProperty.call(channel.entries, opts.key);

  // LRU eviction: if writing would push the file over the 1MB cap,
  // evict oldest entries until the new write fits.
  const entry: SharedChannelEntry = {
    at: new Date().toISOString(),
    from: opts.from,
    key: opts.key,
    value: Object.freeze({ ...opts.value }),
    valueSize
  };
  const projectedChannel: SharedChannel = {
    ...channel,
    updatedAt: entry.at,
    entries: { ...channel.entries, [opts.key]: entry }
  };
  const projectedSize = JSON.stringify(projectedChannel).length;
  let lruEvicted = 0;
  if (projectedSize > SHARED_CHANNEL_MAX_FILE_BYTES) {
    const sortedKeys = Object.keys(projectedChannel.entries).sort((a, b) => {
      const ea = projectedChannel.entries[a];
      const eb = projectedChannel.entries[b];
      if (!ea || !eb) return 0;
      return ea.at.localeCompare(eb.at);
    });
    let working: SharedChannel = projectedChannel;
    while (
      JSON.stringify(working).length > SHARED_CHANNEL_MAX_FILE_BYTES &&
      sortedKeys.length > 0
    ) {
      const oldestKey = sortedKeys.shift() as string;
      if (oldestKey === opts.key) {
        // Don't evict the entry we just wrote.
        break;
      }
      const nextEntries: Record<string, SharedChannelEntry> = {};
      for (const [k, v] of Object.entries(working.entries)) {
        if (k !== oldestKey) {
          nextEntries[k] = v;
        }
      }
      working = { ...working, entries: nextEntries };
      lruEvicted += 1;
    }
    try {
      writeAtomic(channelFile, working);
    } catch (err) {
      return {
        ok: false,
        code: 'WRITE_ERROR',
        message: `failed to write channel after LRU eviction: ${(err as Error).message}`
      };
    }
    return {
      ok: true,
      entry,
      channelSize: JSON.stringify(working).length,
      lastWriteWins,
      softWarning
    };
  }

  try {
    writeAtomic(channelFile, projectedChannel);
  } catch (err) {
    return {
      ok: false,
      code: 'WRITE_ERROR',
      message: `failed to write channel: ${(err as Error).message}`
    };
  }
  // lruEvicted is 0 here; expose the count through the size of the
  // returned channel for caller diagnostics.
  void lruEvicted;

  return {
    ok: true,
    entry,
    channelSize: projectedSize,
    lastWriteWins,
    softWarning
  };
}

/**
 * Read the shared channel for a batch. Returns the channel with all
 * matching entries. Filters: `--since` (ISO8601) and `--key` (glob
 * pattern; simple `*` wildcard, no regex).
 *
 * If the channel file does not exist, returns an empty channel
 * (this is the dispatcher's "fresh batch" view).
 */
export function readSharedChannel(opts: {
  projectRoot: string;
  sid: string;
  rid: string;
  batchId: string;
  since?: string;
  keyPattern?: string;
}): SharedChannel {
  const channelFile = sharedChannelPath(opts.projectRoot, opts.sid, opts.rid, opts.batchId);
  assertSafeSharedChannelPath(channelFile, opts.projectRoot);

  const channel = readChannelOrEmpty(channelFile, opts.batchId);
  const since = opts.since;
  const pattern = opts.keyPattern;

  if (!since && !pattern) {
    return channel;
  }

  const filteredEntries: Record<string, SharedChannelEntry> = {};
  const matcher = pattern ? compileKeyPattern(pattern) : null;
  for (const [k, v] of Object.entries(channel.entries)) {
    if (since && v.at < since) continue;
    if (matcher && !matcher(k)) continue;
    filteredEntries[k] = v;
  }
  return { ...channel, entries: filteredEntries };
}

/**
 * Garbage-collect a single channel. Returns true if the file was
 * deleted, false if it did not exist.
 */
export function gcChannel(opts: {
  projectRoot: string;
  sid: string;
  rid: string;
  batchId: string;
}): boolean {
  const channelFile = sharedChannelPath(opts.projectRoot, opts.sid, opts.rid, opts.batchId);
  if (!existsSync(channelFile)) {
    return false;
  }
  // Best-effort delete; R-2 guard not strictly needed (we built the path)
  // but kept for safety.
  assertSafeSharedChannelPath(channelFile, opts.projectRoot);
  try {
    const { unlinkSync } = require('node:fs') as typeof import('node:fs');
    unlinkSync(channelFile);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a channel file is older than `SHARED_CHANNEL_TTL_DAYS` days
 * and should be GC'd as an orphan. Returns true if file is missing
 * (already GC'd) or older than TTL.
 */
export function isOrphanChannel(opts: {
  projectRoot: string;
  sid: string;
  rid: string;
  batchId: string;
  now?: Date;
}): boolean {
  const channelFile = sharedChannelPath(opts.projectRoot, opts.sid, opts.rid, opts.batchId);
  if (!existsSync(channelFile)) {
    return true;
  }
  const stat = require('node:fs') as typeof import('node:fs');
  const s = stat.statSync(channelFile);
  const now = opts.now ?? new Date();
  const ageMs = now.getTime() - s.mtimeMs;
  const ttlMs = SHARED_CHANNEL_TTL_DAYS * 24 * 60 * 60 * 1000;
  return ageMs > ttlMs;
}

// ─── internals ───────────────────────────────────────────────────────

function readChannelOrEmpty(channelFile: string, batchId: string): SharedChannel {
  if (!existsSync(channelFile)) {
    const now = new Date().toISOString();
    return { batchId, createdAt: now, updatedAt: now, entries: {} };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(channelFile, 'utf8'));
  } catch {
    const now = new Date().toISOString();
    return { batchId, createdAt: now, updatedAt: now, entries: {} };
  }
  if (!isObject(parsed)) {
    const now = new Date().toISOString();
    return { batchId, createdAt: now, updatedAt: now, entries: {} };
  }
  const obj = parsed as Record<string, unknown>;
  const batchIdField = typeof obj.batchId === 'string' ? obj.batchId : batchId;
  const createdAt = typeof obj.createdAt === 'string' ? obj.createdAt : new Date().toISOString();
  const updatedAt = typeof obj.updatedAt === 'string' ? obj.updatedAt : createdAt;
  const entriesField = isObject(obj.entries) ? (obj.entries as Record<string, unknown>) : {};
  const entries: Record<string, SharedChannelEntry> = {};
  for (const [k, v] of Object.entries(entriesField)) {
    if (isValidEntry(v)) {
      entries[k] = v;
    }
  }
  return { batchId: batchIdField, createdAt, updatedAt, entries };
}

function isValidEntry(v: unknown): v is SharedChannelEntry {
  if (!isObject(v)) return false;
  return (
    typeof v.at === 'string' &&
    typeof v.from === 'string' &&
    typeof v.key === 'string' &&
    isObject(v.value) &&
    typeof v.valueSize === 'number'
  );
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function writeAtomic(path: string, channel: SharedChannel): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(channel, null, 2) + '\n', 'utf8');
  renameSync(tmp, path);
}

/**
 * Compile a simple key pattern with `*` wildcards to a matcher. Only
 * `*` is special; everything else is a literal. `*` matches zero or
 * more characters. Examples:
 *   "rd.*"       matches "rd.completed", "rd.found-blocker"
 *   "*.completed" matches "rd.completed", "qa.completed"
 *   "*"           matches everything
 */
export function compileKeyPattern(pattern: string): (key: string) => boolean {
  if (pattern === '*') {
    return () => true;
  }
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  const re = new RegExp(`^${escaped}$`);
  return (key: string) => re.test(key);
}
