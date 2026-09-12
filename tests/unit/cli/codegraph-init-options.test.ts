// tests/unit/cli/codegraph-init-options.test.ts
//
// Guards that `peaks codegraph init` advertises NO options of its own
// (slice S1 of rid-2026-09-12-defect-remediation).
//
// The defect: the command registered `.option('--yes', 'answer yes to
// upstream prompts')` and `codegraph-service.ts` whitelisted `yes` for
// `init`, so the flag was forwarded verbatim to
// `@colbymchenry/codegraph@0.7.10`. That binary's `init` takes no flags
// and rejects the unknown one, so `peaks codegraph init --yes` died with
// CODEGRAPH_COMMAND_FAILED — reproducibly, on an otherwise untouched
// 4.0.43. The help text was advertising a flag whose stated purpose
// ("answer yes to upstream prompts") never existed: upstream init does
// not prompt.
//
// Three places must agree, and all three are pinned here:
//   1. the commander surface (no `--yes` in the option list),
//   2. the invocation whitelist (passing `yes` is refused, not ignored),
//   3. the args actually handed to the spawn (no `--yes` in argv).
//
// What is mocked and why: only the upstream binary spawn
// (`executeCodegraphInvocation`). The init guard, the marker write, the
// exclude reconcile and the exit code all run for real against a real
// temp git work tree.
//
// Dimensions covered:
//   - render:      the registered option list the help text is built from
//   - behavior:    the whitelist's refusal, and the argv the action builds
//   - integration: real git + real fs + the registered commander command
//   - a11y:        omitted — no user-facing copy or exit code is under test

import { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import { cleanupTmpWorkspace, useTmpWorkspace, type TmpWorkspace } from '../_setup/tmp-workspace.js';

declareDimensions(
  'tests/unit/cli/codegraph-init-options.test.ts',
  ['render', 'behavior', 'integration'],
  [{ dim: 'a11y', reason: 'no user-facing copy or exit code is under test' }],
);

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
import { createCodegraphInvocation } from '../../../src/services/codegraph/codegraph-service.js';

function initCommand(): Command {
  const { io } = makeCapturedIo();
  const program = new Command();
  registerCodegraphCommands(program, io);
  const codegraph = program.commands.find((command) => command.name() === 'codegraph');
  const init = codegraph?.commands.find((command) => command.name() === 'init');
  if (!init) throw new Error('peaks codegraph init is not registered');
  return init;
}

/** A real temp git work tree with no `.codegraph/` — the "fresh" guard path. */
function seedGitProject(ws: TmpWorkspace): string {
  execFileSync('git', ['-C', ws.path, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', ws.path, 'config', 'user.email', 'peaks-test@example.com'], { stdio: 'ignore' });
  execFileSync('git', ['-C', ws.path, 'config', 'user.name', 'peaks test'], { stdio: 'ignore' });
  mkdirSync(join(ws.path, 'src'), { recursive: true });
  writeFileSync(join(ws.path, 'src', 'ok.ts'), 'export const ok = 1;\n', 'utf8');
  execFileSync('git', ['-C', ws.path, 'add', '-A'], { stdio: 'ignore' });
  execFileSync('git', ['-C', ws.path, 'commit', '-qm', 'fixture'], { stdio: 'ignore' });
  return ws.path;
}

let ws: TmpWorkspace;
let savedExitCode: string | number | null | undefined;

beforeEach(() => {
  ws = useTmpWorkspace('peaks-cg-init-opts-');
  savedExitCode = process.exitCode;
  process.exitCode = 0;
  __m.executeCodegraphInvocation.mockReset();
  __m.executeCodegraphInvocation.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
});

afterEach(() => {
  process.exitCode = savedExitCode;
  cleanupTmpWorkspace();
});

describe('peaks codegraph init — the --yes flag is gone from every layer', () => {
  it('should not register a --yes option (the help text is built from this list)', () => {
    const longs = initCommand().options.map((option) => option.long);

    expect(longs).not.toContain('--yes');
    // The only flags init may carry are the shared `--project` / `--peaks-json`.
    expect(longs).toEqual(['--project', '--peaks-json']);
  });

  it('should refuse a `yes` invocation option instead of silently ignoring it', () => {
    // Before the fix `init: ['yes']` whitelisted this, and the flag was
    // forwarded to upstream, which rejects it.
    expect(() =>
      createCodegraphInvocation({
        subcommand: 'init',
        project: process.cwd(),
        yes: true,
      } as unknown as Parameters<typeof createCodegraphInvocation>[0])
    ).toThrow(/Unsupported option yes/);
  });

  it('should spawn upstream init with no --yes in argv', async () => {
    const project = seedGitProject(ws);
    const { io } = makeCapturedIo();
    const program = new Command();
    registerCodegraphCommands(program, io);

    await program.parseAsync(['codegraph', 'init', '--project', project, '--peaks-json'], { from: 'user' });

    expect(__m.executeCodegraphInvocation).toHaveBeenCalledTimes(1);
    const invocation = __m.executeCodegraphInvocation.mock.calls[0]?.[0] as { args: string[]; subcommand: string };

    expect(invocation.subcommand).toBe('init');
    expect(invocation.args).not.toContain('--yes');
    // args[0] is the resolved upstream binary; nothing but the bare
    // subcommand follows it.
    expect(invocation.args.slice(1)).toEqual(['init']);
  });
});
