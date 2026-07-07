/**
 * Workflow spec / loader unit tests (Slice A.1 + A.2).
 * Covers parseWorkflowYaml + lintWorkflowSpec + resolveWorkflow + planWorkflow + planWorkflowRun.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseWorkflowYaml,
  lintWorkflowSpec,
  type WorkflowSpec
} from '../../../src/services/workflow/workflow-spec.js';
import {
  resolveWorkflow,
  planWorkflow,
  planWorkflowRun
} from '../../../src/services/workflow/workflow-loader.js';

const MINIMAL_YAML = `
schemaVersion: 1
id: demo
label: Demo workflow
description: A minimal workflow for tests
phases:
  - id: phase-a
    role: peaks-rd
    promptTemplate: do thing a
    gates: [Gate B3]
    outputContract: [aOut]
  - id: phase-b
    role: peaks-qa
    promptTemplate: do thing b
    gates: [Gate C1]
    outputContract: [bOut]
    dependsOn: [phase-a]
gates:
  - id: Gate B3
    sopId: peaks-code-review
  - id: Gate C1
    sopId: peaks-qa-request
evaluators:
  - type: karpathy
    gate: Gate B3
contextSnapshot:
  files:
    - .peaks/PROJECT.md
  memory: []
budget:
  tokens: 5000
  wallSeconds: 60
  cycles: 2
`;

describe('parseWorkflowYaml', () => {
  it('parses a minimal valid workflow', () => {
    const spec = parseWorkflowYaml(MINIMAL_YAML, 'demo');
    expect(spec.id).toBe('demo');
    expect(spec.schemaVersion).toBe(1);
    expect(spec.label).toBe('Demo workflow');
    expect(spec.phases).toHaveLength(2);
    expect(spec.phases[0]?.id).toBe('phase-a');
    expect(spec.phases[0]?.role).toBe('peaks-rd');
    expect(spec.phases[1]?.dependsOn).toEqual(['phase-a']);
    expect(spec.gates).toHaveLength(2);
    expect(spec.evaluators).toHaveLength(1);
    expect(spec.evaluators[0]?.type).toBe('karpathy');
    expect(spec.budget.tokens).toBe(5000);
    expect(spec.budget.wallSeconds).toBe(60);
    expect(spec.budget.cycles).toBe(2);
    expect(spec.contextSnapshot.files).toEqual(['.peaks/PROJECT.md']);
  });

  it('parses the bundled default-fullauto-md workflow', () => {
    const path = join(process.cwd(), 'templates', 'workflows', 'default-fullauto-md.yaml');
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const raw = readFileSync(path, 'utf8');
    const spec = parseWorkflowYaml(raw, 'default-fullauto-md');
    expect(spec.id).toBe('default-fullauto-md');
    expect(spec.phases.length).toBeGreaterThanOrEqual(8);
    // step-1-rd must depend on step-0-55-preflight
    const step1 = spec.phases.find((p) => p.id === 'step-1-rd');
    expect(step1?.dependsOn).toEqual(['step-0-55-preflight']);
    // parallel group must contain ≥2 phases
    const rdFanout = spec.phases.filter((p) => p.parallelGroup === 'rd-fanout');
    expect(rdFanout.length).toBeGreaterThanOrEqual(1); // declaration includes the gate
  });

  it('throws when id mismatches expected filename', () => {
    expect(() => parseWorkflowYaml(MINIMAL_YAML, 'wrong-id')).toThrow(/does not match filename/);
  });

  it('throws on unknown evaluator type', () => {
    const bad = MINIMAL_YAML.replace('type: karpathy', 'type: bogus');
    expect(() => parseWorkflowYaml(bad, 'demo')).toThrow(/not a native evaluator/);
  });

  it('throws on phase role not starting with peaks-', () => {
    const bad = MINIMAL_YAML.replace('role: peaks-rd', 'role: code');
    expect(() => parseWorkflowYaml(bad, 'demo')).toThrow(/must start with "peaks-"/);
  });

  it('throws on phase id that fails kebab-case pattern', () => {
    const bad = MINIMAL_YAML.replace('id: phase-a', 'id: PhaseA');
    expect(() => parseWorkflowYaml(bad, 'demo')).toThrow(/must match/);
  });

  it('throws on unsupported schemaVersion', () => {
    const bad = MINIMAL_YAML.replace('schemaVersion: 1', 'schemaVersion: 2');
    expect(() => parseWorkflowYaml(bad, 'demo')).toThrow(/unsupported schemaVersion/);
  });
});

describe('lintWorkflowSpec', () => {
  it('passes on the minimal valid spec', () => {
    const spec = parseWorkflowYaml(MINIMAL_YAML, 'demo');
    const report = lintWorkflowSpec(spec);
    expect(report.ok).toBe(true);
    expect(report.errors).toHaveLength(0);
  });

  it('reports duplicate phase ids', () => {
    const spec: WorkflowSpec = {
      ...parseWorkflowYaml(MINIMAL_YAML, 'demo'),
      phases: [
        { id: 'dup', role: 'peaks-rd', promptTemplate: 'x', gates: [], outputContract: [] },
        { id: 'dup', role: 'peaks-qa', promptTemplate: 'y', gates: [], outputContract: [] }
      ]
    };
    const report = lintWorkflowSpec(spec);
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.includes('duplicate phase id'))).toBe(true);
  });

  it('warns when a phase references an unknown gate', () => {
    const spec = parseWorkflowYaml(
      MINIMAL_YAML.replace('gates: [Gate B3]', 'gates: [mystery-gate]'),
      'demo'
    );
    const report = lintWorkflowSpec(spec);
    expect(report.warnings.some((w) => w.includes('mystery-gate'))).toBe(true);
  });

  it('accepts built-in Gate labels', () => {
    const spec = parseWorkflowYaml(MINIMAL_YAML, 'demo');
    const report = lintWorkflowSpec(spec);
    // Phase-a references Gate B3 — built-in label, should not warn.
    expect(report.warnings.some((w) => w.includes('Gate B3'))).toBe(false);
  });

  it('rejects cycles budget below 1', () => {
    const spec = parseWorkflowYaml(MINIMAL_YAML, 'demo');
    const bad: WorkflowSpec = { ...spec, budget: { ...spec.budget, cycles: 0 } };
    const report = lintWorkflowSpec(bad);
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.includes('budget.cycles'))).toBe(true);
  });

  it('flags single-phase parallelGroup as warning', () => {
    const spec = parseWorkflowYaml(MINIMAL_YAML, 'demo');
    const bad: WorkflowSpec = {
      ...spec,
      phases: [
        { id: 'code', role: 'peaks-rd', promptTemplate: 'x', gates: [], outputContract: [], parallelGroup: 'g1' }
      ]
    };
    const report = lintWorkflowSpec(bad);
    expect(report.warnings.some((w) => w.includes('parallelGroup'))).toBe(true);
  });

  it('rejects dependsOn pointing at a missing phase', () => {
    const spec = parseWorkflowYaml(MINIMAL_YAML, 'demo');
    const bad: WorkflowSpec = {
      ...spec,
      phases: [
        { id: 'p1', role: 'peaks-rd', promptTemplate: 'x', gates: [], outputContract: [], dependsOn: ['nope'] }
      ]
    };
    const report = lintWorkflowSpec(bad);
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.includes('missing phase'))).toBe(true);
  });
});

describe('resolveWorkflow + planWorkflow + planWorkflowRun', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'peaks-workflow-'));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('resolves a project-local workflow file', () => {
    const dir = join(tmp, '.peaks', 'workflows');
    mkdirSync(dir, { recursive: true });
    // Rename `id: demo` to `id: myflow` so the filename matches.
    const yaml = MINIMAL_YAML.replace('id: demo', 'id: myflow');
    writeFileSync(join(dir, 'myflow.yaml'), yaml, 'utf8');
    const resolved = resolveWorkflow(tmp, 'myflow');
    expect(resolved.source.kind).toBe('project');
    expect(resolved.spec.id).toBe('myflow');
    expect(resolved.lint.ok).toBe(true);
  });

  it('falls back to bundled default-fullauto-md', () => {
    // Bundled path is now anchored to projectRoot: <root>/templates/workflows/<id>.yaml.
    // Point projectRoot at the real repo root so the bundled artifact is reachable.
    const repoRoot = resolve(__dirname, '..', '..', '..');
    const resolved = resolveWorkflow(repoRoot, 'default-fullauto-md');
    expect(resolved.source.kind).toBe('bundled');
    expect(resolved.spec.id).toBe('default-fullauto-md');
    expect(resolved.lint.ok).toBe(true);
  });

  it('reports missing when no resolution found', () => {
    const resolved = resolveWorkflow(tmp, 'does-not-exist');
    expect(resolved.source.kind).toBe('missing');
    expect(resolved.lint.ok).toBe(false);
  });

  it('planWorkflow surfaces parallel groups with ≥2 phases', () => {
    const spec = parseWorkflowYaml(MINIMAL_YAML, 'demo');
    const graph = planWorkflow(spec, { kind: 'project', path: '/tmp/x' });
    expect(graph.id).toBe('demo');
    expect(graph.phases).toHaveLength(2);
    // Minimal spec has no parallel groups with ≥2 phases
    expect(graph.parallelGroups).toHaveLength(0);
    expect(graph.evaluators).toHaveLength(1);
  });

  it('planWorkflowRun produces topological order honoring dependsOn', () => {
    const spec = parseWorkflowYaml(MINIMAL_YAML, 'demo');
    const plan = planWorkflowRun(spec);
    expect(plan.id).toBe('demo');
    expect(plan.order).toEqual(['phase-a', 'phase-b']);
    expect(plan.steps[0]?.status).toBe('ready');
    expect(plan.steps[1]?.status).toBe('pending');
  });

  it('planWorkflowRun on default-fullauto-md keeps step order', () => {
    const path = join(process.cwd(), 'templates', 'workflows', 'default-fullauto-md.yaml');
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const raw = readFileSync(path, 'utf8');
    const spec = parseWorkflowYaml(raw, 'default-fullauto-md');
    const plan = planWorkflowRun(spec);
    // step-0-init must precede step-0-5-collect which precedes step-0-7-scope
    const orderIdx = (id: string) => plan.order.indexOf(id);
    expect(orderIdx('step-0-init')).toBeLessThan(orderIdx('step-0-5-collect'));
    expect(orderIdx('step-0-5-collect')).toBeLessThan(orderIdx('step-0-7-scope'));
    expect(orderIdx('step-1-rd')).toBeLessThan(orderIdx('step-2-qa'));
    expect(orderIdx('step-2-qa')).toBeLessThan(orderIdx('step-n-evaluators'));
    expect(orderIdx('step-n-evaluators')).toBeLessThan(orderIdx('step-n-1-aggregate'));
  });
});