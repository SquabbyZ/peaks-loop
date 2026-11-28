/**
 * The orchestration half of the prototype-versus-implementation fidelity
 * oracle: classify the two inputs, capture them at the same viewports through
 * the one layout seam, hold the prototype's sha256 binding, and score.
 *
 * The command never starts an application. A prototype that is a local file is
 * served by a loopback-only static server (recorded on the result); an
 * implementation is always a URL the caller is already running. The capture
 * seam is mode-agnostic today, so `mode` names which implementation build the
 * URL serves and is recorded rather than guessed.
 */
import { sha256Hex } from './fidelity-evidence.js';
import { checkedUrl, classifyPrototype } from './fidelity-input.js';
import {
  FIDELITY_SCHEMA_VERSION,
  blockedFidelity,
  notApplicableFidelity,
  objectMarkers,
  viewportText,
  type FidelityMode,
  type FidelityPrototype,
  type FidelityResult,
  type ViewportScore
} from './layout/fidelity-model.js';
import { scoreViewport } from './layout/fidelity-score.js';
import {
  captureLayoutPage,
  type LayoutGeometry,
  type LayoutPageResult,
  type Viewport
} from './layout/layout-geometry.js';
import type { SpacingToken } from './layout/layout-tokens.js';

export type FidelityCaptureFn = (input: {
  route: string;
  url: string;
  viewport: Viewport;
  mode: FidelityMode;
}) => Promise<LayoutPageResult>;

export type FidelityOracleInput = {
  projectRoot: string;
  app: string | null;
  route: string;
  prototype: string | null;
  implementation: string | null;
  mode: FidelityMode;
  viewports: readonly Viewport[];
  tokens: readonly SpacingToken[];
  /** The sha256 an earlier run recorded for this route, or null on a first run. */
  priorSha256: string | null;
  capture: FidelityCaptureFn;
};

/** The seam the command uses by default; exported so a test can label a wrapper. */
export function layoutCapture(input: {
  route: string;
  url: string;
  viewport: Viewport;
}): Promise<LayoutPageResult> {
  return captureLayoutPage({ route: input.route, url: input.url, viewport: input.viewport });
}

type Captured =
  | { ok: true; prototype: LayoutGeometry[]; implementation: LayoutGeometry[] }
  | { ok: false; reason: string };

async function capturePair(
  input: FidelityOracleInput,
  prototypeUrl: string,
  implementationUrl: string
): Promise<Captured> {
  const prototype: LayoutGeometry[] = [];
  const implementation: LayoutGeometry[] = [];
  for (const viewport of input.viewports) {
    const proto = await input.capture({
      route: input.route,
      url: prototypeUrl,
      viewport,
      mode: input.mode
    });
    if (!proto.ok) {
      return {
        ok: false,
        reason: `the prototype capture failed at ${viewportText(viewport)} (${proto.reason})`
      };
    }
    const impl = await input.capture({
      route: input.route,
      url: implementationUrl,
      viewport,
      mode: input.mode
    });
    if (!impl.ok) {
      return {
        ok: false,
        reason: `the implementation capture failed at ${viewportText(viewport)} (${impl.reason})`
      };
    }
    prototype.push(proto.page.geometry);
    implementation.push(impl.page.geometry);
  }
  return { ok: true, prototype, implementation };
}

type Scored = { ok: true; viewports: ViewportScore[] } | { ok: false; reason: string };

function scoreAll(
  input: FidelityOracleInput,
  prototype: readonly LayoutGeometry[],
  implementation: readonly LayoutGeometry[]
): Scored {
  const scores: ViewportScore[] = [];
  for (let index = 0; index < input.viewports.length; index += 1) {
    const viewport = input.viewports[index];
    const proto = prototype[index];
    const impl = implementation[index];
    if (viewport === undefined || proto === undefined || impl === undefined) {
      return { ok: false, reason: 'a requested viewport produced no capture' };
    }
    if (objectMarkers(proto) === 0 && objectMarkers(impl) === 0) {
      return {
        ok: false,
        reason: `neither capture declares data-peaks-object at ${viewportText(viewport)}`
      };
    }
    scores.push(
      scoreViewport({ viewport, prototype: proto, implementation: impl, tokens: input.tokens })
    );
  }
  return { ok: true, viewports: scores };
}

function assemble(
  input: FidelityOracleInput,
  prototype: FidelityPrototype,
  implementationUrl: string,
  viewports: readonly ViewportScore[]
): FidelityResult {
  return {
    schemaVersion: FIDELITY_SCHEMA_VERSION,
    route: input.route,
    mode: input.mode,
    verdict: viewports.some((score) => score.verdict === 'fail') ? 'fail' : 'pass',
    reason: null,
    prototype,
    implementation: { url: implementationUrl },
    viewports: [...viewports],
    failures: viewports.flatMap((score) => score.failures),
    roleMismatches: viewports.flatMap((score) => score.roleMismatches)
  };
}

function staleReason(prior: string, current: string): string {
  return (
    `the prototype changed since the recorded verdict (recorded sha256 ${prior}, now ${current}); ` +
    'the earlier verdict is stale and cannot be reissued as current'
  );
}

/** A blocked verdict that still records which prototype was being judged. */
function blockedBound(
  input: FidelityOracleInput,
  prototype: FidelityPrototype,
  implementationUrl: string,
  reason: string
): FidelityResult {
  return {
    ...blockedFidelity(input.route, input.mode, reason),
    prototype,
    implementation: { url: implementationUrl }
  };
}

function finish(
  input: FidelityOracleInput,
  prototype: FidelityPrototype,
  implementationUrl: string,
  captured: Extract<Captured, { ok: true }>
): FidelityResult {
  const scored = scoreAll(input, captured.prototype, captured.implementation);
  if (!scored.ok) return blockedBound(input, prototype, implementationUrl, scored.reason);
  return assemble(input, prototype, implementationUrl, scored.viewports);
}

async function captureFileSource(
  input: FidelityOracleInput,
  source: Extract<ReturnType<typeof classifyPrototype>, { kind: 'file' }>,
  implementationUrl: string
): Promise<FidelityResult> {
  // Loaded lazily on the branch that actually serves a local file: the read-only
  // proof replaces the `node:http` namespace to prove the CLI never reaches the
  // network, so a static import here would break every command at startup.
  const { servePrototype } = await import('./layout/fidelity-static-server.js');
  const served = await servePrototype(source.bytes);
  if (!served.ok) return blockedFidelity(input.route, input.mode, served.reason);
  const prototype: FidelityPrototype = {
    kind: 'file',
    ref: source.ref,
    sha256: source.sha256,
    served: { url: served.service.url, loopback: true }
  };
  try {
    const captured = await capturePair(input, served.service.url, implementationUrl);
    if (!captured.ok) return blockedBound(input, prototype, implementationUrl, captured.reason);
    return finish(input, prototype, implementationUrl, captured);
  } finally {
    await served.service.close();
  }
}

async function captureUrlSource(
  input: FidelityOracleInput,
  source: Extract<ReturnType<typeof classifyPrototype>, { kind: 'url' }>,
  implementationUrl: string
): Promise<FidelityResult> {
  const captured = await capturePair(input, source.url, implementationUrl);
  if (!captured.ok) return blockedFidelity(input.route, input.mode, captured.reason);
  const sha256 = sha256Hex(JSON.stringify(captured.prototype));
  const prototype: FidelityPrototype = { kind: 'url', ref: source.ref, sha256, served: null };
  if (input.priorSha256 !== null && input.priorSha256 !== sha256) {
    return blockedBound(
      input,
      prototype,
      implementationUrl,
      staleReason(input.priorSha256, sha256)
    );
  }
  return finish(input, prototype, implementationUrl, captured);
}

type Planned =
  | {
      ok: true;
      source: Extract<ReturnType<typeof classifyPrototype>, { ok: true }>;
      implementationUrl: string;
    }
  | { ok: false; result: FidelityResult };

function planOracle(input: FidelityOracleInput): Planned {
  if (input.prototype === null || input.prototype.trim() === '') {
    return { ok: false, result: notApplicableFidelity(input.route, input.mode) };
  }
  if (input.implementation === null || input.implementation.trim() === '') {
    return {
      ok: false,
      result: blockedFidelity(
        input.route,
        input.mode,
        'a --prototype was supplied without --implementation'
      )
    };
  }
  const source = classifyPrototype(input.projectRoot, input.app, input.prototype);
  if (!source.ok)
    return { ok: false, result: blockedFidelity(input.route, input.mode, source.reason) };
  const implementation = checkedUrl(input.implementation, input.projectRoot, input.app);
  if (!implementation.ok) {
    return { ok: false, result: blockedFidelity(input.route, input.mode, implementation.reason) };
  }
  if (source.kind === 'file' && input.priorSha256 !== null && input.priorSha256 !== source.sha256) {
    const prototype: FidelityPrototype = {
      kind: 'file',
      ref: source.ref,
      sha256: source.sha256,
      served: null
    };
    return {
      ok: false,
      result: blockedBound(
        input,
        prototype,
        implementation.url,
        staleReason(input.priorSha256, source.sha256)
      )
    };
  }
  return { ok: true, source, implementationUrl: implementation.url };
}

/** Compare one route's prototype with its implementation; never starts an app. */
export async function runFidelityOracle(input: FidelityOracleInput): Promise<FidelityResult> {
  const planned = planOracle(input);
  if (!planned.ok) return planned.result;
  return planned.source.kind === 'file'
    ? captureFileSource(input, planned.source, planned.implementationUrl)
    : captureUrlSource(input, planned.source, planned.implementationUrl);
}
