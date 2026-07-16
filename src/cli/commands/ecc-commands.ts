/**
 * `peaks ecc install|status|ls|show` — Slice 3 of 4.0.0-beta.11.
 *
 * Drop-in replacement for the deleted `peaks agent run|list`
 * surface. The pre-Slice-3 implementation shelled out to
 * `npx ecc agent run ...`, but the upstream `affaan-m/everything-claude-code`
 * v2.0.0 release has NO `ecc` binary — the repo is `agents/*.md`
 * flat files plus SKILL.md descriptors.
 *
 * The new flow:
 *   - `peaks ecc install [--ref <tag>]` downloads the ECC tarball
 *     into `~/.peaks/cache/ecc-<sha>/agents/` (selective extract,
 *     agents/*.md only).
 *   - `peaks ecc status` reports the cache manifest state.
 *   - `peaks ecc ls` lists cached agents from `<cache>/agents/*.md`,
 *     parsing YAML frontmatter (with D-009 fallback to filename +
 *     first body line when frontmatter is malformed).
 *   - `peaks ecc show <name> [--section H] [--max-lines N]` prints
 *     the SKILL.md body to stdout — this is the Skill-first path
 *     the LLM consumes directly.
 *
 * The `--section` filter extracts a single H1 (`# heading`)
 * through the next H1 — useful when the SKILL.md is large.
 *
 * Per the "Enhancement, not new AI CLI" tenet: this command is a
 * download + read-only access layer. There is no `peaks ecc run`.
 */
import { Command } from 'commander';
import {
  downloadToCache,
  listCachedAgents,
  readAgentSkill,
  readCacheManifest,
} from '../../services/agent/ecc-cache-service.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok, type ResultEnvelope } from '../../shared/result.js';

export function registerEccCommands(program: Command, io: ProgramIO): void {
  const ecc = program
    .command('ecc')
    .description(
      'affaan-m/everything-claude-code cache: download + read-only access for the LLM (no subprocess; no peaks agent run).'
    );

  addJsonOption(
    ecc
      .command('install')
      .description('Download affaan-m/ECC to ~/.peaks/cache/ecc-<sha>/ (selective extract: agents/ subtree only).')
      .option('--ref <tag>', 'release tag (default: latest)')
  ).action(async (options: { ref?: string; json?: boolean }) => {
    const asJson = options.json === true;
    try {
      const result = await downloadToCache(
        options.ref !== undefined && options.ref.length > 0 ? { ref: options.ref } : {}
      );
      const envelope: ResultEnvelope<typeof result> = ok(
        'ecc.install',
        result,
        [],
        [
          `Cache landed at ~/.peaks/cache/ecc-${result.sha}/agents/`,
          `Inspect with: peaks ecc ls`,
          `Consume one agent with: peaks ecc show <name>`,
        ]
      );
      printResult(io, envelope, asJson);
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      printResult(
        io,
        fail('ecc.install', 'FETCH_FAILED', message, { ref: options.ref ?? 'latest' }, [
          'Network failure during ECC download. Manual fallback:',
          '  git clone https://github.com/affaan-m/everything-claude-code.git',
          '  Copy <repo>/agents/*.md into ~/.peaks/cache/ecc-<sha>/agents/.',
          '  Drop a minimal ecc-installed.json manifest into ~/.peaks/cache/.',
        ]),
        asJson
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    ecc
      .command('status')
      .description('Show ECC cache state (version, sha, fetchedAt, agent count).')
  ).action((options: { json?: boolean }) => {
    const asJson = options.json === true;
    const manifest = readCacheManifest();
    if (manifest === null) {
      printResult(
        io,
        fail(
          'ecc.status',
          'NO_CACHE',
          'No ECC cache found. Run `peaks ecc install` first.',
          { installed: false },
          ['Run `peaks ecc install [--ref <tag>]` to populate ~/.peaks/cache/ecc-<sha>/agents/.']
        ),
        asJson
      );
      process.exitCode = 1;
      return;
    }
    printResult(
      io,
      ok('ecc.status', manifest, [], [
        `Inspect agents with: peaks ecc ls`,
        `Print one agent with: peaks ecc show <name>`,
      ]),
      asJson
    );
  });

  addJsonOption(
    ecc
      .command('ls')
      .description('List cached agents from <cache>/agents/*.md with parsed frontmatter.')
  ).action((options: { json?: boolean }) => {
    const asJson = options.json === true;
    const agents = listCachedAgents();
    printResult(io, ok('ecc.ls', { agents }, [], [
      'Print one with: `peaks ecc show <name>`',
    ]), asJson);
  });

  addJsonOption(
    ecc
      .command('show <name>')
      .description('Print agent SKILL.md to stdout (LLM-consumable; Skill-first path).')
      .option('--section <heading>', 'extract only the named H1 section (# <heading> through next # )')
      .option('--max-lines <n>', 'cap stdout at N lines (default: unlimited)')
  ).action((name: string, options: { section?: string; maxLines?: string; json?: boolean }) => {
    const asJson = options.json === true;
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      printResult(
        io,
        fail('ecc.show', 'INVALID_NAME', `agent name must match ^[a-z][a-z0-9-]*$ (got "${name}")`, { name }, [
          'Run `peaks ecc ls` to see valid agent names.',
        ]),
        asJson
      );
      process.exitCode = 1;
      return;
    }
    const body = readAgentSkill(name);
    if (body === null) {
      printResult(
        io,
        fail('ecc.show', 'NOT_FOUND', `agent "${name}" is not in the cache`, { name }, [
          'Run `peaks ecc ls` to see available agents.',
          'Or run `peaks ecc install` to (re-)populate the cache.',
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
      const startIdx = lines.findIndex((line) => new RegExp(`^#\\s+${escapeRegExp(heading)}\\s*$`).test(line));
      if (startIdx === -1) {
        printResult(
          io,
          fail('ecc.show', 'SECTION_NOT_FOUND', `section "# ${heading}" not found in ${name}.md`, { name, section: heading }, [
            'Open the file directly to see section names.',
          ]),
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