/**
 * `peaks design layout read` and `peaks design layout rebuild` — the reading
 * surface and the direction preview. Read returns a fragment bounded to two
 * kilobytes and labels an entry that cannot be checked as not-current evidence;
 * rebuild refuses to write a preview whose round trip does not hold.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { ok } from 'peaks-loop-shared/result';

import {
  entryFileName,
  graphRoot,
  routeSlug
} from '../../services/design/layout/layout-graph-store.js';
import { readCapture } from '../../services/design/layout/layout-graph-query.js';
import { PREVIEW_MARKER, rebuildHtml } from '../../services/design/layout/layout-preview.js';
import { verifyRoundTrip, type RoundTrip } from '../../services/design/layout/layout-roundtrip.js';
import {
  MAX_FRAGMENT_BYTES,
  sliceEntry,
  type SliceRequest
} from '../../services/design/layout/layout-inject.js';
import { getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  entryFreshness,
  EXIT_REFUSED,
  failWith,
  freshnessWarnings,
  selectionFor,
  staleRefusal,
  viewportLabel,
  type DesignLayoutReadOptions,
  type DesignLayoutRebuildOptions,
  type Selection
} from './design-layout-shared.js';

const HTML_SUFFIX = '.html';
const TEXT_SUFFIX = '.txt';

function requestOf(options: DesignLayoutReadOptions): SliceRequest {
  const edge = options.edge === 'left' || options.edge === 'top' ? options.edge : undefined;
  return {
    ...(options.question === undefined ? {} : { question: options.question }),
    ...(options.object === undefined ? {} : { objectId: options.object }),
    ...(edge === undefined ? {} : { edge })
  };
}

export function runDesignLayoutRead(options: DesignLayoutReadOptions, io: ProgramIO): void {
  const command = 'design.layout.read';
  const selection = selectionFor(options, io, command);
  if (selection === null) return;
  const capture = options.capture === undefined ? null : readCapture(options.capture);
  if (capture !== null && !capture.ok) {
    failWith(io, command, options.json, {
      code: 'DESIGN_LAYOUT_CAPTURE_INVALID',
      message: capture.reason,
      exit: EXIT_REFUSED
    });
    return;
  }
  const freshness = entryFreshness(
    selection.entry,
    options,
    capture === null || !capture.ok ? undefined : capture.geometry
  );
  const slice = sliceEntry(selection.entry, freshness, requestOf(options));
  const warnings =
    slice.status === 'current'
      ? []
      : [
          `the entry is ${slice.status} (${slice.reasons.join(', ')}); its edges are not current evidence`
        ];
  printResult(
    io,
    ok(
      command,
      {
        route: selection.route,
        state: selection.state,
        viewport: viewportLabel(selection.viewport),
        status: slice.status,
        reasons: slice.reasons,
        bytes: slice.bytes,
        limit: MAX_FRAGMENT_BYTES,
        truncated: slice.truncated,
        fragment: slice.text
      },
      warnings
    ),
    options.json === true
  );
}

function previewPath(
  options: DesignLayoutRebuildOptions,
  state: string,
  viewport: { width: number; height: number }
): string {
  if (options.out !== undefined) return resolve(options.out);
  return join(
    graphRoot(resolve(options.project)),
    routeSlug(options.route),
    'preview',
    entryFileName(state, viewport).replace(TEXT_SUFFIX, HTML_SUFFIX)
  );
}

type Preview = { html: string; roundTrip: Extract<RoundTrip, { ok: true }> };

/** The preview bytes and its verified round trip, or null after a reported refusal. */
function previewFor(
  selection: Selection,
  io: ProgramIO,
  options: DesignLayoutRebuildOptions
): Preview | null {
  const command = 'design.layout.rebuild';
  const roundTrip = verifyRoundTrip(selection.entry);
  if (!roundTrip.ok) {
    failWith(io, command, options.json, {
      code: 'DESIGN_LAYOUT_ROUNDTRIP_FAILED',
      message: roundTrip.mismatches.join('; '),
      data: { route: selection.route },
      exit: EXIT_REFUSED
    });
    return null;
  }
  const rebuilt = rebuildHtml(selection.entry);
  if (!rebuilt.ok) {
    failWith(io, command, options.json, {
      code: 'DESIGN_LAYOUT_REBUILD_FAILED',
      message: rebuilt.reason,
      data: { route: selection.route }
    });
    return null;
  }
  if (!rebuilt.html.includes(PREVIEW_MARKER)) {
    failWith(io, command, options.json, {
      code: 'DESIGN_LAYOUT_PREVIEW_UNMARKED',
      message: 'the preview lost its direction-preview marker',
      data: { route: selection.route }
    });
    return null;
  }
  return { html: rebuilt.html, roundTrip };
}

/** Write the preview; the failure message, or null when it landed. */
function writePreview(path: string, html: string): string | null {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, html, 'utf8');
    return null;
  } catch (error) {
    return getErrorMessage(error);
  }
}

export function runDesignLayoutRebuild(options: DesignLayoutRebuildOptions, io: ProgramIO): void {
  const command = 'design.layout.rebuild';
  const selection = selectionFor(options, io, command);
  if (selection === null) return;
  const freshness = entryFreshness(selection.entry, options);
  const refusal = staleRefusal(freshness, options.allowStale);
  if (refusal !== null) {
    failWith(io, command, options.json, refusal);
    return;
  }
  const preview = previewFor(selection, io, options);
  if (preview === null) return;
  const path = previewPath(options, selection.state, selection.viewport);
  const writeProblem = writePreview(path, preview.html);
  if (writeProblem !== null) {
    failWith(io, command, options.json, {
      code: 'DESIGN_LAYOUT_WRITE_FAILED',
      message: writeProblem,
      data: { route: selection.route }
    });
    return;
  }
  printResult(
    io,
    ok(
      command,
      {
        route: selection.route,
        state: selection.state,
        viewport: viewportLabel(selection.viewport),
        path,
        sha256: createHash('sha256').update(preview.html).digest('hex'),
        roundTrip: preview.roundTrip,
        marker: 'direction-preview-not-an-implementation',
        freshness
      },
      freshnessWarnings(freshness)
    ),
    options.json === true
  );
}
