/**
 * peaks-workflow v3.0.0 — private spec builders (wave-5 hoist).
 *
 * The six module-private top-level declarations that used to sit in
 * `workflow-spec.ts` — `VALID_EVALUATORS`, `ID_PATTERN`, `buildSpec`,
 * `buildPhase`, `buildGate`, `buildEvaluator` — moved here VERBATIM so the
 * parser file stays under the 300-line cap. None of them was ever public,
 * so no import path moves: `workflow-spec.ts` is still the only module
 * callers import, and it calls `buildSpec` after parsing the raw YAML.
 *
 * Karpathy §2 Simplicity First: pure functions, no IO, no new deps.
 */

import {
  arrayField,
  numberField,
  objectField,
  stringArrayField,
  stringField
} from './workflow-spec-yaml.js';
import type {
  EvaluatorKind,
  WorkflowBudget,
  WorkflowContextSnapshot,
  WorkflowEvaluator,
  WorkflowGate,
  WorkflowPhase,
  WorkflowSpec
} from './workflow-spec-types.js';

const VALID_EVALUATORS: ReadonlySet<EvaluatorKind> = new Set<EvaluatorKind>([
  'karpathy',
  'code-review',
  'security-review',
  'perf-baseline',
  'verdict-aggregate',
  'monotonic-improvement',
  'impact-scan',
  'smoke-run',
  'canary-watch'
]);

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

function buildSpec(root: Record<string, unknown>, expectedId: string): WorkflowSpec {
  const id = stringField(root, 'id', expectedId);
  if (id !== expectedId) {
    throw new Error(`workflow yaml: id "${id}" does not match filename "${expectedId}"`);
  }
  const schemaVersion = numberField(root, 'schemaVersion', 1);
  if (schemaVersion !== 1) {
    throw new Error(`workflow yaml: unsupported schemaVersion ${schemaVersion} (expected 1)`);
  }
  const phasesRaw = arrayField(root, 'phases');
  const gatesRaw = arrayField(root, 'gates');
  const evaluatorsRaw = arrayField(root, 'evaluators');
  const snapshotRaw = objectField(root, 'contextSnapshot');
  const budgetRaw = objectField(root, 'budget');

  const phases: WorkflowPhase[] = phasesRaw.map((p) => buildPhase(p));
  const gates: WorkflowGate[] = gatesRaw.map((g) => buildGate(g));
  const evaluators: WorkflowEvaluator[] = evaluatorsRaw.map((e) => buildEvaluator(e));
  const contextSnapshot: WorkflowContextSnapshot = {
    files: stringArrayField(snapshotRaw, 'files'),
    memory: stringArrayField(snapshotRaw, 'memory')
  };
  const budget: WorkflowBudget = {
    ...(budgetRaw['tokens'] !== undefined ? { tokens: numberField(budgetRaw, 'tokens') } : {}),
    ...(budgetRaw['wallSeconds'] !== undefined
      ? { wallSeconds: numberField(budgetRaw, 'wallSeconds') }
      : {}),
    ...(budgetRaw['cycles'] !== undefined ? { cycles: numberField(budgetRaw, 'cycles') } : {})
  };

  return {
    schemaVersion: 1,
    id,
    label: stringField(root, 'label', id),
    description: stringField(root, 'description', ''),
    phases,
    gates,
    evaluators,
    contextSnapshot,
    budget
  };
}

function buildPhase(raw: unknown): WorkflowPhase {
  const obj = objectField({ phase: raw }, 'phase');
  const id = stringField(obj, 'id');
  if (!ID_PATTERN.test(id)) {
    throw new Error(`workflow phase id "${id}" must match ${ID_PATTERN.source}`);
  }
  const role = stringField(obj, 'role');
  if (!role.startsWith('peaks-')) {
    throw new Error(`workflow phase "${id}" role "${role}" must start with "peaks-"`);
  }
  const gatesRaw = obj['gates'];
  const gates = Array.isArray(gatesRaw) ? gatesRaw.map((g) => String(g)) : [];
  const outputRaw = obj['outputContract'];
  const outputContract = Array.isArray(outputRaw) ? outputRaw.map((g) => String(g)) : [];
  const dependsOnRaw = obj['dependsOn'];
  const dependsOn = Array.isArray(dependsOnRaw) ? dependsOnRaw.map((g) => String(g)) : undefined;
  const parallelGroup = typeof obj['parallelGroup'] === 'string' ? obj['parallelGroup'] : undefined;
  return {
    id,
    role,
    promptTemplate: stringField(obj, 'promptTemplate'),
    gates,
    outputContract,
    ...(dependsOn !== undefined ? { dependsOn } : {}),
    ...(parallelGroup !== undefined ? { parallelGroup } : {})
  };
}

function buildGate(raw: unknown): WorkflowGate {
  const obj = objectField({ gate: raw }, 'gate');
  const id = stringField(obj, 'id');
  const sopId = stringField(obj, 'sopId');
  const description = typeof obj['description'] === 'string' ? obj['description'] : undefined;
  return {
    id,
    sopId,
    ...(description !== undefined ? { description } : {})
  };
}

function buildEvaluator(raw: unknown): WorkflowEvaluator {
  const obj = objectField({ evaluator: raw }, 'evaluator');
  const typeRaw = stringField(obj, 'type');
  if (!VALID_EVALUATORS.has(typeRaw as EvaluatorKind)) {
    throw new Error(
      `workflow evaluator type "${typeRaw}" is not a native evaluator (allowed: ${[...VALID_EVALUATORS].join(', ')})`
    );
  }
  const type = typeRaw as EvaluatorKind;
  const gate = typeof obj['gate'] === 'string' ? obj['gate'] : undefined;
  const scope = typeof obj['scope'] === 'string' ? obj['scope'] : undefined;
  const threshold = typeof obj['threshold'] === 'string' ? obj['threshold'] : undefined;
  return {
    type,
    ...(gate !== undefined ? { gate } : {}),
    ...(scope !== undefined ? { scope } : {}),
    ...(threshold !== undefined ? { threshold } : {})
  };
}

export { buildSpec };
