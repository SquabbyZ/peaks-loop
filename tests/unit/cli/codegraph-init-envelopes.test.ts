// tests/unit/cli/codegraph-init-envelopes.test.ts
//
// Repair-round test (rid-2026-09-12-codegraph-exclude-repair, M1) for the
// `peaks codegraph init` SUCCESS envelope.
//
// The defect: the init action built one `initNotes` array holding three
// plain confirmations ("Stamped peaks-loop marker at …", "Removed N
// exclude rule(s) …", "Rebuilt the codegraph index …") and passed it as
// `ok(command, data, warnings, nextActions)`'s THIRD argument — the
// `warnings` slot. `printResult` renders every warnings entry to STDERR
// behind a `warning: ` prefix, so a completely successful init printed a
// wall of `warning:` lines and read to the user as a failure. Worse, the
// real warning was pushed as `warning: ${…}` INTO that same array, so it
// rendered as `warning: warning: …`. The no-op branch had the identical
// bug, and so did `peaks codegraph repair-exclude`.
//
// What is mocked and why: only the upstream binary spawn
// (`executeCodegraphInvocation`). The init guard, the marker write, the
// exclude reconcile, the config rewrite, the backup and the exit code
// all run for real against a real temp git work tree.
//
// Dimensions covered:
//   - render:      the envelope's `warnings` / `nextActions` split, which
//                  is what `printResult` keys the `warning: ` prefix off
//   - behavior:    success stays silent on stderr; a real warning appears
//                  exactly once, verbatim
//   - integration: real git + real fs + the registered commander command
//   - a11y:        no double `warning: warning:` prefix reaches the user
//
// Run with: pnpm vitest run tests/unit/cli/codegraph-init-envelopes.test.ts

import { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import { cleanupTmpWorkspace, useTmpWorkspace, type TmpWorkspace } from '../_setup/tmp-workspace.js';

declareDimensions('tests/unit/cli/codegraph-init-envelopes.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y',
]);

const __m = vi.hoisted(() => ({
  executeCodegraphInvocation: vi.fn(),
}));

vi.mock('../../../src/services/codegraph/codegraph-service.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/services/codegraph/codegraph-service.js')>(
    '../../../src/services/codegraph/codegraph-service.js'
  );
  return { ...actual, executeCodegraphInvocation: __m.executeCodegraphInvocation };
});

import { registerCodegraphCommands } from '../../../src/cli/commands/codegraph-commands.js';

type CapturedIo = ReturnType<typeof makeCapturedIo>['captured'];

async function runCodegraph(argv: readonly string[]): Promise<CapturedIo> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  registerCodegraphCommands(program, io);
  await program.parseAsync(['codegraph', ...argv], { from: 'user' });
  return captured;
}

type InitEnvelope = {
  ok: boolean;
  warnings: string[];
  nextActions: string[];
  data: {
    guard: string;
    excludeRepair?: { applied: boolean; rulesRemoved: string[]; reindexed: boolean; warning: string | null };
  };
};

// The action proxies upstream's stdout ahead of the envelope, so parse
// from the envelope's opening brace rather than the whole stream.
function parseJson(captured: CapturedIo): InitEnvelope {
  const text = captured.stdout.join('\n');
  const start = text.indexOf('{');
  if (start < 0) throw new Error(`no JSON envelope in stdout: ${text}`);
  return JSON.parse(text.slice(start)) as InitEnvelope;
}

// A real temp git work tree whose tracked files include one inside
// `vendor/`, i.e. one that upstream's default `**` + `/vendor/**` rule
// silently drops from the index.
function seedGitProject(ws: TmpWorkspace): string {
  execFileSync('git', ['-C', ws.path, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', ws.path, 'config', 'user.email', 'peaks-test@example.com'], { stdio: 'ignore' });
  execFileSync('git', ['-C', ws.path, 'config', 'user.name', 'peaks test'], { stdio: 'ignore' });

  mkdirSync(join(ws.path, 'src'), { recursive: true });
  mkdirSync(join(ws.path, 'vendor'), { recursive: true });
  writeFileSync(join(ws.path, 'src', 'ok.ts'), 'export const ok = 1;\n', 'utf8');
  writeFileSync(join(ws.path, 'vendor', 'lib.ts'), 'export const lib = 1;\n', 'utf8');
  execFileSync('git', ['-C', ws.path, 'add', '-A'], { stdio: 'ignore' });
  execFileSync('git', ['-C', ws.path, 'commit', '-qm', 'fixture'], { stdio: 'ignore' });

  return ws.path;
}

/** The config bytes upstream `init` writes — including a real offender. */
function upstreamDefaultConfig(): string {
  return `${JSON.stringify(
    { version: 1, include: ['**/*.ts'], exclude: ['**/vendor/**', '**/node_modules/**'] },
    null,
    2
  )}\n`;
}

let ws: TmpWorkspace;
let savedExitCode: string | number | null | undefined;

beforeEach(() => {
  ws = useTmpWorkspace('peaks-cg-init-env-');
  savedExitCode = process.exitCode;
  process.exitCode = 0;
  __m.executeCodegraphInvocation.mockReset();
});

afterEach(() => {
  process.exitCode = savedExitCode;
  cleanupTmpWorkspace();
});

// ── render ───────────────────────────────────────────────────────────

describe('peaks codegraph init — success notes are not warnings', () => {
  it('when a fresh init fully succeeds, should report no warnings and carry the notes as next actions', async () => {
    // given: a fresh git project; the faked upstream init writes the
    //        default template with an offender, as the real one does
    const project = seedGitProject(ws);
    __m.executeCodegraphInvocation.mockImplementation(async (invocation: { subcommand: string }) => {
      if (invocation.subcommand === 'init') {
        mkdirSync(join(project, '.codegraph'), { recursive: true });
        writeFileSync(join(project, '.codegraph', 'config.json'), upstreamDefaultConfig(), 'utf8');
      }
      return { exitCode: 0, stdout: 'upstream ok\n', stderr: '' };
    });

    // when: init runs
    const captured = await runCodegraph(['init', '--project', project, '--peaks-json']);

    // then: everything positive lands in nextActions …
    const envelope = parseJson(captured);
    expect(envelope.ok).toBe(true);
    expect(envelope.nextActions).toEqual([
      `Stamped peaks-loop marker at ${join(project, '.codegraph')}/.peaks-loop-marker`,
      'Removed 1 exclude rule(s) that blocked tracked source files, recovering 1 file(s); config backed up to ' +
        `${join(project, '.codegraph', 'config.json')}.bak.`,
      'Rebuilt the codegraph index over the recovered files.',
    ]);

    // … and nothing positive lands in warnings.
    expect(envelope.warnings).toEqual([]);

    // and the repair really happened (not just reported)
    expect(envelope.data.excludeRepair?.applied).toBe(true);
    expect(envelope.data.excludeRepair?.rulesRemoved).toEqual(['**/vendor/**']);
    const config = JSON.parse(readFileSync(join(project, '.codegraph', 'config.json'), 'utf8')) as {
      exclude: string[];
    };
    expect(config.exclude).toEqual(['**/node_modules/**']);
    expect(existsSync(join(project, '.codegraph', 'config.json.bak'))).toBe(true);
    expect(process.exitCode).toBe(0);
  });
});

// ── behavior + a11y ──────────────────────────────────────────────────

describe('peaks codegraph init — a real warning is reported once, verbatim', () => {
  it('when the follow-up index fails, should keep the init successful and emit exactly one unprefixed warning', async () => {
    // given: init works but the post-repair reindex does not
    const project = seedGitProject(ws);
    __m.executeCodegraphInvocation.mockImplementation(async (invocation: { subcommand: string }) => {
      if (invocation.subcommand === 'init') {
        mkdirSync(join(project, '.codegraph'), { recursive: true });
        writeFileSync(join(project, '.codegraph', 'config.json'), upstreamDefaultConfig(), 'utf8');
        return { exitCode: 0, stdout: 'upstream ok\n', stderr: '' };
      }
      return { exitCode: 3, stdout: '', stderr: 'index exploded\n' };
    });

    // when: init runs (machine envelope)
    const captured = await runCodegraph(['init', '--project', project, '--peaks-json']);

    // then: exactly one warning, carrying the reason and nothing else …
    const envelope = parseJson(captured);
    expect(envelope.warnings).toHaveLength(1);
    expect(envelope.warnings[0]).toMatch(/^codegraph exclude repaired \(1 rule\(s\) removed\)/);
    expect(envelope.warnings[0]).not.toMatch(/^warning:/);

    // … the init itself still succeeded (a repair failure never fails init)
    expect(envelope.ok).toBe(true);
    expect(process.exitCode).toBe(0);

    // … and on the human path it is rendered exactly once, with a single
    // `warning: ` prefix supplied by the printer rather than by the note.
    const human = await runCodegraph(['init', '--project', project]);
    const warningLines = human.stderr.filter((line) => line.startsWith('warning: '));
    expect(warningLines).toEqual([`warning: ${envelope.warnings[0] ?? ''}`]);
    expect(human.stderr.join('\n')).not.toContain('warning: warning:');
  });

  it('when the init is a no-op because peaks-loop already owns the schema, should not warn', async () => {
    // given: peak-loop-managed `.codegraph/` (marker + codegraph.db)
    const project = ws.path;
    mkdirSync(join(project, '.codegraph'), { recursive: true });
    writeFileSync(join(project, '.codegraph', '.peaks-loop-marker'), 'peaks-loop-managed\n', 'utf8');
    writeFileSync(join(project, '.codegraph', 'codegraph.db'), 'schema\n', 'utf8');

    // when: init runs
    const captured = await runCodegraph(['init', '--project', project, '--peaks-json']);

    // then: the "already managed" note is an action, not a warning
    const envelope = parseJson(captured);
    expect(envelope.data.guard).toBe('noop-already-peaks-loop');
    expect(envelope.warnings).toEqual([]);
    expect(envelope.nextActions.join('\n')).toContain('is already managed by peaks-loop');
    expect(captured.stderr.join('\n')).not.toContain('warning:');
    // and the upstream binary was never spawned
    expect(__m.executeCodegraphInvocation).not.toHaveBeenCalled();
  });
});
