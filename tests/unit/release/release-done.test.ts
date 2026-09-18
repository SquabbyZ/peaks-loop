// tests/unit/release/release-done.test.ts
//
// Guards the Slice H1 fix to `peaks release done`.
//
// Why this test file exists:
//   `done` used to carry three guards: (1) NO_ACTIVE, (2) currentStage must
//   be 'watching', (3) the 24h watch window must be complete. Guard (2)
//   guarded an UNREACHABLE stage — nothing in src/ ever calls
//   `transitionRelease(state, 'watching')`; `promote` writes 'promoted'
//   directly (src/cli/commands/release-commands.ts). So every successfully
//   promoted release deadlocked: `peaks release watch` reported
//   `readyForDone: true` and told the operator to run `done`, and `done`
//   refused with INVALID_STAGE. The only escapes were `rollback` (marks a
//   GOOD release as rolled-back) or `hotfix` (skips the ceremony) — both
//   semantically wrong.
//
//   Guard (2) also contradicted the command's own description ("Requires the
//   watch window to be complete (24h after promoted-at)"), which describes
//   guard (3). The fix deletes guard (2) and lets `promoted` reach `done`
//   directly in the stage table.
//
//   The load-bearing assertions are the PAIR: done must SUCCEED on a complete
//   window, and must still REFUSE on an incomplete one. A test that only
//   asserted the happy path would re-admit the deadlock the moment someone
//   re-tightened the guard; a test that only asserted the refusal would not
//   have caught the defect at all.
//
// Dimensions covered:
//   - render:      the JSON envelope's shape / fields
//   - behavior:    the stage transition actually lands in .peaks/release-state.json
//   - integration: real fs state file + real clock arithmetic (24h window)
//   - a11y:        error codes (WATCH_INCOMPLETE / NO_ACTIVE) and exit-relevant
//                  human-readable messages stay unchanged

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../_setup/tmp-workspace.js';
import { makeCapturedIo } from '../_setup/io.js';
import { createProgram, __resetBootstrapForTests } from '~/src/cli/program';

declareDimensions('tests/unit/release/release-done.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y',
]);

const HOUR_MS = 60 * 60 * 1000;

/** Write a `.peaks/release-state.json` with one active release at `stage`. */
function seedReleaseState(
  ws: { path: string; peaksDir: string },
  opts: { stage: string; promotedAt?: string; version?: string },
): void {
  mkdirSync(ws.peaksDir, { recursive: true });
  const now = new Date();
  const record: Record<string, unknown> = {
    version: opts.version ?? '9.9.9',
    currentStage: opts.stage,
    stageHistory: [{ stage: opts.stage, at: now.toISOString() }],
    createdAt: now.toISOString(),
  };
  if (opts.promotedAt !== undefined) record.promotedAt = opts.promotedAt;
  writeFileSync(
    join(ws.peaksDir, 'release-state.json'),
    JSON.stringify({ version: 1, active: record, history: [] }, null, 2),
    'utf8',
  );
}

function readActive(ws: { peaksDir: string }): unknown {
  const raw = JSON.parse(readFileSync(join(ws.peaksDir, 'release-state.json'), 'utf8')) as {
    active: unknown;
    history: readonly { currentStage: string; version: string }[];
  };
  return { active: raw.active, history: raw.history };
}

/** Run `peaks release done --project <ws> --json`, return the parsed envelope. */
async function runDone(wsPath: string): Promise<Record<string, unknown>> {
  __resetBootstrapForTests();
  const { io, captured } = makeCapturedIo();
  const program = createProgram(io);
  await program.parseAsync(['node', 'peaks', 'release', 'done', '--project', wsPath, '--json']);
  return JSON.parse(captured.text()) as Record<string, unknown>;
}

describe('Scenario: behavior — a promoted release with a complete watch window can be marked done', () => {
  const ws = withTmpWorkspacePerTest('peaks-release-done-');

  it('when the window is complete, should succeed and move the release to history', async () => {
    // given: a release promoted 25h ago (window over) — the exact shape the
    //        real .peaks/release-state.json held for 4.0.52 when it deadlocked
    const promotedAt = new Date(Date.now() - 25 * HOUR_MS).toISOString();
    seedReleaseState(ws(), { stage: 'promoted', promotedAt, version: '4.0.52' });

    // when:  `peaks release done` runs
    const envelope = await runDone(ws().path);

    // then:  it succeeds ...
    expect(envelope['ok']).toBe(true);
    expect(envelope['command']).toBe('release.done');
    // ... with the version + a doneAt stamp in the payload (render)
    const data = envelope['data'] as Record<string, unknown>;
    expect(data['version']).toBe('4.0.52');
    expect(typeof data['doneAt']).toBe('string');

    // ... and the state file really shows the release closed (behavior).
    const after = readActive(ws()) as {
      active: unknown;
      history: readonly { currentStage: string; version: string; doneAt?: string }[];
    };
    expect(after.active).toBeNull();
    expect(after.history).toHaveLength(1);
    expect(after.history[0]!.currentStage).toBe('done');
    expect(after.history[0]!.version).toBe('4.0.52');
    expect(typeof after.history[0]!.doneAt).toBe('string');
  });
});

describe('Scenario: a11y — the incomplete-window protection survives the guard removal', () => {
  const ws = withTmpWorkspacePerTest('peaks-release-done-prot-');

  it('when the window is NOT complete, should still refuse with WATCH_INCOMPLETE', async () => {
    // given: a release promoted 1h ago — 23h of window remain
    const promotedAt = new Date(Date.now() - 1 * HOUR_MS).toISOString();
    seedReleaseState(ws(), { stage: 'promoted', promotedAt });

    // when:  `peaks release done` runs
    const envelope = await runDone(ws().path);

    // then:  it is refused with the SAME code as before the fix
    expect(envelope['ok']).toBe(false);
    expect(envelope['code']).toBe('WATCH_INCOMPLETE');
    expect(String(envelope['message'])).toMatch(/watch window not yet complete/);

    // and nothing moved.
    const after = readActive(ws()) as { active: { currentStage: string } | null };
    expect(after.active?.currentStage).toBe('promoted');
  });

  it('when there is no active release, should still refuse with NO_ACTIVE', async () => {
    // given: an empty state
    mkdirSync(ws().peaksDir, { recursive: true });
    writeFileSync(
      join(ws().peaksDir, 'release-state.json'),
      JSON.stringify({ version: 1, active: null, history: [] }, null, 2),
      'utf8',
    );

    // when:  `peaks release done` runs
    const envelope = await runDone(ws().path);

    // then:  the NO_ACTIVE judgment is untouched by this slice
    expect(envelope['ok']).toBe(false);
    expect(envelope['code']).toBe('NO_ACTIVE');
  });
});

describe('Scenario: integration — the stage table admits promoted → done', () => {
  it('when asked, should report promoted → done as a valid transition', async () => {
    const { isValidStageTransition } = await import(
      '~/src/services/release/release-state.js'
    );
    expect(isValidStageTransition('promoted', 'done')).toBe(true);
    // Guards on the neighbouring stages are NOT widened by this slice.
    expect(isValidStageTransition('planned', 'done')).toBe(false);
    expect(isValidStageTransition('canary-10', 'done')).toBe(false);
    expect(isValidStageTransition('canary-50', 'done')).toBe(false);
    // The declared intermediate keeps its own legitimacy.
    expect(isValidStageTransition('promoted', 'watching')).toBe(true);
    expect(isValidStageTransition('watching', 'done')).toBe(true);
  });
});
