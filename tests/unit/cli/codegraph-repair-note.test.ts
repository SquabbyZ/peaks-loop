// tests/unit/cli/codegraph-repair-note.test.ts
//
// The repair sentence the operator actually reads, and the promise it makes.
//
// A1 of rid `2026-09-17-codegraph-msg-and-refresh` established this file to pin
// the axis attribution inside that sentence. The 1.6.2 upgrade left ONE axis
// (see `codegraph-exclude-repair.ts`), so attribution between two axes is no
// longer a thing the sentence can get wrong — those cases were deleted rather
// than rewritten, because their subject no longer exists. What remains is the
// half that never depended on the axis count: the sentence's numbers, and the
// closing "confirm the gap is closed" note being EARNED by what the run wrote.
//
// Dimensions covered:
//   - render:      the operator-visible sentence (stdout `next:` line)
//   - behavior:    the counts in that sentence, and the promise it makes
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

import { HEAVY_SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

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
function seedBlockedProject(): string {
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
  // A tracked source file a rule in the config below blocks. Without it the
  // fixture is born with nothing to repair, and every "the repair applied"
  // assertion in this file would be satisfied by a run that did nothing.
  mkdirSync(join(root, 'vendor'), { recursive: true });
  writeFileSync(join(root, 'vendor', 'lib.ts'), 'export const lib = 1;\n', 'utf8');
  execFileSync('git', ['-C', root, 'add', '-A'], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['-C', root, 'commit', '-qm', 'fixture'], {
    stdio: 'ignore',
    windowsHide: true
  });

  writeFileSync(
    join(root, 'codegraph.json'),
    `${JSON.stringify({ version: 1, include: ['**/*.ts'], exclude: ['**/vendor/**', '**/node_modules/**'] }, null, 2)}\n`,
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

describe('Scenario: render — the repair sentence reports what the repair did', () => {
  // DELETED (1.6.2 upgrade): "when only the include axis admitted files, should
  // name the include delta instead of a bare zero" and "should not print the old
  // single-counter wording, which could only report the exclude axis". Both
  // guarded a sentence that attributed numbers ACROSS two axes; with one axis
  // left there is no cross-attribution to get wrong, so neither could fail for
  // the reason it named. Deleting them and keeping the case below is the honest
  // trade: it still measures the counts the sentence prints.

  it(
    'when a rule really did hide a file, should report the rule and the file it hid',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // given: a config rule that blocks a tracked source file
      const project = seedBlockedProject();

      // when: the repair runs
      const captured = await runRepair(project);
      const out = captured.stdout.join('\n');

      // then: the sentence reports the rule count AND the file count, so a run
      //       that dropped a rule which hid nothing cannot read as this one
      expect(out).toContain('Removed 1 exclude rule(s)');
      expect(out).toContain('recovering 1 tracked source file(s)');
    }
  );
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

  it(
    'when the repair wrote the config, should make the promise and leave the repaired bytes behind',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const project = seedBlockedProject();

      const captured = await runRepair(project);
      const out = captured.stdout.join('\n');

      expect(out).toContain(CLOSED_NOTE);
      // The premise of the promise, asserted rather than assumed: the repaired
      // config is the one on disk, so re-running `status` really does find the
      // gap closed (the re-read itself is pinned in
      // `codegraph-status-integrity.test.ts`).
      const config = JSON.parse(readFileSync(join(project, 'codegraph.json'), 'utf8')) as {
        exclude: string[];
      };
      expect(config.exclude).toEqual(['**/node_modules/**']);
    }
  );

  it(
    'when repair-exclude wrote nothing, should NOT claim a gap was closed',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const project = seedBlockedProject();
      await runRepair(project);

      // The second run re-derives nothing to do, so it must report that instead
      // of promising a confirmation it did not earn.
      const second = await runRepair(project);
      const out = second.stdout.join('\n');

      expect(out).toContain('Nothing to repair in the codegraph config; nothing was written.');
      expect(out).not.toContain(CLOSED_NOTE);
    }
  );

  it(
    'when repair-index wrote nothing, should still make the promise — and the gate agrees it is closed',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // The fixture carries a REAL gap: a tracked file under a rule that blocks
      // it. It is the premise this case measures below, and without it "the gap
      // is already closed" would be a state the fixture was born in — `false`
      // would say nothing.
      const project = seedBlockedProject();

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
    }
  );
});
