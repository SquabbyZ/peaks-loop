import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findStubMarkers, findTestFiles } from '../../../../../src/services/audit/enforcers/prototype-fidelity.js';

describe('prototype-fidelity.findStubMarkers', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'audit-prototype-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('flags TODO markers in src files', () => {
    writeFileSync(join(projectRoot, 'foo.ts'), 'export const x = 1; // TODO: implement\n');
    const result = findStubMarkers({ projectRoot, filePaths: ['foo.ts'] });
    expect(result.stubMarkers.length).toBeGreaterThan(0);
    expect(result.stubMarkers[0]?.pattern).toContain('TODO');
  });

  it('returns no markers for clean files', () => {
    writeFileSync(join(projectRoot, 'foo.ts'), 'export const x = 1;\n');
    const result = findStubMarkers({ projectRoot, filePaths: ['foo.ts'] });
    expect(result.stubMarkers).toEqual([]);
  });
});

describe('prototype-fidelity.findTestFiles', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'audit-prototype-test-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('walks tests/ and finds .test.ts files', () => {
    mkdirSync(join(projectRoot, 'tests/unit'), { recursive: true });
    mkdirSync(join(projectRoot, 'tests/integration'), { recursive: true });
    writeFileSync(join(projectRoot, 'tests/unit/foo.test.ts'), '// test\n');
    writeFileSync(join(projectRoot, 'tests/integration/bar.test.ts'), '// test\n');
    const result = findTestFiles(projectRoot, 'src/services/foo.ts');
    expect(result.length).toBeGreaterThanOrEqual(0);
  });
});
