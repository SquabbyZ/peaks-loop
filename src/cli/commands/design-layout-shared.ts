/**
 * What the three layout commands share: option types, viewport parsing, the
 * render-URL trust boundary, capture-file reading and entry selection. Failures
 * exit with the named code and never fall through to a success envelope.
 */
import { join, resolve } from 'node:path';

import { fail } from 'peaks-loop-shared/result';

import { readEngineContract } from '../../services/design/design-engine-deps.js';
import { isLoopbackUrl, isTrustedDesignUrl } from '../../services/design/url-trust.js';
import type {
  LayoutGeometry,
  LayoutPageResult,
  Viewport
} from '../../services/design/layout/layout-geometry.js';
import {
  freshnessOf,
  type EntryFreshness,
  type LayoutEntry
} from '../../services/design/layout/layout-graph.js';
import { recordedDesignRoot } from '../../services/design/layout/layout-graph-root-record.js';
import { readEntry, selectEntry } from '../../services/design/layout/layout-graph-query.js';
import { readSpacingTokensStrict } from '../../services/design/layout/layout-tokens.js';
import { printResult, type ProgramIO } from '../cli-helpers.js';

export type DesignLayoutBuildOptions = {
  project: string;
  app?: string;
  route: string;
  url: string;
  state?: string;
  viewport?: string;
  allStates?: boolean;
  json?: boolean;
};

export type DesignLayoutReadOptions = {
  project: string;
  app?: string;
  route: string;
  state?: string;
  viewport?: string;
  question?: string;
  object?: string;
  edge?: string;
  capture?: string;
  compare?: string;
  json?: boolean;
};

export type DesignLayoutRefreshOptions = {
  project: string;
  app?: string;
  page: string[];
  baseUrl?: string;
  state?: string;
  viewport?: string;
  json?: boolean;
};

export type DesignLayoutRebuildOptions = {
  project: string;
  app?: string;
  route: string;
  state?: string;
  viewport?: string;
  out?: string;
  /** Consume a stale entry as a direction only; the output is labelled not-current. */
  allowStale?: boolean;
  compare?: string;
  json?: boolean;
};

export type CaptureFn = (input: {
  route: string;
  url: string;
  viewport: Viewport;
  click?: string;
}) => Promise<LayoutPageResult>;

export type Failure = {
  code: string;
  message: string;
  data?: Record<string, unknown>;
  actions?: string[];
  exit?: number;
};

export const DEFAULT_STATE = 'default';
export const DEFAULT_VIEWPORT = '390x844';
export const EXIT_REFUSED = 2;

const VIEWPORT_PATTERN = /^(\d+)x(\d+)$/;

export function failWith(
  io: ProgramIO,
  command: string,
  json: boolean | undefined,
  failure: Failure
): void {
  printResult(
    io,
    fail(command, failure.code, failure.message, failure.data ?? {}, failure.actions ?? []),
    json === true
  );
  process.exitCode = failure.exit ?? 1;
}

export function designRootOf(options: { project: string; app?: string }): string {
  return join(resolve(options.project), options.app ?? '', 'design');
}

/** The same trust rule the render check uses; an unreadable contract admits loopback only. */
export function trustedUrl(options: { project: string; app?: string; url: string }): boolean {
  const engine = readEngineContract(designRootOf(options));
  return engine.ok ? isTrustedDesignUrl(options.url, engine.contract) : isLoopbackUrl(options.url);
}

export function parseViewport(raw: string): Viewport | null {
  const match = VIEWPORT_PATTERN.exec(raw.trim());
  const width = match?.[1];
  const height = match?.[2];
  if (width === undefined || height === undefined) return null;
  const viewport = { width: Number(width), height: Number(height) };
  return viewport.width > 0 && viewport.height > 0 ? viewport : null;
}

export function viewportList(raw: string | undefined): Viewport[] | null {
  const parts = (raw ?? DEFAULT_VIEWPORT).split(',');
  const viewports = parts.map((part) => parseViewport(part));
  if (viewports.some((viewport) => viewport === null)) return null;
  return viewports.filter((viewport): viewport is Viewport => viewport !== null);
}

export function viewportLabel(viewport: Viewport): string {
  return `${String(viewport.width)}x${String(viewport.height)}`;
}

export type Selection = {
  entry: LayoutEntry;
  /** The index coordinate the entry was read from; every derived path uses it. */
  route: string;
  state: string;
  viewport: Viewport;
};

/** Why a parsed entry does not describe the coordinate it was read from, or null. */
function keyMismatch(key: SelectionKey, entry: LayoutEntry): string | null {
  if (key.route !== entry.route) return 'the entry names a different route than its index row';
  if (key.state !== entry.state) return 'the entry names a different state than its index row';
  if (
    key.viewport.width !== entry.viewport.width ||
    key.viewport.height !== entry.viewport.height
  ) {
    return 'the entry names a different viewport than its index row';
  }
  return null;
}

type SelectionKey = { route: string; state: string; viewport: Viewport };

/** The viewport a command narrows to, `undefined` for none, or null after a refusal. */
function viewportOf(
  options: DesignLayoutReadOptions | DesignLayoutRebuildOptions,
  io: ProgramIO,
  command: string
): Viewport | undefined | null {
  if (options.viewport === undefined) return undefined;
  const viewport = parseViewport(options.viewport);
  if (viewport !== null) return viewport;
  failWith(io, command, options.json, {
    code: 'DESIGN_LAYOUT_VIEWPORT_INVALID',
    message: 'viewport must be WxH',
    exit: EXIT_REFUSED
  });
  return null;
}

type RefusalContext = {
  io: ProgramIO;
  command: string;
  options: DesignLayoutReadOptions | DesignLayoutRebuildOptions;
};

/** Read the entry at its index coordinate; a header that disagrees with it is refused. */
function readAt(projectRoot: string, key: SelectionKey, context: RefusalContext): Selection | null {
  const { io, command, options } = context;
  const read = readEntry(projectRoot, key);
  if (!read.ok) {
    failWith(io, command, options.json, {
      code: 'DESIGN_LAYOUT_ENTRY_INVALID',
      message: read.reason,
      data: { route: options.route }
    });
    return null;
  }
  const mismatch = keyMismatch(key, read.entry);
  if (mismatch !== null) {
    failWith(io, command, options.json, {
      code: 'DESIGN_LAYOUT_ENTRY_MISMATCH',
      message: mismatch,
      data: { route: options.route, state: key.state },
      exit: EXIT_REFUSED
    });
    return null;
  }
  return { entry: read.entry, route: key.route, state: key.state, viewport: key.viewport };
}

/** Resolve the entry a command names; an ambiguous or missing entry is a refusal. */
export function selectionFor(
  options: DesignLayoutReadOptions | DesignLayoutRebuildOptions,
  io: ProgramIO,
  command: string
): Selection | null {
  const viewport = viewportOf(options, io, command);
  if (viewport === null) return null;
  const projectRoot = resolve(options.project);
  const selected = selectEntry(projectRoot, {
    route: options.route,
    ...(options.state === undefined ? {} : { state: options.state }),
    ...(viewport === undefined ? {} : { viewport })
  });
  if (!selected.ok) {
    failWith(io, command, options.json, {
      code: 'DESIGN_LAYOUT_ENTRY_MISSING',
      message: selected.reason,
      data: { route: options.route, available: selected.available },
      exit: EXIT_REFUSED
    });
    return null;
  }
  const key: SelectionKey = {
    route: selected.entry.route,
    state: selected.entry.state,
    viewport: selected.entry.viewport
  };
  return readAt(projectRoot, key, { io, command, options });
}

/**
 * The freshness of one entry against the contract the project records, plus the
 * measured document when a caller has one.
 */
export function entryFreshness(
  entry: LayoutEntry,
  options: { project: string; app?: string },
  geometry?: LayoutGeometry
): EntryFreshness {
  const projectRoot = resolve(options.project);
  const tokens = readSpacingTokensStrict(
    options.app === undefined ? recordedDesignRoot(projectRoot) : designRootOf(options)
  );
  return freshnessOf(entry, {
    ...(tokens.ok ? { tokens: tokens.tokens } : { tokensUnreadable: true }),
    ...(geometry === undefined ? {} : { geometry })
  });
}

/** Why a stale entry may not be consumed here, or null when it may. */
export function staleRefusal(
  freshness: EntryFreshness,
  allowStale: boolean | undefined
): Failure | null {
  if (freshness.status !== 'stale' || allowStale === true) return null;
  return {
    code: 'DESIGN_LAYOUT_ENTRY_STALE',
    message:
      `the entry is stale (${freshness.reasons.join(', ')}); re-measure it, or ask for it as a ` +
      'direction only so the result is not cited as current evidence',
    data: { status: freshness.status, reasons: freshness.reasons },
    exit: EXIT_REFUSED
  };
}

/** The freshness a consumer may use, or null after a stale refusal has been printed. */
export function freshnessAllowed(
  selection: Selection,
  options: DesignLayoutRebuildOptions,
  io: ProgramIO,
  command: string
): EntryFreshness | null {
  const freshness = entryFreshness(selection.entry, options);
  const refusal = staleRefusal(freshness, options.allowStale);
  if (refusal === null) return freshness;
  failWith(io, command, options.json, refusal);
  return null;
}

/** The warning a consumer prints when it used an entry that is not current. */
export function freshnessWarnings(freshness: EntryFreshness): string[] {
  if (freshness.status === 'current') return [];
  return [
    `the entry is ${freshness.status} (${freshness.reasons.join(', ')}); ` +
      'its relations are not current alignment evidence'
  ];
}
