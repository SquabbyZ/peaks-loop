import { seedCapabilityItems, seedCapabilityLandingMappings, seedCapabilitySources } from './seed-capability-catalog.js';
import type { CapabilityAvailability, CapabilityFallback, CapabilityItem, CapabilityLandingMapping, CapabilityMapPlan, CapabilityMapSourceFilter, CapabilitySource, LocalizedText } from './recommendation-types.js';

export type CapabilityMapOptions = {
  source?: CapabilityMapSourceFilter;
  installedCapabilityIds?: string[];
  httpProxy?: string;
};

export function createCapabilityMapPlan(options: CapabilityMapOptions = {}): CapabilityMapPlan {
  const sourceFilter = options.source ?? 'all';
  const httpProxy = normalizeProxyUrl(options.httpProxy);
  const sources = sortSources(filterSources(sourceFilter));
  const sourceIds = new Set(sources.map((source) => source.sourceId));
  const items = sortItems(seedCapabilityItems.filter((item) => sourceIds.has(item.sourceId)));
  const mappings = sortMappings(seedCapabilityLandingMappings.filter((mapping) => sourceIds.has(mapping.sourceId)));
  const constraints = [
    'dry-run only: do not install MCP servers, skills, hooks, agents, or browser tooling from this map',
    'do not clone external repositories or write Claude settings from this map',
    'do not write Peaks config or credentials from this map',
    'do not send secrets, private code, or business data to external resources without explicit approval'
  ];

  if (httpProxy) {
    constraints.push(`use HTTP proxy ${httpProxy} for GitHub, registries, MCP directories, and external web access`);
  }

  return {
    dryRunOnly: true,
    executionPolicy: {
      allowInstall: false,
      allowClone: false,
      allowConfigWrite: false,
      allowSecretExfiltration: false
    },
    ...(httpProxy
      ? {
          proxyPolicy: {
            requiredForExternalAccess: true as const,
            httpProxy
          }
        }
      : {}),
    sources: cloneSources(sources),
    items: cloneItems(items),
    mappings: cloneMappings(mappings),
    availability: resolveDryRunAvailability(items, options.installedCapabilityIds ?? []),
    constraints,
    warnings: [
      'Browser automation capabilities require explicit app target approval and must not submit forms, purchase, delete, or mutate authenticated state without confirmation.',
      'Database capabilities require explicit credentials and confirmation before any write query.',
      'Figma and design-source capabilities require user-authorized project access and must not persist tokens in project artifacts.',
      'Cloud capabilities can affect cost or infrastructure and require explicit confirmation and credential boundaries.',
      'External skill packs stay catalog-only until inspected for license, safety, and project fit.'
    ]
  };
}

function normalizeProxyUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.username.length === 0 && url.password.length === 0 && url.pathname === '/' && url.search.length === 0 && url.hash.length === 0 ? value : undefined;
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return undefined;
  }
}

function filterSources(sourceFilter: CapabilityMapSourceFilter): CapabilitySource[] {
  if (sourceFilter === 'all') {
    return seedCapabilitySources;
  }

  return seedCapabilitySources.filter((source) => source.sourceGroup === sourceFilter);
}

function sortSources(sources: CapabilitySource[]): CapabilitySource[] {
  return [...sources].sort((left, right) => left.sourceId.localeCompare(right.sourceId));
}

function sortItems(items: CapabilityItem[]): CapabilityItem[] {
  return [...items].sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));
}

function sortMappings(mappings: CapabilityLandingMapping[]): CapabilityLandingMapping[] {
  return [...mappings].sort((left, right) => `${left.sourceId}:${left.capabilityId}`.localeCompare(`${right.sourceId}:${right.capabilityId}`));
}

function resolveDryRunAvailability(items: CapabilityItem[], installedCapabilityIds: string[]): CapabilityAvailability[] {
  const installedIds = new Set(installedCapabilityIds);

  return items.map((item) => ({
    capabilityId: item.capabilityId,
    type: getAvailabilityType(item),
    status: installedIds.has(item.capabilityId) ? 'available' : 'unknown',
    requiredFor: [...item.workflows],
    fallback: cloneFallback(item.fallback),
    risk: item.riskLevel
  }));
}

function getAvailabilityType(item: CapabilityItem): CapabilityAvailability['type'] {
  if (item.itemType === 'mcp') {
    return 'mcp';
  }

  if (item.itemType === 'agent') {
    return 'agent';
  }

  if (item.itemType === 'cli') {
    return 'cli';
  }

  return 'skill';
}

function cloneSources(sources: CapabilitySource[]): CapabilitySource[] {
  return sources.map((source) => ({
    ...source,
    ...(source.trustSignals
      ? {
          trustSignals: {
            ...source.trustSignals,
            ...(source.trustSignals.notes ? { notes: [...source.trustSignals.notes] } : {})
          }
        }
      : {}),
    items: [...source.items]
  }));
}

function cloneItems(items: CapabilityItem[]): CapabilityItem[] {
  return items.map((item) => ({
    ...item,
    workflows: [...item.workflows],
    audience: [...item.audience],
    fallback: cloneFallback(item.fallback),
    presentation: {
      displayName: cloneLocalizedText(item.presentation.displayName),
      description: cloneLocalizedText(item.presentation.description)
    }
  }));
}

function cloneMappings(mappings: CapabilityLandingMapping[]): CapabilityLandingMapping[] {
  return mappings.map((mapping) => ({ ...mapping }));
}

function cloneFallback(fallback: CapabilityFallback): CapabilityFallback {
  return { ...fallback };
}

function cloneLocalizedText(text: LocalizedText): LocalizedText {
  return { ...text };
}
