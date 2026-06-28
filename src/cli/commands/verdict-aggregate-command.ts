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
        // v2.13.3 AC-1: use the canonical markdown-aware parser from
        // envelopes.ts. The old inline `parseSecurityFromMarkdown`
        // only understood shape A (`- [SEV] dim @ file:line — hint`),
        // so real dogfood fixtures using shape B (`- HIGH: hint in file:line`)
        // returned `verdict: warn, violations: []` — the aggregator
        // then produced `reasons: []` and `verdict: 'pass'` even when
        // the audit had flagged HIGH violations.
        security: readAudit(projectRoot, sid, SECURITY_REL, parseSecurityEnvelope),
        perf: readAudit(projectRoot, sid, PERF_REL, parsePerfEnvelope),
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
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
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

function parseMutJson(json: unknown): ReturnType<typeof parseMutEnvelope> {
  return parseMutEnvelope(json);
}

// v2.13.3 AC-1: removed inline `parseSecurityFromMarkdown` /
// `parsePerfFromMarkdown` (only handled shape A). The canonical
// `parseSecurityEnvelope` / `parsePerfEnvelope` in envelopes.ts now
// own the markdown parse + JSON back-compat fallback.