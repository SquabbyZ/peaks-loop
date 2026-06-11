import { describe, it, expect } from 'vitest';
import { hasInlineMock, findMockViolations } from '../../../../../src/services/audit/enforcers/mock-placement.js';

describe('mock-placement.hasInlineMock', () => {
  it('detects `mockData: { ... }` pattern', () => {
    const content = 'const x = { foo: 1 };\nconst mockData: { [k: string]: number } = { a: 1, b: 2 };\n';
    expect(hasInlineMock(content)).not.toBeNull();
  });

  it('detects `fixtures = { ... }` pattern', () => {
    const content = 'const fixtures = { one: 1, two: 2, three: 3 };\n';
    expect(hasInlineMock(content)).not.toBeNull();
  });

  it('detects `const fooMock = { ... > 20 chars }`', () => {
    const content = 'const userMock = { id: 1, name: "x", email: "y@z" };\n';
    expect(hasInlineMock(content)).not.toBeNull();
  });

  it('returns null for clean code', () => {
    const content = 'const data = await fetch("/api/foo");\nreturn data.json();\n';
    expect(hasInlineMock(content)).toBeNull();
  });

  it('returns null for short mock reference (under 20 chars)', () => {
    const content = 'const x = {};\n';
    expect(hasInlineMock(content)).toBeNull();
  });
});

describe('mock-placement.findMockViolations', () => {
  it('flags src/ files with inline mock data', () => {
    const files = [
      { filePath: 'src/services/foo.ts', content: 'const mockData = { a: 1, b: 2, c: 3 };\n' },
    ];
    const violations = findMockViolations(files);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.filePath).toBe('src/services/foo.ts');
  });

  it('does NOT flag tests/fixtures/ files', () => {
    const files = [
      { filePath: 'tests/fixtures/mock-user.json', content: 'const mockData = { a: 1, b: 2, c: 3 };\n' },
    ];
    expect(findMockViolations(files)).toEqual([]);
  });

  it('does NOT flag files outside src/ and skills/', () => {
    const files = [
      { filePath: 'docs/example.md', content: 'const mockData = { a: 1, b: 2, c: 3 };\n' },
    ];
    expect(findMockViolations(files)).toEqual([]);
  });

  it('flags skills/ files', () => {
    const files = [
      { filePath: 'skills/peaks-foo/SKILL.md', content: 'const mockData = { a: 1, b: 2, c: 3 };\n' },
    ];
    const violations = findMockViolations(files);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.filePath).toBe('skills/peaks-foo/SKILL.md');
  });
});
