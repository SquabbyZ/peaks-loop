/**
 * Slice-boundary pre-compact hook — service unit tests.
 *
 * The hook reads the latest `.peaks/_runtime/<sid>/usage.jsonl` row,
 * maps the token count to a ratio on a 200k window, and writes a
 * `context-fill` checkpoint ONLY when the ratio is in the 0.85–0.95
 * pre-compact zone (per auto-compact-types.ts). The 0.95+ red-line
 * zone does NOT change behaviour — the existing auto-compact
 * orchestrator still gates that path.
 */
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AUTO_COMPACT_PRE_COMPACT_RATIO,
  AUTO_COMPACT_RED_LINE_RATIO
} from '../../../../src/services/context/auto-compact-types.js';
import { maybePreCompactCheckpoint } from '../../../../src/services/compact/request-transition-hook.js';

const TEMPS: string[] = [];

function tempProject(): string {
  const p = mkdtempSync(join(tmpdir(), 'peaks-hook-'));
  TEMPS.push(p);
  return p;
}

function seedSession(projectRoot: string, sid: string): void {
  const dir = join(projectRoot, '.peaks', '_runtime', sid);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'session.json'), JSON.stringify({ sessionId: sid }), 'utf8');
}

function seedUsage(projectRoot: string, sid: string, row: { tokens: number; capacityTokens?: number }): void {
  const dir = join(projectRoot, '.peaks', '_runtime', sid);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'usage.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...row }) + '\n', 'utf8');
}

afterEach(() => {
  while (TEMPS.length > 0) {
    const p = TEMPS.pop();
    if (p) rmSync(p, { recursive: true, force: true });
  }
});

describe('maybePreCompactCheckpoint', () => {
  it('returns triggered=false when no usage.jsonl is present', () => {
    const project = tempProject();
    const sid = '2026-07-01-hook-no-usage';
    seedSession(project, sid);
    const out = maybePreCompactCheckpoint({
      projectRoot: project,
      sessionId: sid,
      transitionKey: 'rd:qa-handoff'
    });
    expect(out.triggered).toBe(false);
    expect(out.checkpointPath).toBeNull();
    expect(out.zone).toBe('none');
  });

  it('returns triggered=false when ratio is below 0.85', () => {
    const project = tempProject();
    const sid = '2026-07-01-hook-low';
    seedSession(project, sid);
    seedUsage(project, sid, { tokens: 100_000 }); // 0.50 on 200k
    const out = maybePreCompactCheckpoint({
      projectRoot: project,
      sessionId: sid,
      transitionKey: 'rd:qa-handoff'
    });
    expect(out.triggered).toBe(false);
    expect(out.zone).toBe('soft-warn');
  });

  it('returns triggered=true and writes a checkpoint when ratio is in 0.85-0.95', () => {
    const project = tempProject();
    const sid = '2026-07-01-hook-zone';
    seedSession(project, sid);
    const preTokens = AUTO_COMPACT_PRE_COMPACT_RATIO * 200_000;
    const postTokens = AUTO_COMPACT_RED_LINE_RATIO * 200_000;
    const midTokens = Math.round((preTokens + postTokens) / 2);
    seedUsage(project, sid, { tokens: midTokens });
    const out = maybePreCompactCheckpoint({
      projectRoot: project,
      sessionId: sid,
      transitionKey: 'rd:qa-handoff'
    });
    expect(out.triggered).toBe(true);
    expect(out.zone).toBe('pre-compact');
    expect(out.checkpointPath).not.toBeNull();
    expect(existsSync(out.checkpointPath as string)).toBe(true);
  });

  it('returns triggered=false when ratio is at or above 0.95 (red line)', () => {
    const project = tempProject();
    const sid = '2026-07-01-hook-redline';
    seedSession(project, sid);
    seedUsage(project, sid, { tokens: Math.round(AUTO_COMPACT_RED_LINE_RATIO * 200_000) });
    const out = maybePreCompactCheckpoint({
      projectRoot: project,
      sessionId: sid,
      transitionKey: 'rd:qa-handoff'
    });
    // The hook is the 0.85-0.95 zone only; the red line is gated by
    // the existing auto-compact orchestrator.
    expect(out.triggered).toBe(false);
    expect(out.zone).toBe('red-line');
  });

  it('never throws; returns a no-op result on unexpected errors', () => {
    const project = tempProject();
    const out = maybePreCompactCheckpoint({
      projectRoot: project,
      sessionId: '2026-07-01-hook-bad',
      transitionKey: 'rd:qa-handoff'
    });
    expect(out.triggered).toBe(false);
    expect(out.zone).toBe('none');
  });
});
