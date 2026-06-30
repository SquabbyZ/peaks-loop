/**
 * peaks-loop v3.0.0 — Slice E.1
 *
 * Spec-as-first-class CLI backing service. Reads / writes / lints
 * `.peaks/_runtime/<sid>/loop/<rid>/spec.yaml` — the project-level
 * (third-tier) spec origin per Slice A resolver (project → global →
 * bundled). Authors may also pass an explicit file path to `peaks loop
 * spec lint`.
 *
 * Spec schema (v1):
 *   - evaluators[].kind (native EvaluatorKind)
 *   - evaluators[].gate? (Gate id or built-in "Gate …" label)
 *   - evaluators[].scope? (string)
 *   - sla[].evaluator (must match an evaluator.kind above)
 *   - sla[].maxScore (0..1; the floor above which the evaluator is
 *     considered to have held its SLA)
 *   - termination.strategy ("max-cycles" | "monotonic-violation" |
 *     "manual")
 *   - termination.maxCycles? (positive integer when strategy = max-cycles)
 *
 * Karpathy §2 Simplicity First: pure data + a single hand-rolled
 * YAML parser inline; no new deps.
 *
 * File budget: ≤ 800 lines.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';

/** Spec origin — exposed as part of `peaks loop spec` output. */
export type SpecOrigin =
  | { kind: 'project'; path: string }
  | { kind: 'global'; path: string }
  | { kind: 'missing' };

export interface SpecEvaluatorEntry {
  readonly kind: string;
  readonly gate?: string;
  readonly scope?: string;
}

export interface SpecSlaEntry {
  readonly evaluator: string;
  readonly maxScore: number;
}

export type SpecTerminationStrategy = 'max-cycles' | 'monotonic-violation' | 'manual';

/** Default termination strategy — wired by `peaks loop run` so a
 *  spec.yaml produced by `loop spec bootstrap` actually drives the
 *  loop driver. Previously the string was declared-and-validated but
 *  never consumed (P0 in dogfood audit). */
export const MONOTONIC_TERMINATION: SpecTerminationStrategy = 'monotonic-violation';

/** Default max-cycles value (used when the strategy is `max-cycles`
 *  and the spec doesn't pin a value). Mirrors the slice dispatch
 *  prompt's `termination.maxCycles` default. */
export const DEFAULT_MAX_CYCLES = 5;

export interface SpecTermination {
  readonly strategy: SpecTerminationStrategy;
  readonly maxCycles?: number;
}

export interface LoopSpec {
  readonly schemaVersion: 1;
  readonly rid: string;
  readonly evaluators: readonly SpecEvaluatorEntry[];
  readonly sla: readonly SpecSlaEntry[];
  readonly termination: SpecTermination;
}

export interface SpecLintReport {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly normalizedSpec?: LoopSpec;
}

/** Resolve a `LoopSpec` from the project-level origin. Returns
 *  `{kind:'missing'}` when no file exists. The CLI layer then chooses
 *  to bootstrap a fresh spec or fail. */
export function resolveLoopSpec(projectRoot: string, sid: string, rid: string): { origin: SpecOrigin; spec: LoopSpec | null } {
  const path = join(projectRoot, '.peaks', '_runtime', sid, 'loop', rid, 'spec.yaml');
  if (!existsSync(path)) return { origin: { kind: 'missing' }, spec: null };
  const raw = readFileSync(path, 'utf8');
  const spec = parseSpecYaml(raw, rid);
  return { origin: { kind: 'project', path }, spec };
}

/** Build a spec from a structured object (so CLI callers can pass a
 *  JSON-derived payload through to the writer). Pure, never throws.
 *  Note: numeric range validation is the lint layer's responsibility;
 *  `buildSpec` preserves raw values so out-of-range entries surface in
 *  `lintLoopSpec` rather than being silently clamped. */
export function buildSpec(input: Partial<LoopSpec>, expectedRid: string): LoopSpec {
  const evaluators = Array.isArray(input.evaluators) ? input.evaluators.map((e) => ({
    kind: typeof e.kind === 'string' ? e.kind : '',
    ...(typeof e.gate === 'string' ? { gate: e.gate } : {}),
    ...(typeof e.scope === 'string' ? { scope: e.scope } : {})
  })) : [];
  const sla = Array.isArray(input.sla) ? input.sla.map((s) => ({
    evaluator: typeof s.evaluator === 'string' ? s.evaluator : '',
    maxScore: typeof s.maxScore === 'number' && Number.isFinite(s.maxScore) ? s.maxScore : Number.NaN
  })) : [];
  const term = input.termination ?? { strategy: 'manual' };
  const strategy: SpecTerminationStrategy = (term.strategy === 'max-cycles' || term.strategy === 'monotonic-violation' || term.strategy === 'manual') ? term.strategy : 'manual';
  const termination: SpecTermination = {
    strategy,
    ...(typeof term.maxCycles === 'number' && Number.isFinite(term.maxCycles) && term.maxCycles > 0 ? { maxCycles: Math.floor(term.maxCycles) } : {})
  };
  return {
    schemaVersion: 1,
    rid: expectedRid,
    evaluators,
    sla,
    termination
  };
}

/** Lint a LoopSpec — returns a report with semantic errors / warnings. */
export function lintLoopSpec(spec: LoopSpec): SpecLintReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (spec.schemaVersion !== 1) errors.push(`unsupported schemaVersion ${spec.schemaVersion} (expected 1)`);
  if (!/^[a-z][a-z0-9-]*$/.test(spec.rid)) errors.push(`rid "${spec.rid}" must match /^[a-z][a-z0-9-]*$/`);
  const seenKinds = new Set<string>();
  for (const ev of spec.evaluators) {
    if (typeof ev.kind !== 'string' || ev.kind.length === 0) {
      errors.push(`evaluator with empty kind`);
      continue;
    }
    if (seenKinds.has(ev.kind)) warnings.push(`evaluator kind "${ev.kind}" duplicated`);
    seenKinds.add(ev.kind);
  }
  const evalKinds = new Set(spec.evaluators.map((e) => e.kind));
  for (const s of spec.sla) {
    if (!evalKinds.has(s.evaluator)) errors.push(`sla.evaluator "${s.evaluator}" is not declared in evaluators[]`);
    if (s.maxScore < 0 || s.maxScore > 1) errors.push(`sla.maxScore for "${s.evaluator}" must be in [0,1] (got ${s.maxScore})`);
  }
  if (spec.termination.strategy === 'max-cycles' && (spec.termination.maxCycles === undefined || spec.termination.maxCycles < 1)) {
    errors.push(`termination.strategy=max-cycles requires maxCycles ≥ 1`);
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    normalizedSpec: spec
  };
}

/** Serialize a LoopSpec to a stable YAML representation. Pure. */
export function serializeSpec(spec: LoopSpec): string {
  const lines: string[] = [];
  lines.push('---');
  lines.push('schemaVersion: 1');
  lines.push(`rid: ${spec.rid}`);
  if (spec.evaluators.length === 0) {
    lines.push('evaluators: []');
  } else {
    lines.push('evaluators:');
    for (const ev of spec.evaluators) {
      const props: string[] = [`kind: ${ev.kind}`];
      if (ev.gate !== undefined) props.push(`gate: ${ev.gate}`);
      if (ev.scope !== undefined) props.push(`scope: ${ev.scope}`);
      lines.push(`  - ${props.join(', ')}`);
    }
  }
  if (spec.sla.length === 0) {
    lines.push('sla: []');
  } else {
    lines.push('sla:');
    for (const s of spec.sla) {
      lines.push(`  - evaluator: ${s.evaluator}, maxScore: ${s.maxScore}`);
    }
  }
  lines.push('termination:');
  lines.push(`  strategy: ${spec.termination.strategy}`);
  if (spec.termination.maxCycles !== undefined) {
    lines.push(`  maxCycles: ${spec.termination.maxCycles}`);
  }
  lines.push('');
  return lines.join('\n');
}

/** Persist a LoopSpec to disk at the project-level path; ensures the
 *  parent directory exists. Returns the resolved path. */
export function persistSpec(projectRoot: string, sid: string, spec: LoopSpec): string {
  const path = join(projectRoot, '.peaks', '_runtime', sid, 'loop', spec.rid, 'spec.yaml');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeSpec(spec), 'utf8');
  return path;
}

/** Lint a spec file from an explicit path — used by `peaks loop spec
 *  lint <file>`. Returns the lint report plus the parsed spec. */
export function lintSpecFile(filePath: string, expectedRid?: string): { raw: string; spec: LoopSpec | null; report: SpecLintReport } {
  if (!existsSync(filePath)) {
    return {
      raw: '',
      spec: null,
      report: { ok: false, errors: [`spec file not found: ${filePath}`], warnings: [] }
    };
  }
  const raw = readFileSync(filePath, 'utf8');
  let rid = expectedRid ?? '';
  if (rid === '') {
    // Derive rid from the parent dir name (slice dir = rid).
    const segments = filePath.split(/[\\\/]/);
    const specDir = segments[segments.length - 2] ?? '';
    rid = specDir.length > 0 ? specDir : 'spec';
  }
  try {
    const spec = parseSpecYaml(raw, rid);
    const report = lintLoopSpec(spec);
    return { raw, spec, report };
  } catch (error) {
    return {
      raw,
      spec: null,
      report: { ok: false, errors: [`failed to parse spec yaml: ${error instanceof Error ? error.message : String(error)}`], warnings: [] }
    };
  }
}

// ─── minimal hand-rolled YAML parser ────────────────────────────────────

/**
 * Tiny subset of YAML: indented objects + nested arrays of inline objects.
 * Mirrors the workflow yaml parser's shape, with two extensions:
 *  - tolerates inline `{ key: value, key: value }` objects (used for
 *    evaluator entries and termination.strategy/maxCycles), and
 *  - accepts `- kind: foo, gate: bar, scope: baz` (inline objects on
 *    array items).
 *
 * Karpathy §2: hand-rolled to avoid a new dep, same approach as
 * `src/services/workflow/workflow-spec.ts`.
 */
export function parseSpecYaml(raw: string, expectedRid: string): LoopSpec {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('spec yaml: input is empty');
  }
  // Tolerate `---` frontmatter.
  const lines = raw.split(/\r?\n/).filter((l, idx) => !(idx === 0 && l.trim() === '---'));
  const root = parseObjectBlock(lines, 0, 0).value as Record<string, unknown>;
  return buildSpec(root, expectedRid);
}

type ParseResult = { value: unknown; next: number };

function parseObjectBlock(lines: string[], start: number, baseIndent: number): ParseResult {
  const obj: Record<string, unknown> = {};
  let i = start;
  for (; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const indent = leadingSpaces(line);
    if (indent < baseIndent) return { value: obj, next: i };
    if (indent > baseIndent) continue; // caller should escalate
    const trimmed = line.trim();
    if (!trimmed.includes(':')) continue;
    const parts = splitTopLevel(trimmed, ':');
    const key = parts[0] ?? '';
    const value = (parts[1] ?? '').trim();
    // When `value` still contains a top-level `: ,` pattern, the line is
    // an inline object whose first key is the same as `key` (e.g.
    // `strategy: max-cycles, maxCycles: 3` →
    // `{strategy: 'max-cycles', maxCycles: 3}`). Re-stitch the leading
    // key so the inline-object parser can see the full kv list, then
    // store the resulting flat object as `obj[key]`.
    if (key.length > 0 && value.length > 0 && hasInlineObjectShape(value)) {
      obj[key] = parseInlineObject(`${key}: ${value}`);
      continue;
    }
    if (value === '' || value === '|' || value === '>') {
      // Could be nested block.
      const next = lines[i + 1] ?? '';
      const nextIndent = leadingSpaces(next);
      if (nextIndent > indent) {
        if (next.trim().startsWith('- ')) {
          const arrRes = parseArrayBlock(lines, i + 1, nextIndent);
          obj[key] = arrRes.value;
          i = arrRes.next - 1;
          continue;
        } else {
          const objRes = parseObjectBlock(lines, i + 1, nextIndent);
          obj[key] = objRes.value;
          i = objRes.next - 1;
          continue;
        }
      }
      obj[key] = value === '|' || value === '>' ? '' : null;
      continue;
    }
    obj[key] = parseValueOrInlineObject(value);
  }
  return { value: obj, next: i };
}

/** Inspect the trimmed value — if it looks like an inline object
 *  (`key: val, key: val`), parse as such; otherwise treat as scalar. */
function hasInlineObjectShape(value: string): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.startsWith('[') || trimmed.startsWith('{')) return false;
  let topColon = -1;
  let topComma = -1;
  let depth = 0;
  let inQuote: string | null = null;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inQuote !== null) { if (ch === inQuote) inQuote = null; continue; }
    if (ch === '"' || ch === "'") { inQuote = ch; continue; }
    if (ch === '[' || ch === '{') depth++;
    if (ch === ']' || ch === '}') depth--;
    if (depth !== 0) continue;
    if (ch === ':' && topColon === -1) topColon = i;
    if (ch === ',') topComma = i;
  }
  return topColon !== -1 && topComma !== -1;
}

function parseValueOrInlineObject(value: string): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return parseScalar(trimmed);
  }
  let topColon = -1;
  let topComma = -1;
  let depth = 0;
  let inQuote: string | null = null;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inQuote !== null) {
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { inQuote = ch; continue; }
    if (ch === '[' || ch === '{') depth++;
    if (ch === ']' || ch === '}') depth--;
    if (depth !== 0) continue;
    if (ch === ':' && topColon === -1) topColon = i;
    if (ch === ',') topComma = i;
  }
  if (topColon !== -1 && topComma !== -1 && topComma > topColon) {
    return parseInlineObject(trimmed);
  }
  return parseScalar(trimmed);
}

function parseArrayBlock(lines: string[], start: number, baseIndent: number): ParseResult {
  const arr: unknown[] = [];
  let i = start;
  for (; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const indent = leadingSpaces(line);
    if (indent < baseIndent) return { value: arr, next: i };
    if (indent > baseIndent) continue; // tolerate noise
    const trimmed = line.trim();
    if (!trimmed.startsWith('- ')) continue;
    const item = trimmed.slice(2).trim();
    if (item.startsWith('{') && item.endsWith('}')) {
      const inner = item.slice(1, -1).trim();
      arr.push(parseInlineObject(inner));
      continue;
    }
    if (item.includes(':')) {
      // Inline object on array item (e.g. `- kind: foo, gate: bar`).
      const inline = parseInlineObject(item);
      arr.push(inline);
      continue;
    }
    arr.push(parseScalar(item));
  }
  return { value: arr, next: i };
}

function parseInlineObject(body: string): Record<string, unknown> {
  // Split on top-level commas (not commas inside quotes — our spec has none).
  const obj: Record<string, unknown> = {};
  const parts = splitCommas(body);
  // When the first part has no `:` (e.g. `strategy: max-cycles, maxCycles: 3`
  // — caller already split on the leading `:`), use the previous answer's
  // accumulator to stitch it back together. In practice, just take the
  // shape: <key>: <val>, <key>: <val>, ... Each part is `key: val`.
  let lastKey: string | null = null;
  for (const p of parts) {
    const colon = p.indexOf(':');
    if (colon === -1) {
      if (lastKey !== null) {
        // Continuation: concatenate to the previous value (rare).
        const prev = obj[lastKey];
        if (typeof prev === 'string') obj[lastKey] = `${prev}, ${p.trim()}`;
        else if (typeof prev === 'number') obj[lastKey] = `${prev}${p.trim()}`;
      }
      continue;
    }
    const key = p.slice(0, colon).trim();
    const val = p.slice(colon + 1).trim();
    obj[key] = parseScalar(val);
    lastKey = key;
  }
  return obj;
}

function splitCommas(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  let inQuote: string | null = null;
  for (const ch of s) {
    if (inQuote !== null) {
      cur += ch;
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      cur += ch;
      continue;
    }
    if (ch === '[' || ch === '{') depth++;
    if (ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0) out.push(cur);
  return out.map((x) => x.trim()).filter((x) => x.length > 0);
}

function splitTopLevel(s: string, sep: string): string[] {
  let depth = 0;
  let inQuote: string | null = null;
  const out: string[] = [];
  let cur = '';
  for (const ch of s) {
    if (inQuote !== null) {
      cur += ch;
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { inQuote = ch; cur += ch; continue; }
    if (ch === '[' || ch === '{') depth++;
    if (ch === ']' || ch === '}') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

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
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
  if (/^-?\d+\.\d+$/.test(raw)) return parseFloat(raw);
  return raw;
}

export function specPath(projectRoot: string, sid: string, rid: string): string {
  return join(projectRoot, '.peaks', '_runtime', sid, 'loop', rid, 'spec.yaml');
}

/** Force a path to be inside the project root — guards against the
 *  `peaks loop spec lint <file>` flag accepting arbitrary paths. The
 *  caller decides whether the resulting abs path is in-bounds. */
export function pathIsInside(child: string, parent: string): boolean {
  const abs = isAbsolute(child) ? child : join(parent, child);
  return abs.startsWith(parent);
}
