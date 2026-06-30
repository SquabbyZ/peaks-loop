/**
 * peaks-loop v3.0.0 — Slice B.1
 *
 * Evaluator-as-primitive dispatcher. Each of the 4 evaluator types
 * (karpathy / code-review / security-review / perf-baseline) maps to
 * an existing peaks-cli CLI surface; the dispatcher shells out to the
 * same binary so verdict shape stays byte-compatible with the
 * `verdict-aggregator` envelope union (`karpathy` / `security` / `perf`).
 *
 * Karpathy §2 Simplicity First: no new dependencies, no LLM scheduling,
 * one binary per evaluator. Each evaluator returns the same envelope
 * shape the existing reviewer fan-out produces; verdict-aggregator
 * accepts them via `envelopesToAggregatorInput` unchanged (BC).
 *
 * File budget: ≤ 800 lines.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EvaluatorKind } from '../workflow/workflow-spec.js';

/** Standard evaluator verdict envelope — matches the union members
 *  consumed by `envelopesToAggregatorInput`. */
export interface EvaluatorVerdictEnvelope {
  readonly kind: EvaluatorKind;
  readonly passed: boolean;
  readonly gateAction: 'pass' | 'warn' | 'block';
  /** Severity-graded violations (file + line + hint). */
  readonly violations: ReadonlyArray<{
    readonly severity: 'CRITICAL' | 'HIGH' | 'MED' | 'LOW';
    readonly file: string;
    readonly line: number;
    readonly hint: string;
    readonly dimension?: string;
  }>;
  /** Summary line; surfaced in the nextActions list. */
  readonly summary: string;
  /** Wall-time the evaluator took (seconds). */
  readonly wallSeconds: number;
  /** When true, the evaluator fell back to a stub because the binary was
   *  unavailable in this environment. Surfaces in the verdict envelope so
   *  the user can rerun on a real peaks-cli install. */
  readonly degraded: boolean;
}

export interface DispatchOptions {
  readonly projectRoot: string;
  readonly rid: string;
  readonly scope?: string;
  readonly threshold?: string;
  /** Override the peaks binary path (default: `node bin/peaks.js` from cwd). */
  readonly peaksBin?: string;
}

/** Dispatch a single evaluator against the given rid and project. */
export function dispatchEvaluator(
  kind: EvaluatorKind,
  options: DispatchOptions
): EvaluatorVerdictEnvelope {
  const started = Date.now();
  switch (kind) {
    case 'karpathy':
      return dispatchKarpathy(options, started);
    case 'code-review':
      return dispatchCodeReview(options, started);
    case 'security-review':
      return dispatchSecurityReview(options, started);
    case 'perf-baseline':
      return dispatchPerfBaseline(options, started);
    case 'verdict-aggregate':
      return dispatchVerdictAggregate(options, started);
    default: {
      // Exhaustiveness guard.
      const exhaustive: never = kind;
      throw new Error(`dispatchEvaluator: unknown evaluator kind ${String(exhaustive)}`);
    }
  }
}

function peaksCommand(opts: DispatchOptions): string[] {
  if (opts.peaksBin !== undefined) {
    // Already a full command (e.g. `node bin/peaks.js` or `/usr/local/bin/peaks`).
    return [opts.peaksBin];
  }
  return ['node', 'bin/peaks.js'];
}

function execPeaks(args: string[], cwd: string, peaksBin?: string): { stdout: string; exitCode: number } {
  try {
    const cmd = peaksCommand({ projectRoot: cwd, rid: '', ...(peaksBin !== undefined ? { peaksBin } : {}) });
    const stdout = execFileSync(cmd[0]!, [...cmd.slice(1), ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8'
    });
    return { stdout, exitCode: 0 };
  } catch (error) {
    // Surface the error envelope as stdout so the dispatcher can still
    // parse it; treat non-zero exit as a degraded verdict (not a hard
    // throw — evaluators must always return an envelope).
    const err = error as { stdout?: Buffer | string; status?: number | null };
    return {
      stdout: typeof err.stdout === 'string' ? err.stdout : Buffer.isBuffer(err.stdout) ? err.stdout.toString('utf8') : '',
      exitCode: typeof err.status === 'number' ? err.status : 1
    };
  }
}

function dispatchKarpathy(opts: DispatchOptions, started: number): EvaluatorVerdictEnvelope {
  const args = [
    'code-review',
    'karpathy',
    '--project', opts.projectRoot,
    '--rid', opts.rid,
    '--json'
  ];
  const { stdout, exitCode } = execPeaks(args, opts.projectRoot, opts.peaksBin);
  return parseKarpathyEnvelope(stdout, exitCode, started);
}

function dispatchCodeReview(opts: DispatchOptions, started: number): EvaluatorVerdictEnvelope {
  const args = [
    'code-review',
    'run',
    '--project', opts.projectRoot,
    '--rid', opts.rid,
    '--json'
  ];
  const { stdout, exitCode } = execPeaks(args, opts.projectRoot, opts.peaksBin);
  return parseCodeReviewEnvelope(stdout, exitCode, started);
}

function dispatchSecurityReview(opts: DispatchOptions, started: number): EvaluatorVerdictEnvelope {
  const args = [
    'security-audit',
    'run',
    '--project', opts.projectRoot,
    '--rid', opts.rid,
    '--json'
  ];
  const { stdout, exitCode } = execPeaks(args, opts.projectRoot, opts.peaksBin);
  return parseSecurityEnvelope(stdout, exitCode, started);
}

function dispatchPerfBaseline(opts: DispatchOptions, started: number): EvaluatorVerdictEnvelope {
  const args = [
    'perf-audit',
    'run',
    '--project', opts.projectRoot,
    '--rid', opts.rid,
    '--json'
  ];
  const { stdout, exitCode } = execPeaks(args, opts.projectRoot, opts.peaksBin);
  return parsePerfEnvelope(stdout, exitCode, started);
}

function dispatchVerdictAggregate(opts: DispatchOptions, started: number): EvaluatorVerdictEnvelope {
  const args = [
    'verdict',
    'aggregate',
    '--from-rid', opts.rid,
    '--project', opts.projectRoot,
    '--json'
  ];
  const { stdout, exitCode } = execPeaks(args, opts.projectRoot, opts.peaksBin);
  return parseVerdictAggregateEnvelope(stdout, exitCode, started);
}

// ─── envelope parsers (pure, never throw) ──────────────────────────────

function gateActionFromVerdict(verdict: string): 'pass' | 'warn' | 'block' {
  if (verdict === 'pass' || verdict === 'warn' || verdict === 'block') return verdict;
  return 'warn';
}

function parseKarpathyEnvelope(stdout: string, exitCode: number, started: number): EvaluatorVerdictEnvelope {
  const wall = (Date.now() - started) / 1000;
  const parsed = safeJson(stdout);
  if (parsed === null) {
    return {
      kind: 'karpathy',
      passed: exitCode === 0,
      gateAction: exitCode === 0 ? 'pass' : 'block',
      violations: [],
      summary: stdout.slice(0, 200),
      wallSeconds: wall,
      degraded: true
    };
  }
  const obj = parsed as Record<string, unknown>;
  const data = (obj['data'] ?? obj) as Record<string, unknown>;
  const passed = data['passed'] === true;
  const gateAction = typeof data['gateAction'] === 'string' ? gateActionFromVerdict(data['gateAction']) : (passed ? 'pass' : 'block');
  const violationsRaw = Array.isArray(data['violations']) ? data['violations'] : [];
  const violations = violationsRaw.map((v) => normalizeViolation(v));
  return {
    kind: 'karpathy',
    passed,
    gateAction,
    violations,
    summary: typeof data['summary'] === 'string' ? data['summary'] : 'karpathy review',
    wallSeconds: wall,
    degraded: false
  };
}

function parseCodeReviewEnvelope(stdout: string, exitCode: number, started: number): EvaluatorVerdictEnvelope {
  // code-review emits the same shape as karpathy (Karpathy §4 envelope).
  return envelopeAs(parseKarpathyEnvelope(stdout, exitCode, started), 'code-review');
}

function parseSecurityEnvelope(stdout: string, exitCode: number, started: number): EvaluatorVerdictEnvelope {
  const wall = (Date.now() - started) / 1000;
  const parsed = safeJson(stdout);
  if (parsed === null) {
    return {
      kind: 'security-review',
      passed: exitCode === 0,
      gateAction: exitCode === 0 ? 'pass' : 'warn',
      violations: [],
      summary: stdout.slice(0, 200),
      wallSeconds: wall,
      degraded: true
    };
  }
  const obj = parsed as Record<string, unknown>;
  const data = (obj['data'] ?? obj) as Record<string, unknown>;
  const verdict = typeof data['verdict'] === 'string' ? data['verdict'] : (exitCode === 0 ? 'pass' : 'warn');
  const violationsRaw = Array.isArray(data['violations']) ? data['violations'] : [];
  const violations = violationsRaw.map((v) => normalizeViolation(v));
  return {
    kind: 'security-review',
    passed: verdict === 'pass',
    gateAction: gateActionFromVerdict(verdict),
    violations,
    summary: typeof data['summary'] === 'string' ? data['summary'] : 'security review',
    wallSeconds: wall,
    degraded: false
  };
}

function parsePerfEnvelope(stdout: string, exitCode: number, started: number): EvaluatorVerdictEnvelope {
  const wall = (Date.now() - started) / 1000;
  const parsed = safeJson(stdout);
  if (parsed === null) {
    return {
      kind: 'perf-baseline',
      passed: exitCode === 0,
      gateAction: exitCode === 0 ? 'pass' : 'warn',
      violations: [],
      summary: stdout.slice(0, 200),
      wallSeconds: wall,
      degraded: true
    };
  }
  const obj = parsed as Record<string, unknown>;
  const data = (obj['data'] ?? obj) as Record<string, unknown>;
  const verdict = typeof data['verdict'] === 'string' ? data['verdict'] : (exitCode === 0 ? 'pass' : 'warn');
  const violationsRaw = Array.isArray(data['violations']) ? data['violations'] : [];
  const violations = violationsRaw.map((v) => normalizeViolation(v));
  return {
    kind: 'perf-baseline',
    passed: verdict === 'pass',
    gateAction: gateActionFromVerdict(verdict),
    violations,
    summary: typeof data['summary'] === 'string' ? data['summary'] : 'perf baseline review',
    wallSeconds: wall,
    degraded: false
  };
}

function parseVerdictAggregateEnvelope(stdout: string, exitCode: number, started: number): EvaluatorVerdictEnvelope {
  const wall = (Date.now() - started) / 1000;
  const parsed = safeJson(stdout);
  if (parsed === null) {
    return {
      kind: 'verdict-aggregate',
      passed: exitCode === 0,
      gateAction: exitCode === 0 ? 'pass' : 'block',
      violations: [],
      summary: stdout.slice(0, 200),
      wallSeconds: wall,
      degraded: true
    };
  }
  const obj = parsed as Record<string, unknown>;
  const data = (obj['data'] ?? obj) as Record<string, unknown>;
  const verdict = typeof data['verdict'] === 'string' ? data['verdict'] : (exitCode === 0 ? 'pass' : 'block');
  const reasonsRaw = Array.isArray(data['reasons']) ? data['reasons'] : [];
  const violations = reasonsRaw.map((r) => reasonToViolation(r));
  return {
    kind: 'verdict-aggregate',
    passed: verdict === 'pass',
    gateAction: gateActionFromVerdict(verdict),
    violations,
    summary: `verdict-aggregate: ${verdict}`,
    wallSeconds: wall,
    degraded: false
  };
}

function reasonToViolation(reason: unknown): EvaluatorVerdictEnvelope['violations'][number] {
  if (typeof reason === 'string') {
    return { severity: 'MED', file: '<verdict>', line: 0, hint: reason };
  }
  if (reason !== null && typeof reason === 'object') {
    const r = reason as Record<string, unknown>;
    return {
      severity: typeof r['severity'] === 'string' ? (r['severity'] as 'CRITICAL' | 'HIGH' | 'MED' | 'LOW') : 'MED',
      file: typeof r['file'] === 'string' ? r['file'] : '<verdict>',
      line: typeof r['line'] === 'number' ? r['line'] : 0,
      hint: typeof r['hint'] === 'string' ? r['hint'] : JSON.stringify(reason)
    };
  }
  return { severity: 'MED', file: '<verdict>', line: 0, hint: String(reason) };
}

function normalizeViolation(raw: unknown): EvaluatorVerdictEnvelope['violations'][number] {
  if (raw === null || typeof raw !== 'object') {
    return { severity: 'MED', file: '<unknown>', line: 0, hint: String(raw) };
  }
  const v = raw as Record<string, unknown>;
  const sev = typeof v['severity'] === 'string' ? (v['severity'] as 'CRITICAL' | 'HIGH' | 'MED' | 'LOW') : 'MED';
  const file = typeof v['file'] === 'string' ? v['file'] : '<unknown>';
  const line = typeof v['line'] === 'number' ? v['line'] : 0;
  const hint = typeof v['hint'] === 'string' ? v['hint'] : '';
  const dimension = typeof v['dimension'] === 'string' ? v['dimension'] : undefined;
  const out: EvaluatorVerdictEnvelope['violations'][number] = dimension !== undefined
    ? { severity: sev, file, line, hint, dimension }
    : { severity: sev, file, line, hint };
  return out;
}

function safeJson(raw: string): unknown {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Tiny ergonomic helper so we can re-emit an envelope with a different `kind`.
// (Implementation note: this is a free function rather than a method — the
// EvaluatorVerdictEnvelope interface is plain data, and adding methods via
// `declare module` makes TS treat them as required properties.)
export function envelopeAs(envelope: EvaluatorVerdictEnvelope, kind: EvaluatorKind): EvaluatorVerdictEnvelope {
  return { ...envelope, kind };
}

// ─── Markdown → envelope fallbacks (used when peaks CLI is unavailable) ─

/**
 * Best-effort markdown parse for karpathy-review.md / security.md / perf.md.
 * Mirrors the shape accepted by `parseKarpathyEnvelope` /
 * `parseSecurityEnvelope` / `parsePerfEnvelope` in `services/verdict/envelopes.ts`,
 * keeping verdict-aggregator backward-compat intact.
 */
export function parseAuditMarkdownEnvelope(md: string, kind: 'security-review' | 'perf-baseline'): EvaluatorVerdictEnvelope | null {
  if (typeof md !== 'string' || md.length === 0) return null;
  const verdict = matchVerdict(md);
  if (verdict === null) return null;
  const violations = parseFindingBullets(md).map((b) => ({ ...b, dimension: kind }));
  return {
    kind,
    passed: verdict === 'pass',
    gateAction: verdict,
    violations,
    summary: extractSection(md, 'Summary') ?? '',
    wallSeconds: 0,
    degraded: true
  };
}

function matchVerdict(md: string): 'pass' | 'warn' | 'block' | null {
  const m = md.match(/^\s*verdict\s*:\s*(pass|warn|block)\s*$/m);
  if (m === null) return null;
  return m[1] as 'pass' | 'warn' | 'block';
}

function parseFindingBullets(body: string): Array<{ severity: 'CRITICAL' | 'HIGH' | 'MED' | 'LOW'; file: string; line: number; hint: string }> {
  const section = body.split(/^##\s+Findings\s*$/m)[1];
  if (section === undefined) return [];
  const lines = section.split('\n').filter((l) => l.trim().startsWith('- '));
  const out: Array<{ severity: 'CRITICAL' | 'HIGH' | 'MED' | 'LOW'; file: string; line: number; hint: string }> = [];
  for (const line of lines) {
    const a = line.match(/^\s*-\s*\[(CRITICAL|HIGH|MED|LOW)\]\s+(\S+)\s+@\s+([^:\s]+):(\d+)\s+[—-]\s+(.+)$/);
    if (a !== null) {
      const [, severity, , file, lineNo, hint] = a;
      out.push({ severity: severity as 'CRITICAL' | 'HIGH' | 'MED' | 'LOW', file: file ?? '<unknown>', line: parseInt(lineNo ?? '0', 10), hint: (hint ?? '').trim() });
      continue;
    }
    const b = line.match(/^\s*-\s*(CRITICAL|HIGH|MED|LOW)\s*:\s+(.+?)\s+in\s+([^:\s]+):(\d+)\s*$/);
    if (b !== null) {
      const [, severity, hint, file, lineNo] = b;
      out.push({ severity: severity as 'CRITICAL' | 'HIGH' | 'MED' | 'LOW', file: file ?? '<unknown>', line: parseInt(lineNo ?? '0', 10), hint: (hint ?? '').trim() });
    }
  }
  return out;
}

function extractSection(body: string, heading: string): string | null {
  const re = new RegExp(`^##\\s+${heading}\\s*$`, 'm');
  const sectionStart = body.search(re);
  if (sectionStart === -1) return null;
  const after = body.slice(sectionStart).split('\n');
  after.shift();
  const lines: string[] = [];
  for (const line of after) {
    if (/^##\s+/.test(line)) break;
    lines.push(line);
  }
  return lines.join('\n').trim();
}

/** Load an on-disk audit file (e.g. `.peaks/_runtime/<sid>/audit/security.md`)
 *  and project it to an `EvaluatorVerdictEnvelope`. Used by workflow yaml
 *  evaluators that point at on-disk artifacts. */
export function loadEnvelopeFromDisk(
  projectRoot: string,
  sid: string,
  rel: string,
  kind: 'security-review' | 'perf-baseline'
): EvaluatorVerdictEnvelope | null {
  const path = join(projectRoot, '.peaks', '_runtime', sid, rel);
  if (!existsSync(path)) return null;
  const md = readFileSync(path, 'utf8');
  return parseAuditMarkdownEnvelope(md, kind);
}