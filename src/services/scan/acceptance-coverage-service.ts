import { join } from 'node:path';
import { isDirectory, listDirectories, pathExists, readText } from 'peaks-loop-shared/fs';

import { showRequestArtifact } from '../artifacts/request-artifact-service.js';
import { handoffRelativePath } from '../prd/handoff-path-resolution.js';
import { isUnsafePathInput } from '../../shared/path-safety.js';
import { runtimeRoot } from '../../shared/runtime-root.js';

export type CriteriaSource = 'declared' | 'section' | 'both';
export type AcceptanceItem = { id: string; text: string; line: number; source: CriteriaSource };
export type TestCase = { title: string; acceptanceIds: string[]; line: number };
export type CoverageEntry = { acceptanceId: string; acceptanceText: string; testCases: string[] };
export type AcceptanceCoverageOptions = {
  projectRoot: string;
  requestId: string;
  sessionId?: string;
};
export type AcceptanceCoverageError =
  | { kind: 'prd-not-found'; message: string }
  | { kind: 'test-cases-not-found'; expectedPath: string };

export type AcceptanceCoverageReport = {
  ok: boolean;
  prdPath: string;
  testCasesPath: string;
  acceptanceItems: AcceptanceItem[];
  testCases: TestCase[];
  coverage: CoverageEntry[];
  uncovered: AcceptanceItem[];
  unlinkedTestCases: TestCase[];
  invalidReferences: Array<{ testCaseTitle: string; reference: string }>;
};

const ACCEPTANCE_SECTION_PATTERN = /^##\s+(?:Acceptance criteria|验收标准|Acceptance Criteria)\s*$/;
const TABLE_SEPARATOR_PATTERN = /^\s*\|(?:\s*:?-{2,}:?\s*\|)+\s*$/;
const CRITERION_COLUMN_PATTERN = /criter|判据|验收/i;
const BULLET_PATTERN = /^\s*-\s+(.+?)\s*$/;
const TABLE_ROW_PATTERN = /^\s*\|(.+)\|\s*$/;

/** A criterion before it is numbered: its text, the line it was read from, and its source. */
type RawCriterion = { text: string; line: number; source: 'declared' | 'section' };

/** The criteria a document DECLARES: the `acceptanceCriteria:` list in its frontmatter. */
function declaredCriteria(content: string): RawCriterion[] {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (block === null) return [];
  const lines = (block[1] ?? '').split(/\r?\n/);
  const found: RawCriterion[] = [];
  let inList = false;
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? '';
    if (!inList) {
      inList = raw.trim() === 'acceptanceCriteria:';
      continue;
    }
    const entry = BULLET_PATTERN.exec(raw);
    if (entry === null) {
      if (raw.trim().length > 0) inList = false;
      continue;
    }
    const text = (entry[1] ?? '').trim().replace(/^["'](.*)["']$/, '$1');
    found.push({ text, line: i + 2, source: 'declared' });
  }
  return found;
}

/** A criteria TABLE row: the criterion text it carries and the criterion column for the
 *  rows after it — the header row is the one that NAMES the column. */
function tableRowCriterion(
  cells: string[],
  next: string,
  column: number
): { text: string; column: number } | null {
  if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) return null;
  if (TABLE_SEPARATOR_PATTERN.test(next)) {
    const named = cells.findIndex((cell) => CRITERION_COLUMN_PATTERN.test(cell));
    return { text: '', column: named >= 0 ? named : Math.min(1, cells.length - 1) };
  }
  return { text: cells[column] ?? '', column };
}

/** The criteria a document SHOWS: the bullets of its acceptance section and the criterion
 *  column of a criteria table inside it. */
function sectionCriteria(content: string): RawCriterion[] {
  const lines = content.split(/\r?\n/);
  const found: RawCriterion[] = [];
  let inSection = false;
  let column = 1;
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? '';
    if (!inSection) {
      inSection = ACCEPTANCE_SECTION_PATTERN.test(raw);
      continue;
    }
    if (/^##\s/.test(raw)) break;
    const bullet = BULLET_PATTERN.exec(raw);
    if (bullet !== null) {
      found.push({ text: (bullet[1] ?? '').trim(), line: i + 1, source: 'section' });
      continue;
    }
    const row = TABLE_ROW_PATTERN.exec(raw);
    if (row === null) continue;
    const cells = (row[1] ?? '').split('|').map((cell) => cell.trim());
    const table = tableRowCriterion(cells, lines[i + 1] ?? '', column);
    if (table === null) continue;
    column = table.column;
    if (table.text.length > 0) {
      found.push({ text: table.text, line: i + 1, source: 'section' });
    }
  }
  return found;
}

/** The criteria of a PRD: the DECLARED list UNION the criteria the section SHOWS,
 *  de-duplicated by text. A criterion carrying both sources says so. */
function extractAcceptanceItems(content: string): AcceptanceItem[] {
  const items: AcceptanceItem[] = [];
  const byKey = new Map<string, AcceptanceItem>();
  let counter = 0;
  for (const raw of [...declaredCriteria(content), ...sectionCriteria(content)]) {
    const text = raw.text.trim();
    if (text.length === 0 || /^\.{2,}$/.test(text) || /^<[^>]+>$/.test(text)) continue;
    const key = text.toLowerCase().replace(/\s+/g, ' ');
    const existing = byKey.get(key);
    if (existing === undefined) {
      counter += 1;
      const item: AcceptanceItem = { id: `A${counter}`, text, line: raw.line, source: raw.source };
      byKey.set(key, item);
      items.push(item);
      continue;
    }
    if (existing.source !== raw.source) existing.source = 'both';
  }
  return items;
}

/** The `sessionId:` a capsule declares in its own frontmatter. The PRD-style `- session:`
 *  line in the body is a different field. A declared value that is not a single safe path
 *  segment is REFUSED: it decides where the test-cases file is read from. */
function handoffFrontmatterSessionId(content: string): string | undefined {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (block === null) return undefined;
  const declared = /^sessionId:\s*(.+?)\s*$/m.exec(block[1] ?? '');
  if (declared === null) return undefined;
  const value = (declared[1] ?? '').trim().replace(/^["'](.*)["']$/, '$1');
  if (value.length === 0 || isUnsafePathInput(value)) return undefined;
  return value;
}

async function candidateSessionIds(options: AcceptanceCoverageOptions): Promise<string[]> {
  if (options.sessionId !== undefined) return [options.sessionId];
  const runtimeDir = runtimeRoot(options.projectRoot).dir();
  if (!(await isDirectory(runtimeDir))) return [];
  return await listDirectories(runtimeDir);
}

type PrdSource = { path: string; sessionId: string; acceptanceItems: AcceptanceItem[] };

/** The MAIN source is the role carrier at `prd/requests/<rid>.md`; the FALLBACK is the
 *  handoff capsule at `prd/handoff-<rid>.md` — the artifact the pipeline produces for a
 *  session that ran no peaks-prd role. The capsule's path is built by the SAME guarded
 *  constructor the capsule writer uses, so neither the rid nor the session id can escape
 *  the runtime root. */
async function resolvePrdSource(options: AcceptanceCoverageOptions): Promise<PrdSource | null> {
  const showOptions: Parameters<typeof showRequestArtifact>[0] = {
    projectRoot: options.projectRoot,
    role: 'prd',
    requestId: options.requestId,
    ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId })
  };
  const prdArtifact = await showRequestArtifact(showOptions);
  if (prdArtifact !== null) {
    const { path, content, sessionId } = prdArtifact;
    return { path, sessionId, acceptanceItems: extractAcceptanceItems(content) };
  }
  for (const sessionDir of await candidateSessionIds(options)) {
    const relative = handoffRelativePath(sessionDir, options.requestId);
    const absolute = join(options.projectRoot, relative);
    if (!(await pathExists(absolute))) continue;
    const content = await readText(absolute);
    // The capsule's own `sessionId:` first, then the caller's `--session-id`,
    // then the session dir the capsule was found in — which IS the caller's
    // when one was given.
    const sessionId = handoffFrontmatterSessionId(content) ?? options.sessionId ?? sessionDir;
    return { path: absolute, sessionId, acceptanceItems: extractAcceptanceItems(content) };
  }
  return null;
}

function prdNotFoundMessage(requestId: string): string {
  return `PRD artifact for requestId=${requestId} not found: neither prd/requests/${requestId}.md nor prd/handoff-${requestId}.md was found`;
}

const TEST_CASE_HEADER_PATTERN = /^##\s+Test Case:\s*(.+?)\s*$/;
const ACCEPTANCE_FIELD_PATTERN = /^\s*-\s+\*\*Acceptance:\*\*\s+(.+?)\s*$/i;

function extractTestCases(qaBody: string): TestCase[] {
  const lines = qaBody.split(/\r?\n/);
  const cases: TestCase[] = [];
  let current: { title: string; line: number; ids: string[] } | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? '';
    const headerMatch = TEST_CASE_HEADER_PATTERN.exec(raw);
    if (headerMatch !== null) {
      if (current !== null) {
        cases.push({ title: current.title, acceptanceIds: current.ids, line: current.line });
      }
      current = { title: (headerMatch[1] ?? '').trim(), line: i + 1, ids: [] };
      continue;
    }
    if (current === null) continue;
    const acceptanceMatch = ACCEPTANCE_FIELD_PATTERN.exec(raw);
    if (acceptanceMatch !== null) {
      const refs = (acceptanceMatch[1] ?? '').split(/[,\s]+/).filter((part) => part.length > 0);
      current.ids.push(...refs);
    }
  }
  if (current !== null) {
    cases.push({ title: current.title, acceptanceIds: current.ids, line: current.line });
  }
  return cases;
}

function buildCoverage(
  items: AcceptanceItem[],
  cases: TestCase[]
): {
  coverage: CoverageEntry[];
  uncovered: AcceptanceItem[];
  invalidReferences: Array<{ testCaseTitle: string; reference: string }>;
} {
  const coverageMap = new Map<string, string[]>();
  for (const item of items) coverageMap.set(item.id, []);

  const invalidReferences: Array<{ testCaseTitle: string; reference: string }> = [];

  for (const testCase of cases) {
    for (const ref of testCase.acceptanceIds) {
      const normalized = ref.toUpperCase();
      if (!coverageMap.has(normalized)) {
        invalidReferences.push({ testCaseTitle: testCase.title, reference: ref });
        continue;
      }
      coverageMap.get(normalized)?.push(testCase.title);
    }
  }

  const coverage: CoverageEntry[] = items.map((item) => ({
    acceptanceId: item.id,
    acceptanceText: item.text,
    testCases: coverageMap.get(item.id) ?? []
  }));
  const uncovered = items.filter((item) => (coverageMap.get(item.id) ?? []).length === 0);
  return { coverage, uncovered, invalidReferences };
}

export async function getAcceptanceCoverage(
  options: AcceptanceCoverageOptions
): Promise<AcceptanceCoverageReport | AcceptanceCoverageError> {
  const source = await resolvePrdSource(options);
  if (source === null) {
    return { kind: 'prd-not-found', message: prdNotFoundMessage(options.requestId) };
  }
  // test-cases live under the canonical session dir `.peaks/_runtime/<sid>/qa/test-cases/`;
  // `source.sessionId` is the bare session id of the dir the PRD — or the capsule — was in.
  const testCasesPath = join(
    options.projectRoot,
    `.peaks/_runtime/${source.sessionId}/qa/test-cases/${options.requestId}.md`
  );
  if (!(await pathExists(testCasesPath))) {
    return { kind: 'test-cases-not-found', expectedPath: testCasesPath };
  }
  const qaBody = await readText(testCasesPath);
  const acceptanceItems = source.acceptanceItems;
  const testCases = extractTestCases(qaBody);
  const { coverage, uncovered, invalidReferences } = buildCoverage(acceptanceItems, testCases);
  const unlinkedTestCases = testCases.filter((testCase) => testCase.acceptanceIds.length === 0);
  const ok = uncovered.length === 0 && invalidReferences.length === 0 && acceptanceItems.length > 0;
  return {
    ok,
    prdPath: source.path,
    testCasesPath,
    acceptanceItems,
    testCases,
    coverage,
    uncovered,
    unlinkedTestCases,
    invalidReferences
  };
}

export function isAcceptanceCoverageError(
  value: AcceptanceCoverageReport | AcceptanceCoverageError
): value is AcceptanceCoverageError {
  return (value as AcceptanceCoverageError).kind !== undefined;
}
