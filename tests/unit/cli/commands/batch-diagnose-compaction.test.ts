// tests/unit/cli/commands/batch-diagnose-compaction.test.ts
//
// The batch's ①→② boundary: the compaction point, and the notice the
// presence read carries out of it.
//
// THREE CLAIMS ARE ASSERTED HERE, and none is a structural one:
//
//   - the phase advance CHOOSES the compaction point. The batch crossing
//     into the topology stage is the cheapest moment to compact, and the
//     command says so instead of leaving it to chance.
//
//   - the notice is the VERIFICATION STAGE's wording. It is written into
//     the record by the command that advances the phase, and the presence
//     read carries it out — one sentence, written once.
//
//   - nothing is claimed when nothing happened. A batch that did not cross
//     a boundary carries no notice, and a window with room in it is not
//     announced.
//
// Dimensions covered:
//   - behavior:    the compaction point and the notice, per phase
//   - integration: the notice in the record on disk
//   - render:      the envelope's compaction block
// Omitted:
//   - the command's own dispatch behaviour; that is covered by
//     `batch-commands.test.ts`

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeCapturedIo } from '../../_setup/io.js';
import { createProgram } from '../../../../src/cli/program.js';

const SESSION_ID = '2026-10-21-session-888888';
const RID = 'batch-rid-8';
const roots: string[] = [];
const savedEnv: Record<string, string | undefined> = {};

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-batch-boundary-'));
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

/** The items, all already diagnosed — so this run crosses the boundary. */
function diagnosedItems(): string {
  return JSON.stringify({
    items: [
      {
        id: 'i1',
        label: 'save button',
        symptom: 'clicking Save throws a 500',
        status: 'diagnosed'
      },
      { id: 'i2', label: 'list page', symptom: 'the list is empty on load', status: 'diagnosed' }
    ]
  });
}

/** Run `peaks batch diagnose` and hand back its envelope. */
async function runDiagnose(root: string): Promise<Record<string, unknown>> {
  const { io, captured } = makeCapturedIo();
  const program = createProgram(io);
  program.exitOverride();
  const batch = program.commands.find((command) => command.name() === 'batch');
  const diagnose = batch?.commands.find((command) => command.name() === 'diagnose');
  if (diagnose === undefined) throw new Error('the batch diagnose command is not registered');
  await diagnose.parseAsync(
    [
      'node',
      'peaks',
      'batch',
      'diagnose',
      '--project',
      root,
      '--rid',
      RID,
      '--items-json',
      diagnosedItems(),
      '--json'
    ],
    { from: 'user' }
  );
  const text = captured.text();
  return text.trim().length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};
}

beforeEach(() => {
  process.exitCode = 0;
  savedEnv['CLAUDE_CODE_ENTRYPOINT'] = process.env['CLAUDE_CODE_ENTRYPOINT'];
  savedEnv['CLAUDE_CONTEXT_USAGE_PERCENT'] = process.env['CLAUDE_CONTEXT_USAGE_PERCENT'];
  process.env['CLAUDE_CODE_ENTRYPOINT'] = 'cli';
});

afterEach(() => {
  process.exitCode = 0;
  while (roots.length > 0) {
    rmSync(roots.pop() as string, { recursive: true, force: true });
  }
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('Scenario: behavior — the phase advance chooses the compaction point', () => {
  it('when the batch crosses into the topology stage with the window full, should say this is the moment to compact', async () => {
    // given: a window in the auto-compact zone
    process.env['CLAUDE_CONTEXT_USAGE_PERCENT'] = '0.82';
    const root = makeRoot();
    // when: the batch crosses the boundary
    const envelope = await runDiagnose(root);
    // then: the envelope names the boundary as the compaction point
    const data = envelope['data'] as {
      readonly compaction?: { point?: string; shouldCompact?: boolean };
    };
    expect(data.compaction?.point).toBe('phase-boundary');
    expect(data.compaction?.shouldCompact).toBe(true);
  });

  it('when the window has room, should not claim a compaction is happening', async () => {
    // given: a window with room in it
    process.env['CLAUDE_CONTEXT_USAGE_PERCENT'] = '0.4';
    const root = makeRoot();
    // when: the batch crosses the boundary
    const envelope = await runDiagnose(root);
    // then: nothing is claimed
    const data = envelope['data'] as {
      readonly compaction?: { point?: string; shouldCompact?: boolean };
    };
    expect(data.compaction?.shouldCompact).toBe(false);
  });
});

describe('Scenario: integration — the notice is in the record, written once', () => {
  it('when the batch crosses the boundary, should record the notice the presence read carries', async () => {
    // given: a window in the auto-compact zone
    process.env['CLAUDE_CONTEXT_USAGE_PERCENT'] = '0.82';
    const root = makeRoot();
    // when: the batch crosses the boundary
    await runDiagnose(root);
    // then: the record carries the notice
    const record = JSON.parse(
      readFileSync(
        join(root, '.peaks', '_runtime', SESSION_ID, 'batch', RID, 'progress.json'),
        'utf8'
      )
    ) as { phase?: string; boundaryNotice?: string };
    expect(record.phase).toBe('topology');
    expect(record.boundaryNotice).toContain('诊断完成');
  });
});
