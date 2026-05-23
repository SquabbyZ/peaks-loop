import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isDirectory, pathExists, readText } from '../../shared/fs.js';
import { getErrorMessage } from '../../shared/result.js';
import type {
  UnderstandFlagReport,
  UnderstandGraphReport,
  UnderstandScanReport
} from './understand-types.js';

export type UnderstandScanOptions = {
  projectRoot: string;
  artifactDir?: string;
};

function defaultArtifactDir(projectRoot: string): string {
  return join(projectRoot, '.understand-anything');
}

function countArrayField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return Array.isArray(value) ? value.length : 0;
}

async function readFlag(path: string): Promise<UnderstandFlagReport> {
  return { exists: await pathExists(path), path };
}

async function readGraph(graphPath: string): Promise<UnderstandGraphReport> {
  if (!(await pathExists(graphPath))) {
    return { exists: false, path: graphPath };
  }
  const stats = await stat(graphPath);
  const raw = await readText(graphPath);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        exists: true,
        path: graphPath,
        sizeBytes: stats.size,
        parseError: 'knowledge-graph.json must be a JSON object'
      };
    }
    const record = parsed as Record<string, unknown>;
    return {
      exists: true,
      path: graphPath,
      sizeBytes: stats.size,
      topLevelFields: Object.keys(record).sort(),
      counts: {
        nodes: countArrayField(record, 'nodes'),
        edges: countArrayField(record, 'edges'),
        layers: countArrayField(record, 'layers'),
        tours: countArrayField(record, 'tours')
      }
    };
  } catch (error) {
    return {
      exists: true,
      path: graphPath,
      sizeBytes: stats.size,
      parseError: getErrorMessage(error)
    };
  }
}

export async function scanUnderstandAnything(options: UnderstandScanOptions): Promise<UnderstandScanReport> {
  const artifactDir = options.artifactDir ?? defaultArtifactDir(options.projectRoot);
  const exists = await isDirectory(artifactDir);
  if (!exists) {
    return {
      exists: false,
      artifactDir,
      graph: { exists: false, path: join(artifactDir, 'knowledge-graph.json') },
      intermediate: { exists: false, path: join(artifactDir, 'intermediate') },
      diffOverlay: { exists: false, path: join(artifactDir, 'diff-overlay.json') }
    };
  }

  const graph = await readGraph(join(artifactDir, 'knowledge-graph.json'));
  const intermediate = await readFlag(join(artifactDir, 'intermediate'));
  const diffOverlay = await readFlag(join(artifactDir, 'diff-overlay.json'));

  return { exists: true, artifactDir, graph, intermediate, diffOverlay };
}

export type UnderstandGraphSummary = {
  exists: boolean;
  path: string;
  generatedAt: string | null;
  topLevelFields: string[];
  counts: {
    nodes: number;
    edges: number;
    layers: number;
    tours: number;
  };
  layerNames: string[];
  tourNames: string[];
  sampleNodes: string[];
  parseError?: string;
};

export type SummarizeKnowledgeGraphOptions = {
  projectRoot: string;
  artifactDir?: string;
  sampleSize?: number;
};

function pickStringId(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const key of ['id', 'path', 'name', 'label']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate;
    }
  }
  return null;
}

function pickStringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function pickNameArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry;
      }
      return pickStringId(entry);
    })
    .filter((entry): entry is string => entry !== null);
}

export async function summarizeKnowledgeGraph(options: SummarizeKnowledgeGraphOptions): Promise<UnderstandGraphSummary> {
  const scanOptions: UnderstandScanOptions = { projectRoot: options.projectRoot };
  if (options.artifactDir !== undefined) {
    scanOptions.artifactDir = options.artifactDir;
  }
  const scan = await scanUnderstandAnything(scanOptions);
  const sampleSize = options.sampleSize ?? 5;

  if (!scan.graph.exists) {
    return {
      exists: false,
      path: scan.graph.path,
      generatedAt: null,
      topLevelFields: [],
      counts: { nodes: 0, edges: 0, layers: 0, tours: 0 },
      layerNames: [],
      tourNames: [],
      sampleNodes: []
    };
  }

  if (scan.graph.parseError !== undefined) {
    return {
      exists: true,
      path: scan.graph.path,
      generatedAt: null,
      topLevelFields: [],
      counts: { nodes: 0, edges: 0, layers: 0, tours: 0 },
      layerNames: [],
      tourNames: [],
      sampleNodes: [],
      parseError: scan.graph.parseError
    };
  }

  const raw = await readText(scan.graph.path);
  const parsed: unknown = JSON.parse(raw);
  const record = parsed as Record<string, unknown>;
  const generatedAt = pickStringField(record, 'generatedAt');
  const nodes = Array.isArray(record.nodes) ? record.nodes : [];
  const sampleNodes = nodes.slice(0, sampleSize)
    .map((entry) => pickStringId(entry))
    .filter((entry): entry is string => entry !== null);

  return {
    exists: true,
    path: scan.graph.path,
    generatedAt,
    topLevelFields: Object.keys(record).sort(),
    counts: {
      nodes: countArrayField(record, 'nodes'),
      edges: countArrayField(record, 'edges'),
      layers: countArrayField(record, 'layers'),
      tours: countArrayField(record, 'tours')
    },
    layerNames: pickNameArray(record, 'layers'),
    tourNames: pickNameArray(record, 'tours'),
    sampleNodes
  };
}
