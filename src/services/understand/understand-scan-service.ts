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
