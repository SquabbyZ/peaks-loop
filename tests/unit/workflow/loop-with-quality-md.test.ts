/**
 * peaks-workflow v3.0.0 — Slice D.3
 *
 * Schema + lint + phase-order + evaluator-declaration tests for the
 * bundled `templates/workflows/loop-with-quality-md.yaml` workflow.
 *
 * Karpathy §2: pure-data tests, single file, ≤800 lines.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  parseWorkflowYaml,
  lintWorkflowSpec,
  type EvaluatorKind
} from '../../../src/services/workflow/workflow-spec.js';
import {
  resolveWorkflow,
  planWorkflow,
  planWorkflowRun
} from '../../../src/services/workflow/workflow-loader.js';

const BUNDLED_PATH = join(process.cwd(), 'templates', 'workflows', 'loop-with-quality-md.yaml');
const BUNDLED_ID = 'loop-with-quality-md';

function loadRaw(): string {
  const fs = require('node:fs') as typeof import('node:fs');
  return fs.readFileSync(BUNDLED_PATH, 'utf8');
}

describe('loop-with-quality-md.yaml — bundled workflow', () => {
  it('parses with id matching filename', () => {
    const raw = loadRaw();
    const spec = parseWorkflowYaml(raw, BUNDLED_ID);
    expect(spec.id).toBe(BUNDLED_ID);
    expect(spec.schemaVersion).toBe(1);
    expect(spec.label).toContain('G13/G14/G15');
  });

  it('declares all 8 evaluators (4 reviewers + verdict-aggregate + monotonic + impact + smoke + canary)', () => {
    const raw = loadRaw();
    const spec = parseWorkflowYaml(raw, BUNDLED_ID);
    const types = spec.evaluators.map((e) => e.type).sort();
    expect(types).toEqual<EvaluatorKind[]>([
      'canary-watch',
      'code-review',
      'impact-scan',
      'karpathy',
      'monotonic-improvement',
      'perf-baseline',
      'security-review',
      'smoke-run',
      'verdict-aggregate'
    ]);
  });

  it('includes the 3 G13/G14/G15 quality-loop phases in declaration order', () => {
    const raw = loadRaw();
    const spec = parseWorkflowYaml(raw, BUNDLED_ID);
    const ids = spec.phases.map((p) => p.id);
    expect(ids).toContain('g13-impact');
    expect(ids).toContain('g14-smoke');
    expect(ids).toContain('g15-canary');
    // Phase order: g14 depends on g13; g15 depends on g14.
    expect(ids.indexOf('g13-impact')).toBeLessThan(ids.indexOf('g14-smoke'));
    expect(ids.indexOf('g14-smoke')).toBeLessThan(ids.indexOf('g15-canary'));
    // Quality phases appear AFTER the canonical N+1/N+2 aggregator steps.
    expect(ids.indexOf('step-n-2-mut')).toBeLessThan(ids.indexOf('g13-impact'));
  });

  it('declares dependsOn edges for the G13 → G14 → G15 chain', () => {
    const raw = loadRaw();
    const spec = parseWorkflowYaml(raw, BUNDLED_ID);
    const g13 = spec.phases.find((p) => p.id === 'g13-impact');
    const g14 = spec.phases.find((p) => p.id === 'g14-smoke');
    const g15 = spec.phases.find((p) => p.id === 'g15-canary');
    expect(g13?.dependsOn).toEqual(['step-n-2-mut']);
    expect(g14?.dependsOn).toEqual(['g13-impact']);
    expect(g15?.dependsOn).toEqual(['g14-smoke']);
  });

  it('lints cleanly (no errors)', () => {
    const raw = loadRaw();
    const spec = parseWorkflowYaml(raw, BUNDLED_ID);
    const report = lintWorkflowSpec(spec);
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
  });

  it('resolves via the project → global → bundled chain', () => {
    const resolved = resolveWorkflow(process.cwd(), BUNDLED_ID);
    expect(resolved.source.kind).toBe('bundled');
    expect(resolved.spec.id).toBe(BUNDLED_ID);
    expect(resolved.lint.ok).toBe(true);
  });

  it('planWorkflowRun emits g13 → g14 → g15 AFTER the canonical N phases', () => {
    const raw = loadRaw();
    const spec = parseWorkflowYaml(raw, BUNDLED_ID);
    const plan = planWorkflowRun(spec);
    expect(plan.order).toContain('g13-impact');
    expect(plan.order).toContain('g14-smoke');
    expect(plan.order).toContain('g15-canary');
    // All quality phases come after step-n-2-mut.
    const idxMut = plan.order.indexOf('step-n-2-mut');
    const idxG13 = plan.order.indexOf('g13-impact');
    const idxG14 = plan.order.indexOf('g14-smoke');
    const idxG15 = plan.order.indexOf('g15-canary');
    expect(idxMut).toBeLessThan(idxG13);
    expect(idxG13).toBeLessThan(idxG14);
    expect(idxG14).toBeLessThan(idxG15);
  });

  it('planWorkflow exposes g13/g14/g15 evaluators as native primitives', () => {
    const raw = loadRaw();
    const spec = parseWorkflowYaml(raw, BUNDLED_ID);
    const resolved = resolveWorkflow(process.cwd(), BUNDLED_ID);
    const graph = planWorkflow(spec, resolved.source);
    const evs = graph.evaluators.map((e) => e.type).sort();
    expect(evs).toContain('impact-scan');
    expect(evs).toContain('smoke-run');
    expect(evs).toContain('canary-watch');
    expect(evs).toContain('monotonic-improvement');
  });
});
