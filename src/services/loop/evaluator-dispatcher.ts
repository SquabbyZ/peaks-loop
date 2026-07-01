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
import { runMonotonicCheck } from './monotonic-runner.js';

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
  /** Session id — required by `monotonic-improvement` so the guard
   *  can read the prior cycle from the slice dir. Other evaluators
   *  ignore it. */
  readonly sessionId?: string;
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
    case 'monotonic-improvement':
      return dispatchMonotonicImprovement(options, started);
    case 'impact-scan':
      return dispatchImpactScan(options, started);
    case 'smoke-run':
      return dispatchSmokeRun(options, started);
    case 'canary-watch':
      return dispatchCanaryWatch(options, started);
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

function dispatchImpactScan(opts: DispatchOptions, started: number): EvaluatorVerdictEnvelope {
  // `peaks impact scan --files <list>` requires a comma-separated file
  // list. From the loop dispatcher we forward `scope` (which is the
  // evaluator scope expression) as the file list when present; when
  // absent we degrade to a warn envelope (sketch-grade acceptance).
  const files = opts.scope && opts.scope.length > 0 ? opts.scope : '';
  if (files.length === 0) {
    const wall = (Date.now() - started) / 1000;
    return {
      kind: 'impact-scan',
      passed: false,
      gateAction: 'warn',
      violations: [{
        severity: 'MED',
        file: '<loop>',
        line: 0,
        hint: 'impact-scan dispatcher requires scope (a comma-separated file list); set the evaluator scope on the workflow yaml'
      }],
      summary: 'impact-scan: missing scope/files',
      wallSeconds: wall,
      degraded: true
    };
  }
  const args = ['impact', 'scan', '--files', files, '--project', opts.projectRoot, '--json'];
  const { stdout, exitCode } = execPeaks(args, opts.projectRoot, opts.peaksBin);
  return parseGenericEnvelope(stdout, exitCode, started, 'impact-scan', 'impact-scan: ');
}

function dispatchSmokeRun(opts: DispatchOptions, started: number): EvaluatorVerdictEnvelope {
  // `peaks smoke run` is a no-op recorder (returns a dry summary by
  // default). Pure sketch-grade surface.
  const args = ['smoke', 'run', '--project', opts.projectRoot, '--json'];
  const { stdout, exitCode } = execPeaks(args, opts.projectRoot, opts.peaksBin);
  return parseGenericEnvelope(stdout, exitCode, started, 'smoke-run', 'smoke-run: ');
}

function dispatchCanaryWatch(opts: DispatchOptions, started: number): EvaluatorVerdictEnvelope {
  // `peaks release canary --version <v>` requires a version label. We
  // forward `scope` when supplied (interpreted as the canary version),
  // otherwise degrade to a warn envelope (sketch-grade acceptance).
  const version = opts.scope && opts.scope.length > 0 ? opts.scope : '';
  if (version.length === 0) {
    const wall = (Date.now() - started) / 1000;
    return {
      kind: 'canary-watch',
      passed: false,
      gateAction: 'warn',
      violations: [{
        severity: 'MED',
        file: '<loop>',
        line: 0,
        hint: 'canary-watch dispatcher requires scope (the canary version label); set the evaluator scope on the workflow yaml'
      }],
      summary: 'canary-watch: missing version',
      wallSeconds: wall,
      degraded: true
    };
  }
  const args = ['release', 'canary', '--version', version, '--project', opts.projectRoot, '--json'];
  const { stdout, exitCode } = execPeaks(args, opts.projectRoot, opts.peaksBin);
  return parseGenericEnvelope(stdout, exitCode, started, 'canary-watch', 'canary-watch: ');
}

/** Generic envelope parser for the 3 G13/G14/G15 sketch-grade evaluators
 *  — they share shape (data.ok + data.count + data.summary). */
function parseGenericEnvelope(
  stdout: string,
  exitCode: number,
  started: number,
  kind: 'impact-scan' | 'smoke-run' | 'canary-watch',
  summaryPrefix: string
): EvaluatorVerdictEnvelope {
  const wall = (Date.now() - started) / 1000;
  const parsed = safeJson(stdout);
  if (!parsed.ok) {
    return {
      kind,
      passed: exitCode === 0,
      gateAction: exitCode === 0 ? 'pass' : 'warn',
      violations: [],
      summary: stdout.slice(0, 200),
      wallSeconds: wall,
      degraded: true
    };
  }
  const obj = parsed.value as Record<string, unknown>;
  const data = (obj['data'] ?? obj) as Record<string, unknown>;
  return {
    kind,
    passed: exitCode === 0,
    gateAction: exitCode === 0 ? 'pass' : 'warn',
    violations: [],
    summary: typeof data['summary'] === 'string' ? summaryPrefix + data['summary'] : summaryPrefix + (exitCode === 0 ? 'ok' : 'failed'),
    wallSeconds: wall,
    degraded: false
  };
}

function dispatchMonotonicImprovement(opts: DispatchOptions, started: number): EvaluatorVerdictEnvelope {
  // The monotonic guard is intra-process logic — we do not need to
  // shell out to the peaks CLI for the score walk itself. The CLI
  // shapes (`peaks loop check-monotonic`, `peaks loop eval
  // --evaluator monotonic-improvement`) both converge here.
  const sid = opts.sessionId;
  if (sid === undefined || sid.length === 0) {
    return {
      kind: 'monotonic-improvement',
      passed: false,
      gateAction: 'warn',
      violations: [{
        severity: 'MED',
        file: '<loop>',
        line: 0,
        hint: 'monotonic-improvement dispatcher requires sessionId; pass --session <sid> or call peaks loop check-monotonic directly'
      }],
      summary: 'monotonic-improvement: missing sessionId',
      wallSeconds: 0,
      degraded: true
    };
  }
  const thresholdNum = opts.threshold !== undefined ? Number(opts.threshold) : undefined;
  if (thresholdNum !== undefined && !Number.isFinite(thresholdNum)) {
    return {
      kind: 'monotonic-improvement',
      passed: false,
      gateAction: 'warn',
      violations: [{
        severity: 'MED',
        file: '<loop>',
        line: 0,
        hint: `invalid threshold "${opts.threshold}" — must be a finite number in [0,1]`
      }],
      summary: 'monotonic-improvement: invalid threshold',
      wallSeconds: 0,
      degraded: true
    };
  }
  try {
    const result = runMonotonicCheck({
      projectRoot: opts.projectRoot,
      sid,
      rid: opts.rid,
      ...(thresholdNum !== undefined ? { threshold: thresholdNum } : {})
    });
    const wall = (Date.now() - started) / 1000;
    const violations = result.report.regressions.map((r) => ({
      severity: 'HIGH' as const,
      file: '<loop>',
      line: 0,
      hint: `${r.evaluator} regressed ${r.previousScore.toFixed(4)}→${r.currentScore.toFixed(4)} (Δ=${r.delta.toFixed(4)})`
    }));
    return {
      kind: 'monotonic-improvement',
      passed: !result.report.monotonicityViolation,
      gateAction: result.report.monotonicityViolation ? 'block' : result.report.status === 'skip' ? 'warn' : 'pass',
      violations,
      summary: result.report.reason,
      wallSeconds: wall,
      degraded: false
    };
  } catch (error) {
    const wall = (Date.now() - started) / 1000;
    return {
      kind: 'monotonic-improvement',
      passed: false,
      gateAction: 'warn',
      violations: [{
        severity: 'MED',
        file: '<loop>',
        line: 0,
        hint: `runMonotonicCheck threw: ${error instanceof Error ? error.message : String(error)}`
      }],
      summary: 'monotonic-improvement: dispatcher error',
      wallSeconds: wall,
      degraded: true
    };
  }
}

// ─── envelope parsers (pure, never throw) ──────────────────────────────

function gateActionFromVerdict(verdict: string): 'pass' | 'warn' | 'block' {
  if (verdict === 'pass' || verdict === 'warn' || verdict === 'block') return verdict;
  return 'warn';
}

function parseKarpathyEnvelope(stdout: string, exitCode: number, started: number): EvaluatorVerdictEnvelope {
  const wall = (Date.now() - started) / 1000;
  const parsed = safeJson(stdout);
  if (!parsed.ok) {
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
  const obj = parsed.value as Record<string, unknown>;
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
  if (!parsed.ok) {
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
  const obj = parsed.value as Record<string, unknown>;
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
  if (!parsed.ok) {
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
  const obj = parsed.value as Record<string, unknown>;
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
  if (!parsed.ok) {
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
  const obj = parsed.value as Record<string, unknown>;
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

/** Discriminated result for safeJson — callers can branch on `ok` instead of
 *  guessing whether a `null` return means "no input" vs "bad JSON". */
type LoadResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: 'PARSE_ERROR' };

function safeJson(raw: string): LoadResult<unknown> {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, reason: 'PARSE_ERROR' };
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, reason: 'PARSE_ERROR' };
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