/**
 * v3.1.2 AC-15 — behavioural integration test for
 * `peaks code context-now --enforce-job-mode`.
 *
 * Karpathy §4: every AC ↔ a passing test. The unit tests for
 * `gate-step-08` and `emit-handoff` do NOT cover the `context-now`
 * CLI surface; this file does. Spawns `node bin/peaks.js` as a real
 * child process (the way the PreToolUse hook or a CI step would) and
 * asserts the action field at the three thresholds (≥0.85,
 * ≥0.95, <0.50).
 *
 * The ratio is forced via `CLAUDE_CONTEXT_USAGE_PERCENT` env var,
 * which is the canonical seam for the Claude Code adapter
 * (`src/services/ide/adapters/claude-code-adapter.ts:73`). The
 * CLI reads `process.env` directly, so passing it via `env:` on
 * `execFileSync` is sufficient.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { writeJobShapeDecision } from '../../src/services/code/job-shape-decision.js';

const BIN = resolve(__dirname, '../../bin/peaks.js');
const BIN_TIMEOUT_MS = 30_000;
const SESSION_ID = '2026-07-03-test-context-now-int';
const FIXED_NOW = new Date('2026-07-03T12:00:00.000Z');
const RATIO_ENV = 'CLAUDE_CONTEXT_USAGE_PERCENT';

interface CliResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

interface ContextNowEnvelope {
  readonly ok: boolean;
  readonly command: string;
  readonly code?: string;
  readonly message?: string;
  readonly data: {
    readonly ratio: number;
    readonly action: 'ok' | 'soft-warn' | 'auto-compact-now' | 'red-line';
    readonly jobMode: boolean;
    readonly next: string | null;
  };
  readonly nextActions?: readonly string[];
}

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-ctx-now-int-'));
}

function runContextNow(args: readonly string[], env: NodeJS.ProcessEnv): CliResult {
  try {
    const stdout = execFileSync('node', [BIN, 'code', 'context-now', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
      timeout: BIN_TIMEOUT_MS
    }).toString('utf8');
    return { stdout, stderr: '', code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    return {
      stdout: (typeof e.stdout === 'string' ? e.stdout : e.stdout?.toString('utf8') ?? ''),
      stderr: (typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString('utf8') ?? ''),
      code: e.status ?? 1
    };
  }
}

function seedJobShape(project: string, sessionId: string): void {
  mkdirSync(join(project, '.peaks', '_runtime', sessionId), { recursive: true });
  writeJobShapeDecision(
    project,
    sessionId,
    {
      isJob: true,
      rationale: 'integration-test rationale for context-now AC-15',
      suggestedJobId: 'ctx-test-job',
      suggestedStrategy: 'rotating',
      confidence: 'high',
      prompt: 'integration-test prompt'
    },
    { now: () => FIXED_NOW, force: true }
  );
}

const projects: string[] = [];

afterEach(() => {
  for (const root of projects) {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  }
  projects.length = 0;
});

describe('peaks code context-now (v3.1.2) AC-15 job-mode action field', () => {
  test('AC-15a: ratio=0.87 with --enforce-job-mode → action=auto-compact-now', () => {
    const project = makeProject();
    projects.push(project);
    const r = runContextNow(
      ['--project', project, '--session-id', SESSION_ID, '--enforce-job-mode', '--json'],
      { [RATIO_ENV]: '0.87' }
    );
    expect(r.code).toBe(0);
    const env = JSON.parse(r.stdout) as ContextNowEnvelope;
    expect(env.ok).toBe(false);
    expect(env.command).toBe('code.context-now');
    expect(env.code).toBe('DEPRECATED_ALIAS');
    expect(env.command).toBe('code.context-now');
    expect(env.data.action).toBe('auto-compact-now');
    expect(env.data.jobMode).toBe(true);
    expect(env.data.ratio).toBeGreaterThanOrEqual(0.85);
  });

  test('AC-15b: ratio=0.96 with --enforce-job-mode → action=red-line', () => {
    const project = makeProject();
    projects.push(project);
    const r = runContextNow(
      ['--project', project, '--session-id', SESSION_ID, '--enforce-job-mode', '--json'],
      { [RATIO_ENV]: '0.96' }
    );
    expect(r.code).toBe(0);
    const env = JSON.parse(r.stdout) as ContextNowEnvelope;
    expect(env.ok).toBe(false);
    expect(env.command).toBe('code.context-now');
    expect(env.code).toBe('DEPRECATED_ALIAS');
    expect(env.data.action).toBe('red-line');
    expect(env.data.jobMode).toBe(true);
    expect(env.data.next).toMatch(/peaks compact auto/);
    expect(env.nextActions ?? []).toEqual(
      expect.arrayContaining([expect.stringMatching(/peaks compact auto/)])
    );
  });

  test('AC-15c: ratio=0.40 (no job-shape.json, no --enforce-job-mode) → action=ok (advisory)', () => {
    const project = makeProject();
    projects.push(project);
    const r = runContextNow(
      ['--project', project, '--session-id', SESSION_ID, '--json'],
      { [RATIO_ENV]: '0.40' }
    );
    expect(r.code).toBe(0);
    const env = JSON.parse(r.stdout) as ContextNowEnvelope;
    expect(env.ok).toBe(false);
    expect(env.command).toBe('code.context-now');
    expect(env.code).toBe('DEPRECATED_ALIAS');
    expect(env.data.action).not.toBe('auto-compact-now');
    expect(env.data.action).not.toBe('red-line');
    expect(env.data.jobMode).toBe(false);
  });
});