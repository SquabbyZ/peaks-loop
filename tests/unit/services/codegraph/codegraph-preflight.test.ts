// tests/unit/services/codegraph/codegraph-preflight.test.ts
//
// 4-dimension unit test for the pre-dispatch codegraph preflight service
// `src/services/codegraph/codegraph-preflight-service.ts`
// (rid-2026-09-03-codegraph-preread, Option A).
//
// The service runs BEFORE an RD dispatch prompt is composed: it ensures the
// codegraph index exists (init + index best-effort when `.codegraph/` is
// absent; skip when already fresh) and reads a BOUNDED project-structure
// summary rendered as a `## Codegraph structure` markdown block.
//
// Dimensions covered:
//   - behavior:   pure renderer caps (bounded output): truncates directory
//                 histogram at CODEGRAPH_STRUCTURE_MAX_DIRS rows
//   - integration: real fs `.codegraph/` dir + injected process runner (the
//                 ONLY mocked boundary): init-when-absent, skip-when-fresh,
//                 fail-soft on init/index/parse errors, foreign-schema
//                 never clobbered
//   - a11y:       failure notes name the offending dir / recovery command so
//                 an LLM can act
//   - render:     OMITTED — the module prints nothing; block-shape
//                 assertions live under behavior
//
// Run with: pnpm vitest run tests/unit/services/codegraph/codegraph-preflight.test.ts

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  buildCodegraphPreflightBlock,
  renderCodegraphStructureBlock,
  CODEGRAPH_STRUCTURE_MAX_DIRS,
} from '../../../../src/services/codegraph/codegraph-preflight-service.js';
import {
  CODEGRAPH_DB_NAME,
  CODEGRAPH_MARKER_NAME,
  type CodegraphExecutionResult,
  type CodegraphInvocation,
} from '../../../../src/services/codegraph/codegraph-service.js';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/codegraph/codegraph-preflight.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason: 'the module returns typed result objects and prints nothing; return-shape assertions live under behavior',
    },
  ],
);

function freshProject(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function filesResult(paths: string[]): CodegraphExecutionResult {
  const payload = paths.map((path) => ({ path, language: 'ts', nodeCount: 1, size: 10 }));
  return { exitCode: 0, stdout: JSON.stringify(payload, null, 2), stderr: '' };
}

function scriptedRunner(script: Partial<Record<CodegraphInvocation['subcommand'], CodegraphExecutionResult>>) {
  return vi.fn(async (invocation: CodegraphInvocation): Promise<CodegraphExecutionResult> => {
    const canned = script[invocation.subcommand];
    if (canned === undefined) {
      return { exitCode: 1, stdout: '', stderr: `no canned response for ${invocation.subcommand}` };
    }
    return canned;
  });
}

/**
 * A runner whose `init` also writes the config file the real upstream
 * binary writes: a template whose `**` + `/vendor/**` entry collides
 * with a real source directory, i.e. one that silently drops tracked
 * files from the index.
 */
function upstreamInitRunner(project: string) {
  return vi.fn(async (invocation: CodegraphInvocation): Promise<CodegraphExecutionResult> => {
    if (invocation.subcommand === 'init') {
      mkdirSync(join(project, '.codegraph'), { recursive: true });
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

    if (invocation.subcommand === 'index') {
      return { exitCode: 0, stdout: 'indexed\n', stderr: '' };
    }

    return filesResult(['src/ok.ts', 'vendor/lib.ts']);
  });
}

/** A real temp git work tree with one tracked file under `vendor/`. */
function gitProjectWithTrackedVendorFile(prefix: string): string {
  const project = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(project, 'src'), { recursive: true });
  mkdirSync(join(project, 'vendor'), { recursive: true });
  writeFileSync(join(project, 'src', 'ok.ts'), 'export const ok = 1;\n', 'utf8');
  writeFileSync(join(project, 'vendor', 'lib.ts'), 'export const lib = 1;\n', 'utf8');
  execFileSync('git', ['-C', project, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', project, 'config', 'user.email', 'peaks-test@example.com'], { stdio: 'ignore' });
  execFileSync('git', ['-C', project, 'config', 'user.name', 'peaks test'], { stdio: 'ignore' });
  execFileSync('git', ['-C', project, 'add', '-A'], { stdio: 'ignore' });
  execFileSync('git', ['-C', project, 'commit', '-qm', 'fixture'], { stdio: 'ignore' });
  return project;
}

describe('Scenario: behavior — renderCodegraphStructureBlock bounded output', () => {
  it('when directories exceed the cap, should truncate to CODEGRAPH_STRUCTURE_MAX_DIRS rows with a "more directories" marker', () => {
    // given: far more distinct directories than the documented cap
    const entries = Array.from({ length: CODEGRAPH_STRUCTURE_MAX_DIRS + 8 }, (_, i) => ({
      path: `dir${String(i).padStart(2, '0')}/file${i}.ts`,
    }));
    // when: the pure renderer is invoked with default caps
    const summary = renderCodegraphStructureBlock(entries);
    // then: output is truncated, bounded to the cap rows, and flags the remainder
    expect(summary.truncated).toBe(true);
    const rowCount = summary.block.split('\n').filter((line) => line.startsWith('- `')).length;
    expect(rowCount).toBe(CODEGRAPH_STRUCTURE_MAX_DIRS);
    expect(summary.block).toContain('more director');
  });

  it('when files are within the caps, should render every directory row without truncation', () => {
    // given: a small file set that fits under the caps
    const entries = [
      { path: './src/services/a.ts' },
      { path: './src/services/b.ts' },
      { path: 'package.json' },
    ];
    // when: the pure renderer is invoked
    const summary = renderCodegraphStructureBlock(entries);
    // then: no truncation, both dirs + the root file are listed
    expect(summary.truncated).toBe(false);
    expect(summary.total).toBe(3);
    expect(summary.block).toContain('`src/services/` — 2 files');
    expect(summary.block).toContain('(root)');
    expect(summary.block).toContain('`package.json`');
  });
});

describe('Scenario: integration — buildCodegraphPreflightBlock against a real fs .codegraph dir', () => {
  it('when .codegraph/ is absent, should init + index (best-effort) then read a bounded structure block', async () => {
    // given: a fresh project with no `.codegraph/` and a runner that scripts init/index/files
    const project = freshProject('peaks-cg-pre-i1-');
    const runner = scriptedRunner({
      init: { exitCode: 0, stdout: 'initialized\n', stderr: '' },
      index: { exitCode: 0, stdout: 'indexed\n', stderr: '' },
      files: filesResult(['src/services/a.ts', 'src/services/b.ts', 'src/cli/c.ts']),
    });
    try {
      // when: the preflight is invoked
      const result = await buildCodegraphPreflightBlock(project, runner);
      // then: the block is available and the runner saw init → index → files in order
      expect(result.available).toBe(true);
      if (!result.available) throw new Error('unreachable');
      expect(result.block).toContain('## Codegraph structure');
      const subcommands = runner.mock.calls.map((c) => (c[0] as CodegraphInvocation).subcommand);
      expect(subcommands).toEqual(['init', 'index', 'files']);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('when .codegraph/ exists with a peaks-loop marker AND codegraph.db, should skip init/index (fresh) and only read files', async () => {
    // given: a project whose `.codegraph/` carries the marker + db (initialized)
    const project = freshProject('peaks-cg-pre-i2-');
    mkdirSync(join(project, '.codegraph'), { recursive: true });
    writeFileSync(join(project, '.codegraph', CODEGRAPH_MARKER_NAME), 'peaks-loop-managed\n', 'utf8');
    writeFileSync(join(project, '.codegraph', CODEGRAPH_DB_NAME), 'schema\n', 'utf8');
    const runner = scriptedRunner({
      files: filesResult(['src/services/a.ts']),
    });
    try {
      // when: the preflight is invoked
      const result = await buildCodegraphPreflightBlock(project, runner);
      // then: no redundant re-index — the runner was only asked for files
      expect(result.available).toBe(true);
      const subcommands = runner.mock.calls.map((c) => (c[0] as CodegraphInvocation).subcommand);
      expect(subcommands).toEqual(['files']);
      expect(subcommands).not.toContain('init');
      expect(subcommands).not.toContain('index');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('when .codegraph/ has the marker but no db (dangling), should self-heal via init + index then read', async () => {
    // given: a dangling peaks-loop dir (marker present, no codegraph.db)
    const project = freshProject('peaks-cg-pre-i2b-');
    mkdirSync(join(project, '.codegraph'), { recursive: true });
    writeFileSync(join(project, '.codegraph', CODEGRAPH_MARKER_NAME), 'peaks-loop-managed\n', 'utf8');
    const runner = scriptedRunner({
      init: { exitCode: 0, stdout: 'initialized\n', stderr: '' },
      index: { exitCode: 0, stdout: 'indexed\n', stderr: '' },
      files: filesResult(['src/services/a.ts']),
    });
    try {
      // when: the preflight is invoked
      const result = await buildCodegraphPreflightBlock(project, runner);
      // then: it self-heals by running init → index → files in order
      expect(result.available).toBe(true);
      if (!result.available) throw new Error('unreachable');
      const subcommands = runner.mock.calls.map((c) => (c[0] as CodegraphInvocation).subcommand);
      expect(subcommands).toEqual(['init', 'index', 'files']);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('when a fresh init writes upstream default exclude rules that block tracked source, should self-heal the config before indexing', async () => {
    // Regression (repair round M4). The preflight is the FIRST thing a
    // fresh clone runs — it init'd and stamped the peaks-loop marker over
    // an index missing every tracked file behind an offending default
    // rule, and from then on `peaks codegraph init` hit
    // `noop-already-peaks-loop`, so the CLI's own self-heal was
    // unreachable. The preflight must run the same exclude repair.
    //
    // given: a fresh git work tree with a tracked file under vendor/
    const project = gitProjectWithTrackedVendorFile('peaks-cg-pre-i4-');
    const runner = upstreamInitRunner(project);
    try {
      // when: the preflight is invoked
      const result = await buildCodegraphPreflightBlock(project, runner);

      // then: the preflight still succeeds …
      expect(result.available).toBe(true);

      // … the offending rule is gone from the config, with a backup …
      const configPath = join(project, '.codegraph', 'config.json');
      const config = JSON.parse(readFileSync(configPath, 'utf8')) as { exclude: string[] };
      expect(config.exclude).toEqual(['**/node_modules/**']);
      expect(existsSync(`${configPath}.bak`)).toBe(true);

      // … the marker is stamped …
      expect(existsSync(join(project, '.codegraph', CODEGRAPH_MARKER_NAME))).toBe(true);

      // … and the tree is indexed exactly ONCE: the repair does not add a
      //    second (5-30 s) rebuild because the preflight's own index
      //    already covers the recovered files.
      const subcommands = runner.mock.calls.map((call) => (call[0] as CodegraphInvocation).subcommand);
      expect(subcommands).toEqual(['init', 'index', 'files']);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('when the index fails after a fresh init, should fail-soft with available:false and never throw', async () => {
    // given: a fresh project whose index command exits non-zero
    const project = freshProject('peaks-cg-pre-i3-');
    const runner = scriptedRunner({
      init: { exitCode: 0, stdout: 'initialized\n', stderr: '' },
      index: { exitCode: 2, stdout: '', stderr: 'schema lock conflict' },
    });
    try {
      // when: the preflight is invoked
      // then: the result is a best-effort failure (no throw) naming exit 2
      const result = await buildCodegraphPreflightBlock(project, runner);
      expect(result.available).toBe(false);
      if (result.available) throw new Error('unreachable');
      expect(result.note).toContain('exit 2');
      expect(result.note).toContain('schema lock conflict');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('when the runner rejects during init, should fail-soft with available:false and never throw', async () => {
    // given: a fresh project whose init command rejects (binary missing)
    const project = freshProject('peaks-cg-pre-i4-');
    const runner = vi.fn(async (_invocation: CodegraphInvocation): Promise<CodegraphExecutionResult> => {
      throw new Error('codegraph binary not found');
    });
    try {
      // when: the preflight is invoked
      // then: the failure is captured in the result, not thrown to the caller
      const result = await buildCodegraphPreflightBlock(project, runner);
      expect(result.available).toBe(false);
      if (result.available) throw new Error('unreachable');
      expect(result.note).toContain('codegraph init unavailable');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('when files returns non-JSON, should fail-soft and suggest running codegraph index', async () => {
    // given: a fresh project initialized+indexed but files returns the upstream text hint
    const project = freshProject('peaks-cg-pre-i5-');
    const runner = scriptedRunner({
      init: { exitCode: 0, stdout: 'initialized\n', stderr: '' },
      index: { exitCode: 0, stdout: 'indexed\n', stderr: '' },
      files: { exitCode: 0, stdout: 'No files indexed. Run "codegraph index" first.\n', stderr: '' },
    });
    try {
      // when: the preflight is invoked
      // then: it degrades to an unavailable note that names the recovery command
      const result = await buildCodegraphPreflightBlock(project, runner);
      expect(result.available).toBe(false);
      if (result.available) throw new Error('unreachable');
      expect(result.note).toContain('peaks codegraph index');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('Scenario: a11y — fail-soft notes are human/LLM actionable', () => {
  it('when .codegraph/ exists with a foreign (unmarked) schema, should name the dir + recovery command and never run codegraph', async () => {
    // given: a project whose `.codegraph/` is an unmarked directory (foreign tool schema)
    const project = freshProject('peaks-cg-pre-a1-');
    mkdirSync(join(project, '.codegraph'), { recursive: true });
    const runner = vi.fn(async (_invocation: CodegraphInvocation): Promise<CodegraphExecutionResult> => {
      throw new Error('should not be called');
    });
    try {
      // when: the preflight is invoked
      const result = await buildCodegraphPreflightBlock(project, runner);
      // then: it refuses to clobber the foreign schema and says how to recover
      expect(result.available).toBe(false);
      if (result.available) throw new Error('unreachable');
      expect(result.note).toContain('.codegraph');
      expect(result.note).toContain('peaks codegraph init');
      expect(runner).not.toHaveBeenCalled();
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
