import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanOpenSpecTree } from '../../../../../src/services/audit/scanners/openspec-scanner.js';

describe('openspec-scanner', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'audit-openspec-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('returns empty result when openspec/changes/ is missing', () => {
    const result = scanOpenSpecTree({ projectRoot });
    expect(result.lines).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('walks markdown files under openspec/changes/<change-id>/', () => {
    mkdirSync(join(projectRoot, 'openspec/changes/2026-06-11-foo/specs/foo'), { recursive: true });
    writeFileSync(join(projectRoot, 'openspec/changes/2026-06-11-foo/proposal.md'), '# proposal\n');
    writeFileSync(join(projectRoot, 'openspec/changes/2026-06-11-foo/design.md'), '# design\n');
    writeFileSync(join(projectRoot, 'openspec/changes/2026-06-11-foo/specs/foo/spec.md'), '# spec\n');

    const result = scanOpenSpecTree({ projectRoot });
    const files = new Set(result.lines.map((l) => l.file));
    expect(files.has('openspec/changes/2026-06-11-foo/proposal.md')).toBe(true);
    expect(files.has('openspec/changes/2026-06-11-foo/design.md')).toBe(true);
    expect(files.has('openspec/changes/2026-06-11-foo/specs/foo/spec.md')).toBe(true);
  });
});
