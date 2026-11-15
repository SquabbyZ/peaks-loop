// tests/unit/services/prd/project-scan-qa-regressions.test.ts
//
// WHAT THIS LOCKS. Six defects an independent QA pass measured on the first cut of
// this refresh (2026-11-16). Each one was reproduced before it was fixed, and the
// case below is the reproduction.
//
//   F-1  Only the frontmatter was refreshed, so the `## Library versions` BODY
//        TABLE — the copy peaks-rd's own reference tells RD to read — went stale.
//        Measured on this repository's scan: 32 names in the frontmatter, 21 rows
//        in the table, 11 names (including `typescript`) in only one of them.
//   F-2  `libraryVersions` took the FIRST scan row per name, on the assumption
//        the root sorts first. False for `apps/*` and `libs/*` workspace globs,
//        so a root pin of `^5.7.2` was recorded as a workspace's `^5.4.0`.
//   F-3  `zeroToOne` counted a Next.js `app/*.tsx` tree, a `server/` layout and a
//        flat root-level project as 0-1, and since it gates the refresh their
//        scans were never refreshed.
//   F-4  A CRLF file (the Windows default checkout) failed the `\n`-anchored
//        version probe, fell through to the CREATE branch, and DESTROYED the
//        hand-written architecture note, the pinned-version warning and the
//        memory block.
//   F-6  An unreadable `package.json` threw out of `peaks project context`.
//   F-7  A comment claimed the housekeeping path does not repair a shell; it does.
//
// Dimensions covered:
//   - behavior:    each defect's reproduction, asserted in the fixed direction
//   - integration: real project roots on disk, the real bootstrap and reader
//
// Dimensions omitted:
//   - a11y / render: no user-visible text or exit code at this layer.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { bootstrapProjectScan } from '~/src/services/prd/project-scan-bootstrap-service';
import { readProjectScan } from '~/src/services/prd/project-scan-reader';
import { libraryVersionsFor } from '~/src/services/prd/project-scan-library-versions';

declareDimensions(
  'tests/unit/services/prd/project-scan-qa-regressions.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'a11y', reason: 'no user-visible text or exit code at this layer' },
    { dim: 'render', reason: 'table rendering is asserted here as text, not as a UI surface' }
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

/** A project with a manifest and one source file under `src/`. */
function makeProject(
  prefix: string,
  deps: Record<string, string> = { typescript: '^5.7.2', vitest: '^4.1.10' }
): string {
  const root = makeRoot(prefix);
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', devDependencies: deps }, null, 2),
    'utf8'
  );
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'main.ts'), 'export const x = 1;\n', 'utf8');
  return root;
}

/** A scan whose BODY carries the two tables a refresh must keep current. */
function scanWithTables(): string {
  return [
    '---',
    'schemaVersion: 1',
    'capturedAt: 2026-01-01T00:00:00.000Z',
    'techStack:',
    '  language: typescript',
    'libraryVersions:',
    '  vitest: ^3.0.0',
    'architecture: |',
    '  Hand-written architecture note.',
    'karpathySelfCheck: {}',
    '---',
    '',
    '# Project Scan (hand-authored)',
    '',
    '## Tech stack',
    '',
    '| Concern | Value |',
    '|---|---|',
    '| Language | javascript |',
    '| Node runtime | node v18 |',
    '',
    '## Library versions',
    '',
    '| Package | Pinned range | Notes |',
    '|---|---|---|',
    '| `vitest` | `^3.0.0` | unit tests (KEEP THIS NOTE) |',
    '',
    '## Architecture',
    '',
    'Prose a refresh must never touch.',
    ''
  ].join('\n');
}

describe('(behavior) F-1 — the body tables follow the frontmatter', () => {
  it('when the scan is refreshed, should update the version cell and keep the Notes column', async () => {
    // given: a body table carrying an old version and a hand-written note
    // when: the scan is refreshed
    // then: the version cell moved, the note did not
    const root = makeProject('peaks-qa-f1-');
    const absPath = writeScan(root, scanWithTables());

    await bootstrapProjectScan({ projectRoot: root, refreshMachineFields: true });
    const after = readFileSync(absPath, 'utf8');

    expect(after).toContain('| `vitest` | `^4.1.10` | unit tests (KEEP THIS NOTE) |');
    expect(after).not.toContain('| `vitest` | `^3.0.0` |');
    // The Tech stack table is PROSE. A non-empty cell is the author's, and the
    // refresh must not replace it with the shorter derived value.
    expect(after).toContain('| Language | javascript |');
    expect(after).toContain('| Node runtime | node v18 |');
    expect(after).toContain('Prose a refresh must never touch.');
  });

  it('when a Tech stack cell is empty, should fill it from the derivation', async () => {
    // given: a table whose cells are placeholders, as the create path writes them
    // when: the scan is refreshed
    // then: the placeholders are filled — an empty cell carries no author intent
    const root = makeProject('peaks-qa-f1c-');
    const absPath = writeScan(
      root,
      [
        '---',
        'schemaVersion: 1',
        'capturedAt: 2026-01-01T00:00:00.000Z',
        'techStack: {}',
        'libraryVersions: {}',
        'architecture: ""',
        'karpathySelfCheck: {}',
        '---',
        '',
        '# Project Scan (0-1 bootstrap)',
        '',
        '## Tech stack',
        '',
        '| Concern | Value |',
        '|---|---|',
        '| Language | (empty) |',
        '| Build | (empty) |',
        ''
      ].join('\n')
    );

    await bootstrapProjectScan({ projectRoot: root, refreshMachineFields: true });
    const after = readFileSync(absPath, 'utf8');

    expect(after).toContain('| Language | typescript |');
  });

  it('when the frontmatter has packages the table lacks, should append rows so the two counts agree', async () => {
    // given: a manifest declaring two packages, a table naming one
    // when: the scan is refreshed
    // then: every frontmatter name is also a row — RD reads the table
    const root = makeProject('peaks-qa-f1b-', { typescript: '^5.7.2', zod: '^4.6.7' });
    const absPath = writeScan(root, scanWithTables());

    await bootstrapProjectScan({ projectRoot: root, refreshMachineFields: true });
    const after = readFileSync(absPath, 'utf8');
    const parsed = await readProjectScan(root);

    for (const name of Object.keys(parsed?.libraryVersions ?? {})) {
      expect(after).toContain(`\`${name}\``);
    }
  });
});

describe('(behavior) F-2 — the root manifest supplies the specifier', () => {
  it('when a workspace glob sorts a package ahead of the root, should still record the root pin', async () => {
    // given: an `apps/*` workspace whose package pins an OLDER typescript
    // when: the map is built
    // then: the root's specifier wins — row order must not decide it
    const root = makeRoot('peaks-qa-f2-');
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'root', devDependencies: { typescript: '^5.7.2' } }, null, 2),
      'utf8'
    );
    mkdirSync(join(root, 'apps', 'web'), { recursive: true });
    writeFileSync(
      join(root, 'apps', 'web', 'package.json'),
      JSON.stringify({ name: 'web', devDependencies: { typescript: '^5.4.0' } }, null, 2),
      'utf8'
    );

    // The scan reports the workspace row FIRST, which is what sorted it ahead.
    const versions = libraryVersionsFor(root, [
      { name: 'typescript', version: '^5.4.0' },
      { name: 'typescript', version: '^5.7.2' }
    ]);

    expect(versions['typescript']).toBe('^5.7.2');
  });
});

describe('(integration) F-3 — non-standard source layouts are not 0-1', () => {
  for (const [label, dir] of [
    ['next-app-router', 'app'],
    ['server-layout', 'server'],
    ['flat-root', '']
  ] as const) {
    it('when the source lives outside src/, should refresh the scan', async () => {
      // given: a manifest and source files, but nothing under src/ or packages/ —
      //        the layout under test is the one named in the loop above
      // when: the bootstrap refreshes
      // then: it is not classified 0-1, so the scan actually moves
      const root = makeRoot(`peaks-qa-f3-${label}-`);
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ name: 'x', devDependencies: { typescript: '^5.9.0' } }, null, 2),
        'utf8'
      );
      const sourceDir = dir === '' ? root : join(root, dir);
      mkdirSync(sourceDir, { recursive: true });
      writeFileSync(
        join(sourceDir, `main${dir === 'app' ? '.tsx' : '.ts'}`),
        'export const x = 1;\n'
      );
      const absPath = writeScan(root, scanWithTables());

      const envelope = await bootstrapProjectScan({
        projectRoot: root,
        refreshMachineFields: true
      });
      const after = readFileSync(absPath, 'utf8');

      expect(envelope.refreshed).toBe(true);
      expect(after).toContain('typescript: ^5.9.0');
    });
  }
});

describe('(integration) F-4 — a CRLF checkout is never regenerated', () => {
  it('when the scan is CRLF, should refresh in place and keep every hand-written byte', async () => {
    // given: a hand-authored scan saved with Windows line endings
    // when: the bootstrap runs
    // then: it is REFRESHED, not recreated — the prose, the note and the memory
    //       block all survive
    const root = makeProject('peaks-qa-f4-');
    const authored = [
      '---',
      'schemaVersion: 1',
      'capturedAt: 2026-01-01T00:00:00.000Z',
      'techStack:',
      '  language: typescript',
      'libraryVersions:',
      '  vitest: ^3.0.0',
      'architecture: |',
      '  HAND-WRITTEN ARCHITECTURE NOTE',
      'karpathySelfCheck: {}',
      '---',
      '',
      '# Project Scan (hand-authored)',
      '',
      '> vitest is pinned at 4.1.10 — DO NOT propose 5.x; user directive.',
      '',
      '<!-- peaks-memory:start -->',
      'title: a memory block',
      '<!-- peaks-memory:end -->',
      ''
    ].join('\r\n');
    const absPath = writeScan(root, authored);

    const envelope = await bootstrapProjectScan({ projectRoot: root, refreshMachineFields: true });
    const after = readFileSync(absPath, 'utf8');

    expect(envelope.created).toBe(false);
    expect(after).toContain('HAND-WRITTEN ARCHITECTURE NOTE');
    expect(after).toContain('DO NOT propose 5.x');
    expect(after).toContain('peaks-memory:start');
    expect(after).toContain('# Project Scan (hand-authored)');
    expect(after).toContain('vitest: ^4.1.10');
  });
});

describe('(integration) F-6 — an unreadable manifest does not fail the command', () => {
  it('when package.json cannot be read, should still refresh instead of throwing', async () => {
    // given: a `package.json` that is a DIRECTORY, so reading it fails
    // when: the bootstrap refreshes
    // then: no throw — an everyday command must not fail over a scan snapshot
    const root = makeProject('peaks-qa-f6-');
    rmSync(join(root, 'package.json'));
    mkdirSync(join(root, 'package.json'), { recursive: true });
    const absPath = writeScan(root, scanWithTables());

    const envelope = await bootstrapProjectScan({ projectRoot: root, refreshMachineFields: true });

    expect(envelope.created).toBe(false);
    expect(readFileSync(absPath, 'utf8')).toContain('Prose a refresh must never touch.');
  });
});
