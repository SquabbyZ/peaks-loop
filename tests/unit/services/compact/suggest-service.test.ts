/**
 * `peaks compact suggest` / `peaks compact dry-run` — service unit tests.
 *
 * Tests the data-source ladder (usage.jsonl -> env-var -> none) and
 * the two-signal threshold logic. The CLI envelope is covered by
 * tests/unit/cli/compact-command.test.ts; this file is the
 * service-level test surface.
 */
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CONTEXT_INTERVAL,
  DEFAULT_CONTEXT_THRESHOLD_1M,
  DEFAULT_CONTEXT_THRESHOLD_200K,
  DEFAULT_TOOL_CALL_THRESHOLD,
  dryRunCompact,
  suggestCompact
} from '../../../../src/services/compact/suggest-service.js';

const TEMPS: string[] = [];

function tempProject(): string {
  const p = mkdtempSync(join(tmpdir(), 'peaks-suggest-'));
  TEMPS.push(p);
  return p;
}

function seedUsage(projectRoot: string, sid: string, row: { tokens?: number; toolCalls?: number; modelKind?: '200k' | '1m' }): void {
  const dir = join(projectRoot, '.peaks', '_runtime', sid);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'usage.jsonl'),
    JSON.stringify({ ts: new Date().toISOString(), ...row }) + '\n',
    'utf8'
  );
}

afterEach(() => {
  while (TEMPS.length > 0) {
    const p = TEMPS.pop();
    if (p) rmSync(p, { recursive: true, force: true });
  }
});

describe('default thresholds', () => {
  it('matches the strategic-compact SKILL.md defaults', () => {
    expect(DEFAULT_CONTEXT_THRESHOLD_200K).toBe(160_000);
    expect(DEFAULT_CONTEXT_THRESHOLD_1M).toBe(250_000);
    expect(DEFAULT_CONTEXT_INTERVAL).toBe(60_000);
    expect(DEFAULT_TOOL_CALL_THRESHOLD).toBe(50);
  });
});

describe('suggestCompact', () => {
  it('returns dataUnavailable=true when no session and no env', () => {
    const project = tempProject();
    const result = suggestCompact({ projectRoot: project, sessionId: null });
    expect(result.shouldSuggest).toBe(false);
    expect(result.dataUnavailable).toBe(true);
    expect(result.source).toBe('none');
  });

  it('reads from usage.jsonl when present', () => {
    const project = tempProject();
    const sid = '2026-07-01-suggest-svc-1';
    seedUsage(project, sid, { tokens: 50_000, toolCalls: 10 });
    const result = suggestCompact({ projectRoot: project, sessionId: sid });
    expect(result.source).toBe('usage-jsonl');
    expect(result.tokensUsed).toBe(50_000);
    expect(result.toolCalls).toBe(10);
    expect(result.shouldSuggest).toBe(false);
  });

  it('falls back to env vars when no usage.jsonl', () => {
    const project = tempProject();
    const result = suggestCompact({
      projectRoot: project,
      sessionId: null,
      env: { PEAKS_CONTEXT_TOKENS: '500', PEAKS_TOOL_CALLS: '0', COMPACT_CONTEXT_THRESHOLD: '100' }
    });
    expect(result.source).toBe('env-vars');
    expect(result.tokensUsed).toBe(500);
    expect(result.shouldSuggest).toBe(true);
  });

  it('detects a 1m window from modelKind=1m', () => {
    const project = tempProject();
    const sid = '2026-07-01-suggest-svc-1m';
    seedUsage(project, sid, { tokens: 200_000, toolCalls: 0, modelKind: '1m' });
    const result = suggestCompact({ projectRoot: project, sessionId: sid });
    expect(result.windowKind).toBe('1m');
    expect(result.thresholds.contextTokens).toBe(DEFAULT_CONTEXT_THRESHOLD_1M);
    expect(result.shouldSuggest).toBe(false);
  });

  it('detects a 1m window heuristically when tokens exceed 200k', () => {
    const project = tempProject();
    const sid = '2026-07-01-suggest-svc-1m-heuristic';
    seedUsage(project, sid, { tokens: 250_000, toolCalls: 0 });
    const result = suggestCompact({ projectRoot: project, sessionId: sid });
    expect(result.windowKind).toBe('1m');
  });

  it('respects COMPACT_CONTEXT_THRESHOLD=0 (disable context signal)', () => {
    const project = tempProject();
    const sid = '2026-07-01-suggest-svc-disabled';
    seedUsage(project, sid, { tokens: 999_999, toolCalls: 0 });
    const result = suggestCompact({
      projectRoot: project,
      sessionId: sid,
      env: { COMPACT_CONTEXT_THRESHOLD: '0' }
    });
    expect(result.shouldSuggest).toBe(false);
  });

  it('fires the tool-call signal when below context threshold but above tool-call threshold', () => {
    const project = tempProject();
    const sid = '2026-07-01-suggest-svc-tools';
    seedUsage(project, sid, { tokens: 1_000, toolCalls: 60 });
    const result = suggestCompact({ projectRoot: project, sessionId: sid });
    expect(result.shouldSuggest).toBe(true);
    expect(result.reason).toMatch(/tool-calls >= 50/);
  });
});

describe('dryRunCompact', () => {
  it('returns action=compact when phase pair resolves to severity=yes', () => {
    const project = tempProject();
    const sid = '2026-07-01-dryrun-svc-1';
    seedUsage(project, sid, { tokens: 0, toolCalls: 0 });
    const result = dryRunCompact({
      projectRoot: project,
      sessionId: sid,
      from: 'research',
      to: 'planning'
    });
    expect(result.action).toBe('compact');
    expect(result.recommend.severity).toBe('yes');
    expect(result.survival.persists.length).toBeGreaterThanOrEqual(5);
  });

  it('returns action=skip when no signal and no phase pair', () => {
    const project = tempProject();
    const result = dryRunCompact({ projectRoot: project, sessionId: null });
    expect(result.action).toBe('skip');
    expect(result.recommend.from).toBeNull();
    expect(result.recommend.to).toBeNull();
  });

  it('returns action=skip when phase pair resolves to severity=no', () => {
    const project = tempProject();
    const sid = '2026-07-01-dryrun-svc-2';
    seedUsage(project, sid, { tokens: 0, toolCalls: 0 });
    const result = dryRunCompact({
      projectRoot: project,
      sessionId: sid,
      from: 'research',
      to: 'research'
    });
    expect(result.action).toBe('skip');
    expect(result.recommend.severity).toBe('no');
  });
});
