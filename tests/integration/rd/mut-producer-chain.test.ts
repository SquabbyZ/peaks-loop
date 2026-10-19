// tests/integration/rd/mut-producer-chain.test.ts
//
// AC6 — the documented STRAT → TACT → MUT chain runs end-to-end through the
// registered CLI surface, not through the service functions:
//
//   peaks strat write  → strategy.md + strategy.md.json (STRAT.sig)
//   peaks tact write   → impl.json (TACT.sig, inputSig = STRAT.sig)
//   peaks tact read    → recomputed chain anchor
//   peaks mut run      → mut-report.json whose inputSig = TACT.sig
//
// Stryker is injected (the same seam `tests/integration/mut/end-to-end.test.ts`
// uses) so no real mutation subprocess is spawned.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { registerStratTactCommands } from '../../../src/cli/commands/strat-tact-commands.js';
import { createMutCommands } from '../../../src/cli/commands/mut-commands.js';
import { makeCapturedIo } from '../../unit/_setup/io.js';

const SID = '2026-10-19-mut-producer-e2e';

describe('STRAT → TACT → MUT producer chain', () => {
  let project: string;
  let captured: ReturnType<typeof makeCapturedIo>['captured'];
  let program: Command;

  function artifact(relativePath: string): string {
    return join(project, '.peaks', '_runtime', SID, relativePath);
  }

  async function run(args: string[]): Promise<void> {
    await program.parseAsync(args, { from: 'user' });
  }

  beforeEach(() => {
    process.exitCode = undefined;
    project = mkdtempSync(join(tmpdir(), 'peaks-mut-producer-'));
    mkdirSync(join(project, 'src'), { recursive: true });
    writeFileSync(
      join(project, 'src', 'add.ts'),
      'export const add = (a: number, b: number) => a + b;\n'
    );
    writeFileSync(
      join(project, 'src', 'add.test.ts'),
      [
        "import { describe, it, expect } from 'vitest';",
        "import { add } from './add';",
        '',
        "describe('add', () => {",
        "  it('adds', () => {",
        '    expect(add(2, 2)).toBe(4);',
        '    expect(add(0, 0)).toBe(0);',
        '  });',
        '});',
        ''
      ].join('\n')
    );

    const io = makeCapturedIo();
    captured = io.captured;
    program = new Command();
    registerStratTactCommands(program, io.io);
    program.addCommand(
      createMutCommands({
        invokeStryker: vi.fn(async () => ({
          mutantsTotal: 4,
          mutantsKilled: 4,
          mutantsSurvived: 0,
          mutantsTimeout: 0,
          perFile: [{ file: 'src/add.ts', killRate: 1, survived: [] }]
        }))
      })
    );
  });

  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it('when the four commands run in order, should make mut inputSig equal TACT.sig', async () => {
    // given: a project with a source + test file and the registered CLI
    // when: strat write produces STRAT.sig
    await run([
      'strat',
      'write',
      '--project',
      project,
      '--session-id',
      SID,
      '--out',
      `.peaks/_runtime/${SID}/rd/strategy.md`,
      '--goal',
      'produce the mut chain',
      '--root-cause',
      'the prerequisite had no producer',
      '--impact',
      'src/add.ts',
      '--design',
      'thin wrappers over the rd sub-stages',
      '--json'
    ]);
    const strategyJson = JSON.parse(readFileSync(artifact('rd/strategy.md.json'), 'utf8')) as {
      sha256: string;
    };
    expect(readFileSync(artifact('rd/strategy.md'), 'utf8')).toContain(
      `STRAT.sig: ${strategyJson.sha256}`
    );

    // when: tact write verifies STRAT.sig and writes TACT.sig
    await run([
      'tact',
      'write',
      '--project',
      project,
      '--session-id',
      SID,
      '--strategy',
      `.peaks/_runtime/${SID}/rd/strategy.md.json`,
      '--out',
      `.peaks/_runtime/${SID}/rd/impl.json`,
      '--changed-files',
      'src/add.ts',
      '--json'
    ]);
    const impl = JSON.parse(readFileSync(artifact('rd/impl.json'), 'utf8')) as {
      sha256: string;
      inputSig: string;
      astGateResult: { passed: boolean };
    };
    expect(impl.inputSig).toBe(strategyJson.sha256);
    expect(impl.astGateResult.passed).toBe(true);

    // when: tact read re-reads it
    captured.lines().length = 0;
    await run([
      'tact',
      'read',
      '--artifact',
      `.peaks/_runtime/${SID}/rd/impl.json`,
      '--project',
      project,
      '--json'
    ]);
    const read = JSON.parse(captured.text().trim().split('\n').at(-1) ?? '{}') as {
      sha256?: string;
      inputSig?: string;
    };
    expect(read.sha256).toBe(impl.sha256);
    expect(read.inputSig).toBe(strategyJson.sha256);

    // when: mut run anchors to TACT.sig
    await run([
      'mut',
      'run',
      '--project',
      project,
      '--test-files',
      'src/add.test.ts',
      '--input-sig',
      impl.sha256,
      '--session-id',
      SID,
      '--out',
      // peaks mut resolves --out against the process CWD (not --project),
      // so give it the absolute one-axis path this test asserts against.
      artifact('mut/mut-report.json'),
      '--json'
    ]);

    // then: the report chains back and the MUT_REPORT prerequisite can pass
    const reportRaw = readFileSync(artifact('mut/mut-report.json'), 'utf8');
    const report = JSON.parse(reportRaw) as {
      inputSig: string;
      thresholds: { passed: boolean };
      sha256: string;
    };
    expect(report.inputSig).toBe(impl.sha256);
    expect(report.thresholds.passed).toBe(true);
    expect(report.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(reportRaw).toContain('"passed": true');
  });
});
