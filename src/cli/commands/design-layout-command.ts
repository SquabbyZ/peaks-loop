/**
 * `peaks design layout ...` — registers the graph's three operator commands.
 * The user-facing surface is unchanged: every verb is invoked on the user's
 * behalf, and the command never asks the user to type one.
 */
import type { Command } from 'commander';

import { addJsonOption, type ProgramIO } from '../cli-helpers.js';
import { runDesignLayoutBuild } from './design-layout-build-command.js';
import {
  runDesignLayoutMix,
  runDesignLayoutPrototype,
  type DesignLayoutMixOptions,
  type DesignLayoutPrototypeOptions
} from './design-layout-prototype-command.js';
import { runDesignLayoutRead, runDesignLayoutRebuild } from './design-layout-read-command.js';
import { runDesignLayoutRefresh } from './design-layout-refresh-command.js';
import {
  EXIT_REFUSED,
  failWith,
  type DesignLayoutBuildOptions,
  type DesignLayoutReadOptions,
  type DesignLayoutRebuildOptions,
  type DesignLayoutRefreshOptions
} from './design-layout-shared.js';

const ALLOW_STALE_HELP: [string, string] = [
  '--allow-stale',
  'use an entry the contract marks stale; the result is labelled direction preview'
];

function readAction(options: DesignLayoutReadOptions, io: ProgramIO): void {
  if (options.edge !== undefined && options.edge !== 'left' && options.edge !== 'top') {
    failWith(io, 'design.layout.read', options.json, {
      code: 'DESIGN_LAYOUT_EDGE_INVALID',
      message: 'edge must be left or top',
      exit: EXIT_REFUSED
    });
    return;
  }
  runDesignLayoutRead(options, io);
}

function collectMove(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function registerRefreshCommand(layout: Command, io: ProgramIO): void {
  addJsonOption(
    layout
      .command('refresh')
      .description('Re-measure only the entries a moved spacing token or source reaches')
      .requiredOption('--project <path>', 'project root')
      .option('--app <path>', 'app root when the design contract does not sit at the project root')
      .option('--page <route=url>', 'one page to re-measure; repeat for more', collectMove, [])
      .option('--base-url <url>', 'address dependent routes that were not named as pages')
      .option('--state <name>', 'state the pages are in (default default)')
      .option('--viewport <list>', 'comma-separated WxH viewports (default 390x844)')
  ).action((options: DesignLayoutRefreshOptions) => runDesignLayoutRefresh(options, io));
}

function registerPrototypeCommand(layout: Command, io: ProgramIO): void {
  addJsonOption(
    layout
      .command('prototype')
      .description('Write at least five independent direction-preview pages for one route')
      .requiredOption('--project <path>', 'project root')
      .requiredOption('--route <route>', 'route to prototype')
      .option('--app <path>', 'app root when the design contract does not sit at the project root')
      .option('--state <name>', 'state to prototype')
      .option('--viewport <WxH>', 'viewport to prototype')
      .option(
        '--out <dir>',
        'write the prototypes to this directory instead of the graph directory'
      )
      .option(ALLOW_STALE_HELP[0], ALLOW_STALE_HELP[1])
  ).action((options: DesignLayoutPrototypeOptions) => runDesignLayoutPrototype(options, io));
}

function registerMixCommand(layout: Command, io: ProgramIO): void {
  addJsonOption(
    layout
      .command('mix')
      .description('Replace one block at a time and refuse a move the pre-check does not allow')
      .requiredOption('--project <path>', 'project root')
      .requiredOption('--route <route>', 'route to mix')
      .requiredOption('--base <name>', 'prototype the sequence starts from')
      .option(
        '--move <blockId=prototype>',
        'one block replacement; repeat for the next block',
        collectMove,
        []
      )
      .option('--app <path>', 'app root when the design contract does not sit at the project root')
      .option('--state <name>', 'state to mix')
      .option('--viewport <WxH>', 'viewport to mix')
      .option('--out <file>', 'write the mixed page to this file instead of the graph directory')
      .option(ALLOW_STALE_HELP[0], ALLOW_STALE_HELP[1])
  ).action((options: DesignLayoutMixOptions) => runDesignLayoutMix(options, io));
}

export function registerDesignLayoutCommand(design: Command, io: ProgramIO): void {
  const layout = design
    .command('layout')
    .description('Build, read and rebuild the ASCII layout graph');
  addJsonOption(
    layout
      .command('build')
      .description('Capture a route and write its layout graph entry under .peaks/layout-graph')
      .requiredOption('--project <path>', 'project root')
      .requiredOption('--route <route>', 'route the page represents, such as /')
      .requiredOption('--url <url>', 'render URL of the page')
      .option('--app <path>', 'app root when the design contract does not sit at the project root')
      .option('--state <name>', 'state the page is in (default default)')
      .option('--viewport <list>', 'comma-separated WxH viewports (default 390x844)')
  ).action((options: DesignLayoutBuildOptions) => runDesignLayoutBuild(options, io));
  addJsonOption(
    layout
      .command('read')
      .description('Return one graph entry trimmed to the question, at most 2 KB')
      .requiredOption('--project <path>', 'project root')
      .requiredOption('--route <route>', 'route to read')
      .option('--app <path>', 'app root when the design contract does not sit at the project root')
      .option('--state <name>', 'state to read when the route has several')
      .option('--viewport <WxH>', 'viewport to read when the route has several')
      .option('--question <text>', 'the question the fragment is trimmed to')
      .option('--object <id>', 'focus one numbered object')
      .option('--edge <edge>', 'focus left or top shared edges')
      .option(
        '--capture <file>',
        'a current measured geometry document; build writes one per entry'
      )
  ).action((options: DesignLayoutReadOptions) => readAction(options, io));
  addJsonOption(
    layout
      .command('rebuild')
      .description('Rebuild a graph entry as a marked direction-preview page')
      .requiredOption('--project <path>', 'project root')
      .requiredOption('--route <route>', 'route to rebuild')
      .option('--state <name>', 'state to rebuild')
      .option('--viewport <WxH>', 'viewport to rebuild')
      .option('--out <file>', 'write the preview to this file instead of the graph directory')
      .option(ALLOW_STALE_HELP[0], ALLOW_STALE_HELP[1])
  ).action((options: DesignLayoutRebuildOptions) => runDesignLayoutRebuild(options, io));
  registerRefreshCommand(layout, io);
  registerPrototypeCommand(layout, io);
  registerMixCommand(layout, io);
}
