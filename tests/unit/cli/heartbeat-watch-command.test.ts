import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Command } from 'commander';

import { registerHeartbeatWatchCommand } from '../../../src/cli/commands/heartbeat-watch-command.js';
import { writeInitialDispatchRecord, markCompleted } from '../../../src/services/dispatch/dispatch-record-writer.js';

describe('heartbeat watch CLI', () => {
  let projectRoot = '';
  let output: string[];
  let errors: string[];

  beforeEach(() => {
    projectRoot = join(tmpdir(), `peaks-heartbeat-watch-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(projectRoot, '.peaks', '_runtime'), { recursive: true });
    output = [];
    errors = [];
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  function command(): Command {
    const program = new Command();
    registerHeartbeatWatchCommand(program, {
      stdout: (text) => output.push(text),
      stderr: (text) => errors.push(text)
    });
    return program;
  }

  it('requires --batch-id', async () => {
    await expect(command().parseAsync(['node', 'peaks', 'watch'], { from: 'node' })).rejects.toThrow();
  });

  it('emits a human status line and exits after a terminal record', async () => {
    const { path } = writeInitialDispatchRecord({
      projectRoot,
      sessionId: 'sid',
      requestId: 'rid',
      role: 'rd',
      prompt: 'test',
      toolCall: { name: 'Task', args: {} },
      batchId: 'batch-1'
    });
    markCompleted({ recordPath: path, outcome: 'success', status: 'done' });
    await command().parseAsync(['node', 'peaks', 'watch', '--batch-id', 'batch-1', '--project', projectRoot, '--session-id', 'sid', '--max-ticks', '1'], { from: 'node' });
    expect(output.join('')).toContain('peaks-heartbeat:batch-1');
    expect(output.join('')).toContain('done');
  });

  it('filters records by batch id', async () => {
    const first = writeInitialDispatchRecord({ projectRoot, sessionId: 'sid', requestId: 'one', role: 'rd', prompt: 'x', toolCall: { name: 'Task', args: {} }, batchId: 'wanted' });
    const second = writeInitialDispatchRecord({ projectRoot, sessionId: 'sid', requestId: 'two', role: 'qa', prompt: 'x', toolCall: { name: 'Task', args: {} }, batchId: 'other' });
    markCompleted({ recordPath: first.path, outcome: 'success', status: 'done' });
    markCompleted({ recordPath: second.path, outcome: 'success', status: 'done' });
    await command().parseAsync(['node', 'peaks', 'watch', '--batch-id', 'wanted', '--project', projectRoot, '--session-id', 'sid', '--max-ticks', '1', '--json'], { from: 'node' });
    const payload = JSON.parse(output[output.length - 1]!);
    const roles = payload.data.views.map((v: { role: string }) => v.role);
    expect(roles).toContain('rd');
    expect(roles).not.toContain('qa');
  });

  it('emits JSON envelopes when --json is selected', async () => {
    const { path } = writeInitialDispatchRecord({ projectRoot, sessionId: 'sid', requestId: 'rid', role: 'rd', prompt: 'x', toolCall: { name: 'Task', args: {} }, batchId: 'batch-json' });
    markCompleted({ recordPath: path, outcome: 'success', status: 'done' });
    await command().parseAsync(['node', 'peaks', 'watch', '--batch-id', 'batch-json', '--project', projectRoot, '--session-id', 'sid', '--json', '--max-ticks', '1'], { from: 'node' });
    const payload = JSON.parse(output[0]!);
    expect(payload.ok).toBe(true);
    expect(payload.data.stale).toEqual(expect.objectContaining({ customThresholdSec: 300 }));
  });

  it('reports custom stale threshold from persisted last beat', async () => {
    const { path } = writeInitialDispatchRecord({ projectRoot, sessionId: 'sid', requestId: 'rid', role: 'rd', prompt: 'x', toolCall: { name: 'Task', args: {} }, batchId: 'batch-stale' });
    writeFileSync(path, JSON.stringify({ ...JSON.parse(require('node:fs').readFileSync(path, 'utf8')), lastBeatAt: new Date(Date.now() - 1_000).toISOString(), heartbeats: [{ at: new Date(Date.now() - 1_000).toISOString(), status: 'running', progress: 1, note: null }], status: 'running' }));
    await command().parseAsync(['node', 'peaks', 'watch', '--batch-id', 'batch-stale', '--project', projectRoot, '--session-id', 'sid', '--stale-threshold-ms', '500', '--max-ticks', '1', '--json'], { from: 'node' });
    const payload = JSON.parse(output[output.length - 1]!);
    expect(payload.data.stale.count).toBeGreaterThan(0);
  });

  it('rejects invalid interval values without starting a timer', async () => {
    const { path } = writeInitialDispatchRecord({ projectRoot, sessionId: 'sid', requestId: 'rid', role: 'rd', prompt: 'x', toolCall: { name: 'Task', args: {} }, batchId: 'batch-invalid' });
    markCompleted({ recordPath: path, outcome: 'success', status: 'done' });
    await command().parseAsync(['node', 'peaks', 'watch', '--batch-id', 'batch-invalid', '--project', projectRoot, '--interval-ms', '0'], { from: 'node' });
    expect(errors.join('')).toContain('--interval-ms must be a positive integer');
    expect(process.exitCode).toBe(1);
  });
});
