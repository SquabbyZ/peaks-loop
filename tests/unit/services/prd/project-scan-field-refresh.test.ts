// tests/unit/services/prd/project-scan-field-refresh.test.ts
//
// THE DEFECT THIS LOCKS. `bootstrapProjectScan` wrote
// `.peaks/project-scan/project-scan.md` once and skipped it forever after:
// `schemaVersion: 1` on disk made every later run report `skipped: true`, so
// `libraryVersions` froze at the versions present on install day. The file is a
// CONSUMER CONTRACT — peaks-rd reads `## Library versions` and cross-checks it
// against `schemas/library-breaking-changes.data.json`, and the file is
// declared as Gate C evidence — so a frozen map makes that gate pass on stale
// input.
//
// WHAT IS ASSERTED HERE, and why each arm earns its place:
//   - the hand-authored sediment survives BYTE FOR BYTE (body prose,
//     `architecture` block scalar, `karpathySelfCheck`) while the three managed
//     fields move. This is the regression the orchestrator's own scan was
//     written to prove: it carries a vitest pin note and a c8 removal note that
//     a regeneration destroys;
//   - a never-populated shell is FILLED without any user gesture — the
//     installed base of consumer projects holds such shells;
//   - `readProjectScan` (the canonical reader) still parses the result. A
//     refresh that produces YAML the machine consumer cannot read is a worse
//     failure than the freeze it fixes;
//   - a 0-1 project's placeholder keeps its skip semantics, and
//     `--force-project-scan-templates` still governs only the 4 bundled files.
//
// Dimensions covered:
//   - behavior:    the refresh / skip / fill decisions and the envelope
//   - integration: real temp project roots, the real scans, the real reader
//   - render:      the frontmatter the refresh writes
//
// Dimensions omitted:
//   - a11y: no user-visible text or exit code lives in this service; the CLI
//     surface that turns `refreshed` into a message is covered by
//     `tests/unit/cli/commands/project-context-refresh.test.ts`.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { bootstrapProjectScan } from '~/src/services/prd/project-scan-bootstrap-service';
import { readProjectScan } from '~/src/services/prd/project-scan-reader';
import { refreshProjectScanFields } from '~/src/services/prd/project-scan-field-refresh';
import { isUnpopulatedProjectScan } from '~/src/services/prd/project-scan-existing-state';

declareDimensions(
  'tests/unit/services/prd/project-scan-field-refresh.test.ts',
  ['behavior', 'integration', 'render'],
  [{ dim: 'a11y', reason: 'no user-visible text or exit code in this service layer' }]
);

const tempRoots: string[] = [];

function makeRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A hand-authored scan, in the shape this repository actually carries: an
 *  `architecture: |` block scalar, a populated `karpathySelfCheck`, and body
 *  prose naming decisions no scan can re-derive. */
const HAND_AUTHORED = [
  '---',
  'schemaVersion: 1',
  'capturedAt: 2026-01-01T00:00:00.000Z',
  'techStack:',
  '  language: typescript',
  '  packageManager: pnpm@10.11.0',
  'libraryVersions:',
  '  vitest: ^3.0.0',
  'architecture: |',
  '  src/services/ holds one module per concern.',
  '  Hand-written: the c8 gate was removed on purpose.',
  'karpathySelfCheck:',
  '  simpleFirst: "800-line file cap"',
  '---',
  '',
  '# Project Scan (hand-authored)',
  '',
  '> vitest is pinned at 4.1.10 — do NOT propose 5.x; user directive.',
  '',
  '## Workspace packages',
  '',
  '| Package | Version |',
  '|---|---|',
  '| `peaks-loop-shared` | `0.0.116` |',
  ''
].join('\n');

function writeScan(projectRoot: string, content: string): string {
  const dir = join(projectRoot, '.peaks', 'project-scan');
  mkdirSync(dir, { recursive: true });
  const absPath = join(dir, 'project-scan.md');
  writeFileSync(absPath, content, 'utf8');
  return absPath;
}

/** An existing project: a manifest with a dependency and a source file. */
function makeExistingProject(prefix: string): string {
  const root = makeRoot(prefix);
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture',
        packageManager: 'pnpm@10.11.0',
        devDependencies: { typescript: '^5.7.2', vitest: '^4.1.10' },
        scripts: { build: 'tsc -p tsconfig.build.json' }
      },
      null,
      2
    ),
    'utf8'
  );
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'main.ts'), 'export const x = 1;\n', 'utf8');
  return root;
}

/** The frontmatter block of a project-scan.md, `---` fences included. */
function frontmatterOf(content: string): string {
  const match = /^---\n[\s\S]*?\n---\n/.exec(content);
  if (match === null) throw new Error('no frontmatter in content');
  return match[0];
}

/** Everything after the frontmatter — the part a refresh must never touch. */
function bodyOf(content: string): string {
  return content.slice(frontmatterOf(content).length);
}

describe('(render) the frontmatter a refresh writes', () => {
  it('when a hand-authored scan is refreshed, should rewrite only the three managed keys', () => {
    // given: a scan with a multi-line architecture block scalar and body prose
    // when: the three machine fields are refreshed
    // then: the managed values moved, and every other frontmatter byte held
    const before = HAND_AUTHORED;

    const result = refreshProjectScanFields(before, {
      capturedAt: '2026-11-15T00:00:00.000Z',
      techStack: { language: 'typescript', packageManager: 'pnpm@10.11.0' },
      libraryVersions: { vitest: '^4.1.10', typescript: '^5.7.2' }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toContain('capturedAt: 2026-11-15T00:00:00.000Z');
    expect(result.content).toContain('  vitest: ^4.1.10');
    expect(result.content).toContain('  typescript: ^5.7.2');
    expect(result.content).not.toContain('vitest: ^3.0.0');
    // `architecture` and `karpathySelfCheck` are hand-authored: byte-identical.
    expect(frontmatterOf(result.content)).toContain(
      'architecture: |\n  src/services/ holds one module per concern.\n' +
        '  Hand-written: the c8 gate was removed on purpose.\n' +
        'karpathySelfCheck:\n  simpleFirst: "800-line file cap"\n'
    );
    // key order is the file's own, not a re-serialisation of a JS object
    const keys = [...frontmatterOf(result.content).matchAll(/^([a-zA-Z]+):/gm)].map((m) => m[1]);
    expect(keys).toEqual([
      'schemaVersion',
      'capturedAt',
      'techStack',
      'libraryVersions',
      'architecture',
      'karpathySelfCheck'
    ]);
  });

  it('when a hand-authored scan is refreshed, should preserve the markdown body byte for byte', () => {
    // given: a scan whose body carries a user directive and a package table
    // when: the machine fields are refreshed
    // then: not one body byte differs — that prose is the sediment
    const before = HAND_AUTHORED;

    const result = refreshProjectScanFields(before, {
      capturedAt: '2026-11-15T00:00:00.000Z',
      techStack: { language: 'typescript' },
      libraryVersions: { vitest: '^4.1.10' }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(bodyOf(result.content)).toBe(bodyOf(before));
    expect(result.content).toContain('vitest is pinned at 4.1.10 — do NOT propose 5.x');
    expect(result.content).toContain('| `peaks-loop-shared` | `0.0.116` |');
  });

  it('when a key is absent from the frontmatter, should append it last rather than reorder', () => {
    // given: a legacy scan with no `techStack` key at all
    // when: the machine fields are refreshed
    // then: the missing keys arrive after the ones already present
    const before = [
      '---',
      'schemaVersion: 1',
      'capturedAt: 2026-01-01T00:00:00.000Z',
      'architecture: "hand-written"',
      '---',
      '',
      '# body',
      ''
    ].join('\n');

    const result = refreshProjectScanFields(before, {
      capturedAt: '2026-11-15T00:00:00.000Z',
      techStack: { language: 'typescript' },
      libraryVersions: { vitest: '^4.1.10' }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const keys = [...frontmatterOf(result.content).matchAll(/^([a-zA-Z]+):/gm)].map((m) => m[1]);
    expect(keys).toEqual([
      'schemaVersion',
      'capturedAt',
      'architecture',
      'techStack',
      'libraryVersions'
    ]);
    expect(result.content).toContain('architecture: "hand-written"');
  });

  it('when a managed field carries a trailing comment, should keep the comment and the note above it', () => {
    // given: a frontmatter where a human annotated the managed fields
    // when: the machine fields are refreshed
    // then: the value moved and both notes survived — the yaml node end used to
    const before = [
      '---',
      'schemaVersion: 1',
      '# version map is re-read from package.json on refresh',
      'capturedAt: 2026-01-01T00:00:00.000Z  # last hand edit',
      'techStack: {}',
      'libraryVersions:',
      '  vitest: ^3.0.0',
      'architecture: "hand-written prose"',
      '---',
      '',
      '# body',
      ''
    ].join('\n');

    const result = refreshProjectScanFields(before, {
      capturedAt: '2026-11-15T00:00:00.000Z',
      techStack: { language: 'typescript' },
      libraryVersions: { vitest: '^4.1.10' }
    });

    // swallow the trailing comment, which is exactly the prose a refresh protects
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toContain('capturedAt: 2026-11-15T00:00:00.000Z  # last hand edit');
    expect(result.content).toContain('# version map is re-read from package.json on refresh');
    expect(result.content).toContain('architecture: "hand-written prose"');
  });

  it('when the frontmatter cannot be parsed, should report the refusal instead of rewriting', () => {
    // given: a scan whose frontmatter is not YAML
    // when: a refresh is attempted
    // then: the refusal is structured, so the caller can leave the file alone
    const before = ['---', 'schemaVersion: 1', 'broken: [unclosed', '---', '', '# body', ''].join(
      '\n'
    );

    const result = refreshProjectScanFields(before, {
      capturedAt: '2026-11-15T00:00:00.000Z',
      techStack: {},
      libraryVersions: {}
    });

    expect(result).toEqual({ ok: false, reason: 'frontmatter-unparseable' });
  });

  it('when a shell is inspected, should be recognised only when architecture AND techStack are empty', () => {
    // given: a 0-1 shell, and the same shell with either field populated
    // when: each variant is classified
    // then: one populated field is enough to make it sediment
    const shell = [
      '---',
      'schemaVersion: 1',
      'capturedAt: 2026-01-01T00:00:00.000Z',
      'techStack: {}',
      'libraryVersions: {}',
      'architecture: ""',
      'karpathySelfCheck: {}',
      '---',
      '',
      '# body',
      ''
    ].join('\n');

    const shellIsEmpty = isUnpopulatedProjectScan(shell);
    const withArchitecture = isUnpopulatedProjectScan(
      shell.replace('architecture: ""', 'architecture: "hand-written"')
    );
    const withTechStack = isUnpopulatedProjectScan(
      shell.replace('techStack: {}', 'techStack:\n  language: typescript')
    );

    expect(shellIsEmpty).toBe(true);
    expect(withArchitecture).toBe(false);
    expect(withTechStack).toBe(false);
  });
});

describe('(integration) the bootstrap refresh path on a real project root', () => {
  it('when an existing hand-authored scan is bootstrapped, should update libraryVersions and keep the prose', async () => {
    // given: an existing project whose scan records an old vitest major
    // when: the bootstrap asks for a machine-field refresh
    // then: the versions moved, the prose did not, and the file was not recreated
    const root = makeExistingProject('peaks-refresh-sediment-');
    writeScan(root, HAND_AUTHORED);
    const before = readFileSync(join(root, '.peaks', 'project-scan', 'project-scan.md'), 'utf8');

    const envelope = await bootstrapProjectScan({ projectRoot: root, refreshMachineFields: true });

    const after = readFileSync(join(root, '.peaks', 'project-scan', 'project-scan.md'), 'utf8');
    expect(envelope.refreshed).toBe(true);
    expect(envelope.created).toBe(false);
    expect(after).toContain('  vitest: ^4.1.10');
    expect(after).not.toContain('vitest: ^3.0.0');
    expect(after).toContain('techStack:\n  language: typescript\n  packageManager: pnpm@10.11.0');
    expect(after).toContain(
      'architecture: |\n  src/services/ holds one module per concern.\n' +
        '  Hand-written: the c8 gate was removed on purpose.'
    );
    expect(bodyOf(after)).toBe(bodyOf(before));
  });

  it('when the refreshed file is read back, should parse through readProjectScan', async () => {
    // given: a hand-authored scan with the old shape
    // when: the bootstrap refreshes it and the canonical reader reads it
    // then: the machine consumer sees the refreshed values and the prose
    const root = makeExistingProject('peaks-refresh-reader-');
    writeScan(root, HAND_AUTHORED);

    await bootstrapProjectScan({ projectRoot: root, refreshMachineFields: true });
    const parsed = await readProjectScan(root);

    expect(parsed).not.toBeNull();
    expect(parsed?.capturedAt).toBe(parsed?.capturedAt.trim());
    expect(parsed?.libraryVersions.vitest).toBe('^4.1.10');
    expect(parsed?.techStack.language).toBe('typescript');
    expect(parsed?.architecture).toContain('the c8 gate was removed on purpose');
    expect(parsed?.karpathySelfCheck.simpleFirst).toBe('800-line file cap');
  });

  it('when a never-populated shell exists, should fill it without any option being passed', async () => {
    // given: an existing project holding the old empty shell
    // when: the bootstrap runs with no refresh option at all
    // then: the shell was upgraded, not skipped, and the reader accepts it
    const root = makeExistingProject('peaks-refresh-shell-');
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

    const envelope = await bootstrapProjectScan({ projectRoot: root });

    const after = readFileSync(join(root, '.peaks', 'project-scan', 'project-scan.md'), 'utf8');
    const parsed = await readProjectScan(root);
    expect(envelope.refreshed).toBe(true);
    expect(envelope.skipped).toBe(false);
    expect(after).toContain('  language: typescript');
    expect(parsed?.libraryVersions.vitest).toBe('^4.1.10');
    expect(after).toContain('# Project Scan (0-1 bootstrap)');
  });

  it('when a still-0-1 project holds the placeholder, should keep the skip semantics', async () => {
    // given: a project with no package.json and its 0-1 placeholder scan
    // when: the bootstrap runs again
    // then: the placeholder is left alone — it is truthful, not stale
    const root = makeRoot('peaks-refresh-zero-');
    const first = await bootstrapProjectScan({ projectRoot: root, refreshMachineFields: true });

    const second = await bootstrapProjectScan({ projectRoot: root, refreshMachineFields: true });

    expect(first.created).toBe(true);
    expect(second.skipped).toBe(true);
    expect(second.refreshed).toBe(false);
  });

  it('when a populated scan is bootstrapped without the option, should still skip it', async () => {
    // given: a scan with populated architecture
    // when: the bootstrap runs without `refreshMachineFields`
    // then: `peaks workspace init`'s sediment semantics are unchanged
    const root = makeExistingProject('peaks-refresh-noopt-');
    writeScan(root, HAND_AUTHORED);
    const before = readFileSync(join(root, '.peaks', 'project-scan', 'project-scan.md'), 'utf8');

    const envelope = await bootstrapProjectScan({ projectRoot: root });

    const after = readFileSync(join(root, '.peaks', 'project-scan', 'project-scan.md'), 'utf8');
    expect(envelope.skipped).toBe(true);
    expect(after).toBe(before);
  });

  it('when forceTemplates is passed, should still overwrite only the 4 bundled templates', async () => {
    // given: a project whose scan and templates all exist
    // when: `--force-project-scan-templates` is passed
    // then: the templates were rewritten and project-scan.md was not
    const root = makeExistingProject('peaks-refresh-templates-');
    writeScan(root, HAND_AUTHORED);
    await bootstrapProjectScan({ projectRoot: root });
    const scanBefore = readFileSync(
      join(root, '.peaks', 'project-scan', 'project-scan.md'),
      'utf8'
    );

    const envelope = await bootstrapProjectScan({
      projectRoot: root,
      forceTemplates: true
    });

    const scanAfter = readFileSync(join(root, '.peaks', 'project-scan', 'project-scan.md'), 'utf8');
    expect(envelope.templatesBooted).toBe(4);
    expect(scanAfter).toBe(scanBefore);
  });
});
