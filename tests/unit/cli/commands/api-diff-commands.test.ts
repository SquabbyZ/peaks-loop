import { afterEach, describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeCapturedIo } from '../../_setup/io.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';
import { registerApiDiffCommands } from '../../../../src/cli/commands/api-diff-commands.js';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/api-diff/', import.meta.url));

function programWithScanGroup(): Command {
  const program = new Command();
  // `api-diff` attaches itself to the existing `scan` parent, so the parent
  // must exist first — exactly as it does in `_register.ts`.
  program.command('scan').description('read-only project scans');
  return program;
}

describe('registerApiDiffCommands', () => {
  const ws = withTmpWorkspacePerTest('peaks-api-diff-cli-');

  afterEach(() => {
    process.exitCode = undefined;
  });

  it('when the input is not an OpenAPI 3.x document, should exit non-zero and print no diff output', async () => {
    // given: a program exposing `scan api-diff` and a non-OpenAPI JSON file
    // when: the command runs against that file
    // then: it fails loudly, exits non-zero, and prints no diff sections
    const { io, captured } = makeCapturedIo();
    const program = programWithScanGroup();
    registerApiDiffCommands(program, io);

    await program.parseAsync(
      ['scan', 'api-diff', join(FIXTURES, 'not-openapi.json'), '--project', ws().path],
      { from: 'user' }
    );

    expect(process.exitCode).toBe(1);
    expect(captured.stderrText()).toContain('NOT_OPENAPI_3');
    expect(captured.text()).not.toContain('Exact —');
    expect(captured.text()).not.toContain('Candidate mentions');
  });

  it('when the document declares no operations, should exit non-zero rather than printing an empty diff', async () => {
    // given: a valid OpenAPI 3.0.3 file whose `paths` object is empty
    // when: the command runs against that file
    // then: the empty-but-successful outcome is refused
    const { io, captured } = makeCapturedIo();
    const program = programWithScanGroup();
    registerApiDiffCommands(program, io);

    await program.parseAsync(
      ['scan', 'api-diff', join(FIXTURES, 'no-operations.json'), '--project', ws().path],
      { from: 'user' }
    );

    expect(process.exitCode).toBe(1);
    expect(captured.stderrText()).toContain('refusing to print an empty diff');
    expect(captured.text()).not.toContain('Exact —');
  });

  it('when a valid document is diffed, should print the labelled sections and the not-detectable footer', async () => {
    // given: a valid OpenAPI 3.x document and a project with no recorded sources
    // when: the command runs without --json
    // then: the text contract is honoured and the missing sources are named
    const { io, captured } = makeCapturedIo();
    const program = programWithScanGroup();
    registerApiDiffCommands(program, io);

    await program.parseAsync(
      ['scan', 'api-diff', join(FIXTURES, 'users-api.json'), '--project', ws().path],
      { from: 'user' }
    );

    expect(process.exitCode).toBeUndefined();
    expect(captured.text()).toContain('Exact — document parsed vs recorded interfaces parsed');
    expect(captured.text()).toContain('Candidate mentions — name-grep, may OVER- and UNDER-report');
    expect(captured.text()).toContain('Not detectable by this command');
    expect(captured.text()).toContain('note: no recorded interfaces found');
    // With no recorded side there is no diff, so the Candidate section is empty
    // with a note — never a wall of greps for fields that did not change.
    expect(captured.text()).toContain('  (none)');
    expect(captured.text()).toContain('change-site lookup needs a parsed recorded interface');
  });

  it('when the doc path is relative and --project is different, should resolve against CWD not --project', async () => {
    // given: the document under a subdirectory of a project root that is not the CWD
    // when: the command is given a CWD-relative path plus --project
    // then: the path is not re-rooted under --project, so the document is found
    const consumer = join(ws().path, 'consumer');
    mkdirSync(join(consumer, 'docs'), { recursive: true });
    copyFileSync(join(FIXTURES, 'users-api.json'), join(consumer, 'docs', 'users-api.json'));
    const { io, captured } = makeCapturedIo();
    const program = programWithScanGroup();
    registerApiDiffCommands(program, io);

    await program.parseAsync(
      ['scan', 'api-diff', 'consumer/docs/users-api.json', '--project', consumer],
      { from: 'user' }
    );

    expect(process.exitCode).toBeUndefined();
    expect(captured.text()).toContain('Exact — document parsed vs recorded interfaces parsed');
    expect(captured.stderrText()).not.toContain('UNREADABLE');
  });

  it('when --json is passed, should carry an explicit confidence discriminator on every line', async () => {
    // given: the same valid document, requested as JSON
    // when: the command runs with --json
    // then: the envelope parses and each emitted line carries its own discriminator
    const { io, captured } = makeCapturedIo();
    const program = programWithScanGroup();
    registerApiDiffCommands(program, io);

    await program.parseAsync(
      ['scan', 'api-diff', join(FIXTURES, 'users-api.json'), '--project', ws().path, '--json'],
      { from: 'user' }
    );

    const parsed = JSON.parse(captured.text()) as {
      ok: boolean;
      data: {
        exact: { endpoints: { confidence: string }[]; fields: { confidence: string }[] };
        candidates: { confidence: string }[];
        notDetectable: string[];
      };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.data.notDetectable).toHaveLength(3);
    expect(parsed.data.candidates.every((entry) => entry.confidence === 'candidate')).toBe(true);
    expect(parsed.data.exact.endpoints.every((entry) => entry.confidence === 'exact')).toBe(true);
    expect(parsed.data.exact.fields.every((entry) => entry.confidence === 'exact')).toBe(true);
  });
});
