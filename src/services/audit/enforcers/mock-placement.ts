/**
 * mock-placement enforcer — scans changed files for inline mock-data
 * patterns and fails the slice check if any changed file under `src/` or
 * `skills/` contains `mockData: { ... }`, `fixtures = { ... }`, or a
 * multi-line `const fooMock = { ... }` literal.
 *
 * Per L2 redesign §5.4. Mocks belong in `tests/fixtures/`, not inline.
 * Per `references/mock-data-placement.md` from peaks-rd: framework-aware
 * mock placement. peaks-cli has no UI framework, but the rule still
 * applies for non-fixture files.
 */

const MOCK_PATTERNS: readonly RegExp[] = [
  /\bmockData\s*[:=]\s*\{/,
  /\bfixtures?\s*=\s*\{/,
  /const\s+\w*[Mm]ock\w*\s*=\s*\{[\s\S]{20,}/,
];

export interface MockPlacementCheckInput {
  readonly filePath: string;
  readonly content: string;
}

export interface MockPlacementViolation {
  readonly filePath: string;
  readonly pattern: string;
  readonly snippet: string;
}

export function hasInlineMock(content: string): MockPlacementViolation | null {
  for (const pattern of MOCK_PATTERNS) {
    const match = pattern.exec(content);
    if (match) {
      return {
        filePath: '',
        pattern: pattern.source,
        snippet: match[0].slice(0, 80),
      };
    }
  }
  return null;
}

export function findMockViolations(
  changedFiles: readonly { filePath: string; content: string }[],
): readonly MockPlacementViolation[] {
  const violations: MockPlacementViolation[] = [];
  for (const { filePath, content } of changedFiles) {
    // Mocks are allowed in tests/fixtures/. The slice check is invoked
    // with the diff-vs-scope output, which already filters out
    // test/fixture paths; this guard is a safety net.
    if (filePath.includes('tests/fixtures/')) continue;
    if (filePath.includes('__fixtures__')) continue;
    if (!filePath.startsWith('src/') && !filePath.startsWith('skills/')) continue;
    const violation = hasInlineMock(content);
    if (violation) {
      violations.push({ ...violation, filePath });
    }
  }
  return violations;
}
