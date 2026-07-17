/**
 * `peaks runtime *` — vendor-runtime detection + compact CLI surface.
 *
 * Slice S2-a of RD-2 (2026-07-08 session). Four subcommands:
 *
 *   detect    — print which vendor is the active AI runtime
 *               (claude-code / codex / copilot / unknown).
 *   list      — list the built-in vendor adapters registered by
 *               RuntimeService (Claude Code / Codex / Copilot).
 *   compact   — invoke a vendor's compact verb via the adapter. The
 *               adapter (NOT this file) chooses the vendor verb;
 *               see src/services/runtime/vendors/<vendor>.ts.
 *
 * Vendor verb strings (`claude --compact`, `codex --compact`,
 * `copilot compact`) MUST live ONLY in `src/services/runtime/vendors/`
 * — verified by AC-1: `rg -n "claude --compact|codex --compact|copilot
 * compact" src/services/code/` returns 0 matches.
 *
 * `peaks runtime compact --via <id>` first consults the user
 * adapter registry (`.peaks/runtime/adapters.json`) for the id, then
 * falls back to the built-in adapter list. Missing vendor CLI
 * surfaces as exitCode=127 + warning, NOT as a fatal error — vendor
 * neutrality demands peaks-loop stay alive.
 */
import type { Command } from 'commander';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, getErrorMessage, ok } from 'peaks-loop-shared/result';

import { detectRuntime } from '../../services/runtime/runtime-detector.js';
import { RuntimeService } from '../../services/runtime/runtime-service.js';
import { AdapterRegistry } from '../../services/adapter/adapter-registry.js';

export interface RuntimeDetectOptions {
  json?: boolean;
}

export interface RuntimeListOptions {
  json?: boolean;
}

export interface RuntimeCompactOptions {
  json?: boolean;
  /** Vendor adapter id (built-in or registered). */
  via?: string;
  force?: boolean;
  /** Override the project root (defaults to .peaks runtime lookup). */
  project?: string;
}

function resolveProjectRoot(explicit: string | undefined): string {
  if (explicit !== undefined && explicit.length > 0) return explicit;
  return process.cwd();
}

export function registerRuntimeCommands(program: Command, io: ProgramIO): void {
  const runtime = program
    .command('runtime')
    .description('Vendor runtime detection + compact via adapter (--via <vendor-id>)');

  // -----------------------------------------------------------------
  // 1. peaks runtime detect [--json]
  // -----------------------------------------------------------------
  addJsonOption(
    runtime
      .command('detect')
      .description('Print the active AI runtime vendor (claude-code / codex / copilot / unknown)')
  ).action((options: RuntimeDetectOptions) => {
    try {
      const result = detectRuntime();
      printResult(io, ok('runtime.detect', result, [], [
        result.vendor === 'unknown'
          ? 'No vendor sentinel detected. Use `peaks adapter register --id <vendor> --binary <cmd>` to wire a custom one.'
          : `Run \`peaks runtime compact --via ${result.vendor}\` to invoke its compact verb.`
      ]), options.json);
    } catch (error) {
      printResult(io, fail('runtime.detect', 'RUNTIME_DETECT_FAILED', getErrorMessage(error), {}, ['Retry with a clean env']), options.json);
      process.exitCode = 1;
    }
  });

  // -----------------------------------------------------------------
  // 2. peaks runtime list [--json]
  // -----------------------------------------------------------------
  addJsonOption(
    runtime
      .command('list')
      .description('List the built-in vendor adapters registered by RuntimeService')
  ).action((options: RuntimeListOptions) => {
    try {
      const svc = new RuntimeService();
      const adapters = svc.listBuiltInAdapters().map((a) => ({ id: a.id, displayName: a.displayName }));
      printResult(io, ok('runtime.list', { builtIn: adapters }, [], [
        `Run \`peaks adapter register --id <vendor> --binary <cmd>\` to add a custom adapter (persists to .peaks/runtime/adapters.json).`
      ]), options.json);
    } catch (error) {
      printResult(io, fail('runtime.list', 'RUNTIME_LIST_FAILED', getErrorMessage(error), {}, []), options.json);
      process.exitCode = 1;
    }
  });

  // -----------------------------------------------------------------
  // 3. peaks runtime compact [--via <id>] [--force] [--json] [--project <root>]
  // -----------------------------------------------------------------
  addJsonOption(
    runtime
      .command('compact')
      .description('Compact the active vendor via the chosen adapter (--via <vendor-id>); vendor verbs live ONLY in adapter files')
      .option('--via <id>', 'vendor adapter id (built-in or user-registered)')
      .option('--force', 'ask the vendor to compact unconditionally')
      .option('--project <path>', 'project root (defaults to cwd)')
  ).action(async (options: RuntimeCompactOptions) => {
    try {
      const projectRoot = resolveProjectRoot(options.project);
      const requested = options.via;
      if (requested === undefined || requested.length === 0) {
        // No explicit --via: try to detect first, then fall back.
        const detected = detectRuntime();
        if (detected.vendor === 'unknown') {
          printResult(io, fail('runtime.compact', 'NO_VENDOR_SPECIFIED', 'No --via <id> provided and no vendor detected.', { detected }, [
            'Pass --via <vendor-id>, or run `peaks runtime detect` to see what was detected.'
          ]), options.json);
          process.exitCode = 1;
          return;
        }
        await runCompact(projectRoot, detected.vendor, options.force === true, io, options.json);
        return;
      }
      await runCompact(projectRoot, requested, options.force === true, io, options.json);
    } catch (error) {
      printResult(io, fail('runtime.compact', 'RUNTIME_COMPACT_FAILED', getErrorMessage(error), {}, []), options.json);
      process.exitCode = 1;
    }
  });
}

async function runCompact(
  projectRoot: string,
  viaId: string,
  force: boolean,
  io: ProgramIO,
  asJson: boolean | undefined
): Promise<void> {
  // Layer 1: user-registered adapter (via AdapterRegistry).
  const registryFile = AdapterRegistry.defaultFile(projectRoot);
  const registry = new AdapterRegistry();
  if (existsSync(registryFile)) {
    try {
      registry.load(registryFile);
    } catch { // TODO(g2): vendor-neutrality — corrupt adapter registry must NOT block peaks runtime
      // Treat corrupt registry as empty — vendor-neutrality: a corrupt
      // .peaks/runtime/adapters.json must NOT block peaks runtime.
      // We still try the built-in path below.
    }
  }
  const registered = registry.resolve(viaId);
  if (registered !== undefined) {
    const r = await registered.compact({ force });
    const warnings: string[] = [];
    if (r.exitCode === 127) {
      warnings.push(`binary for adapter "${viaId}" not found on PATH; compact is a no-op`);
    }
    printResult(io, ok('runtime.compact', { via: viaId, source: 'registry', compact: r }, warnings, [
      r.exitCode === 0
        ? 'Compact completed.'
        : `Compact exited with code ${r.exitCode}. Check stderr above.`
    ]), asJson);
    if (r.exitCode !== 0) process.exitCode = 1;
    return;
  }

  // Layer 2: built-in adapter (via RuntimeService).
  const svc = new RuntimeService();
  const r = await svc.compactVia(viaId, force);
  const warnings: string[] = [];
  if (r.warning !== undefined) warnings.push(r.warning);
  if (r.exitCode === 127) {
    warnings.push(`built-in adapter "${viaId}" binary not found on PATH; compact is a no-op`);
  }
  printResult(io, ok('runtime.compact', { via: viaId, source: 'built-in', compact: { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr } }, warnings, [
    r.exitCode === 0
      ? 'Compact completed.'
      : `Compact exited with code ${r.exitCode}. Check stderr above.`
  ]), asJson);
  if (r.exitCode !== 0) process.exitCode = 1;
}

/** Internal helper exposed for tests + future programmatic callers:
 *  resolve the registry file location, ensuring the parent dir
 *  exists. Idempotent. */
export function ensureRegistryDir(registryFile: string): void {
  mkdirSync(dirname(registryFile), { recursive: true });
}

/** Internal helper for tests: locate the registry file under the
 *  given project root. Thin wrapper so tests can stub the resolution. */
export function registryFileFor(projectRoot: string): string {
  const f = AdapterRegistry.defaultFile(projectRoot);
  ensureRegistryDir(f);
  return f;
}

/** Re-export the path join helper for completeness; not strictly
 *  needed by callers but keeps the module self-contained. */
export { join };