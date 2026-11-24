/**
 * G3 wiring for `peaks design check`: per-changed-route G3a (same-route
 * fidelity) and G3b (advisory archetype rubric).
 *
 * Scope is the CHANGE, not the render configuration: routes are derived from
 * the same app-relative change set G1 scanned, using the convention in
 * `design-routes.ts`. `render.pages` is never iterated — an untouched page with
 * a stale baseline cannot fail a clean change. A changed UI file that maps to
 * no route is `skipped('route-unknown')`; a changed route with no recorded
 * baseline is `skipped('no-baseline')` and one with no exemplar
 * `skipped(no-exemplar-for-archetype)`. None of those is ever a pass.
 *
 * Only a G3a `fail` turns a passing verdict into `fail`, and a G3a `blocked`
 * (an unusable baseline, an untrusted URL, no engine) turns it into `blocked`.
 * G3b is advisory: pass, warn, blocked and skipped never touch the top verdict.
 *
 * `--skip-exemplar` records the acceptance as `explicitly-accepted` on G3b and
 * skips only the advisory rubric; the hard G3a regression still runs.
 *
 * `--baseline-url` names one route's baseline, so a change that touches any
 * other number of routes is a usage error (exit 3, nothing written).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getSessionDir, isSinglePathSegment } from '../session/getSessionDir.js';
import { DesignBaselineUrlScopeError } from './acceptance.js';
import type { DesignCheckResult } from './design-check.js';
import {
  evaluateG3a,
  evaluateG3b,
  readBaselineState,
  type G3ADeps,
  type G3AResult,
  type G3BResult
} from './design-check-g3.js';
import type { ContractRoot } from './design-types.js';
import { readEngineContract } from './design-engine-deps.js';
import { resolveEngine } from './engine-status.js';
import {
  archetypeForRoute,
  readExemplars,
  type ExemplarIssue,
  type ExemplarRegistry
} from './exemplars.js';
import { runFidelity } from './fidelity.js';
import { buildGatedPageProbe } from './page-probe-deps.js';
import type { PageProbeResult } from './page-probe.js';
import { resolveRenderUrl } from './render-url.js';
import { deriveChangedRoutes, type ChangedRoutes } from './design-routes.js';
import { readPavedRoad } from './source-scan/inputs.js';

/** The session G2 also falls back to when no `--session-id` is given. */
const LOCAL_SESSION = 'local';

/** One G3b outcome paired with the route it scored. */
export type G3BRouteResult = G3BResult & { route: string };

/** The per-route evidence `checks.g3_exemplar` carries. */
export type G3ExemplarCheck = {
  g3a: readonly G3AResult[];
  g3b: readonly G3BRouteResult[];
  /** Exemplar directories that could not be read; absent when the registry is clean. */
  issues?: readonly ExemplarIssue[];
};

/** The slot for a check that never reached G3 (source-only, early refusal). */
export const EMPTY_G3_EXEMPLAR: G3ExemplarCheck = { g3a: [], g3b: [] };

export type G3CandidateUrl =
  { ok: true; url: string } | { ok: false; code: string; message: string };

/** The injected side effects; a real run binds the project root and session. */
export type G3SuiteDeps = {
  fidelity: G3ADeps['fidelity'];
  candidateUrl: (route: string) => G3CandidateUrl;
  /** The shared usability gate, run before the fidelity comparison spawns. */
  probePage: (url: string) => Promise<PageProbeResult>;
  rubricText: (path: string) => string | null;
};

export type G3CheckInput = {
  projectRoot: string;
  url?: string;
  /** App-relative changed files from the same change set G1 scanned. */
  changedFiles?: readonly string[];
  sessionId?: string;
  rid?: string | null;
  skipExemplar?: boolean;
  /** The user's own words accepting the skipped rubric; recorded with the session. */
  acceptNote?: string;
  /** An explicit baseline URL; it applies only when exactly one route changed. */
  baselineUrl?: string;
};

/** A missing rubric is null (G3b blocks on it); any other read error surfaces. */
function readTextOrNull(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/** Real deps: the candidate URL reuses the G2 resolver and its trust boundary. */
function buildSuiteDeps(input: G3CheckInput, contractRoot: ContractRoot): G3SuiteDeps {
  const sessionId = input.sessionId ?? LOCAL_SESSION;
  const engineRead = readEngineContract(contractRoot.designRoot);
  const availability = resolveEngine();
  return {
    fidelity: (run) =>
      runFidelity({
        projectRoot: input.projectRoot,
        appRoot: contractRoot.appRoot,
        sessionId,
        ...run
      }),
    candidateUrl: (route) => {
      if (!engineRead.ok) return engineRead;
      const base = resolveRenderUrl({
        ...(input.url === undefined ? {} : { explicitUrl: input.url }),
        env: process.env,
        engine: engineRead.contract
      });
      if (!base.ok) return base;
      try {
        return { ok: true, url: new URL(route, base.url).toString() };
      } catch {
        return {
          ok: false,
          code: 'DESIGN_URL_UNTRUSTED',
          message: `The route ${route} could not be resolved against the render URL.`
        };
      }
    },
    probePage: buildGatedPageProbe({ availability, projectRoot: input.projectRoot, sessionId }),
    rubricText: readTextOrNull
  };
}

/** The routes this change touched, derived from the G1 change set. */
function changedRoutesFor(input: G3CheckInput, contractRoot: ContractRoot): ChangedRoutes {
  return deriveChangedRoutes(input.changedFiles ?? [], readPavedRoad(contractRoot.designRoot));
}

/** `--baseline-url` names one route's baseline; any other count is a usage error. */
function assertBaselineUrlScope(input: G3CheckInput, routes: readonly string[]): void {
  if (input.baselineUrl !== undefined && routes.length !== 1) {
    throw new DesignBaselineUrlScopeError(routes);
  }
}

/** The rubric peaks-ui wrote for this request, or null when no path is usable. */
function rubricPath(input: G3CheckInput, sessionId: string): string | null {
  const rid = input.rid;
  if (rid === null || rid === undefined || !isSinglePathSegment(rid)) return null;
  return join(getSessionDir(input.projectRoot, sessionId), 'design', `rubric-${rid}.json`);
}

async function runG3a(
  routes: readonly string[],
  storeDir: string,
  input: G3CheckInput,
  deps: G3SuiteDeps
): Promise<G3AResult[]> {
  const results: G3AResult[] = [];
  for (const route of routes) {
    const recorded = readBaselineState(storeDir, route);
    if (recorded.entry === null && recorded.issue === null && input.baselineUrl === undefined) {
      results.push({ status: 'skipped', route, reason: 'no-baseline' });
      continue;
    }
    let candidateUrl = '';
    let probeMs: number | undefined;
    if (recorded.issue === null) {
      const candidate = deps.candidateUrl(route);
      if (!candidate.ok) {
        results.push({
          status: 'blocked',
          route,
          code: candidate.code,
          message: candidate.message
        });
        continue;
      }
      candidateUrl = candidate.url;
      // The shared usability gate runs BEFORE the fidelity comparison: two
      // blank shells score a plausible number, so comparing them is noise.
      const usable = await deps.probePage(candidateUrl);
      if (!usable.ok) {
        results.push({ status: 'blocked', route, code: usable.code, message: usable.message });
        continue;
      }
      probeMs = usable.observation.elapsedMs;
    }
    results.push(
      await evaluateG3a({
        storeDir,
        route,
        candidateUrl,
        ...(probeMs === undefined ? {} : { probeMs }),
        ...(input.baselineUrl === undefined ? {} : { baselineUrl: input.baselineUrl }),
        deps: { fidelity: deps.fidelity }
      })
    );
  }
  return results;
}

type G3bContext = {
  input: G3CheckInput;
  sessionId: string;
  deps: G3SuiteDeps;
  registry: ExemplarRegistry;
};

function runG3b(routes: readonly string[], context: G3bContext): G3BRouteResult[] {
  const { input, sessionId, deps, registry } = context;
  const rid = input.rid ?? '';
  const path = rubricPath(input, sessionId);
  return routes.map((route) => {
    if (input.skipExemplar === true) {
      return { route, status: 'skipped', reason: 'explicitly-accepted' };
    }
    const exemplar = archetypeForRoute(registry.entries, route);
    const rubricText = exemplar === null || path === null ? null : deps.rubricText(path);
    return { route, ...evaluateG3b({ rubricText, rid, route, exemplar }) };
  });
}

/** The base result plus the G3 slot, with only a G3a fail/blocked changing it. */
function applyG3(
  input: G3CheckInput,
  base: DesignCheckResult,
  check: G3ExemplarCheck
): DesignCheckResult {
  const failed = check.g3a.some((run) => run.status === 'fail');
  const blockedRun = check.g3a.find((run) => run.status === 'blocked');
  let verdict = base.verdict;
  let errorCode = base.errorCode;
  let message = base.message;
  if (base.verdict === 'pass') {
    if (failed) verdict = 'fail';
    else if (blockedRun !== undefined) {
      verdict = 'blocked';
      errorCode = blockedRun.code;
      message = blockedRun.message;
    }
  }
  const accepted =
    input.skipExemplar === true && verdict === 'pass'
      ? {
          acceptedBy: input.sessionId ?? null,
          ...(input.acceptNote === undefined ? {} : { acceptedNote: input.acceptNote })
        }
      : {};
  return {
    ...base,
    verdict,
    checks: { ...base.checks, g3_exemplar: check },
    ...(errorCode === base.errorCode ? {} : { errorCode }),
    ...(message === base.message ? {} : { message }),
    ...accepted
  };
}

/**
 * Run G3 over the changed routes and attach `checks.g3_exemplar`.
 *
 * A changed route with no baseline and no exemplar is recorded as skipped; the
 * top verdict is changed only by a G3a failure or blockage, so an advisory G3b
 * result can never mask a G1/G2 verdict or turn a fail into a pass.
 */
export async function completeG3(
  input: G3CheckInput,
  base: DesignCheckResult,
  contractRoot: ContractRoot,
  deps?: G3SuiteDeps
): Promise<DesignCheckResult> {
  const sessionId = input.sessionId ?? LOCAL_SESSION;
  if (!isSinglePathSegment(sessionId)) return applyG3(input, base, EMPTY_G3_EXEMPLAR);
  const derived = changedRoutesFor(input, contractRoot);
  assertBaselineUrlScope(input, derived.routes);
  if (derived.routes.length === 0 && derived.unknown.length === 0) {
    return applyG3(input, base, EMPTY_G3_EXEMPLAR);
  }
  const effective = deps ?? buildSuiteDeps(input, contractRoot);
  const registry = readExemplars(contractRoot.appRoot);
  const storeDir = join(getSessionDir(input.projectRoot, sessionId), 'design', 'baseline');
  const judged = await runG3a(derived.routes, storeDir, input, effective);
  const unknown: G3AResult[] = derived.unknown.map((file) => ({
    status: 'skipped',
    route: file,
    reason: 'route-unknown'
  }));
  const g3b = runG3b(derived.routes, { input, sessionId, deps: effective, registry });
  const check: G3ExemplarCheck = {
    g3a: [...judged, ...unknown],
    g3b,
    ...(registry.issues.length === 0 ? {} : { issues: registry.issues })
  };
  return applyG3(input, base, check);
}
