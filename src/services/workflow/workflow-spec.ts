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
 * File budget: ≤ 800 lines (Karpathy §2).
 */

/** A workflow phase = a single step the runtime executes. */
export interface WorkflowPhase {
  /** Stable id within the workflow (kebab-case). Used as the SOP gate key. */
  readonly id: string;
  /** peaks-* role that runs the phase (e.g. "peaks-rd"). */
  readonly role: string;
  /** Free-text prompt template sent to the role. */
  readonly promptTemplate: string;
  /** Phase-level gate references; runtime looks up the SOP gate by id. */
  readonly gates: readonly string[];
  /** Output contract — keys the runtime should expect in the role's verdict. */
  readonly outputContract: readonly string[];
  /** Optional ordered list of sibling phase ids that must complete first. */
  readonly dependsOn?: readonly string[];
  /** When true, runtime may run this phase in parallel with siblings at the same depth. */
  readonly parallelGroup?: string;
}

/** A gate entry is a thin pointer to a peaks-sop gate; the gate definition
 *  itself lives in peaks-sop, never in the workflow yaml. */
export interface WorkflowGate {
  /** Gate id (matches peaks-sop gate-id). */
  readonly id: string;
  /** SOP id that owns the gate definition. */
  readonly sopId: string;
  /** Optional human-readable hint shown when the gate fails. */
  readonly description?: string;
}

/** Native evaluator types — the 4 reviewer fan-out members + verdict aggregator
 *  + Slice C monotonic-improvement guard + Slice D G13/G14/G15 quality-loop
 *  primitives. Sketch-grade: the 3 quality-loop evaluators shell out to
 *  existing `peaks impact scan`, `peaks smoke run`, and
 *  `peaks release canary` CLI surfaces. The authoritative score
 *  conversion for the monotonic guard lives in
 *  `src/services/loop/monotonic-guard.ts`. */
export type EvaluatorKind =
  | 'karpathy'              // 4 Karpathy guidelines review
  | 'code-review'           // peaks-rd code-reviewer
  | 'security-review'       // peaks-security-audit
  | 'perf-baseline'         // peaks-perf-audit
  | 'verdict-aggregate'     // cross-source verdict merge
  | 'monotonic-improvement' // Slice C: per-evaluator monotonic score check
  | 'impact-scan'           // Slice D / G13: peaks impact scan
  | 'smoke-run'             // Slice D / G14: peaks smoke run
  | 'canary-watch';         // Slice D / G15: peaks release canary

/** Evaluator binding — runtime calls `peaks loop eval` directly, no LLM scheduling. */
export interface WorkflowEvaluator {
  readonly type: EvaluatorKind;
  /** Optional gate id this evaluator produces evidence for (e.g. "Gate B3"). */
  readonly gate?: string;
  /** Optional scope expression (path or glob) — kept as string for v3.0.0. */
  readonly scope?: string;
  /** Optional SLA threshold (evaluator-specific; evaluators interpret their own scale). */
  readonly threshold?: string;
}

/** Context snapshot — files + scope the role/worker should preload. */
export interface WorkflowContextSnapshot {
  /** Files the role should read before running (paths, relative to project root). */
  readonly files: readonly string[];
  /** Optional memory anchors (e.g. ".peaks/memory/parked-peaks-workflow-primitive.md"). */
  readonly memory: readonly string[];
}

/** Budget caps — runtime stops the loop when any cap is exceeded. */
export interface WorkflowBudget {
  /** Hard token cap (sum of role invocations + evaluator outputs). */
  readonly tokens?: number;
  /** Wall-clock cap in seconds. */
  readonly wallSeconds?: number;
  /** Cycle cap — maximum repair iterations before guard aborts. */
  readonly cycles?: number;
}

export interface WorkflowSpec {
  /** Schema version; always 1 for v3.0.0. */
  readonly schemaVersion: 1;
  /** Stable id (matches filename `<id>.yaml`). */
  readonly id: string;
  /** Human-readable label shown in `peaks workflow list`. */
  readonly label: string;
  /** Description; one short paragraph. */
  readonly description: string;
  /** Phases in declaration order; runtime may parallelize siblings within a group. */
  readonly phases: readonly WorkflowPhase[];
  /** Gates referenced by phases; runtime resolves them via peaks-sop. */
  readonly gates: readonly WorkflowGate[];
  /** Native evaluators the runtime should invoke. */
  readonly evaluators: readonly WorkflowEvaluator[];
  /** Context snapshot for the workflow. */
  readonly contextSnapshot: WorkflowContextSnapshot;
  /** Budget caps. */
  readonly budget: WorkflowBudget;
}

/** Result of `lintWorkflowSpec` — pure data, never throws. */
export interface WorkflowLintReport {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly normalizedSpec?: WorkflowSpec;
}

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

/** Lint a parsed spec — returns a report with semantic errors / warnings. */
export function lintWorkflowSpec(spec: WorkflowSpec): WorkflowLintReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Phase ids must be unique.
  const seen = new Set<string>();
  for (const phase of spec.phases) {
    if (seen.has(phase.id)) errors.push(`duplicate phase id "${phase.id}"`);
    seen.add(phase.id);
  }

  // Gate references in phases must exist in the gates list (or be a known
  // built-in like "Gate B3").
  const gateIds = new Set(spec.gates.map((g) => g.id));
  for (const phase of spec.phases) {
    for (const gateRef of phase.gates) {
      if (!gateIds.has(gateRef) && !gateRef.startsWith('Gate ')) {
        warnings.push(`phase "${phase.id}" references unknown gate "${gateRef}" (not in gates[] and not a built-in "Gate …" label)`);
      }
    }
  }

  // Evaluator gates must match a gate id when present.
  for (const ev of spec.evaluators) {
    if (ev.gate !== undefined && !gateIds.has(ev.gate) && !ev.gate.startsWith('Gate ')) {
      warnings.push(`evaluator "${ev.type}" references unknown gate "${ev.gate}"`);
    }
  }

  // dependsOn references must resolve.
  const phaseIds = new Set(spec.phases.map((p) => p.id));
  for (const phase of spec.phases) {
    if (phase.dependsOn !== undefined) {
      for (const dep of phase.dependsOn) {
        if (!phaseIds.has(dep)) errors.push(`phase "${phase.id}" depends on missing phase "${dep}"`);
      }
    }
  }

  // Parallel groups must contain ≥2 phases.
  const groupCounts = new Map<string, number>();
  for (const phase of spec.phases) {
    if (phase.parallelGroup !== undefined) {
      groupCounts.set(phase.parallelGroup, (groupCounts.get(phase.parallelGroup) ?? 0) + 1);
    }
  }
  for (const [group, count] of groupCounts) {
    if (count < 2) warnings.push(`parallelGroup "${group}" has only ${count} phase(s); parallelism requires ≥2`);
  }

  // Budget sanity.
  if (spec.budget.cycles !== undefined && spec.budget.cycles < 1) {
    errors.push(`budget.cycles must be ≥1 when set (got ${spec.budget.cycles})`);
  }
  if (spec.budget.tokens !== undefined && spec.budget.tokens < 1) {
    errors.push(`budget.tokens must be ≥1 when set (got ${spec.budget.tokens})`);
  }
  if (spec.budget.wallSeconds !== undefined && spec.budget.wallSeconds < 1) {
    errors.push(`budget.wallSeconds must be ≥1 when set (got ${spec.budget.wallSeconds})`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    normalizedSpec: spec
  };
}

// ─── yaml helper primitives ─────────────────────────────────────────────

function leadingSpaces(line: string): number {
  let n = 0;
  for (const ch of line) {
    if (ch === ' ') n++;
    else break;
  }
  return n;
}

function parseScalar(raw: string): unknown {
  if (raw === '') return '';
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null' || raw === '~') return null;
  // Inline array form `[a, b, c]`
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((s) => parseScalar(s.trim()));
  }
  // Strip optional surrounding quotes.
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  // Number?
  if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
  if (/^-?\d+\.\d+$/.test(raw)) return parseFloat(raw);
  return raw;
}

function stringField(obj: Record<string, unknown>, key: string, fallback?: string): string {
  const v = obj[key];
  if (typeof v === 'string') return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`workflow yaml: missing required string field "${key}"`);
}

function numberField(obj: Record<string, unknown>, key: string, fallback?: number): number {
  const v = obj[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`workflow yaml: missing required number field "${key}"`);
}

function arrayField(obj: Record<string, unknown>, key: string): unknown[] {
  const v = obj[key];
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new Error(`workflow yaml: field "${key}" must be an array`);
  return v;
}

function objectField(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = obj[key];
  if (v === undefined) return {};
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw new Error(`workflow yaml: field "${key}" must be an object`);
  }
  return v as Record<string, unknown>;
}

function stringArrayField(obj: Record<string, unknown>, key: string): readonly string[] {
  const v = obj[key];
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new Error(`workflow yaml: field "${key}" must be an array of strings`);
  return v.map((s) => String(s));
}