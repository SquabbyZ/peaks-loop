// tests/unit/cli/codegraph-repair-note.test.ts
//
// A1 of rid `2026-09-17-codegraph-msg-and-refresh` — the repair sentence named
// the wrong axis' number, and the defect is in what a HUMAN READS, so this
// file asserts the rendered sentence rather than the envelope (the envelope
// fields are pinned in tests/unit/services/codegraph/codegraph-exclude-repair.test.ts).
//
// THE DEFECT, measured on this repo: `appliedRepairNote` ended one sentence
// about BOTH config axes with a single "recovering N tracked source file(s)",
// fed by `filesRecovered` — the EXCLUDE axis' counter. The run that appended 5
// include patterns for 31 tracked files printed
//
//   Added 5 include pattern(s) and removed 0 exclude rule(s),
//   recovering 0 tracked source file(s).
//
// a true statement about the axis that did not move, read as a verdict on the
// one that did. `admittingClause` could not correct it either: it goes silent
// once the ratio is complete, which is exactly the state a fresh include
// repair produces.
//
// Dimensions covered:
//   - render:      the operator-visible sentence (stdout `next:` line)
//   - behavior:    the axis attribution inside that sentence
//   - integration: real temp git work tree + the real CLI action with only the
//                  upstream process spawn mocked
//   - a11y:        OMITTED — the sentence IS the accessibility surface here and
//                  is asserted under render; there is no separate channel
//
// NOTE: glob literals contain the two-character sequence that ends a block
// comment, so every comment here uses `//` lines.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';

declareDimensions(
  'tests/unit/cli/codegraph-repair-note.test.ts',
  ['render', 'behavior', 'integration'],
  [
    {
      dim: 'a11y',
      reason:
        'the rendered sentence is the only operator surface for this defect and is asserted under render'
    }
  ]
);

const __m = vi.hoisted(() => ({ executeCodegraphInvocation: vi.fn() }));

// Only the process spawn is mocked. The reconcilers, the writer, the git
// traversal and the sentence itself all run for real — a mocked repair could
// not exhibit the defect this file exists to pin.
vi.mock('../../../src/services/codegraph/codegraph-service.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../../src/services/codegraph/codegraph-service.js')
  >('../../../src/services/codegraph/codegraph-service.js');
  return { ...actual, executeCodegraphInvocation: __m.executeCodegraphInvocation };
});

import { registerCodegraphCommands } from '../../../src/cli/commands/codegraph-commands.js';

type CapturedIo = ReturnType<typeof makeCapturedIo>['captured'];

const cleanups: string[] = [];

afterEach(() => {
  while (cleanups.length > 0) {
    const dir = cleanups.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

/**
 * The measured run's shape, on a two-file scale: the INCLUDE axis has work
 * (the on-disk include list admits TypeScript only, so 5 upstream-supported
 * extensions get appended and 2 tracked files are newly admitted) and the
 * EXCLUDE axis is clean (its one rule blocks nothing tracked).
 */
function seedIncludeHeavyProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-cg-note-'));
  cleanups.push(root);
  execFileSync('git', ['-C', root, 'init', '-q'], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['-C', root, 'config', 'user.email', 'peaks-test@example.com'], {
    stdio: 'ignore',
    windowsHide: true
  });
  execFileSync('git', ['-C', root, 'config', 'user.name', 'peaks test'], {
    stdio: 'ignore',
    windowsHide: true
  });

  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'ok.ts'), 'export const ok = 1;\n', 'utf8');
  writeFileSync(join(root, 'app.mjs'), 'export const a = 1;\n', 'utf8');
  writeFileSync(join(root, 'tool.cjs'), 'module.exports = 1;\n', 'utf8');
  execFileSync('git', ['-C', root, 'add', '-A'], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['-C', root, 'commit', '-qm', 'fixture'], {
    stdio: 'ignore',
    windowsHide: true
  });

  mkdirSync(join(root, '.codegraph'), { recursive: true });
  writeFileSync(
    join(root, '.codegraph', 'config.json'),
    `${JSON.stringify({ version: 1, include: ['**/*.ts'], exclude: ['**/node_modules/**'] }, null, 2)}\n`,
    'utf8'
  );

  return root;
}

async function runRepair(
  project: string,
  mode: 'repair-exclude' | 'repair-index' = 'repair-exclude'
): Promise<CapturedIo> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  registerCodegraphCommands(program, io);
  await program.parseAsync(['codegraph', mode, '--project', project], { from: 'user' });
  return captured;
}

/**
 * The exclude gate's own verdict, from a real `status` run — the same oracle the
 * repair's closing note is a promise about. `undefined` means the gate could not
 * be evaluated at all, which is NOT "no gap" and must not be read as one.
 */
async function statusGap(project: string): Promise<boolean | undefined> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  registerCodegraphCommands(program, io);
  await program.parseAsync(['codegraph', 'status', '--project', project, '--peaks-json'], {
    from: 'user'
  });
  const envelope = JSON.parse(captured.stdout.join('\n')) as {
    data: { integrity?: { gap: boolean } | null };
  };
  return envelope.data.integrity?.gap;
}

beforeEach(() => {
  __m.executeCodegraphInvocation.mockReset();
  __m.executeCodegraphInvocation.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
  process.exitCode = 0;
});

describe('Scenario: render — the repair sentence attributes each count to its own axis', () => {
  it('when only the include axis admitted files, should name the include delta instead of a bare zero', async () => {
    // given: a project whose include axis has 2 tracked files to admit and
    //        whose exclude axis has nothing to remove
    const project = seedIncludeHeavyProject();

    // when: the repair runs (human output, no --peaks-json)
    const captured = await runRepair(project);
    const out = captured.stdout.join('\n');

    // then: the sentence names BOTH axes' numbers and the reader can tell
    //       which is which — the include clause carries the include delta …
    expect(out).toContain('Added 5 include pattern(s)');
    expect(out).toContain('newly admitting 2 tracked source file(s)');
    // … and the exclude clause carries the exclude count, described as what
    //     it is (files a rule had been hiding), so its 0 is not read as a
    //     verdict on the include work above it.
    expect(out).toContain('removed 0 exclude rule(s)');
    expect(out).toContain('recovering 0 tracked source file(s) that a rule had been hiding');
  });

  it('should not print the old single-counter wording, which could only report the exclude axis', async () => {
    // The regression guard. "include pattern(s) and removed" is the exact
    // join the old sentence used to attach ONE "recovering N" to BOTH axes;
    // that join is what made the include axis invisible, so its return is the
    // defect returning.
    const project = seedIncludeHeavyProject();

    const captured = await runRepair(project);
    const out = captured.stdout.join('\n');

    expect(out).not.toContain('include pattern(s) and removed');
    // and the include delta is not printed as the exclude axis' number either
    expect(out).not.toContain('include pattern(s), newly admitting 0 tracked source file(s)');
  });

  it('when a rule really did hide a file, should still report that file on the exclude side', async () => {
    // given: a rule that blocks a tracked file (the other axis, so the two
    //        counts cannot be swapped without this failing)
    const project = seedIncludeHeavyProject();
    mkdirSync(join(project, 'vendor'), { recursive: true });
    writeFileSync(join(project, 'vendor', 'lib.ts'), 'export const lib = 1;\n', 'utf8');
    execFileSync('git', ['-C', project, 'add', '-A'], { stdio: 'ignore', windowsHide: true });
    execFileSync('git', ['-C', project, 'commit', '-qm', 'vendor'], {
      stdio: 'ignore',
      windowsHide: true
    });
    const configPath = join(project, '.codegraph', 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as { exclude: string[] };
    config.exclude = ['**/node_modules/**', '**/vendor/**'];
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

    // when: the repair runs
    const captured = await runRepair(project);
    const out = captured.stdout.join('\n');

    // then: both axes report their OWN file count in the same sentence
    expect(out).toContain('newly admitting 2 tracked source file(s)');
    expect(out).toContain('removed 1 exclude rule(s)');
    expect(out).toContain('recovering 1 tracked source file(s)');
  });
});

// ── the "confirm the gap is closed" confirmation is EARNED ────────────

/**
 * The repair's closing note tells the operator to re-run `status` "to confirm
 * the gap is closed". That is a PROMISE about the next command's verdict, so it
 * is only honest while the repair actually closes the gap — i.e. while the
 * config the run wrote is the config that stays on disk.
 *
 * It is asserted here rather than left to prose because the note is the one
 * place the CLI states the outcome of a run the operator cannot see. A repair
 * that wrote its config and then restored it (the design this slice rejected)
 * would print this sentence and then report the gap still open — a false
 * promise generated by the code, which is the family of defect this file exists
 * to catch.
 */
describe('Scenario: render — the gap-closed confirmation is earned, not assumed', () => {
  const CLOSED_NOTE =
    'Re-run `peaks codegraph status --project <root>` to confirm the gap is closed.';

  it('when the repair wrote the config, should make the promise and leave the repaired bytes behind', async () => {
    const project = seedIncludeHeavyProject();

    const captured = await runRepair(project);
    const out = captured.stdout.join('\n');

    expect(out).toContain(CLOSED_NOTE);
    // The premise of the promise, asserted rather than assumed: the repaired
    // config is the one on disk, so re-running `status` really does find the
    // gap closed (the re-read itself is pinned in
    // `codegraph-status-integrity.test.ts`).
    const config = JSON.parse(readFileSync(join(project, '.codegraph', 'config.json'), 'utf8')) as {
      include: string[];
      exclude: string[];
    };
    expect(config.include).toContain('**/*.mjs');
    expect(config.exclude).toEqual(['**/node_modules/**']);
  });

  it('when repair-exclude wrote nothing, should NOT claim a gap was closed', async () => {
    const project = seedIncludeHeavyProject();
    await runRepair(project);

    // The second run re-derives nothing to do, so it must report that instead
    // of promising a confirmation it did not earn.
    const second = await runRepair(project);
    const out = second.stdout.join('\n');

    expect(out).toContain('Nothing to repair in the codegraph config; nothing was written.');
    expect(out).not.toContain(CLOSED_NOTE);
  });

  it('when repair-index wrote nothing, should still make the promise — and the gate agrees it is closed', async () => {
    // A REAL gap, opened on this case's own copy of the fixture: a tracked file
    // under a rule that blocks it. Without it "the gap is already closed" would
    // be a state the fixture was born in, and `false` below would say nothing.
    const project = seedIncludeHeavyProject();
    mkdirSync(join(project, 'vendor'), { recursive: true });
    writeFileSync(join(project, 'vendor', 'lib.ts'), 'export const lib = 1;\n', 'utf8');
    execFileSync('git', ['-C', project, 'add', '-A'], { stdio: 'ignore', windowsHide: true });
    execFileSync('git', ['-C', project, 'commit', '-qm', 'vendor'], {
      stdio: 'ignore',
      windowsHide: true
    });
    const configPath = join(project, '.codegraph', 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as { exclude: string[] };
    config.exclude = ['**/node_modules/**', '**/vendor/**'];
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

    // The premise, measured rather than assumed — a gate that could only ever
    // report `false` would satisfy the assertion at the end of this case.
    expect(await statusGap(project)).toBe(true);

    await runRepair(project, 'repair-index');
    const second = await runRepair(project, 'repair-index');

    expect(second.stdout.join('\n')).toContain(CLOSED_NOTE);
    // …and the note's claim is TRUE, CHECKED rather than restated. This is the
    // assertion the case name was always promising: a `repair-index` that
    // restored its own config write would print the note over a re-opened gap,
    // and it fails here and nowhere else.
    expect(await statusGap(project)).toBe(false);
  });
});
