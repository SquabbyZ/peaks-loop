/**
 * peaks-workflow v3.0.0 — Slice A.1 + Slice B.1
 *
 * Schema for `.peaks/workflows/<id>.yaml` (text + git, reviewable per ADR
 * 0007 v2 concern #1). Workflows are the WHO/HOW/WITH-WHAT layer; SOPs
 * remain the WHAT layer (gate definitions). Workflows reference SOPs
 * for their gates — never duplicate gate logic.
 *
 * The schema is intentionally narrow on v3.0.0:
 *  - phases[] (ordered or grouped for parallelism)
 *  - gates[] (sop-id references — the leaf primitive)
 *  - evaluators[] (native evaluator types the runtime can call directly
 *    without LLM scheduling)
 *  - contextSnapshot (files + scope the LLM/worker should preload)
 *  - budget (token + wall + cycle caps)
 *
 * Karpathy §2 Simplicity First: no external framework, no DSL, no new
 * IO. Pure types + a single `parseWorkflowYaml` / `lintWorkflowSpec`
 * pair. Anything more elaborate (e.g. conditionals on outputs) belongs
 * in a future minor.
 *
 * File budget: ≤ 400 lines (rid-006 split). This file now holds the
 * parser + private constants + private build helpers; types live in
 * `workflow-spec-types.ts`; YAML field helpers live in
 * `workflow-spec-yaml.ts`; lint lives in `workflow-spec-lint.ts`.
 * The re-export shim at the bottom preserves the original public
 * surface so external callers (`workflow-loader.ts`,
 * `loop-eval-commands.ts`, `evaluator-dispatcher.ts`) compile
 * unchanged.
 */

import {
  arrayField,
  leadingSpaces,
  numberField,
  objectField,
  parseScalar,
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

/** Parse a raw yaml string into a workflow spec. Pure (no IO), throws on
 *  unparseable input. Use `lintWorkflowSpec` after parsing for semantic checks. */
export function parseWorkflowYaml(raw: string, expectedId: string): WorkflowSpec {
  // Minimal hand-rolled YAML loader — we control the schema and want zero
  // new deps. The shape is flat-ish: nested objects only via indentation.
  // Indentation depth = 2 spaces (matches the default-fullauto-md.yaml we ship).
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('workflow yaml: input is empty');
  }
  const lines = raw.split(/\r?\n/);
  // First non-blank line should be `schemaVersion: 1`. Detect blank-header
  // tolerance: skip leading blanks/comments.
  const root: Record<string, unknown> = {};
  let i = 0;
  while (i < lines.length && (lines[i]?.trim() === '' || lines[i]?.trim().startsWith('#'))) i++;
  // Strip a leading `---` document marker (YAML frontmatter) if present.
  if (lines[i]?.trim() === '---') i++;

  // Read key: value pairs at column 0. Nested values use 2-space indent.
  // Path stack tracks the chain of object/array containers so we can
  // disambiguate `phases: [...]` (root array) from
  // `contextSnapshot: { files: [...] }` (nested array under an object).
  type Frame = { kind: 'object'; container: Record<string, unknown>; key: string } | { kind: 'array'; container: unknown[]; key: string };
  const stack: Frame[] = [{ kind: 'object', container: root, key: '__root__' }];

  function pushChild(parent: Frame, childKey: string, child: unknown): void {
    if (parent.kind === 'object') {
      parent.container[childKey] = child;
    }
  }

  for (; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const indent = leadingSpaces(line);
    const trimmed = line.trim();

    // Pop the stack to the correct depth.
    // indent 0 → root only; indent 2 → 1 deep; indent 4 → 2 deep; etc.
    while (stack.length > 1) {
      const top = stack[stack.length - 1]!;
      const expectedIndent = (stack.length - 1) * 2;
      if (indent <= expectedIndent - 2) {
        stack.pop();
      } else {
        break;
      }
      void top;
    }

    const top = stack[stack.length - 1]!;

    if (indent === 0 && trimmed.endsWith(':')) {
      // New top-level key — open a child container.
      const key = trimmed.slice(0, -1);
      const peek = (lines[i + 1] ?? '').trim();
      if (peek.startsWith('- ') || peek === '-') {
        const arr: unknown[] = [];
        pushChild(top, key, arr);
        stack.push({ kind: 'array', container: arr, key });
      } else {
        const obj: Record<string, unknown> = {};
        pushChild(top, key, obj);
        stack.push({ kind: 'object', container: obj, key });
      }
      continue;
    }
    if (indent === 0 && trimmed.includes(':')) {
      const key = trimmed.split(':')[0] ?? '';
      const value = trimmed.split(':').slice(1).join(':').trim();
      pushChild(top, key, parseScalar(value));
      continue;
    }
    if (top.kind === 'array' && trimmed.startsWith('- ')) {
      // Array item — peek next line for nested-key continuation.
      const itemText = trimmed.slice(2);
      // Detect: `- files:` (nested array) or `- id: foo` (inline object) or
      // `- src/foo` (scalar).
      const nextLine = (lines[i + 1] ?? '').trim();
      const nextIndent = leadingSpaces(lines[i + 1] ?? '');
      if (itemText.endsWith(':') && (nextLine.startsWith('- ') || nextLine === '-') && nextIndent > indent) {
        // Nested array under object.
        const obj: Record<string, unknown> = {};
        const childKey = itemText.slice(0, -1);
        obj['__pendingArrayKey'] = childKey;
        top.container.push(obj);
        // We push a new frame so subsequent `- ` lines belong to the inner array.
        stack.push({ kind: 'array', container: top.container as unknown as unknown[], key: childKey });
        // Replace top's last item with the placeholder object — but we
        // actually need a separate child array. Simpler: convert the
        // last pushed object into { [childKey]: [] } and push the array
        // as a new frame.
        const arr: unknown[] = [];
        const placeholder = { [childKey]: arr } as Record<string, unknown>;
        top.container.pop();
        top.container.push(placeholder);
        // Replace the top frame's container with the new array.
        stack[stack.length - 1] = { kind: 'array', container: arr, key: childKey };
      } else if (itemText.includes(':')) {
        // Inline object.
        const obj: Record<string, unknown> = {};
        const inlineParts = itemText.split(':');
        obj[inlineParts[0] ?? ''] = parseScalar((inlineParts.slice(1).join(':')).trim());
        top.container.push(obj);
        stack.push({ kind: 'object', container: obj, key: inlineParts[0] ?? '' });
      } else {
        top.container.push(parseScalar(itemText));
      }
      continue;
    }
    if (top.kind === 'array' && trimmed.includes(':') && !trimmed.startsWith('- ')) {
      // Continuation of the last array object.
      const lastItem = top.container[top.container.length - 1];
      if (lastItem !== undefined && lastItem !== null && typeof lastItem === 'object' && !Array.isArray(lastItem)) {
        const parts = trimmed.split(':');
        const key = parts[0] ?? '';
        const value = parts.slice(1).join(':').trim();
        (lastItem as Record<string, unknown>)[key] = parseScalar(value);
      }
      continue;
    }
    if (top.kind === 'object' && trimmed.includes(':')) {
      const parts = trimmed.split(':');
      const key = parts[0] ?? '';
      const value = parts.slice(1).join(':').trim();
      const peek = (lines[i + 1] ?? '').trim();
      const nextIndent = leadingSpaces(lines[i + 1] ?? '');
      if (value === '' && (peek.startsWith('- ') || peek === '-') && nextIndent > indent) {
        // Nested array under this object key.
        const arr: unknown[] = [];
        top.container[key] = arr;
        stack.push({ kind: 'array', container: arr, key });
      } else if (value === '|' || value === '>') {
        // Block scalar (literal / folded) — accumulate lines at indent > key.
        const blockLines: string[] = [];
        const blockIndent = indent + 2;
        let j = i + 1;
        while (j < lines.length) {
          const bl = lines[j] ?? '';
          if (bl.trim() === '') {
            blockLines.push('');
            j++;
            continue;
          }
          if (leadingSpaces(bl) < blockIndent && bl.trim() !== '') break;
          blockLines.push(bl.slice(blockIndent));
          j++;
        }
        const joined = value === '|' ? blockLines.join('\n') : blockLines.join(' ');
        top.container[key] = joined.replace(/\n+$/, '').trim();
        i = j - 1;
      } else {
        top.container[key] = parseScalar(value);
      }
      continue;
    }
  }

  // Build the typed spec.
  return buildSpec(root, expectedId);
}

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
    ...(budgetRaw['wallSeconds'] !== undefined ? { wallSeconds: numberField(budgetRaw, 'wallSeconds') } : {}),
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
    throw new Error(`workflow evaluator type "${typeRaw}" is not a native evaluator (allowed: ${[...VALID_EVALUATORS].join(', ')})`);
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

// ─── verbatim re-export shim (rid-006) ────────────────────────────────────
// External callers (`workflow-loader.ts`, `loop-eval-commands.ts`,
// `evaluator-dispatcher.ts`) import the public types and the lint
// function from this module. Re-export them under their original names
// so the call sites compile unchanged. The lint function moved to
// `workflow-spec-lint.ts`; the types moved to `workflow-spec-types.ts`.

export { lintWorkflowSpec } from './workflow-spec-lint.js';
export type {
  EvaluatorKind,
  WorkflowBudget,
  WorkflowContextSnapshot,
  WorkflowEvaluator,
  WorkflowGate,
  WorkflowLintReport,
  WorkflowPhase,
  WorkflowSpec
} from './workflow-spec-types.js';