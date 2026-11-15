// tests/unit/cli/commands/project-context-refresh.test.ts
//
// WHY THIS FILE EXISTS. The refresh path is only worth having if a real user
// can reach it. The defect it fixes was not a missing function — it was an
// OPTION NOBODY SET: `BootstrapProjectScanOptions.force` was declared, read,
// and never passed `true` by any caller in the repository, so the third branch
// of `bootstrapProjectScan` was dead. A unit test of the service that drives the
// service directly would have passed against that dead branch too.
//
// So the arms here go through `createProgram()` and the real argv a user (or an
// LLM on their behalf) would type:
//   - `peaks project context --project <root>` refreshes the machine fields of
//     an existing scan BY DEFAULT, and reports `projectScan.refreshed: true`;
//   - `--no-project-scan-refresh` turns it off, leaving the file untouched;
//   - the hand-authored prose survives the default path byte for byte.
//
// Dimensions covered:
//   - integration: the real command tree, the real service, a real project tree
//   - render:      the JSON envelope the command prints
//   - a11y:        what the envelope says happened (`refreshed` vs `skipped`),
//                  which is the only channel the LLM has to tell the two apart
//
// Dimensions omitted:
//   - behavior: the decision table itself is covered where it lives, in
//     `tests/unit/services/prd/project-scan-field-refresh.test.ts`.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createProgram } from '~/src/cli/program';
import { declareDimensions } from '../../_setup/4dim-template.js';
import { makeCapturedIo } from '../../_setup/io.js';

declareDimensions(
  'tests/unit/cli/commands/project-context-refresh.test.ts',
  ['integration', 'render', 'a11y'],
  [
    {
      dim: 'behavior',
      reason: 'the refresh/skip decision table is covered in the service-level suite'
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
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const SCAN_RELATIVE = join('.peaks', 'project-scan', 'project-scan.md');

/** A project holding a hand-authored scan that records an old vitest major. */
function makeProjectWithScan(prefix: string): string {
  const root = makeRoot(prefix);
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture',
        packageManager: 'pnpm@10.11.0',
        devDependencies: { typescript: '^5.7.2', vitest: '^4.1.10' }
      },
      null,
      2
    ),
    'utf8'
  );
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'main.ts'), 'export const x = 1;\n', 'utf8');
  mkdirSync(join(root, '.peaks', 'project-scan'), { recursive: true });
  writeFileSync(
    join(root, SCAN_RELATIVE),
    [
      '---',
      'schemaVersion: 1',
      'capturedAt: 2026-01-01T00:00:00.000Z',
      'techStack:',
      '  language: typescript',
      'libraryVersions:',
      '  vitest: ^3.0.0',
      'architecture: |',
      '  Hand-authored: the c8 gate was removed on purpose.',
      'karpathySelfCheck: {}',
      '---',
      '',
      '# Project Scan (hand-authored)',
      '',
      '> vitest is pinned at 4.1.10 — do NOT propose 5.x; user directive.',
      ''
    ].join('\n'),
    'utf8'
  );
  return root;
}

/** Run `peaks project context` through the real program and return its envelope. */
async function runProjectContext(
  root: string,
  extraArgs: readonly string[] = []
): Promise<Record<string, unknown>> {
  const { io, captured } = makeCapturedIo();
  const program = createProgram(io);
  program.exitOverride();
  await program.parseAsync([
    'node',
    'peaks',
    'project',
    'context',
    '--project',
    root,
    '--json',
    ...extraArgs
  ]);
  return JSON.parse(captured.text()) as Record<string, unknown>;
}

/** The `data.projectScan` block of the envelope. */
function projectScanOf(envelope: Record<string, unknown>): Record<string, unknown> {
  const data = envelope['data'] as { readonly projectScan?: Record<string, unknown> };
  return data.projectScan ?? {};
}

describe('(integration) `peaks project context` reaches the refresh path', () => {
  it('when the command runs against an existing scan, should refresh its machine fields by default', async () => {
    // given: a project whose scan records an old vitest major
    // when: the command runs with no refresh flag at all
    // then: the versions moved and the prose did not
    const root = makeProjectWithScan('peaks-ctx-refresh-');

    await runProjectContext(root);

    const after = readFileSync(join(root, SCAN_RELATIVE), 'utf8');
    expect(after).toContain('  vitest: ^4.1.10');
    expect(after).not.toContain('vitest: ^3.0.0');
    expect(after).toContain('Hand-authored: the c8 gate was removed on purpose.');
    expect(after).toContain('vitest is pinned at 4.1.10 — do NOT propose 5.x');
  });

  it('when the command runs, should report the refresh in the envelope the LLM reads', async () => {
    // given: a project with an existing hand-authored scan
    // when: the command runs and prints its JSON envelope
    // then: the outcome is stated, not left to be inferred from the file
    const root = makeProjectWithScan('peaks-ctx-envelope-');

    const envelope = await runProjectContext(root);

    const projectScan = projectScanOf(envelope);
    expect(projectScan.refreshed).toBe(true);
    expect(projectScan.created).toBe(false);
    expect(projectScan.skipped).toBe(false);
  });

  it('when --no-project-scan-refresh is passed, should leave the file untouched', async () => {
    // given: a project whose scan records an old vitest major
    // when: the opt-out flag is passed
    // then: the file is byte-identical and the envelope says it was skipped
    const root = makeProjectWithScan('peaks-ctx-optout-');
    const before = readFileSync(join(root, SCAN_RELATIVE), 'utf8');

    const envelope = await runProjectContext(root, ['--no-project-scan-refresh']);

    const after = readFileSync(join(root, SCAN_RELATIVE), 'utf8');
    expect(after).toBe(before);
    expect(projectScanOf(envelope).skipped).toBe(true);
    expect(projectScanOf(envelope).refreshed).toBe(false);
  });

  it('when the flag is not supplied, should be declared as a negated option so absence means refresh', () => {
    // given: the command tree commander registers
    // when: the option's declared shape is read
    // then: commander's `--no-` form means absence parses to `true` and the
    const program = createProgram();
    const project = program.commands.find((c) => c.name() === 'project');
    const context = project?.commands.find((c) => c.name() === 'context');
    const option = context?.options.find((o) => o.long === '--no-project-scan-refresh');

    // flag parses to `false`, so the handler's `!== false` test is reachable
    // in both directions — an option nobody can turn on was the original bug
    expect(option).toBeDefined();
    expect(option?.negate).toBe(true);
  });
});

describe('(render) the envelope keys the refresh adds', () => {
  it('when a scan is refreshed, should carry refreshed true and no warning', async () => {
    // given: a refreshable scan
    // when: the command runs
    // then: `refreshed` is present and no `refreshWarning` was raised
    const root = makeProjectWithScan('peaks-ctx-keys-');

    const envelope = await runProjectContext(root);

    expect(envelope['ok']).toBe(true);
    const projectScan = projectScanOf(envelope);
    expect(Object.keys(projectScan)).toContain('refreshed');
    expect(Object.keys(projectScan)).not.toContain('refreshWarning');
  });

  it('when an unparseable scan exists, should report the reason rather than silently skipping', async () => {
    // given: an existing project whose scan frontmatter is not YAML
    // when: the command runs
    // then: the refusal names itself, and the file is left as it was
    const root = makeRoot('peaks-ctx-broken-');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture' }), 'utf8');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'main.ts'), 'export const x = 1;\n', 'utf8');
    mkdirSync(join(root, '.peaks', 'project-scan'), { recursive: true });
    writeFileSync(
      join(root, SCAN_RELATIVE),
      ['---', 'schemaVersion: 1', 'broken: [unclosed', '---', '', '# body', ''].join('\n'),
      'utf8'
    );

    const envelope = await runProjectContext(root);

    const projectScan = projectScanOf(envelope);
    expect(projectScan.skipped).toBe(true);
    expect(projectScan.refreshed).toBe(false);
    expect(String(projectScan.refreshWarning)).toContain('could not be parsed');
  });
});

describe('(a11y) what the refresh outcome says to a reader', () => {
  it('when the command refreshes a scan, should tell the reader which three fields moved', () => {
    // given: the command tree commander registers
    // when: the option's help text is read
    // then: it names the fields it turns off, so "no refresh" has a stated cost
    const program = createProgram();
    const project = program.commands.find((c) => c.name() === 'project');
    const context = project?.commands.find((c) => c.name() === 'context');
    const option = context?.options.find((o) => o.long === '--no-project-scan-refresh');

    expect(option?.description).toContain('capturedAt');
    expect(option?.description).toContain('techStack');
    expect(option?.description).toContain('libraryVersions');
  });
});
