// tests/unit/_setup/source-cli.ts
//
// Runs THIS repository's source CLI (`src/cli/index.ts`) under tsx and
// returns what it printed.
//
// Why a helper rather than the installed `peaks`: the globally installed
// binary is days old and answers differently, so a test that measured it
// would measure the wrong implementation — and would look green all the
// same. This harness runs the SOURCE, so a shape assertion here is about
// the code under review.
//
// The shape this exists for: a Claude Code hook reads the WHOLE of stdout as
// ONE JSON document. `printResult` in its non-`--json` mode prints the
// payload and then a `next: ...` prose line, which is exactly the shape a
// hook cannot parse. So these tests need the REAL stdout of the REAL
// command, byte for byte — not a re-implementation of it.

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

/** This repository's root. */
export const REPO_ROOT = resolve(__dirname, '..', '..', '..');

/** The source CLI entry point. */
const SOURCE_CLI = resolve(REPO_ROOT, 'src', 'cli', 'index.ts');

/** The TSX loader the source CLI is run through. */
const TSX_LOADER = resolve(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

/** What one run of the source CLI produced. */
export interface SourceCliRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Run the source CLI and return what it printed.
 *
 * `input` is what arrives on stdin — the hook payload, when the caller is
 * standing in for the host.
 */
export function runSourceCli(
  args: readonly string[],
  options: { readonly input?: string; readonly cwd?: string } = {}
): SourceCliRun {
  const run = spawnSync(process.execPath, [TSX_LOADER, SOURCE_CLI, ...args], {
    cwd: options.cwd ?? REPO_ROOT,
    encoding: 'utf8',
    windowsHide: true,
    input: options.input ?? '',
    env: { ...process.env }
  });
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}
