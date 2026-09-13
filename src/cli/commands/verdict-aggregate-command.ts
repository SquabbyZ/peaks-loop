/**
 * v2.13.2 AC-2 — `peaks verdict aggregate` CLI surface.
 *
 * Reads the 5 envelope sources under `.peaks/_runtime/<sid>/` for a
 * given rid, runs `aggregateVerdict()`, and prints the verdict +
 * reasons JSON envelope. Used by peaks-code / peaks-final-review to
 * cross-check the slice-level verdict without booting the full
 * 5-skill fanout.
 *
 * File budget: ≤ 150 lines (Karpathy §2).
 */
import { Command } from 'commander';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { aggregateVerdict, type VerdictReason, type VerdictSource } from '../../services/verdict/verdict-aggregator.js';
import {
  parseKarpathyEnvelope,
  parseMutEnvelope,
  parseQaEnvelope,
  parseSecurityEnvelope,
  parsePerfEnvelope,
  envelopesToAggregatorInput,
  type AnyEnvelope
} from '../../services/verdict/envelopes.js';
import { loadMutReport } from 'peaks-loop-mut';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { isUnsafePathInput } from '../../shared/path-safety.js';
import { DEFAULT_REQUEST_TYPE } from '../../services/artifacts/artifact-prerequisites.js';
import { REQUEST_ID_PATTERN } from '../../services/artifacts/request-artifact-service.js';
import { contractEvidencePaths } from '../../services/workflow/pipeline-verify-gate-support.js';

type AggregateOptions = {
  fromRid?: string;
  sid?: string;
  project?: string;
  json?: boolean;
};

// Slice `2026-09-14-audit-artifact-rid-scoping`: the audit/review evidence
// filenames carry the rid. The ridless names are the pre-rid locations and
// stay readable during the back-compat window. `mut/` is NOT rid-scoped —
// see `MUT_REPORT` in `artifact-prerequisites.ts`: no producer in the repo
// can write a rid-scoped mut report, so probing a templated name here would
// look for a file that no writer can create.
//
// The candidate lists are read FROM the contract — the same
// `contractEvidencePaths()` the verify pipeline resolves with — rather than
// hand-written here. Hand-written lists held two of the contract's THREE
// tiers, so a session whose security/perf evidence sits at the oldest tier
// (`rd/security-review.md`, `rd/perf-baseline.md` — the live shape of three
// sessions on disk) reported `block` while `peaks request transition`
// accepted the same tree, and the hint named a legacy location it had never
// probed. One table, one answer.
const MUT_REL = 'mut/mut-report.json';
const QA_REL = 'qa/test-reports';

/**
 * The declared tiers for one artifact name, primary first. Probed by the name
 * this command used before the rid-scoping (the table matches it as either
 * the primary or a legacy tier), so the lookup survives the primary moving.
 * `verdict aggregate` is request-type-agnostic and every fanout-trigger type
 * declares these artifacts identically, so the default type's list is the
 * full one; a name the table does not carry falls back to itself.
 */
function contractRels(probeName: string): string[] {
  return contractEvidencePaths('rd', 'qa-handoff', DEFAULT_REQUEST_TYPE, probeName) ?? [probeName];
}

const SECURITY_RELS = contractRels('audit/security.md');
const PERF_RELS = contractRels('audit/perf.md');
const KARPATHY_RELS = contractRels('rd/karpathy-review.md');

/**
 * Sources whose absence must not read as `pass`. `mut` is excluded on
 * purpose: `MUT_REPORT` carries `backCompat: true`, so the contract itself
 * treats a missing mut report as a warning rather than a gate failure.
 */
const REQUIRED_SOURCES: ReadonlyArray<{
  key: 'security' | 'perf' | 'karpathy';
  source: VerdictSource;
  rels: ReadonlyArray<string>;
}> = [
  { key: 'security', source: 'security-audit', rels: SECURITY_RELS },
  { key: 'perf', source: 'perf-audit', rels: PERF_RELS },
  { key: 'karpathy', source: 'karpathy-reviewer', rels: KARPATHY_RELS }
];

export function registerVerdictAggregateCommands(program: Command, io: ProgramIO): void {
  const verdict = program.command('verdict').description('Aggregate the 5 envelope sources feeding peaks-code verdict logic');

  addJsonOption(
    verdict
      .command('aggregate')
      .description('Aggregate 5 envelope sources (security / perf / karpathy / mut / qa) and print the verdict + reasons JSON envelope. Used by peaks-code and peaks-final-review.')
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
    // The rid SELECTS THE FILE, so it has to be one path segment. This is the
    // repo's own request-id guard — the one `request-artifact-service.ts`
    // applies to every request artifact and the reason `peaks workflow
    // verify-pipeline` refuses a hostile rid — and it was not applied to the
    // joins below. Measured before it was: `--from-rid
    // '../../../../../../ONLY-HERE'` read `<project>/ONLY-HERE.md`, a file
    // outside `.peaks/`, as this slice's security AND perf evidence.
    if (!REQUEST_ID_PATTERN.test(rid)) {
      printResult(
        io,
        fail('verdict.aggregate', 'RID_INVALID', `Invalid request id: ${rid} (expected letters, digits, dots, underscores, or dashes)`, {}, ['Pass the rid of the slice whose evidence you want aggregated, e.g. 2026-09-14-some-slug']),
        options.json
      );
      process.exitCode = 1;
      return;
    }
    // `--sid` names the session DIRECTORY and is the same axis. Reject
    // anything that is not one safe path segment rather than pinning a
    // format: the default here is the deliberately non-format value
    // `default`.
    if (isUnsafePathInput(sid)) {
      printResult(
        io,
        fail('verdict.aggregate', 'SID_INVALID', `Invalid session id: ${sid} (must be a single path segment)`, {}, ['Pass the session id, e.g. 2026-09-14-session-abc123']),
        options.json
      );
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
        security: readAudit(projectRoot, sid, rid, SECURITY_RELS, parseSecurityEnvelope),
        perf: readAudit(projectRoot, sid, rid, PERF_RELS, parsePerfEnvelope),
        karpathy: readAudit(projectRoot, sid, rid, KARPATHY_RELS, (m) => parseKarpathyEnvelope(m)),
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
      // Fail closed. `aggregateVerdict()` starts its top-level verdict at
      // `'pass'`, so a source that could not be read simply never enters the
      // input and the run reports green. Before this slice the bare paths
      // were the ones the writers wrote; after it the writers moved and this
      // reader did not — so a missing security or perf audit became a `pass`
      // for the loop evaluator (`services/loop/evaluator-dispatcher.ts`). A
      // guard that cannot read its input must not report success.
      const missingRequired = REQUIRED_SOURCES.filter((entry) => sources[entry.key] === null);
      const missingReasons: VerdictReason[] = missingRequired.map((entry) => ({
        source: entry.source,
        sources: [entry.source],
        signal: 'block' as const,
        kind: 'missing-evidence',
        hint: `${entry.rels.map((rel) => rel.replace('<rid>', rid)).join(' | ')} could not be read under .peaks/_runtime/${sid}/`
      }));
      printResult(
        io,
        ok(
          'verdict.aggregate',
          {
            verdict: missingReasons.length > 0 ? 'block' : result.verdict,
            reasons: [...missingReasons, ...result.reasons],
            sources: sourceFlags
          },
          [],
          []
        ),
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
  rid: string,
  rels: ReadonlyArray<string>,
  parse: AuditParser<T>
): T | null {
  // Canonical rid-scoped location first, then the pre-rid locations.
  for (const rel of rels) {
    const path = join(projectRoot, '.peaks', '_runtime', sid, rel.replace('<rid>', rid));
    if (existsSync(path)) return parse(readFileSync(path, 'utf8'));
  }
  return null;
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