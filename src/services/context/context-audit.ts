/**
 * `peaks code context-audit` — what actually fills the orchestrator's window.
 *
 * Slice 2026-09-10-context-audit-and-discipline (Slice A).
 *
 * Why this exists: `peaks code context-now` reports a RATIO only. Nothing
 * reported WHAT occupies the window, so the same 40K-token mistake (dumping a
 * full `peaks memory reindex --json` array four times in one session) was
 * invisible until the window was 68% gone. The IDE transcript already holds
 * per-message tool results, so the breakdown is derivable locally, with zero
 * tokens spent asking a model.
 *
 * Contract:
 *   - READ-ONLY. The transcript is never modified.
 *   - FAIL-SOFT. A missing / oversized / corrupt transcript yields
 *     `available: false` plus a machine-readable `reason`. Never throws,
 *     never blocks a workflow, never exits non-zero on its own.
 *   - NO CONTENT. The envelope carries tool names, short command/path keys
 *     and byte counts — never the tool result text itself (dumping it would
 *     re-create the very problem this command measures).
 *   - BOUNDED MEMORY. The transcript can be tens of MB; it is streamed in
 *     fixed-size chunks with a carried partial line, never read whole.
 *
 * Grouping key = `(tool name, short input key)`. The key is a *stable
 * summary* of the tool input — the Bash command line, the file path tail, the
 * grep pattern — so "4 × the same 40KB reindex dump" collapses into ONE row
 * with `count: 4` instead of four anonymous entries.
 */

import { closeSync, openSync, readSync, statSync } from 'node:fs';

import { getAdapter } from '../ide/ide-registry.js';
import type { IdeId } from '../ide/ide-types.js';
import { detectIdeFromEnv } from './ide-detect.js';

/** Default number of top entries emitted. */
export const CONTEXT_AUDIT_DEFAULT_TOP = 15;
/** Hard ceiling for `--top` — the envelope must stay small by construction. */
export const CONTEXT_AUDIT_MAX_TOP = 100;
/** Transcripts larger than this are reported `available:false` (fail-soft). */
export const CONTEXT_AUDIT_MAX_TRANSCRIPT_BYTES = 256 * 1024 * 1024;
/** Streaming chunk size (bounded memory on multi-MB transcripts). */
const SCAN_CHUNK_BYTES = 1024 * 1024;
/** Max characters kept in a group key — keys are labels, not payloads. */
const KEY_MAX_CHARS = 100;

export interface ContextAuditEntry {
  /** Tool name (`Bash`, `Read`, `Grep`, …), or `unknown` when unmatched. */
  readonly tool: string;
  /** Short, stable summary of the tool input (command line / path tail / pattern). */
  readonly key: string;
  /** Total UTF-8 bytes of every tool result in this group. */
  readonly bytes: number;
  /** `bytes / totalBytes`, rounded to 4 decimals. */
  readonly pctOfTotal: number;
  /** How many tool results landed in this group. */
  readonly count: number;
}

export interface ContextAuditResult {
  /** False when the transcript could not be read; see `reason`. */
  readonly available: boolean;
  /** Machine-readable unavailability reason (`null` when available). */
  readonly reason: string | null;
  /** Absolute transcript path, or `null` when unresolved. */
  readonly transcriptPath: string | null;
  /** Total UTF-8 bytes of all tool results seen. */
  readonly totalBytes: number;
  /** Number of tool-result entries seen. */
  readonly entryCount: number;
  /** Distinct `(tool, key)` groups — always ≥ `entries.length`. */
  readonly groupCount: number;
  /** Number of top entries requested. */
  readonly topN: number;
  /** Top-N groups, sorted by bytes descending. */
  readonly entries: readonly ContextAuditEntry[];
}

export interface ContextAuditInput {
  /** Outer (harness) session id — the transcript is named by it. */
  readonly outerSessionId?: string | null;
  /** How many top entries to emit. Clamped to `[1, CONTEXT_AUDIT_MAX_TOP]`. */
  readonly topN?: number;
  /** Explicit transcript path override (test seam; skips the locator). */
  readonly transcriptPath?: string | null;
  /** Override the too-large threshold (test seam; default 256 MB). */
  readonly maxTranscriptBytes?: number;
  /** Env used to detect the active IDE (default `process.env`). */
  readonly env?: NodeJS.ProcessEnv;
}

interface ToolUseRef {
  readonly name: string;
  readonly input: unknown;
}

interface MutableGroup {
  readonly tool: string;
  readonly key: string;
  bytes: number;
  count: number;
}

/** Clamp a caller-supplied `--top` into the documented range. */
export function normalizeTopN(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : CONTEXT_AUDIT_DEFAULT_TOP;
  if (n < 1) return CONTEXT_AUDIT_DEFAULT_TOP;
  return Math.min(n, CONTEXT_AUDIT_MAX_TOP);
}

function clip(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}

/** Last `n` path segments — keeps `Read` / `Edit` keys short but identifiable. */
function tailPath(value: string, n: number): string {
  const parts = value.split(/[\\/]/).filter((p) => p.length > 0);
  return parts.slice(Math.max(0, parts.length - n)).join('/');
}

/**
 * Build the stable group key for one tool call. Unknown tools fall back to a
 * clipped JSON rendering of their input so the group is still recognizable.
 */
export function contextAuditKey(tool: string, input: unknown): string {
  const read = (v: unknown): string => (typeof v === 'string' ? v : '');
  if (typeof input !== 'object' || input === null) return '';
  const i = input as Record<string, unknown>;
  switch (tool) {
    case 'Bash':
      return clip(read(i.command), KEY_MAX_CHARS);
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return clip(tailPath(read(i.file_path), 2), KEY_MAX_CHARS);
    case 'Grep':
    case 'Glob':
      return clip(`${read(i.pattern)} @ ${read(i.path) || '.'}`, KEY_MAX_CHARS);
    case 'Task':
    case 'Agent':
      return clip(read(i.description) || read(i.subagent_type), 60);
    default: {
      let json: string;
      try {
        json = JSON.stringify(input) ?? '';
      } catch {
        json = '';
      }
      return clip(json, 80);
    }
  }
}

/** UTF-8 size of a `tool_result.content` payload (string | array | object). */
function toolResultBytes(content: unknown): number {
  if (typeof content === 'string') return Buffer.byteLength(content, 'utf8');
  if (Array.isArray(content)) {
    let total = 0;
    for (const part of content) {
      if (typeof part === 'string') {
        total += Buffer.byteLength(part, 'utf8');
      } else if (typeof part === 'object' && part !== null) {
        const text = (part as Record<string, unknown>).text;
        total += typeof text === 'string'
          ? Buffer.byteLength(text, 'utf8')
          : Buffer.byteLength(JSON.stringify(part) ?? '', 'utf8');
      }
    }
    return total;
  }
  if (content === undefined || content === null) return 0;
  try {
    return Buffer.byteLength(JSON.stringify(content) ?? '', 'utf8');
  } catch {
    return 0;
  }
}

function emptyResult(partial: Partial<ContextAuditResult>): ContextAuditResult {
  return {
    available: false,
    reason: null,
    transcriptPath: null,
    totalBytes: 0,
    entryCount: 0,
    groupCount: 0,
    topN: CONTEXT_AUDIT_DEFAULT_TOP,
    entries: [],
    ...partial,
  };
}

/**
 * Stream the transcript once, folding every tool result into its
 * `(tool, key)` group. Pure bookkeeping — no content is retained.
 */
function scanTranscript(filePath: string, topN: number): ContextAuditResult {
  const toolUses = new Map<string, ToolUseRef>();
  const groups = new Map<string, MutableGroup>();
  let totalBytes = 0;
  let entryCount = 0;

  const fd = openSync(filePath, 'r');
  try {
    const size = statSync(filePath).size;
    let position = 0;
    let carry = '';
    while (position < size) {
      const readLen = Math.min(SCAN_CHUNK_BYTES, size - position);
      const buf = Buffer.alloc(readLen);
      const bytesRead = readSync(fd, buf, 0, readLen, position);
      if (bytesRead <= 0) break;
      position += bytesRead;
      const lines = (carry + buf.toString('utf8', 0, bytesRead)).split('\n');
      // The last element is a partial line (or the trailing empty string).
      carry = lines.pop() ?? '';
      for (const line of lines) {
        if (line.length === 0) continue;
        const folded = foldLine(line, toolUses, groups);
        totalBytes += folded.bytes;
        entryCount += folded.count;
      }
    }
    if (carry.length > 0) {
      const folded = foldLine(carry, toolUses, groups);
      totalBytes += folded.bytes;
      entryCount += folded.count;
    }
  } finally {
    try {
      closeSync(fd);
    } catch {
      /* best-effort close */
    }
  }

  const entries: ContextAuditEntry[] = [...groups.values()]
    .map((g) => ({
      tool: g.tool,
      key: g.key,
      bytes: g.bytes,
      pctOfTotal: totalBytes > 0 ? Math.round((g.bytes / totalBytes) * 10_000) / 10_000 : 0,
      count: g.count,
    }))
    .sort((a, b) => b.bytes - a.bytes || a.tool.localeCompare(b.tool) || a.key.localeCompare(b.key));

  return {
    available: true,
    reason: null,
    transcriptPath: filePath,
    totalBytes,
    entryCount,
    groupCount: entries.length,
    topN,
    entries: entries.slice(0, topN),
  };
}

/**
 * Fold ONE jsonl line into the running state. Returns the byte/count delta
 * contributed by this line. Corrupt / non-JSON lines are skipped silently —
 * a truncated tail must not fail the audit.
 */
function foldLine(
  line: string,
  toolUses: Map<string, ToolUseRef>,
  groups: Map<string, MutableGroup>,
): { bytes: number; count: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { bytes: 0, count: 0 };
  }
  if (typeof parsed !== 'object' || parsed === null) return { bytes: 0, count: 0 };
  const record = parsed as Record<string, unknown>;
  const message = record.message;
  if (typeof message !== 'object' || message === null) return { bytes: 0, count: 0 };
  const content = (message as Record<string, unknown>).content;
  if (!Array.isArray(content)) return { bytes: 0, count: 0 };

  let bytes = 0;
  let count = 0;
  for (const part of content) {
    if (typeof part !== 'object' || part === null) continue;
    const item = part as Record<string, unknown>;
    if (item.type === 'tool_use') {
      const id = item.id;
      const name = item.name;
      if (typeof id === 'string' && typeof name === 'string') {
        toolUses.set(id, { name, input: item.input });
      }
      continue;
    }
    if (item.type !== 'tool_result') continue;
    const ref = typeof item.tool_use_id === 'string' ? toolUses.get(item.tool_use_id) : undefined;
    const tool = ref?.name ?? 'unknown';
    const key = ref === undefined ? '' : contextAuditKey(tool, ref.input);
    const size = toolResultBytes(item.content);
    const groupKey = `${tool} ${key}`;
    const group = groups.get(groupKey);
    if (group === undefined) {
      groups.set(groupKey, { tool, key, bytes: size, count: 1 });
    } else {
      group.bytes += size;
      group.count += 1;
    }
    bytes += size;
    count += 1;
  }
  return { bytes, count };
}

/**
 * Audit the CURRENT session's transcript. Never throws.
 *
 * Unavailability reasons (all return `available: false`, exit code stays 0):
 *   - `no-outer-session-id`  — the peaks session has no bound outer id
 *   - `transcript-locator-unavailable` — the active IDE adapter does not
 *                              declare `compact.resolveTranscriptPath`
 *   - `transcript-not-found` — the adapter locator returned null
 *   - `transcript-too-large` — above `CONTEXT_AUDIT_MAX_TRANSCRIPT_BYTES`
 *   - `transcript-unreadable`— stat/open failed
 *   - `audit-failed`         — any unexpected internal error
 */
export function auditContext(input: ContextAuditInput = {}): ContextAuditResult {
  const topN = normalizeTopN(input.topN);
  const explicit = input.transcriptPath;
  let transcriptPath: string | null = null;
  if (typeof explicit === 'string' && explicit.length > 0) {
    transcriptPath = explicit;
  } else {
    const outerSessionId = input.outerSessionId;
    if (typeof outerSessionId !== 'string' || outerSessionId.length === 0) {
      return emptyResult({ reason: 'no-outer-session-id', topN });
    }
    // Vendor-neutral: the adapter owns the on-disk layout. Mirrors
    // `readContextPercent`'s narrowing of the detected kind to a
    // registered adapter id ('unknown' → claude-code default). Both the
    // registry lookup and the locator call are guarded — an unregistered
    // detected id (e.g. an IDE without a peaks adapter yet) or an adapter
    // bug must degrade, never throw.
    let transcriptPathOrNull: string | null;
    try {
      const detected = detectIdeFromEnv(input.env ?? process.env);
      const ideId: IdeId = (detected === 'unknown' ? 'claude-code' : detected) as IdeId;
      const locate = getAdapter(ideId).compact?.resolveTranscriptPath;
      if (locate === undefined) {
        return emptyResult({ reason: 'transcript-locator-unavailable', topN });
      }
      transcriptPathOrNull = locate(outerSessionId);
    } catch {
      return emptyResult({ reason: 'transcript-locator-unavailable', topN });
    }
    if (transcriptPathOrNull === null) {
      return emptyResult({ reason: 'transcript-not-found', topN });
    }
    transcriptPath = transcriptPathOrNull;
  }

  const maxBytes = typeof input.maxTranscriptBytes === 'number' && Number.isFinite(input.maxTranscriptBytes) && input.maxTranscriptBytes >= 0
    ? input.maxTranscriptBytes
    : CONTEXT_AUDIT_MAX_TRANSCRIPT_BYTES;

  try {
    const size = statSync(transcriptPath).size;
    if (size > maxBytes) {
      return emptyResult({ reason: 'transcript-too-large', transcriptPath, topN });
    }
    return scanTranscript(transcriptPath, topN);
  } catch (err) {
    const code = (err as { code?: string }).code;
    const reason = code === 'ENOENT' ? 'transcript-not-found'
      : code === 'EACCES' || code === 'EPERM' ? 'transcript-unreadable'
      : 'audit-failed';
    return emptyResult({ reason, transcriptPath, topN });
  }
}
