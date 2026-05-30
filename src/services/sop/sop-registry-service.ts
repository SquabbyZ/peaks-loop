import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { lintSop } from './sop-service.js';
import { scopedRegistryPath, scopedSopManifestPath, type SopScope } from './sop-paths.js';
import type { RegisteredGate, RegisteredSop, SopManifest, SopRegistry } from './sop-types.js';

/**
 * SOP gate registry — Feature A (Slice 2) + team layer (Slice 4b).
 *
 * `registerSop` validates a SOP (must lint clean) then upserts its gates into a
 * registry. SOPs live in two layers: GLOBAL (`~/.peaks/sops/registry.json`, your
 * personal SOPs) and PROJECT (`<project>/.peaks/sops/registry.json`, committed
 * into the repo so teammates get them). `registerSop` writes to the layer the
 * caller targets (project when `projectRoot` is set, else global). `readRegistry`
 * returns the MERGED view (project entries win over global by id) so execution
 * and enumeration see every applicable SOP. The registry is the single
 * enumerable, countable source a future metering layer (Feature B) reads; this
 * slice only records and counts — NO limit, tier, or billing logic. Built-in
 * peaks-* gates are never recorded here.
 */

export type RegisterSopResult = {
  id: string;
  registered: RegisteredSop;
  /** Total gates across all registered SOPs after this upsert (the workspace pool count). */
  gateCount: number;
  /** Which layer the SOP was registered into. */
  scope: SopScope;
  /** false when --dry-run previewed the registration without writing registry.json. */
  applied: boolean;
};

export type RegisterSopOptions = {
  id: string;
  allowCommands?: boolean;
  /** Preview the registration without writing registry.json. */
  dryRun?: boolean;
  /** When set, register into the project layer (`<projectRoot>/.peaks/sops`) instead of global. */
  projectRoot?: string;
};

/** Manifest location relative to its Peaks home (`~/.peaks/` or `<project>/.peaks/`). Machine-independent. */
function relativeManifestPath(id: string): string {
  return `sops/${id}/sop.json`;
}

function countGates(sops: RegisteredSop[]): number {
  // Tolerate a hand-edited / corrupted registry: a malformed entry counts as 0
  // gates rather than crashing the read-only `sop registry` command.
  return sops.reduce((total, sop) => total + (Array.isArray(sop?.gates) ? sop.gates.length : 0), 0);
}

/** Read a single registry layer; empty when absent. Throws on corrupt JSON. */
async function readRegistryAt(scope: SopScope, projectRoot: string | undefined): Promise<RegisteredSop[]> {
  if (scope === 'project' && projectRoot === undefined) {
    return [];
  }
  const path = scopedRegistryPath(scope, projectRoot);
  if (!existsSync(path)) {
    return [];
  }
  const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<SopRegistry>;
  return Array.isArray(parsed.sops) ? parsed.sops : [];
}

/**
 * Read the registry that execution/enumeration should see: the MERGED view of
 * the project layer (when projectRoot is given) over the global layer — a
 * project entry wins over a global one with the same id. Without projectRoot,
 * the global registry only.
 */
export async function readRegistry(projectRoot?: string): Promise<SopRegistry> {
  const globalSops = await readRegistryAt('global', undefined);
  const projectSops = projectRoot !== undefined ? await readRegistryAt('project', projectRoot) : [];
  const byId = new Map<string, RegisteredSop>();
  for (const sop of globalSops) byId.set(sop.id, sop);
  for (const sop of projectSops) byId.set(sop.id, sop); // project wins
  const sops = [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
  return { version: 1, sops, gateCount: countGates(sops) };
}

export class SopRegisterError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'SopRegisterError';
    this.code = code;
  }
}

export async function registerSop(options: RegisterSopOptions): Promise<RegisterSopResult> {
  const scope: SopScope = options.projectRoot !== undefined ? 'project' : 'global';

  // Register the EXACT layer the caller targets — not the precedence resolution.
  const manifestPath = scopedSopManifestPath(scope, options.projectRoot, options.id);
  if (!existsSync(manifestPath)) {
    throw new SopRegisterError('SOP_NOT_FOUND', `No SOP found for id "${options.id}"`);
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as SopManifest;

  const lintOptions: Parameters<typeof lintSop>[0] = { id: options.id };
  if (options.allowCommands === true) lintOptions.allowCommands = true;
  if (options.projectRoot !== undefined) lintOptions.projectRoot = options.projectRoot;
  const lint = await lintSop(lintOptions);
  if (lint === null || !lint.ok) {
    throw new SopRegisterError('SOP_INVALID', `SOP "${options.id}" must lint clean before it can be registered`);
  }

  const gates: RegisteredGate[] = manifest.gates.map((gate) => ({
    ref: `${manifest.id}/${gate.id}`,
    gateId: gate.id,
    sopId: manifest.id,
    phase: gate.phase,
    transition: `${manifest.id}:${gate.phase}`
  }));
  const registered: RegisteredSop = { id: manifest.id, path: relativeManifestPath(manifest.id), gates };

  // Upsert within the SAME layer's registry (not the merged view).
  const current = await readRegistryAt(scope, options.projectRoot);
  const others = current.filter((sop) => sop.id !== manifest.id);
  const sops = [...others, registered].sort((left, right) => left.id.localeCompare(right.id));
  const registry: SopRegistry = { version: 1, sops, gateCount: countGates(sops) };

  if (options.dryRun === true) {
    return { id: manifest.id, registered, gateCount: registry.gateCount, scope, applied: false };
  }

  const path = scopedRegistryPath(scope, options.projectRoot);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');

  return { id: manifest.id, registered, gateCount: registry.gateCount, scope, applied: true };
}
