export type CapabilitySourceType = 'repo' | 'skills-package' | 'mcp-collection' | 'website' | 'local-install';
export type CapabilityItemType = 'skill' | 'agent' | 'mcp' | 'rule' | 'hook' | 'template' | 'workflow' | 'doc' | 'cli';
export type CapabilityAvailabilityStatus = 'available' | 'installable' | 'disabled' | 'unknown';
export type RiskLevel = 'low' | 'medium' | 'high';
export type CapabilitySourceGroup = 'access-repo' | 'mcp-server';
export type CapabilityLandingKind = 'cli' | 'skill' | 'catalog' | 'fallback';
export type CapabilityMapSourceFilter = CapabilitySourceGroup | 'all';

export type LocalizedText = Record<string, string>;

export type CapabilityFallback = {
  mode: string;
  qualityImpact: string;
  nextAction?: string;
};

export type CapabilitySource = {
  sourceId: string;
  sourceType: CapabilitySourceType;
  sourceGroup?: CapabilitySourceGroup;
  title: string;
  url: string;
  trustSignals?: {
    sourceReputation?: string;
    stars?: number;
    installs?: number;
    maintainer?: string;
    notes?: string[];
  };
  discoveryStatus: 'unscanned' | 'indexed' | 'verified' | 'deprecated';
  items: string[];
};

export type CapabilityItem = {
  capabilityId: string;
  sourceId: string;
  name: string;
  itemType: CapabilityItemType;
  category: string;
  workflows: string[];
  audience: string[];
  riskLevel: RiskLevel;
  inputContract?: string;
  outputContract?: string;
  fallback: CapabilityFallback;
  presentation: {
    displayName: LocalizedText;
    description: LocalizedText;
  };
};

export type CapabilityAvailability = {
  capabilityId: string;
  type: 'skill' | 'mcp' | 'cli' | 'agent' | 'profile';
  status: CapabilityAvailabilityStatus;
  requiredFor: string[];
  installPlan?: {
    available: boolean;
    commandPreview?: string;
    requiresApproval: boolean;
  };
  fallback: CapabilityFallback;
  risk: RiskLevel;
};

export type CapabilityLandingMapping = {
  capabilityId: string;
  sourceId: string;
  sourceGroup: CapabilitySourceGroup;
  landingKind: CapabilityLandingKind;
  target: string;
  commandPreview?: string;
  skillName?: string;
  guidance: string;
  dryRunOnly: boolean;
};

export type CapabilityMapPlan = {
  dryRunOnly: true;
  executionPolicy: {
    allowInstall: false;
    allowClone: false;
    allowConfigWrite: false;
    allowSecretExfiltration: false;
  };
  proxyPolicy?: {
    requiredForExternalAccess: true;
    httpProxy: string;
  };
  sources: CapabilitySource[];
  items: CapabilityItem[];
  mappings: CapabilityLandingMapping[];
  availability: CapabilityAvailability[];
  constraints: string[];
  warnings: string[];
};

export type RecommendationOption = {
  id: string;
  label: string;
  why: string;
  requiredCapabilities: string[];
  fallbackPath?: string;
};

export type RecommendationPlan = {
  intent: string;
  workflow: string;
  profile: string;
  audience: string[];
  options: RecommendationOption[];
  requiredCapabilities: string[];
  availability: CapabilityAvailability[];
  fallbacks: CapabilityFallback[];
  decisionRequired: boolean;
  machine: {
    nextActions: Array<{
      id: string;
      type: 'invoke-capability' | 'use-fallback';
      capabilityId?: string;
      requiresApproval: boolean;
      riskLevel: RiskLevel;
    }>;
    constraints: string[];
    stopConditions: string[];
  };
  presentation: {
    language: string;
    summary: string;
    options: Array<{
      id: string;
      label: string;
      why: string;
    }>;
    warnings: string[];
    explanations: string[];
  };
};
