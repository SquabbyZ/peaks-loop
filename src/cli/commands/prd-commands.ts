/**
 * peaks prd handoff CLI — v2.11.0 (Tier 3 in
 * `v2-11-rd-techdoc-removal-and-runtime-friction`).
 *
 * Wires `services/prd/handoff-service.ts` to the command surface:
 *
 *   peaks prd handoff init   — produce + write a sha256-locked handoff
 *   peaks prd handoff verify — re-read + recompute hash; report
 *   peaks prd handoff show   — print the raw handoff markdown
 *
 * Help text MUST NOT reference the legacy `peaks prd write-handoff`
 * subcommand (AC-1 in the v2.11.0 PRD). The legacy service module at
 * `services/handoff/` is a separate slice-025 layout (different
 * schema) and is intentionally not exposed here.
 */

import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { initHandoff, readHandoff, showHandoff, verifyHandoff, writeHandoff } from '../../services/prd/handoff-service.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

type HandoffInitOptions = {
  rid: string;
  sid: string;
  changeId: string;
  body: string;
  goals?: string;
  ac?: string;
  preserve?: string;
  apply?: boolean;
  project?: string;
  json?: boolean;
};

type HandoffVerifyOptions = {
  path: string;
  json?: boolean;
};

type HandoffShowOptions = {
  path: string;
  json?: boolean;
};

/** Split a comma-separated string into a trimmed, non-empty list.
 *  Empty / undefined input → empty array. */
function splitCsv(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Resolve the `--body` argument: if it starts with `@`, read the
 *  referenced file as UTF-8; otherwise treat as a literal string. */
async function resolveBody(bodyArg: string): Promise<string> {
  if (bodyArg.startsWith('@')) {
    const filePath = bodyArg.slice(1);
    return readFile(filePath, 'utf8');
  }
  return bodyArg;
}

export function registerPrdCommands(program: Command, io: ProgramIO): void {
  const prd = program.command('prd').description('peaks-prd role: artifact + handoff primitives');

  const handoff = prd.command('handoff').description('Write / verify / show the immutable PRD handoff (sha256-locked, schemaVersion: 2)');

  // peaks prd handoff init
  addJsonOption(
    handoff
      .command('init')
      .description('Initialize an immutable handoff: sha256(body) → frontmatter → write to .peaks/_runtime/<sid>/prd/handoff.md')
      .requiredOption('--rid <request-id>', 'request id (e.g. 001-v2-11-cc-group-b)')
      .requiredOption('--sid <session-id>', 'session id (e.g. 2026-06-26-session-a28d69)')
      .requiredOption('--change-id <change-id>', 'change-id (e.g. v2-11-rd-techdoc-removal-and-runtime-friction)')
      .requiredOption('--body <body>', 'handoff body markdown, or @<file> to read from disk')
      .option('--goals <ids>', 'comma-separated goal ids (e.g. G1,G2,G3)')
      .option('--ac <ids>', 'comma-separated acceptance-criteria ids (e.g. AC-1,AC-2)')
      .option('--preserve <ids>', 'comma-separated preserved-behavior ids (e.g. P1,P12)')
      .option('--project <path>', 'target project root (defaults to cwd)')
      .option('--apply', 'actually write the file (default is dry-run preview)')
  ).action(async (options: HandoffInitOptions) => {
    try {
      const body = await resolveBody(options.body);
      const projectRoot = options.project ?? process.cwd();
      const writtenAt = new Date().toISOString();
      const handoff = initHandoff({
        requestId: options.rid,
        sessionId: options.sid,
        changeId: options.changeId,
        body,
        writtenAt,
        goals: splitCsv(options.goals),
        acceptanceCriteria: splitCsv(options.ac),
        preservedBehavior: splitCsv(options.preserve),
      });
      if (options.apply !== true) {
        printResult(io, ok('prd.handoff.init', {
          dryRun: true,
          requestId: handoff.frontmatter.requestId,
          sessionId: handoff.frontmatter.sessionId,
          changeId: handoff.frontmatter.changeId,
          schemaVersion: handoff.frontmatter.schemaVersion,
          handoffHash: handoff.frontmatter.handoffHash,
          handoffPath: handoff.frontmatter.handoffPath,
          bodyBytes: Buffer.byteLength(body, 'utf8'),
          goals: handoff.frontmatter.goals,
          acceptanceCriteria: handoff.frontmatter.acceptanceCriteria,
          preservedBehavior: handoff.frontmatter.preservedBehavior
        }), options.json);
        return;
      }
      const written = await writeHandoff(handoff, projectRoot);
      printResult(io, ok('prd.handoff.init', {
        applied: true,
        path: written.path,
        hash: written.hash,
        requestId: handoff.frontmatter.requestId,
        sessionId: handoff.frontmatter.sessionId,
        changeId: handoff.frontmatter.changeId
      }), options.json);
    } catch (error) {
      printResult(
        io,
        fail('prd.handoff.init', 'HANDOFF_INIT_FAILED', getErrorMessage(error), { rid: options.rid, sid: options.sid }, ['Check --body syntax (@<file> or literal) and re-run']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  // peaks prd handoff verify
  addJsonOption(
    handoff
      .command('verify')
      .description('Re-read a handoff file and re-compute the sha256; report ok or reason')
      .requiredOption('--path <file>', 'absolute path to the handoff file')
  ).action(async (options: HandoffVerifyOptions) => {
    try {
      const probe = await verifyHandoff(options.path);
      if (!probe.ok) {
        printResult(io, fail('prd.handoff.verify', 'HANDOFF_VERIFY_FAILED',
          probe.reason ?? 'unknown', probe, ['Re-init the handoff with `peaks prd handoff init --apply` to restore integrity']), options.json);
        process.exitCode = 1;
        return;
      }
      printResult(io, ok('prd.handoff.verify', { ok: true, hash: probe.actualHash, path: options.path }), options.json);
    } catch (error) {
      printResult(io, fail('prd.handoff.verify', 'HANDOFF_VERIFY_FAILED', getErrorMessage(error), { path: options.path }, ['Check the path and ensure the file is readable']), options.json);
      process.exitCode = 1;
    }
  });

  // peaks prd handoff show
  addJsonOption(
    handoff
      .command('show')
      .description('Print the raw handoff markdown (frontmatter + body) for human display')
      .requiredOption('--path <file>', 'absolute path to the handoff file')
  ).action(async (options: HandoffShowOptions) => {
    try {
      const content = await showHandoff(options.path);
      const handoff = await readHandoff(options.path);
      if (options.json === true) {
        printResult(io, ok('prd.handoff.show', {
          path: options.path,
          frontmatter: handoff.frontmatter,
          bodyBytes: Buffer.byteLength(content, 'utf8'),
          body: content
        }), true);
        return;
      }
      io.stdout(content);
      if (!content.endsWith('\n')) io.stdout('\n');
    } catch (error) {
      printResult(io, fail('prd.handoff.show', 'HANDOFF_SHOW_FAILED', getErrorMessage(error), { path: options.path }, ['Check the path and ensure the file is readable']), options.json);
      process.exitCode = 1;
    }
  });
}