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

import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  refreshCodegraphAfterSlice,
  isCodegraphPresent,
} from '../../../../src/services/codegraph/codegraph-autorefresh.js';
import type { CodegraphExecutionResult, CodegraphInvocation } from '../../../../src/services/codegraph/codegraph-service.js';
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
    mkdirSync(join(project, '.codegraph'), { recursive: true });
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
    mkdirSync(join(project, '.codegraph'), { recursive: true });
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
    mkdirSync(join(project, '.codegraph'), { recursive: true });
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
    mkdirSync(join(project, '.codegraph'), { recursive: true });
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
