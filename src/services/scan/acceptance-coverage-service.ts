import { join } from 'node:path';
import { pathExists, readText } from '../../shared/fs.js';
import { showRequestArtifact } from '../artifacts/request-artifact-service.js';

export type AcceptanceItem = {
  id: string;
  text: string;
  line: number;
};

export type TestCase = {
  title: string;
  acceptanceIds: string[];
  line: number;
};

export type CoverageEntry = {
  acceptanceId: string;
  acceptanceText: string;
  testCases: string[];
};

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

export type AcceptanceCoverageOptions = {
  projectRoot: string;
  requestId: string;
  sessionId?: string;
};

export type AcceptanceCoverageError =
  | { kind: 'prd-not-found' }
  | { kind: 'test-cases-not-found'; expectedPath: string };

const ACCEPTANCE_SECTION_PATTERN = /^##\s+(?:Acceptance criteria|验收标准|Acceptance Criteria)\s*$/m;

function extractAcceptanceItems(prdBody: string): AcceptanceItem[] {
  const lines = prdBody.split(/\r?\n/);
  const startMatch = ACCEPTANCE_SECTION_PATTERN.exec(prdBody);
  if (startMatch === null) {
    return [];
  }
  // Find the line where the header starts.
  let headerLine = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (ACCEPTANCE_SECTION_PATTERN.test((lines[i] ?? '') + '\n')) {
      headerLine = i;
      break;
    }
  }
  const items: AcceptanceItem[] = [];
  let counter = 0;
  for (let i = headerLine + 1; i < lines.length; i += 1) {
    const raw = lines[i] ?? '';
    if (/^##\s/.test(raw)) break; // next section
    const bulletMatch = /^\s*-\s+(.+?)\s*$/.exec(raw);
    if (bulletMatch === null) continue;
    const text = bulletMatch[1] ?? '';
    if (text.length === 0) continue;
    // Skip placeholder-only bullets ("...", "<...>", etc.)
    if (/^\.{2,}$/.test(text) || /^<[^>]+>$/.test(text)) continue;
    counter += 1;
    items.push({ id: `A${counter}`, text, line: i + 1 });
  }
  return items;
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
      const refs = (acceptanceMatch[1] ?? '').split(/[,\s]+/).map((part) => part.trim()).filter((part) => part.length > 0);
      current.ids.push(...refs);
    }
  }
  if (current !== null) {
    cases.push({ title: current.title, acceptanceIds: current.ids, line: current.line });
  }
  return cases;
}

function buildCoverage(items: AcceptanceItem[], cases: TestCase[]): { coverage: CoverageEntry[]; uncovered: AcceptanceItem[]; invalidReferences: Array<{ testCaseTitle: string; reference: string }> } {
  const itemMap = new Map<string, AcceptanceItem>();
  for (const item of items) itemMap.set(item.id, item);

  const coverageMap = new Map<string, string[]>();
  for (const item of items) coverageMap.set(item.id, []);

  const invalidReferences: Array<{ testCaseTitle: string; reference: string }> = [];

  for (const testCase of cases) {
    for (const ref of testCase.acceptanceIds) {
      const normalized = ref.toUpperCase();
      if (!itemMap.has(normalized)) {
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

export async function getAcceptanceCoverage(options: AcceptanceCoverageOptions): Promise<AcceptanceCoverageReport | AcceptanceCoverageError> {
  const showOptions: Parameters<typeof showRequestArtifact>[0] = {
    projectRoot: options.projectRoot,
    role: 'prd',
    requestId: options.requestId
  };
  if (options.sessionId !== undefined) {
    showOptions.sessionId = options.sessionId;
  }
  const prdArtifact = await showRequestArtifact(showOptions);
  if (prdArtifact === null) {
    return { kind: 'prd-not-found' };
  }
  // As of slice 2026-06-05-change-id-as-unit-of-work, test-cases live
  // under the same change-id dir as the PRD itself (the on-disk scope),
  // not under the body's `- session:` line. Slice
  // 2026-06-29-change-id-root-removal stripped the legacy
  // `.peaks/_runtime/change/<id>/` indirection — test-cases now live
  // under the canonical session dir `.peaks/_runtime/<sid>/qa/test-cases/`.
  // `prdArtifact.sessionId` is the bare session id (the dir the PRD was
  // found in), so we route through `_runtime/` here.
  const sessionId = prdArtifact.sessionId;
  const testCasesPath = join(options.projectRoot, '.peaks', '_runtime', sessionId, 'qa', 'test-cases', `${options.requestId}.md`);
  if (!(await pathExists(testCasesPath))) {
    return { kind: 'test-cases-not-found', expectedPath: testCasesPath };
  }
  const qaBody = await readText(testCasesPath);
  const acceptanceItems = extractAcceptanceItems(prdArtifact.content);
  const testCases = extractTestCases(qaBody);
  const { coverage, uncovered, invalidReferences } = buildCoverage(acceptanceItems, testCases);
  const unlinkedTestCases = testCases.filter((testCase) => testCase.acceptanceIds.length === 0);
  const ok = uncovered.length === 0 && invalidReferences.length === 0 && acceptanceItems.length > 0;
  return {
    ok,
    prdPath: prdArtifact.path,
    testCasesPath,
    acceptanceItems,
    testCases,
    coverage,
    uncovered,
    unlinkedTestCases,
    invalidReferences
  };
}

export function isAcceptanceCoverageError(value: AcceptanceCoverageReport | AcceptanceCoverageError): value is AcceptanceCoverageError {
  return (value as AcceptanceCoverageError).kind !== undefined;
}
