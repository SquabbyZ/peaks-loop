/**
 * peaks-prd project-scan sediment writer — v2.11.0 D3 (Group C, Tier 5) +
 * v2.12.0 Group C Tier 6 (audit inventory sediment).
 *
 * Appends new business concepts to
 * `.peaks/project-scan/business-knowledge.md` AND new audit-inventory
 * rows to the three v2.12.0 audit templates (security-template.md /
 * perf-template.md / audit-output-schema.md). Idempotent on the
 * `(concept, sourceRid)` tuple for `appendBusinessConcept` and on the
 * `(value, sourceRid)` tuple for the three audit-inventory appenders —
 * re-running with the same input does not duplicate.
 *
 * The on-disk format mirrors the bootstrap templates: a YAML
 * frontmatter carrying `schemaVersion: 1` (with `templateKind` for the
 * audit templates) plus a markdown table in the body whose rows are the
 * sediment tuples. The table format is human-readable (grep-friendly).
 *
 * The audit-template tables are **append-only inventories** (slice
 * v2.12.0 audit-template design): the `#` column is auto-incremented,
 * the body of the file is not re-rendered wholesale — the writer
 * locates the placeholder row `| (empty) |` and replaces it with the
 * first real row, then appends subsequent rows after the table.
 *
 * Companion to `project-scan-reader.ts`. The reader and the writer
 * agree on the same on-disk format for `business-knowledge.md`. The
 * three audit-inventory writers preserve the frontmatter verbatim and
 * use a generic internal row parser (not a typed reader) — those
 * tables are write-mostly and not consumed by `readBusinessKnowledge`.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { BusinessConcept, BusinessKnowledge } from './project-scan-types.js';
import { readBusinessKnowledge } from './project-scan-reader.js';

const BUSINESS_KNOWLEDGE_RELATIVE = join(
  '.peaks',
  'project-scan',
  'business-knowledge.md'
);

const SECURITY_TEMPLATE_RELATIVE = join(
  '.peaks',
  'project-scan',
  'security-template.md'
);
const PERF_TEMPLATE_RELATIVE = join(
  '.peaks',
  'project-scan',
  'perf-template.md'
);
const AUDIT_OUTPUT_SCHEMA_RELATIVE = join(
  '.peaks',
  'project-scan',
  'audit-output-schema.md'
);

export interface SedimentAppendOptions {
  readonly projectRoot: string;
  readonly concept: BusinessConcept;
}

export interface SedimentAppendResult {
  /** `true` when the file was rewritten; `false` when the (concept, sourceRid) tuple was already present. */
  readonly written: boolean;
  /** `true` when a new file was created (vs. appended to an existing file). */
  readonly created: boolean;
  /** Total concept rows after the operation. */
  readonly totalConcepts: number;
}

/**
 * Single row of the audit-template inventory tables. The 4-tuple shape
 * mirrors the table layout in `.peaks/project-scan/{security-template,
 * perf-template, audit-output-schema}.md`:
 *
 *   security-template.md  Known risks inventory    Risk pattern
 *   perf-template.md      Known baselines inventory Baseline description
 *   audit-output-schema.md Known schema variants    Variant description
 *
 * The `status` enum follows each template's own status vocabulary:
 *   - security:   active | mitigated | accepted | deprecated
 *   - perf:       active | superseded | deprecated
 *   - audit-schema: active | superseded | deprecated
 *
 * Callers pass the field set appropriate for the table they're
 * appending to; the writer does not enforce which `status` values are
 * legal (the audit skill that wrote the row is authoritative).
 */
export interface AuditPatternRow {
  /** Natural-language description of the pattern (the second column). */
  readonly value: string;
  /** Request-id that first surfaced / established the pattern. */
  readonly sourceRid: string;
  /** Human-readable source pointer (e.g. memory file path). */
  readonly source: string;
  /** Status enum value (template-specific — see docstring above). */
  readonly status: string;
}

export interface AuditPatternAppendOptions {
  readonly projectRoot: string;
  readonly row: AuditPatternRow;
}

export interface AuditPatternAppendResult {
  /** `true` when the file was rewritten; `false` when the (value, sourceRid) tuple was already present. */
  readonly written: boolean;
  /** `true` when a new file was created (vs. appended to an existing file). */
  readonly created: boolean;
  /** Auto-incremented row number assigned to the new row. */
  readonly assignedIndex: number;
  /** Total inventory rows after the operation (excludes the placeholder `| (empty) |` row). */
  readonly totalRows: number;
}

/**
 * Append (or create) a business concept row in
 * `.peaks/project-scan/business-knowledge.md`.
 *
 * Idempotency contract (matches the bootstrap file's design intent):
 * - same `(concept, sourceRid)` tuple → skip (return `written: false`)
 * - same `concept`, DIFFERENT `sourceRid` → append (re-definition from a new source)
 * - new concept → append
 *
 * Throws when the existing file has malformed frontmatter or markdown
 * table (no silent corruption). Caller should fix the file before retrying.
 */
export async function appendBusinessConcept(
  opts: SedimentAppendOptions
): Promise<SedimentAppendResult> {
  const existing = await readBusinessKnowledge(opts.projectRoot);
  const absolutePath = join(opts.projectRoot, BUSINESS_KNOWLEDGE_RELATIVE);

  if (existing === null) {
    const fresh: BusinessKnowledge = {
      schemaVersion: 1,
      concepts: [opts.concept]
    };
    await writeBusinessKnowledgeFile(absolutePath, fresh);
    return { written: true, created: true, totalConcepts: 1 };
  }

  const duplicateIndex = existing.concepts.findIndex(
    (c) => c.concept === opts.concept.concept && c.sourceRid === opts.concept.sourceRid
  );
  if (duplicateIndex >= 0) {
    return {
      written: false,
      created: false,
      totalConcepts: existing.concepts.length
    };
  }

  const updated: BusinessKnowledge = {
    schemaVersion: 1,
    concepts: [...existing.concepts, opts.concept]
  };
  await writeBusinessKnowledgeFile(absolutePath, updated);
  return {
    written: true,
    created: false,
    totalConcepts: updated.concepts.length
  };
}

// ── internal helpers ─────────────────────────────────────────────────

async function writeBusinessKnowledgeFile(
  absolutePath: string,
  knowledge: BusinessKnowledge
): Promise<void> {
  await mkdir(dirname(absolutePath), { recursive: true });
  const body = renderBusinessKnowledgeBody(knowledge);
  await writeFile(absolutePath, body, 'utf8');
}

/**
 * Append (or create) a security-audit risk-pattern row in
 * `.peaks/project-scan/security-template.md` "Known risks inventory".
 *
 * The on-disk format is a 5-column markdown table (auto-incremented `#`
 * + 4 string fields). Idempotency: same `(value, sourceRid)` tuple is a
 * no-op; the frontmatter is preserved verbatim. The first append replaces
 * the `| (empty) |` placeholder row; subsequent appends go after the
 * table footer.
 */
export async function appendSecurityPattern(
  opts: AuditPatternAppendOptions
): Promise<AuditPatternAppendResult> {
  return appendAuditPatternInventory({
    projectRoot: opts.projectRoot,
    relativePath: SECURITY_TEMPLATE_RELATIVE,
    templateKind: 'security-audit',
    tableHeading: 'Known risks inventory',
    columnHeader: 'Risk pattern',
    row: opts.row
  });
}

/**
 * Append (or create) a perf-audit baseline row in
 * `.peaks/project-scan/perf-template.md` "Known baselines inventory".
 *
 * Same contract as `appendSecurityPattern` (5-column markdown table,
 * auto-incremented `#`, idempotent on `(value, sourceRid)`,
 * frontmatter preserved verbatim).
 */
export async function appendPerfPattern(
  opts: AuditPatternAppendOptions
): Promise<AuditPatternAppendResult> {
  return appendAuditPatternInventory({
    projectRoot: opts.projectRoot,
    relativePath: PERF_TEMPLATE_RELATIVE,
    templateKind: 'perf-audit',
    tableHeading: 'Known baselines inventory',
    columnHeader: 'Baseline',
    row: opts.row
  });
}

/**
 * Append (or create) an audit-output-schema variant row in
 * `.peaks/project-scan/audit-output-schema.md` "Known schema variants".
 *
 * Same contract as `appendSecurityPattern` (5-column markdown table,
 * auto-incremented `#`, idempotent on `(value, sourceRid)`,
 * frontmatter preserved verbatim).
 */
export async function appendAuditSchemaVariant(
  opts: AuditPatternAppendOptions
): Promise<AuditPatternAppendResult> {
  return appendAuditPatternInventory({
    projectRoot: opts.projectRoot,
    relativePath: AUDIT_OUTPUT_SCHEMA_RELATIVE,
    templateKind: 'audit-output-schema',
    tableHeading: 'Known schema variants',
    columnHeader: 'Variant',
    row: opts.row
  });
}

// ── internal helpers (audit-inventory sediment) ──────────────────────

interface AppendAuditPatternArgs {
  readonly projectRoot: string;
  readonly relativePath: string;
  /**
   * The `templateKind` value to emit in the frontmatter on fresh-file
   * create. Must match the on-disk bootstrap shape (the audit
   * templates are git-tracked and use `security-audit` / `perf-audit`
   * as the `templateKind` value, NOT `security-template` /
   * `perf-template`).
   */
  readonly templateKind: 'security-audit' | 'perf-audit' | 'audit-output-schema';
  readonly tableHeading: string;
  readonly columnHeader: string;
  readonly row: AuditPatternRow;
}

/**
 * Generic 5-column inventory-table appender shared by the 3 audit
 * sediment operations. The on-disk shape is:
 *
 *   ---
 *   schemaVersion: 1
 *   templateKind: <templateKind>
 *   capturedAt: <ISO 8601>
 *   appliesTo: <skill id list>
 *   ---
 *
 *   # <title>
 *
 *   ... preamble ...
 *
 *   ## <tableHeading>
 *
 *   | # | <columnHeader> | First introduced (rid) | Source | Status |
 *   |---|---|---|---|---|
 *   | (empty) | — | — | — | — |   ← bootstrap placeholder
 *
 *   ... post-table prose ...
 *
 * On append:
 *  1. If the file is absent, write a fresh bootstrap with a single
 *     `| 1 | <row> | ... |` row (replacing the placeholder).
 *  2. If a row with the same `(value, sourceRid)` tuple already exists,
 *     return `written: false` (idempotent no-op).
 *  3. Otherwise:
 *     - if the placeholder `| (empty) |` row is present, replace it
 *       with the new row using the next auto-incremented index
 *       (1, unless other rows already exist);
 *     - if the placeholder is absent (i.e. the table has prior rows),
 *       append the new row after the last table line.
 *
 * The frontmatter and the surrounding prose are preserved verbatim.
 * Cell escaping mirrors the existing `appendBusinessConcept` policy
 * (pipe → `\|`, newline → space).
 */
async function appendAuditPatternInventory(
  args: AppendAuditPatternArgs
): Promise<AuditPatternAppendResult> {
  const absolutePath = join(args.projectRoot, args.relativePath);
  const existing = await readOptionalFile(absolutePath);

  if (existing === null) {
    const freshBody = renderFreshAuditPatternBody(args);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, freshBody, 'utf8');
    return { written: true, created: true, assignedIndex: 1, totalRows: 1 };
  }

  const { openMarker, yaml, closeMarker, body } = splitFrontmatterBlock(existing);
  const parsed = parseAuditInventoryTable(body, args.tableHeading);
  if (parsed === null) {
    // Bootstrap table shape not found — the file was hand-edited or is
    // from a pre-2.12.0 source. We do NOT silently corrupt; the caller
    // (peaks-txt sediment step) is expected to surface this.
    throw new Error(
      `project-scan sediment: ${args.relativePath} is missing the "${args.tableHeading}" table; cannot append`
    );
  }

  // Idempotency check: same (value, sourceRid) tuple already present.
  const duplicateIndex = parsed.rows.findIndex(
    (r) => r.value === args.row.value && r.sourceRid === args.row.sourceRid
  );
  if (duplicateIndex >= 0) {
    return {
      written: false,
      created: false,
      assignedIndex: duplicateIndex + 1,
      totalRows: parsed.rows.length
    };
  }

  const newIndex = parsed.rows.length + 1;
  const newRow: AuditPatternRow = args.row;
  const updatedBody = parsed.hasPlaceholder
    ? replacePlaceholderRow(body, args.tableHeading, {
        index: newIndex,
        row: newRow
      })
    : appendRowAfterTable(body, {
        index: newIndex,
        row: newRow
      });

  const next = `${openMarker}\n${yaml}\n${closeMarker}\n${updatedBody}`;
  await writeFile(absolutePath, next, 'utf8');
  return {
    written: true,
    created: false,
    assignedIndex: newIndex,
    totalRows: parsed.rows.length + 1
  };
}

interface ParsedAuditInventoryTable {
  readonly rows: readonly AuditPatternRow[];
  readonly hasPlaceholder: boolean;
}

interface SplitFrontmatter {
  readonly openMarker: string;
  readonly yaml: string;
  readonly closeMarker: string;
  readonly body: string;
}

function splitFrontmatterBlock(content: string): SplitFrontmatter {
  // The audit templates all start with `---\n...\n---\n` followed by
  // body. We re-emit the frontmatter verbatim (no YAML reparse) so we
  // never lose comments or formatting.
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(content);
  if (!match) {
    throw new Error('project-scan sediment: frontmatter block missing or malformed');
  }
  return {
    openMarker: '---',
    yaml: match[1] ?? '',
    closeMarker: '---',
    body: match[2] ?? ''
  };
}

/**
 * Locate the inventory table under the given heading and return its
 * data rows. Returns `null` when the heading is missing (caller should
 * throw). Recognises the bootstrap `| (empty) |` placeholder row but
 * does NOT include it in the returned `rows` array.
 */
function parseAuditInventoryTable(
  body: string,
  tableHeading: string
): ParsedAuditInventoryTable | null {
  // Find the H2 heading, then walk forward scanning for the table
  // block. The on-disk format includes a `>` blockquote between the
  // heading and the table (e.g. `> This section is **append-only**...`),
  // so the parser must skip non-`|` lines until the first `|` line,
  // then collect until the next non-`|` line.
  const lines = body.split(/\r?\n/);
  let headingLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.trim() === `## ${tableHeading}`) {
      headingLineIdx = i;
      break;
    }
  }
  if (headingLineIdx === -1) {
    return null;
  }
  const tableLines: string[] = [];
  let inTable = false;
  for (let i = headingLineIdx + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^\s*\|/.test(line)) {
      tableLines.push(line);
      inTable = true;
      continue;
    }
    if (inTable) {
      // First non-`|` line after the table starts → table is done.
      break;
    }
    // Otherwise keep scanning past blockquote / blank lines.
  }
  if (tableLines.length < 3) {
    return null;
  }
  // First row = header, second row = separator (---|---|---). Skip both.
  const dataRows = tableLines.slice(2);
  const rows: AuditPatternRow[] = [];
  let hasPlaceholder = false;
  for (const row of dataRows) {
    const cells = splitTableRow(row);
    if (cells.length < 5) continue;
    const [indexCell, value, sourceRid, source, status] = cells;
    if (!indexCell || !value || !sourceRid || !source || !status) continue;
    if (value === '(empty)' || value === '—') {
      hasPlaceholder = true;
      continue;
    }
    rows.push({ value, sourceRid, source, status });
  }
  return { rows, hasPlaceholder };
}

function splitTableRow(row: string): string[] {
  return row
    .split('|')
    .map((cell) => cell.trim())
    .filter((cell, idx, arr) => !(idx === 0 && cell === '') && !(idx === arr.length - 1 && cell === ''));
}

function renderFreshAuditPatternBody(args: AppendAuditPatternArgs): string {
  const titleByKind: Record<AppendAuditPatternArgs['templateKind'], string> = {
    'security-audit': 'Security Audit Template (peaks-loop v2.12.0)',
    'perf-audit': 'Performance Audit Template (peaks-loop v2.12.0)',
    'audit-output-schema': 'Audit Output Schema (peaks-loop v2.12.0)'
  };
  const appliesToByKind: Record<AppendAuditPatternArgs['templateKind'], string> = {
    'security-audit': 'peaks-security-audit skill',
    'perf-audit': 'peaks-perf-audit skill',
    'audit-output-schema': 'peaks-security-audit + peaks-perf-audit'
  };
  return [
    '---',
    'schemaVersion: 1',
    `templateKind: ${args.templateKind}`,
    `capturedAt: 2026-06-27T00:00:00.000Z`,
    `appliesTo: ${appliesToByKind[args.templateKind]}`,
    '---',
    '',
    `# ${titleByKind[args.templateKind]}`,
    '',
    `> **Bootstrap template** for the ${args.tableHeading} table. Appended by \`peaks-txt\` sediment step (v2.12.0 Group C Tier 6).`,
    '',
    `## ${args.tableHeading}`,
    '',
    '> This section is **append-only**. Re-running with the same `(value, sourceRid)` tuple does not duplicate.',
    '',
    `| # | ${args.columnHeader} | First introduced (rid) | Source | Status |`,
    '|---|---|---|---|---|',
    `| 1 | ${escapeCell(args.row.value)} | ${escapeCell(args.row.sourceRid)} | ${escapeCell(args.row.source)} | ${escapeCell(args.row.status)} |`,
    ''
  ].join('\n');
}

function replacePlaceholderRow(
  body: string,
  tableHeading: string,
  args: { index: number; row: AuditPatternRow }
): string {
  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  let headingSeen = false;
  let inTable = false;
  for (const line of lines) {
    if (!headingSeen && line.trim() === `## ${tableHeading}`) {
      headingSeen = true;
      out.push(line);
      continue;
    }
    if (headingSeen && /^\s*\|/.test(line)) {
      // Skip the placeholder row (first data row we see after the
      // separator); emit the new row instead.
      inTable = true;
      out.push(
        `| ${args.index} | ${escapeCell(args.row.value)} | ${escapeCell(args.row.sourceRid)} | ${escapeCell(args.row.source)} | ${escapeCell(args.row.status)} |`
      );
      // Then skip the original placeholder by NOT pushing the current line.
      continue;
    }
    if (inTable) {
      // Past the table — push lines verbatim.
      out.push(line);
    } else {
      out.push(line);
    }
  }
  return out.join('\n');
}

function appendRowAfterTable(
  body: string,
  args: { index: number; row: AuditPatternRow }
): string {
  // Find the last `|`-prefixed line and insert the new row right after it.
  const lines = body.split(/\r?\n/);
  let lastTableLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*\|/.test(lines[i] ?? '')) lastTableLine = i;
  }
  if (lastTableLine === -1) {
    // No table found in body — append the row at the end as a new table
    // tail. (Defensive: parseAuditInventoryTable already guarded this.)
    return (
      body.replace(/\n*$/, '\n') +
      `| ${args.index} | ${escapeCell(args.row.value)} | ${escapeCell(args.row.sourceRid)} | ${escapeCell(args.row.source)} | ${escapeCell(args.row.status)} |\n`
    );
  }
  const newRow = `| ${args.index} | ${escapeCell(args.row.value)} | ${escapeCell(args.row.sourceRid)} | ${escapeCell(args.row.source)} | ${escapeCell(args.row.status)} |`;
  const before = lines.slice(0, lastTableLine + 1);
  const after = lines.slice(lastTableLine + 1);
  return [...before, newRow, ...after].join('\n');
}

async function readOptionalFile(absolutePath: string): Promise<string | null> {
  try {
    return await readFile(absolutePath, 'utf8');
  } catch (error: unknown) {
    if (isEnoent(error)) return null;
    throw error;
  }
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'ENOENT'
  );
}

/** Serialize a `BusinessKnowledge` to the markdown-table body format.
 *  Matches the bootstrap template at `.peaks/project-scan/business-knowledge.md`. */
function renderBusinessKnowledgeBody(knowledge: BusinessKnowledge): string {
  const header = [
    '# Business Knowledge',
    '',
    '> Auto-managed by `peaks-prd` sediment step (v2.11.0 D3 / Group C Tier 5).',
    '> Schema: `BusinessKnowledge { schemaVersion: 1; concepts: BusinessConcept[] }`.',
    '> Idempotency key: `(concept, sourceRid)` — re-running with the same tuple does not duplicate.',
    '',
    '| Concept | Definition | Source | Decided | Evidence |',
    '|---|---|---|---|---|'
  ];
  const rows = knowledge.concepts.map(formatRow);
  const footer = [
    '',
    '## How to append',
    '',
    '```bash',
    '# programmatic (peaks-txt sediment step):',
    '#   appendBusinessConcept({ projectRoot, concept })',
    '#   see src/services/prd/project-scan-sediment.ts',
    '```',
    '',
    '## How to consume',
    '',
    '```bash',
    'peaks project knowledge --project <repo> --json',
    'peaks project knowledge --project <repo> --filter <concept-substr> --json',
    '```',
    ''
  ];
  return ['---\nschemaVersion: 1\n---\n', ...header, ...rows, ...footer].join('\n');
}

function formatRow(c: BusinessConcept): string {
  return `| ${escapeCell(c.concept)} | ${escapeCell(c.definition)} | ${escapeCell(c.sourceRid)} | ${escapeCell(c.decidedAt)} | ${escapeCell(c.evidence)} |`;
}

/** Escape pipe characters + newlines for safe markdown-table cells. */
function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}