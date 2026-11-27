/**
 * Per-viewport scoring for the fidelity oracle. Each viewport is decided on its
 * own: zero missing, extra or duplicated objects, at least 95% anchor agreement
 * and at least 95% token-name agreement. No score is averaged across viewports;
 * one failing viewport fails the route. Role agreement is reported but is not a
 * verdict input.
 */
import {
  FIDELITY_ANCHOR_THRESHOLD,
  FIDELITY_TOKEN_THRESHOLD,
  viewportText,
  type FidelityFailure,
  type ViewportScore
} from './fidelity-model.js';
import { pairOutcome, presenceFailures, sideOf, type Side } from './fidelity-pair.js';
import type { LayoutElement, LayoutGeometry, Viewport } from './layout-geometry.js';
import type { SpacingToken } from './layout-tokens.js';

const RATIO_SCALE = 10000;
const MAX_RATIO = 1;

function round(value: number): number {
  return Math.round(value * RATIO_SCALE) / RATIO_SCALE;
}

/** A share that is 0 when there is nothing to pair, never a silent pass. */
function share(matches: number, total: number): number {
  if (total === 0) return 0;
  const value = matches / total;
  return round(value > MAX_RATIO ? MAX_RATIO : value);
}

type ScoreInput = {
  viewport: Viewport;
  prototype: LayoutGeometry;
  implementation: LayoutGeometry;
  tokens: readonly SpacingToken[];
};

type Tally = {
  pairs: number;
  anchor: number;
  token: number;
  role: number;
  failures: FidelityFailure[];
  roleMismatches: FidelityFailure[];
};

function isElement(element: LayoutElement | undefined): element is LayoutElement {
  return element !== undefined;
}

function tallyPairs(
  input: ScoreInput,
  paired: readonly string[],
  prototype: Side,
  implementation: Side
): Tally {
  const prototypePeers = paired.map((id) => prototype.byId.get(id)).filter(isElement);
  const implementationPeers = paired.map((id) => implementation.byId.get(id)).filter(isElement);
  const tally: Tally = { pairs: 0, anchor: 0, token: 0, role: 0, failures: [], roleMismatches: [] };
  for (const id of paired) {
    const prototypeElement = prototype.byId.get(id);
    const implementationElement = implementation.byId.get(id);
    if (prototypeElement === undefined || implementationElement === undefined) continue;
    const outcome = pairOutcome({
      viewport: viewportText(input.viewport),
      id,
      prototype: prototypeElement,
      implementation: implementationElement,
      pairedPrototype: prototypePeers.filter((element) => element !== prototypeElement),
      pairedImplementation: implementationPeers.filter(
        (element) => element !== implementationElement
      ),
      prototypeElements: prototype.elements,
      implementationElements: implementation.elements,
      tokens: input.tokens
    });
    tally.pairs += 1;
    if (outcome.anchor) tally.anchor += 1;
    if (outcome.token) tally.token += 1;
    if (outcome.role) tally.role += 1;
    tally.failures.push(...outcome.failures);
    tally.roleMismatches.push(...outcome.roleMismatches);
  }
  return tally;
}

type VerdictInput = {
  missing: number;
  extra: number;
  duplicate: number;
  anchorScore: number;
  tokenScore: number;
};

function verdictOf(input: VerdictInput): 'pass' | 'fail' {
  const clean = input.missing === 0 && input.extra === 0 && input.duplicate === 0;
  const aligned = input.anchorScore >= FIDELITY_ANCHOR_THRESHOLD;
  const tokenised = input.tokenScore >= FIDELITY_TOKEN_THRESHOLD;
  return clean && aligned && tokenised ? 'pass' : 'fail';
}

/** Score one viewport independently; no number is averaged across viewports. */
export function scoreViewport(input: ScoreInput): ViewportScore {
  const prototype = sideOf(input.prototype);
  const implementation = sideOf(input.implementation);
  const paired = [...prototype.byId.keys()].filter((id) => implementation.byId.has(id));
  const presence = presenceFailures(viewportText(input.viewport), prototype, implementation);
  const tally = tallyPairs(input, paired, prototype, implementation);
  const missing = presence.filter((entry) => entry.failureClass === 'missing-object').length;
  const extra = presence.filter((entry) => entry.failureClass === 'extra-object').length;
  const duplicate = presence.filter((entry) => entry.failureClass === 'duplicate-object').length;
  const anchorScore = share(tally.anchor, tally.pairs);
  const tokenScore = share(tally.token, tally.pairs);
  return {
    viewport: viewportText(input.viewport),
    verdict: verdictOf({ missing, extra, duplicate, anchorScore, tokenScore }),
    paired: tally.pairs,
    missing,
    extra,
    duplicate,
    anchorMatches: tally.anchor,
    tokenMatches: tally.token,
    roleMatches: tally.role,
    anchorScore,
    tokenScore,
    roleScore: share(tally.role, tally.pairs),
    score: share(tally.anchor + tally.token, tally.pairs * 2),
    failures: [...presence, ...tally.failures],
    roleMismatches: tally.roleMismatches
  };
}
