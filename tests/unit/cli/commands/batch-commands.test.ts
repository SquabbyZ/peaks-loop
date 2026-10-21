// tests/unit/cli/commands/batch-commands.test.ts
//
// The batch-mode command surface, driven through the real registered program.
//
// WHY THIS FILE EXISTS. The command is the lane's user-facing surface for
// batch mode, and it is where the diagnosis fan-out actually happens: the
// prompt the diagnostician receives is composed here, out of what the caller
// supplied. A defect in that composition is invisible to the service-level
// tests — they check that the prompt BUILDER says the right thing, not that
// the command put the right INPUT into it.
//
// The two claims asserted here:
//   - the command is REACHABLE. A command file that is never registered is
//     a file that compiles, lints, and does nothing.
//   - the dispatched prompt carries the caller's SYMPTOM. The symptom is
//     what the user reported and what the diagnostician has to explain; the
//     label is the item's short name. Swapping them asks the wrong question
//     and gets a confident answer to it.
//
// Dimensions covered:
//   - behavior:  the mode decision, the dispatched prompt's content, the
//                recorded batch
//   - render:    the envelope shape
//   - a11y:      the refusal for a batch that is not a batch
//   - integration: the batch record written on disk, and the session the
//                  record lands in
// Omitted:
//   - (none)

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { makeCapturedIo } from '../../_setup/io.js';

declareDimensions('tests/unit/cli/commands/batch-commands.test.ts', [
  'render',
  'behavior',
  'a11y',
  'integration'
]);

import { createProgram } from '../../../../src/cli/program.js';
import { registerBatchCommands } from '../../../../src/cli/commands/batch-commands.js';

const SESSION_ID = '2026-10-21-session-bbbbbb';
const RID = 'batch-rid-1';
const SYMPTOM = 'clicking Save throws a 500';
const LABEL = 'save button';

const roots: string[] = [];

/** A project root with a session bound, so the batch record has a home. */
function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-batch-cli-'));
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

/** A project root with NO session bound. */
function makeRootWithoutSession(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-batch-cli-nosess-'));
  roots.push(root);
  return root;
}

function itemsJson(
  overrides: {
    readonly status?: 'pending' | 'diagnosed';
    readonly symptom?: string;
    readonly label?: string;
  } = {}
): string {
  return JSON.stringify({
    items: [
      {
        id: 'i1',
        label: overrides.label ?? LABEL,
        symptom: overrides.symptom ?? SYMPTOM,
        status: overrides.status ?? 'pending'
      },
      {
        id: 'i2',
        label: 'list page',
        symptom: 'the list is empty on load',
        status: 'pending'
      }
    ]
  });
}

/**
 * Run the command and hand back the parsed JSON envelope.
 *
 * The parse is AWAITED, not fired and forgotten. It happens to be
 * synchronous today, so an unawaited call still populated the capture
 * before the assertions read it — which is exactly what makes it a trap: the
 * day the action goes async, an unawaited parse leaves the envelope EMPTY
 * and the assertions either fail confusingly or pass vacuously.
 */
async function runBatchDiagnose(
  root: string,
  extraArgs: readonly string[]
): Promise<{ readonly envelope: Record<string, unknown>; readonly stderr: string }> {
  const { io, captured } = makeCapturedIo();
  const program = createProgram(io);
  program.exitOverride();
  const batch = program.commands.find((command) => command.name() === 'batch');
  if (batch === undefined) throw new Error('the batch command is not registered');
  const diagnose = batch.commands.find((command) => command.name() === 'diagnose');
  if (diagnose === undefined) throw new Error('the batch diagnose command is not registered');
  await diagnose.parseAsync(
    ['node', 'peaks', 'batch', 'diagnose', '--project', root, '--json', ...extraArgs],
    { from: 'user' }
  );
  const text = captured.text();
  return {
    envelope: text.trim().length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {},
    stderr: captured.stderrText()
  };
}

/** The prompt text of every toolCall the envelope carries. */
function dispatchedPrompts(envelope: Record<string, unknown>): readonly string[] {
  const data = envelope['data'] as {
    readonly toolCalls?: readonly { args?: { prompt?: string } }[];
  };
  return (data?.toolCalls ?? []).map((call) => call.args?.prompt ?? '');
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

describe('Scenario: render — the batch command is registered', () => {
  it('when the program is built, should expose `batch diagnose`', () => {
    // given: the program the CLI actually registers
    const { io } = makeCapturedIo();
    const program = createProgram(io);
    // when: the command tree is walked
    const batch = program.commands.find((command) => command.name() === 'batch');
    const diagnose = batch?.commands.find((command) => command.name() === 'diagnose');
    // then: both the group and its action exist
    expect(batch).toBeDefined();
    expect(diagnose).toBeDefined();
  });

  it('when the diagnose action is registered, should carry the options the caller needs', () => {
    // given: the registered diagnose action
    const { io } = makeCapturedIo();
    const program = createProgram(io);
    const batch = program.commands.find((command) => command.name() === 'batch');
    const diagnose = batch?.commands.find((command) => command.name() === 'diagnose');
    const options = (diagnose?.options ?? []).map((option) => option.long);
    // then: the rid, the items and the project root are all nameable
    expect(options).toContain('--rid');
    expect(options).toContain('--items');
    expect(options).toContain('--items-json');
    expect(options).toContain('--project');
  });
});

describe('Scenario: behavior — the dispatched prompt carries the caller symptom', () => {
  it('when a batch is diagnosed, should dispatch one read-only diagnosis per pending item', async () => {
    // given: a batch of two pending items
    const root = makeRoot();
    // when: the diagnose command runs
    const { envelope } = await runBatchDiagnose(root, ['--rid', RID, '--items-json', itemsJson()]);
    // then: one toolCall per item, each carrying a diagnosis prompt
    const prompts = dispatchedPrompts(envelope);
    expect(prompts).toHaveLength(2);
    expect(prompts.every((prompt) => /MUST NOT[^\n]*(Edit|Write|MultiEdit)/.test(prompt))).toBe(
      true
    );
  });

  it('when a batch is diagnosed, should carry the reported symptom into the prompt', async () => {
    // given: a batch whose first item reports a symptom
    const root = makeRoot();
    // when: the diagnose command runs
    const { envelope } = await runBatchDiagnose(root, ['--rid', RID, '--items-json', itemsJson()]);
    // then: the prompt the diagnostician receives carries the SYMPTOM, not the label
    const prompts = dispatchedPrompts(envelope);
    const first = prompts.find((prompt) => prompt.includes('i1'));
    expect(first).toBeDefined();
    expect(first).toContain(SYMPTOM);
    expect(first).not.toContain(`Reported symptom**: ${LABEL}`);
  });

  it('when a batch is diagnosed, should record the batch and its items', async () => {
    // given: a batch of two pending items
    const root = makeRoot();
    // when: the diagnose command runs
    await runBatchDiagnose(root, ['--rid', RID, '--items-json', itemsJson()]);
    // then: the record holds both items, still pending
    const path = join(root, '.peaks', '_runtime', SESSION_ID, 'batch', RID, 'progress.json');
    const record = JSON.parse(readFileSync(path, 'utf8')) as {
      readonly phase: string;
      readonly items: readonly { readonly id: string; readonly symptom?: string }[];
    };
    expect(record.items.map((item) => item.id)).toEqual(['i1', 'i2']);
    expect(record.items[0]?.symptom).toBe(SYMPTOM);
  });

  it('when a diagnosed batch is re-run with measured file sets, should plan the waves from them', async () => {
    // given: a first run that dispatches the diagnoses
    const root = makeRoot();
    await runBatchDiagnose(root, ['--rid', RID, '--items-json', itemsJson()]);
    // and: the same batch re-run with the file sets the diagnosticians measured
    const measured = JSON.stringify({
      items: [
        { id: 'i1', label: LABEL, symptom: SYMPTOM, status: 'diagnosed', files: ['src/a.ts'] },
        {
          id: 'i2',
          label: 'list page',
          symptom: 'the list is empty on load',
          status: 'diagnosed',
          files: ['src/b.ts']
        }
      ]
    });
    const { envelope } = await runBatchDiagnose(root, ['--rid', RID, '--items-json', measured]);
    // then: no diagnosis is dispatched, and the two disjoint items share a wave
    expect(dispatchedPrompts(envelope)).toHaveLength(0);
    const data = envelope['data'] as {
      readonly topology?: { readonly waves?: readonly { readonly slices?: readonly string[] }[] };
    };
    expect(data.topology?.waves?.[0]?.slices).toEqual(['i1', 'i2']);
  });

  it('when two items collide on a file, should defer the second behind the first', async () => {
    // given: a batch whose two items touch the same file
    const root = makeRoot();
    const colliding = JSON.stringify({
      items: [
        { id: 'i1', label: LABEL, symptom: SYMPTOM, status: 'diagnosed', files: ['src/a.ts'] },
        {
          id: 'i2',
          label: 'list page',
          symptom: 'the list is empty on load',
          status: 'diagnosed',
          files: ['src/a.ts']
        }
      ]
    });
    // when: the diagnose command runs with the measured file sets
    const { envelope } = await runBatchDiagnose(root, ['--rid', RID, '--items-json', colliding]);
    // then: the second item is deferred, and the colliding file is named
    const data = envelope['data'] as {
      readonly topology?: {
        readonly waves?: readonly {
          readonly slices?: readonly string[];
          readonly deferred?: readonly { readonly collidingFile?: string }[];
        }[];
      };
    };
    expect(data.topology?.waves).toHaveLength(2);
    expect(data.topology?.waves?.[1]?.deferred?.[0]?.collidingFile).toBe('src/a.ts');
  });
});

describe('Scenario: a11y — the refusals say why', () => {
  it('when one item is diagnosed, should refuse to run the batch machinery', async () => {
    // given: ONE item, which is not a batch
    const root = makeRoot();
    const single = JSON.stringify({
      items: [{ id: 'i1', label: LABEL, symptom: SYMPTOM, status: 'pending' }]
    });
    // when: the diagnose command runs
    const { envelope } = await runBatchDiagnose(root, ['--rid', RID, '--items-json', single]);
    // then: it refuses, and says the single-task path is the one to take
    expect(envelope['ok']).toBe(false);
    expect(envelope['code']).toBe('BATCH_MODE_NOT_APPLICABLE');
    expect(JSON.stringify(envelope['nextActions'])).toContain('single-task path');
  });

  it('when no rid is supplied, should refuse and ask for one', async () => {
    // given: a batch with no request to belong to
    const root = makeRoot();
    // when: the diagnose command runs without --rid
    const { envelope } = await runBatchDiagnose(root, ['--items-json', itemsJson()]);
    // then: it refuses, and names what is missing
    expect(envelope['ok']).toBe(false);
    expect(envelope['code']).toBe('MISSING_RID');
  });

  it('when the items are unreadable, should refuse and say what was wrong', async () => {
    // given: items that are not the expected shape
    const root = makeRoot();
    // when: the diagnose command runs
    const { envelope } = await runBatchDiagnose(root, ['--rid', RID, '--items-json', '{"nope":1}']);
    // then: it refuses, and says the items did not match the shape
    expect(envelope['ok']).toBe(false);
    expect(envelope['code']).toBe('INVALID_ITEMS');
  });

  it('when no session is bound, should refuse rather than write the batch nowhere', async () => {
    // given: a project with no session bound
    const root = makeRootWithoutSession();
    // when: the diagnose command runs
    const { envelope } = await runBatchDiagnose(root, ['--rid', RID, '--items-json', itemsJson()]);
    // then: it refuses, and says the batch cannot be recorded
    expect(envelope['ok']).toBe(false);
    expect(envelope['code']).toBe('NO_SESSION');
  });
});

describe('Scenario: integration — the option surface keeps its fallbacks reachable', () => {
  it('when the diagnose action is registered, should give `--project` no commander default', () => {
    // given: the registered diagnose action
    const { io } = makeCapturedIo();
    const program = createProgram(io);
    const batch = program.commands.find((command) => command.name() === 'batch');
    const diagnose = batch?.commands.find((command) => command.name() === 'diagnose');
    const project = diagnose?.options.find((option) => option.long === '--project');
    // then: absence stays absence, so the handler's own fallback can fire
    expect(project?.defaultValue).toBeUndefined();
  });

  it('when the registrar is called directly, should attach the batch group', () => {
    // given: a bare commander program
    const program = new Command();
    const { io } = makeCapturedIo();
    // when: the registrar runs
    registerBatchCommands(program, io);
    // then: the group and its action are on the tree
    const batch = program.commands.find((command) => command.name() === 'batch');
    expect(batch?.commands.some((command) => command.name() === 'diagnose')).toBe(true);
  });
});
