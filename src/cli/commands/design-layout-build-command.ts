/**
 * `peaks design layout build` — capture one route at each requested viewport,
 * cut and number it, serialize the ASCII entry, prove the round trip and the
 * token density, then write the entry and its measured document under the graph
 * root as one atomic batch. A failure at any step leaves no entry, no capture
 * and no index.
 */
import { resolve } from 'node:path';

import { ok } from 'peaks-loop-shared/result';

import { buildLayoutIndex } from '../../services/design/layout/layout-align.js';
import { buildLayoutEntry, type LayoutEntry } from '../../services/design/layout/layout-graph.js';
import { serializeEntry } from '../../services/design/layout/layout-graph-ascii.js';
import {
  capturePath,
  graphRoot,
  MAX_ENTRY_BYTES,
  writeBatch
} from '../../services/design/layout/layout-graph-store.js';
import { recordDesignRoot } from '../../services/design/layout/layout-graph-root-record.js';
import {
  captureLayoutPage,
  type LayoutGeometry,
  type LayoutPageResult,
  type Viewport
} from '../../services/design/layout/layout-geometry.js';
import {
  readSpacingTokensStrict,
  type SpacingToken
} from '../../services/design/layout/layout-tokens.js';
import {
  densityOf,
  verifyRoundTrip,
  type Density,
  type RoundTrip
} from '../../services/design/layout/layout-roundtrip.js';
import { getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  DEFAULT_STATE,
  designRootOf,
  EXIT_REFUSED,
  failWith,
  trustedUrl,
  viewportLabel,
  viewportList,
  type CaptureFn,
  type DesignLayoutBuildOptions
} from './design-layout-shared.js';

export type Built = {
  viewport: Viewport;
  entry: LayoutEntry;
  geometry: LayoutGeometry;
  density: Density;
  roundTrip: Extract<RoundTrip, { ok: true }>;
};

function builtData(built: Built, projectRoot: string): Record<string, unknown> {
  return {
    route: built.entry.route,
    state: built.entry.state,
    viewport: viewportLabel(built.viewport),
    nodes: built.entry.nodes.length,
    objects: built.entry.nodes.filter((node) => node.kind === 'object').length,
    anchors: built.entry.anchors.length,
    findings: built.entry.anchors.filter((anchor) => anchor.verdict === 'not-aligned').length,
    asciiBytes: built.density.asciiBytes,
    asciiTokens: built.density.asciiTokens,
    htmlBytes: built.density.htmlBytes,
    htmlTokens: built.density.htmlTokens,
    capture: capturePath(projectRoot, built.entry),
    roundTrip: built.roundTrip
  };
}

export type OneResult = { ok: true; built: Built } | { ok: false; code: string; reason: string };

/** One captured page through the entry build, round-trip and density checks. */
export function buildOne(
  options: DesignLayoutBuildOptions,
  viewport: Viewport,
  tokens: readonly SpacingToken[],
  page: LayoutPageResult
): OneResult {
  if (!page.ok) return { ok: false, code: 'DESIGN_LAYOUT_CAPTURE_FAILED', reason: page.reason };
  const index = buildLayoutIndex({ geometry: page.page.geometry, spacingTokens: tokens });
  const entry = buildLayoutEntry({
    index,
    geometry: page.page.geometry,
    state: options.state ?? DEFAULT_STATE,
    tokens
  });
  const ascii = serializeEntry(entry);
  if (!ascii.ok) return { ok: false, code: 'DESIGN_LAYOUT_SERIALIZE_FAILED', reason: ascii.reason };
  const bytes = Buffer.byteLength(ascii.text, 'utf8');
  if (bytes > MAX_ENTRY_BYTES) {
    return {
      ok: false,
      code: 'DESIGN_LAYOUT_ENTRY_TOO_LARGE',
      reason: `the entry is ${String(bytes)} bytes, over the ${String(MAX_ENTRY_BYTES)}-byte bound`
    };
  }
  const roundTrip = verifyRoundTrip(entry);
  if (!roundTrip.ok) {
    return {
      ok: false,
      code: 'DESIGN_LAYOUT_ROUNDTRIP_FAILED',
      reason: roundTrip.mismatches.join('; ')
    };
  }
  const density = densityOf(ascii.text, page.page.html);
  if (!density.denser) {
    return {
      ok: false,
      code: 'DESIGN_LAYOUT_NOT_DENSER',
      reason: `the graph is ${String(density.asciiTokens)} estimated tokens against ${String(density.htmlTokens)} of rendered HTML`
    };
  }
  return {
    ok: true,
    built: { viewport, entry, geometry: page.page.geometry, density, roundTrip }
  };
}

type AllResult =
  { ok: true; built: Built[] } | { ok: false; code: string; reason: string; viewport: Viewport };

async function buildAll(
  options: DesignLayoutBuildOptions,
  viewports: readonly Viewport[],
  tokens: readonly SpacingToken[],
  capture: CaptureFn
): Promise<AllResult> {
  const built: Built[] = [];
  for (const viewport of viewports) {
    let page: LayoutPageResult;
    try {
      page = await capture({ route: options.route, url: options.url, viewport });
    } catch (error) {
      page = { ok: false, reason: getErrorMessage(error) };
    }
    const result = buildOne(options, viewport, tokens, page);
    if (!result.ok) return { ...result, viewport };
    built.push(result.built);
  }
  return { ok: true, built };
}

/**
 * Write the entries and the measured documents they came from as one batch, so
 * a refused batch leaves neither evidence nor index behind.
 */
function writeAll(projectRoot: string, built: readonly Built[]): string | null {
  const written = writeBatch(
    projectRoot,
    built.map((item) => ({ entry: item.entry, capture: item.geometry }))
  );
  return written.ok ? null : written.reason;
}

/** Persist the batch and print the one envelope; a write refusal writes nothing. */
function finishBuild(
  options: DesignLayoutBuildOptions,
  io: ProgramIO,
  built: readonly Built[]
): void {
  const command = 'design.layout.build';
  const projectRoot = resolve(options.project);
  const problem = writeAll(projectRoot, built);
  if (problem !== null) {
    failWith(io, command, options.json, {
      code: 'DESIGN_LAYOUT_WRITE_FAILED',
      message: problem,
      data: { route: options.route }
    });
    return;
  }
  const recorded = recordDesignRoot(projectRoot, designRootOf(options));
  printResult(
    io,
    ok(
      command,
      {
        root: graphRoot(projectRoot),
        entries: built.map((item) => builtData(item, projectRoot))
      },
      recorded.ok ? [] : [recorded.reason]
    ),
    options.json === true
  );
}

export async function runDesignLayoutBuild(
  options: DesignLayoutBuildOptions,
  io: ProgramIO,
  capture: CaptureFn = captureLayoutPage
): Promise<void> {
  const command = 'design.layout.build';
  const viewports = viewportList(options.viewport);
  if (viewports === null) {
    failWith(io, command, options.json, {
      code: 'DESIGN_LAYOUT_VIEWPORT_INVALID',
      message: 'viewport must be WxH',
      exit: EXIT_REFUSED
    });
    return;
  }
  if (!trustedUrl(options)) {
    failWith(io, command, options.json, {
      code: 'DESIGN_LAYOUT_URL_UNTRUSTED',
      message: 'the render URL is outside the trust boundary',
      data: { route: options.route },
      exit: EXIT_REFUSED
    });
    return;
  }
  const tokens = readSpacingTokensStrict(designRootOf(options));
  if (!tokens.ok) {
    failWith(io, command, options.json, {
      code: 'DESIGN_LAYOUT_TOKENS_INVALID',
      message: tokens.reason,
      exit: EXIT_REFUSED
    });
    return;
  }
  const result = await buildAll(options, viewports, tokens.tokens, capture);
  if (!result.ok) {
    failWith(io, command, options.json, {
      code: result.code,
      message: result.reason,
      data: { route: options.route, viewport: viewportLabel(result.viewport) }
    });
    return;
  }
  finishBuild(options, io, result.built);
}
