import type { CapabilityAvailability, CapabilityItem } from './recommendation-types.js';

export type CapabilityAvailabilityOptions = {
  installedCapabilityIds?: string[];
};

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

function getMissingStatus(item: CapabilityItem): CapabilityAvailability['status'] {
  if (item.itemType === 'mcp' || item.itemType === 'skill' || item.itemType === 'agent') {
    return 'installable';
  }

  return 'unknown';
}

export function resolveCapabilityAvailability(
  items: CapabilityItem[],
  options: CapabilityAvailabilityOptions = {}
): CapabilityAvailability[] {
  const installedCapabilityIds = new Set(options.installedCapabilityIds ?? []);

  return items.map((item) => {
    const isInstalled = installedCapabilityIds.has(item.capabilityId);
    const status = isInstalled ? 'available' : getMissingStatus(item);
    const installPlan = isInstalled
      ? undefined
      : {
          available: status === 'installable',
          requiresApproval: true
        };

    return {
      capabilityId: item.capabilityId,
      type: getAvailabilityType(item),
      status,
      requiredFor: item.workflows,
      ...(installPlan ? { installPlan } : {}),
      fallback: item.fallback,
      risk: item.riskLevel
    };
  });
}
