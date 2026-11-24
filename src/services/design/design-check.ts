/** The source-only design check: a `pass` is only G1 conformance plus a recorded acceptance. */
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';

import { normalizePath } from '../../shared/path-utils.js';
import { scanExistingSystem } from '../scan/existing-system-service.js';
import {
  CHANGE_SET_UNKNOWN_MESSAGE,
  CONTRACT_INVALID_MESSAGE,
  DEGRADED_MESSAGE,
  DesignCheckUsageError,
  NOT_ADOPTED_MESSAGE,
  RENDER_REQUIRED_MESSAGE,
  requireAcceptNote
} from './acceptance.js';
import { resolveContractRoot } from './contract-root.js';
import { type ChangeSetRead, readChangeSet } from './design-changeset.js';
import { completeG2, type DesignEngineDeps, type G2RenderCheck } from './design-check-g2.js';
import {
  completeG3,
  EMPTY_G3_EXEMPLAR,
  type G3ExemplarCheck,
  type G3SuiteDeps
} from './design-check-g3-suite.js';
import type { PavedRoadFile } from './paved-road.js';
import { appFiles, readPavedRoad, readTokens } from './source-scan/inputs.js';
import type { DesignFinding } from './source-scan/scan-file.js';
import { scanDesignSources, type ScanDesignSourcesResult } from './source-scan/scan.js';
import type { TokenCoverage } from './source-scan/token-coverage.js';

export type DesignCheckVerdict = 'pass' | 'fail' | 'blocked' | 'not-adopted' | 'not-applicable';

export type DesignCheckResult = {
  schemaVersion: 1;
  rid: string | null;
  verdict: DesignCheckVerdict;
  surface: { isUi: boolean | 'unknown'; reasons: string[] };
  checks: {
    g1_source: { status: 'pass' | 'fail' | 'not-applicable'; findings: DesignFinding[] };
    g2_render: G2RenderCheck;
    g3_exemplar: G3ExemplarCheck;
  };
  findings: DesignFinding[];
  coverage: TokenCoverage | null;
  errorCode?: string;
  message?: string;
  warnings?: string[];
  acceptedBy?: string | null;
  /** The user's own words recorded with `acceptedBy`; never rendered raw. */
  acceptedNote?: string;
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

/** The S1 input plus the G2 render inputs (spec §7.1). */
export type CheckDesignInput = CheckDesignSourceOnlyInput & {
  url?: string;
  pages?: readonly string[];
  start?: boolean;
  /** The diagnostic: report G1 only, skip G2, and never pass. */
  sourceOnly?: boolean;
  /** Accept skipping the advisory archetype rubric (G3b); the hard G3a still runs. */
  skipExemplar?: boolean;
  /** An explicit G3a baseline URL, instead of the recorded baseline entry. */
  baselineUrl?: string;
};

type CheckInput = CheckDesignSourceOnlyInput;

/** Kept exported from here: the S1 surface threw this refuse, and still does. */
export { DesignCheckUsageError };

const CONTRACT_FILES = ['contract.md', 'tokens.json', 'paved-road.json', 'engine.json'] as const;
const UI_EXTENSIONS = new Set('.tsx .jsx .vue .svelte .css .scss .sass .less .html'.split(' '));

type ResultOverrides = Partial<Omit<DesignCheckResult, 'schemaVersion' | 'rid'>>;

function makeResult(rid: string | null, overrides: ResultOverrides): DesignCheckResult {
  return {
    schemaVersion: 1,
    rid,
    verdict: 'blocked',
    surface: { isUi: 'unknown', reasons: [] },
    checks: {
      g1_source: { status: 'not-applicable', findings: [] },
      g2_render: { status: 'skipped', reason: 's2-not-implemented' },
      g3_exemplar: EMPTY_G3_EXEMPLAR
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

function underDir(file: string, dir: string | null): boolean {
  const normalized = normalizePath(dir ?? '')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
  return normalized !== '' && (file === normalized || file.startsWith(`${normalized}/`));
}

function underAny(file: string, dirs: readonly string[]): boolean {
  return dirs.some((dir) => underDir(file, dir));
}

function isUiFile(appFile: string, paved: PavedRoadFile, componentDir: string | null): boolean {
  if (UI_EXTENSIONS.has(extname(appFile).toLowerCase())) return true;
  return underAny(appFile, paved.pageRoots) || underDir(appFile, componentDir);
}

function surfaceOf(
  files: readonly string[],
  paved: PavedRoadFile,
  componentDir: string | null
): DesignCheckResult['surface'] {
  const reasons: string[] = [];
  for (const file of files) {
    if (isUiFile(file, paved, componentDir)) reasons.push(`changed: ${normalizePath(file)}`);
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
    (file) => !UI_EXTENSIONS.has(extname(file).toLowerCase()) && !underAny(file, paved.pageRoots)
  );
  if (!needsDetection) return null;
  return (await scanExistingSystem({ projectRoot: appRoot })).conventions.componentDir;
}

/** The session and the user's words a source-only acceptance records. */
function acceptanceOf(input: CheckInput, accepted: boolean): Partial<DesignCheckResult> {
  if (!accepted) return {};
  return {
    acceptedBy: input.sessionId ?? null,
    ...(input.acceptNote === undefined ? {} : { acceptedNote: input.acceptNote })
  };
}

function verdictFromScan(
  input: CheckInput,
  rid: string | null,
  surface: DesignCheckResult['surface'],
  scan: ScanDesignSourcesResult
): DesignCheckResult {
  if (scan.scannedFiles.length === 0) {
    return makeResult(rid, {
      verdict: 'blocked',
      errorCode: 'DESIGN_SOURCE_CHECK_DEGRADED',
      message: DEGRADED_MESSAGE,
      surface,
      coverage: scan.coverage
    });
  }
  const accepted = input.allowSourceOnly === true && input.acceptNote !== undefined;
  const acceptance = acceptanceOf(input, accepted);
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
      g2_render: g2,
      g3_exemplar: EMPTY_G3_EXEMPLAR
    },
    findings: scan.findings,
    coverage: scan.coverage
  };
  if (evidence.checks.g1_source.status === 'fail') {
    return makeResult(rid, { ...evidence, verdict: 'fail', ...(accepted ? acceptance : {}) });
  }
  if (accepted) return makeResult(rid, { ...evidence, verdict: 'pass', ...acceptance });
  return makeResult(rid, {
    ...evidence,
    verdict: 'blocked',
    errorCode: 'DESIGN_RENDER_REQUIRED',
    message: RENDER_REQUIRED_MESSAGE
  });
}

/** The contract-root resolution, so a caller that already resolved it can share it. */
type RootResolution = Awaited<ReturnType<typeof resolveContractRoot>>;

export async function checkDesignSourceOnly(
  input: CheckInput,
  preResolved?: RootResolution,
  preChange?: ChangeSetRead
): Promise<DesignCheckResult> {
  const { rid = null } = input;
  requireAcceptNote(input);

  const resolved = preResolved ?? (await resolveContractRoot(input));
  if (!resolved.ok) {
    // No frontend app root is `not-applicable`; an ambiguous or nonexistent
    // --app is a configuration error and stays `blocked`.
    const verdict = resolved.code === 'DESIGN_NOT_FRONTEND' ? 'not-applicable' : 'blocked';
    return makeResult(rid, { verdict, errorCode: resolved.code, message: resolved.message });
  }
  const root = resolved.root;

  if (!CONTRACT_FILES.every((name) => existsSync(join(root.designRoot, name)))) {
    return makeResult(rid, { verdict: 'not-adopted', message: NOT_ADOPTED_MESSAGE });
  }

  const changeSet = preChange ?? (await readChangeSet(input, rid));
  const files = appFiles(input.projectRoot, root.appRelPath, changeSet.files);
  if (files.length === 0) {
    return makeResult(rid, {
      verdict: 'blocked',
      errorCode: 'DESIGN_CHANGE_SET_UNKNOWN',
      message: changeSet.failure ?? CHANGE_SET_UNKNOWN_MESSAGE
    });
  }

  const paved = readPavedRoad(root.designRoot);
  const componentDir = await detectComponentDir(root.appRoot, files, paved);
  const surface = surfaceOf(files, paved, componentDir);
  if (surface.isUi !== true) return makeResult(rid, { verdict: 'not-applicable', surface });

  const tokens = readTokens(root.designRoot);
  if (tokens === null) {
    return makeResult(rid, {
      verdict: 'blocked',
      errorCode: 'DESIGN_CONTRACT_INVALID',
      message: CONTRACT_INVALID_MESSAGE,
      surface
    });
  }

  const scan = await scanDesignSources({
    appRoot: root.appRoot,
    changedFiles: files,
    pavedRoad: paved,
    tokens
  });
  return verdictFromScan(input, rid, surface, scan);
}

/** S1 first, then G2, then G3 from the same resolved root; the acceptance path wins. */
export async function checkDesign(
  input: CheckDesignInput,
  deps?: DesignEngineDeps,
  g3Deps?: G3SuiteDeps
): Promise<DesignCheckResult> {
  const resolved = await resolveContractRoot(input);
  const changeSet = resolved.ok
    ? await readChangeSet(input, input.rid ?? null)
    : { files: [], failure: null };
  const base = await checkDesignSourceOnly(input, resolved, changeSet);
  if (input.allowSourceOnly === true) return base;
  if (input.sourceOnly === true) {
    return {
      ...base,
      checks: { ...base.checks, g2_render: { status: 'skipped', reason: 'source-only' } }
    };
  }
  if (base.checks.g1_source.status !== 'pass' || !resolved.ok) return base;
  // G3 derives its routes from the same app-relative change set G1 scanned.
  const changedFiles = appFiles(input.projectRoot, resolved.root.appRelPath, changeSet.files);
  const rendered = await completeG2(input, base, resolved.root, deps);
  return completeG3({ ...input, changedFiles }, rendered, resolved.root, g3Deps);
}
