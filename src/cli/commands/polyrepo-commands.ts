/**
 * `peaks polyrepo *` — polyrepo workflow CLI surface.
 *
 * Slice S2-b of RD-2 (2026-07-08 session). Three subcommands:
 *
 *   init      — scan the parent dir for child git repos + write a
 *               polyrepo manifest to `.peaks/polyrepo.json`.
 *   status    — read the persisted manifest + report children.
 *   dispatch  — mirror a PRD/RD/QA artifact from the parent into
 *               each target child's
 *               `.peaks/_runtime/<sid>/<role>/` directory.
 *
 * Per the project's two-axis convention, all reviewable artifacts
 * live under `.peaks/_runtime/<sid>/<role>/` — never as top-level
 * siblings of `.peaks/_runtime/`.
 */
import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok, getErrorMessage } from 'peaks-loop-shared/result';

import { PolyrepoService } from '../../services/polyrepo/polyrepo-service.js';

export interface PolyrepoInitOptions {
  json?: boolean;
  root?: string;
  children?: string;
}

export interface PolyrepoStatusOptions {
  json?: boolean;
  root?: string;
}

export interface PolyrepoDispatchOptions {
  json?: boolean;
  root?: string;
  rid?: string;
  to?: string;
  role?: 'prd' | 'rd' | 'qa';
  artifact?: string;
  sid?: string;
}

function parseChildren(raw: string | undefined): string[] | undefined {
  if (raw === undefined || raw.length === 0) return undefined;
  return raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

function resolveRoot(explicit: string | undefined): string {
  if (explicit !== undefined && explicit.length > 0) return explicit;
  return process.cwd();
}

export function registerPolyrepoCommands(program: Command, io: ProgramIO): void {
  const polyrepo = program
    .command('polyrepo')
    .description('Polyrepo workflow (parent dir + child git repos with their own .peaks/ subsets)');

  // -----------------------------------------------------------------
  // 1. peaks polyrepo init [--children <dir1,dir2>] [--root <dir>]
  // -----------------------------------------------------------------
  addJsonOption(
    polyrepo
      .command('init')
      .description('Scan the parent dir for child git repos and write .peaks/polyrepo.json')
      .option('--children <list>', 'comma-separated child directory names (defaults to auto-discovery)')
      .option('--root <path>', 'parent root (defaults to cwd)')
  ).action((options: PolyrepoInitOptions) => {
    try {
      const root = resolveRoot(options.root);
      const svc = new PolyrepoService();
      const children = parseChildren(options.children);
      const result = children === undefined
        ? svc.init({ root })
        : svc.init({ root, children });
      printResult(io, ok('polyrepo.init', {
        root: result.manifest.root,
        detectedAt: result.manifest.detectedAt,
        children: result.manifest.children,
        manifestPath: `${result.manifest.root}/.peaks/polyrepo.json`,
        created: result.created
      }, [], [
        result.manifest.children.length === 0
          ? 'No child git repos detected. Pass --children <dir1,dir2> to override.'
          : `Run \`peaks polyrepo dispatch --rid <rid> --to <child-id>\` to mirror an artifact into one or more children.`
      ]), options.json);
    } catch (error) {
      printResult(io, fail('polyrepo.init', 'POLYREPO_INIT_FAILED', getErrorMessage(error), {}, ['Verify --root exists and is a directory']), options.json);
      process.exitCode = 1;
    }
  });

  // -----------------------------------------------------------------
  // 2. peaks polyrepo status [--root <dir>]
  // -----------------------------------------------------------------
  addJsonOption(
    polyrepo
      .command('status')
      .description('Report the persisted polyrepo manifest + children')
      .option('--root <path>', 'parent root (defaults to cwd)')
  ).action((options: PolyrepoStatusOptions) => {
    try {
      const root = resolveRoot(options.root);
      const svc = new PolyrepoService();
      const result = svc.status(root);
      if (!result.manifestExists) {
        printResult(io, ok('polyrepo.status', { ...result, initialized: false }, [], [
          'No polyrepo manifest found. Run `peaks polyrepo init [--children <list>]` first.'
        ]), options.json);
        return;
      }
      printResult(io, ok('polyrepo.status', { ...result, initialized: true }, [], [
        result.children.length === 0
          ? 'Manifest exists but has no children. Re-run `peaks polyrepo init --children <list>`.'
          : `Run \`peaks polyrepo dispatch --rid <rid> --to <child-id>\` to mirror an artifact.`
      ]), options.json);
    } catch (error) {
      printResult(io, fail('polyrepo.status', 'POLYREPO_STATUS_FAILED', getErrorMessage(error), {}, []), options.json);
      process.exitCode = 1;
    }
  });

  // -----------------------------------------------------------------
  // 3. peaks polyrepo dispatch --rid <rid> [--to <child-id>] --role <prd|rd|qa> --artifact <path>
  // -----------------------------------------------------------------
  addJsonOption(
    polyrepo
      .command('dispatch')
      .description('Mirror a PRD/RD/QA artifact from the parent into one or more children')
      .requiredOption('--rid <rid>', 'request id (used in the on-disk filename)')
      .option('--to <list>', 'comma-separated child ids (defaults to all children in the manifest)')
      .requiredOption('--role <role>', 'artifact role: prd | rd | qa')
      .requiredOption('--artifact <path>', 'source artifact path (relative to --root or absolute)')
      .option('--sid <sid>', 'session id override (defaults to the canonical binding)')
      .option('--root <path>', 'parent root (defaults to cwd)')
  ).action((options: PolyrepoDispatchOptions) => {
    try {
      const root = resolveRoot(options.root);
      const sid = options.sid ?? 'default';
      const rid = options.rid ?? '';
      const role = options.role;
      if (role !== 'prd' && role !== 'rd' && role !== 'qa') {
        printResult(io, fail('polyrepo.dispatch', 'INVALID_ROLE', `--role must be prd | rd | qa (got "${role}")`, {}, [
          'Re-run with --role prd (or rd / qa).'
        ]), options.json);
        process.exitCode = 1;
        return;
      }
      const artifact = options.artifact ?? '';
      if (!existsSync(artifact)) {
        printResult(io, fail('polyrepo.dispatch', 'ARTIFACT_NOT_FOUND', `source artifact does not exist: ${artifact}`, {}, [
          'Verify the path or pass an absolute path.'
        ]), options.json);
        process.exitCode = 1;
        return;
      }

      // Resolve targets from the manifest first so we can default to
      // "all children" when --to is omitted.
      const svc = new PolyrepoService();
      const status = svc.status(root);
      if (!status.manifestExists) {
        printResult(io, fail('polyrepo.dispatch', 'NO_MANIFEST', `no polyrepo manifest at ${root}/.peaks/polyrepo.json`, {}, [
          'Run `peaks polyrepo init` first.'
        ]), options.json);
        process.exitCode = 1;
        return;
      }

      let targets: string[];
      if (options.to !== undefined && options.to.length > 0) {
        targets = options.to.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
      } else {
        targets = status.children.map((c) => c.id);
      }

      const result = svc.dispatch(root, {
        sid, rid, targets, role, artifactPath: artifact
      });

      const allOk = result.perChild.every((c) => c.ok);
      printResult(io, ok('polyrepo.dispatch', {
        root,
        sid,
        rid,
        role,
        artifact,
        dispatch: result.dispatch,
        perChild: result.perChild,
        allOk
      }, result.warnings, [
        allOk
          ? `Mirrored artifact to ${result.perChild.length} child(ren).`
          : `One or more child mirrors failed; inspect perChild[].ok.`
      ]), options.json);
      if (!allOk) process.exitCode = 1;
    } catch (error) {
      printResult(io, fail('polyrepo.dispatch', 'POLYREPO_DISPATCH_FAILED', getErrorMessage(error), {}, []), options.json);
      process.exitCode = 1;
    }
  });
}