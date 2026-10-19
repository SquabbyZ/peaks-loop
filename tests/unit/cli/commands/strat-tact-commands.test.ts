// tests/unit/cli/commands/strat-tact-commands.test.ts
//
// Unit tests for the STRAT → TACT producer chain:
//   peaks strat write  — strategy.md + <out>.json (STRAT.sig)
//   peaks tact write   — verified STRAT.sig → impl.json (TACT.sig)
//   peaks tact read    — recompute TACT.sig and print the chain anchor
//
// 4-dimension split (`.peaks/standards/typescript/testing.md`):
//   - render:      artifact + envelope shapes
//   - behavior:    chain verification and each refusal branch
//   - integration: one-axis filesystem boundary (where --out may land)
//   - a11y:        named refusal text + exit code
//
// Tamper, provenance and remaining refusal branches live in
// strat-tact-tamper.test.ts.
//
// Run with: pnpm vitest run tests/unit/cli/commands/strat-tact-commands.test.ts

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';
import { declareDimensions } from '../../_setup/4dim-template.js';
import { ImplOutputSchema, StrategyOutputSchema } from '~/src/services/rd/types';
import {
  SID,
  implOut,
  jsonLine,
  makeProgram,
  readJson,
  run,
  seedChangedFile,
  stratArgs,
  strategyJsonPath,
  tactArgs,
  writeJson,
  writeStrat
} from './_strat-tact-fixture.js';

declareDimensions('tests/unit/cli/commands/strat-tact-commands.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const getWs = withTmpWorkspacePerTest('peaks-strat-tact-');

function resetExitCode(): void {
  process.exitCode = undefined;
}

describe('render — STRAT/TACT artifact + envelope shapes', () => {
  beforeEach(resetExitCode);
  afterEach(resetExitCode);

  it('when strat write runs, should write strategy.md plus a JSON sibling whose sha256 is the sig line', async () => {
    // given: a fresh tmp workspace and the registered CLI
    const ws = getWs();
    const r = makeProgram();

    // when: strat write is invoked on the session axis
    await run(r, [...stratArgs(ws), '--json']);

    // then: the markdown ends with STRAT.sig and the sibling carries the same digest
    const markdown = readFileSync(
      join(ws.path, '.peaks/_runtime', SID, 'rd', 'strategy.md'),
      'utf8'
    );
    const sigLine = /STRAT\.sig: ([a-f0-9]{64})\s*$/.exec(markdown);
    expect(sigLine).not.toBeNull();
    const sibling = StrategyOutputSchema.parse(readJson(strategyJsonPath(ws)));
    expect(sibling.sha256).toBe(sigLine?.[1]);
    expect(jsonLine(r.captured)).toMatchObject({
      ok: true,
      path: join(ws.path, '.peaks/_runtime', SID, 'rd', 'strategy.md'),
      jsonPath: strategyJsonPath(ws),
      sha256: sibling.sha256
    });
  });

  it('when tact read runs on a valid impl.json, should print sha256/inputSig/changedFiles/astGateResult', async () => {
    // given: a complete strat → tact chain
    const ws = getWs();
    seedChangedFile(ws);
    const r = makeProgram();
    await writeStrat(ws, r);
    await run(r, [...tactArgs(ws), '--json']);
    const impl = ImplOutputSchema.parse(readJson(implOut(ws)));

    // when: tact read re-reads the artifact
    r.captured.lines().length = 0;
    await run(r, ['tact', 'read', '--artifact', implOut(ws), '--project', ws.path, '--json']);

    // then: the chain anchor is printed verbatim
    expect(jsonLine(r.captured)).toMatchObject({
      ok: true,
      sha256: impl.sha256,
      inputSig: impl.inputSig,
      changedFiles: impl.changedFiles,
      astGateResult: impl.astGateResult
    });
  });
});

describe('behavior — chain verification and refusals', () => {
  beforeEach(resetExitCode);
  afterEach(resetExitCode);

  it('when tact write runs on a verified strategy, should anchor inputSig to STRAT.sig', async () => {
    // given: a strategy artifact written by strat write
    const ws = getWs();
    seedChangedFile(ws);
    const r = makeProgram();
    const strat = await writeStrat(ws, r);

    // when: tact write runs
    await run(r, [...tactArgs(ws), '--json']);

    // then: TACT.sig chains to STRAT.sig and the AST gate is recorded
    const impl = ImplOutputSchema.parse(readJson(implOut(ws)));
    expect(impl.inputSig).toBe(strat.sha256);
    expect(impl.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(impl.sha256).not.toBe(impl.inputSig);
    expect(impl.astGateResult).toEqual({ passed: true, violations: [] });
    expect(impl.changedFiles).toEqual(['src/a.ts']);
  });

  it('when the strategy JSON was edited after signing, should refuse and write no impl.json', async () => {
    // given: a signed strategy artifact whose goal was then hand-edited
    const ws = getWs();
    seedChangedFile(ws);
    const r = makeProgram();
    await writeStrat(ws, r);
    const tampered = readJson(strategyJsonPath(ws));
    tampered.goal = 'a different goal';
    writeJson(strategyJsonPath(ws), tampered);

    // when: tact write tries to anchor to it
    await run(r, [...tactArgs(ws), '--json']);

    // then: the recomputed digest disagrees and nothing is written
    expect(jsonLine(r.captured)).toMatchObject({ ok: false, code: 'STRAT_SIG_MISMATCH' });
    expect(existsSync(implOut(ws))).toBe(false);
  });

  it('when the strategy artifact is missing, should refuse with STRATEGY_NOT_FOUND', async () => {
    // given: no strategy JSON on disk
    const ws = getWs();
    seedChangedFile(ws);
    const r = makeProgram();

    // when: tact write runs
    await run(r, [...tactArgs(ws), '--json']);

    // then: the missing upstream stage is named
    expect(jsonLine(r.captured)).toMatchObject({ ok: false, code: 'STRATEGY_NOT_FOUND' });
    expect(existsSync(implOut(ws))).toBe(false);
  });

  it('when --ast-context is malformed, should refuse with INVALID_AST_CONTEXT', async () => {
    // given: a valid strategy and an unparseable AST context
    const ws = getWs();
    seedChangedFile(ws);
    const r = makeProgram();
    await writeStrat(ws, r);

    // when: tact write runs with malformed JSON
    await run(r, [...tactArgs(ws), '--ast-context', '{not-json', '--json']);

    // then: the context shape is refused before any artifact is written
    expect(jsonLine(r.captured)).toMatchObject({ ok: false, code: 'INVALID_AST_CONTEXT' });
    expect(existsSync(implOut(ws))).toBe(false);
  });

  it('when the AST gate finds an undocumented API, should refuse and name the violation', async () => {
    // given: a changed file calling a dep API its doc summary does not list
    const ws = getWs();
    seedChangedFile(ws);
    writeFileSync(
      join(ws.path, 'src', 'a.ts'),
      "import { foo } from 'extdep';\nexport const a = foo(1);\n"
    );
    const r = makeProgram();
    await writeStrat(ws, r);
    const context = JSON.stringify({
      deps: { extdep: { version: '1.0.0', source: 'npm', resolved: 'extdep@1.0.0' } },
      docSummaries: [{ dep: 'extdep', version: '1.0.0', apis: ['bar'] }]
    });

    // when: tact write runs against that context
    await run(r, [...tactArgs(ws), '--ast-context', context, '--json']);

    // then: the violation is named and TACT.sig is not written
    const refusal = jsonLine(r.captured);
    expect(refusal).toMatchObject({ ok: false, code: 'AST_GATE_FAILED' });
    expect(String(refusal.message)).toContain('foo');
    expect(existsSync(implOut(ws))).toBe(false);
  });
});

describe('integration — one-axis filesystem boundary', () => {
  beforeEach(resetExitCode);
  afterEach(resetExitCode);

  it('when --out is outside .peaks/_runtime/<sid>/, should refuse and write nothing', async () => {
    // given: an --out that escapes the session axis
    const ws = getWs();
    const r = makeProgram();
    const escape = join(ws.path, 'strategy.md');

    // when: strat write is invoked
    await run(r, [...stratArgs(ws, escape), '--json']);

    // then: the boundary is enforced before the filesystem is touched
    expect(jsonLine(r.captured)).toMatchObject({ ok: false, code: 'ONE_AXIS_VIOLATION' });
    expect(existsSync(escape)).toBe(false);
    expect(existsSync(`${escape}.json`)).toBe(false);
  });

  it('when --out is relative, should resolve it under the session axis', async () => {
    // given: a project-relative one-axis path and a missing rd/ directory
    const ws = getWs();
    const r = makeProgram();
    const relativeOut = `.peaks/_runtime/${SID}/rd/strategy.md`;

    // when: strat write runs
    await run(r, [...stratArgs(ws, relativeOut), '--json']);

    // then: the CLI creates the session directory and writes there
    expect(existsSync(join(ws.path, relativeOut))).toBe(true);
    expect(existsSync(`${join(ws.path, relativeOut)}.json`)).toBe(true);
  });
});

describe('a11y — named refusals with remedies and exit codes', () => {
  beforeEach(resetExitCode);
  afterEach(resetExitCode);

  it('when a tampered strategy is refused, should name the code, the artifact, a remedy, and exit non-zero', async () => {
    // given: a hand-edited strategy and no --json (human-readable path)
    const ws = getWs();
    seedChangedFile(ws);
    const r = makeProgram();
    await writeStrat(ws, r);
    const tampered = readJson(strategyJsonPath(ws));
    tampered.designRationale = 'edited';
    writeJson(strategyJsonPath(ws), tampered);

    // when: tact write runs without --json
    await run(r, tactArgs(ws));

    // then: the human-facing line says what failed and what to do
    expect(process.exitCode).toBe(1);
    expect(r.captured.stderrText()).toContain('STRAT_SIG_MISMATCH');
    expect(r.captured.stderrText()).toContain(strategyJsonPath(ws));
    expect(r.captured.stderrText().toLowerCase()).toContain('re-run peaks strat write');
  });
});
