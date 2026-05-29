import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { lintSop, readSopManifest } from './sop-service.js';
import type { RegisteredGate, RegisteredSop, SopRegistry } from './sop-types.js';

/**
 * SOP gate registry — Feature A, Slice 2.
 *
 * `registerSop` validates a SOP (must lint clean) then upserts its gates into a
 * workspace-level registry at `.peaks/sops/registry.json`. The registry is the
 * single enumerable, countable source a future metering layer (Feature B) would
 * read — Slice 2 only records and counts; it applies NO limit, tier, or billing
 * logic. Built-in peaks-* gates are never recorded here.
 */

const EMPTY_REGISTRY: SopRegistry = { version: 1, sops: [], gateCount: 0 };

export type RegisterSopResult = {
  id: string;
  registered: RegisteredSop;
  /** Total gates across all registered SOPs after this upsert (the workspace pool count). */
  gateCount: number;
  /** false when --dry-run previewed the registration without writing registry.json. */
  applied: boolean;
};

export type RegisterSopOptions = {
  projectRoot: string;
  id: string;
  allowCommands?: boolean;
  /** Preview the registration without writing registry.json. */
  dryRun?: boolean;
};

function registryPath(projectRoot: string): string {
  return join(projectRoot, '.peaks', 'sops', 'registry.json');
}

function relativeManifestPath(id: string): string {
  return `.peaks/sops/${id}/sop.json`;
}

function countGates(sops: RegisteredSop[]): number {
  // Tolerate a hand-edited / corrupted registry: a malformed entry counts as 0
  // gates rather than crashing the read-only `sop registry` command.
  return sops.reduce((total, sop) => total + (Array.isArray(sop?.gates) ? sop.gates.length : 0), 0);
}

export async function readRegistry(projectRoot: string): Promise<SopRegistry> {
  const path = registryPath(projectRoot);
  if (!existsSync(path)) {
    return { ...EMPTY_REGISTRY, sops: [] };
  }
  const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<SopRegistry>;
  const sops = Array.isArray(parsed.sops) ? parsed.sops : [];
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
  const manifest = await readSopManifest(options.projectRoot, options.id);
  if (manifest === null) {
    throw new SopRegisterError('SOP_NOT_FOUND', `No SOP found for id "${options.id}"`);
  }

  const lintOptions: Parameters<typeof lintSop>[0] = { projectRoot: options.projectRoot, id: options.id };
  if (options.allowCommands === true) {
    lintOptions.allowCommands = true;
  }
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

  const current = await readRegistry(options.projectRoot);
  const others = current.sops.filter((sop) => sop.id !== manifest.id);
  const sops = [...others, registered].sort((left, right) => left.id.localeCompare(right.id));
  const registry: SopRegistry = { version: 1, sops, gateCount: countGates(sops) };

  if (options.dryRun === true) {
    return { id: manifest.id, registered, gateCount: registry.gateCount, applied: false };
  }

  const path = registryPath(options.projectRoot);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');

  return { id: manifest.id, registered, gateCount: registry.gateCount, applied: true };
}
