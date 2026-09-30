/**
 * Transcript scan + envelope assembly for `peaks code context-audit`.
 *
 * Moved out of `./context-audit.ts` (wave 3, eslint-family sweep). The
 * streaming loop, the fold bookkeeping, the `pctOfTotal` rounding and the
 * group ordering are the report's contract: every line below is copied
 * exactly — same predicates, same throw points, same accumulator updates in
 * the same positions. Only pure sub-blocks whose control flow copies 1:1
 * were extracted; the read-accumulator loop and the per-line delta
 * accumulation stay in the functions that own them.
 */

import { closeSync, openSync, readSync, statSync } from 'node:fs';

import { contextAuditKey } from './context-audit-keys.js';
import {
  CONTEXT_AUDIT_DEFAULT_TOP,
  CONTEXT_AUDIT_SCAN_CHUNK_BYTES
} from './context-audit-limits.js';
import type {
  ContextAuditEntry,
  ContextAuditResult,
  MutableGroup,
  ToolUseRef
} from './context-audit-types.js';

/** Divisor that renders a ratio as a one-decimal percentage (× 100 / × 10). */
const ONE_DECIMAL_DIVISOR = 10;

/** Fail-soft envelope: every field zeroed/emptied, only the partial set. */
export function emptyResult(partial: Partial<ContextAuditResult>): ContextAuditResult {
  return {
    available: false,
    reason: null,
    transcriptPath: null,
    totalBytes: 0,
    entryCount: 0,
    groupCount: 0,
    topN: CONTEXT_AUDIT_DEFAULT_TOP,
    entries: [],
    ...partial
  };
}

/**
 * Map an `auditTranscriptFile` failure to its machine-readable
 * unavailability reason. Same ENOENT / EACCES+EPERM / other ternary chain
 * and reason strings as before the move.
 */
function errorAuditReason(err: unknown): string {
  const code = (err as { code?: string }).code;
  return code === 'ENOENT'
    ? 'transcript-not-found'
    : code === 'EACCES' || code === 'EPERM'
      ? 'transcript-unreadable'
      : 'audit-failed';
}

/** UTF-8 size of a JSON value that survived neither the string nor array path. */
function jsonBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
  } catch {
    return 0;
  }
}

/** Byte size of one `tool_result.content` array element (same fall-through). */
function contentPartBytes(part: unknown): number {
  if (typeof part === 'string') {
    return Buffer.byteLength(part, 'utf8');
  }
  if (typeof part === 'object' && part !== null) {
    const text = (part as Record<string, unknown>).text;
    return typeof text === 'string'
      ? Buffer.byteLength(text, 'utf8')
      : Buffer.byteLength(JSON.stringify(part) ?? '', 'utf8');
  }
  return 0;
}

/** UTF-8 size of a `tool_result.content` payload (string | array | object). */
function toolResultBytes(content: unknown): number {
  if (typeof content === 'string') return Buffer.byteLength(content, 'utf8');
  if (Array.isArray(content)) {
    let total = 0;
    for (const part of content) {
      total += contentPartBytes(part);
    }
    return total;
  }
  if (content === undefined || content === null) return 0;
  return jsonBytes(content);
}

/** Pull `message.content` out of a parsed record; `null` when shape differs. */
function extractMessageContent(parsed: unknown): unknown[] | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const message = record.message;
  if (typeof message !== 'object' || message === null) return null;
  const content = (message as Record<string, unknown>).content;
  if (!Array.isArray(content)) return null;
  return content as unknown[];
}

function rememberToolUse(item: Record<string, unknown>, toolUses: Map<string, ToolUseRef>): void {
  const id = item.id;
  const name = item.name;
  if (typeof id === 'string' && typeof name === 'string') {
    toolUses.set(id, { name, input: item.input });
  }
}

/** Fold one `tool_result` part into its group; returns the byte delta. */
function addToolResult(
  item: Record<string, unknown>,
  toolUses: Map<string, ToolUseRef>,
  groups: Map<string, MutableGroup>
): number {
  const ref = typeof item.tool_use_id === 'string' ? toolUses.get(item.tool_use_id) : undefined;
  const tool = ref?.name ?? 'unknown';
  const key = ref === undefined ? '' : contextAuditKey(tool, ref.input);
  const size = toolResultBytes(item.content);
  const groupKey = `${tool} ${key}`;
  const group = groups.get(groupKey);
  if (group === undefined) {
    groups.set(groupKey, { tool, key, bytes: size, count: 1 });
  } else {
    group.bytes += size;
    group.count += 1;
  }
  return size;
}

/**
 * Fold ONE jsonl line into the running state. Returns the byte/count delta
 * contributed by this line. Corrupt / non-JSON lines are skipped silently —
 * a truncated tail must not fail the audit.
 */
function foldLine(
  line: string,
  toolUses: Map<string, ToolUseRef>,
  groups: Map<string, MutableGroup>
): { bytes: number; count: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { bytes: 0, count: 0 };
  }
  const content = extractMessageContent(parsed);
  if (content === null) return { bytes: 0, count: 0 };

  let bytes = 0;
  let count = 0;
  for (const part of content) {
    if (typeof part !== 'object' || part === null) continue;
    const item = part as Record<string, unknown>;
    if (item.type === 'tool_use') {
      rememberToolUse(item, toolUses);
      continue;
    }
    if (item.type !== 'tool_result') continue;
    const size = addToolResult(item, toolUses, groups);
    bytes += size;
    count += 1;
  }
  return { bytes, count };
}

/** Percentage in [0, 100], one decimal — see ContextAuditEntry.pctOfTotal. */
function percentOfTotal(bytes: number, totalBytes: number): number {
  return totalBytes > 0 ? Math.round((bytes / totalBytes) * 1000) / ONE_DECIMAL_DIVISOR : 0;
}

/** Group → entries, sorted by bytes descending (ties: tool, then key). */
function rankGroups(groups: Iterable<MutableGroup>, totalBytes: number): ContextAuditEntry[] {
  const entries: ContextAuditEntry[] = [...groups]
    .map((g) => ({
      tool: g.tool,
      key: g.key,
      bytes: g.bytes,
      pctOfTotal: percentOfTotal(g.bytes, totalBytes),
      count: g.count
    }))
    .sort(
      (a, b) => b.bytes - a.bytes || a.tool.localeCompare(b.tool) || a.key.localeCompare(b.key)
    );
  return entries;
}

/**
 * Stream the transcript once, folding every tool result into its
 * `(tool, key)` group. Pure bookkeeping — no content is retained.
 */
function streamTranscript(
  filePath: string,
  toolUses: Map<string, ToolUseRef>,
  groups: Map<string, MutableGroup>
): { totalBytes: number; entryCount: number } {
  let totalBytes = 0;
  let entryCount = 0;

  const fd = openSync(filePath, 'r');
  try {
    const size = statSync(filePath).size;
    let position = 0;
    let carry = '';
    while (position < size) {
      const readLen = Math.min(CONTEXT_AUDIT_SCAN_CHUNK_BYTES, size - position);
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
  return { totalBytes, entryCount };
}

function scanTranscript(filePath: string, topN: number): ContextAuditResult {
  const toolUses = new Map<string, ToolUseRef>();
  const groups = new Map<string, MutableGroup>();
  const totals = streamTranscript(filePath, toolUses, groups);
  const entries = rankGroups(groups.values(), totals.totalBytes);

  return {
    available: true,
    reason: null,
    transcriptPath: filePath,
    totalBytes: totals.totalBytes,
    entryCount: totals.entryCount,
    groupCount: entries.length,
    topN,
    entries: entries.slice(0, topN)
  };
}

/**
 * Stat, size-check and stream a resolved transcript. Fail-soft: every stat
 * / open / read failure maps to its documented reason via `errorAuditReason`.
 */
export function auditTranscriptFile(
  transcriptPath: string,
  maxBytes: number,
  topN: number
): ContextAuditResult {
  try {
    const size = statSync(transcriptPath).size;
    if (size > maxBytes) {
      return emptyResult({ reason: 'transcript-too-large', transcriptPath, topN });
    }
    return scanTranscript(transcriptPath, topN);
  } catch (err) {
    return emptyResult({ reason: errorAuditReason(err), transcriptPath, topN });
  }
}
