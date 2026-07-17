import { Command } from 'commander';
import { readConfig } from '../../services/config/config-service.js';
import type { PeaksConfig } from '../../services/config/config-types.js';
import { resolveCapabilityAvailability } from '../../services/recommendations/capability-availability.js';
import { createCapabilityMapPlan } from '../../services/recommendations/capability-map-service.js';
import { seedCapabilityItems, seedCapabilitySources } from '../../services/recommendations/seed-capability-catalog.js';
import type { CapabilityMapSourceFilter } from '../../services/recommendations/recommendation-types.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';

type CapabilityMapOptions = {
  json?: boolean;
  source: string;
};

const CAPABILITY_SOURCE_FILTERS = new Set<CapabilityMapSourceFilter>(['all', 'access-repo', 'mcp-server']);

export function registerCapabilityCommands(program: Command, io: ProgramIO): void {
  const capability = program.command('capability').description('Inspect Peaks capability catalog and runtime availability');
  addJsonOption(capability.command("status").description("Show seed capability availability")).action((options: { json?: boolean }) => runCapabilityStatus(io, options));

  addCapabilityMapOptions(capability.command('map').description('Show dry-run external capability landing map')).action((options: CapabilityMapOptions) => runCapabilityMap(io, options));
  addCapabilityMapOptions(program.command('capabilities').description('Show dry-run external capability landing map')).action((options: CapabilityMapOptions) => runCapabilityMap(io, options));
}

export function runCapabilityStatus(io: ProgramIO, options: { json?: boolean }): void {
  const availability = resolveCapabilityAvailability(seedCapabilityItems);
  printResult(io, ok("capability.status", { sources: seedCapabilitySources, items: seedCapabilityItems, availability }), options.json);
}

function addCapabilityMapOptions(command: Command): Command {
  return addJsonOption(command.option('--source <source>', 'Filter source group: all, access-repo, or mcp-server', 'all'));
}

export function runCapabilityMap(io: ProgramIO, options: CapabilityMapOptions): void {
  const source = parseCapabilityMapSource(options.source);

  if (!source) {
    printResult(io, fail('capabilities.map', 'UNSUPPORTED_CAPABILITY_SOURCE', 'Supported capability sources are all, access-repo, and mcp-server', { source: options.source }, ['Rerun with --source all, --source access-repo, or --source mcp-server']), options.json);
    process.exitCode = 1;
    return;
  }

  const config = readConfig();
  const installedCapabilityIds = getInstalledCapabilityIds(config);
  const httpProxy = config.proxy?.httpProxy;
  printResult(io, ok('capabilities.map', createCapabilityMapPlan({
    source,
    installedCapabilityIds,
    ...(httpProxy === undefined ? {} : { httpProxy })
  })), options.json);
}

export function getInstalledCapabilityIds(_config: PeaksConfig): string[] {
  return [];
}

export function parseCapabilityMapSource(source: string): CapabilityMapSourceFilter | null {
  if (CAPABILITY_SOURCE_FILTERS.has(source as CapabilityMapSourceFilter)) {
    return source as CapabilityMapSourceFilter;
  }

  return null;
}
