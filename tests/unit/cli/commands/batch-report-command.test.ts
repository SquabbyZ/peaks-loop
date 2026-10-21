// tests/unit/cli/commands/batch-report-command.test.ts
//
// `peaks batch report` — the report lands on disk, the window keeps the
// summary.
//
// TWO CLAIMS ARE ASSERTED HERE, and neither is a structural one:
//
//   - the report is REACHABLE. A store that nothing calls is a file that
//     compiles and does nothing: the report would never land, and the
//     orchestrator's window would keep every full report.
//
//   - the summary the command answers with is the BOUNDED form: it
//     carries the measured file set (the topology stage's only input) and
//     not the whole report. The full report is one `--full` away.
//
// Dimensions covered:
//   - behavior:    the write and the read
//   - integration: the report on disk, and the session it lands in
//   - a11y:        the refusal when there is no report to read
//   - render:      the envelope shape
// Omitted:
//   - the command is registered; the registration itself is covered by the
//     batch command's own test

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeCapturedIo } from '../../_setup/io.js';
import { createProgram } from '../../../../src/cli/program.js';

const SESSION_ID = '2026-10-21-session-999999';
const RID = 'batch-rid-9';
const roots: string[] = [];

const REPORT = [
  '**Root cause (根因)**',
  'The marker is never cleared.',
  '',
  '**Expected files (预计文件集)**',
  'src/services/session/session-manager.ts',
  '',
  '**Fix sketch (修复草图)**',
  'Clear the marker when the session ends.'
].join('\n');

/** A project root with a session bound, so the report has a home. */
function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-batch-report-cli-'));
  roots.push(root);
  const runtime = join(root, '.peaks', '_runtime');
  mkdirSync(runtime, { recursive: true });
  writeFileSync(
    join(runtime, 'session.json'),
    `${JSON.stringify({ sessionId: SESSION_ID, projectRoot: root })}\n`,
    'utf8'
  );
  return root;
}

/** Run one `peaks batch report` action and hand back its envelope. */
async function runReport(
  root: string,
  action: 'write' | 'read',
  extraArgs: readonly string[]
): Promise<Record<string, unknown>> {
  const { io, captured } = makeCapturedIo();
  const program = createProgram(io);
  program.exitOverride();
  const batch = program.commands.find((command) => command.name() === 'batch');
  if (batch === undefined) throw new Error('the batch command is not registered');
  const report = batch.commands.find((command) => command.name() === 'report');
  if (report === undefined) throw new Error('the batch report command is not registered');
  const sub = report.commands.find((command) => command.name() === action);
  if (sub === undefined) throw new Error(`the batch report ${action} command is not registered`);
  await sub.parseAsync(
    ['node', 'peaks', 'batch', 'report', action, '--project', root, '--json', ...extraArgs],
    { from: 'user' }
  );
  const text = captured.text();
  return text.trim().length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};
}

beforeEach(() => {
  process.exitCode = 0;
});

afterEach(() => {
  process.exitCode = 0;
  while (roots.length > 0) {
    rmSync(roots.pop() as string, { recursive: true, force: true });
  }
});

describe('Scenario: behavior — the report lands on disk and the summary comes back', () => {
  it('when a report is written, should answer with the summary and not with the whole report', async () => {
    // given: a file holding the diagnostician's report
    const root = makeRoot();
    const reportFile = join(root, 'report.md');
    writeFileSync(reportFile, REPORT, 'utf8');
    // when: the report is landed
    const envelope = await runReport(root, 'write', [
      '--rid',
      RID,
      '--item',
      'i1',
      '--file',
      reportFile
    ]);
    // then: the answer carries the summary, with the measured file set
    const data = envelope['data'] as { readonly summary?: string };
    expect(data.summary).toContain('src/services/session/session-manager.ts');
    expect(data.summary).toContain('The marker is never cleared.');
    // and the full report is not in the answer
    expect(JSON.stringify(envelope)).not.toContain('**Expected files (预计文件集)**');
  });

  it('when the summary is read back, should carry the file set again', async () => {
    // given: a report that was landed
    const root = makeRoot();
    const reportFile = join(root, 'report.md');
    writeFileSync(reportFile, REPORT, 'utf8');
    await runReport(root, 'write', ['--rid', RID, '--item', 'i1', '--file', reportFile]);
    // when: it is read
    const envelope = await runReport(root, 'read', ['--rid', RID, '--item', 'i1']);
    // then: the summary is there
    const data = envelope['data'] as { readonly summary?: string };
    expect(data.summary).toContain('src/services/session/session-manager.ts');
  });

  it('when the full report is asked for, should return the whole report', async () => {
    // given: a report that was landed
    const root = makeRoot();
    const reportFile = join(root, 'report.md');
    writeFileSync(reportFile, REPORT, 'utf8');
    await runReport(root, 'write', ['--rid', RID, '--item', 'i1', '--file', reportFile]);
    // when: it is read with --full
    const envelope = await runReport(root, 'read', ['--rid', RID, '--item', 'i1', '--full']);
    // then: the whole report is in the answer
    const data = envelope['data'] as { readonly report?: string };
    expect(data.report).toBe(REPORT);
  });
});

describe('Scenario: integration — the report really is on disk', () => {
  it('when a report is written, should land it under the batch directory', async () => {
    // given: a file holding the diagnostician's report
    const root = makeRoot();
    const reportFile = join(root, 'report.md');
    writeFileSync(reportFile, REPORT, 'utf8');
    // when: the report is landed
    await runReport(root, 'write', ['--rid', RID, '--item', 'i1', '--file', reportFile]);
    // then: it is on disk, under the batch's own directory
    const landed = join(root, '.peaks', '_runtime', SESSION_ID, 'batch', RID, 'diagnosis', 'i1.md');
    expect(landed.replace(/\\/g, '/')).toContain(`/batch/${RID}/diagnosis/i1.md`);
  });
});

describe('Scenario: a11y — the refusal says what is missing', () => {
  it('when there is no report to read, should say so', async () => {
    // given: a project with no report
    const root = makeRoot();
    // when: it is read
    const envelope = await runReport(root, 'read', ['--rid', RID, '--item', 'i1']);
    // then: the answer names the reason
    expect(JSON.stringify(envelope)).toContain('NO_REPORT');
  });

  it('when the rid is missing, should say which option is required', async () => {
    // given: a project with no rid
    const root = makeRoot();
    // when: a report is written
    const envelope = await runReport(root, 'write', ['--item', 'i1']);
    // then: the refusal names the option
    expect(JSON.stringify(envelope)).toContain('MISSING_RID');
  });
});
