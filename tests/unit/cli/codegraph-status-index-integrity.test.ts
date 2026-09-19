// tests/unit/cli/codegraph-status-index-integrity.test.ts
//
// 4-dimension CLI test for the INDEX-integrity gate wired into
// `peaks codegraph status` (slice-001 of
// rid-2026-09-16-codegraph-index-integrity).
//
// The defect this guards: the exclude gate runs the `include` filter FIRST
// and never reads the index, so (①) a git-tracked file the extractor
// supports but `include` does not admit is silently absent from the index,
// and (②) the index keeps rows for paths that are gone — while
// `peaks codegraph status` printed `[OK] Index is up to date`. Both are
// now reported, and NEITHER is repaired here: this slice detects only, so
// the test also has to prove the read path left the config and the index
// byte-identical.
//
// SEVERITY (user decision, option C — advisory by default, opt-in
// blocking). Every gap case below is asserted TWICE: once with the
// default (a warning that does not fail the command) and once with
// `PEAKS_CODEGRAPH_INDEX_STRICT=1` (a failure that exits 75). A single
// polarity would let either half of the policy rot silently.
//
// What is mocked and why: only the upstream binary spawn
// (`executeCodegraphInvocation`). The git tree, the SQLite index, the
// config read, the verdict and the exit code all run for real — the CLI
// action is not stubbed.
//
// Controls (this repo's standard, non-negotiable):
//   - INJECTION control: each axis is injected into a real project and the
//     command must report the gap (and exit 75 in strict mode).
//   - CLEAN control: on a defect-free real project the command must print
//     neither `[FAIL]` nor `[WARN]`, must leave upstream's `[OK]` line
//     byte-identical, and must exit 0.
//
// Dimensions covered:
//   - behavior:    include gap / stale rows / both / clean / not-initialized
//                  / unevaluable / upstream-failure precedence
//   - render:      the human gap lines and the `--peaks-json` envelope
//   - a11y:        the exit code (read from `process.exitCode`, not the text)
//   - integration: real git + real SQLite + the registered commander command
//
// Run with: pnpm vitest run tests/unit/cli/codegraph-status-index-integrity.test.ts

import { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import {
  cleanupTmpWorkspace,
  useTmpWorkspace,
  type TmpWorkspace
} from '../_setup/tmp-workspace.js';
import { CODEGRAPH_INTEGRITY_EXIT_CODE } from '../../../src/services/codegraph/codegraph-exclude-integrity.js';
import {
  CODEGRAPH_INDEX_INTEGRITY_EXIT_CODE,
  CODEGRAPH_INDEX_STRICT_ENV_VAR,
  CODEGRAPH_INDEX_UNEVALUABLE_EXIT_CODE,
  CODEGRAPH_REPAIR_INDEX_COMMAND
} from '../../../src/services/codegraph/codegraph-index-integrity.js';

declareDimensions('tests/unit/cli/codegraph-status-index-integrity.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const __m = vi.hoisted(() => ({
  executeCodegraphInvocation: vi.fn()
}));

vi.mock('../../../src/services/codegraph/codegraph-service.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../../src/services/codegraph/codegraph-service.js')
  >('../../../src/services/codegraph/codegraph-service.js');
  return { ...actual, executeCodegraphInvocation: __m.executeCodegraphInvocation };
});

import { registerCodegraphCommands } from '../../../src/cli/commands/codegraph-commands.js';

import {
  parseJson,
  seedProject,
  withStrictMode,
  type CapturedIo,
  type Fixture
} from './_codegraph-status-index-fixture.js';

// Byte-for-byte the shape the real upstream binary prints on a clean run.
const UPSTREAM_CLEAN_STDOUT =
  '\x1b[1mIndex Statistics:\x1b[0m\n  Files:     2\n\n\x1b[32m[OK]\x1b[0m Index is up to date\n';

const stripAnsi = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '');

async function runCodegraph(argv: readonly string[]): Promise<CapturedIo> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  registerCodegraphCommands(program, io);
  await program.parseAsync(['codegraph', ...argv], { from: 'user' });
  return captured;
}

let ws: TmpWorkspace;
let savedExitCode: string | number | null | undefined;

beforeEach(() => {
  ws = useTmpWorkspace('peaks-cg-index-status-');
  savedExitCode = process.exitCode;
  process.exitCode = 0;
  delete process.env[CODEGRAPH_INDEX_STRICT_ENV_VAR];
  __m.executeCodegraphInvocation.mockReset();
  __m.executeCodegraphInvocation.mockResolvedValue({
    exitCode: 0,
    stdout: UPSTREAM_CLEAN_STDOUT,
    stderr: ''
  });
});

afterEach(() => {
  process.exitCode = savedExitCode;
  delete process.env[CODEGRAPH_INDEX_STRICT_ENV_VAR];
  cleanupTmpWorkspace();
});

// ── behavior: INJECTION control, axis ① ──────────────────────────────

describe('peaks codegraph status (include-axis gap)', () => {
  it('when include drops a supported tracked file, should warn without failing by default', async () => {
    const project = seedProject(ws, {
      include: ['**/*.ts'],
      exclude: [],
      indexedPaths: ['src/ok.ts']
    });

    const captured = await runCodegraph(['status', '--project', project]);
    const visible = stripAnsi(captured.stdout.join('\n'));

    // Advisory default: reported as a WARNING, and the command exits 0 so
    // upgrading peaks-loop cannot red-light a downstream project's CI.
    expect(visible).toContain('[WARN] codegraph index does not cover the repository');
    expect(visible).not.toContain('[FAIL]');
    expect(visible).toContain('not admitted: scripts/tool.mjs');
    expect(process.exitCode).toBe(0);

    // AC3 on the INDEX axis: upstream's unqualified `[OK] Index is up to
    // date` must not survive next to the finding. Without this assertion
    // the `|| indexGap` in the transform condition is unpinned — `[WARN]`
    // is produced by the renderer, so deleting the transform leaves every
    // other assertion in this file green.
    expect(visible).not.toContain('[OK] Index is up to date');
    expect(visible).toContain('[i] Index is up to date');
    expect(visible).toContain('(upstream: matches the last scan only');

    // Slice-002 discharged slice-001's recorded obligation to name the real
    // repair command. Pinned here so a future renderer edit cannot drop the
    // one line that tells an operator what to DO about the finding.
    //
    // The LITERAL is asserted too, not only the constant: a pin that reads
    // "the message names the constant" passes even if the constant names a
    // command that does not exist — which is the exact defect (an operator
    // following a hint into "command not found") these two lines exist to
    // prevent.
    expect(CODEGRAPH_REPAIR_INDEX_COMMAND).toBe('peaks codegraph repair-index --project <root>');
    expect(visible).toContain('peaks codegraph repair-index');
  });

  it('when the project opts in, should fail the same gap with exit 75 and [FAIL]', async () => {
    const project = seedProject(ws, {
      include: ['**/*.ts'],
      exclude: [],
      indexedPaths: ['src/ok.ts']
    });

    const captured = await withStrictMode(() => runCodegraph(['status', '--project', project]));
    const visible = stripAnsi(captured.stdout.join('\n'));

    expect(visible).toContain('[FAIL] codegraph index does not cover the repository');
    expect(visible).not.toContain('advisory: this does not fail the command');
    expect(process.exitCode).toBe(CODEGRAPH_INDEX_INTEGRITY_EXIT_CODE);
  });
});

// ── behavior: INJECTION control, axis ② ──────────────────────────────

describe('peaks codegraph status (stale rows)', () => {
  it('when the index holds a row for a missing file, should warn and suppress [OK]', async () => {
    const project = seedProject(ws, {
      include: ['**/*.ts', '**/*.mjs'],
      exclude: [],
      indexedPaths: ['src/ok.ts', 'src/deleted.ts']
    });

    const captured = await runCodegraph(['status', '--project', project]);
    const visible = stripAnsi(captured.stdout.join('\n'));

    expect(visible).toContain('[WARN] codegraph index does not cover the repository');
    expect(visible).toContain('stale: src/deleted.ts');
    expect(visible).not.toContain('not admitted:'); // axis ① held at zero
    // AC3 on the staleness axis — the second half of the `|| indexGap` pin.
    expect(visible).not.toContain('[OK] Index is up to date');
    expect(visible).toContain('(upstream: matches the last scan only');
    expect(process.exitCode).toBe(0);
  });

  it('when the project opts in, the staleness gap should exit 75', async () => {
    const project = seedProject(ws, {
      include: ['**/*.ts', '**/*.mjs'],
      exclude: [],
      indexedPaths: ['src/ok.ts', 'src/deleted.ts']
    });

    await withStrictMode(() => runCodegraph(['status', '--project', project]));

    expect(process.exitCode).toBe(CODEGRAPH_INDEX_INTEGRITY_EXIT_CODE);
  });
});

// ── behavior: CLEAN control ──────────────────────────────────────────

describe('peaks codegraph status (clean control)', () => {
  it('when the index covers the repository, should stay quiet, keep [OK], and exit 0', async () => {
    const project = seedProject(ws, {
      include: ['**/*.ts', '**/*.mjs'],
      exclude: [],
      indexedPaths: ['src/ok.ts']
    });

    const captured = await runCodegraph(['status', '--project', project]);
    const visible = stripAnsi(captured.stdout.join('\n'));

    expect(visible).not.toContain('[FAIL]');
    expect(visible).not.toContain('[WARN]');
    // Untouched: a clean run's upstream output is byte-identical.
    expect(visible).toContain('[OK] Index is up to date');
    expect(process.exitCode).toBe(0);
  });

  it('should keep the clean path byte-identical in strict mode too', async () => {
    // The switch changes severity, not the gate: a healthy project must
    // produce the identical output with and without the opt-in.
    const project = seedProject(ws, {
      include: ['**/*.ts', '**/*.mjs'],
      exclude: [],
      indexedPaths: ['src/ok.ts']
    });

    const plain = stripAnsi(
      (await runCodegraph(['status', '--project', project])).stdout.join('\n')
    );
    process.exitCode = 0;
    const strict = stripAnsi(
      (await withStrictMode(() => runCodegraph(['status', '--project', project]))).stdout.join('\n')
    );

    expect(strict).toBe(plain);
    expect(process.exitCode).toBe(0);
  });

  it('when codegraph was never initialized, should stay silent instead of warning', async () => {
    execFileSync('git', ['-C', ws.path, 'init', '-q'], { stdio: 'ignore', windowsHide: true });
    writeFileSync(join(ws.path, 'a.ts'), 'export const a = 1;\n', 'utf8');

    const captured = await runCodegraph(['status', '--project', ws.path]);
    const visible = stripAnsi(captured.stdout.join('\n'));

    expect(visible).not.toContain('[FAIL]');
    expect(visible).not.toContain('[WARN]');
    expect(process.exitCode).toBe(0);
  });
});

// ── behavior: the unevaluable axis (R1) ──────────────────────────────

describe('peaks codegraph status (index axis could not be evaluated)', () => {
  it('when the db has no files table, should fail the command naming the db path', async () => {
    const project = seedProject(ws, {
      include: ['**/*.ts'],
      exclude: [],
      indexedPaths: [],
      filesTable: false
    });

    const captured = await runCodegraph(['status', '--project', project]);
    const visible = stripAnsi(captured.stdout.join('\n'));

    // The sqlite cause is wrapped with WHICH file, like the open failure is.
    expect(visible).toContain('no such table: files');
    expect(visible).toMatch(/codegraph index .*codegraph\.db/);
    // `[FAIL]`, in every mode, because the exit code is non-zero in every
    // mode — the marker and the exit code agree.
    expect(visible).toContain('[FAIL] codegraph index integrity could not be evaluated');
    expect(visible).not.toContain('does not cover the repository');
    expect(process.exitCode).toBe(CODEGRAPH_INDEX_UNEVALUABLE_EXIT_CODE);
    expect(process.exitCode).not.toBe(0);
    expect(process.exitCode).not.toBe(CODEGRAPH_INDEX_INTEGRITY_EXIT_CODE);
  });

  it('should still exit non-zero in strict mode, and never as the gap code', async () => {
    const project = seedProject(ws, {
      include: ['**/*.ts'],
      exclude: [],
      indexedPaths: [],
      filesTable: false
    });

    await withStrictMode(() => runCodegraph(['status', '--project', project]));

    expect(process.exitCode).toBe(CODEGRAPH_INDEX_UNEVALUABLE_EXIT_CODE);
  });

  it('should carry a distinct verdict in the machine envelope', async () => {
    const project = seedProject(ws, {
      include: ['**/*.ts'],
      exclude: [],
      indexedPaths: [],
      filesTable: false
    });

    const envelope = parseJson(
      await runCodegraph(['status', '--project', project, '--peaks-json'])
    );

    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('CODEGRAPH_INDEX_NOT_EVALUATED');
    // The three-way distinction that used to be a single `null`.
    expect(envelope.data.indexIntegrity).toBeNull();
    expect(envelope.data.indexIntegrityVerdict).toBe('not-evaluated');
    expect(envelope.data.indexIntegrityWarning).toContain('no such table: files');
    expect(process.exitCode).toBe(CODEGRAPH_INDEX_UNEVALUABLE_EXIT_CODE);
  });
});

// ── behavior: initialized but the config is gone (R12-1) ─────────────

describe('peaks codegraph status (index present, config absent)', () => {
  // The defect: `configPresent === false` short-circuited BOTH axes, so a
  // project WITH an index and WITHOUT a config printed nothing and exited 0
  // — under `PEAKS_CODEGRAPH_INDEX_STRICT=1` too, which is the one mode whose
  // whole purpose is to fail loudly in CI. An absent config is legitimate for
  // a project that never ran `peaks codegraph init`; it is NOT legitimate for
  // one whose index exists, because then the axis was applicable and its
  // input was missing. Unevaluable is a verdict, not an absence of one.
  //
  // The fixture writes no config, so `include`/`exclude` below are inert.
  const CONFIGLESS: Fixture = {
    include: [],
    exclude: [],
    indexedPaths: ['src/ok.ts'],
    config: false
  };

  it('should report the axis as unevaluable instead of skipping it in silence', async () => {
    const project = seedProject(ws, { ...CONFIGLESS });

    const captured = await runCodegraph(['status', '--project', project]);
    const visible = stripAnsi(captured.stdout.join('\n'));

    expect(visible).toContain('[FAIL] codegraph index integrity could not be evaluated');
    expect(visible).toContain('the index was NOT measured');
    expect(visible).toContain('config.json');
    // Not a gap claim: nothing was measured, so claiming non-coverage would
    // assert a measurement that never happened.
    expect(visible).not.toContain('does not cover the repository');
    // The exclude axis has no config to reconcile and must not claim a
    // failure for one that was never there.
    expect(visible).not.toContain('exclude integrity not evaluated');
    expect(process.exitCode).toBe(CODEGRAPH_INDEX_UNEVALUABLE_EXIT_CODE);
    expect(process.exitCode).not.toBe(0);
  });

  it('should still fail the command under PEAKS_CODEGRAPH_INDEX_STRICT=1', async () => {
    // The strict-mode half, spelled out because "silent exit 0 in strict
    // mode" is the exact reproduction this round closes.
    const project = seedProject(ws, { ...CONFIGLESS });

    const captured = await withStrictMode(() => runCodegraph(['status', '--project', project]));
    const visible = stripAnsi(captured.stdout.join('\n'));

    expect(visible).toContain('[FAIL] codegraph index integrity could not be evaluated');
    expect(process.exitCode).toBe(CODEGRAPH_INDEX_UNEVALUABLE_EXIT_CODE);
    expect(process.exitCode).not.toBe(0);
    expect(process.exitCode).not.toBe(CODEGRAPH_INDEX_INTEGRITY_EXIT_CODE);
  });

  it('should carry the same verdict in the machine envelope', async () => {
    const project = seedProject(ws, { ...CONFIGLESS });

    const envelope = parseJson(
      await runCodegraph(['status', '--project', project, '--peaks-json'])
    );

    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('CODEGRAPH_INDEX_NOT_EVALUATED');
    expect(envelope.data.indexIntegrity).toBeNull();
    expect(envelope.data.indexIntegrityVerdict).toBe('not-evaluated');
    expect(envelope.data.indexIntegrityWarning).toContain('config.json');
    expect(process.exitCode).toBe(CODEGRAPH_INDEX_UNEVALUABLE_EXIT_CODE);
  });

  it('should stay silent on a CONFIG-ONLY project — the never-initialized control', async () => {
    // The other side of the same predicate, and the reason the index axis
    // keys on the db rather than on the config: a project that has a config
    // but no index has nothing to measure, so it must not be turned into a
    // failure. Same shape as the doctor's `defaultProbe` on that project.
    const project = seedProject(ws, {
      include: ['**/*.ts', '**/*.mjs'],
      exclude: [],
      indexedPaths: [],
      database: false
    });

    const captured = await runCodegraph(['status', '--project', project]);
    const visible = stripAnsi(captured.stdout.join('\n'));

    expect(visible).not.toContain('[FAIL]');
    expect(visible).not.toContain('[WARN]');
    expect(process.exitCode).toBe(0);
  });
});

// ── behavior: precedence when both gates fire ────────────────────────

describe('peaks codegraph status (both gates)', () => {
  it('should report both gaps but keep the exclude gate as the exit code', async () => {
    // `include` drops tool.mjs AND `exclude` blocks src/ok.ts AND the index
    // holds a dead row — all three defects in one project.
    //
    // The exclude rule must name an ADMITTED file: a rule that only blocks
    // an include-dropped file is invisible to the exclude gate, because that
    // gate reconciles `exclude` against the `include` survivors only. That
    // is precisely the blindness this slice adds a second axis for.
    const project = seedProject(ws, {
      include: ['**/*.ts'],
      exclude: ['**/ok.ts'],
      indexedPaths: ['src/ok.ts', 'src/deleted.ts']
    });

    const captured = await runCodegraph(['status', '--project', project]);
    const visible = stripAnsi(captured.stdout.join('\n'));

    expect(visible).toContain('[FAIL] codegraph index is incomplete');
    expect(visible).toContain('[WARN] codegraph index does not cover the repository');
    // 74 wins: repairing the exclude rules also rebuilds the index.
    expect(process.exitCode).toBe(CODEGRAPH_INTEGRITY_EXIT_CODE);
    expect(CODEGRAPH_INTEGRITY_EXIT_CODE).not.toBe(CODEGRAPH_INDEX_INTEGRITY_EXIT_CODE);
  });

  it('should keep the exclude gate as the exit code in strict mode too', async () => {
    const project = seedProject(ws, {
      include: ['**/*.ts'],
      exclude: ['**/ok.ts'],
      indexedPaths: ['src/ok.ts', 'src/deleted.ts']
    });

    await withStrictMode(() => runCodegraph(['status', '--project', project]));

    expect(process.exitCode).toBe(CODEGRAPH_INTEGRITY_EXIT_CODE);
  });

  it('should decide the same precedence on the JSON path', async () => {
    const project = seedProject(ws, {
      include: ['**/*.ts'],
      exclude: ['**/ok.ts'],
      indexedPaths: ['src/ok.ts', 'src/deleted.ts']
    });

    const envelope = parseJson(
      await runCodegraph(['status', '--project', project, '--peaks-json'])
    );

    expect(envelope.code).toBe('CODEGRAPH_INDEX_INCOMPLETE');
    expect(envelope.data.integrity?.gap).toBe(true);
    expect(envelope.data.indexIntegrity?.gap).toBe(true);
    expect(process.exitCode).toBe(CODEGRAPH_INTEGRITY_EXIT_CODE);
  });
});

// ── behavior: upstream failure outranks both gates (R8) ──────────────

describe('peaks codegraph status (upstream failure precedence)', () => {
  it('when upstream fails and the index has a gap, should report the command failure', async () => {
    // The precedence decision, pinned: an upstream failure is the more
    // fundamental precondition, and under the advisory default a
    // gate-first order would exit 0 here — the gate MASKING a real
    // command failure. The gap verdict is still carried in `data`.
    const project = seedProject(ws, {
      include: ['**/*.ts'],
      exclude: [],
      indexedPaths: ['src/ok.ts']
    });
    __m.executeCodegraphInvocation.mockResolvedValue({
      exitCode: 5,
      stdout: '',
      stderr: 'upstream exploded\n'
    });

    const envelope = parseJson(
      await runCodegraph(['status', '--project', project, '--peaks-json'])
    );

    expect(envelope.code).toBe('CODEGRAPH_COMMAND_FAILED');
    expect(envelope.data.indexIntegrity?.gap).toBe(true);
    expect(process.exitCode).toBe(5);
  });

  it('when upstream fails and the exclude gate has a gap, should report the command failure', async () => {
    // Same precedence on the OTHER axis — the decision is symmetric, not
    // a change to one branch only.
    const project = seedProject(ws, {
      include: ['**/*.ts'],
      exclude: ['**/ok.ts'],
      indexedPaths: ['src/ok.ts']
    });
    __m.executeCodegraphInvocation.mockResolvedValue({
      exitCode: 5,
      stdout: '',
      stderr: 'upstream exploded\n'
    });

    const envelope = parseJson(
      await runCodegraph(['status', '--project', project, '--peaks-json'])
    );

    expect(envelope.code).toBe('CODEGRAPH_COMMAND_FAILED');
    expect(envelope.data.integrity?.gap).toBe(true);
    expect(process.exitCode).toBe(5);
  });

  it('should apply the same precedence on the human path, in strict mode too', async () => {
    // Strict mode is what makes this assertion load-bearing: in advisory
    // mode the index tail contributes no exit code, so a broken
    // precedence is invisible (the run exits 5 either way). Under the
    // opt-in, an unusurped tail would overwrite 5 with 75 — which is
    // precisely the misattribution R8 named.
    const project = seedProject(ws, {
      include: ['**/*.ts'],
      exclude: [],
      indexedPaths: ['src/ok.ts']
    });
    __m.executeCodegraphInvocation.mockResolvedValue({
      exitCode: 5,
      stdout: '',
      stderr: 'upstream exploded\n'
    });

    await withStrictMode(() => runCodegraph(['status', '--project', project]));

    expect(process.exitCode).toBe(5);
    expect(process.exitCode).not.toBe(CODEGRAPH_INDEX_INTEGRITY_EXIT_CODE);
  });

  it('should let upstream failure outrank the exclude gate on the human path', async () => {
    const project = seedProject(ws, {
      include: ['**/*.ts'],
      exclude: ['**/ok.ts'],
      indexedPaths: ['src/ok.ts']
    });
    __m.executeCodegraphInvocation.mockResolvedValue({
      exitCode: 5,
      stdout: '',
      stderr: 'upstream exploded\n'
    });

    await runCodegraph(['status', '--project', project]);

    expect(process.exitCode).toBe(5);
    expect(process.exitCode).not.toBe(CODEGRAPH_INTEGRITY_EXIT_CODE);
  });
});

// ── render: the machine envelope ─────────────────────────────────────

describe('peaks codegraph status --peaks-json (index integrity)', () => {
  it('should carry the index verdict as machine-readable data', async () => {
    const project = seedProject(ws, {
      include: ['**/*.ts'],
      exclude: [],
      indexedPaths: ['src/ok.ts', 'src/deleted.ts']
    });

    const captured = await runCodegraph(['status', '--project', project, '--peaks-json']);
    const envelope = parseJson(captured);

    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('CODEGRAPH_INDEX_GAP');
    expect(envelope.data.indexIntegrity?.gap).toBe(true);
    expect(envelope.data.indexIntegrity?.includeGap).toEqual(['scripts/tool.mjs']);
    expect(envelope.data.indexIntegrity?.deadRows).toEqual(['src/deleted.ts']);
    expect(envelope.data.indexIntegrity?.trackedSourceCount).toBe(2);
    expect(envelope.data.indexIntegrity?.admittedTrackedCount).toBe(1);
    expect(envelope.data.indexIntegrity?.indexedFileCount).toBe(2);
    // The exclude axis is still reported independently and is clean here.
    expect(envelope.data.integrity?.gap).toBe(false);
    // Advisory: the finding IS reported, the exit code is not escalated.
    expect(envelope.data.indexIntegrityVerdict).toBe('gap');
    expect(envelope.data.indexIntegritySeverity).toBe('warning');
    expect(process.exitCode).toBe(0);
  });

  it('should escalate the machine envelope in strict mode', async () => {
    const project = seedProject(ws, {
      include: ['**/*.ts'],
      exclude: [],
      indexedPaths: ['src/ok.ts', 'src/deleted.ts']
    });

    const envelope = parseJson(
      await withStrictMode(() => runCodegraph(['status', '--project', project, '--peaks-json']))
    );

    expect(envelope.code).toBe('CODEGRAPH_INDEX_GAP');
    expect(envelope.data.indexIntegritySeverity).toBe('error');
    expect(process.exitCode).toBe(CODEGRAPH_INDEX_INTEGRITY_EXIT_CODE);
  });

  it('should report a clean verdict on a healthy project, distinguishable from not-applicable', async () => {
    const project = seedProject(ws, {
      include: ['**/*.ts', '**/*.mjs'],
      exclude: [],
      indexedPaths: ['src/ok.ts']
    });

    const envelope = parseJson(
      await runCodegraph(['status', '--project', project, '--peaks-json'])
    );

    expect(envelope.ok).toBe(true);
    expect(envelope.data.indexIntegrityVerdict).toBe('clean');
    expect(envelope.data.indexIntegritySeverity).toBeNull();
    expect(process.exitCode).toBe(0);
  });

  it('should report a not-applicable verdict when there is no index to inspect', async () => {
    execFileSync('git', ['-C', ws.path, 'init', '-q'], { stdio: 'ignore', windowsHide: true });

    const captured = await runCodegraph(['status', '--project', ws.path, '--peaks-json']);
    const envelope = parseJson(captured);

    expect(envelope.ok).toBe(true);
    expect(envelope.data.indexIntegrity).toBeNull();
    // "There is nothing to inspect" — NOT "I could not inspect it".
    expect(envelope.data.indexIntegrityVerdict).toBe('not-applicable');
    // No finding, so no severity — `'warning'` here would read as
    // "something was wrong but advisory".
    expect(envelope.data.indexIntegritySeverity).toBeNull();
    expect(process.exitCode).toBe(0);
  });
});

// ── integration: detection only — nothing is repaired ────────────────

describe('peaks codegraph status (read-only contract)', () => {
  // Everything the fixture creates, plus the two SQLite sidecars a
  // read-only open of a WAL database is allowed to create/update. A file
  // outside this set means the gate wrote something it should not have.
  const ALLOWED_CODEGRAPH_ENTRIES = new Set([
    'config.json',
    'codegraph.db',
    'codegraph.db-shm',
    'codegraph.db-wal'
  ]);

  it('should not modify the config or the index, and add no unexpected file', async () => {
    const project = seedProject(ws, {
      include: ['**/*.ts'],
      exclude: [],
      indexedPaths: ['src/ok.ts', 'src/deleted.ts']
    });
    const configPath = join('.codegraph', 'config.json');
    const dbPath = join('.codegraph', 'codegraph.db');
    const configBefore = readFileSync(join(project, configPath), 'utf8');
    const dbBefore = readFileSync(join(project, dbPath));

    await runCodegraph(['status', '--project', project]);

    expect(readFileSync(join(project, configPath), 'utf8')).toBe(configBefore);
    expect(readFileSync(join(project, dbPath)).equals(dbBefore)).toBe(true);

    // Same claim one level up: the DIRECTORY listing, not just the db
    // bytes. A WAL-fixture db is the production condition, so the
    // `-shm`/`-wal` sidecars are expected; anything else is not.
    const extra = readdirSync(join(project, '.codegraph')).filter(
      (entry) => !ALLOWED_CODEGRAPH_ENTRIES.has(entry)
    );
    expect(extra).toEqual([]);
  });
});

// ── integration: the shared read (perf audit F1 / R4) ────────────────

describe('peaks codegraph status (shared read)', () => {
  it('should spawn git ls-files once per command, not once per axis', async () => {
    // Both axes need the same tracked-file list. Before the deps seam
    // existed each inspector read it for itself, so `GIT_TRACE` showed two
    // `git ls-files` spawns per command (verified: 2 before, 1 after).
    const project = seedProject(ws, {
      include: ['**/*.ts', '**/*.mjs'],
      exclude: [],
      indexedPaths: ['src/ok.ts']
    });

    const tracePath = join(
      tmpdir(),
      `peaks-cg-trace-${String(Date.now())}-${String(process.pid)}.log`
    );
    const previousTrace = process.env.GIT_TRACE;
    process.env.GIT_TRACE = tracePath;
    try {
      await runCodegraph(['status', '--project', project]);
    } finally {
      if (previousTrace === undefined) {
        delete process.env.GIT_TRACE;
      } else {
        process.env.GIT_TRACE = previousTrace;
      }
    }

    const trace = readFileSync(tracePath, 'utf8');
    rmSync(tracePath, { force: true });
    const spawns = trace.split('\n').filter((line) => line.includes('git ls-files')).length;

    expect(spawns).toBe(1);
  });
});
