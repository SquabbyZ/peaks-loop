// tests/unit/cli/codegraph-config-restore-support.ts
//
// Fixtures shared by the two halves of the `peaks codegraph config-restore`
// test split (b1 filesplit campaign):
//   - tests/unit/cli/codegraph-config-restore.test.ts — render / behavior /
//     integration (the envelope, every refusal shape, the real round trip)
//   - tests/unit/cli/codegraph-config-restore-exit-codes.test.ts — a11y
//     (exit codes and the loud refusal text)
//
// Everything here is moved verbatim from the original file. The
// `executeCodegraphInvocation` mock (`vi.hoisted` + `vi.mock`) and the
// workspace/exitCode beforeEach/afterEach stay in EACH test file because
// vitest hoists mocks per file and each half asserts its own mock state.

import { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { registerCodegraphCommands } from '../../../src/cli/commands/codegraph-commands.js';
import { makeCapturedIo } from '../_setup/io.js';
import type { TmpWorkspace } from '../_setup/tmp-workspace.js';

export type CapturedIo = ReturnType<typeof makeCapturedIo>['captured'];

// The restore's own exit code (its cause is operator-actionable, so it is not
// conflated with the generic 1 that a broken command produces).
export const CONFIG_RESTORE_EXIT_CODE = 77;

export async function runCodegraph(argv: readonly string[]): Promise<CapturedIo> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  registerCodegraphCommands(program, io);
  await program.parseAsync(['codegraph', ...argv], { from: 'user' });
  return captured;
}

export function parseJson(captured: CapturedIo): {
  ok: boolean;
  code?: string;
  message?: string;
  command?: string;
  data: {
    restored?: boolean;
    from?: string | null;
    to?: string | null;
    reason?: string | null;
    applied?: boolean;
  };
  nextActions?: string[];
} {
  return JSON.parse(captured.stdout.join('\n')) as ReturnType<typeof parseJson>;
}

// Canonicalized through `realpathSync.native`, because that is what the verb's
// own `resolveProjectRoot` does: on Windows an `mkdtemp` path arrives in 8.3
// short form (`SMALLM~1`) and the CLI reports the long form, so a comparison
// against the raw fixture path would fail on the platform rather than on the
// behaviour. Idempotent for an already-canonical path.
export const configPathOf = (project: string): string =>
  join(realpathSync.native(project), '.codegraph', 'config.json');
export const backupPathOf = (project: string): string => `${configPathOf(project)}.bak`;

function git(dir: string, args: readonly string[]): void {
  execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore', windowsHide: true });
}

// A real temp git work tree with a tracked source file the `exclude` config
// blocks (so a repair has work to do and therefore leaves a `.bak`).
export function seedProject(ws: TmpWorkspace): string {
  git(ws.path, ['init', '-q']);
  git(ws.path, ['config', 'user.email', 'peaks-test@example.com']);
  git(ws.path, ['config', 'user.name', 'peaks test']);
  mkdirSync(join(ws.path, 'src'), { recursive: true });
  mkdirSync(join(ws.path, 'vendor'), { recursive: true });
  writeFileSync(join(ws.path, 'src', 'ok.ts'), 'export const ok = 1;\n', 'utf8');
  writeFileSync(join(ws.path, 'vendor', 'lib.ts'), 'export const lib = 1;\n', 'utf8');
  git(ws.path, ['add', '-A']);
  git(ws.path, ['commit', '-qm', 'fixture']);

  mkdirSync(join(ws.path, '.codegraph'), { recursive: true });
  writeFileSync(
    configPathOf(ws.path),
    `${JSON.stringify(
      { version: 1, include: ['**/*.ts'], exclude: ['**/vendor/**', '**/node_modules/**'] },
      null,
      2
    )}\n`,
    'utf8'
  );

  return ws.path;
}

// The real repair verb, so the `.bak` under test is the one production writes.
export async function repairOnce(project: string): Promise<void> {
  await runCodegraph(['repair-exclude', '--project', project, '--peaks-json']);
  process.exitCode = 0;
}
