/**
 * Reading and tearing down a design contract: `design status` and
 * `design uninit`, plus the tolerant JSON reader that init shares with them.
 *
 * These live apart from the init lifecycle so each file answers one question.
 * Every path a contract owns is defined once, in `designContractPaths`, so
 * init, status and uninit cannot drift on where the files live.
 */
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { MS_PER_DAY } from '../scan/archetype-detection.js';
import { resolveContractRoot } from './contract-root.js';
import { removeDesignGovernanceStandard } from './design-standard.js';
import type { ContractRoot } from './design-types.js';

/** The token totals `design status` reports. */
export type DesignTokenCounts = { color: number; space: number; font: number; radius: number };

export type DesignRootInput = { readonly projectRoot: string; readonly appPath?: string };

export type DesignStatusResult = {
  adopted: boolean;
  contractVersion: string | null;
  contractAgeDays: number | null;
  tokenCounts: DesignTokenCounts;
};

export type RemoveDesignResult =
  { ok: true; removed: string[] } | { ok: false; code: string; message: string };

type DesignPaths = { tokens: string; paved: string; engine: string; contract: string };

/** The four files one contract owns, in a fixed order. */
export function designContractPaths(root: ContractRoot): DesignPaths {
  return {
    tokens: join(root.designRoot, 'tokens.json'),
    paved: join(root.designRoot, 'paved-road.json'),
    engine: join(root.designRoot, 'engine.json'),
    contract: join(root.designRoot, 'contract.md')
  };
}

/** A missing or hand-broken JSON file reads as empty, never as a crash. */
export function readJson(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readTokenCounts(filePath: string): DesignTokenCounts {
  const parsed = readJson(filePath);
  const count = (value: unknown): number =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.keys(value).length
      : 0;
  return {
    color: count(parsed.color),
    space: count(parsed.space),
    font: count(parsed.font),
    radius: count(parsed.radius)
  };
}

function readContractVersion(enginePath: string): string | null {
  const version = readJson(enginePath).contractVersion;
  return typeof version === 'string' ? version : null;
}

function contractAgeDays(filePath: string): number | null {
  const stats = statSync(filePath, { throwIfNoEntry: false });
  if (stats === undefined) return null;
  return Math.max(0, Math.floor((Date.now() - stats.mtimeMs) / MS_PER_DAY));
}

const UNADOPTED: DesignStatusResult = {
  adopted: false,
  contractVersion: null,
  contractAgeDays: null,
  tokenCounts: { color: 0, space: 0, font: 0, radius: 0 }
};

export async function readDesignStatus(input: DesignRootInput): Promise<DesignStatusResult> {
  const resolved = await resolveContractRoot(input).catch(() => null);
  if (resolved === null || !resolved.ok) return UNADOPTED;
  const paths = designContractPaths(resolved.root);
  return {
    adopted: [paths.tokens, paths.paved, paths.engine, paths.contract].every((path) =>
      existsSync(path)
    ),
    contractVersion: readContractVersion(paths.engine),
    contractAgeDays: contractAgeDays(paths.contract),
    tokenCounts: readTokenCounts(paths.tokens)
  };
}

export async function removeDesignContract(input: DesignRootInput): Promise<RemoveDesignResult> {
  const resolved = await resolveContractRoot(input);
  if (!resolved.ok) {
    return { ok: false, code: resolved.code, message: resolved.message };
  }
  const paths = designContractPaths(resolved.root);
  const removed: string[] = [];
  for (const path of [paths.contract, paths.tokens, paths.paved, paths.engine]) {
    for (const candidate of [path, `${path}.bak`]) {
      if (!existsSync(candidate)) continue;
      rmSync(candidate, { force: true });
      removed.push(relative(input.projectRoot, candidate));
    }
  }
  const standard = await removeDesignGovernanceStandard(input.projectRoot);
  if (standard.removed) removed.push(relative(input.projectRoot, standard.path));
  return { ok: true, removed };
}
