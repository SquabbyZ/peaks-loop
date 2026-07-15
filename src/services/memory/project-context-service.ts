import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listSessionMetas } from '../session/session-manager.js';
import { getSessionDir } from '../session/getSessionDir.js';
import {
  bootstrapProjectScan,
  type BootstrapProjectScanEnvelope
} from '../prd/project-scan-bootstrap-service.js';

export type ProjectContextSection = {
  heading: string;
  body: string;
};

/**
 * Slice 2026-07-15-project-scan-bootstrap (G1 + G2):
 * generateProjectContext now also bootstraps the project-level
 * `.peaks/project-scan/` artifact set. The envelope is returned
 * alongside the context so `peaks project context` can surface
 * `templatesBooted` / `templatesSkipped` / `durationMs` in its JSON.
 */
export type ProjectContextEnvelope = {
  path: string;
  content: string;
  sessionCount: number;
  projectScan: BootstrapProjectScanEnvelope;
};

const PROJECT_CONTEXT_FILE = '.peaks/PROJECT.md';

const CONTEXT_HEADER = `# Peaks Project Context

> Auto-generated project memory. Peaks reads this at the start of each session to understand
> the project's history, tech stack, conventions, and past decisions.
> Last updated: `;

const MANAGED_BLOCK_START = '<!-- peaks-managed:session-history-start -->';
const MANAGED_BLOCK_END = '<!-- peaks-managed:session-history-end -->';

function projectName(projectRoot: string): string {
  const pkgPath = join(projectRoot, 'package.json');
  if (!existsSync(pkgPath)) return projectRoot.split(/[\\/]/).pop() ?? 'unknown';
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    return pkg.name ?? projectRoot.split(/[\\/]/).pop() ?? 'unknown';
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return projectRoot.split(/[\\/]/).pop() ?? 'unknown';
  }
}

function listMdFiles(dir: string, maxDepth = 3): string[] {
  const results: string[] = [];
  if (!existsSync(dir) || maxDepth <= 0) return results;

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listMdFiles(full, maxDepth - 1));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

function extractOneLineSummary(sessionRoot: string): string | null {
  const artifacts = listMdFiles(sessionRoot, 4);
  for (const artifact of artifacts.slice(0, 5)) {
    try {
      const content = readFileSync(artifact, 'utf8');
      // Grab the first non-heading, non-empty line after the front section
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-') || trimmed.startsWith('`')) continue;
        if (trimmed.length > 10 && trimmed.length < 200) return trimmed;
        break;
      }
    } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
      // skip unreadable
    }
  }
  return null;
}

function buildSessionHistory(projectRoot: string): string {
  const metas = listSessionMetas(projectRoot);
  if (metas.length === 0) {
    return `${MANAGED_BLOCK_START}\n\n_No sessions recorded yet._\n\n${MANAGED_BLOCK_END}`;
  }

  const maxSessions = 15;
  // Sort by createdAt descending (most recent first)
  const sorted = [...metas].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const recent = sorted.slice(0, maxSessions);

  let body = `${MANAGED_BLOCK_START}\n\n## Timeline (${metas.length} sessions`;
  if (metas.length > maxSessions) body += `, showing last ${maxSessions}`;
  body += ')\n\n';

  // Human-readable timeline: date | name | brief
  body += `| Date | Directory | Title | What |\n`;
  body += `|------|-----------|-------|------|\n`;
  for (const meta of recent) {
    const date = meta.createdAt ? meta.createdAt.slice(0, 10) : '?';
    const dir = meta.sessionId;
    const title = (meta.title ?? 'Untitled').slice(0, 40);
    const skill = meta.skill ?? '-';

    // Extract one-line summary from artifacts for the "What" column
    const sessionRoot = getSessionDir(projectRoot, meta.sessionId);
    const summary = extractOneLineSummary(sessionRoot);
    const brief = summary ? summary.slice(0, 70) : skill;

    body += `| ${date} | \`${dir}\` | ${title} | ${brief} |\n`;
  }

  body += `\n${MANAGED_BLOCK_END}`;
  return body;
}


export async function generateProjectContext(projectRoot: string): Promise<ProjectContextEnvelope> {
  const peaksDir = join(projectRoot, '.peaks');
  if (!existsSync(peaksDir)) {
    mkdirSync(peaksDir, { recursive: true });
  }

  const contextPath = join(projectRoot, PROJECT_CONTEXT_FILE);
  const name = projectName(projectRoot);
  const now = new Date().toISOString();
  const sessionHistory = buildSessionHistory(projectRoot);

  const header = `${CONTEXT_HEADER}${now}\n\n## Project: ${name}\n`;

  let content: string;
  if (existsSync(contextPath)) {
    const existing = readFileSync(contextPath, 'utf8');
    const startIdx = existing.indexOf(MANAGED_BLOCK_START);
    const endIdx = existing.indexOf(MANAGED_BLOCK_END);

    // Update the Last-updated timestamp in the header
    const updatedExisting = existing.replace(
      /Last updated: .*/,
      `Last updated: ${now}`
    );

    if (startIdx >= 0 && endIdx > startIdx) {
      // Replace managed block, preserve user content outside it
      const before = updatedExisting.slice(0, startIdx);
      const after = updatedExisting.slice(endIdx + MANAGED_BLOCK_END.length);
      content = before + sessionHistory + after;
    } else {
      // No managed block found — append
      content = updatedExisting.trimEnd() + '\n\n' + sessionHistory + '\n';
    }
  } else {
    content = header + '\n' + sessionHistory + '\n';
  }

  writeFileSync(contextPath, content, 'utf8');

  // Slice 2026-07-15-project-scan-bootstrap (G1 + G2):
  // After writing PROJECT.md, also bootstrap `.peaks/project-scan/`
  // (project-scan.md + 4 bundled audit/business templates). Idempotent
  // — re-running this call does not overwrite existing files (unless
  // the caller passes `force` / `forceTemplates`, which we do NOT do
  // here; peaks workspace init owns the force variants).
  const projectScan = await bootstrapProjectScan({ projectRoot });

  return {
    path: contextPath,
    content,
    sessionCount: listSessionMetas(projectRoot).length,
    projectScan
  };
}

export function readProjectContext(projectRoot: string): string | null {
  const contextPath = join(projectRoot, PROJECT_CONTEXT_FILE);
  if (!existsSync(contextPath)) return null;
  try {
    return readFileSync(contextPath, 'utf8');
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}

export function getProjectContextPath(projectRoot: string): string {
  return join(projectRoot, PROJECT_CONTEXT_FILE);
}
