/**
 * peaks-workflow v3.0.0 — Slice A.3 + Slice B.2 — RD cycle 2 CLI smoke tests
 *
 * Cycle-2 (QA verdict return-to-rd) coverage for the new CLI surface added
 * by Slice A + B:
 *   - `peaks workflow lint <id> --session <sid> --project <p> --json`
 *   - `peaks workflow graph <id> --session <sid> --project <p> --json`
 *   - `peaks workflow run <id> --session <sid> --project <p> --json`
 *   - `peaks loop eval <rid> --evaluator <name> --project <p> --json`
 *
 * Karpathy §3: surgical — parse + dispatch only. The dispatcher's per-evaluator
 * logic is covered by tests/unit/loop/evaluator-dispatcher.test.ts; the workflow
 * resolver by tests/unit/workflow/*.test.ts. This file binds the CLI surface
 * to those services and asserts the new subcommands exist + the bundled default
 * round-trips cleanly through the lint + graph handlers.
 */
import { readFileSync, existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CommanderError } from 'commander';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  createHarness,
  parseJsonOutput,
  resetCliProgramMocks,
  runCommand,
  writeUserConfig
} from './cli-program-test-utils.js';
import { parseWorkflowYaml, lintWorkflowSpec } from '../../src/services/workflow/workflow-spec.js';

// W8-CC-α — match the existing workflow test timeout budget.
const TEST_TIMEOUT = 10000;

const PROJECT_ROOT = resolve(__dirname, '..', '..');
const BUNDLED_WORKFLOW_PATH = join(PROJECT_ROOT, 'templates', 'workflows', 'default-fullauto-md.yaml');
const SESSION_ID = '2026-06-30-session-f90141';
const RID = 'loop-eng-native-solo-a-b';

describe('createProgram workflow + loop CLI smoke (Slice A.3 + B.2)', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  test(
    'peaks workflow --help advertises the new lint|graph|run subcommands',
    async () => {
      const harness = createHarness();
      try {
        await harness.program.parseAsync(['node', 'peaks', 'workflow', '--help'], { from: 'node' });
      } catch (error: unknown) {
        if (
          !(error instanceof CommanderError) ||
          (error.code !== 'commander.help' && error.code !== 'commander.helpDisplayed')
        ) {
          throw error;
        }
      }
      const text = [...harness.stdout, ...harness.stderr].join('\n');
      expect(text).toMatch(/\bCommands:/);
      expect(text).toContain('lint');
      expect(text).toContain('graph');
      expect(text).toContain('run');
    },
    TEST_TIMEOUT
  );

  test(
    'peaks loop --help advertises the new eval subcommand',
    async () => {
      const harness = createHarness();
      try {
        await harness.program.parseAsync(['node', 'peaks', 'loop', '--help'], { from: 'node' });
      } catch (error: unknown) {
        if (
          !(error instanceof CommanderError) ||
          (error.code !== 'commander.help' && error.code !== 'commander.helpDisplayed')
        ) {
          throw error;
        }
      }
      const text = [...harness.stdout, ...harness.stderr].join('\n');
      expect(text).toMatch(/\bCommands:/);
      expect(text).toContain('eval');
    },
    TEST_TIMEOUT
  );

  test(
    'peaks workflow lint passes against the bundled default-fullauto-md workflow',
    async () => {
      const result = await runCommand([
        'workflow', 'lint',
        'default-fullauto-md',
        '--session', SESSION_ID,
        '--project', PROJECT_ROOT,
        '--json'
      ]);
      const output = parseJsonOutput(result.stdout);
      expect(output.ok).toBe(true);
      expect(output.command).toBe('workflow.lint');
      expect(output.data).toBeTruthy();
      const lint = (output.data as { lint: { ok: boolean; errors: string[]; warnings: string[] } }).lint;
      expect(lint.ok).toBe(true);
      expect(lint.errors).toEqual([]);
    },
    TEST_TIMEOUT
  );

  test(
    'peaks workflow graph renders the bundled default-fullauto-md workflow (dry-run)',
    async () => {
      const result = await runCommand([
        'workflow', 'graph',
        'default-fullauto-md',
        '--session', SESSION_ID,
        '--project', PROJECT_ROOT,
        '--json'
      ]);
      const output = parseJsonOutput(result.stdout);
      expect(output.ok).toBe(true);
      expect(output.command).toBe('workflow.graph');
      const graph = (output.data as { graph: { phases: Array<{ id: string }> } }).graph;
      expect(graph.phases.length).toBeGreaterThan(0);
      // The bundled workflow references the canonical peaks-code step ids.
      expect(graph.phases.map((p) => p.id)).toContain('step-0-init');
    },
    TEST_TIMEOUT
  );

  test(
    'peaks workflow run returns a non-empty run-plan for the bundled workflow',
    async () => {
      const result = await runCommand([
        'workflow', 'run',
        'default-fullauto-md',
        '--session', SESSION_ID,
        '--project', PROJECT_ROOT,
        '--json'
      ]);
      const output = parseJsonOutput(result.stdout);
      expect(output.ok).toBe(true);
      expect(output.command).toBe('workflow.run');
      const data = output.data as { runPlan: { order: string[] } };
      expect(data.runPlan.order.length).toBeGreaterThan(0);
    },
    TEST_TIMEOUT
  );

  test(
    'peaks workflow lint fails fast when the workflow file is missing',
    async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'peaks-loop-workflow-missing-'));
      try {
        const result = await runCommand([
          'workflow', 'lint',
          'no-such-workflow',
          '--session', SESSION_ID,
          '--project', tmp,
          '--json'
        ]);
        const output = parseJsonOutput(result.stdout);
        expect(output.ok).toBe(false);
        expect(output.command).toBe('workflow.lint');
        expect(output.code).toBe('WORKFLOW_NOT_FOUND');
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT
  );

  test(
    'peaks loop eval rejects unknown evaluators with the canonical error code',
    async () => {
      // Valid evaluators go through dispatchEvaluator which shells out to
      // the real peaks binary (covered separately by evaluator-dispatcher.test.ts).
      // The unknown-evaluator path is the one parse + validation step worth
      // binding here — it must never reach the dispatcher.
      const result = await runCommand([
        'loop', 'eval',
        RID,
        '--evaluator', 'no-such-evaluator',
        '--project', PROJECT_ROOT,
        '--json'
      ]);
      const output = parseJsonOutput(result.stdout);
      expect(output.ok).toBe(false);
      expect(output.command).toBe('loop.eval');
      expect(output.code).toBe('UNKNOWN_EVALUATOR');
      expect(result.exitCode).toBe(1);
    },
    TEST_TIMEOUT
  );
});

describe('default-fullauto-md.yaml schema validity (bundled artifact)', () => {
  test('file exists and parses as a valid WorkflowSpec', () => {
    expect(existsSync(BUNDLED_WORKFLOW_PATH)).toBe(true);
    const raw = readFileSync(BUNDLED_WORKFLOW_PATH, 'utf8');
    const parsed = parseWorkflowYaml(raw, 'default-fullauto-md');
    expect(parsed.id).toBe('default-fullauto-md');
    expect(parsed.phases.length).toBeGreaterThan(0);
    const lint = lintWorkflowSpec(parsed);
    expect(lint.ok).toBe(true);
    // Every phase must reference at least one gate + one output contract key.
    for (const phase of parsed.phases) {
      expect(phase.gates.length).toBeGreaterThan(0);
      expect(phase.outputContract.length).toBeGreaterThan(0);
    }
  });

  test('parseWorkflowYaml rejects id mismatch against filename (tamper guard)', () => {
    const raw = readFileSync(BUNDLED_WORKFLOW_PATH, 'utf8');
    // Caller passes a wrong expectedId — the loader must throw rather than
    // silently accept a tampered file (per RD S1 mitigation).
    expect(() => parseWorkflowYaml(raw, 'not-the-actual-id')).toThrow(
      /does not match filename/
    );
  });

  test('resolveWorkflow reads bundled yaml from <projectRoot>/templates/workflows/ (temp fixture)', () => {
    // Build an isolated project root with only templates/workflows/default-fullauto-md.yaml
    // inside (no .peaks/workflows/ project override, no global override). The loader must
    // still resolve the bundled default via the new templates/ path.
    const tmp = mkdtempSync(join(tmpdir(), 'peaks-loop-workflow-templates-'));
    try {
      const tplDir = join(tmp, 'templates', 'workflows');
      mkdirSync(tplDir, { recursive: true });
      // Use a minimal-but-valid default-fullauto-md stub: trim to a 2-phase
      // workflow that still lints green, so we test only the path resolution
      // (not the full content of the shipped bundled artifact).
      const stubYaml = `---
schemaVersion: 1
id: default-fullauto-md
label: Default fullauto-md workflow (peaks-code) [fixture]
description: |
  Temp-fixture bundled default for templates-move 2026-07-01 test.
phases:
  - id: step-0-init
    role: peaks-code
    promptTemplate: initialize
    gates: [Gate A1]
    outputContract: [sessionId]
  - id: step-1-rd
    role: peaks-rd
    promptTemplate: dispatch rd
    gates: [Gate B3]
    outputContract: [rdRequests]
    dependsOn: [step-0-init]
gates:
  - id: Gate A1
    sopId: peaks-session-binding
  - id: Gate B3
    sopId: peaks-code-review
evaluators:
  - type: karpathy
    gate: Gate B3
contextSnapshot:
  files: []
  memory: []
budget:
  tokens: 1000
  wallSeconds: 60
  cycles: 1
`;
      writeFileSync(join(tplDir, 'default-fullauto-md.yaml'), stubYaml, 'utf8');

      // Invoke the CLI surface; PROJECT_ROOT is irrelevant here — we override
      // --project to the temp fixture so the loader reads from tmp/templates/...
      return runCommand([
        'workflow', 'lint',
        'default-fullauto-md',
        '--session', SESSION_ID,
        '--project', tmp,
        '--json'
      ]).then((result) => {
        const output = parseJsonOutput(result.stdout);
        expect(output.ok).toBe(true);
        expect(output.command).toBe('workflow.lint');
        // The resolved source must point at the temp fixture's templates/workflows path.
        const source = (output.data as { source: { kind: string; path: string } }).source;
        expect(source.kind).toBe('bundled');
        expect(source.path).toBe(join(tmp, 'templates', 'workflows', 'default-fullauto-md.yaml'));
        const lint = (output.data as { lint: { ok: boolean; errors: string[]; warnings: string[] } }).lint;
        expect(lint.ok).toBe(true);
        expect(lint.errors).toEqual([]);
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});