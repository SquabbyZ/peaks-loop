/**
 * The design contract lifecycle — init, status, uninit, and refresh. Each file
 * has an owner: engine.json is machine-owned, tokens.json and contract.md keep
 * the user's content unless `force` says otherwise, paved-road.json keeps its
 * own `rules`, and the governance standard lives and dies with the contract.
 */
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import { normalizePath } from '../../shared/path-utils.js';
import { MS_PER_DAY } from '../scan/archetype-detection.js';
import { scanExistingSystem } from '../scan/existing-system-service.js';
import { renderDesignContractMarkdown } from './contract-render.js';
import { writeDesignContractFile } from './contract-writer.js';
import { resolveContractRoot } from './contract-root.js';
import {
  DESIGN_GOVERNANCE_RELATIVE_PATH,
  removeDesignGovernanceStandard,
  writeDesignGovernanceStandard
} from './design-standard.js';
import type { ContractRoot } from './design-types.js';
import { buildEngineContract } from './engine-contract.js';
import { buildPavedRoad, type PavedRoadFile } from './paved-road.js';
import { buildTokenContract, type DesignTokensFile } from './token-contract.js';

/** The token totals `design status` reports. */
export type DesignTokenCounts = { color: number; space: number; font: number; radius: number };

type DesignInitError = { ok: false; code: string; message: string; candidates?: string[] };

export type DesignInitResult =
  | {
      ok: true;
      root: ContractRoot;
      written: string[];
      preserved: string[];
      tokensFound: number;
    }
  | DesignInitError;

export type DesignStatusResult = {
  adopted: boolean;
  contractVersion: string | null;
  contractAgeDays: number | null;
  tokenCounts: DesignTokenCounts;
};

export type RemoveDesignResult =
  { ok: true; removed: string[] } | { ok: false; code: string; message: string };

export type DesignInitOptions = {
  readonly projectRoot: string;
  readonly appPath?: string;
  readonly force?: boolean;
  /** Rewrite only `engine.json`; leave every other file as it is. */
  readonly refresh?: boolean;
  readonly startCommand?: string | null;
  readonly port?: number;
  readonly pages?: readonly string[];
  readonly archetypes?: readonly string[];
  readonly pageRoots?: readonly string[];
};

export type DesignRootInput = { readonly projectRoot: string; readonly appPath?: string };

const DEFAULT_ENGINE_PORT = 3000;
const DEFAULT_PAGE_ROOTS = ['src/pages', 'src/routes', 'src/features', 'src/app'] as const;
const DEFAULT_PAGES = ['/'] as const;
const DEFAULT_ARCHETYPES = ['list', 'form'] as const;

function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

type DesignPaths = { tokens: string; paved: string; engine: string; contract: string };

function designPaths(root: ContractRoot): DesignPaths {
  return {
    tokens: join(root.designRoot, 'tokens.json'),
    paved: join(root.designRoot, 'paved-road.json'),
    engine: join(root.designRoot, 'engine.json'),
    contract: join(root.designRoot, 'contract.md')
  };
}

/** A missing or hand-broken JSON file reads as empty, never as a crash. */
function readJson(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function countTokens(file: DesignTokensFile): DesignTokenCounts {
  return {
    color: Object.keys(file.color).length,
    space: Object.keys(file.space).length,
    font: Object.keys(file.font).length,
    radius: Object.keys(file.radius).length
  };
}

/** An existing `paved-road.json` keeps its own `rules`, even through `--force`. */
function readExistingRules(filePath: string): PavedRoadFile['rules'] | null {
  const rules = readJson(filePath).rules;
  return rules !== null && typeof rules === 'object' && !Array.isArray(rules)
    ? (rules as PavedRoadFile['rules'])
    : null;
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

type PreparedInit = {
  root: ContractRoot;
  paths: DesignPaths;
  tokensFile: DesignTokensFile;
  engineContent: string;
  tokensFound: number;
};

async function prepareInit(options: DesignInitOptions): Promise<PreparedInit | DesignInitError> {
  const resolved = await resolveContractRoot({
    projectRoot: options.projectRoot,
    ...(options.appPath === undefined ? {} : { appPath: options.appPath })
  });
  if (!resolved.ok) {
    return {
      ok: false,
      code: resolved.code,
      message: resolved.message,
      ...(resolved.candidates === undefined ? {} : { candidates: resolved.candidates })
    };
  }
  const root = resolved.root;
  const scan = await scanExistingSystem({ projectRoot: root.appRoot });
  const tokens = [
    ...scan.visualTokens.colors,
    ...scan.visualTokens.spacing,
    ...scan.visualTokens.typography,
    ...scan.visualTokens.radii
  ];
  return {
    root,
    paths: designPaths(root),
    tokensFile: buildTokenContract(tokens),
    tokensFound: tokens.length,
    engineContent: toJson(
      buildEngineContract({
        cwd: root.appRelPath,
        startCommand: options.startCommand ?? null,
        port: options.port ?? DEFAULT_ENGINE_PORT,
        pages: options.pages ?? DEFAULT_PAGES,
        archetypes: options.archetypes ?? DEFAULT_ARCHETYPES
      })
    )
  };
}

type WriteInitialInput = {
  readonly options: DesignInitOptions;
  readonly prepared: PreparedInit;
  readonly rel: (absolute: string) => string;
  readonly written: string[];
  readonly preserved: string[];
};

async function writeInitialDesignFiles(input: WriteInitialInput): Promise<void> {
  const { options, prepared, rel, written, preserved } = input;
  const { root, paths, tokensFile, engineContent } = prepared;
  const road = buildPavedRoad({
    pageRoots: options.pageRoots ?? DEFAULT_PAGE_ROOTS,
    componentEntrypoints: existsSync(join(root.appRoot, 'components.json'))
      ? ['@/components/ui']
      : []
  });
  const existingRules = readExistingRules(paths.paved);
  if (existingRules !== null) road.rules = existingRules;

  const write = async (filePath: string, content: string): Promise<void> => {
    const result = await writeDesignContractFile({ filePath, content, force: options.force });
    (result.written ? written : preserved).push(rel(filePath));
  };
  await write(paths.tokens, toJson(tokensFile));
  await write(paths.paved, toJson(road));
  await write(
    paths.contract,
    renderDesignContractMarkdown({
      appRelPath: root.appRelPath,
      tokenCounts: countTokens(tokensFile)
    })
  );

  await mkdir(root.designRoot, { recursive: true });
  await writeFile(paths.engine, engineContent, 'utf8');
  written.push(rel(paths.engine));

  const standard = await writeDesignGovernanceStandard({
    projectRoot: options.projectRoot,
    designRelPath: normalizePath(relative(options.projectRoot, root.designRoot))
  });
  (standard.written ? written : preserved).push(rel(standard.path));
}

export async function initDesignContract(options: DesignInitOptions): Promise<DesignInitResult> {
  const prepared = await prepareInit(options);
  if (!('root' in prepared)) return prepared;
  const { root, paths, engineContent, tokensFound } = prepared;
  const rel = (absolute: string): string => relative(options.projectRoot, absolute);
  const written: string[] = [];
  const preserved: string[] = [];

  if (options.refresh === true) {
    await mkdir(root.designRoot, { recursive: true });
    await writeFile(paths.engine, engineContent, 'utf8');
    written.push(rel(paths.engine));
    for (const path of [paths.tokens, paths.paved, paths.contract]) {
      if (existsSync(path)) preserved.push(rel(path));
    }
    const standardPath = resolve(options.projectRoot, DESIGN_GOVERNANCE_RELATIVE_PATH);
    if (existsSync(standardPath)) preserved.push(rel(standardPath));
    return { ok: true, root, written, preserved, tokensFound };
  }

  await writeInitialDesignFiles({ options, prepared, rel, written, preserved });
  return { ok: true, root, written, preserved, tokensFound };
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
  const paths = designPaths(resolved.root);
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
  const paths = designPaths(resolved.root);
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
