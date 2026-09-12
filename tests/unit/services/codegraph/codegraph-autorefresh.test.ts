// tests/unit/services/codegraph/codegraph-autorefresh.test.ts
//
// 4-dimension unit test for the Option-1 slice-complete auto-refresh
// service `src/services/codegraph/codegraph-autorefresh.ts`
// (rid-2026-09-03-codegraph-autorefresh).
//
// The service is the CLI-internal, vendor-neutral form of "hook on
// slice-complete": `peaks job checkpoint --state done` and
// `peaks request transition --state qa-handoff` call it right before
// returning their ok envelope. It runs `codegraph index` best-effort and
// fail-silent — the caller's ok envelope must never become an error.
//
// Dimensions covered:
//   - behavior:   input → result shape: no `.codegraph/` dir → skip;
//                 invalid project root → skip; never throws on any input
//   - integration: real fs `.codegraph/` dir + injected process runner
//                 (the ONLY mocked boundary): exit 0 → refreshed; exit
//                 nonzero → index-failed; runner reject → unavailable
//   - a11y:       the human-readable `note` names the missing dir /
//                 recovery command / exit code so an LLM can act
//   - render:     OMITTED — the return shape is asserted under behavior
//                 (input → result object); the module prints nothing.
//
// Run with: pnpm vitest run tests/unit/services/codegraph/codegraph-autorefresh.test.ts

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  refreshCodegraphAfterSlice,
  isCodegraphPresent,
} from '../../../../src/services/codegraph/codegraph-autorefresh.js';
import {
  CODEGRAPH_DB_NAME,
  CODEGRAPH_MARKER_NAME,
  type CodegraphExecutionResult,
  type CodegraphInvocation,
} from '../../../../src/services/codegraph/codegraph-service.js';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/codegraph/codegraph-autorefresh.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason: 'the module returns a typed result object and prints nothing; return-shape assertions live under behavior',
    },
  ],
);

function freshProject(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function okRunner() {
  return vi.fn(async (_invocation: CodegraphInvocation): Promise<CodegraphExecutionResult> => ({ exitCode: 0, stdout: 'indexed\n', stderr: '' }));
}

function failingRunner(exitCode: number, stderr = '') {
  return vi.fn(async (_invocation: CodegraphInvocation): Promise<CodegraphExecutionResult> => ({ exitCode, stdout: '', stderr }));
}

/** Create `.codegraph/` WITH a `codegraph.db` (an initialized schema). */
function initializedCodegraph(project: string): void {
  mkdirSync(join(project, '.codegraph'), { recursive: true });
  writeFileSync(join(project, '.codegraph', CODEGRAPH_DB_NAME), 'schema\n', 'utf8');
}

/** Create `.codegraph/` carrying ONLY the peaks-loop marker (dangling). */
function danglingCodegraph(project: string): void {
  mkdirSync(join(project, '.codegraph'), { recursive: true });
  writeFileSync(join(project, '.codegraph', CODEGRAPH_MARKER_NAME), 'peaks-loop-managed\n', 'utf8');
}

describe('Scenario: behavior — refreshCodegraphAfterSlice result shape', () => {
  it('when .codegraph/ is absent, should skip with refreshed:false reason no-codegraph-dir and never call the runner', async () => {
    // given: a fresh project with no `.codegraph/` directory
    const project = freshProject('peaks-cg-auto-b1-');
    const runner = okRunner();
    try {
      // when: refreshCodegraphAfterSlice is invoked
      const result = await refreshCodegraphAfterSlice(project, runner);
      // then: the result is a skip + the runner was never called
      expect(result.refreshed).toBe(false);
      if (result.refreshed) throw new Error('unreachable');
      expect(result.reason).toBe('no-codegraph-dir');
      expect(runner).not.toHaveBeenCalled();
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('when the project root does not exist, should skip rather than throw (best-effort)', async () => {
    // given: a non-existent project path (statSync inside the service fails)
    const project = join(tmpdir(), 'does-not-exist-cg-auto-b2-');
    // when: refreshCodegraphAfterSlice is invoked
    // then: the call resolves with a skip, never rejects
    const result = await refreshCodegraphAfterSlice(project, okRunner());
    expect(result.refreshed).toBe(false);
    if (result.refreshed) throw new Error('unreachable');
    expect(result.reason).toBe('no-codegraph-dir');
  });

  it('when a file is named .codegraph, should skip (not a managed directory)', async () => {
    // given: a project where `.codegraph` is a regular file, not a dir
    const project = freshProject('peaks-cg-auto-b3-');
    const { writeFileSync } = await import('node:fs');
    try {
      writeFileSync(join(project, '.codegraph'), 'not a dir\n', 'utf8');
      // when: isCodegraphPresent is invoked
      // then: it reports false (a non-directory cannot be a codegraph store)
      expect(isCodegraphPresent(project)).toBe(false);
      const result = await refreshCodegraphAfterSlice(project, okRunner());
      expect(result.refreshed).toBe(false);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('Scenario: integration — refresh runs codegraph index against a real .codegraph dir', () => {
  it('when .codegraph/ exists and the index exits 0, should return refreshed:true and pass an index invocation rooted at the project', async () => {
    // given: a project with an existing `.codegraph/` dir and a green runner
    const project = freshProject('peaks-cg-auto-i1-');
    initializedCodegraph(project);
    const runner = okRunner();
    try {
      // when: refreshCodegraphAfterSlice is invoked
      const result = await refreshCodegraphAfterSlice(project, runner);
      // then: the result is refreshed and the runner saw a root-cwd index invocation
      expect(result.refreshed).toBe(true);
      expect(runner).toHaveBeenCalledTimes(1);
      const invocation = runner.mock.calls[0]?.[0];
      expect(invocation).toBeDefined();
      expect(invocation?.subcommand).toBe('index');
      expect(invocation?.args).toContain('index');
      expect(invocation?.cwd).toBe(realpathSync.native(project));
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('when the index exits non-zero, should return refreshed:false reason index-failed with the exit code in the note', async () => {
    // given: an existing `.codegraph/` dir and a runner that fails with exit 2
    const project = freshProject('peaks-cg-auto-i2-');
    initializedCodegraph(project);
    const runner = failingRunner(2, 'schema lock conflict');
    try {
      // when: refreshCodegraphAfterSlice is invoked
      const result = await refreshCodegraphAfterSlice(project, runner);
      // then: the result is a best-effort failure (no throw) naming exit 2
      expect(result.refreshed).toBe(false);
      if (result.refreshed) throw new Error('unreachable');
      expect(result.reason).toBe('index-failed');
      expect(result.note).toContain('exit 2');
      expect(result.note).toContain('schema lock conflict');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('when the runner rejects, should return refreshed:false reason unavailable and never throw', async () => {
    // given: an existing `.codegraph/` dir and a runner that rejects
    const project = freshProject('peaks-cg-auto-i3-');
    initializedCodegraph(project);
    const runner = vi.fn(async (_invocation: CodegraphInvocation): Promise<CodegraphExecutionResult> => {
      throw new Error('codegraph binary not found');
    });
    try {
      // when: refreshCodegraphAfterSlice is invoked
      const result = await refreshCodegraphAfterSlice(project, runner);
      // then: the failure is captured in the result, not thrown to the caller
      expect(result.refreshed).toBe(false);
      if (result.refreshed) throw new Error('unreachable');
      expect(result.reason).toBe('unavailable');
      expect(result.note).toContain('codegraph binary not found');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('Scenario: integration — dangling marker self-heal and foreign skip', () => {
  it('when .codegraph/ has the marker but no db (dangling), should self-heal via init then index', async () => {
    // given: a project whose `.codegraph/` carries the marker but no db
    const project = freshProject('peaks-cg-auto-d1-');
    danglingCodegraph(project);
    const runner = vi.fn(async (invocation: CodegraphInvocation): Promise<CodegraphExecutionResult> => {
      if (invocation.subcommand === 'init') return { exitCode: 0, stdout: 'initialized\n', stderr: '' };
      if (invocation.subcommand === 'index') return { exitCode: 0, stdout: 'indexed\n', stderr: '' };
      return { exitCode: 1, stdout: '', stderr: 'unexpected subcommand' };
    });
    try {
      // when: refreshCodegraphAfterSlice is invoked
      const result = await refreshCodegraphAfterSlice(project, runner);
      // then: the refresh self-heals (init → index) and reports refreshed
      expect(result.refreshed).toBe(true);
      const subcommands = runner.mock.calls.map((c) => (c[0] as CodegraphInvocation).subcommand);
      expect(subcommands).toEqual(['init', 'index']);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('when the self-heal init writes upstream default exclude rules that block tracked source, should repair the config', async () => {
    // Regression (repair round M4). The dangling self-heal ran upstream
    // `init` — which writes the default `exclude` template — and then
    // `index`, without ever reconciling. The marker is already present
    // on this path (that is what "dangling" means), so from then on
    // `peaks codegraph init` no-ops and the gap is permanent. The
    // autorefresh must run the same exclude repair the CLI does.
    //
    // given: a real git work tree with a tracked file under vendor/, and
    //        a dangling peaks-loop `.codegraph/`
    const project = realpathSync.native(mkdtempSync(join(tmpdir(), 'peaks-cg-auto-d1b-')));
    mkdirSync(join(project, 'src'), { recursive: true });
    mkdirSync(join(project, 'vendor'), { recursive: true });
    writeFileSync(join(project, 'src', 'ok.ts'), 'export const ok = 1;\n', 'utf8');
    writeFileSync(join(project, 'vendor', 'lib.ts'), 'export const lib = 1;\n', 'utf8');
    execFileSync('git', ['-C', project, 'init', '-q'], { stdio: 'ignore' });
    execFileSync('git', ['-C', project, 'config', 'user.email', 'peaks-test@example.com'], { stdio: 'ignore' });
    execFileSync('git', ['-C', project, 'config', 'user.name', 'peaks test'], { stdio: 'ignore' });
    execFileSync('git', ['-C', project, 'add', '-A'], { stdio: 'ignore' });
    execFileSync('git', ['-C', project, 'commit', '-qm', 'fixture'], { stdio: 'ignore' });
    danglingCodegraph(project);

    const runner = vi.fn(async (invocation: CodegraphInvocation): Promise<CodegraphExecutionResult> => {
      if (invocation.subcommand === 'init') {
        writeFileSync(
          join(project, '.codegraph', 'config.json'),
          `${JSON.stringify(
            { version: 1, include: ['**/*.ts'], exclude: ['**/vendor/**', '**/node_modules/**'] },
            null,
            2,
          )}\n`,
          'utf8',
        );
        return { exitCode: 0, stdout: 'initialized\n', stderr: '' };
      }
      if (invocation.subcommand === 'index') return { exitCode: 0, stdout: 'indexed\n', stderr: '' };
      return { exitCode: 1, stdout: '', stderr: 'unexpected subcommand' };
    });

    try {
      // when: refreshCodegraphAfterSlice is invoked
      const result = await refreshCodegraphAfterSlice(project, runner);

      // then: the refresh still succeeds …
      expect(result.refreshed).toBe(true);

      // … the offending rule is gone, with a rollback copy …
      const configPath = join(project, '.codegraph', 'config.json');
      const config = JSON.parse(readFileSync(configPath, 'utf8')) as { exclude: string[] };
      expect(config.exclude).toEqual(['**/node_modules/**']);
      expect(existsSync(`${configPath}.bak`)).toBe(true);

      // … and exactly one index ran (the repair does not add a second
      //    rebuild when the caller indexes right after).
      const subcommands = runner.mock.calls.map((c) => (c[0] as CodegraphInvocation).subcommand);
      expect(subcommands).toEqual(['init', 'index']);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('when the dangling self-heal init fails, should fail-silent with an init-naming note', async () => {
    // given: a dangling dir whose init step exits non-zero
    const project = freshProject('peaks-cg-auto-d2-');
    danglingCodegraph(project);
    const runner = vi.fn(async (invocation: CodegraphInvocation): Promise<CodegraphExecutionResult> => {
      if (invocation.subcommand === 'init') return { exitCode: 2, stdout: '', stderr: 'grammar load failed' };
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    try {
      // when: refreshCodegraphAfterSlice is invoked
      const result = await refreshCodegraphAfterSlice(project, runner);
      // then: the failure is captured (no throw) and names the init step
      expect(result.refreshed).toBe(false);
      if (result.refreshed) throw new Error('unreachable');
      expect(result.reason).toBe('index-failed');
      expect(result.note).toContain('self-heal init failed');
      expect(result.note).toContain('exit 2');
      expect(result.note).toContain('grammar load failed');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('when .codegraph/ exists without marker or db (foreign), should skip without touching it', async () => {
    // given: a foreign `.codegraph/` dir (no marker, no codegraph.db)
    const project = freshProject('peaks-cg-auto-d3-');
    mkdirSync(join(project, '.codegraph'), { recursive: true });
    writeFileSync(join(project, '.codegraph', 'lessons.db'), 'foreign\n', 'utf8');
    const runner = okRunner();
    try {
      // when: refreshCodegraphAfterSlice is invoked
      const result = await refreshCodegraphAfterSlice(project, runner);
      // then: it skips (no init/index) and never runs the runner
      expect(result.refreshed).toBe(false);
      if (result.refreshed) throw new Error('unreachable');
      expect(result.reason).toBe('no-codegraph-dir');
      expect(runner).not.toHaveBeenCalled();
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('Scenario: a11y — refresh notes are human/LLM actionable', () => {
  it('when .codegraph/ is absent, should name the missing dir and the init recovery command', async () => {
    // given: a fresh project with no codegraph store
    const project = freshProject('peaks-cg-auto-a1-');
    try {
      // when: refreshCodegraphAfterSlice is invoked
      const result = await refreshCodegraphAfterSlice(project, okRunner());
      // then: the note names `.codegraph` and the recovery command
      expect(result.refreshed).toBe(false);
      if (result.refreshed) throw new Error('unreachable');
      expect(result.note).toContain('.codegraph');
      expect(result.note).toContain('peaks codegraph init');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('when the index fails, should surface the upstream error line so the failure is not silent', async () => {
    // given: an existing `.codegraph/` dir and a runner failing with a real message
    const project = freshProject('peaks-cg-auto-a2-');
    initializedCodegraph(project);
    const runner = failingRunner(73, 'run peaks codegraph init to initialize');
    try {
      // when: refreshCodegraphAfterSlice is invoked
      const result = await refreshCodegraphAfterSlice(project, runner);
      // then: the note carries the actionable upstream hint
      expect(result.refreshed).toBe(false);
      if (result.refreshed) throw new Error('unreachable');
      expect(result.note).toContain('peaks codegraph init');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
