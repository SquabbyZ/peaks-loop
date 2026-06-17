/**
 * Slice 2026-06-16-playwright-restart-loop — G1 + G4 + G5.
 *
 * Synthetic event-log fixture: build a sequence of
 * `mcp__playwright__browser_*` invocations with timestamps and
 * assert the detector:
 *   - stays silent under the threshold
 *   - flips to halt at the configured threshold
 *   - records a `spurious_restart` JSONL line per rapid close→navigate
 *
 * The detector must NOT call playwright MCP at test time — it
 * operates on the synthetic log we feed in.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  BrowserRestartDetector,
  type BrowserEvent
} from '../../../src/services/qa/browser-restart-detector.js';
import { BrowserEventLogger } from '../../../src/services/qa/browser-event-logger.js';

describe('services/qa/browser-restart-detector (G1)', () => {
  it('does not halt when the slice has fewer than the threshold restarts', () => {
    const detector = new BrowserRestartDetector({ maxRestarts: 3, windowMs: 30_000 });
    const baseTs = Date.parse('2026-06-16T10:00:00.000Z');
    // 2 close→navigate cycles: close, navigate, close, navigate
    const events: BrowserEvent[] = [
      { tool: 'browser_close', ts: '' },
      { tool: 'browser_navigate', ts: '' },
      { tool: 'browser_close', ts: '' },
      { tool: 'browser_navigate', ts: '' }
    ].map((e, i) => ({ ...e, ts: new Date(baseTs + i * 1000).toISOString() }));
    for (const ev of events) detector.record(ev);
    expect(detector.shouldHalt()).toBe(false);
    expect(detector.restartCount()).toBe(2);
  });

  it('halts when the close→navigate count reaches the threshold (N=3)', () => {
    const detector = new BrowserRestartDetector({ maxRestarts: 3, windowMs: 30_000 });
    const baseTs = Date.parse('2026-06-16T10:00:00.000Z');
    // 3 cycles: close → navigate × 3
    const events: BrowserEvent[] = [];
    for (let i = 0; i < 3; i++) {
      events.push({ tool: 'browser_close', ts: new Date(baseTs + i * 2000).toISOString() });
      events.push({ tool: 'browser_navigate', ts: new Date(baseTs + i * 2000 + 500).toISOString() });
    }
    for (const ev of events) detector.record(ev);
    expect(detector.restartCount()).toBe(3);
    expect(detector.shouldHalt()).toBe(true);
    const diagnostic = detector.diagnostic();
    expect(diagnostic).toContain('playwright browser restart loop detected');
    expect(diagnostic).toContain('3 restarts');
  });

  it('respects a custom --max-browser-restarts threshold', () => {
    const detector = new BrowserRestartDetector({ maxRestarts: 5, windowMs: 30_000 });
    const baseTs = Date.parse('2026-06-16T10:00:00.000Z');
    // 4 cycles — under the 5 threshold
    const events: BrowserEvent[] = [];
    for (let i = 0; i < 4; i++) {
      events.push({ tool: 'browser_close', ts: new Date(baseTs + i * 2000).toISOString() });
      events.push({ tool: 'browser_navigate', ts: new Date(baseTs + i * 2000 + 500).toISOString() });
    }
    for (const ev of events) detector.record(ev);
    expect(detector.shouldHalt()).toBe(false);
    expect(detector.restartCount()).toBe(4);
  });

  it('ignores browser_close calls that are NOT followed by browser_navigate within the window', () => {
    const detector = new BrowserRestartDetector({ maxRestarts: 3, windowMs: 30_000 });
    const baseTs = Date.parse('2026-06-16T10:00:00.000Z');
    // Single close at t=0; no navigate within 30s → not a restart
    detector.record({ tool: 'browser_close', ts: new Date(baseTs).toISOString() });
    detector.record({ tool: 'browser_close', ts: new Date(baseTs + 5_000).toISOString() });
    detector.record({ tool: 'browser_close', ts: new Date(baseTs + 10_000).toISOString() });
    expect(detector.restartCount()).toBe(0);
    expect(detector.shouldHalt()).toBe(false);
  });

  it('--no-restart-detector disables the detector entirely', () => {
    const detector = new BrowserRestartDetector({ maxRestarts: 3, windowMs: 30_000, enabled: false });
    const baseTs = Date.parse('2026-06-16T10:00:00.000Z');
    for (let i = 0; i < 10; i++) {
      detector.record({ tool: 'browser_navigate', ts: new Date(baseTs + i * 2000).toISOString() });
      detector.record({ tool: 'browser_close', ts: new Date(baseTs + i * 2000 + 500).toISOString() });
    }
    expect(detector.restartCount()).toBe(0);
    expect(detector.shouldHalt()).toBe(false);
  });

  it('does not conflate server-restart with tab-close (R2: different signal)', () => {
    // Per R2: detector should only count the tab-close pattern,
    // NOT a generic "playwright server restart" (which would be a
    // different MCP-level event). Synthetic log: server restart
    // events with no browser_close should not increment the count.
    const detector = new BrowserRestartDetector({ maxRestarts: 3, windowMs: 30_000 });
    const baseTs = Date.parse('2026-06-16T10:00:00.000Z');
    detector.record({ tool: 'browser_navigate', ts: new Date(baseTs).toISOString() });
    detector.record({ tool: 'browser_install', ts: new Date(baseTs + 1000).toISOString() }); // not a tab close
    detector.record({ tool: 'browser_navigate', ts: new Date(baseTs + 2000).toISOString() });
    expect(detector.restartCount()).toBe(0);
  });

  it('does not double-count overlapping close→navigate pairs within one window', () => {
    // If close at t=0 is followed by navigate at t=500, then ANOTHER
    // close at t=1000 also followed by navigate at t=1500 — that's
    // 2 distinct restarts, not 1.
    const detector = new BrowserRestartDetector({ maxRestarts: 3, windowMs: 30_000 });
    const baseTs = Date.parse('2026-06-16T10:00:00.000Z');
    detector.record({ tool: 'browser_close', ts: new Date(baseTs).toISOString() });
    detector.record({ tool: 'browser_navigate', ts: new Date(baseTs + 500).toISOString() });
    detector.record({ tool: 'browser_close', ts: new Date(baseTs + 1000).toISOString() });
    detector.record({ tool: 'browser_navigate', ts: new Date(baseTs + 1500).toISOString() });
    expect(detector.restartCount()).toBe(2);
  });
});

describe('services/qa/browser-event-logger (G4)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'peaks-qa-test-'));
  });
  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('appends spurious_restart events to browser-events.jsonl', () => {
    const logPath = join(tempDir, 'browser-events.jsonl');
    const logger = new BrowserEventLogger({ filePath: logPath });
    const baseTs = Date.parse('2026-06-16T10:00:00.000Z');
    logger.append({
      kind: 'spurious_restart',
      ts: new Date(baseTs).toISOString(),
      sessionId: 'sess-test',
      closeTs: new Date(baseTs).toISOString(),
      navigateTs: new Date(baseTs + 500).toISOString(),
      deltaMs: 500
    });
    expect(existsSync(logPath)).toBe(true);
    const body = readFileSync(logPath, 'utf8').trim();
    const lines = body.split('\n');
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.kind).toBe('spurious_restart');
    expect(parsed.sessionId).toBe('sess-test');
    expect(parsed.deltaMs).toBe(500);
    expect(parsed.ts).toBeDefined();
  });

  it('appends multiple events as separate JSONL lines', () => {
    const logPath = join(tempDir, 'browser-events.jsonl');
    const logger = new BrowserEventLogger({ filePath: logPath });
    const baseTs = Date.parse('2026-06-16T10:00:00.000Z');
    for (let i = 0; i < 3; i++) {
      logger.append({
        kind: 'spurious_restart',
        ts: new Date(baseTs + i * 1000).toISOString(),
        sessionId: 'sess-test',
        closeTs: new Date(baseTs + i * 1000).toISOString(),
        navigateTs: new Date(baseTs + i * 1000 + 200).toISOString(),
        deltaMs: 200
      });
    }
    const body = readFileSync(logPath, 'utf8').trim();
    const lines = body.split('\n');
    expect(lines.length).toBe(3);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed.kind).toBe('spurious_restart');
    }
  });

  it('BrowserRestartDetector + logger are composable: spurious_restart logged for each close→navigate', () => {
    const logPath = join(tempDir, 'browser-events.jsonl');
    const logger = new BrowserEventLogger({ filePath: logPath });
    const detector = new BrowserRestartDetector({ maxRestarts: 3, windowMs: 30_000 });
    const baseTs = Date.parse('2026-06-16T10:00:00.000Z');

    let pendingCloseTs: string | null = null;
    const events: BrowserEvent[] = [];
    for (let i = 0; i < 4; i++) {
      events.push({ tool: 'browser_close', ts: new Date(baseTs + i * 2000).toISOString() });
      events.push({ tool: 'browser_navigate', ts: new Date(baseTs + i * 2000 + 300).toISOString() });
    }

    for (const ev of events) {
      detector.record(ev);
      if (ev.tool === 'browser_close') {
        pendingCloseTs = ev.ts;
      } else if (ev.tool === 'browser_navigate' && pendingCloseTs !== null) {
        const closeMs = Date.parse(pendingCloseTs);
        const navMs = Date.parse(ev.ts);
        logger.append({
          kind: 'spurious_restart',
          ts: ev.ts,
          sessionId: 'sess-test',
          closeTs: pendingCloseTs,
          navigateTs: ev.ts,
          deltaMs: navMs - closeMs
        });
        pendingCloseTs = null;
      }
    }
    expect(detector.restartCount()).toBe(4);
    expect(detector.shouldHalt()).toBe(true);
    const body = readFileSync(logPath, 'utf8').trim();
    const lines = body.split('\n');
    expect(lines.length).toBe(4);
  });

  it('logger swallows mkdir/appendFile failures (best-effort, never throws)', () => {
    // Pass an unwritable path (a path under a non-directory parent)
    // to exercise the catch-all branches. The logger MUST NOT throw.
    const logger = new BrowserEventLogger({ filePath: '/this/path/does/not/exist/browser-events.jsonl' });
    expect(() => {
      logger.append({
        kind: 'spurious_restart',
        ts: '2026-06-16T10:00:00.000Z',
        sessionId: 'sess-fail',
        closeTs: '2026-06-16T10:00:00.000Z',
        navigateTs: '2026-06-16T10:00:00.500Z',
        deltaMs: 500
      });
    }).not.toThrow();
  });

  it('diagnostic includes the count and the memory path (AC1 verbatim)', () => {
    const detector = new BrowserRestartDetector({ maxRestarts: 2, windowMs: 30_000 });
    const baseTs = Date.parse('2026-06-16T10:00:00.000Z');
    const events: BrowserEvent[] = [];
    for (let i = 0; i < 3; i++) {
      events.push({ tool: 'browser_close', ts: new Date(baseTs + i * 1000).toISOString() });
      events.push({ tool: 'browser_navigate', ts: new Date(baseTs + i * 1000 + 100).toISOString() });
    }
    for (const ev of events) detector.record(ev);
    const diag = detector.diagnostic();
    expect(diag).toContain('playwright browser restart loop detected');
    expect(diag).toContain('3 restarts');
    expect(diag).toContain('.peaks/memory/playwright-restart-loop-2026-06-16.md');
  });
});
