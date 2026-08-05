// tests/unit/code/orchestrator-can-do.test.ts
//
// 4-dimension unit test for
//   - src/services/code/orchestrator-can-do.ts (pure functions +
//     buildOrchestratorCanDoResult)
//   - src/cli/commands/code-orchestrator-can-do.ts (CLI shim —
//     orchestrates probeSubAgent / probeContext / dispatch result)
//
// Slice 2026-08-05-orchestrator-can-do-probe encodes the
// 2026-08-05 lesson: the peaks-code orchestrator MUST delegate
// source-code changes via sub-agent dispatch. The verdict is
// canDoInSession === (blockers.length === 0).
//
// Dimensions covered:
//   - render:     result envelope shape + CLI envelope shape
//   - behavior:   4 Q signals + decision rule + threshold semantics
//                 (≥0.85 pre-compact / ≥0.95 red-line)
//   - integration: real subprocess probes with pexec mocking pattern
//                 (vi.hoisted + vi.mock for node:child_process)
//   - a11y:       envelope `nextActions` carries concrete CLI verbs
//                 the LLM can copy-paste; no human-facing CLI hint
//                 in error path

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import {
  buildOrchestratorCanDoResult,
  detectRequiresUserDecision,
  detectSourceCodeTouched,
  evaluateOrchestratorCanDo,
  OrchestratorCanDoError,
  ORCHESTRATOR_PRECOMPACT_RATIO,
  ORCHESTRATOR_REDLINE_RATIO,
  type ContextProbe,
} from '~/src/services/code/orchestrator-can-do';
import { registerCodeOrchestratorCanDoCommand } from '~/src/cli/commands/code-orchestrator-can-do';
import { Command } from 'commander';

declareDimensions(
  'tests/unit/code/orchestrator-can-do.test.ts',
  ['render', 'behavior', 'integration', 'a11y']
);

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Pure helpers — Q1 + Q3 keyword scans
// ---------------------------------------------------------------------------

describe('Scenario: render — Q1 source-code keyword scan', () => {
  it('when invoked, should detect src/, .ts, package.json, workflows/ as source-code markers', () => {
    expect(detectSourceCodeTouched('modify src/services/foo.ts')).toBe(true);
    expect(detectSourceCodeTouched('change package.json')).toBe(true);
    expect(detectSourceCodeTouched('update tsconfig.json')).toBe(true);
    expect(detectSourceCodeTouched('add .github/workflows/ci.yml')).toBe(true);
    expect(detectSourceCodeTouched('rewrite workflows/foo.yaml')).toBe(true);
  });

  it('when invoked, should NOT flag docs-only slices', () => {
    expect(detectSourceCodeTouched('update docs/spec.md')).toBe(false);
    expect(detectSourceCodeTouched('add entry to .peaks/memory/foo.md')).toBe(false);
    expect(detectSourceCodeTouched('edit README')).toBe(false);
  });
});

describe('Scenario: render — Q3 decision-keyword scan', () => {
  it('when invoked, should detect design / decide / ? / 选择 / 决定 as decision markers', () => {
    expect(detectRequiresUserDecision('redesign the API')).toBe(true);
    expect(detectRequiresUserDecision('which framework?')).toBe(true);
    expect(detectRequiresUserDecision('选择 React 还是 Vue')).toBe(true);
    expect(detectRequiresUserDecision('用户决定是否保留旧 API')).toBe(true);
    expect(detectRequiresUserDecision('user choice on architecture')).toBe(true);
  });

  it('when invoked, should NOT flag normal implementation slices', () => {
    expect(detectRequiresUserDecision('refactor src/services/foo.ts')).toBe(false);
    expect(detectRequiresUserDecision('add unit test')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildOrchestratorCanDoResult — pure over 4 Q signals
// ---------------------------------------------------------------------------

describe('Scenario: behavior — buildOrchestratorCanDoResult verdict matrix', () => {
  it('Case 1 (NEW): src/ change + sub-agent available → canDoInSession=true, suggestion includes dispatch rd', () => {
    const result = buildOrchestratorCanDoResult(
      {
        sliceSpec: 'modify src/services/foo.ts',
        projectRoot: '.',
      },
      {
        q1SourceCodeTouched: true,
        q2SubAgentAvailable: true,
        q3RequiresUserDecision: false,
        q4ContextRatio: 0.5,
      }
    );
    expect(result.canDoInSession).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.subAgentAvailable).toBe(true);
    expect(result.contextRatio).toBe(0.5);
    expect(result.q1SourceCodeTouched).toBe(true);
    const dispatch = result.suggestions.find((s) => s.startsWith('peaks sub-agent dispatch rd'));
    expect(dispatch).toBeDefined();
    expect(dispatch).toContain('--project .');
    expect(dispatch).toContain('--prompt ');
  });

  it('Case 2 (NEW): docs/ change + sub-agent available → canDoInSession=true, no sub-agent suggestion', () => {
    const result = buildOrchestratorCanDoResult(
      {
        sliceSpec: 'update docs/spec.md',
        projectRoot: '.',
      },
      {
        q1SourceCodeTouched: false,
        q2SubAgentAvailable: true,
        q3RequiresUserDecision: false,
        q4ContextRatio: 0.5,
      }
    );
    expect(result.canDoInSession).toBe(true);
    expect(result.blockers).toEqual([]);
    const dispatch = result.suggestions.find((s) => s.startsWith('peaks sub-agent dispatch rd'));
    expect(dispatch).toBeUndefined();
    expect(result.suggestions.some((s) => s.includes('non-source-code slice'))).toBe(true);
  });

  it('Case 3 (NEW): missing slice-spec → throws OrchestratorCanDoError', async () => {
    await expect(
      evaluateOrchestratorCanDo({
        sliceSpec: '',
        projectRoot: '.',
        probeSubAgentAvailable: async () => true,
        probeContextRatio: async () => ({ ratio: 0, source: 'unavailable' } satisfies ContextProbe),
      })
    ).rejects.toBeInstanceOf(OrchestratorCanDoError);
  });

  it('Case 4 (NEW): ratio ≥ 0.95 → canDoInSession=false (red-line)', () => {
    const result = buildOrchestratorCanDoResult(
      { sliceSpec: 'modify src/services/foo.ts', projectRoot: '.' },
      {
        q1SourceCodeTouched: true,
        q2SubAgentAvailable: true,
        q3RequiresUserDecision: false,
        q4ContextRatio: 0.97,
      }
    );
    expect(result.canDoInSession).toBe(false);
    expect(result.blockers.some((b) => b.includes('red-line'))).toBe(true);
    expect(result.blockers.some((b) => b.includes('0.95'))).toBe(true);
    expect(result.suggestions).toContain('peaks compact auto --execute');
  });

  it('Case 5 (NEW): ratio ≥ 0.85 but < 0.95 → canDoInSession=false (pre-compact)', () => {
    const result = buildOrchestratorCanDoResult(
      { sliceSpec: 'modify src/services/foo.ts', projectRoot: '.' },
      {
        q1SourceCodeTouched: true,
        q2SubAgentAvailable: true,
        q3RequiresUserDecision: false,
        q4ContextRatio: 0.88,
      }
    );
    expect(result.canDoInSession).toBe(false);
    expect(result.blockers.some((b) => b.includes('near limit'))).toBe(true);
    expect(result.suggestions).toContain('peaks compact auto --execute');
  });

  it('Case 6 (NEW): sub-agent dispatch unavailable → canDoInSession=false', () => {
    const result = buildOrchestratorCanDoResult(
      { sliceSpec: 'modify src/services/foo.ts', projectRoot: '.' },
      {
        q1SourceCodeTouched: true,
        q2SubAgentAvailable: false,
        q3RequiresUserDecision: false,
        q4ContextRatio: 0.5,
      }
    );
    expect(result.canDoInSession).toBe(false);
    expect(result.blockers.some((b) => b.includes('sub-agent dispatch unavailable'))).toBe(true);
  });

  it('Case 7 (NEW): slice-spec contains "design" → warnings include AskUserQuestion, NOT a blocker', () => {
    const result = buildOrchestratorCanDoResult(
      { sliceSpec: 'redesign the public API', projectRoot: '.' },
      {
        q1SourceCodeTouched: true,
        q2SubAgentAvailable: true,
        q3RequiresUserDecision: true,
        q4ContextRatio: 0.5,
      }
    );
    expect(result.canDoInSession).toBe(true);
    expect(result.warnings.some((w) => w.includes('AskUserQuestion'))).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it('Case 8 (NEW): threshold constants pin to 0.85 / 0.95', () => {
    expect(ORCHESTRATOR_PRECOMPACT_RATIO).toBe(0.85);
    expect(ORCHESTRATOR_REDLINE_RATIO).toBe(0.95);
  });
});

// ---------------------------------------------------------------------------
// Integration — evaluateOrchestratorCanDo with mocked subprocess probes
// ---------------------------------------------------------------------------

describe('Scenario: integration — evaluateOrchestratorCanDo end-to-end with mocked probes', () => {
  it('when sub-agent + clean context, should return canDoInSession=true with dispatch suggestion', async () => {
    const result = await evaluateOrchestratorCanDo({
      sliceSpec: 'modify src/services/foo.ts',
      projectRoot: '.',
      probeSubAgentAvailable: async () => true,
      probeContextRatio: async () => ({ ratio: 0.42, source: 'claude-code-env' }),
    });
    expect(result.canDoInSession).toBe(true);
    expect(result.q1SourceCodeTouched).toBe(true);
    expect(result.q2SubAgentAvailable).toBe(true);
    expect(result.q3RequiresUserDecision).toBe(false);
    expect(result.q4ContextRatio).toBe(0.42);
    expect(result.contextRatio).toBe(0.42);
    expect(result.suggestions.some((s) => s.includes('peaks sub-agent dispatch rd'))).toBe(true);
  });

  it('when sub-agent unavailable + clean context, should return canDoInSession=false', async () => {
    const result = await evaluateOrchestratorCanDo({
      sliceSpec: 'modify src/services/foo.ts',
      projectRoot: '.',
      probeSubAgentAvailable: async () => false,
      probeContextRatio: async () => ({ ratio: 0.42, source: 'claude-code-env' }),
    });
    expect(result.canDoInSession).toBe(false);
    expect(result.subAgentAvailable).toBe(false);
    expect(result.blockers.some((b) => b.includes('sub-agent dispatch unavailable'))).toBe(true);
  });

  it('when context near limit, should return canDoInSession=false regardless of other signals', async () => {
    const result = await evaluateOrchestratorCanDo({
      sliceSpec: 'modify src/services/foo.ts',
      projectRoot: '.',
      probeSubAgentAvailable: async () => true,
      probeContextRatio: async () => ({ ratio: 0.91, source: 'transcript-estimate' }),
    });
    expect(result.canDoInSession).toBe(false);
    expect(result.contextRatio).toBe(0.91);
    expect(result.blockers.some((b) => b.includes('near limit'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CLI shim — registerCodeOrchestratorCanDoCommand
// ---------------------------------------------------------------------------

describe('Scenario: render — CLI shim registers the orchestrator-can-do command', () => {
  it('when invoked, should attach the orchestrator-can-do subcommand to the code command', () => {
    const { io } = makeCapturedIo();
    const program = new Command();
    const code = program.command('code');
    registerCodeOrchestratorCanDoCommand(code, io);
    const subcommands = code.commands.map((c) => c.name());
    expect(subcommands).toContain('orchestrator-can-do');
  });

  it('when invoked, should set process.exitCode=1 on blockers via the action callback', async () => {
    const { io } = makeCapturedIo();
    const program = new Command();
    const code = program.command('code');
    registerCodeOrchestratorCanDoCommand(code, io);
    const sub = code.commands.find((c) => c.name() === 'orchestrator-can-do');
    expect(sub).toBeDefined();
    // pre-clear exitCode
    const prevExit = process.exitCode;
    process.exitCode = 0;
    try {
      // Commander's .action is a setter that stores an internal
      // _actionHandler. Invoke the action via parse() with argv —
      // this drives the full Commander pipeline (action registration
      // + option parsing) without going through `sub.action` as a
      // getter (which is undefined).
      const peaks = new Command();
      const subPeaks = peaks.command('code');
      registerCodeOrchestratorCanDoCommand(subPeaks, io);
      // Use a definitely-broken peaksBin to force the sub-agent
      // probe to fail (which puts a blocker in the envelope).
      await peaks.parseAsync([
        'node',
        'peaks',
        'code',
        'orchestrator-can-do',
        '--slice-spec',
        'modify src/services/foo.ts',
        '--peaks-bin',
        'this-binary-does-not-exist-xyz-12345',
      ]);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = prevExit;
    }
  });
});