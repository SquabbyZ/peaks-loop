/**
 * Slice 2026-06-16-playwright-restart-loop — G5 + AC4/AC5/AC6.
 *
 * Tests for `runQaSlice` and the `peaks qa run` CLI surface.
 * Uses the real `BrowserRestartDetector` + `BrowserEventLogger`
 * with synthetic event streams.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Command } from 'commander';

import {
  runQaSlice,
  DEFAULT_MAX_BROWSER_RESTARTS,
  registerQaCommands,
  readQaRunOptions
} from '../../../src/cli/commands/qa-commands.js';
import type { ProgramIO } from '../../../src/cli/cli-helpers.js';
import type { BrowserEvent } from '../../../src/services/qa/browser-restart-detector.js';

const silentIo: ProgramIO = {
  stdout: () => undefined,
  stderr: () => undefined
};

function makeEvents(baseTs: number, cycles: number): BrowserEvent[] {
  const events: BrowserEvent[] = [];
  for (let i = 0; i < cycles; i++) {
    events.push({ tool: 'browser_close', ts: new Date(baseTs + i * 2000).toISOString() });
    events.push({ tool: 'browser_navigate', ts: new Date(baseTs + i * 2000 + 500).toISOString() });
  }
  return events;
}

describe('cli/qa-commands: runQaSlice', () => {
  const baseTs = Date.parse('2026-06-16T10:00:00.000Z');

  it('returns passed browser gate when under threshold (AC5 default N=3)', () => {
    const project = mkdtempSync(join(tmpdir(), 'peaks-qa-proj-'));
    try {
      const result = runQaSlice({
        project,
        sessionId: 'sess-1',
        browserEnabled: true,
        maxRestarts: DEFAULT_MAX_BROWSER_RESTARTS,
        detectorEnabled: true,
        events: makeEvents(baseTs, 2)
      });
      expect(result.gates).toHaveLength(3);
      const browserGate = result.gates.find((g) => g.name === 'browser-e2e');
      expect(browserGate?.status).toBe('passed');
      expect(result.detectorTriggered).toBe(false);
      expect(result.diagnostic).toBeUndefined();
      expect(result.subAgentPromptHint).toContain('reuse existing browser tab');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('returns failed browser gate with diagnostic when threshold reached (AC1)', () => {
    const project = mkdtempSync(join(tmpdir(), 'peaks-qa-proj-'));
    try {
      const result = runQaSlice({
        project,
        sessionId: 'sess-2',
        browserEnabled: true,
        maxRestarts: 3,
        detectorEnabled: true,
        events: makeEvents(baseTs, 4)
      });
      expect(result.detectorTriggered).toBe(true);
      const browserGate = result.gates.find((g) => g.name === 'browser-e2e');
      expect(browserGate?.status).toBe('failed');
      expect(browserGate?.reason).toContain('playwright browser restart loop detected');
      expect(browserGate?.reason).toContain('4 restarts');
      expect(result.diagnostic).toBeDefined();
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('skips the browser gate when --no-browser is passed (AC4)', () => {
    const project = mkdtempSync(join(tmpdir(), 'peaks-qa-proj-'));
    try {
      const result = runQaSlice({
        project,
        sessionId: 'sess-3',
        browserEnabled: false,
        maxRestarts: 3,
        detectorEnabled: true,
        events: makeEvents(baseTs, 4) // events ignored when browser is off
      });
      const browserGate = result.gates.find((g) => g.name === 'browser-e2e');
      expect(browserGate?.status).toBe('skipped');
      expect(browserGate?.reason).toBe('--no-browser');
      expect(result.detectorTriggered).toBe(false);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('respects a custom --max-browser-restarts threshold (AC5)', () => {
    const project = mkdtempSync(join(tmpdir(), 'peaks-qa-proj-'));
    try {
      const result = runQaSlice({
        project,
        sessionId: 'sess-4',
        browserEnabled: true,
        maxRestarts: 5,
        detectorEnabled: true,
        events: makeEvents(baseTs, 4) // 4 < 5 -> no halt
      });
      const browserGate = result.gates.find((g) => g.name === 'browser-e2e');
      expect(browserGate?.status).toBe('passed');
      expect(result.detectorTriggered).toBe(false);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('--no-restart-detector disables the detector (AC6)', () => {
    const project = mkdtempSync(join(tmpdir(), 'peaks-qa-proj-'));
    try {
      const result = runQaSlice({
        project,
        sessionId: 'sess-5',
        browserEnabled: true,
        maxRestarts: 3,
        detectorEnabled: false,
        events: makeEvents(baseTs, 10)
      });
      const browserGate = result.gates.find((g) => g.name === 'browser-e2e');
      expect(browserGate?.status).toBe('passed');
      expect(result.detectorTriggered).toBe(false);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('writes JSONL log of spurious_restart events when browser E2E runs (AC3)', () => {
    const project = mkdtempSync(join(tmpdir(), 'peaks-qa-proj-'));
    try {
      runQaSlice({
        project,
        sessionId: 'sess-log',
        browserEnabled: true,
        maxRestarts: 3,
        detectorEnabled: true,
        events: makeEvents(baseTs, 3)
      });
      const logPath = join(project, '.peaks', '_runtime', 'sess-log', 'qa', 'browser-events.jsonl');
      expect(existsSync(logPath)).toBe(true);
      const body = readFileSync(logPath, 'utf8').trim();
      const lines = body.split('\n');
      expect(lines.length).toBe(3);
      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(parsed.kind).toBe('spurious_restart');
        expect(parsed.sessionId).toBe('sess-log');
        expect(parsed.deltaMs).toBeLessThanOrEqual(30_000);
      }
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('emits the BROWSER_REUSE_HINT in the result envelope (AC2)', () => {
    const project = mkdtempSync(join(tmpdir(), 'peaks-qa-proj-'));
    try {
      const result = runQaSlice({
        project,
        sessionId: 'sess-hint',
        browserEnabled: true,
        maxRestarts: 3,
        detectorEnabled: true,
        events: []
      });
      expect(result.subAgentPromptHint).toContain('reuse existing browser tab');
      expect(result.subAgentPromptHint).toContain('do NOT call mcp__playwright__browser_close');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('cli/qa-commands: readQaRunOptions (Commander --no-X contract)', () => {
  it('returns browserEnabled=false when options.browser === false (--no-browser)', () => {
    const got = readQaRunOptions({
      project: '/tmp',
      browser: false,
      maxBrowserRestarts: '3'
    });
    expect(got.browserEnabled).toBe(false);
  });

  it('returns detectorEnabled=false when options.restartDetector === false (--no-restart-detector)', () => {
    const got = readQaRunOptions({
      project: '/tmp',
      restartDetector: false,
      maxBrowserRestarts: '3'
    });
    expect(got.detectorEnabled).toBe(false);
  });

  it('returns browserEnabled=true when options.browser is undefined (default)', () => {
    const got = readQaRunOptions({
      project: '/tmp',
      maxBrowserRestarts: '3'
    });
    expect(got.browserEnabled).toBe(true);
  });

  it('returns detectorEnabled=true when options.restartDetector is undefined (default)', () => {
    const got = readQaRunOptions({
      project: '/tmp',
      maxBrowserRestarts: '3'
    });
    expect(got.detectorEnabled).toBe(true);
  });

  it('returns maxRestarts=7 when options.maxBrowserRestarts="7"', () => {
    const got = readQaRunOptions({
      project: '/tmp',
      maxBrowserRestarts: '7'
    });
    expect(got.maxRestarts).toBe(7);
  });

  it('does NOT read legacy options.noBrowser (regression for Commander 12.x convention)', () => {
    // This is the exact failure mode QA#5 caught. If a future change
    // regressed to reading options.noBrowser, this test would still
    // pass browserEnabled=true (because the legacy key being set does
    // not affect the positive-form read). The complementary positive
    // assertion is below.
    const got = readQaRunOptions({
      project: '/tmp',
      noBrowser: true, // legacy key (intentionally NOT in the type)
      maxBrowserRestarts: '3'
    } as unknown as Parameters<typeof readQaRunOptions>[0]);
    // Even if a caller passed the legacy key, the positive form is
    // the source of truth: browser defaults to true.
    expect(got.browserEnabled).toBe(true);
  });
});

describe('cli/qa-commands: registerQaCommands end-to-end with real Command parser', () => {
  function parseRunOptions(extraArgs: string[]): ReturnType<typeof readQaRunOptions> {
    const project = mkdtempSync(join(tmpdir(), 'peaks-qa-parser-'));
    try {
      const program = new Command();
      program.exitOverride();
      registerQaCommands(program, silentIo);
      program.parse(
        ['node', 'peaks', 'qa', 'run', '--project', project, ...extraArgs],
        { from: 'node' }
      );
      const runCmd = program.commands
        .find((c) => c.name() === 'qa')!
        .commands.find((c) => c.name() === 'run')!;
      return readQaRunOptions(runCmd.opts());
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  }

  it('parses --no-browser to browserEnabled=false through the real Command', () => {
    expect(parseRunOptions(['--no-browser']).browserEnabled).toBe(false);
  });

  it('parses --no-restart-detector to detectorEnabled=false through the real Command', () => {
    expect(parseRunOptions(['--no-restart-detector']).detectorEnabled).toBe(false);
  });

  it('parses --max-browser-restarts 5 to maxRestarts=5 through the real Command', () => {
    expect(parseRunOptions(['--max-browser-restarts', '5']).maxRestarts).toBe(5);
  });

  it('omitting --no-browser leaves browserEnabled=true through the real Command', () => {
    expect(parseRunOptions([]).browserEnabled).toBe(true);
  });

  it('omitting --no-restart-detector leaves detectorEnabled=true through the real Command', () => {
    expect(parseRunOptions([]).detectorEnabled).toBe(true);
  });
});

describe('cli/qa-commands: full CLI → runQaSlice integration (cycle-2 regression)', () => {
  // These tests thread Commander-parsed options through readQaRunOptions
  // into runQaSlice with a synthetic event stream. They prove the
  // QA#5 R1 fix holds end-to-end: the --no-X flags now reach the slice
  // runner, not just the option-reading helper in isolation.
  const baseTs = Date.parse('2026-06-16T10:00:00.000Z');

  function runSliceViaCli(extraArgs: string[], events: BrowserEvent[]) {
    const project = mkdtempSync(join(tmpdir(), 'peaks-qa-int-'));
    try {
      const program = new Command();
      program.exitOverride();
      registerQaCommands(program, silentIo);
      program.parse(
        ['node', 'peaks', 'qa', 'run', '--project', project, ...extraArgs],
        { from: 'node' }
      );
      const runCmd = program.commands
        .find((c) => c.name() === 'qa')!
        .commands.find((c) => c.name() === 'run')!;
      const { browserEnabled, detectorEnabled, maxRestarts } =
        readQaRunOptions(runCmd.opts());
      return runQaSlice({
        project,
        sessionId: 'cycle2-int',
        browserEnabled,
        maxRestarts,
        detectorEnabled,
        events
      });
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  }

  it('--no-browser: 5 close→navigate cycles do NOT trigger the detector (AC4)', () => {
    const result = runSliceViaCli(['--no-browser'], makeEvents(baseTs, 5));
    const browserGate = result.gates.find((g) => g.name === 'browser-e2e');
    expect(browserGate?.status).toBe('skipped');
    expect(browserGate?.reason).toBe('--no-browser');
    expect(result.detectorTriggered).toBe(false);
    expect(result.browserEnabled).toBe(false);
  });

  it('--no-restart-detector: 10 close→navigate cycles do NOT halt the slice (AC6)', () => {
    const result = runSliceViaCli(['--no-restart-detector'], makeEvents(baseTs, 10));
    const browserGate = result.gates.find((g) => g.name === 'browser-e2e');
    expect(browserGate?.status).toBe('passed');
    expect(result.detectorTriggered).toBe(false);
    expect(result.browserEnabled).toBe(true);
  });

  it('--max-browser-restarts 5: 4 cycles pass, 5 cycles halt (AC5)', () => {
    const pass = runSliceViaCli(['--max-browser-restarts', '5'], makeEvents(baseTs, 4));
    expect(pass.detectorTriggered).toBe(false);
    const passGate = pass.gates.find((g) => g.name === 'browser-e2e');
    expect(passGate?.status).toBe('passed');

    const halt = runSliceViaCli(['--max-browser-restarts', '5'], makeEvents(baseTs, 5));
    expect(halt.detectorTriggered).toBe(true);
    const haltGate = halt.gates.find((g) => g.name === 'browser-e2e');
    expect(haltGate?.status).toBe('failed');
    expect(haltGate?.reason).toContain('playwright browser restart loop detected');
    expect(haltGate?.reason).toContain('5 restarts');
  });

  it('default (no flags): 4 close→navigate cycles halt at N=3 (AC1)', () => {
    const result = runSliceViaCli([], makeEvents(baseTs, 4));
    expect(result.detectorTriggered).toBe(true);
    const browserGate = result.gates.find((g) => g.name === 'browser-e2e');
    expect(browserGate?.status).toBe('failed');
    expect(browserGate?.reason).toContain('4 restarts');
    expect(result.browserEnabled).toBe(true);
  });

  it('--no-browser AND --no-restart-detector compose: gate skipped, no events recorded', () => {
    const result = runSliceViaCli(
      ['--no-browser', '--no-restart-detector'],
      makeEvents(baseTs, 5)
    );
    const browserGate = result.gates.find((g) => g.name === 'browser-e2e');
    expect(browserGate?.status).toBe('skipped');
    expect(browserGate?.reason).toBe('--no-browser');
    expect(result.detectorTriggered).toBe(false);
    expect(result.browserEnabled).toBe(false);
  });
});
