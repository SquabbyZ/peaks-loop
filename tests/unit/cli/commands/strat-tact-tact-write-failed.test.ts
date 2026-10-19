// tests/unit/cli/commands/strat-tact-tact-write-failed.test.ts
//
// The one refusal branch that needs a mocked boundary: the tactical SERVICE
// rejects after the CLI's pre-check passed (a TOCTOU). The command must map it
// to a named refusal with the repo's fail() envelope, never UNHANDLED_ERROR.
//
// Dimensions:
//   - behavior: the service failure is mapped and no impl.json is written
//   - a11y:     the envelope names the command/code and carries the remedy
//   - render:   OMITTED — success artifact/envelope shapes live in
//               strat-tact-commands.test.ts
//   - integration: OMITTED — the mocked service IS the failure seam; no
//               external fs boundary is the subject of this file.
//
// Run with: pnpm vitest run tests/unit/cli/commands/strat-tact-tact-write-failed.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';

vi.mock('../../../../src/services/rd/tactical-stage.js', () => ({
  registerStratSig: vi.fn(),
  runTacticalStage: vi.fn(async () => {
    throw new Error('AST gate changed between the pre-check and the write');
  })
}));

import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';
import { declareDimensions } from '../../_setup/4dim-template.js';
import {
  implOut,
  jsonLine,
  makeProgram,
  run,
  seedChangedFile,
  tactArgs,
  writeStrat
} from './_strat-tact-fixture.js';

declareDimensions(
  'tests/unit/cli/commands/strat-tact-tact-write-failed.test.ts',
  ['behavior', 'a11y'],
  [
    {
      dim: 'render',
      reason: 'success artifact/envelope shapes are asserted in strat-tact-commands.test.ts'
    },
    {
      dim: 'integration',
      reason: 'the mocked tactical service is the failure seam; no external boundary is under test'
    }
  ]
);

const getWs = withTmpWorkspacePerTest('peaks-strat-tact-write-failed-');

function resetExitCode(): void {
  process.exitCode = undefined;
}

describe('behavior — a tactical service rejection is mapped', () => {
  beforeEach(resetExitCode);
  afterEach(resetExitCode);

  it('when runTacticalStage rejects, should refuse TACT_WRITE_FAILED and write no impl', async () => {
    // given: a verified strategy and a service that fails after the CLI pre-check
    const ws = getWs();
    seedChangedFile(ws);
    const r = makeProgram();
    await writeStrat(ws, r);

    // when: tact write runs
    await run(r, [...tactArgs(ws), '--json']);

    // then: the service error is named and no artifact is left behind
    const envelope = jsonLine(r.captured);
    expect(envelope).toMatchObject({ ok: false, code: 'TACT_WRITE_FAILED' });
    expect(String(envelope.message)).toContain('AST gate changed between');
    expect(existsSync(implOut(ws))).toBe(false);
    expect(process.exitCode).toBe(1);
  });
});

describe('a11y — the remedy is carried on the refusal', () => {
  beforeEach(resetExitCode);
  afterEach(resetExitCode);

  it('when tact write refuses, should name the command and put the remedy in nextActions', async () => {
    // given: the same contrived service failure
    const ws = getWs();
    seedChangedFile(ws);
    const r = makeProgram();
    await writeStrat(ws, r);

    // when: tact write runs with --json
    await run(r, [...tactArgs(ws), '--json']);

    // then: the fail() envelope is actionable by an LLM caller
    const envelope = jsonLine(r.captured);
    expect(envelope).toMatchObject({ ok: false, command: 'tact write', code: 'TACT_WRITE_FAILED' });
    expect(typeof envelope.errorId).toBe('string');
    expect(Array.isArray(envelope.nextActions)).toBe(true);
    expect(String((envelope.nextActions as unknown[])[0])).toContain('Re-run peaks tact write');
  });
});
