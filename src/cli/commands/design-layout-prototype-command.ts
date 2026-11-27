/**
 * `peaks design layout prototype` and `peaks design layout mix` — the two
 * operator commands over direction prototypes. The first writes every generated
 * prototype and reports which survive structural filtering; the second composes
 * blocks one at a time and refuses the first move its pre-check does not allow.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { ok } from 'peaks-loop-shared/result';

import { graphRoot, routeSlug } from '../../services/design/layout/layout-graph-store.js';
import type { EntryFreshness } from '../../services/design/layout/layout-graph.js';
import {
  mixSequence,
  type MixFailureCode,
  type MixMove,
  type MixResult
} from '../../services/design/layout/layout-mix.js';
import {
  filterPrototypes,
  generatePrototypes,
  type Prototype
} from '../../services/design/layout/layout-prototype.js';
import { getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  EXIT_REFUSED,
  failWith,
  freshnessAllowed,
  freshnessWarnings,
  selectionFor,
  viewportLabel,
  type DesignLayoutRebuildOptions,
  type Selection
} from './design-layout-shared.js';

export type DesignLayoutPrototypeOptions = DesignLayoutRebuildOptions;

export type DesignLayoutMixOptions = DesignLayoutRebuildOptions & {
  base: string;
  move: string[];
};

function prototypeDir(projectRoot: string, route: string): string {
  return join(graphRoot(projectRoot), routeSlug(route), 'prototypes');
}

type WrittenFile = { name: string; path: string };

type Written = { ok: true; files: WrittenFile[] } | { ok: false; reason: string };

/** Every prototype file is written concurrently; one failure names the write. */
async function writePrototypes(dir: string, prototypes: readonly Prototype[]): Promise<Written> {
  try {
    await mkdir(dir, { recursive: true });
    const files = await Promise.all(
      prototypes.map(async (prototype) => {
        const path = join(dir, `${prototype.name}.html`);
        await writeFile(path, prototype.html, 'utf8');
        return { name: prototype.name, path };
      })
    );
    return { ok: true, files };
  } catch (error) {
    return { ok: false, reason: `the prototypes could not be written (${getErrorMessage(error)})` };
  }
}

function prototypeData(
  prototypes: readonly Prototype[],
  files: readonly WrittenFile[]
): Record<string, unknown>[] {
  const paths = new Map(files.map((file) => [file.name, file.path]));
  return prototypes.map((prototype) => ({
    name: prototype.name,
    path: paths.get(prototype.name) ?? '',
    marker: prototype.marker,
    blocks: prototype.blocks.map((block) => ({
      blockId: block.blockId,
      role: block.role,
      chainRoles: block.chainRoles,
      sources: block.sources
    })),
    violations: prototype.violations
  }));
}

/** The written files, or null after the write refusal has been printed. */
async function prototypesWritten(
  dir: string,
  prototypes: readonly Prototype[],
  view: { io: ProgramIO; options: DesignLayoutPrototypeOptions; selection: Selection }
): Promise<WrittenFile[] | null> {
  const { io, options, selection } = view;
  const written = await writePrototypes(dir, prototypes);
  if (written.ok) return written.files;
  failWith(io, 'design.layout.prototype', options.json, {
    code: 'DESIGN_LAYOUT_WRITE_FAILED',
    message: written.reason,
    data: { route: selection.route, root: dir }
  });
  return null;
}

export async function runDesignLayoutPrototype(
  options: DesignLayoutPrototypeOptions,
  io: ProgramIO
): Promise<void> {
  const command = 'design.layout.prototype';
  const selection = selectionFor(options, io, command);
  if (selection === null) return;
  const freshness = freshnessAllowed(selection, options, io, command);
  if (freshness === null) return;
  const generated = generatePrototypes(selection.entry);
  if (!generated.ok) {
    failWith(io, command, options.json, {
      code: 'DESIGN_LAYOUT_PROTOTYPE_FAILED',
      message: generated.reason,
      data: { route: selection.route }
    });
    return;
  }
  const filter = filterPrototypes(generated.prototypes);
  const dir =
    options.out === undefined
      ? prototypeDir(resolve(options.project), selection.route)
      : resolve(options.out);
  const files = await prototypesWritten(dir, generated.prototypes, { io, options, selection });
  if (files === null) return;
  printResult(
    io,
    ok(
      command,
      {
        route: selection.route,
        state: selection.state,
        viewport: viewportLabel(selection.viewport),
        root: dir,
        freshness,
        prototypes: prototypeData(generated.prototypes, files),
        kept: filter.kept.map((prototype) => prototype.name),
        capped: filter.capped,
        dropped: filter.dropped.map((entry) => ({ name: entry.name, violations: entry.violations }))
      },
      freshnessWarnings(freshness)
    ),
    options.json === true
  );
}

function parseMove(raw: string): MixMove | null {
  const at = raw.indexOf('=');
  if (at <= 0 || at === raw.length - 1) return null;
  return { blockId: raw.slice(0, at), from: raw.slice(at + 1) };
}

function mixCode(code: MixFailureCode): string {
  if (code === 'ANCHOR_SOURCE_CONFLICT') return 'DESIGN_LAYOUT_MIX_CONFLICT';
  if (code === 'PARENT_CHAIN_BROKEN') return 'DESIGN_LAYOUT_MIX_PARENT_CHAIN_BROKEN';
  return 'DESIGN_LAYOUT_MIX_CONTRACT_VIOLATION';
}

type MixedWrite = { ok: true; path: string } | { ok: false; reason: string };

function writeMixed(path: string, html: string): MixedWrite {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, html, 'utf8');
    return { ok: true, path };
  } catch (error) {
    return { ok: false, reason: `the mixed page could not be written (${getErrorMessage(error)})` };
  }
}

function movesOf(options: DesignLayoutMixOptions): MixMove[] | null {
  const moves: MixMove[] = [];
  for (const raw of options.move) {
    const move = parseMove(raw);
    if (move === null) return null;
    moves.push(move);
  }
  return moves;
}

type MixFailure = Extract<MixResult, { ok: false }>;
type MixSuccess = Extract<MixResult, { ok: true }>;

function mixedPath(options: DesignLayoutMixOptions, selection: Selection): string {
  return options.out === undefined
    ? join(prototypeDir(resolve(options.project), selection.route), 'mixed.html')
    : resolve(options.out);
}

function reportMixFailure(
  io: ProgramIO,
  options: DesignLayoutMixOptions,
  selection: Selection,
  result: MixFailure
): void {
  if (options.out === undefined) rmSync(mixedPath(options, selection), { force: true });
  failWith(io, 'design.layout.mix', options.json, {
    code: mixCode(result.code),
    message: result.message,
    data: {
      route: selection.route,
      base: options.base,
      failure: result.code,
      steps: result.steps,
      conflict: result.conflict
    },
    exit: EXIT_REFUSED
  });
}

function finishMix(
  io: ProgramIO,
  options: DesignLayoutMixOptions,
  result: MixSuccess,
  view: { selection: Selection; freshness: EntryFreshness }
): void {
  const { selection, freshness } = view;
  const path = mixedPath(options, selection);
  const written = writeMixed(path, result.html);
  if (!written.ok) {
    failWith(io, 'design.layout.mix', options.json, {
      code: 'DESIGN_LAYOUT_WRITE_FAILED',
      message: written.reason,
      data: { route: selection.route }
    });
    return;
  }
  printResult(
    io,
    ok(
      'design.layout.mix',
      {
        route: selection.route,
        state: selection.state,
        viewport: viewportLabel(selection.viewport),
        base: options.base,
        path: written.path,
        sha256: createHash('sha256').update(result.html).digest('hex'),
        freshness,
        steps: result.steps,
        blocks: result.blocks.map((block) => ({
          blockId: block.blockId,
          role: block.role,
          sources: block.sources
        }))
      },
      freshnessWarnings(freshness)
    ),
    options.json === true
  );
}

export function runDesignLayoutMix(options: DesignLayoutMixOptions, io: ProgramIO): void {
  const command = 'design.layout.mix';
  const selection = selectionFor(options, io, command);
  if (selection === null) return;
  const freshness = freshnessAllowed(selection, options, io, command);
  if (freshness === null) return;
  const moves = movesOf(options);
  if (moves === null || moves.length === 0) {
    failWith(io, command, options.json, {
      code: 'DESIGN_LAYOUT_MIX_MOVE_INVALID',
      message: 'every move must name <blockId>=<prototype>, and at least one is required',
      exit: EXIT_REFUSED
    });
    return;
  }
  const generated = generatePrototypes(selection.entry);
  if (!generated.ok) {
    failWith(io, command, options.json, {
      code: 'DESIGN_LAYOUT_PROTOTYPE_FAILED',
      message: generated.reason,
      data: { route: selection.route }
    });
    return;
  }
  const result = mixSequence(selection.entry, generated.prototypes, options.base, moves);
  if (!result.ok) {
    reportMixFailure(io, options, selection, result);
    return;
  }
  finishMix(io, options, result, { selection, freshness });
}
