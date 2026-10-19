// tests/unit/cli/commands/strat-tact-tamper.test.ts
//
// Adversarial half of the STRAT/TACT command coverage. Every test edits an
// artifact AFTER it was signed and proves the CLI refuses it — including
// nested fields, array entries and added unknown keys (the digest must cover
// the whole document, and the schemas are strict).
//
// Dimensions:
//   - behavior:    digest/schema refusals and the remaining named refusals
//   - integration: filesystem provenance (markdown sibling) and changed-file containment
//   - a11y:        the refusal envelope is the repo's fail() shape
//   - render:      OMITTED — artifact/envelope success shapes are asserted in
//                  strat-tact-commands.test.ts.
//
// Run with: pnpm vitest run tests/unit/cli/commands/strat-tact-tamper.test.ts

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';
import { declareDimensions } from '../../_setup/4dim-template.js';
import { canonicalSha256 } from '~/src/services/rd/canonical-hash';
import {
  SID,
  implOut,
  jsonLine,
  makeProgram,
  readJson,
  run,
  seedChangedFile,
  sessionDir,
  stratArgs,
  stratOut,
  strategyJsonPath,
  tactArgs,
  tactArgsFor,
  writeChain,
  writeJson,
  writeStrat
} from './_strat-tact-fixture.js';

declareDimensions(
  'tests/unit/cli/commands/strat-tact-tamper.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason: 'success artifact/envelope shapes are asserted in strat-tact-commands.test.ts'
    }
  ]
);

const getWs = withTmpWorkspacePerTest('peaks-strat-tact-tamper-');

function resetExitCode(): void {
  process.exitCode = undefined;
}

/** Edit a signed artifact and restore a CORRECT digest for the edited body. */
function rewriteSigned(path: string, mutate: (doc: Record<string, unknown>) => void): void {
  const doc = readJson(path);
  mutate(doc);
  doc.sha256 = canonicalSha256(doc);
  writeJson(path, doc);
}

describe('behavior — the digest covers nested values and strict schemas', () => {
  beforeEach(resetExitCode);
  afterEach(resetExitCode);

  it('when nested astGateResult.passed is forged, should refuse IMPL_SIG_MISMATCH', async () => {
    // given: a valid chain whose nested gate verdict was flipped
    const ws = getWs();
    seedChangedFile(ws);
    const r = makeProgram();
    await writeChain(ws, r);
    const impl = readJson(implOut(ws));
    (impl.astGateResult as Record<string, unknown>).passed = false;
    writeJson(implOut(ws), impl);

    // when: tact read re-reads it
    r.captured.lines().length = 0;
    await run(r, ['tact', 'read', '--artifact', implOut(ws), '--project', ws.path, '--json']);

    // then: the nested edit is inside the digest and refused
    expect(jsonLine(r.captured)).toMatchObject({ ok: false, code: 'IMPL_SIG_MISMATCH' });
  });

  it('when a violations[] entry is added, should refuse IMPL_SIG_MISMATCH', async () => {
    // given: a valid chain with one forged violation appended
    const ws = getWs();
    seedChangedFile(ws);
    const r = makeProgram();
    await writeChain(ws, r);
    const impl = readJson(implOut(ws));
    const gate = impl.astGateResult as Record<string, unknown>;
    (gate.violations as unknown[]).push({
      file: 'src/a.ts',
      line: 1,
      api: 'forged',
      expectedVersion: '1.0.0',
      actualVersion: 'unknown',
      severity: 'error'
    });
    writeJson(implOut(ws), impl);

    // when: tact read re-reads it
    r.captured.lines().length = 0;
    await run(r, ['tact', 'read', '--artifact', implOut(ws), '--project', ws.path, '--json']);

    // then: array entries participate in the digest
    expect(jsonLine(r.captured)).toMatchObject({ ok: false, code: 'IMPL_SIG_MISMATCH' });
  });

  it('when a nested strategy field is added, should refuse STRAT_SIG_MISMATCH', async () => {
    // given: a signed strategy with a forged askUserQuestion block
    const ws = getWs();
    seedChangedFile(ws);
    const r = makeProgram();
    await writeStrat(ws, r);
    const strategy = readJson(strategyJsonPath(ws));
    strategy.askUserQuestion = { question: 'forged?', options: ['yes'] };
    writeJson(strategyJsonPath(ws), strategy);

    // when: tact write tries to anchor to it
    await run(r, [...tactArgs(ws), '--json']);

    // then: the nested edit changes the digest and nothing is written
    expect(jsonLine(r.captured)).toMatchObject({ ok: false, code: 'STRAT_SIG_MISMATCH' });
    expect(existsSync(implOut(ws))).toBe(false);
  });

  it('when an unknown impl field is added, should refuse IMPL_SIG_MISMATCH', async () => {
    // given: an added top-level field the schema does not name
    const ws = getWs();
    seedChangedFile(ws);
    const r = makeProgram();
    await writeChain(ws, r);
    const impl = readJson(implOut(ws));
    impl.forged = 'extra';
    writeJson(implOut(ws), impl);

    // when: tact read re-reads it
    r.captured.lines().length = 0;
    await run(r, ['tact', 'read', '--artifact', implOut(ws), '--project', ws.path, '--json']);

    // then: unknown fields are hashed, not silently stripped
    expect(jsonLine(r.captured)).toMatchObject({ ok: false, code: 'IMPL_SIG_MISMATCH' });
  });

  it('when an unknown strategy field is added, should refuse STRAT_SIG_MISMATCH', async () => {
    // given: an added top-level field on the strategy
    const ws = getWs();
    seedChangedFile(ws);
    const r = makeProgram();
    await writeStrat(ws, r);
    const strategy = readJson(strategyJsonPath(ws));
    strategy.forged = 'extra';
    writeJson(strategyJsonPath(ws), strategy);

    // when: tact write tries to anchor to it
    await run(r, [...tactArgs(ws), '--json']);

    // then: the added field is refused
    expect(jsonLine(r.captured)).toMatchObject({ ok: false, code: 'STRAT_SIG_MISMATCH' });
  });

  it('when an unknown impl field is re-signed, should refuse INVALID_IMPL (strict schema)', async () => {
    // given: an added field whose digest was recomputed to match
    const ws = getWs();
    seedChangedFile(ws);
    const r = makeProgram();
    await writeChain(ws, r);
    rewriteSigned(implOut(ws), (doc) => {
      doc.forged = 'extra';
    });

    // when: tact read re-reads it
    r.captured.lines().length = 0;
    await run(r, ['tact', 'read', '--artifact', implOut(ws), '--project', ws.path, '--json']);

    // then: the strict schema rejects the unknown key
    expect(jsonLine(r.captured)).toMatchObject({ ok: false, code: 'INVALID_IMPL' });
  });

  it('when --session-id is not a single safe segment, should refuse INVALID_SESSION_ID', async () => {
    // given: a traversal-shaped session id
    const ws = getWs();
    const r = makeProgram();

    // when: strat write runs
    await run(r, [
      'strat',
      'write',
      '--project',
      ws.path,
      '--session-id',
      '../escape',
      '--out',
      `.peaks/_runtime/${SID}/rd/strategy.md`,
      '--goal',
      'g',
      '--root-cause',
      'r',
      '--impact',
      'src/a.ts',
      '--design',
      'd',
      '--json'
    ]);

    // then: the id is refused before any path is resolved
    expect(jsonLine(r.captured)).toMatchObject({ ok: false, code: 'INVALID_SESSION_ID' });
  });

  it('when the strategy JSON is not parseable, should refuse INVALID_STRATEGY_JSON', async () => {
    // given: a strategy sibling containing non-JSON text
    const ws = getWs();
    seedChangedFile(ws);
    const r = makeProgram();
    await writeStrat(ws, r);
    writeFileSync(strategyJsonPath(ws), 'not json');

    // when: tact write runs
    await run(r, [...tactArgs(ws), '--json']);

    // then: the parse failure is named
    expect(jsonLine(r.captured)).toMatchObject({ ok: false, code: 'INVALID_STRATEGY_JSON' });
  });

  it('when the strategy JSON is re-signed but schema-invalid, should refuse INVALID_STRATEGY', async () => {
    // given: a required field removed and the digest recomputed
    const ws = getWs();
    seedChangedFile(ws);
    const r = makeProgram();
    await writeStrat(ws, r);
    rewriteSigned(strategyJsonPath(ws), (doc) => {
      Reflect.deleteProperty(doc, 'goal');
    });

    // when: tact write runs
    await run(r, [...tactArgs(ws), '--json']);

    // then: the schema refusal is named
    expect(jsonLine(r.captured)).toMatchObject({ ok: false, code: 'INVALID_STRATEGY' });
  });

  it('when the impl artifact is missing, should refuse IMPL_NOT_FOUND', async () => {
    // given: no impl.json on disk
    const ws = getWs();
    const r = makeProgram();

    // when: tact read runs
    await run(r, ['tact', 'read', '--artifact', implOut(ws), '--project', ws.path, '--json']);

    // then: the missing artifact is named
    expect(jsonLine(r.captured)).toMatchObject({ ok: false, code: 'IMPL_NOT_FOUND' });
  });

  it('when impl.json is not parseable, should refuse INVALID_IMPL_JSON', async () => {
    // given: a valid chain whose impl.json was replaced with text
    const ws = getWs();
    seedChangedFile(ws);
    const r = makeProgram();
    await writeChain(ws, r);
    writeFileSync(implOut(ws), 'not json');

    // when: tact read runs
    r.captured.lines().length = 0;
    await run(r, ['tact', 'read', '--artifact', implOut(ws), '--project', ws.path, '--json']);

    // then: the parse failure is named
    expect(jsonLine(r.captured)).toMatchObject({ ok: false, code: 'INVALID_IMPL_JSON' });
  });

  it('when impl.json is re-signed but schema-invalid, should refuse INVALID_IMPL', async () => {
    // given: an impossible version with a matching digest
    const ws = getWs();
    seedChangedFile(ws);
    const r = makeProgram();
    await writeChain(ws, r);
    rewriteSigned(implOut(ws), (doc) => {
      doc.version = '2.0';
    });

    // when: tact read runs
    r.captured.lines().length = 0;
    await run(r, ['tact', 'read', '--artifact', implOut(ws), '--project', ws.path, '--json']);

    // then: the schema refusal is named
    expect(jsonLine(r.captured)).toMatchObject({ ok: false, code: 'INVALID_IMPL' });
  });
});

describe('integration — provenance and changed-file containment', () => {
  beforeEach(resetExitCode);
  afterEach(resetExitCode);

  it('when --changed-files escapes the project, should refuse INVALID_CHANGED_FILE', async () => {
    // given: a traversal-shaped changed file
    const ws = getWs();
    seedChangedFile(ws);
    const r = makeProgram();
    await writeStrat(ws, r);

    // when: tact write runs
    await run(r, [...tactArgsFor(ws, ['../outside/evil.ts']), '--json']);

    // then: the gate never reads outside the project
    expect(jsonLine(r.captured)).toMatchObject({ ok: false, code: 'INVALID_CHANGED_FILE' });
    expect(existsSync(implOut(ws))).toBe(false);
  });

  it('when --changed-files is absolute, should refuse INVALID_CHANGED_FILE', async () => {
    // given: an absolute changed file
    const ws = getWs();
    seedChangedFile(ws);
    const r = makeProgram();
    await writeStrat(ws, r);

    // when: tact write runs
    await run(r, [...tactArgsFor(ws, [join(ws.path, 'src', 'a.ts')]), '--json']);

    // then: entries must be project-relative
    expect(jsonLine(r.captured)).toMatchObject({ ok: false, code: 'INVALID_CHANGED_FILE' });
  });

  it('when --changed-files names a missing file, should refuse INVALID_CHANGED_FILE', async () => {
    // given: a path that does not exist
    const ws = getWs();
    seedChangedFile(ws);
    const r = makeProgram();
    await writeStrat(ws, r);

    // when: tact write runs
    await run(r, [...tactArgsFor(ws, ['src/missing.ts']), '--json']);

    // then: the missing file is named instead of silently skipped
    expect(jsonLine(r.captured)).toMatchObject({ ok: false, code: 'INVALID_CHANGED_FILE' });
  });

  it('when the strategy markdown sibling is missing, should refuse STRATEGY_MARKDOWN_NOT_FOUND', async () => {
    // given: only the JSON sibling survives
    const ws = getWs();
    seedChangedFile(ws);
    const r = makeProgram();
    await writeStrat(ws, r);
    rmSync(stratOut(ws));

    // when: tact write runs
    await run(r, [...tactArgs(ws), '--json']);

    // then: provenance requires BOTH halves of the STRAT artifact
    expect(jsonLine(r.captured)).toMatchObject({
      ok: false,
      code: 'STRATEGY_MARKDOWN_NOT_FOUND'
    });
    expect(existsSync(implOut(ws))).toBe(false);
  });

  it('when the markdown signature disagrees with the JSON, should refuse STRATEGY_SIG_MISMATCH', async () => {
    // given: a markdown sig line replaced after signing
    const ws = getWs();
    seedChangedFile(ws);
    const r = makeProgram();
    await writeStrat(ws, r);
    const markdown = readFileSync(stratOut(ws), 'utf8');
    writeFileSync(
      stratOut(ws),
      markdown.replace(/STRAT\.sig: [a-f0-9]{64}/, `STRAT.sig: ${'b'.repeat(64)}`)
    );

    // when: tact write runs
    await run(r, [...tactArgs(ws), '--json']);

    // then: the two halves must carry the same sig
    expect(jsonLine(r.captured)).toMatchObject({ ok: false, code: 'STRATEGY_SIG_MISMATCH' });
  });

  it('when --out sits in a ..foo directory inside the session axis, should accept it', async () => {
    // given: a legitimate directory whose name merely starts with two dots
    const ws = getWs();
    const r = makeProgram();
    const out = join(sessionDir(ws), '..foo', 'strategy.md');

    // when: strat write runs
    await run(r, [...stratArgs(ws, out), '--json']);

    // then: the containment check compares path segments, not string prefixes
    expect(existsSync(out)).toBe(true);
  });
});

describe('a11y — the refusal envelope is the repo fail() shape', () => {
  beforeEach(resetExitCode);
  afterEach(resetExitCode);

  it('when tact read refuses, should emit command/code/message/nextActions/errorId and exit 1', async () => {
    // given: a chain whose impl.json nested field was forged
    const ws = getWs();
    seedChangedFile(ws);
    const r = makeProgram();
    await writeChain(ws, r);
    const impl = readJson(implOut(ws));
    (impl.astGateResult as Record<string, unknown>).passed = false;
    writeJson(implOut(ws), impl);

    // when: tact read runs with --json
    r.captured.lines().length = 0;
    await run(r, ['tact', 'read', '--artifact', implOut(ws), '--project', ws.path, '--json']);

    // then: the envelope is shaped like fail(), not a bespoke error object
    const envelope = jsonLine(r.captured);
    expect(envelope).toMatchObject({
      ok: false,
      command: 'tact read',
      code: 'IMPL_SIG_MISMATCH'
    });
    expect(typeof envelope.message).toBe('string');
    expect(typeof envelope.errorId).toBe('string');
    expect(Array.isArray(envelope.nextActions)).toBe(true);
    expect(String((envelope.nextActions as unknown[])[0])).toContain('Re-run peaks tact write');
    expect(process.exitCode).toBe(1);
  });
});
