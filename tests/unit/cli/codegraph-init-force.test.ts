// tests/unit/cli/codegraph-init-force.test.ts
//
// rid-CG-006 — `peaks codegraph init --force`.
//
// `peaks codegraph init` refuses to touch a `.codegraph/` that carries no
// peaks-loop marker: it is another tool's index, and silently reinitializing
// over it destroys that tool's data. That refusal is correct and stays the
// default. What was missing was any way out: the caller who has decided the
// foreign directory should go (it is a leftover, or this repo owns the path now)
// had to delete it by hand without a documented command, and the refusal's own
// next-action told them to do exactly that manually.
//
// The owner's ruling (2026-10-05): `--force` REMOVES the foreign directory and
// proceeds — no backup, because a backup of another tool's SQLite file is a
// second copy of data nobody asked peaks to keep, and `.bak` siblings inside a
// project root are what this repo's memory-shape guards exist to prevent.
//
// Because the flag is destructive, three properties are pinned here rather than
// assumed:
//   1. only a directory OUTSIDE any link is removed — a `.codegraph` that is a
//      junction/symlink is refused, so `--force` cannot delete through a link
//      into somewhere the project root does not own (the same containment rule
//      every codegraph writer already obeys);
//   2. a directory carrying the peaks-loop marker is never removed — `--force`
//      cannot be aimed at our own index;
//   3. `--force` is peaks-side only: upstream `init` takes no flags, so the
//      argv handed to the spawn must not contain it (rid
//      2026-09-12-defect-remediation S1 pinned the same trap for `--yes`).
//
// What is mocked and why: only the upstream binary spawn. The guard, the
// removal, the marker write and the exit code all run against a real temp tree.
//
// Dimensions covered: behavior / render / integration / a11y.
//
// Run with: pnpm vitest run tests/unit/cli/codegraph-init-force.test.ts

import { Command } from 'commander';
import { lstatSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import { cleanupTmpWorkspace, useTmpWorkspace } from '../_setup/tmp-workspace.js';

declareDimensions('tests/unit/cli/codegraph-init-force.test.ts', [
  'behavior',
  'render',
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
  CODEGRAPH_MARKER_NAME,
  writeCodegraphMarker
} from '../../../src/services/codegraph/codegraph-service.js';
import { removeForeignCodegraphDir } from '../../../src/services/codegraph/codegraph-foreign-removal.js';

function project(): string {
  return useTmpWorkspace('peaks-cg-force-').path;
}

function foreignDir(root: string): string {
  const dir = join(root, '.codegraph');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'foreign.db'), 'another tool owns this\n', 'utf8');
  return dir;
}

async function runInit(argv: readonly string[]): Promise<{
  captured: ReturnType<typeof makeCapturedIo>['captured'];
  envelope: {
    ok: boolean;
    code?: string;
    message?: string;
    data: Record<string, unknown>;
    nextActions?: string[];
  };
}> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  registerCodegraphCommands(program, io);
  await program.parseAsync(['codegraph', ...argv], { from: 'user' });
  const text = `${captured.stdout.join('\n')}\n${captured.stderr.join('\n')}`;
  const start = text.indexOf('{');
  if (start < 0) throw new Error(`no JSON envelope in output: ${text}`);
  return { captured, envelope: JSON.parse(text.slice(start)) as never };
}

let savedExitCode: string | number | null | undefined;
let root = '';

beforeEach(() => {
  root = project();
  savedExitCode = process.exitCode;
  process.exitCode = 0;
  __m.executeCodegraphInvocation.mockReset();
  // Upstream `init` creates `.codegraph/` with its default config; the fake
  // has to, or the marker write that follows a successful init has no
  // directory to sit in (the sibling init tests do the same).
  __m.executeCodegraphInvocation.mockImplementation(
    async (invocation: { subcommand: string; cwd?: string }) => {
      if (invocation.subcommand === 'init') {
        const dir = join(invocation.cwd ?? root, '.codegraph');
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          join(dir, 'config.json'),
          `${JSON.stringify({ version: 1, include: ['**/*.ts'], exclude: ['**/node_modules/**'] }, null, 2)}\n`,
          'utf8'
        );
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    }
  );
});

afterEach(() => {
  process.exitCode = savedExitCode;
  cleanupTmpWorkspace();
});

describe('peaks codegraph init --force (rid-CG-006) — behavior', () => {
  it('removes a foreign .codegraph/ and proceeds with the init', async () => {
    const dir = foreignDir(root);

    const { envelope } = await runInit(['init', '--project', root, '--force', '--peaks-json']);

    expect(envelope.ok).toBe(true);
    // The foreign file is gone; the directory itself is back, because upstream
    // init recreates it and the marker lands inside the fresh one.
    expect(exists(join(dir, 'foreign.db'))).toBe(false);
    expect(exists(join(dir, CODEGRAPH_MARKER_NAME))).toBe(true);
  });

  it('keeps refusing without --force and leaves the foreign directory intact', async () => {
    const dir = foreignDir(root);

    const { envelope } = await runInit(['init', '--project', root, '--peaks-json']);

    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('CODEGRAPH_INIT_CONFLICT');
    expect(process.exitCode).toBe(73);
    expect(exists(dir)).toBe(true);
    expect(__m.executeCodegraphInvocation).not.toHaveBeenCalled();
  });

  it('never removes a directory that carries the peaks-loop marker', async () => {
    const dir = join(root, '.codegraph');
    mkdirSync(dir, { recursive: true });
    writeCodegraphMarker(dir);
    writeFileSync(join(dir, 'codegraph.db'), 'schema\n', 'utf8');

    const { envelope } = await runInit(['init', '--project', root, '--force', '--peaks-json']);

    expect(envelope.ok).toBe(true);
    expect(exists(dir)).toBe(true);
    expect(exists(join(dir, 'codegraph.db'))).toBe(true);
  });

  it('refuses at the remover itself, not only via the guard', () => {
    // The CLI only reaches the remover when the guard says the directory is
    // FOREIGN, so the arm above cannot fail if this refusal is deleted: the
    // guard would still spare a marked directory. Pinned directly because it
    // is the last thing standing between `--force` and our own index if a
    // future caller invokes the remover without the guard.
    const dir = join(root, '.codegraph');
    mkdirSync(dir, { recursive: true });
    writeCodegraphMarker(dir);
    writeFileSync(join(dir, 'codegraph.db'), 'schema\n', 'utf8');

    expect(() => removeForeignCodegraphDir(root)).toThrow(/peaks-loop marker/);
    expect(exists(join(dir, 'codegraph.db'))).toBe(true);
  });

  it('refuses to remove a .codegraph that is a link, so --force cannot delete through it', () => {
    const target = join(root, 'somewhere-else');
    const link = join(root, '.codegraph');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'keep-me.db'), 'outside the project owns this\n', 'utf8');
    symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');

    expect(() => removeForeignCodegraphDir(root)).toThrow(/link|junction|symlink/i);
    // The data behind the link survived the refusal.
    expect(exists(join(target, 'keep-me.db'))).toBe(true);
    expect(lstatSync(link).isSymbolicLink() || lstatSync(link).isDirectory()).toBe(true);
  });

  it('is peaks-side only: --force never reaches the upstream argv', async () => {
    foreignDir(root);

    await runInit(['init', '--project', root, '--force', '--peaks-json']);

    const invocation = __m.executeCodegraphInvocation.mock.calls[0]?.[0] as { args: string[] };
    expect(invocation.args.slice(1)).toEqual(['init']);
    expect(invocation.args.join(' ')).not.toContain('--force');
  });
});

describe('peaks codegraph init --force (rid-CG-006) — render', () => {
  it('reports the path it removed, as its own field', async () => {
    const dir = foreignDir(root);

    const { envelope } = await runInit(['init', '--project', root, '--force', '--peaks-json']);

    expect(envelope.data.foreignCodegraphRemoved).toBe(dir);
  });
});

describe('peaks codegraph init --force (rid-CG-006) — integration', () => {
  it('removes the whole foreign tree, nested files included', async () => {
    const dir = foreignDir(root);
    mkdirSync(join(dir, 'nested'), { recursive: true });
    writeFileSync(join(dir, 'nested', 'other-tool.json'), '{}\n', 'utf8');

    await runInit(['init', '--project', root, '--force', '--peaks-json']);

    expect(exists(join(root, '.codegraph', 'nested'))).toBe(false);
    expect(exists(join(root, '.codegraph', CODEGRAPH_MARKER_NAME))).toBe(true);
  });
});

describe('peaks codegraph init --force (rid-CG-006) — a11y', () => {
  it('says what was deleted, and that nothing was backed up', async () => {
    const dir = foreignDir(root);

    const { captured, envelope } = await runInit([
      'init',
      '--project',
      root,
      '--force',
      '--peaks-json'
    ]);

    const text = `${captured.stdout.join('\n')}\n${captured.stderr.join('\n')}`;
    // The path is compared on the parsed field: inside the JSON envelope every
    // Windows separator is escaped, so a raw `toContain(dir)` on the printed
    // bytes would be a test of JSON escaping.
    expect(String(envelope.data.foreignCodegraphRemoved)).toContain(dir);
    expect(text).toMatch(/no backup/i);
    expect(envelope.ok).toBe(true);
  });

  it('advertises --force with the consequence in its own help text', () => {
    const program = new Command();
    const { io } = makeCapturedIo();
    registerCodegraphCommands(program, io);
    const codegraph = program.commands.find((command) => command.name() === 'codegraph');
    const init = codegraph?.commands.find((command) => command.name() === 'init');
    const force = init?.options.find((option) => option.long === '--force');

    expect(force?.description).toMatch(/foreign/i);
    expect(force?.description).toMatch(/delet/i);
  });
});

// `exists` reads the path without following a link, so a refused removal of a
// junction still shows the junction standing where it was.
function exists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}
