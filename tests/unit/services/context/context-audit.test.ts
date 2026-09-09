// tests/unit/services/context/context-audit.test.ts
//
// Slice 2026-09-10-context-audit-and-discipline (Slice A) — `peaks code
// context-audit` visibility.
//
// Defects this pins:
//   1. NO visibility — `context-now` gave a ratio, never WHAT filled the
//      window; a breakdown grouped by tool + short input key makes the
//      offender nameable.
//   2. duplicate blindness — the same 40 KB command dumped 4× must collapse
//      into ONE group with count=4, not four anonymous rows.
//   3. fail-soft — a missing / oversized / corrupt transcript must return
//      `available: false` with a reason and never throw.
//   4. no content leak — the envelope must never carry tool result text
//      (dumping it would re-create the problem this command measures).
//
// Run with:
//   ./node_modules/.bin/vitest run tests/unit/services/context/context-audit.test.ts

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import {
  auditContext,
  contextAuditKey,
  CONTEXT_AUDIT_DEFAULT_TOP,
  CONTEXT_AUDIT_MAX_TOP,
  normalizeTopN,
} from '~/src/services/context/context-audit';

declareDimensions(
  'tests/unit/services/context/context-audit.test.ts',
  ['behavior', 'render', 'integration'],
  [
    { dim: 'a11y', reason: 'CLI rendering/exit codes are asserted at the command layer; this file exercises the pure service' },
  ],
);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'peaks-context-audit-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function assistantToolUse(id: string, name: string, input: unknown): string {
  return JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
  });
}

function userToolResult(id: string, content: string): string {
  return JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] },
  });
}

function writeTranscript(lines: readonly string[]): string {
  const path = join(dir, 'session.jsonl');
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
  return path;
}

describe('behavior — grouping by (tool, key)', () => {
  it('when the same command runs twice, should collapse into one group with count=2', () => {
    // given: one Bash command whose result was dumped twice (the measured defect)
    const path = writeTranscript([
      assistantToolUse('a', 'Bash', { command: 'peaks memory reindex --json' }),
      userToolResult('a', 'x'.repeat(4000)),
      assistantToolUse('b', 'Bash', { command: 'peaks memory reindex --json' }),
      userToolResult('b', 'y'.repeat(4000)),
    ]);

    // when: the transcript is audited
    const result = auditContext({ transcriptPath: path });

    // then: ONE group, count=2, bytes=8000 — duplicates are visible, not hidden
    expect(result.available).toBe(true);
    expect(result.entryCount).toBe(2);
    expect(result.groupCount).toBe(1);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.tool).toBe('Bash');
    expect(result.entries[0]?.key).toBe('peaks memory reindex --json');
    expect(result.entries[0]?.count).toBe(2);
    expect(result.entries[0]?.bytes).toBe(8000);
    expect(result.totalBytes).toBe(8000);
    // the only group holds 100% — pctOfTotal is a percentage, not a ratio
    expect(result.entries[0]?.pctOfTotal).toBe(100);
  });

  it('when different tools and paths are present, should group separately and sum pct to 1', () => {
    // given: a Bash dump, a Read, and a Grep
    const path = writeTranscript([
      assistantToolUse('a', 'Bash', { command: 'npm run build' }),
      userToolResult('a', 'b'.repeat(1000)),
      assistantToolUse('b', 'Read', { file_path: '/repo/src/services/doctor/index.ts' }),
      userToolResult('b', 'r'.repeat(800)),
      assistantToolUse('c', 'Grep', { pattern: 'TODO', path: 'src' }),
      userToolResult('c', 'g'.repeat(500)),
    ]);

    // when: the transcript is audited
    const result = auditContext({ transcriptPath: path });

    // then: three groups, sorted desc, pct is a percentage summing to ~100
    expect(result.groupCount).toBe(3);
    expect(result.entries.map((e) => e.tool)).toEqual(['Bash', 'Read', 'Grep']);
    // Read key is the last two path segments — short but identifiable
    expect(result.entries[1]?.key).toBe('doctor/index.ts');
    expect(result.entries[2]?.key).toBe('TODO @ src');
    // the top group is 1000 / 2300 = 43.5% (percentage form, one decimal)
    expect(result.entries[0]?.pctOfTotal).toBe(43.5);
    expect(result.entries[0]?.pctOfTotal).toBeGreaterThan(0);
    expect(result.entries[0]?.pctOfTotal).toBeLessThan(100);
    const pctSum = result.entries.reduce((acc, e) => acc + e.pctOfTotal, 0);
    expect(Math.abs(pctSum - 100)).toBeLessThan(1);
  });

  it('when more groups exist than --top, should report groupCount but emit only topN', () => {
    // given: five distinct commands
    const lines: string[] = [];
    for (let i = 0; i < 5; i++) {
      lines.push(assistantToolUse(`t${i}`, 'Bash', { command: `cmd-${i}` }));
      lines.push(userToolResult(`t${i}`, 'z'.repeat((i + 1) * 100)));
    }
    const path = writeTranscript(lines);

    // when: topN is 2
    const result = auditContext({ transcriptPath: path, topN: 2 });

    // then: only 2 rows, but groupCount tells the truth
    expect(result.entries).toHaveLength(2);
    expect(result.groupCount).toBe(5);
    expect(result.topN).toBe(2);
    expect(result.entries[0]?.key).toBe('cmd-4');
  });

  it('when a tool_use has no matching result, should not invent a group', () => {
    // given: a tool_use whose result never landed (interrupted turn)
    const path = writeTranscript([assistantToolUse('a', 'Bash', { command: 'never-ran' })]);

    // when: the transcript is audited
    const result = auditContext({ transcriptPath: path });

    // then: no entries, no bytes
    expect(result.available).toBe(true);
    expect(result.entryCount).toBe(0);
    expect(result.groupCount).toBe(0);
  });
});

describe('behavior — fail-soft unavailability', () => {
  it('when the transcript path does not exist, should return transcript-not-found', () => {
    const result = auditContext({ transcriptPath: join(dir, 'missing.jsonl') });
    expect(result.available).toBe(false);
    expect(result.reason).toBe('transcript-not-found');
    expect(result.entries).toEqual([]);
  });

  it('when no outer session id is available, should return no-outer-session-id', () => {
    const result = auditContext({ outerSessionId: null });
    expect(result.available).toBe(false);
    expect(result.reason).toBe('no-outer-session-id');
  });

  it('when the outer session id resolves to no transcript, should return transcript-not-found via the adapter', () => {
    // given: an id that cannot exist; env={} → detectIdeFromEnv → 'unknown' →
    // the registry narrows to claude-code, whose compact profile owns the locator
    const result = auditContext({ outerSessionId: 'definitely-not-a-real-session-id', env: {} });

    // then: the adapter's locator returned null and the audit degraded softly
    expect(result.available).toBe(false);
    expect(result.reason).toBe('transcript-not-found');
  });

  it('when the detected IDE has no registered adapter, should degrade instead of throwing', () => {
    // given: an env marker for an IDE with no peaks adapter (opencode)
    // when: the audit resolves the transcript
    const result = auditContext({ outerSessionId: 'any-id', env: { OPENCODE: '1' } as NodeJS.ProcessEnv });

    // then: no throw — a typed reason, fail-soft
    expect(result.available).toBe(false);
    expect(result.reason).toBe('transcript-locator-unavailable');
  });

  it('when the active adapter declares a transcript locator, should route through the registry', async () => {
    // given: the vendor-neutral adapter registry
    const { getAdapter } = await import('~/src/services/ide/ide-registry');

    // then: the Claude Code adapter owns the on-disk layout knowledge
    expect(typeof getAdapter('claude-code').compact?.resolveTranscriptPath).toBe('function');
  });

  it('when the transcript exceeds the byte ceiling, should return transcript-too-large', () => {
    const path = writeTranscript([assistantToolUse('a', 'Bash', { command: 'x' })]);
    const result = auditContext({ transcriptPath: path, maxTranscriptBytes: 1 });
    expect(result.available).toBe(false);
    expect(result.reason).toBe('transcript-too-large');
    expect(result.transcriptPath).toBe(path);
  });

  it('when a line is corrupt JSON, should skip it and keep auditing', () => {
    // given: a valid pair, a corrupt line, then another valid pair
    const path = writeTranscript([
      assistantToolUse('a', 'Bash', { command: 'first' }),
      userToolResult('a', '1'.repeat(100)),
      '{"type":"assistant","message":{BROKEN',
      assistantToolUse('b', 'Bash', { command: 'second' }),
      userToolResult('b', '2'.repeat(100)),
    ]);

    // when: the transcript is audited
    const result = auditContext({ transcriptPath: path });

    // then: both valid results counted; the corrupt line is ignored
    expect(result.available).toBe(true);
    expect(result.entryCount).toBe(2);
    expect(result.groupCount).toBe(2);
  });
});

describe('render — envelope shape and no content leak', () => {
  it('when a large result is audited, should never include the result text', () => {
    // given: a result carrying a recognisable secret payload
    const path = writeTranscript([
      assistantToolUse('a', 'Bash', { command: 'cat secrets' }),
      userToolResult('a', 'SECRET_PAYLOAD_MARKER'.repeat(10)),
    ]);

    // when: the audit envelope is serialized
    const result = auditContext({ transcriptPath: path });
    const serialized = JSON.stringify(result);

    // then: byte counts yes, content no
    expect(serialized).not.toContain('SECRET_PAYLOAD_MARKER');
    expect(result.entries[0]?.bytes).toBe('SECRET_PAYLOAD_MARKER'.length * 10);
  });

  it('when topN is omitted, should default to 15', () => {
    const path = writeTranscript([assistantToolUse('a', 'Bash', { command: 'x' })]);
    const result = auditContext({ transcriptPath: path });
    expect(result.topN).toBe(CONTEXT_AUDIT_DEFAULT_TOP);
  });
});

describe('behavior — input normalization', () => {
  it('when --top is out of range, should clamp into [1, MAX]', () => {
    expect(normalizeTopN(0)).toBe(CONTEXT_AUDIT_DEFAULT_TOP);
    expect(normalizeTopN(-3)).toBe(CONTEXT_AUDIT_DEFAULT_TOP);
    expect(normalizeTopN(Number.NaN)).toBe(CONTEXT_AUDIT_DEFAULT_TOP);
    expect(normalizeTopN(3)).toBe(3);
    expect(normalizeTopN(9999)).toBe(CONTEXT_AUDIT_MAX_TOP);
  });

  it('when the key input is unusual, should stay short and non-throwing', () => {
    expect(contextAuditKey('Bash', { command: 'a   b\n\nc' })).toBe('a b c');
    expect(contextAuditKey('Read', { file_path: 'C:\\repo\\src\\a\\b.ts' })).toBe('a/b.ts');
    expect(contextAuditKey('Bash', null)).toBe('');
    expect(contextAuditKey('Unknown', { deep: 'x'.repeat(500) }).length).toBeLessThanOrEqual(80);
  });
});
