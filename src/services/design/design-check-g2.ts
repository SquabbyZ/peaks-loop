/**
 * The G2 render matrix for `peaks design check`.
 *
 * G2 runs only after G1 passed, and a page URL is re-checked against the trust
 * boundary even when the base URL was — `engine.json` is a tracked file. Each
 * URL first passes the shared page-usability probe (blank/shell/login pages
 * block, never fail); then `drift` and `verify-ui` are judged from their own
 * evidence, `design-render-verdict.ts` maps exit codes only when no report
 * parsed, and `slop` / `grade` stay advisory. Nothing here may turn an unrun
 * check into a pass.
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { getSessionDir, isSinglePathSegment } from '../session/getSessionDir.js';
import { blockedMessage } from './acceptance.js';
import type { DesignCheckResult } from './design-check.js';
import { buildEngineDeps, readEngineContract } from './design-engine-deps.js';
import { resolvePageUrls } from './design-page-urls.js';
import type { ContractRoot } from './design-types.js';
import type { EngineContractFile } from './engine-contract.js';
import type { EngineAvailability } from './engine-status.js';
import { evidenceSnippet } from './evidence-text.js';
import {
  buildDesignlangArgs,
  type DesignlangCheckKind,
  type DesignlangEvidence,
  type DesignlangRunResult
} from './designlang.js';
import { driftVerdict, verifyUiVerdict, type RenderVerdict } from './design-render-verdict.js';
import { routeJudgmentLine } from './page-paint.js';
import type { PageProbeResult } from './page-probe.js';
import type { RenderUrlResult } from './render-url.js';
import type { StartRenderServerResult } from './render-server.js';
import { redactUrl } from './url-redact.js';

export type DesignEngineRunInput = { args: readonly string[] };

export type DesignEngineDeps = {
  availability: EngineAvailability;
  resolveUrl: () => RenderUrlResult;
  probe: (url: string) => Promise<boolean>;
  /** The shared usability gate: runs before any check spawns for this URL. */
  probePage: (url: string) => Promise<PageProbeResult>;
  startServer?: (url: string) => Promise<StartRenderServerResult>;
  run: (kind: DesignlangCheckKind, input: DesignEngineRunInput) => Promise<DesignlangRunResult>;
  readGrade?: (outDir: string) => Promise<DesignlangEvidence>;
};

// `s2-not-implemented` is only the S1 early-result default, never a checkDesign outcome.
export type G2RenderCheck =
  | { status: 'pass'; pages: number; evidence: string[] }
  | { status: 'fail'; reason: string }
  | { status: 'blocked'; code: string }
  | { status: 'skipped'; reason: 'explicitly-accepted' | 'source-only' | 's2-not-implemented' };

export type G2Outcome = { check: G2RenderCheck; warnings: string[]; message: string };

export type EvaluateG2Input = {
  projectRoot: string;
  designRoot: string;
  engine: EngineContractFile;
  pages?: readonly string[];
  start?: boolean;
  sessionId?: string;
};

function blockedOutcome(code: string, message: string, warnings: string[] = []): G2Outcome {
  return { check: { status: 'blocked', code }, warnings, message };
}

export function configuredPages(input: Pick<EvaluateG2Input, 'pages' | 'engine'>): string[] {
  if (input.pages !== undefined && input.pages.length > 0) return [...input.pages];
  if (input.engine.render.pages.length > 0) return [...input.engine.render.pages];
  return [input.engine.render.path === '' ? '/' : input.engine.render.path];
}

type ReachResult =
  { ok: true; stop: (() => Promise<void>) | null } | { ok: false; code: string; message: string };

function blockedReach(code: string): ReachResult {
  return { ok: false, code, message: blockedMessage(code) };
}

/**
 * The unreachable refusal names the base URL the probe actually used (`--pages`
 * never moves it; `--url` picks a different origin). The echo is redacted AND
 * control-byte-sanitised, as describePaint is: engine.json is a tracked file.
 */
function unreachableMessage(url: string): string {
  const probed = evidenceSnippet(redactUrl(url));
  return (
    `${blockedMessage('DESIGN_RENDER_UNREACHABLE')} It probed ${probed}; ` +
    'pass --url to pick a different origin (--pages only names pages on this base).'
  );
}

async function probeOrBlock(deps: DesignEngineDeps, url: string): Promise<ReachResult> {
  if (await deps.probe(url)) return { ok: true, stop: null };
  return { ok: false, code: 'DESIGN_RENDER_UNREACHABLE', message: unreachableMessage(url) };
}

async function ensureReachable(
  input: EvaluateG2Input,
  deps: DesignEngineDeps,
  url: string
): Promise<ReachResult> {
  if (input.start !== true) return probeOrBlock(deps, url);
  const command = input.engine.render.startCommand;
  if (command === null || command.trim() === '') {
    return blockedReach('DESIGN_START_COMMAND_MISSING');
  }
  if (input.engine.render.startPolicy !== 'on-request') {
    return blockedReach('DESIGN_START_NOT_ALLOWED');
  }
  if (deps.startServer === undefined) return probeOrBlock(deps, url);
  const started = await deps.startServer(url);
  if (!started.ok) return { ok: false, code: started.code, message: started.message };
  return { ok: true, stop: () => started.server.stop() };
}

/** Map a classified check run onto the G2 outcome; null keeps the matrix going. */
function verdictOutcome(verdict: RenderVerdict, warnings: string[]): G2Outcome | null {
  if (verdict.status === 'pass') return null;
  if (verdict.status === 'fail') {
    return { check: { status: 'fail', reason: verdict.reason }, warnings, message: verdict.reason };
  }
  return blockedOutcome(verdict.code, verdict.message, warnings);
}

/** Advisory only: a grade failure or an absent report never changes the verdict. */
async function runGrade(
  input: EvaluateG2Input,
  deps: DesignEngineDeps,
  url: string,
  warnings: string[]
): Promise<void> {
  const readGrade = deps.readGrade;
  if (readGrade === undefined) return;
  const sessionDir = getSessionDir(input.projectRoot, input.sessionId ?? 'local');
  const outDir = join(sessionDir, 'design', 'render');
  await mkdir(outDir, { recursive: true });
  const grade = await deps.run('grade', {
    args: buildDesignlangArgs({ kind: 'grade', url, outDir })
  });
  if (grade.exitCode !== 0) return;
  try {
    if (!(await readGrade(outDir)).ok) {
      warnings.push(`designlang grade produced no evidence for ${url} (advisory)`);
    }
  } catch {
    warnings.push(`designlang grade evidence could not be read for ${url} (advisory)`);
  }
}

async function runChecks(
  input: EvaluateG2Input,
  deps: DesignEngineDeps,
  urls: readonly string[]
): Promise<G2Outcome> {
  const evidence: string[] = [];
  const warnings: string[] = [];
  const tokensPath = join(input.designRoot, 'tokens.json');
  const brandPath = join(input.designRoot, 'contract.md');
  for (const url of urls) {
    // The shared usability gate runs BEFORE any check spawns for this URL: a
    // blank shell or a login wall is `blocked`, never a noise-driven fail.
    const usable = await deps.probePage(url);
    if (!usable.ok) return blockedOutcome(usable.code, usable.message, warnings);

    const drift = await deps.run('drift', {
      args: buildDesignlangArgs({ kind: 'drift', url, tokensPath })
    });
    const driftOutcome = verdictOutcome(driftVerdict(drift, url, tokensPath), warnings);
    if (driftOutcome !== null) return driftOutcome;
    evidence.push(`drift ${url}`);

    const verify = await deps.run('verify-ui', {
      args: buildDesignlangArgs({ kind: 'verify-ui', url, brandPath })
    });
    const verifyOutcome = verdictOutcome(verifyUiVerdict(verify, url), warnings);
    if (verifyOutcome !== null) return verifyOutcome;
    evidence.push(`verify-ui ${url}`);
    // A passing probe measured 13.6 s per URL; a refused ROUTE pays only the
    // identity half, so this is what the capture added, not a constant.
    evidence.push(`probe ${url} elapsedMs ${String(usable.observation.elapsedMs)}`);
    evidence.push(routeJudgmentLine(url, usable.observation.route));
    // Disk hygiene the probe performed is evidence too; a failure is advisory
    // because stale captures never change whether the page is usable.
    if (usable.pruned !== undefined && usable.pruned.removed.length > 0) {
      evidence.push(`probe ${url} pruned ${String(usable.pruned.removed.length)} stale capture(s)`);
    }
    if (usable.pruned !== undefined && usable.pruned.failed > 0) {
      warnings.push(
        `the probe could not remove ${String(usable.pruned.failed)} stale capture(s) for ${url} (advisory)`
      );
    }

    const slop = await deps.run('slop', { args: buildDesignlangArgs({ kind: 'slop', url }) });
    if (slop.exitCode !== 0) {
      warnings.push(`designlang slop exited ${String(slop.exitCode)} for ${url} (advisory)`);
    }
    await runGrade(input, deps, url, warnings);
  }
  return { check: { status: 'pass', pages: urls.length, evidence }, warnings, message: '' };
}

/** Run the G2 matrix against injected or real engine dependencies. */
export async function evaluateG2(
  input: EvaluateG2Input,
  deps: DesignEngineDeps
): Promise<G2Outcome> {
  if (!deps.availability.available) {
    const code = deps.availability.codes[0] ?? 'DESIGN_ENGINE_UNAVAILABLE';
    return blockedOutcome(code, blockedMessage(code));
  }
  const sessionId = input.sessionId;
  if (sessionId !== undefined && (sessionId.trim() === '' || !isSinglePathSegment(sessionId))) {
    return blockedOutcome('DESIGN_SESSION_ID_INVALID', blockedMessage('DESIGN_SESSION_ID_INVALID'));
  }
  const resolved = deps.resolveUrl();
  if (!resolved.ok) return blockedOutcome(resolved.code, resolved.message);
  const pages = resolvePageUrls(resolved.url, configuredPages(input), input.engine);
  if (!pages.ok) return blockedOutcome(pages.code, pages.message);

  const reach = await ensureReachable(input, deps, resolved.url);
  if (!reach.ok) return blockedOutcome(reach.code, reach.message);
  try {
    return await runChecks(input, deps, pages.urls);
  } finally {
    if (reach.stop !== null) await reach.stop();
  }
}

export type G2CheckInput = {
  projectRoot: string;
  url?: string;
  pages?: readonly string[];
  start?: boolean;
  sessionId?: string;
};

function applyG2(base: DesignCheckResult, outcome: G2Outcome): DesignCheckResult {
  const shared = {
    schemaVersion: base.schemaVersion,
    rid: base.rid,
    surface: base.surface,
    findings: base.findings,
    coverage: base.coverage,
    checks: { ...base.checks, g2_render: outcome.check }
  };
  const warnings = outcome.warnings.length === 0 ? {} : { warnings: outcome.warnings };
  if (outcome.check.status === 'pass') return { ...shared, verdict: 'pass', ...warnings };
  if (outcome.check.status === 'fail') return { ...shared, verdict: 'fail', ...warnings };
  if (outcome.check.status === 'blocked') {
    return {
      ...shared,
      verdict: 'blocked',
      errorCode: outcome.check.code,
      message: outcome.message,
      ...warnings
    };
  }
  return { ...shared, verdict: base.verdict, ...warnings };
}

/** Read engine.json from the ALREADY-resolved root, then run (or fake) G2. */
export async function completeG2(
  input: G2CheckInput,
  base: DesignCheckResult,
  root: ContractRoot,
  deps?: DesignEngineDeps
): Promise<DesignCheckResult> {
  const engineRead = readEngineContract(root.designRoot);
  if (!engineRead.ok) return applyG2(base, blockedOutcome(engineRead.code, engineRead.message));
  const engine = engineRead.contract;
  const effective =
    deps ??
    buildEngineDeps({
      projectRoot: input.projectRoot,
      engine,
      designRoot: root.designRoot,
      ...(input.url === undefined ? {} : { url: input.url }),
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      env: process.env
    });
  const outcome = await evaluateG2(
    {
      projectRoot: input.projectRoot,
      designRoot: root.designRoot,
      engine,
      ...(input.pages === undefined ? {} : { pages: input.pages }),
      ...(input.start === true ? { start: true } : {}),
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId })
    },
    effective
  );
  return applyG2(base, outcome);
}
