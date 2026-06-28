/**
 * v2.15.0 follow-up — G7: peaks doc * CLI.
 *
 *   - `peaks doc generate-skill --name <name> --from <dir>`
 *   - `peaks doc changelog-suggest --since <git-ref>`
 *
 * See `src/services/doc/doc-generator.ts` for the underlying logic.
 */

import type { Command } from 'commander';
import { resolve as resolvePath } from 'node:path';
import { findProjectRoot } from '../../services/config/config-safety.js';
import {
  generateSkillFromCommands,
  gitLogSince,
  renderSkillMarkdown,
  suggestChangelog
} from '../../services/doc/doc-generator.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';

export function registerDocCommands(program: Command, io: ProgramIO): void {
  const doc = program
    .command('doc')
    .description('v2.15.0 follow-up G7: documentation auto-generation (skill skeletons + changelog suggestions).');

  addJsonOption(
    doc
      .command('generate-skill')
      .description(
        'Generate a SKILL.md skeleton by scanning a CLI commands directory for ' +
          '`program.command(...)` exports and `.description(...)` calls. ' +
          'Emits markdown on stdout (or with --output to a file).'
      )
      .requiredOption('--name <name>', 'skill name (e.g. peaks-ice-cola)')
      .requiredOption('--from <dir>', 'directory containing CLI command files')
      .option('--output <file>', 'write to file (default: stdout)')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((opts: { name: string; from: string; output?: string; project?: string; json?: boolean }) => {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const dir = resolvePath(opts.from);
    const skill = generateSkillFromCommands(opts.name, dir);
    const md = renderSkillMarkdown(skill);
    if (opts.output !== undefined) {
      // Write to file
      try {
        const { writeFileSync, mkdirSync } = require('node:fs') as typeof import('node:fs');
        mkdirSync(resolvePath(opts.output, '..'), { recursive: true });
        writeFileSync(resolvePath(opts.output), md, 'utf8');
        printResult(io, ok('doc.generate-skill', { projectRoot, output: opts.output, sections: skill.sections.length, bytes: md.length }, [], [
          `Wrote ${md.length} bytes to ${opts.output}`
        ]), opts.json ?? false);
      } catch (err) {
        printResult(io, fail('doc.generate-skill', 'WRITE_FAILED', (err as Error).message, { projectRoot }, []), opts.json ?? false);
        process.exitCode = 1;
      }
      return;
    }
    printResult(io, ok('doc.generate-skill', { projectRoot, markdown: md, sections: skill.sections.length }, [], [
      `Generated ${skill.sections.length} section(s). Pipe into a .md file or redirect.`
    ]), opts.json ?? false);
  });

  addJsonOption(
    doc
      .command('changelog-suggest')
      .description(
        'Diff the git log since a given ref (commit / tag / branch) and emit a ' +
          '"## [Unreleased]" block categorized by conventional-commit subject. ' +
          'Useful for half-automating CHANGELOG.md updates.'
      )
      .requiredOption('--since <ref>', 'git ref (commit hash, tag, branch) to diff against')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((opts: { since: string; project?: string; json?: boolean }) => {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const entries = gitLogSince(projectRoot, opts.since);
    const md = suggestChangelog(entries);
    printResult(io, ok('doc.changelog-suggest', { projectRoot, since: opts.since, entryCount: entries.length, markdown: md }, [], [
      `Parsed ${entries.length} commit(s) since ${opts.since}.`
    ]), opts.json ?? false);
  });
}
