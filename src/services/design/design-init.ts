/**
 * The design contract lifecycle — init. It writes `tokens.json`,
 * `paved-road.json`, `contract.md`, the exemplar README and the governance
 * standard on a first run, and rewrites only the machine-owned `engine.json`
 * on refresh. `tokens.json` and `contract.md` keep the user's content unless
 * `force` says otherwise.
 *
 * The read and teardown halves (`design status`, `design uninit`) live in
 * their own module so this file answers one question.
 */
import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { normalizePath } from '../../shared/path-utils.js';
import { scanExistingSystem } from '../scan/existing-system-service.js';
import type { VisualToken } from '../scan/scan-types.js';
import { renderDesignContractMarkdown } from './contract-render.js';
import { writeDesignContractFile, writeMachineDesignFile } from './contract-writer.js';
import { resolveContractRoot } from './contract-root.js';
import { designContractPaths, readJson, type DesignTokenCounts } from './design-status.js';
import {
  DESIGN_EXEMPLARS_README,
  DESIGN_GOVERNANCE_RELATIVE_PATH,
  writeDesignGovernanceStandard
} from './design-standard.js';
import type { ContractRoot } from './design-types.js';
import { buildEngineContract } from './engine-contract.js';
import { buildPavedRoad, stringList, uniqueList, type PavedRoadFile } from './paved-road.js';
import { reportPrimaryColor, type PrimaryColorReport } from './primary-color.js';
import { buildTokenContract, type DesignTokensFile } from './token-contract.js';

type DesignInitError = { ok: false; code: string; message: string; candidates?: string[] };

export type DesignInitResult =
  | {
      ok: true;
      root: ContractRoot;
      written: string[];
      preserved: string[];
      tokensFound: number;
      /** The derived primary colour, its provenance, and any recorded gap. */
      primary: PrimaryColorReport;
    }
  | DesignInitError;

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
  readonly exclude?: readonly string[];
  /** A confirmed render address recorded as `engine.json`'s `render.url`. */
  readonly url?: string;
};

const DEFAULT_ENGINE_PORT = 3000;
const DEFAULT_PAGE_ROOTS = ['src/pages', 'src/routes', 'src/features', 'src/app'] as const;
const DEFAULT_PAGES = ['/'] as const;
const DEFAULT_ARCHETYPES = ['list', 'form'] as const;

function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function countTokens(file: DesignTokensFile): DesignTokenCounts {
  return {
    color: Object.keys(file.color).length,
    space: Object.keys(file.space).length,
    font: Object.keys(file.font).length,
    radius: Object.keys(file.radius).length
  };
}

/**
 * The token file's colour group read back as scan tokens, so the primary is
 * derived from exactly what the contract stores (first value per key wins).
 */
function colorTokens(color: unknown): VisualToken[] {
  if (color === null || typeof color !== 'object' || Array.isArray(color)) return [];
  return Object.entries(color as Record<string, { $value?: unknown }>).flatMap(([name, token]) =>
    typeof token.$value === 'string' ? [{ name, value: token.$value, source: '' }] : []
  );
}

/**
 * Explicit `--page-roots`/`--exclude` are additive and de-duplicated: a re-run
 * with the same flags changes nothing, and a forced rewrite keeps every entry
 * the file already had — it never deletes `exclude`, `rules`, or an exemplar.
 */
function mergePavedRoad(
  fresh: PavedRoadFile,
  existing: Record<string, unknown>,
  options: Pick<DesignInitOptions, 'pageRoots' | 'exclude'>
): PavedRoadFile {
  const road: PavedRoadFile = { ...fresh, ...existing };
  if (options.pageRoots !== undefined) {
    road.pageRoots = uniqueList([...stringList(existing.pageRoots), ...options.pageRoots]);
  }
  road.exclude = uniqueList([...stringList(existing.exclude), ...(options.exclude ?? [])]);
  return road;
}

type PreparedInit = {
  root: ContractRoot;
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
    tokensFile: buildTokenContract(tokens),
    tokensFound: tokens.length,
    engineContent: toJson(
      buildEngineContract({
        cwd: root.appRelPath,
        startCommand: options.startCommand ?? null,
        port: options.port ?? DEFAULT_ENGINE_PORT,
        pages: options.pages ?? DEFAULT_PAGES,
        archetypes: options.archetypes ?? DEFAULT_ARCHETYPES,
        ...(options.url === undefined ? {} : { url: options.url })
      })
    )
  };
}

type WriteInitialInput = {
  readonly options: DesignInitOptions;
  readonly prepared: PreparedInit;
  readonly primary: PrimaryColorReport;
  readonly rel: (absolute: string) => string;
  readonly written: string[];
  readonly preserved: string[];
};

async function writeInitialDesignFiles(input: WriteInitialInput): Promise<void> {
  const { options, prepared, primary, rel, written, preserved } = input;
  const { root, tokensFile, engineContent } = prepared;
  const paths = designContractPaths(root);
  const road = mergePavedRoad(
    buildPavedRoad({
      pageRoots: options.pageRoots ?? DEFAULT_PAGE_ROOTS,
      componentEntrypoints: existsSync(join(root.appRoot, 'components.json'))
        ? ['@/components/ui']
        : [],
      ...(options.exclude === undefined ? {} : { exclude: options.exclude })
    }),
    readJson(paths.paved),
    options
  );

  const write = async (filePath: string, content: string, force = options.force): Promise<void> => {
    const result = await writeDesignContractFile({
      filePath,
      content,
      force,
      projectRoot: options.projectRoot
    });
    (result.written ? written : preserved).push(rel(filePath));
  };
  await write(paths.tokens, toJson(tokensFile));
  await write(paths.paved, toJson(road));
  await write(
    paths.contract,
    renderDesignContractMarkdown({
      appRelPath: root.appRelPath,
      tokenCounts: countTokens(tokensFile),
      primary: primary.color
    })
  );
  const readmePath = join(root.designRoot, 'exemplars', 'README.md');
  await write(readmePath, DESIGN_EXEMPLARS_README, false);

  await writeMachineDesignFile(paths.engine, engineContent, options.projectRoot);
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
  const { root, engineContent, tokensFound, tokensFile } = prepared;
  const paths = designContractPaths(root);
  const colorSource = options.refresh === true ? readJson(paths.tokens).color : tokensFile.color;
  const primary = reportPrimaryColor(colorTokens(colorSource));
  const rel = (absolute: string): string => relative(options.projectRoot, absolute);
  const written: string[] = [];
  const preserved: string[] = [];

  if (options.refresh === true) {
    await writeMachineDesignFile(paths.engine, engineContent, options.projectRoot);
    written.push(rel(paths.engine));
    for (const path of [paths.tokens, paths.paved, paths.contract]) {
      if (existsSync(path)) preserved.push(rel(path));
    }
    const standardPath = resolve(options.projectRoot, DESIGN_GOVERNANCE_RELATIVE_PATH);
    if (existsSync(standardPath)) preserved.push(rel(standardPath));
    return { ok: true, root, written, preserved, tokensFound, primary };
  }

  await writeInitialDesignFiles({ options, prepared, primary, rel, written, preserved });
  return { ok: true, root, written, preserved, tokensFound, primary };
}
