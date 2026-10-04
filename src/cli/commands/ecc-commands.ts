/**
 * `peaks ecc install|status|ls|show` — the ECC read layer.
 *
 * ECC's agent definitions come from the `ecc-universal` npm dependency of
 * `peaks-loop-mut`. `install` copies `<package>/agents/*.md` into the
 * plugin-free dir the LLM reads (`~/.peaks/agents/ecc/`); `status`, `ls` and
 * `show` read that copy. There is no download anywhere in this file: the
 * previous design fetched a GitHub release tarball on the premise that the
 * project was not on npm, and that premise was false (`ecc-universal`
 * `repository.url` is `git+https://github.com/affaan-m/ECC.git`).
 *
 *   - `peaks ecc install` — land/refresh the copy. Idempotent; prunes agents the
 *     installed package no longer ships.
 *   - `peaks ecc status` — package version + what landed and when.
 *   - `peaks ecc ls` — the roster with declared name + description (D-009
 *     fallback to filename + first body line when frontmatter is malformed).
 *   - `peaks ecc show <name> [--section H] [--max-lines N]` — the agent body;
 *     this is the Skill-first path the LLM consumes directly.
 *
 * Per the "Enhancement, not new AI CLI" tenet: read-only access plus a local
 * copy. There is no `peaks ecc run`, and no ECC subprocess is spawned.
 */
import type { Command } from 'commander';
import {
  EccSourceError,
  eccPackageInfo,
  installEccAgents,
  listEccAgents,
  readEccMaterializeManifest,
  readMaterializedAgent
} from 'peaks-loop-mut';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok, type ResultEnvelope } from 'peaks-loop-shared/result';

export function registerEccCommands(program: Command, io: ProgramIO): void {
  const ecc = program
    .command('ecc')
    .description(
      'ECC agents from the bundled `ecc-universal` dependency: copy + read-only access for the LLM (no subprocess; no peaks agent run).'
    );

  addJsonOption(
    ecc
      .command('install')
      .description(
        'Copy <node_modules>/ecc-universal/agents/*.md into ~/.peaks/agents/ecc/ (idempotent).'
      )
  ).action((_options: { json?: boolean }) => {
    const asJson = _options.json === true;
    try {
      const result = installEccAgents();
      const envelope: ResultEnvelope<typeof result> = ok(
        'ecc.install',
        result,
        [],
        [
          `Materialized ${result.materialized.length} ECC agent(s) at ${result.targetDir}`,
          `Source: ecc-universal@${result.packageVersion}`,
          'Inspect with: peaks ecc ls',
          'Consume one agent with: peaks ecc show <name>'
        ]
      );
      printResult(io, envelope, asJson);
    } catch (error: unknown) {
      const missing = error instanceof EccSourceError;
      printResult(
        io,
        fail(
          'ecc.install',
          missing ? 'ECC_PACKAGE_MISSING' : 'ECC_INSTALL_FAILED',
          getErrorMessage(error),
          { source: missing ? error.failure : 'copy-failed' },
          missing
            ? [
                'The `ecc-universal` dependency is not resolvable from this installation.',
                'Reinstall peaks-loop (`npm i -g peaks-loop@latest`) — the ECC agents ship inside that dependency.',
                'A partial or `--ignore-scripts` install can leave the dependency tree incomplete.'
              ]
            : ['Check that ~/.peaks is writable, then re-run `peaks ecc install`.']
        ),
        asJson
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    ecc
      .command('status')
      .description('Show the ECC source version and the materialized copy state.')
  ).action((options: { json?: boolean }) => {
    const asJson = options.json === true;
    const manifest = readEccMaterializeManifest();
    if (manifest === null) {
      printResult(
        io,
        fail(
          'ecc.status',
          'NOT_INSTALLED',
          'No materialized ECC agents found. Run `peaks ecc install` first.',
          { installed: false },
          [
            'Run `peaks ecc install` to copy the bundled ecc-universal agents into ~/.peaks/agents/ecc/.'
          ]
        ),
        asJson
      );
      process.exitCode = 1;
      return;
    }
    let source: { name: string; version: string } | null = null;
    try {
      source = eccPackageInfo();
    } catch {
      // The copy on disk is still the honest answer about what the LLM can read;
      // a source that no longer resolves is reported as such rather than hiding
      // the whole status behind an error.
    }
    printResult(
      io,
      ok(
        'ecc.status',
        { manifest, source },
        [],
        [
          source === null
            ? 'The ecc-universal package no longer resolves — the copy above is what will be read.'
            : `Source resolves to ${source.name}@${source.version}.`,
          'Inspect agents with: peaks ecc ls',
          'Print one agent with: peaks ecc show <name>'
        ]
      ),
      asJson
    );
  });

  addJsonOption(
    ecc
      .command('ls')
      .description(
        'List materialized agents from ~/.peaks/agents/ecc/*.md with parsed frontmatter.'
      )
  ).action((options: { json?: boolean }) => {
    const asJson = options.json === true;
    const agents = listEccAgents();
    printResult(
      io,
      ok('ecc.ls', { agents }, [], ['Print one with: `peaks ecc show <name>`']),
      asJson
    );
  });

  addJsonOption(
    ecc
      .command('show <name>')
      .description('Print agent SKILL.md to stdout (LLM-consumable; Skill-first path).')
      .option(
        '--section <heading>',
        'extract only the named H1 section (# <heading> through next # )'
      )
      .option('--max-lines <n>', 'cap stdout at N lines (default: unlimited)')
  ).action((name: string, options: { section?: string; maxLines?: string; json?: boolean }) => {
    const asJson = options.json === true;
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      printResult(
        io,
        fail(
          'ecc.show',
          'INVALID_NAME',
          `agent name must match ^[a-z][a-z0-9-]*$ (got "${name}")`,
          { name },
          ['Run `peaks ecc ls` to see valid agent names.']
        ),
        asJson
      );
      process.exitCode = 1;
      return;
    }
    const body = readMaterializedAgent(name);
    if (body === null) {
      printResult(
        io,
        fail('ecc.show', 'NOT_FOUND', `agent "${name}" is not in the materialized copy`, { name }, [
          'Run `peaks ecc ls` to see available agents.',
          'Or run `peaks ecc install` to (re-)copy the bundled agents into ~/.peaks/agents/ecc/.'
        ]),
        asJson
      );
      process.exitCode = 1;
      return;
    }

    let filtered = body;
    if (typeof options.section === 'string' && options.section.length > 0) {
      const heading = options.section.trim();
      const lines = body.split(/\r?\n/);
      const startIdx = lines.findIndex((line) =>
        new RegExp(`^#\\s+${escapeRegExp(heading)}\\s*$`).test(line)
      );
      if (startIdx === -1) {
        printResult(
          io,
          fail(
            'ecc.show',
            'SECTION_NOT_FOUND',
            `section "# ${heading}" not found in ${name}.md`,
            { name, section: heading },
            ['Open the file directly to see section names.']
          ),
          asJson
        );
        process.exitCode = 1;
        return;
      }
      let endIdx = lines.length;
      for (let i = startIdx + 1; i < lines.length; i += 1) {
        const line = lines[i] ?? '';
        if (/^#\s+/.test(line)) {
          endIdx = i;
          break;
        }
      }
      filtered = lines.slice(startIdx, endIdx).join('\n');
    }

    if (typeof options.maxLines === 'string' && options.maxLines.length > 0) {
      const cap = Number.parseInt(options.maxLines, 10);
      if (Number.isInteger(cap) && cap > 0) {
        const lines = filtered.split(/\r?\n/);
        if (lines.length > cap) filtered = lines.slice(0, cap).join('\n');
      }
    }

    if (asJson) {
      printResult(io, ok('ecc.show', { name, body: filtered }, [], []), asJson);
      return;
    }
    // Human-readable path: raw SKILL.md body to stdout (LLM-consumable).
    io.stdout(filtered);
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
