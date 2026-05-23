import { listRequestArtifacts, type RequestArtifactRole, type RequestArtifactSummary } from '../artifacts/request-artifact-service.js';
import { scanOpenSpec } from '../openspec/openspec-scan-service.js';
import type { OpenSpecChangeSummary } from '../openspec/openspec-types.js';
import { scanMcpServers } from '../mcp/mcp-scan-service.js';
import type { McpScanReport } from '../mcp/mcp-types.js';
import { scanUnderstandAnything } from '../understand/understand-scan-service.js';
import { seedCapabilityItems } from '../recommendations/capability-seed-items.js';
import type { CapabilityItem } from '../recommendations/recommendation-types.js';

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

export type ProjectDashboardCapabilities = {
  count: number;
  mcpCount: number;
  sample: Array<Pick<CapabilityItem, 'capabilityId' | 'name' | 'itemType' | 'category'>>;
};

export type ProjectDashboard = {
  generatedAt: string;
  projectRoot: string;
  requests: ProjectDashboardRequests;
  openspec: ProjectDashboardOpenSpec;
  understand: ProjectDashboardUnderstand;
  mcp: ProjectDashboardMcp;
  doctor: ProjectDashboardDoctor;
  capabilities: ProjectDashboardCapabilities;
};

export type LoadProjectDashboardOptions = {
  projectRoot: string;
  sampleCapabilities?: number;
  clock?: () => string;
  doctorReport?: { ok: boolean; passed: number; failed: number };
};

function defaultClock(): string {
  return new Date().toISOString();
}

function groupRequestsByRole(items: RequestArtifactSummary[]): Record<RequestArtifactRole, RequestArtifactSummary[]> {
  const byRole: Record<RequestArtifactRole, RequestArtifactSummary[]> = { prd: [], ui: [], rd: [], qa: [] };
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

async function loadDoctorSummary(
  override: { ok: boolean; passed: number; failed: number } | undefined
): Promise<ProjectDashboardDoctor> {
  if (override !== undefined) {
    return override;
  }
  const { runDoctor } = await import('../doctor/doctor-service.js');
  const report = await runDoctor();
  return { ok: report.summary.ok, passed: report.summary.passed, failed: report.summary.failed };
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

export async function loadProjectDashboard(options: LoadProjectDashboardOptions): Promise<ProjectDashboard> {
  const clock = options.clock ?? defaultClock;
  const sampleSize = options.sampleCapabilities ?? 8;

  const [items, openspecReport, mcpReport, understandReport, doctorSummary] = await Promise.all([
    listRequestArtifacts({ projectRoot: options.projectRoot }),
    scanOpenSpec({ openspecRoot: `${options.projectRoot}/openspec` }),
    scanMcpServers({ projectRoot: options.projectRoot }),
    scanUnderstandAnything({ projectRoot: options.projectRoot }),
    loadDoctorSummary(options.doctorReport)
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
    doctor: doctorSummary,
    capabilities: buildCapabilitiesSummary(sampleSize)
  };
}
