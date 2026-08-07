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

/** Lint a LoopSpec — returns a report with semantic errors / warnings.
 *
 *  Refactored 2026-08-07 (PRD-002b slice 3 commit A — extract-method):
 *  the original function had complexity 14. Each validation phase now lives
 *  in its own helper, dropping the orchestrator to complexity ~5.
 *  Behavior is byte-for-byte preserved: same error/warning strings, same
 *  ordering, same return shape. */
export function lintLoopSpec(spec: LoopSpec): SpecLintReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  validateSpecHeader(spec, errors);
  validateEvaluators(spec.evaluators, errors, warnings);
  validateSla(spec.sla, spec.evaluators, errors);
  validateTermination(spec.termination, errors);
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    normalizedSpec: spec
  };
}

function validateSpecHeader(spec: LoopSpec, errors: string[]): void {
  if (spec.schemaVersion !== 1) errors.push(`unsupported schemaVersion ${spec.schemaVersion} (expected 1)`);
  if (!/^[a-z][a-z0-9-]*$/.test(spec.rid)) errors.push(`rid "${spec.rid}" must match /^[a-z][a-z0-9-]*$/`);
}

function validateEvaluators(
  evaluators: readonly SpecEvaluatorEntry[],
  errors: string[],
  warnings: string[]
): void {
  const seenKinds = new Set<string>();
  for (const ev of evaluators) {
    if (typeof ev.kind !== 'string' || ev.kind.length === 0) {
      errors.push(`evaluator with empty kind`);
      continue;
    }
    if (seenKinds.has(ev.kind)) warnings.push(`evaluator kind "${ev.kind}" duplicated`);
    seenKinds.add(ev.kind);
  }
}

function validateSla(
  sla: readonly SpecSlaEntry[],
  evaluators: readonly SpecEvaluatorEntry[],
  errors: string[]
): void {
  const evalKinds = new Set(evaluators.map((e) => e.kind));
  for (const s of sla) {
    if (!evalKinds.has(s.evaluator)) errors.push(`sla.evaluator "${s.evaluator}" is not declared in evaluators[]`);
    if (s.maxScore < 0 || s.maxScore > 1) errors.push(`sla.maxScore for "${s.evaluator}" must be in [0,1] (got ${s.maxScore})`);
  }
}

function validateTermination(termination: SpecTermination, errors: string[]): void {
  if (termination.strategy === 'max-cycles' && (termination.maxCycles === undefined || termination.maxCycles < 1)) {
    errors.push(`termination.strategy=max-cycles requires maxCycles ≥ 1`);
  }
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

/** Discriminated line kinds emitted by `classifyObjectLine`. Drives the
 *  `parseObjectBlock` state machine (PRD-002b slice 3 Commit C —
 *  table-dispatch). Order matters: `indent-back` short-circuits the loop. */
type ObjectLine =
  | { kind: 'blank' }
  | { kind: 'comment' }
  | { kind: 'indent-back' }
  | { kind: 'indent-forward' }
  | { kind: 'kv-inline-object'; key: string; value: string }
  | { kind: 'kv-nested-block'; key: string; value: '' | '|' | '>' }
  | { kind: 'kv-scalar'; key: string; value: string };

function parseObjectBlock(lines: string[], start: number, baseIndent: number): ParseResult {
  const obj: Record<string, unknown> = {};
  let i = start;
  for (; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const cls = classifyObjectLine(line, baseIndent);
    switch (cls.kind) {
      case 'blank':
      case 'comment':
      case 'indent-forward':
        continue;
      case 'indent-back':
        return { value: obj, next: i };
      case 'kv-inline-object':
        obj[cls.key] = parseInlineObject(`${cls.key}: ${cls.value}`);
        continue;
      case 'kv-nested-block': {
        const consumed = consumeNestedBlock(lines, i, line, cls.value);
        obj[cls.key] = consumed.value;
        i = consumed.next - 1;
        continue;
      }
      case 'kv-scalar':
        obj[cls.key] = parseValueOrInlineObject(cls.value);
        continue;
    }
  }
  return { value: obj, next: i };
}

/** Classify a single line at `baseIndent` into a token kind. Pure —
 *  no mutation of the loop index. */
function classifyObjectLine(line: string, baseIndent: number): ObjectLine {
  const trimmed = line.trim();
  if (trimmed === '') return { kind: 'blank' };
  if (trimmed.startsWith('#')) return { kind: 'comment' };
  const indent = leadingSpaces(line);
  if (indent < baseIndent) return { kind: 'indent-back' };
  if (indent > baseIndent) return { kind: 'indent-forward' };
  if (!trimmed.includes(':')) return { kind: 'comment' }; // noise: no `:` → skip
  return classifyKeyValue(trimmed);
}

/** Inspect a trimmed, colon-bearing line and classify its key/value
 *  payload. Delegates the value-shape triage to `classifyValueKind`. */
function classifyKeyValue(trimmed: string): ObjectLine {
  const parts = splitTopLevel(trimmed, ':');
  const key = parts[0] ?? '';
  const value = (parts[1] ?? '').trim();
  switch (classifyValueKind(value)) {
    case 'inline-object':
      return { kind: 'kv-inline-object', key, value };
    case 'nested-block':
      return { kind: 'kv-nested-block', key, value: value as '' | '|' | '>' };
    case 'scalar':
      return { kind: 'kv-scalar', key, value };
  }
}

/** Triage the post-colon value string. Returns the kind that the
 *  caller should produce. The inline-object check delegates to
 *  `hasInlineObjectShape`; the nested-block check covers YAML's
 *  three block-scalar placeholders. */
function classifyValueKind(value: string): 'inline-object' | 'nested-block' | 'scalar' {
  if (value.length > 0 && hasInlineObjectShape(value)) return 'inline-object';
  if (value === '' || value === '|' || value === '>') return 'nested-block';
  return 'scalar';
}

/** Consume the nested block (array or object) under a `kv-nested-block`
 *  line. Returns the parsed value plus the index past the last consumed
 *  line (caller subtracts 1 before the for-loop increment). When the
 *  next line is NOT indented further, returns a null / empty scalar and
 *  `next = i + 1` so the caller lands on the line after the kv marker. */
function consumeNestedBlock(
  lines: string[],
  i: number,
  line: string,
  value: '' | '|' | '>'
): { value: unknown; next: number } {
  const next = lines[i + 1] ?? '';
  const nextIndent = leadingSpaces(next);
  const ownIndent = leadingSpaces(line);
  if (nextIndent > ownIndent) {
    if (next.trim().startsWith('- ')) {
      const arrRes = parseArrayBlock(lines, i + 1, nextIndent);
      return { value: arrRes.value, next: arrRes.next };
    }
    const objRes = parseObjectBlock(lines, i + 1, nextIndent);
    return { value: objRes.value, next: objRes.next };
  }
  // Block-style scalar placeholder with no children — keep the original
  // behaviour: `|` / `>` collapse to `''`, empty value to `null`.
  return { value: value === '|' || value === '>' ? '' : null, next: i + 1 };
}

/** Inspect the trimmed value — if it looks like an inline object
 *  (`key: val, key: val`), report true; otherwise false. Refactored
 *  2026-08-07 (PRD-002b slice 3 Commit C — table-dispatch): the
 *  original hand-rolled character walk was complexity 19; now we
 *  delegate to the shared `scanTopLevelSeparators` scanner twice
 *  (comma, then colon per part) and dispatch on the resulting parts.
 *  Behaviour-preserving: a top-level `,` AND a top-level `:` are both
 *  present iff `commaParts.length >= 2` AND at least one part splits
 *  further on `:`. */
function hasInlineObjectShape(value: string): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.startsWith('[') || trimmed.startsWith('{')) return false;
  const commaParts = scanTopLevelSeparators(trimmed, ',');
  if (commaParts.length < 2) return false;
  return commaParts.some((part) => scanTopLevelSeparators(part, ':').length >= 2);
}

/** Parse a value that may be either a scalar or an inline object.
 *  Refactored 2026-08-07 (PRD-002b slice 3 Commit C — table-dispatch):
 *  the original hand-rolled character walk was complexity 21; now
 *  delegates to the shared `scanTopLevelSeparators` scanner. The
 *  original check was `topColon !== -1 && topComma !== -1 &&
 *  topComma > topColon`, i.e. "the first top-level `:` lies before
 *  the last top-level `,`". Equivalent: the FIRST comma-separated
 *  part contains at least one top-level `:`. Behaviour-preserving. */
function parseValueOrInlineObject(value: string): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return parseScalar(trimmed);
  }
  const commaParts = scanTopLevelSeparators(trimmed, ',');
  if (commaParts.length < 2) return parseScalar(trimmed);
  const first = commaParts[0] ?? '';
  const hasColonInFirst = scanTopLevelSeparators(first, ':').length >= 2;
  if (hasColonInFirst) return parseInlineObject(trimmed);
  return parseScalar(trimmed);
}

function parseArrayBlock(lines: string[], start: number, baseIndent: number): ParseResult {
  const arr: unknown[] = [];
  let i = start;
  for (; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (shouldSkipArrayLine(line, baseIndent)) continue;
    if (leadingSpaces(line) < baseIndent) return { value: arr, next: i };
    const trimmed = line.trim();
    if (!trimmed.startsWith('- ')) continue;
    arr.push(parseArrayItem(trimmed.slice(2).trim()));
  }
  return { value: arr, next: i };
}

function shouldSkipArrayLine(line: string, baseIndent: number): boolean {
  if (line.trim() === '' || line.trim().startsWith('#')) return true;
  if (leadingSpaces(line) > baseIndent) return true; // tolerate noise
  return false;
}

function parseArrayItem(item: string): unknown {
  if (item.startsWith('{') && item.endsWith('}')) {
    return parseInlineObject(item.slice(1, -1).trim());
  }
  if (item.includes(':')) {
    // Inline object on array item (e.g. `- kind: foo, gate: bar`).
    return parseInlineObject(item);
  }
  return parseScalar(item);
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
  const raw = scanTopLevelSeparators(s, ',');
  return raw.map((x) => x.trim()).filter((x) => x.length > 0);
}

/** Shared scanner — splits `s` on `sep` at depth 0 outside quotes.
 *  Behaviour-preserving with the original splitCommas / splitTopLevel
 *  loops; extracted on 2026-08-07 (PRD-002b slice 3 A) to drop both
 *  callers' complexity from 13 to ≤ 2. */
function scanTopLevelSeparators(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  let inQuote: string | null = null;
  for (const ch of s) {
    const ctx = stepScanner(ch, sep, cur, inQuote, depth);
    cur = ctx.cur;
    inQuote = ctx.inQuote;
    depth = ctx.depth;
    if (ctx.push) out.push(ctx.push);
    if (ctx.reset) cur = '';
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

type ScannerStep = {
  cur: string;
  inQuote: string | null;
  depth: number;
  push: string | null;
  reset: boolean;
};

function stepScanner(
  ch: string,
  sep: string,
  cur: string,
  inQuote: string | null,
  depth: number
): ScannerStep {
  if (inQuote !== null) return stepInsideQuote(ch, cur, inQuote, depth);
  if (isQuote(ch)) return { cur: cur + ch, inQuote: ch, depth, push: null, reset: false };
  if (isOpenBracket(ch)) return { cur, inQuote, depth: depth + 1, push: null, reset: false };
  if (isCloseBracket(ch)) return { cur, inQuote, depth: depth - 1, push: null, reset: false };
  if (ch === sep && depth === 0) return { cur, inQuote, depth, push: cur, reset: true };
  return { cur: cur + ch, inQuote, depth, push: null, reset: false };
}

function stepInsideQuote(ch: string, cur: string, inQuote: string | null, depth: number): ScannerStep {
  const nextInQuote = ch === inQuote ? null : inQuote;
  return { cur: cur + ch, inQuote: nextInQuote, depth, push: null, reset: false };
}

function isQuote(ch: string): boolean {
  return ch === '"' || ch === "'";
}

function isOpenBracket(ch: string): boolean {
  return ch === '[' || ch === '{';
}

function isCloseBracket(ch: string): boolean {
  return ch === ']' || ch === '}';
}

function splitTopLevel(s: string, sep: string): string[] {
  return scanTopLevelSeparators(s, sep);
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
  const unquoted = unquoteIfWrapped(raw);
  if (unquoted !== null) return unquoted;
  return parseScalarNumber(raw) ?? raw;
}

function unquoteIfWrapped(raw: string): string | null {
  const len = raw.length;
  if (len >= 2) {
    const first = raw[0];
    const last = raw[len - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return raw.slice(1, -1);
    }
  }
  return null;
}

function parseScalarNumber(raw: string): number | null {
  if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
  if (/^-?\d+\.\d+$/.test(raw)) return parseFloat(raw);
  return null;
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
