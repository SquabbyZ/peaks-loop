// tests/unit/cli/codegraph-status-integrity.test.ts
//
// 4-dimension CLI test for the exclude-integrity gate wired into
// `peaks codegraph status` and the explicit repair path
// `peaks codegraph repair-exclude` (slice S2 of
// rid-2026-09-12-codegraph-exclude-integrity).
//
// The defect this guards: upstream's default `exclude` template blocks
// real source directories, so the index silently omits git-tracked
// files while `peaks codegraph status` still printed
// `[OK] Index is up to date`. The gate must make that state visible AND
// non-zero-exiting, so CI can block on it.
//
// What is mocked and why: only the upstream binary spawn
// (`executeCodegraphInvocation`). The reconcile, the config write, the
// backup, the exit code and the envelopes all run for real against a
// real temp git work tree — the CLI action is not stubbed.
//
// Dimensions covered:
//   - a11y:        the exit code (read from `process.exitCode`, not from
//                  the printed text) and the human-readable gap detail
//   - render:      the `--peaks-json` envelope shape a CI job parses
//   - behavior:    clean vs gapped status, and repair-then-clean
//   - integration: real git + real fs + the registered commander command
//
// Run with: pnpm vitest run tests/unit/cli/codegraph-status-integrity.test.ts

import { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import { cleanupTmpWorkspace, useTmpWorkspace, type TmpWorkspace } from '../_setup/tmp-workspace.js';
import { CODEGRAPH_INTEGRITY_EXIT_CODE } from '../../../src/services/codegraph/codegraph-exclude-integrity.js';

declareDimensions('tests/unit/cli/codegraph-status-integrity.test.ts', [
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

// A real temp git work tree with a tracked source file inside the
// vendor directory. `mode` picks the `.codegraph/config.json` it gets:
// one that blocks that file, one that blocks nothing, one that blocks it
// while ALSO carrying an empty rule (the pattern `picomatch` refuses to
// compile), or none at all (a project that never ran codegraph init).
//
// NOTE: glob literals contain the two-character sequence that ends a
// block comment, so every comment in this file uses `//` lines.
type ProjectMode = 'gapped' | 'clean' | 'uninitialized' | 'gapped-empty-rule';

function seedProject(ws: TmpWorkspace, mode: ProjectMode): string {
  execFileSync('git', ['-C', ws.path, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', ws.path, 'config', 'user.email', 'peaks-test@example.com'], { stdio: 'ignore' });
  execFileSync('git', ['-C', ws.path, 'config', 'user.name', 'peaks test'], { stdio: 'ignore' });

  mkdirSync(join(ws.path, 'src'), { recursive: true });
  mkdirSync(join(ws.path, 'vendor'), { recursive: true });
  writeFileSync(join(ws.path, 'src', 'ok.ts'), 'export const ok = 1;\n', 'utf8');
  writeFileSync(join(ws.path, 'vendor', 'lib.ts'), 'export const lib = 1;\n', 'utf8');
  execFileSync('git', ['-C', ws.path, 'add', '-A'], { stdio: 'ignore' });
  execFileSync('git', ['-C', ws.path, 'commit', '-qm', 'fixture'], { stdio: 'ignore' });

  if (mode === 'uninitialized') {
    return ws.path;
  }

  mkdirSync(join(ws.path, '.codegraph'), { recursive: true });
  writeFileSync(
    join(ws.path, '.codegraph', 'config.json'),
    `${JSON.stringify(
      {
        version: 1,
        include: ['**/*.ts'],
        exclude:
          mode === 'gapped'
            ? ['**/vendor/**', '**/node_modules/**']
            : mode === 'gapped-empty-rule'
              ? ['', '**/vendor/**', '**/node_modules/**']
              : ['**/node_modules/**'],
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  return ws.path;
}

function parseJson(captured: CapturedIo): {
  ok: boolean;
  code?: string;
  data: {
    integrity?: { gap: boolean; rulesToRemove: string[]; excludedTrackedCount: number } | null;
    upstream?: { exitCode: number | null };
    applied?: boolean;
    rulesRemoved?: string[];
    filesRecovered?: number;
    reindexed?: boolean;
    backupPath?: string | null;
  };
} {
  return JSON.parse(captured.stdout.join('\n')) as ReturnType<typeof parseJson>;
}

let ws: TmpWorkspace;
let savedExitCode: string | number | null | undefined;

beforeEach(() => {
  ws = useTmpWorkspace('peaks-cg-status-');
  savedExitCode = process.exitCode;
  process.exitCode = 0;
  __m.executeCodegraphInvocation.mockReset();
  __m.executeCodegraphInvocation.mockResolvedValue({
    exitCode: 0,
    stdout: 'Index is up to date\n',
    stderr: '',
  });
});

afterEach(() => {
  process.exitCode = savedExitCode;
  cleanupTmpWorkspace();
});

// ── a11y: the gate actually blocks ───────────────────────────────────

describe('peaks codegraph status (integrity gate)', () => {
  it('when a tracked source file is excluded, should print the gap and exit non-zero', async () => {
    const project = seedProject(ws, 'gapped');

    const captured = await runCodegraph(['status', '--project', project]);

    const out = captured.stdout.join('\n');
    expect(out).toContain('Index is up to date'); // upstream text still proxied
    expect(out).toContain('[FAIL] codegraph index is incomplete');
    expect(out).toContain('vendor/lib.ts');
    expect(out).toContain('**/vendor/**');
    // The exit code is the contract — read the real one, not the text.
    expect(process.exitCode).toBe(CODEGRAPH_INTEGRITY_EXIT_CODE);
    expect(CODEGRAPH_INTEGRITY_EXIT_CODE).not.toBe(0);
  });

  it('when the config carries an empty rule, should still gate the real gap with exit 74', async () => {
    // Regression from the picomatch delegation: `picomatch('')` throws,
    // the throw was caught as an integrity warning, and this returned
    // exit 0 with `[WARN] … not evaluated` printed over a real gap. A
    // junk rule must never buy the gap a clean exit code.
    const project = seedProject(ws, 'gapped-empty-rule');

    const captured = await runCodegraph(['status', '--project', project]);
    const out = captured.stdout.join('\n');

    expect(out).not.toContain('[WARN]');
    expect(out).toContain('[FAIL] codegraph index is incomplete');
    expect(out).toContain('vendor/lib.ts');
    expect(process.exitCode).toBe(CODEGRAPH_INTEGRITY_EXIT_CODE);
  });

  it('when nothing is excluded, should leave the exit code alone and stay quiet', async () => {
    const project = seedProject(ws, 'clean');

    const captured = await runCodegraph(['status', '--project', project]);

    expect(captured.stdout.join('\n')).not.toContain('[FAIL]');
    expect(process.exitCode).toBe(0);
  });

  it('when codegraph was never initialized, should stay silent instead of warning', async () => {
    const project = seedProject(ws, 'uninitialized');

    const captured = await runCodegraph(['status', '--project', project]);

    const out = captured.stdout.join('\n');
    expect(out).not.toContain('[FAIL]');
    expect(out).not.toContain('[WARN]');
    expect(process.exitCode).toBe(0);
  });

  it('should not write to the config on the read path', async () => {
    const project = seedProject(ws, 'gapped');
    const configPath = join(project, '.codegraph', 'config.json');
    const before = readFileSync(configPath, 'utf8');

    await runCodegraph(['status', '--project', project]);

    expect(readFileSync(configPath, 'utf8')).toBe(before);
    expect(existsSync(`${configPath}.bak`)).toBe(false);
  });
});

// ── render: the CI-parseable report ──────────────────────────────────

describe('peaks codegraph status --peaks-json (machine report)', () => {
  it('when gapped, should emit a failed envelope naming the rules and block on exit code', async () => {
    const project = seedProject(ws, 'gapped');

    const captured = await runCodegraph(['status', '--project', project, '--peaks-json']);

    const envelope = parseJson(captured);
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('CODEGRAPH_INDEX_INCOMPLETE');
    expect(envelope.data.integrity?.gap).toBe(true);
    expect(envelope.data.integrity?.rulesToRemove).toEqual(['**/vendor/**']);
    expect(envelope.data.integrity?.excludedTrackedCount).toBe(1);
    expect(envelope.data.upstream?.exitCode).toBe(0);
    expect(process.exitCode).toBe(CODEGRAPH_INTEGRITY_EXIT_CODE);
  });

  it('when the config carries an empty rule, should still fail the envelope on the real gap', async () => {
    const project = seedProject(ws, 'gapped-empty-rule');

    const captured = await runCodegraph(['status', '--project', project, '--peaks-json']);

    const envelope = parseJson(captured);
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('CODEGRAPH_INDEX_INCOMPLETE');
    expect(envelope.data.integrity?.gap).toBe(true);
    expect(envelope.data.integrity?.rulesToRemove).toEqual(['**/vendor/**']);
    expect(envelope.data.integrity?.excludedTrackedCount).toBe(1);
    expect(process.exitCode).toBe(CODEGRAPH_INTEGRITY_EXIT_CODE);
  });

  it('when clean, should emit an ok envelope carrying the upstream result', async () => {
    const project = seedProject(ws, 'clean');

    const captured = await runCodegraph(['status', '--project', project, '--peaks-json']);

    const envelope = parseJson(captured);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.integrity?.gap).toBe(false);
    expect(envelope.data.upstream?.exitCode).toBe(0);
    expect(process.exitCode).toBe(0);
  });
});

// ── behavior + integration: the explicit repair path ─────────────────

describe('peaks codegraph repair-exclude', () => {
  it('should drop the offending rule, back up the config, reindex, and close the gap', async () => {
    const project = seedProject(ws, 'gapped');
    const configPath = join(project, '.codegraph', 'config.json');
    const before = readFileSync(configPath, 'utf8');

    const captured = await runCodegraph(['repair-exclude', '--project', project, '--peaks-json']);

    const envelope = parseJson(captured);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.applied).toBe(true);
    expect(envelope.data.rulesRemoved).toEqual(['**/vendor/**']);
    expect(envelope.data.filesRecovered).toBe(1);
    expect(envelope.data.reindexed).toBe(true);
    expect(process.exitCode).toBe(0);

    // byte-exact rollback copy on disk
    expect(readFileSync(`${configPath}.bak`, 'utf8')).toBe(before);

    // the gap is actually closed — verified by re-reading, not by trust
    const after = await runCodegraph(['status', '--project', project, '--peaks-json']);
    expect(parseJson(after).data.integrity?.gap).toBe(false);
  });

  it('should be a no-op on a second run', async () => {
    const project = seedProject(ws, 'gapped');

    await runCodegraph(['repair-exclude', '--project', project, '--peaks-json']);
    process.exitCode = 0;
    const second = await runCodegraph(['repair-exclude', '--project', project, '--peaks-json']);

    expect(parseJson(second).data.applied).toBe(false);
    expect(process.exitCode).toBe(0);
  });

  it('when the follow-up index fails, should report the repair but exit non-zero', async () => {
    const project = seedProject(ws, 'gapped');
    __m.executeCodegraphInvocation.mockResolvedValue({ exitCode: 5, stdout: '', stderr: 'boom\n' });

    const captured = await runCodegraph(['repair-exclude', '--project', project, '--peaks-json']);

    const envelope = parseJson(captured);
    expect(envelope.data.applied).toBe(true);
    expect(envelope.data.reindexed).toBe(false);
    expect(process.exitCode).toBe(1);
  });
});
