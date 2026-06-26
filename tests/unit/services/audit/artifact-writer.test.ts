/**
 * Slice 2026-06-26-audit-artifact-writer-generalization — unit tests for
 * the 4 audit artifact writers.
 *
 * Each writer is pinned on:
 *   - canonical path (subdir + slug)
 *   - canonical frontmatter (name / description / metadata.type /
 *     metadata.artifactType)
 *   - body shape (envelope structure for machine-output)
 *
 * These tests are the contract enforcement for NEW writes; the
 * `memory-shape-guard.test.ts` is the shape enforcement for the
 * working tree. Together they prevent recurrence of the 2026-06-22
 * bypass-the-writer incident.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

/** Cross-platform path-segment check (Windows uses `\`, POSIX uses `/`). */
function containsPathSegment(filePath: string, segment: string): boolean {
  return filePath.split(/[\\/]/).includes(segment);
}
import {
  writeDecision,
  writeMachineOutput,
  writeNarrative,
  writePrompt,
} from '../../../../src/services/audit/artifact-writer.js';
import type { RedLineAudit } from '../../../../src/services/audit/types.js';

const FAKE_AUDIT: RedLineAudit = {
  totalRedLines: 3,
  cliBacked: 2,
  partial: 1,
  proseOnly: 0,
  audit: [
    {
      id: 'R-T1',
      rule: 'test rule',
      backing: 'cli-backed',
      source: { file: 'src/x.ts', line: 1, marker: 'MANDATORY', context: '' },
      enforcerRef: 'enf-1',
    },
  ],
  enforcerFindings: [
    { enforcerId: 'enf-1', rule: 'r', severity: 'pass', file: 'src/x.ts', detail: 'ok' },
  ],
};

describe('writeDecision — back-compat with decision-writer', () => {
  let projectRoot: string;
  beforeAll(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'artifact-writer-decision-'));
  });
  afterAll(() => {
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  });

  test('writes to audit-decisions/<slug>.md', () => {
    const rec = writeDecision(FAKE_AUDIT, { projectRoot, date: '2026-06-26' });
    expect(containsPathSegment(rec.filePath, 'audit-decisions')).toBe(true);
    expect(rec.filePath.endsWith('audit-decision-2026-06-26.md')).toBe(true);
    expect(existsSync(rec.filePath)).toBe(true);
  });

  test('emits canonical frontmatter with metadata.type: decision', () => {
    const rec = writeDecision(FAKE_AUDIT, { projectRoot, date: '2026-06-26' });
    const content = readFileSync(rec.filePath, 'utf8');
    expect(content).toContain('---');
    expect(content).toContain('metadata:');
    expect(content).toContain('  type: decision');
  });

  test('respects rid suffix in slug', () => {
    const rec = writeDecision(FAKE_AUDIT, { projectRoot, date: '2026-06-26', rid: 'abc123' });
    expect(rec.filePath.endsWith('audit-decision-2026-06-26-abc123.md')).toBe(true);
  });

  test('respects slugOverride', () => {
    const rec = writeDecision(FAKE_AUDIT, {
      projectRoot,
      date: '2026-06-26',
      slugOverride: 'custom-slug',
    });
    expect(rec.filePath.endsWith('custom-slug.md')).toBe(true);
  });
});

describe('writePrompt', () => {
  let projectRoot: string;
  beforeAll(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'artifact-writer-prompt-'));
  });
  afterAll(() => {
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  });

  test('writes to audit-prompts/<slug>.md', () => {
    const rec = writePrompt(
      { name: 'test-prompt', description: 'A test prompt', body: '# Body\n\ncontent.' },
      { projectRoot, date: '2026-06-26' },
    );
    expect(containsPathSegment(rec.filePath, 'audit-prompts')).toBe(true);
    expect(rec.filePath.endsWith('audit-prompt-2026-06-26.md')).toBe(true);
    expect(existsSync(rec.filePath)).toBe(true);
  });

  test('emits metadata.type: reference + artifactType: prompt', () => {
    const rec = writePrompt(
      { name: 'rp', description: 'desc', body: 'body' },
      { projectRoot, date: '2026-06-26', slugOverride: 'rp' },
    );
    const content = readFileSync(rec.filePath, 'utf8');
    expect(content).toContain('  type: reference');
    expect(content).toContain('  artifactType: prompt');
  });
});

describe('writeMachineOutput', () => {
  let projectRoot: string;
  beforeAll(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'artifact-writer-mout-'));
  });
  afterAll(() => {
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  });

  test('writes to top-level <slug>.md (no subdir)', () => {
    const json = '{"foo": "bar"}';
    const rec = writeMachineOutput(
      { name: 'test-mout', description: 'A test machine output', json },
      { projectRoot, date: '2026-06-26' },
    );
    expect(containsPathSegment(rec.filePath, '.peaks')).toBe(true);
    expect(containsPathSegment(rec.filePath, 'memory')).toBe(true);
    expect(containsPathSegment(rec.filePath, 'audit-decisions')).toBe(false);
    expect(containsPathSegment(rec.filePath, 'audit-prompts')).toBe(false);
    expect(rec.filePath.endsWith(`audit-output-2026-06-26.md`)).toBe(true);
    expect(existsSync(rec.filePath)).toBe(true);
  });

  test('embeds raw JSON byte-for-byte inside fenced json block', () => {
    const json = '{"audit_round":2,"nested":{"a":1,"b":[1,2,3]}}';
    const rec = writeMachineOutput(
      { name: 'preservation', description: 'byte preservation test', json },
      { projectRoot, date: '2026-06-26', slugOverride: 'preservation' },
    );
    const content = readFileSync(rec.filePath, 'utf8');
    expect(content).toContain('```json');
    expect(content).toContain('```');
    expect(content).toContain(json);
  });

  test('emits metadata.type: project + artifactType: machine-output', () => {
    const rec = writeMachineOutput(
      { name: 'kind', description: 'kind test', json: '{}' },
      { projectRoot, date: '2026-06-26', slugOverride: 'kind-test' },
    );
    const content = readFileSync(rec.filePath, 'utf8');
    expect(content).toContain('  type: project');
    expect(content).toContain('  artifactType: machine-output');
  });

  test('rejects invalid JSON', () => {
    expect(() =>
      writeMachineOutput(
        { name: 'bad', description: 'bad json', json: '{not json' },
        { projectRoot, date: '2026-06-26', slugOverride: 'bad-json' },
      ),
    ).toThrow(/not valid JSON/);
  });

  test('accepts { path: } input by reading file', () => {
    const tmpJsonPath = join(projectRoot, 'input.json');
    const fs = require('node:fs') as typeof import('node:fs');
    fs.writeFileSync(tmpJsonPath, '{"from":"file"}');
    const rec = writeMachineOutput(
      { name: 'file-input', description: 'file input test', json: { path: tmpJsonPath } },
      { projectRoot, date: '2026-06-26', slugOverride: 'file-input' },
    );
    const content = readFileSync(rec.filePath, 'utf8');
    expect(content).toContain('"from":"file"');
  });
});

describe('writeNarrative', () => {
  let projectRoot: string;
  beforeAll(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'artifact-writer-narrative-'));
  });
  afterAll(() => {
    if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
  });

  test('writes to top-level <slug>.md (no subdir)', () => {
    const rec = writeNarrative(
      { name: 'test-narrative', description: 'A test narrative', body: '# Body\n\ncontent.' },
      { projectRoot, date: '2026-06-26' },
    );
    expect(containsPathSegment(rec.filePath, '.peaks')).toBe(true);
    expect(containsPathSegment(rec.filePath, 'memory')).toBe(true);
    expect(containsPathSegment(rec.filePath, 'audit-decisions')).toBe(false);
    expect(containsPathSegment(rec.filePath, 'audit-prompts')).toBe(false);
    expect(rec.filePath.endsWith(`audit-narrative-2026-06-26.md`)).toBe(true);
    expect(existsSync(rec.filePath)).toBe(true);
  });

  test('emits metadata.type: project + artifactType: narrative', () => {
    const rec = writeNarrative(
      { name: 'n', description: 'd', body: 'b' },
      { projectRoot, date: '2026-06-26', slugOverride: 'n' },
    );
    const content = readFileSync(rec.filePath, 'utf8');
    expect(content).toContain('  type: project');
    expect(content).toContain('  artifactType: narrative');
  });
});
