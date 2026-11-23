/**
 * G1 source scan across a change set.
 *
 * Only files that can carry page markup are read: a changed file must exist
 * under `appRoot`, carry a scannable extension, live under one of the paved
 * road's `pageRoots`, and stay out of the design system's own internals
 * (`components/ui/**`). Everything else is out of scope, not a pass.
 */

import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';

import type { PavedRoadFile } from '../paved-road.js';
import type { DesignTokensFile } from '../token-contract.js';
import { DEFAULT_DESIGN_RULES } from './rules.js';
import { scanFile, type DesignFinding } from './scan-file.js';
import type { TokenCoverage } from './token-coverage.js';

export type { DesignFinding } from './scan-file.js';
export type { TokenCoverage } from './token-coverage.js';

export type ScanDesignSourcesInput = {
  appRoot: string;
  changedFiles: readonly string[];
  pavedRoad: PavedRoadFile;
  tokens: DesignTokensFile;
};

export type ScanDesignSourcesResult = {
  findings: DesignFinding[];
  coverage: TokenCoverage;
  scannedFiles: string[];
};

const SCANNABLE_EXTENSIONS = new Set(['.tsx', '.jsx', '.vue', '.svelte', '.ts', '.js']);
const DS_INTERNAL = /(^|\/)components\/ui\//;
const COVERAGE_THRESHOLD = 0.9;

function toRepoPath(appRoot: string, changedFile: string): string | null {
  const absolute = isAbsolute(changedFile) ? changedFile : resolve(appRoot, changedFile);
  const rel = relative(resolve(appRoot), absolute);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel.split(sep).join('/');
}

function isUnderPageRoot(file: string, pageRoots: readonly string[]): boolean {
  return pageRoots.some((root) => {
    const normalized = root.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    if (normalized === '') return true;
    return file === normalized || file.startsWith(`${normalized}/`);
  });
}

async function readIfPresent(absolutePath: string): Promise<string | null> {
  try {
    return await readFile(absolutePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function scanDesignSources(
  input: ScanDesignSourcesInput
): Promise<ScanDesignSourcesResult> {
  const findings: DesignFinding[] = [];
  const scannedFiles: string[] = [];
  let covered = 0;
  let total = 0;

  for (const changedFile of input.changedFiles) {
    const file = toRepoPath(input.appRoot, changedFile);
    if (file === null) continue;
    if (!SCANNABLE_EXTENSIONS.has(extname(file).toLowerCase())) continue;
    if (!isUnderPageRoot(file, input.pavedRoad.pageRoots)) continue;
    if (DS_INTERNAL.test(`/${file}`)) continue;

    const source = await readIfPresent(resolve(input.appRoot, file));
    if (source === null) continue;

    const fileResult = scanFile({
      file,
      source,
      pavedRoad: input.pavedRoad,
      tokens: input.tokens
    });
    findings.push(...fileResult.findings);
    covered += fileResult.coverage.covered;
    total += fileResult.coverage.total;
    scannedFiles.push(file);
  }

  scannedFiles.sort();
  const coverage: TokenCoverage = {
    covered,
    total,
    ratio: total === 0 ? 1 : covered / total
  };

  if (coverage.ratio < COVERAGE_THRESHOLD) {
    findings.push({
      code: 'DESIGN_TOKEN_COVERAGE',
      file: '',
      line: 0,
      severity:
        input.pavedRoad.rules.DESIGN_TOKEN_COVERAGE ?? DEFAULT_DESIGN_RULES.DESIGN_TOKEN_COVERAGE,
      message: `token coverage ${coverage.covered}/${coverage.total} (${coverage.ratio.toFixed(2)}) is below ${COVERAGE_THRESHOLD}`
    });
  }

  return { findings, coverage, scannedFiles };
}
