// tests/unit/cli/commands/_strat-tact-fixture.ts
//
// Shared fixture for the strat/tact command tests. Not a test file: it only
// builds the Commander surface and the one-axis paths both test files use.

import { Command } from 'commander';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeCapturedIo } from '../../_setup/io.js';
import type { TmpWorkspace } from '../../_setup/tmp-workspace.js';
import { registerStratTactCommands } from '~/src/cli/commands/strat-tact-commands';

export const SID = '2026-10-19-session-strat-tact';

export type Run = {
  readonly program: Command;
  readonly captured: ReturnType<typeof makeCapturedIo>['captured'];
};

export function makeProgram(): Run {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  registerStratTactCommands(program, io);
  return { program, captured };
}

export function sessionDir(ws: TmpWorkspace): string {
  return join(ws.path, '.peaks', '_runtime', SID);
}

export function stratOut(ws: TmpWorkspace): string {
  return join(sessionDir(ws), 'rd', 'strategy.md');
}

export function strategyJsonPath(ws: TmpWorkspace): string {
  return `${stratOut(ws)}.json`;
}

export function implOut(ws: TmpWorkspace): string {
  return join(sessionDir(ws), 'rd', 'impl.json');
}

export async function run(r: Run, args: string[]): Promise<void> {
  await r.program.parseAsync(args, { from: 'user' });
}

export function stratArgs(ws: TmpWorkspace, out = stratOut(ws)): string[] {
  return [
    'strat',
    'write',
    '--project',
    ws.path,
    '--session-id',
    SID,
    '--out',
    out,
    '--goal',
    'ship the producer chain',
    '--root-cause',
    'the mut prerequisite had no producer',
    '--impact',
    'src/cli/commands/strat-tact-commands.ts',
    '--design',
    'wrap the existing rd sub-stages'
  ];
}

export async function writeStrat(ws: TmpWorkspace, r: Run): Promise<Record<string, unknown>> {
  await run(r, [...stratArgs(ws), '--json']);
  return JSON.parse(readFileSync(strategyJsonPath(ws), 'utf8')) as Record<string, unknown>;
}

export function tactArgsFor(
  ws: TmpWorkspace,
  changedFiles: string[],
  extra: string[] = []
): string[] {
  return [
    'tact',
    'write',
    '--project',
    ws.path,
    '--session-id',
    SID,
    '--strategy',
    strategyJsonPath(ws),
    '--out',
    implOut(ws),
    '--changed-files',
    ...changedFiles,
    ...extra
  ];
}

export function tactArgs(ws: TmpWorkspace, extra: string[] = []): string[] {
  return tactArgsFor(ws, ['src/a.ts'], extra);
}

export async function writeChain(ws: TmpWorkspace, r: Run): Promise<void> {
  await writeStrat(ws, r);
  await run(r, [...tactArgs(ws), '--json']);
}

export function seedChangedFile(ws: TmpWorkspace): void {
  mkdirSync(join(ws.path, 'src'), { recursive: true });
  writeFileSync(join(ws.path, 'src', 'a.ts'), 'export const a = 1;\n');
}

export function jsonLine(captured: Run['captured']): Record<string, unknown> {
  return JSON.parse(captured.text().trim().split('\n').at(-1) ?? '{}') as Record<string, unknown>;
}

export function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

export function writeJson(path: string, doc: Record<string, unknown>): void {
  writeFileSync(path, JSON.stringify(doc, null, 2));
}
