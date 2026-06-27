/**
 * v2.13.2 AC-2 — `peaks verdict aggregate` CLI surface.
 *
 * Reads the 5 envelope sources under `.peaks/_runtime/<sid>/` for a
 * given rid, runs `aggregateVerdict()`, and prints the verdict +
 * reasons JSON envelope. Used by peaks-solo / peaks-final-review to
 * cross-check the slice-level verdict without booting the full
 * 5-skill fanout.
 *
 * File budget: ≤ 150 lines (Karpathy §2).
 */
import { Command } from 'commander';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { aggregateVerdict } from '../../services/verdict/verdict-aggregator.js';
import {
  parseKarpathyEnvelope,
  parseMutEnvelope,
  parseQaEnvelope,
  parseSecurityEnvelope,
  parsePerfEnvelope,
  envelopesToAggregatorInput,
  type AnyEnvelope
} from '../../services/verdict/envelopes.js';
import { loadMutReport } from '../../services/mut/report-loader.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from '../../shared/result.js';

type AggregateOptions = {
  fromRid?: string;
  sid?: string;
  project?: string;
  json?: boolean;
};

const SECURITY_REL = 'audit/security.md';
const PERF_REL = 'audit/perf.md';
const KARPATHY_REL = 'rd/karpathy-review.md';
const MUT_REL = 'mut/mut-report.json';
const QA_REL = 'qa/test-reports';

export function registerVerdictAggregateCommands(program: Command, io: ProgramIO): void {
  const verdict = program.command('verdict').description('Aggregate the 5 envelope sources feeding peaks-solo verdict logic');

  addJsonOption(
    verdict
      .command('aggregate')
      .description('Aggregate 5 envelope sources (security / perf / karpathy / mut / qa) and print the verdict + reasons JSON envelope. Used by peaks-solo and peaks-final-review.')
      .requiredOption('--from-rid <rid>', 'request id, e.g. 2026-06-27-...')
      .option('--sid <sid>', 'session id, e.g. 2026-06-27-session-...; default: project default')
      .option('--project <path>', 'project root (default: cwd)')
  ).action(async (options: AggregateOptions) => {
    const projectRoot = options.project ?? process.cwd();
    const sid = options.sid ?? 'default';
    const rid = options.fromRid;
    if (rid === undefined || rid.length === 0) {
      printResult(io, fail('verdict.aggregate', 'RID_REQUIRED', '--from-rid is required', {}, ['Re-run with --from-rid <rid>']), options.json);
      process.exitCode = 1;
      return;
    }

    try {
      const sources = {
        security: readAudit(projectRoot, sid, SECURITY_REL, parseSecurityFromMarkdown),
        perf: readAudit(projectRoot, sid, PERF_REL, parsePerfFromMarkdown),
        karpathy: readAudit(projectRoot, sid, KARPATHY_REL, (m) => parseKarpathyEnvelope(m)),
        mut: await readMut(projectRoot, sid),
        qa: readQa(projectRoot, sid, rid)
      };
      const input = envelopesToAggregatorInput([
        sources.security !== null ? { kind: 'security' as const, envelope: sources.security } : null,
        sources.perf !== null ? { kind: 'perf' as const, envelope: sources.perf } : null,
        sources.karpathy !== null ? { kind: 'karpathy' as const, envelope: sources.karpathy } : null,
        sources.mut !== null ? { kind: 'mut' as const, envelope: sources.mut } : null,
        sources.qa !== null ? { kind: 'qa' as const, envelope: sources.qa } : null
      ]);
      const result = aggregateVerdict(input);
      const sourceFlags = {
        security: sources.security !== null ? 'present' : 'missing',
        perf: sources.perf !== null ? 'present' : 'missing',
        karpathy: sources.karpathy !== null ? 'present' : 'missing',
        mut: sources.mut !== null ? 'present' : 'missing',
        qa: sources.qa !== null ? 'present' : 'missing'
      } as const;
      printResult(
        io,
        ok('verdict.aggregate', { verdict: result.verdict, reasons: result.reasons, sources: sourceFlags }, [], []),
        options.json
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      printResult(io, fail('verdict.aggregate', 'AGGREGATE_FAILED', message, {}, ['Verify the rid/sid/project are correct']), options.json);
      process.exitCode = 1;
    }
  });
}

// ─── envelope readers (markdown-formatted audits) ──────────────────────

type AuditParser<T> = (md: string) => T | null;

function readAudit<T>(
  projectRoot: string,
  sid: string,
  rel: string,
  parse: AuditParser<T>
): T | null {
  const path = join(projectRoot, '.peaks', '_runtime', sid, rel);
  if (!existsSync(path)) return null;
  const md = readFileSync(path, 'utf8');
  return parse(md);
}

async function readMut(projectRoot: string, sid: string): Promise<ReturnType<typeof parseMutJson>> {
  const path = join(projectRoot, '.peaks', '_runtime', sid, MUT_REL);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  return parseMutJson(json);
}

function readQa(projectRoot: string, sid: string, rid: string): ReturnType<typeof parseQaEnvelope> {
  const dir = join(projectRoot, '.peaks', '_runtime', sid, QA_REL);
  const candidates = [`${rid}.md`, `001-${rid}.md`];
  for (const name of candidates) {
    const path = join(dir, name);
    if (existsSync(path)) {
      const md = readFileSync(path, 'utf8');
      return parseQaEnvelope(md);
    }
  }
  return null;
}

function parseSecurityFromMarkdown(md: string): ReturnType<typeof parseSecurityEnvelope> {
  const verdictMatch = md.match(/^verdict\s*:\s*(pass|warn|block)\s*$/m);
  if (verdictMatch === null) return null;
  type V = { dimension: string; severity: 'CRITICAL' | 'HIGH' | 'MED' | 'LOW'; file: string; line: number; hint: string };
  const violations: V[] = [];
  // Best-effort parse of the Findings section. Bullet format: - [SEV] dim @ file:line — hint
  const section = md.split(/^##\s+Findings\s*$/m)[1] ?? '';
  const bullets = section.split('\n').filter((l) => l.trim().startsWith('- ['));
  for (const bullet of bullets) {
    const m = bullet.match(/^\s*-\s*\[(CRITICAL|HIGH|MED|LOW)\]\s+(\S+)\s+@\s+([^:]+):(\d+)\s+[—-]\s+(.+)$/);
    if (m === null) continue;
    const [, severity, dimension, file, line, hint] = m;
    if (severity === undefined || dimension === undefined || file === undefined || line === undefined || hint === undefined) continue;
    violations.push({ dimension, severity: severity as V['severity'], file, line: parseInt(line, 10), hint: hint.trim() });
  }
  return {
    verdict: verdictMatch[1] as 'pass' | 'warn' | 'block',
    violations,
    summary: ''
  };
}

function parsePerfFromMarkdown(md: string): ReturnType<typeof parsePerfEnvelope> {
  return parseSecurityFromMarkdown(md);
}

function parseMutJson(json: unknown): ReturnType<typeof parseMutEnvelope> {
  return parseMutEnvelope(json);
}