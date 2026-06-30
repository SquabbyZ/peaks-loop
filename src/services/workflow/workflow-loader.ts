/**
 * peaks-workflow v3.0.0 — Slice A.2
 *
 * Loader + resolver for `.peaks/workflows/<id>.yaml` (project) or
 * `~/.peaks/workflows/<id>.yaml` (global, takes precedence when no
 * project-local match). Mirrors ADR 0007 v2 concern #3: cross-project
 * composition with project override.
 *
 * Resolved locations (first wins):
 *   1. <projectRoot>/.peaks/workflows/<id>.yaml
 *   2. <projectRoot>/.peaks/workflows/<id>.yml
 *   3. ~/.peaks/workflows/<id>.yaml
 *   4. ~/.peaks/workflows/<id>.yml
 *
 * The bundled default workflow lives at
 * `<repo>/templates/workflows/default-fullauto-md.yaml` (git-tracked) — the
 * default for v3.0.0 unless the project overrides it.
 *
 * Karpathy §2: single file, no IO beyond fs, no new deps.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  parseWorkflowYaml,
  lintWorkflowSpec,
  type WorkflowSpec,
  type WorkflowLintReport
} from './workflow-spec.js';

export type ResolvedWorkflowSource =
  | { kind: 'project'; path: string }
  | { kind: 'global'; path: string }
  | { kind: 'bundled'; path: string }
  | { kind: 'missing' };

export interface ResolvedWorkflow {
  readonly source: ResolvedWorkflowSource;
  readonly spec: WorkflowSpec;
  readonly lint: WorkflowLintReport;
}

/** Built-in default workflows shipped with peaks-cli (git-tracked). */
const BUNDLED_WORKFLOWS = new Set<string>(['default-fullauto-md', 'loop-with-quality-md']);

/** Try the project → global → bundled fallback chain and parse + lint. */
export function resolveWorkflow(projectRoot: string, id: string): ResolvedWorkflow {
  const candidates: Array<{ kind: ResolvedWorkflowSource['kind']; path: string }> = [
    { kind: 'project', path: join(projectRoot, '.peaks', 'workflows', `${id}.yaml`) },
    { kind: 'project', path: join(projectRoot, '.peaks', 'workflows', `${id}.yml`) },
    { kind: 'global', path: join(homedir(), '.peaks', 'workflows', `${id}.yaml`) },
    { kind: 'global', path: join(homedir(), '.peaks', 'workflows', `${id}.yml`) }
  ];

  for (const cand of candidates) {
    if (!existsSync(cand.path)) continue;
    const raw = readFileSync(cand.path, 'utf8');
    const spec = parseWorkflowYaml(raw, id);
    const lint = lintWorkflowSpec(spec);
    return { source: cand, spec, lint };
  }

  if (BUNDLED_WORKFLOWS.has(id)) {
    const bundledPath = bundledWorkflowPath(projectRoot, id);
    if (existsSync(bundledPath)) {
      const raw = readFileSync(bundledPath, 'utf8');
      const spec = parseWorkflowYaml(raw, id);
      const lint = lintWorkflowSpec(spec);
      return { source: { kind: 'bundled', path: bundledPath }, spec, lint };
    }
  }

  // Surface as missing — caller can choose to fail or fall back to the LLM-driven path.
  return {
    source: { kind: 'missing' },
    spec: emptySpec(id),
    lint: { ok: false, errors: [`workflow "${id}" not found in project, global, or bundled locations`], warnings: [] }
  };
}

/** Render the plan-graph for a resolved workflow (used by `peaks workflow plan`). */
export interface WorkflowPlanGraph {
  readonly id: string;
  readonly label: string;
  readonly phases: ReadonlyArray<{
    readonly id: string;
    readonly role: string;
    readonly gates: readonly string[];
    readonly parallelGroup: string | null;
    readonly dependsOn: readonly string[];
  }>;
  readonly parallelGroups: ReadonlyArray<{ readonly id: string; readonly phaseIds: readonly string[] }>;
  readonly evaluators: ReadonlyArray<{ readonly type: string; readonly gate: string | null; readonly scope: string | null }>;
  readonly budget: { readonly tokens: number | null; readonly wallSeconds: number | null; readonly cycles: number | null };
  readonly source: ResolvedWorkflowSource;
}

export function planWorkflow(spec: WorkflowSpec, source: ResolvedWorkflowSource): WorkflowPlanGraph {
  // Detect parallel groups (groups with ≥2 phases).
  const groupMap = new Map<string, string[]>();
  for (const phase of spec.phases) {
    if (phase.parallelGroup !== undefined) {
      const arr = groupMap.get(phase.parallelGroup) ?? [];
      arr.push(phase.id);
      groupMap.set(phase.parallelGroup, arr);
    }
  }
  const parallelGroups = [...groupMap.entries()]
    .filter(([, phaseIds]) => phaseIds.length >= 2)
    .map(([id, phaseIds]) => ({ id, phaseIds }));

  return {
    id: spec.id,
    label: spec.label,
    phases: spec.phases.map((p) => ({
      id: p.id,
      role: p.role,
      gates: p.gates,
      parallelGroup: p.parallelGroup ?? null,
      dependsOn: p.dependsOn ?? []
    })),
    parallelGroups,
    evaluators: spec.evaluators.map((e) => ({
      type: e.type,
      gate: e.gate ?? null,
      scope: e.scope ?? null
    })),
    budget: {
      tokens: spec.budget.tokens ?? null,
      wallSeconds: spec.budget.wallSeconds ?? null,
      cycles: spec.budget.cycles ?? null
    },
    source
  };
}

/** Internal: bundled workflow path (relative to project root). The CLI layer
 *  resolves the project root via `findProjectRoot`. */
function bundledWorkflowPath(projectRoot: string, id: string): string {
  // Repo layout: bundled default workflows ship at
  // <projectRoot>/templates/workflows/<id>.yaml (git-tracked). Project
  // overrides still live at <projectRoot>/.peaks/workflows/<id>.yaml.
  return join(projectRoot, 'templates', 'workflows', `${id}.yaml`);
}

/** Run a workflow — deterministic step ordering for the runtime. */
export interface WorkflowRunStep {
  readonly phaseId: string;
  readonly role: string;
  readonly status: 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'skipped';
  readonly dependsOn: readonly string[];
  readonly parallelGroup: string | null;
}

export interface WorkflowRunPlan {
  readonly id: string;
  readonly steps: readonly WorkflowRunStep[];
  /** Topological order, with parallel groups flattened to a single "ready" set. */
  readonly order: readonly string[];
}

export function planWorkflowRun(spec: WorkflowSpec): WorkflowRunPlan {
  const steps: WorkflowRunStep[] = spec.phases.map((p) => ({
    phaseId: p.id,
    role: p.role,
    status: p.dependsOn === undefined || p.dependsOn.length === 0 ? 'ready' : 'pending',
    dependsOn: p.dependsOn ?? [],
    parallelGroup: p.parallelGroup ?? null
  }));

  // Build dependency-respecting order. Pure data — the runtime applies
  // effects, this function only computes the sequence.
  const completed = new Set<string>();
  const order: string[] = [];
  const remaining = new Map(steps.map((s) => [s.phaseId, s]));

  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter((s) => s.dependsOn.every((d) => completed.has(d)));
    if (ready.length === 0) {
      // Cycle or missing dep — emit remaining in declaration order to
      // avoid infinite loop; lint should have caught this earlier.
      const fallback = remaining.values().next().value;
      if (fallback === undefined) break;
      order.push(fallback.phaseId);
      completed.add(fallback.phaseId);
      remaining.delete(fallback.phaseId);
      continue;
    }
    // Parallel-group siblings are emitted in a single batch in declaration order.
    const emittedIds = new Set<string>();
    for (const step of ready) {
      if (emittedIds.has(step.phaseId)) continue;
      if (step.parallelGroup !== null) {
        const siblings = ready.filter((s) => s.parallelGroup === step.parallelGroup);
        for (const sib of siblings) {
          if (emittedIds.has(sib.phaseId)) continue;
          order.push(sib.phaseId);
          emittedIds.add(sib.phaseId);
          completed.add(sib.phaseId);
          remaining.delete(sib.phaseId);
        }
      } else {
        order.push(step.phaseId);
        emittedIds.add(step.phaseId);
        completed.add(step.phaseId);
        remaining.delete(step.phaseId);
      }
    }
  }

  return { id: spec.id, steps, order };
}

function emptySpec(id: string): WorkflowSpec {
  return {
    schemaVersion: 1,
    id,
    label: id,
    description: '',
    phases: [],
    gates: [],
    evaluators: [],
    contextSnapshot: { files: [], memory: [] },
    budget: {}
  };
}