/**
 * Audit decision writer — Slice K1.
 *
 * Persists a `RedLineAudit` snapshot to `.peaks/memory/audit-decisions/<slug>.md`
 * so the audit is searchable / indexable by the existing project-memory
 * machinery (`peaks memory search`, `peaks project memories`).
 *
 * Locked decisions (K1 design, user-approved):
 *
 * 1. **No `context` field** in the persisted record. `RedLineSource.context`
 *    is the ±2 lines of raw markdown used only by `backing-detector.ts`
 *    (`detectPartial(entry.source.context)`) to classify the entry as
 *    partial / cli-backed / prose-only. It is an *intermediate artifact* —
 *    once the audit runs, the classification result is captured by
 *    `RedLineEntry.backing` and the raw context has no consumer. We
 *    intentionally do not write `context` to the decision record (no
 *    caller reads it; persisting it would just bloat the file).
 *
 * 2. **Path is `.peaks/memory/audit-decisions/`, NOT `_runtime/`** — the
 *    decision is git-tracked source-of-truth (project memory), not session
 *    ephemeral state. The subdir is named for human discoverability; the
 *    memory service's recursive scan picks it up automatically.
 *
 * 3. **No new CLI subcommand.** Per `peaks-cli-when-adding-a-new-subcommand-…`
 *    we extend the existing `peaks audit static` with a `--record` flag
 *    instead of adding `peaks audit record` (which would be a new
 *    top-level shape and conflict with the dev-preference red line
 *    "Default-no on new CLI commands").
 *
 * 4. **Memory index auto-regen.** Writing the file does not directly
 *    manipulate `.peaks/memory/index.json`. The `peaks project memories`
 *    reader uses mtime-based regeneration; the new file's mtime being
 *    newer than `index.json` triggers regeneration on next read.
 *    `readMemoryIndex()` is called eagerly here so the caller sees a
 *    `hot.decision[]` update synchronously with the write.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RedLineAudit } from './types.js';
import { readMemoryIndex } from '../memory/project-memory-service.js';

const SLUG_PREFIX = 'audit-decision';
const SUBDIR = 'audit-decisions';

export interface AuditDecisionOptions {
  readonly projectRoot: string;
  /** ISO date (YYYY-MM-DD). Defaults to today (UTC). */
  readonly date?: string;
  /** Optional request id, used to disambiguate multiple audits on the same day. */
  readonly rid?: string;
}

export interface AuditDecisionRecord {
  readonly name: string;
  readonly title: string;
  readonly date: string;
  readonly filePath: string;
  readonly memoryDir: string;
  readonly indexPath: string;
  readonly totalRedLines: number;
  readonly cliBacked: number;
  readonly partial: number;
  readonly proseOnly: number;
  readonly enforcerFailures: number;
  readonly enforcerWarnings: number;
  readonly enforcerPasses: number;
  readonly indexSynced: boolean;
}

function defaultDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Defense-in-depth (R6 audit): validate YYYY-MM-DD format before the date
 *  is embedded in a filename, title, or description. Throws on bad input
 *  so callers fail loudly rather than silently writing unsafe files. */
function sanitizeDate(date: string | undefined): string {
  if (date === undefined) return defaultDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid date "${date}": must be YYYY-MM-DD format`);
  }
  return date;
}

/** Strip everything outside `[A-Za-z0-9-]` and cap length so the slug
 *  stays filename-safe regardless of the user's `--rid` input. */
function sanitizeRid(rid: string | undefined): string {
  if (!rid) return '';
  const cleaned = rid.replace(/[^A-Za-z0-9-]/g, '');
  return cleaned.length > 0 ? cleaned.slice(0, 64) : '';
}

function buildSlug(date: string, rid: string | undefined): string {
  const safe = sanitizeRid(rid);
  return safe ? `${SLUG_PREFIX}-${date}-${safe}` : `${SLUG_PREFIX}-${date}`;
}

function buildTitle(date: string, rid: string | undefined): string {
  return rid ? `Audit Decision ${date} (${rid})` : `Audit Decision ${date}`;
}

function buildDescription(date: string, audit: RedLineAudit, rid: string | undefined): string {
  const prefix = rid ? `Audit Decision ${date} (${rid})` : `Audit Decision ${date}`;
  const failures = audit.enforcerFindings.filter((f) => f.severity === 'fail').length;
  return `${prefix} — Red-line audit: ${audit.totalRedLines} total / ${audit.cliBacked} cli-backed / ${audit.partial} partial / ${audit.proseOnly} prose-only; ${failures} enforcer failures.`;
}

function severityCounts(findings: RedLineAudit['enforcerFindings']): { fail: number; warn: number; pass: number } {
  let fail = 0;
  let warn = 0;
  let pass = 0;
  for (const finding of findings) {
    if (finding.severity === 'fail') fail += 1;
    else if (finding.severity === 'warn') warn += 1;
    else pass += 1;
  }
  return { fail, warn, pass };
}

/**
 * Pure: render the decision markdown body. No I/O. Used by both the
 * writer and the test suite for byte-exact assertions.
 */
export function renderDecisionMarkdown(audit: RedLineAudit, options: { date: string; rid?: string }): string {
  const { rid } = options;
  const date = sanitizeDate(options.date);
  const slug = buildSlug(date, rid);
  const title = buildTitle(date, rid);
  const description = buildDescription(date, audit, rid);
  const sev = severityCounts(audit.enforcerFindings);

  const frontmatter = [
    '---',
    `name: ${slug}`,
    `description: ${description}`,
    'metadata:',
    '  type: decision',
    '  auditType: red-lines',
    `  totalRedLines: ${audit.totalRedLines}`,
    `  cliBacked: ${audit.cliBacked}`,
    `  partial: ${audit.partial}`,
    `  proseOnly: ${audit.proseOnly}`,
    `  enforcerFailures: ${sev.fail}`,
    `  enforcerWarnings: ${sev.warn}`,
    `  enforcerPasses: ${sev.pass}`,
    `  sourceArtifact: peaks audit static --record`,
    `  createdAt: ${date}`,
    '---'
  ].join('\n');

  const summaryTable = [
    '| Metric | Count |',
    '| --- | --- |',
    `| Total red lines | ${audit.totalRedLines} |`,
    `| CLI-backed | ${audit.cliBacked} |`,
    `| Partial | ${audit.partial} |`,
    `| Prose-only | ${audit.proseOnly} |`,
    `| Enforcer findings (pass / warn / fail) | ${sev.pass} / ${sev.warn} / ${sev.fail} |`
  ].join('\n');

  const ruleSection = renderPerRuleSection(audit);
  const enforcerSection = renderEnforcerSection(audit.enforcerFindings);

  const body = [
    `# ${title}`,
    '',
    `Audit run: \`peaks audit static --record\` on **${date}**${rid ? ` (rid: \`${rid}\`)` : ''}.`,
    '',
    '## Summary',
    '',
    summaryTable,
    '',
    '## Per-Rule Decisions',
    '',
    ruleSection,
    '## Enforcer Findings',
    '',
    enforcerSection
  ].join('\n');

  return `${frontmatter}\n\n${body}\n`;
}

function renderPerRuleSection(audit: RedLineAudit): string {
  if (audit.audit.length === 0) {
    return '_No red lines discovered._\n';
  }
  const header = '| ID | Rule | Backing | File | Line | Marker | Enforcer |';
  const sep = '| --- | --- | --- | --- | ---: | --- | --- |';
  const rows = audit.audit.map((entry) => {
    const enforcer = entry.enforcerRef ?? '_(none)_';
    return `| \`${entry.id}\` | ${entry.rule} | ${entry.backing} | \`${entry.source.file}\` | ${entry.source.line} | ${entry.source.marker} | \`${enforcer}\` |`;
  });
  return [header, sep, ...rows].join('\n') + '\n';
}

function renderEnforcerSection(findings: RedLineAudit['enforcerFindings']): string {
  if (findings.length === 0) {
    return '_No enforcer findings._\n';
  }
  const header = '| Enforcer | Rule | Severity | File | Detail |';
  const sep = '| --- | --- | --- | --- | --- |';
  const rows = findings.map((finding) => {
    const detail = finding.detail.replace(/\|/g, '\\|').replace(/\n/g, ' ');
    return `| \`${finding.enforcerId}\` | ${finding.rule} | **${finding.severity}** | \`${finding.file}\` | ${detail} |`;
  });
  return [header, sep, ...rows].join('\n') + '\n';
}

/**
 * Persist the audit as a project-memory decision. Idempotent only at the
 * file level — repeated calls with the same `(date, rid)` pair will overwrite
 * the previous decision markdown (the slug collides, the older file is
 * replaced). This matches the "one audit run = one decision record" model.
 */
export function writeAuditDecision(audit: RedLineAudit, options: AuditDecisionOptions): AuditDecisionRecord {
  const date = sanitizeDate(options.date);
  const slug = buildSlug(date, options.rid);
  const memoryDir = join(options.projectRoot, '.peaks', 'memory');
  const decisionDir = join(memoryDir, SUBDIR);
  const filePath = join(decisionDir, `${slug}.md`);
  const markdown = renderDecisionMarkdown(audit, options.rid ? { date, rid: options.rid } : { date });

  mkdirSync(decisionDir, { recursive: true });
  writeFileSync(filePath, markdown, { mode: 0o644 });

  // Eagerly trigger index regeneration. The reader's mtime check will see
  // filePath.mtime > index.json.mtime and call generateMemoryIndexFile();
  // the new decision then lands in `hot.decision[]` and is searchable via
  // `peaks memory search` / `peaks project memories`.
  const index = readMemoryIndex(options.projectRoot);
  const indexPath = join(memoryDir, 'index.json');

  const sev = severityCounts(audit.enforcerFindings);
  return {
    name: slug,
    title: buildTitle(date, options.rid),
    date,
    filePath,
    memoryDir,
    indexPath,
    totalRedLines: audit.totalRedLines,
    cliBacked: audit.cliBacked,
    partial: audit.partial,
    proseOnly: audit.proseOnly,
    enforcerFailures: sev.fail,
    enforcerWarnings: sev.warn,
    enforcerPasses: sev.pass,
    indexSynced: index !== null
  };
}