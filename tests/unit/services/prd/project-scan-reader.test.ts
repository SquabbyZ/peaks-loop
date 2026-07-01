/**
 * v2.11.0 Group B — D3 project-scan reader tests.
 *
 * Pins:
 *   - readProjectScan returns null when .peaks/project-scan/project-scan.md absent
 *   - readBusinessKnowledge returns null when business-knowledge.md absent
 *   - happy parse path for both files (full schema)
 *   - raw readers (readProjectScanRaw / readBusinessKnowledgeRaw) return null on absent
 *   - malformed YAML throws (does NOT silently return null)
 *   - shape validation throws on missing required fields
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  readBusinessKnowledge,
  readBusinessKnowledgeRaw,
  readProjectScan,
  readProjectScanRaw,
} from '../../../../src/services/prd/project-scan-reader.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-project-scan-reader-'));
});

afterEach(() => {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
});

function writeProjectScan(yaml: string, body = ''): void {
  const dir = join(root, '.peaks', 'project-scan');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'project-scan.md'), `---\n${yaml}\n---\n${body}`, 'utf8');
}

function writeBusinessKnowledge(yaml: string, body = ''): void {
  const dir = join(root, '.peaks', 'project-scan');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'business-knowledge.md'), `---\n${yaml}\n---\n${body}`, 'utf8');
}

describe('project-scan-reader — null on absent', () => {
  it('readProjectScan returns null when .peaks/project-scan/ is absent', async () => {
    expect(await readProjectScan(root)).toBeNull();
  });

  it('readBusinessKnowledge returns null when .peaks/project-scan/ is absent', async () => {
    expect(await readBusinessKnowledge(root)).toBeNull();
  });

  it('readProjectScanRaw returns null when project-scan.md is absent', async () => {
    expect(await readProjectScanRaw(root)).toBeNull();
  });

  it('readBusinessKnowledgeRaw returns null when business-knowledge.md is absent', async () => {
    expect(await readBusinessKnowledgeRaw(root)).toBeNull();
  });

  it('readBusinessKnowledge returns null when only project-scan.md is present', async () => {
    writeProjectScan('schemaVersion: 1');
    expect(await readBusinessKnowledge(root)).toBeNull();
  });

  it('readProjectScan returns null when only business-knowledge.md is present', async () => {
    writeBusinessKnowledge('schemaVersion: 1');
    expect(await readProjectScan(root)).toBeNull();
  });
});

describe('project-scan-reader — happy parse', () => {
  it('readProjectScan parses a complete project-scan.md', async () => {
    writeProjectScan(
      [
        'schemaVersion: 1',
        'capturedAt: "2026-06-26T05:00:00.000Z"',
        'techStack:',
        '  language: typescript',
        '  packageManager: pnpm',
        '  runtime: "node>=20.0.0"',
        'libraryVersions:',
        '  commander: "^12.1.0"',
        '  yaml: "^2.9.0"',
        'architecture: peaks-loop is a TypeScript Node CLI for AI-coding workflow orchestration.',
        'karpathySelfCheck:',
        '  simpleFirst: 800-line cap',
        '  surgicalChanges: touch only what is asked',
        '  goalDriven: ACs verify',
        '  thinkBefore: red-line scope'
      ].join('\n'),
      '# Peaks-Loop Project Scan\n\nFree text supplement.\n'
    );
    const scan = await readProjectScan(root);
    expect(scan).not.toBeNull();
    expect(scan!.schemaVersion).toBe(1);
    expect(scan!.capturedAt).toBe('2026-06-26T05:00:00.000Z');
    expect(scan!.techStack.language).toBe('typescript');
    expect(scan!.techStack.packageManager).toBe('pnpm');
    expect(scan!.techStack.runtime).toBe('node>=20.0.0');
    expect(scan!.libraryVersions['commander']).toBe('^12.1.0');
    expect(scan!.libraryVersions['yaml']).toBe('^2.9.0');
    expect(scan!.architecture).toContain('peaks-loop is a TypeScript');
    expect(scan!.karpathySelfCheck.simpleFirst).toBe('800-line cap');
    expect(scan!.karpathySelfCheck.surgicalChanges).toBe('touch only what is asked');
    expect(scan!.karpathySelfCheck.goalDriven).toBe('ACs verify');
    expect(scan!.karpathySelfCheck.thinkBefore).toBe('red-line scope');
  });

  it('readBusinessKnowledge parses concepts from the markdown table in the body', async () => {
    writeBusinessKnowledge(
      'schemaVersion: 1',
      [
        '',
        '# Business Knowledge',
        '',
        '| Concept | Definition | Source | Decided | Evidence |',
        '|---|---|---|---|---|',
        '| D1 | Immutable sha256-locked handoff. | 001-v2-11 | 2026-06-26T03:05:30Z | .peaks/memory/2026-06-26-v2-11-rm-rd-techdoc-immutable-handoff.md |',
        '| D2 | Half-white-box merged audit output. | 001-v2-11 | 2026-06-26T03:05:30Z | .peaks/memory/2026-06-26-v2-11-rm-rd-techdoc-immutable-handoff.md |'
      ].join('\n')
    );
    const knowledge = await readBusinessKnowledge(root);
    expect(knowledge).not.toBeNull();
    expect(knowledge!.schemaVersion).toBe(1);
    expect(knowledge!.concepts).toHaveLength(2);
    expect(knowledge!.concepts[0]!.concept).toBe('D1');
    expect(knowledge!.concepts[0]!.definition).toBe('Immutable sha256-locked handoff.');
    expect(knowledge!.concepts[0]!.sourceRid).toBe('001-v2-11');
    expect(knowledge!.concepts[1]!.concept).toBe('D2');
  });

  it('readBusinessKnowledge returns empty concepts array when the table is absent', async () => {
    writeBusinessKnowledge('schemaVersion: 1', '# Business Knowledge\n\nNo table here yet.\n');
    const knowledge = await readBusinessKnowledge(root);
    expect(knowledge).not.toBeNull();
    expect(knowledge!.schemaVersion).toBe(1);
    expect(knowledge!.concepts).toEqual([]);
  });

  it('readProjectScanRaw returns the raw markdown (frontmatter + body) verbatim', async () => {
    writeProjectScan('schemaVersion: 1', '# Hello\n\nBody.\n');
    const raw = await readProjectScanRaw(root);
    expect(raw).not.toBeNull();
    expect(raw).toContain('schemaVersion: 1');
    expect(raw).toContain('# Hello');
    expect(raw).toContain('Body.');
  });
});

describe('project-scan-reader — malformed input throws', () => {
  it('throws when frontmatter block is missing', async () => {
    const dir = join(root, '.peaks', 'project-scan');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'project-scan.md'), 'no frontmatter block here', 'utf8');
    await expect(readProjectScan(root)).rejects.toThrow(/frontmatter/);
  });

  it('throws when YAML is malformed', async () => {
    writeProjectScan('this: is: not: valid: yaml: [unbalanced');
    await expect(readProjectScan(root)).rejects.toThrow();
  });

  it('throws when shape is invalid (schemaVersion != 1)', async () => {
    writeProjectScan([
      'schemaVersion: 2',
      'capturedAt: "2026-06-26T05:00:00.000Z"',
      'techStack: { language: typescript, packageManager: pnpm, runtime: "node>=20.0.0" }',
      'libraryVersions: {}',
      'architecture: x',
      'karpathySelfCheck: { simpleFirst: a, surgicalChanges: b, goalDriven: c, thinkBefore: d }'
    ].join('\n'));
    await expect(readProjectScan(root)).rejects.toThrow(/shape/);
  });

  it('throws when business-knowledge frontmatter shape is invalid (schemaVersion != 1)', async () => {
    writeBusinessKnowledge('schemaVersion: 2', '');
    await expect(readBusinessKnowledge(root)).rejects.toThrow(/shape/);
  });
});