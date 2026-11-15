// tests/unit/services/prd/project-scan-refresh-robustness.test.ts
//
// WHAT THIS LOCKS, and why it is a separate file from
// `project-scan-field-refresh.test.ts` (that one is at its 500-line cap).
//
// Three defects an independent review found in the first cut of this refresh,
// each of which would have shipped green:
//
//   1. CRLF. `core.autocrlf=true` is the DEFAULT on Windows, so a checkout hands
//      the refresh `---\r\n` fences. A pattern anchored on `\n` alone found no
//      frontmatter, the refresh refused, and `libraryVersions` froze again —
//      reviving the exact bug the slice exists to fix, on the platform most of
//      its users run.
//   2. A 0-1 project's transition. `zeroToOne` returned before the shell test, so
//      a project that started empty and later gained source files kept
//      `architecture: ""` FOREVER: the first real run skipped, and no later run
//      ever re-entered the branch. RD's own slice contract claimed the opposite.
//   3. AC-5, techStack merge. The promise was "human-added keys survive a
//      refresh"; the test that proved it was lost in a file split, so the AC was
//      asserted nowhere while remaining in the PRD handoff.
//
// Dimensions covered:
//   - behavior:    the CRLF round-trip, the 0-1 transition, the merge
//   - integration: real project roots on disk, read through the real reader
//
// Dimensions omitted:
//   - a11y / render: no user-visible text; frontmatter rendering is covered by
//     `project-scan-field-refresh.test.ts`.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { bootstrapProjectScan } from '~/src/services/prd/project-scan-bootstrap-service';
import { readProjectScan } from '~/src/services/prd/project-scan-reader';
import { refreshProjectScanFields } from '~/src/services/prd/project-scan-field-refresh';

declareDimensions(
  'tests/unit/services/prd/project-scan-refresh-robustness.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'a11y', reason: 'no user-visible text or exit code at this layer' },
    {
      dim: 'render',
      reason: 'frontmatter rendering is asserted in project-scan-field-refresh.test.ts'
    }
  ]
);

const tempRoots: string[] = [];

function makeRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeScan(projectRoot: string, content: string): string {
  const dir = join(projectRoot, '.peaks', 'project-scan');
  mkdirSync(dir, { recursive: true });
  const absPath = join(dir, 'project-scan.md');
  writeFileSync(absPath, content, 'utf8');
  return absPath;
}

const LF_SCAN = [
  '---',
  'schemaVersion: 1',
  'capturedAt: 2026-01-01T00:00:00.000Z',
  'techStack:',
  '  language: typescript',
  'libraryVersions:',
  '  vitest: ^3.0.0',
  'architecture: |',
  '  Hand-written prose that must survive.',
  'karpathySelfCheck: {}',
  '---',
  '',
  '# Project Scan',
  '',
  'Body prose the refresh must never touch.',
  ''
].join('\n');

describe('(behavior) a CRLF checkout', () => {
  it('when the fences are CRLF, should still parse and refresh', () => {
    // given: the same scan, saved the way a Windows checkout writes it
    // when: the refresh runs
    // then: it succeeds instead of refusing — the freeze does not come back
    const crlf = LF_SCAN.replace(/\n/g, '\r\n');
    const result = refreshProjectScanFields(crlf, {
      capturedAt: '2026-02-02T00:00:00.000Z',
      techStack: { language: 'typescript', packageManager: 'pnpm' },
      libraryVersions: { vitest: '^4.1.10' }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toContain('vitest: ^4.1.10');
    expect(result.content).not.toContain('vitest: ^3.0.0');
  });

  it('when the fences are CRLF, should keep the file CRLF and preserve the body verbatim', () => {
    // given: a CRLF scan
    // when: it is refreshed
    // then: no mixed endings appear, and the body is untouched
    const crlf = LF_SCAN.replace(/\n/g, '\r\n');
    const bodyBefore = crlf.slice(crlf.indexOf('# Project Scan'));
    const result = refreshProjectScanFields(crlf, {
      capturedAt: '2026-02-02T00:00:00.000Z',
      techStack: { language: 'typescript' },
      libraryVersions: { vitest: '^4.1.10' }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).not.toMatch(/[^\r]\n/);
    expect(result.content.slice(result.content.indexOf('# Project Scan'))).toBe(bodyBefore);
    expect(result.content).toContain('Hand-written prose that must survive.');
  });
});

describe('(integration) a project that stopped being 0-1', () => {
  it('when a 0-1 project gains source files, should fill the placeholder on the next run', async () => {
    // given: a placeholder written while the project had no manifest or sources
    // when: the project gains both, and the bootstrap runs again
    // then: the shell is filled — not skipped forever
    const root = makeRoot('peaks-transition-');
    writeScan(
      root,
      [
        '---',
        'schemaVersion: 1',
        'capturedAt: 2026-01-01T00:00:00.000Z',
        'archetype: unknown',
        'confidence: low',
        'techStack: {}',
        'libraryVersions: {}',
        'architecture: ""',
        'karpathySelfCheck: {}',
        '---',
        '',
        '# Project Scan (0-1 bootstrap)',
        ''
      ].join('\n')
    );

    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'x', devDependencies: { typescript: '^5.9.0' } }, null, 2),
      'utf8'
    );
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'main.ts'), 'export const x = 1;\n', 'utf8');

    const envelope = await bootstrapProjectScan({ projectRoot: root, refreshMachineFields: true });
    const parsed = await readProjectScan(root);

    expect(envelope.refreshed).toBe(true);
    expect(parsed?.libraryVersions.typescript).toBe('^5.9.0');
    expect(parsed?.techStack.language).toBe('typescript');
  });

  it('when the project is still 0-1, should leave the truthful placeholder alone', async () => {
    // given: a placeholder and still no manifest or source files
    // when: the bootstrap runs with the refresh requested
    // then: the placeholder is preserved, because it is still accurate
    const root = makeRoot('peaks-still-01-');
    const placeholder = [
      '---',
      'schemaVersion: 1',
      'capturedAt: 2026-01-01T00:00:00.000Z',
      'archetype: unknown',
      'confidence: low',
      'techStack: {}',
      'libraryVersions: {}',
      'architecture: ""',
      'karpathySelfCheck: {}',
      '---',
      '',
      '# Project Scan (0-1 bootstrap)',
      ''
    ].join('\n');
    const absPath = writeScan(root, placeholder);

    await bootstrapProjectScan({ projectRoot: root, refreshMachineFields: true });

    expect(readFileSync(absPath, 'utf8')).toBe(placeholder);
  });
});

describe('(integration) AC-5 — the techStack merge on a real refresh', () => {
  it('when techStack carries a human-added row, should keep it across a refresh', async () => {
    // given: a scan whose owner added a row no derivation produces
    // when: the bootstrap refreshes the machine fields
    // then: the owner's row is still there — the promise AC-5 records
    const root = makeRoot('peaks-ac5-');
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify(
        { name: 'x', devDependencies: { typescript: '^5.7.2' }, scripts: { build: 'tsc -b' } },
        null,
        2
      ),
      'utf8'
    );
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'main.ts'), 'export const x = 1;\n', 'utf8');
    writeScan(
      root,
      [
        '---',
        'schemaVersion: 1',
        'capturedAt: 2026-01-01T00:00:00.000Z',
        'techStack:',
        '  language: typescript',
        '  lintTool: eslint@8.57.1',
        '  testRunner: vitest@4.1.10 (pinned)',
        'libraryVersions:',
        '  vitest: ^3.0.0',
        'architecture: |',
        '  Hand-written.',
        'karpathySelfCheck: {}',
        '---',
        '',
        '# hand-authored',
        ''
      ].join('\n')
    );

    await bootstrapProjectScan({ projectRoot: root, refreshMachineFields: true });
    const parsed = await readProjectScan(root);
    const rows = parsed?.techStack as unknown as Record<string, string>;

    expect(rows['lintTool']).toBe('eslint@8.57.1');
    expect(rows['testRunner']).toBe('vitest@4.1.10 (pinned)');
    // and the derived rows are current, not carried over stale
    expect(rows['language']).toBe('typescript');
  });
});
