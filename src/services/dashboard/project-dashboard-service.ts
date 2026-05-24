import { listRequestArtifacts, type RequestArtifactRole, type RequestArtifactSummary } from '../artifacts/request-artifact-service.js';
import { scanOpenSpec } from '../openspec/openspec-scan-service.js';
import type { OpenSpecChangeSummary } from '../openspec/openspec-types.js';
import { scanMcpServers } from '../mcp/mcp-scan-service.js';
import type { McpScanReport } from '../mcp/mcp-types.js';
import { scanUnderstandAnything } from '../understand/understand-scan-service.js';
import { seedCapabilityItems } from '../recommendations/capability-seed-items.js';
import type { CapabilityItem } from '../recommendations/recommendation-types.js';
import { requiredSkillNames } from '../../shared/paths.js';
import type { DoctorCheck } from '../doctor/doctor-service.js';
import { getSkillPresence, type SkillPresence } from '../skills/skill-presence-service.js';

const SKILL_PRESENCE_FRESHNESS_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export type ProjectDashboardRequests = {
  count: number;
  byRole: Record<RequestArtifactRole, RequestArtifactSummary[]>;
  byState: Record<string, number>;
};

export type ProjectDashboardOpenSpec = {
  exists: boolean;
  count: number;
  changes: OpenSpecChangeSummary[];
};

export type ProjectDashboardUnderstand = {
  exists: boolean;
  graphExists: boolean;
  graphPath: string;
  parseError?: string;
};

export type ProjectDashboardMcp = {
  servers: McpScanReport['servers'];
  scopes: McpScanReport['scopes'];
};

export type ProjectDashboardDoctor = {
  ok: boolean;
  passed: number;
  failed: number;
};

export type ProjectDashboardRunbookHealth = {
  ok: boolean;
  required: number;
  healthy: number;
  missingRunbook: string[];
  applyNoteFailed: string[];
};

export type ProjectDashboardCapabilities = {
  count: number;
  mcpCount: number;
  sample: Array<Pick<CapabilityItem, 'capabilityId' | 'name' | 'itemType' | 'category'>>;
};

export type ProjectDashboardSkillPresence = {
  active: boolean;
  fresh: boolean;
  skill?: string;
  mode?: string;
  gate?: string;
  setAt?: string;
};

export type ProjectDashboard = {
  generatedAt: string;
  projectRoot: string;
  requests: ProjectDashboardRequests;
  openspec: ProjectDashboardOpenSpec;
  understand: ProjectDashboardUnderstand;
  mcp: ProjectDashboardMcp;
  doctor: ProjectDashboardDoctor;
  runbookHealth: ProjectDashboardRunbookHealth;
  capabilities: ProjectDashboardCapabilities;
  skillPresence: ProjectDashboardSkillPresence;
};

export type LoadProjectDashboardOptions = {
  projectRoot: string;
  sampleCapabilities?: number;
  clock?: () => string;
  doctorReport?: { ok: boolean; passed: number; failed: number };
  runbookHealth?: ProjectDashboardRunbookHealth;
  skillPresence?: SkillPresence | null;
};

function defaultClock(): string {
  return new Date().toISOString();
}

function groupRequestsByRole(items: RequestArtifactSummary[]): Record<RequestArtifactRole, RequestArtifactSummary[]> {
  const byRole: Record<RequestArtifactRole, RequestArtifactSummary[]> = { prd: [], ui: [], rd: [], qa: [], sc: [] };
  for (const item of items) {
    byRole[item.role].push(item);
  }
  return byRole;
}

function countRequestsByState(items: RequestArtifactSummary[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.state] = (counts[item.state] ?? 0) + 1;
  }
  return counts;
}

async function loadDoctorAndRunbookHealth(
  doctorOverride: { ok: boolean; passed: number; failed: number } | undefined,
  runbookOverride: ProjectDashboardRunbookHealth | undefined
): Promise<{ doctor: ProjectDashboardDoctor; runbookHealth: ProjectDashboardRunbookHealth }> {
  if (doctorOverride !== undefined && runbookOverride !== undefined) {
    return { doctor: doctorOverride, runbookHealth: runbookOverride };
  }
  if (doctorOverride !== undefined) {
    return {
      doctor: doctorOverride,
      runbookHealth: { ok: true, required: 0, healthy: 0, missingRunbook: [], applyNoteFailed: [] }
    };
  }
  const { runDoctor } = await import('../doctor/doctor-service.js');
  const report = await runDoctor();
  return {
    doctor: { ok: report.summary.ok, passed: report.summary.passed, failed: report.summary.failed },
    runbookHealth: runbookOverride ?? summarizeRunbookHealth(report.checks)
  };
}

function summarizeRunbookHealth(checks: DoctorCheck[]): ProjectDashboardRunbookHealth {
  const missingRunbook: string[] = [];
  const applyNoteFailed: string[] = [];
  for (const check of checks) {
    if (!check.ok && check.id.startsWith('skill-runbook:')) {
      missingRunbook.push(check.id.slice('skill-runbook:'.length));
    }
    if (!check.ok && check.id.startsWith('skill-apply-note:')) {
      applyNoteFailed.push(check.id.slice('skill-apply-note:'.length));
    }
  }
  const required = requiredSkillNames.length;
  const healthy = Math.max(0, required - missingRunbook.length - applyNoteFailed.length);
  return {
    ok: missingRunbook.length === 0 && applyNoteFailed.length === 0,
    required,
    healthy,
    missingRunbook,
    applyNoteFailed
  };
}

function buildCapabilitiesSummary(sampleSize: number): ProjectDashboardCapabilities {
  const items = seedCapabilityItems;
  return {
    count: items.length,
    mcpCount: items.filter((item) => item.itemType === 'mcp').length,
    sample: items.slice(0, sampleSize).map((item) => ({
      capabilityId: item.capabilityId,
      name: item.name,
      itemType: item.itemType,
      category: item.category
    }))
  };
}

function buildSkillPresenceSummary(presence: SkillPresence | null | undefined): ProjectDashboardSkillPresence {
  const resolved = presence === undefined ? getSkillPresence() : presence;
  if (resolved === null) {
    return { active: false, fresh: true };
  }
  const setAtMs = Date.parse(resolved.setAt);
  const fresh = !Number.isNaN(setAtMs) && Date.now() - setAtMs <= SKILL_PRESENCE_FRESHNESS_THRESHOLD_MS;
  return {
    active: true,
    fresh,
    skill: resolved.skill,
    ...(resolved.mode !== undefined ? { mode: resolved.mode } : {}),
    ...(resolved.gate !== undefined ? { gate: resolved.gate } : {}),
    setAt: resolved.setAt
  };
}

export async function loadProjectDashboard(options: LoadProjectDashboardOptions): Promise<ProjectDashboard> {
  const clock = options.clock ?? defaultClock;
  const sampleSize = options.sampleCapabilities ?? 8;

  const [items, openspecReport, mcpReport, understandReport, doctorAndRunbook] = await Promise.all([
    listRequestArtifacts({ projectRoot: options.projectRoot }),
    scanOpenSpec({ openspecRoot: `${options.projectRoot}/openspec` }),
    scanMcpServers({ projectRoot: options.projectRoot }),
    scanUnderstandAnything({ projectRoot: options.projectRoot }),
    loadDoctorAndRunbookHealth(options.doctorReport, options.runbookHealth)
  ]);

  return {
    generatedAt: clock(),
    projectRoot: options.projectRoot,
    requests: {
      count: items.length,
      byRole: groupRequestsByRole(items),
      byState: countRequestsByState(items)
    },
    openspec: {
      exists: openspecReport.exists,
      count: openspecReport.changes.length,
      changes: openspecReport.changes
    },
    understand: {
      exists: understandReport.exists,
      graphExists: understandReport.graph.exists,
      graphPath: understandReport.graph.path,
      ...(understandReport.graph.parseError !== undefined ? { parseError: understandReport.graph.parseError } : {})
    },
    mcp: {
      servers: mcpReport.servers,
      scopes: mcpReport.scopes
    },
    doctor: doctorAndRunbook.doctor,
    runbookHealth: doctorAndRunbook.runbookHealth,
    capabilities: buildCapabilitiesSummary(sampleSize),
    skillPresence: buildSkillPresenceSummary(options.skillPresence)
  };
}
