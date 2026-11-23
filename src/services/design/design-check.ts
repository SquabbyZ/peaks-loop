/** The source-only design check — S1's verdict matrix. A `pass` is only ever G1
 *  conformance plus an explicit, recorded acceptance; everything else is blocked. */
import { existsSync, readFileSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { normalizePath } from '../../shared/path-utils.js';
import { readGitChangeSet } from '../scan/file-size-baseline.js';
import { readRidChangeClaims } from '../scan/rid-change-claims.js';
import { scanExistingSystem } from '../scan/existing-system-service.js';
import { resolveContractRoot } from './contract-root.js';
import { DEFAULT_DESIGN_RULES, type DesignRuleCode } from './design-rules.js';
import { buildPavedRoad, type PavedRoadFile } from './paved-road.js';
import type { DesignFinding } from './source-scan/scan-file.js';
import { scanDesignSources, type ScanDesignSourcesResult } from './source-scan/scan.js';
import type { TokenCoverage } from './source-scan/token-coverage.js';
import type { DesignTokensFile } from './token-contract.js';

export type DesignCheckVerdict = 'pass' | 'fail' | 'blocked' | 'not-adopted' | 'not-applicable';

export type DesignCheckResult = {
  schemaVersion: 1;
  rid: string | null;
  verdict: DesignCheckVerdict;
  surface: { isUi: boolean | 'unknown'; reasons: string[] };
  checks: {
    g1_source: { status: 'pass' | 'fail' | 'not-applicable'; findings: DesignFinding[] };
    g2_render: { status: 'skipped'; reason: 'explicitly-accepted' | 's2-not-implemented' };
  };
  findings: DesignFinding[];
  coverage: TokenCoverage | null;
  errorCode?: string;
  message?: string;
  /** The session that recorded the user's acceptance; null when none was supplied. */
  acceptedBy?: string | null;
};

export type CheckDesignSourceOnlyInput = {
  projectRoot: string;
  appPath?: string;
  rid?: string | null;
  sessionId?: string;
  /** An explicit change set. It wins over every other source, including when empty. */
  changedFiles?: readonly string[];
  /** The git ref the working-tree change set is read against; defaults to `HEAD`. */
  base?: string;
  allowSourceOnly?: boolean;
  acceptNote?: string;
};

type CheckInput = CheckDesignSourceOnlyInput;

export class DesignCheckUsageError extends Error {
  readonly code = 'DESIGN_ACCEPT_NOTE_REQUIRED';
  constructor() {
    super("--allow-source-only requires --accept-note with the user's own words.");
    this.name = 'DesignCheckUsageError';
  }
}

const CONTRACT_FILES = ['contract.md', 'tokens.json', 'paved-road.json', 'engine.json'] as const;
const UI_EXTENSIONS = new Set('.tsx .jsx .vue .svelte .css .scss .sass .less .html'.split(' '));
const NOT_ADOPTED_MESSAGE =
  'No design contract is adopted for this app; run `peaks design init` first.';
const CHANGE_SET_UNKNOWN_MESSAGE =
  'The change set could not be resolved; an empty or unreadable change set is blocked, not a pass.';
const RENDER_NOT_IMPLEMENTED_MESSAGE =
  'S1 has no render engine, so G2 cannot run; a source-only pass needs an explicit acceptance.';

type ResultOverrides = Partial<Omit<DesignCheckResult, 'schemaVersion' | 'rid'>>;

function makeResult(rid: string | null, overrides: ResultOverrides): DesignCheckResult {
  return {
    schemaVersion: 1,
    rid,
    verdict: 'blocked',
    surface: { isUi: 'unknown', reasons: [] },
    checks: {
      g1_source: { status: 'not-applicable', findings: [] },
      g2_render: { status: 'skipped', reason: 's2-not-implemented' }
    },
    findings: [],
    coverage: null,
    ...overrides
  };
}

type VerdictExitCodes = [0, 1, 2];

/** pass/not-adopted/not-applicable → 0, fail → 1, blocked → 2; the usage code is 3. */
export type DesignCheckExitCode = VerdictExitCodes[number] | VerdictExitCodes['length'];

export function exitCodeForVerdict(verdict: DesignCheckVerdict): DesignCheckExitCode {
  if (verdict === 'fail') return 1;
  if (verdict === 'blocked') return 2;
  return 0;
}

async function resolveChangeSet(input: CheckInput, rid: string | null): Promise<string[] | null> {
  if (input.changedFiles !== undefined) return [...input.changedFiles];
  if (rid !== null) {
    if (input.sessionId === undefined) return null;
    return [...(readRidChangeClaims(input.projectRoot, input.sessionId).get(rid) ?? [])];
  }
  return readGitChangeSet(input.projectRoot, input.base ?? 'HEAD').changedPaths;
}

/** The change set, plus why it is empty when it could not be read. */
async function readChangeSet(input: CheckInput, rid: string | null) {
  try {
    return { files: (await resolveChangeSet(input, rid)) ?? [], failure: null };
  } catch (error) {
    const failure = error instanceof Error ? error.message : null;
    return { files: [], failure };
  }
}

function readJson(filePath: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function readRules(value: unknown): PavedRoadFile['rules'] {
  const rules: PavedRoadFile['rules'] = { ...DEFAULT_DESIGN_RULES };
  const record =
    value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  for (const code of Object.keys(rules) as DesignRuleCode[]) {
    const severity = record[code];
    if (severity === 'warn' || severity === 'fail') rules[code] = severity;
  }
  return rules;
}

/** All three contract JSON files are read; the paved road keeps its defaults. */
function readContract(designRoot: string): { tokens: DesignTokensFile; paved: PavedRoadFile } {
  const raw = readJson(join(designRoot, 'paved-road.json'));
  const paved = buildPavedRoad({
    pageRoots: stringList(raw.pageRoots),
    componentEntrypoints: stringList(raw.componentEntrypoints),
    bannedImportSpecifiers: stringList(raw.bannedImportSpecifiers)
  });
  paved.rules = readRules(raw.rules);
  readJson(join(designRoot, 'engine.json'));
  const tokens = readJson(join(designRoot, 'tokens.json')) as unknown as DesignTokensFile;
  return { tokens, paved };
}

function toAppPath(appRoot: string, file: string): string {
  const absolute = isAbsolute(file) ? file : resolve(appRoot, file);
  const rel = relative(resolve(appRoot), absolute);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return '';
  return rel.split(sep).join('/');
}

function underDir(file: string, dir: string | null): boolean {
  const normalized = normalizePath(dir ?? '')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
  return normalized !== '' && (file === normalized || file.startsWith(`${normalized}/`));
}

function underAny(file: string, dirs: readonly string[]): boolean {
  return dirs.some((dir) => underDir(file, dir));
}

function isUiFile(
  file: string,
  appRoot: string,
  paved: PavedRoadFile,
  componentDir: string | null
): boolean {
  if (UI_EXTENSIONS.has(extname(file).toLowerCase())) return true;
  const appFile = toAppPath(appRoot, file);
  if (appFile === '') return false;
  return underAny(appFile, paved.pageRoots) || underDir(appFile, componentDir);
}

function surfaceOf(
  files: readonly string[],
  appRoot: string,
  paved: PavedRoadFile,
  componentDir: string | null
): DesignCheckResult['surface'] {
  const reasons: string[] = [];
  for (const file of files) {
    if (isUiFile(file, appRoot, paved, componentDir))
      reasons.push(`changed: ${normalizePath(file)}`);
  }
  return { isUi: reasons.length > 0, reasons };
}

/** The component dir `scanExistingSystem` already detects; only asked when a path needs it. */
async function detectComponentDir(
  appRoot: string,
  files: readonly string[],
  paved: PavedRoadFile
): Promise<string | null> {
  const needsDetection = files.some(
    (file) =>
      !UI_EXTENSIONS.has(extname(file).toLowerCase()) &&
      !underAny(toAppPath(appRoot, file), paved.pageRoots)
  );
  if (!needsDetection) return null;
  return (await scanExistingSystem({ projectRoot: appRoot })).conventions.componentDir;
}

function verdictFromScan(
  input: CheckInput,
  rid: string | null,
  surface: DesignCheckResult['surface'],
  scan: ScanDesignSourcesResult
): DesignCheckResult {
  const accepted = input.allowSourceOnly === true && input.acceptNote !== undefined;
  const acceptedBy = input.sessionId ?? null;
  const g2 = {
    status: 'skipped',
    reason: accepted ? 'explicitly-accepted' : 's2-not-implemented'
  } as const;
  const status: 'pass' | 'fail' = scan.findings.some((finding) => finding.severity === 'fail')
    ? 'fail'
    : 'pass';
  const evidence = {
    surface,
    checks: {
      g1_source: { status, findings: scan.findings },
      g2_render: g2
    },
    findings: scan.findings,
    coverage: scan.coverage
  };
  if (evidence.checks.g1_source.status === 'fail') {
    return makeResult(rid, { ...evidence, verdict: 'fail', ...(accepted ? { acceptedBy } : {}) });
  }
  if (accepted) return makeResult(rid, { ...evidence, verdict: 'pass', acceptedBy });
  return makeResult(rid, {
    ...evidence,
    verdict: 'blocked',
    errorCode: 'DESIGN_RENDER_NOT_IMPLEMENTED',
    message: RENDER_NOT_IMPLEMENTED_MESSAGE
  });
}

export async function checkDesignSourceOnly(input: CheckInput): Promise<DesignCheckResult> {
  const { rid = null } = input;
  if (input.allowSourceOnly === true && (input.acceptNote ?? '').trim() === '') {
    throw new DesignCheckUsageError();
  }

  const resolved = await resolveContractRoot({
    projectRoot: input.projectRoot,
    ...(input.appPath === undefined ? {} : { appPath: input.appPath })
  });
  if (!resolved.ok) {
    return makeResult(rid, {
      verdict: 'blocked',
      errorCode: resolved.code,
      message: resolved.message
    });
  }
  const root = resolved.root;

  if (!CONTRACT_FILES.every((name) => existsSync(join(root.designRoot, name)))) {
    return makeResult(rid, { verdict: 'not-adopted', message: NOT_ADOPTED_MESSAGE });
  }

  const changeSet = await readChangeSet(input, rid);
  if (changeSet.files.length === 0) {
    return makeResult(rid, {
      verdict: 'blocked',
      errorCode: 'DESIGN_CHANGE_SET_UNKNOWN',
      message: changeSet.failure ?? CHANGE_SET_UNKNOWN_MESSAGE
    });
  }
  const files = changeSet.files;

  const { tokens, paved } = readContract(root.designRoot);
  const componentDir = await detectComponentDir(root.appRoot, files, paved);
  const surface = surfaceOf(files, root.appRoot, paved, componentDir);
  if (surface.isUi !== true) return makeResult(rid, { verdict: 'not-applicable', surface });

  const scan = await scanDesignSources({
    appRoot: root.appRoot,
    changedFiles: files,
    pavedRoad: paved,
    tokens
  });
  return verdictFromScan(input, rid, surface, scan);
}
