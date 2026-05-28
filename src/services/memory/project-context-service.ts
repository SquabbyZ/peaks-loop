import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { listSessionMetas, type SessionMeta } from '../session/session-manager.js';

export type ProjectContextSection = {
  heading: string;
  body: string;
};

// --- Ontology types ---

export type Module = {
  id: string;
  path: string;
  risk?: 'low' | 'medium' | 'high';
  sessions: string[];
  summary?: string;
};

export type Decision = {
  id: string;
  what: string;
  why?: string;
  scope: string[];
  session: string;
  date: string;
};

export type Convention = {
  id: string;
  rule: string;
  category: 'code-style' | 'architecture' | 'naming' | 'tooling' | 'other';
  source: string;
  date: string;
};

export type Ontology = {
  version: 1;
  updated: string;
  project: string;
  modules: Module[];
  decisions: Decision[];
  conventions: Convention[];
};

const PROJECT_CONTEXT_FILE = '.peaks/PROJECT.md';
const ONTOLOGY_FILE = '.peaks/ontology.json';

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
  } catch {
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

function extractArtifactSummary(filePath: string, sessionRoot: string): string | null {
  try {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    const firstHeading = lines.find((l) => /^#\s/.test(l))?.replace(/^#\s+/, '').trim();
    const stateLine = lines.find((l) => /^\-\s*state:\s*/.test(l))?.trim();
    const relPath = relative(sessionRoot, filePath).split(/[\\/]/).join('/');

    const parts: string[] = [];
    if (firstHeading) parts.push(firstHeading);
    if (stateLine) parts.push(stateLine.replace(/^-\s*state:\s*/, ''));

    if (parts.length === 0) return `- \`${relPath}\``;
    return `- \`${relPath}\` — ${parts.join(' | ')}`;
  } catch {
    return null;
  }
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
    } catch {
      // skip unreadable
    }
  }
  return null;
}

function renderSessionBlock(meta: SessionMeta, projectRoot: string): string {
  const title = meta.title ?? 'Untitled';
  const date = meta.createdAt ? meta.createdAt.slice(0, 10) : '?';
  const skill = meta.skill ?? '-';
  const mode = meta.mode ?? '-';

  let block = `### ${date} — ${title}\n`;
  block += `- ${skill} (${mode})`;

  const sessionRoot = join(projectRoot, '.peaks', meta.sessionId);
  const summary = extractOneLineSummary(sessionRoot);
  if (summary) {
    block += ` — ${summary.slice(0, 120)}`;
  }
  block += '\n';

  // Key artifact paths only
  const artifacts = listMdFiles(sessionRoot, 3);
  if (artifacts.length > 0) {
    const paths = artifacts.slice(0, 8).map((f) => relative(sessionRoot, f).split(/[\\/]/).join('/'));
    block += `  ${paths.join('  ')}\n`;
  }

  return block;
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
    const sessionRoot = join(projectRoot, '.peaks', meta.sessionId);
    const summary = extractOneLineSummary(sessionRoot);
    const brief = summary ? summary.slice(0, 70) : skill;

    body += `| ${date} | \`${dir}\` | ${title} | ${brief} |\n`;
  }

  body += `\n${MANAGED_BLOCK_END}`;
  return body;
}

// --- Ontology engine ---

function emptyOntology(projectName: string): Ontology {
  return {
    version: 1,
    updated: new Date().toISOString(),
    project: projectName,
    modules: [],
    decisions: [],
    conventions: []
  };
}

function ontoPath(projectRoot: string): string {
  return join(projectRoot, ONTOLOGY_FILE);
}

export function loadOntology(projectRoot: string): Ontology | null {
  const path = ontoPath(projectRoot);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (raw?.version === 1 && Array.isArray(raw.modules)) {
      return raw as Ontology;
    }
    return null;
  } catch {
    return null;
  }
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

function scanModulesFromArtifacts(sessionRoot: string, sessionId: string): { id: string; path: string }[] {
  const artifacts = listMdFiles(sessionRoot, 4);
  const modules: { id: string; path: string }[] = [];
  const seen = new Set<string>();

  for (const artifact of artifacts.slice(0, 10)) {
    try {
      const content = readFileSync(artifact, 'utf8');
      // Extract file paths — non-capturing groups for extensions
      const patterns = [
        /\b(src\/[^\s)`\]}"]+\.(?:tsx?|jsx?|css|less|scss|vue|svelte))\b/g,
        /\b(packages\/[^\s)`\]}"]+\.(?:tsx?|jsx?))\b/g
      ];
      for (const pattern of patterns) {
        let m: RegExpExecArray | null;
        while ((m = pattern.exec(content)) !== null) {
          const filePath = m[1] ?? '';
          if (!filePath || filePath.length > 120 || filePath.length < 5) continue;
          const id = slugify(filePath.replace(/\.[^.]+$/, '').replace(/[\/\\]/g, '-'));
          if (seen.has(id)) continue;
          seen.add(id);
          modules.push({ id, path: filePath });
          if (modules.length >= 30) break;
        }
        if (modules.length >= 30) break;
      }
    } catch {
      // skip unreadable
    }
  }
  return modules;
}

function scanDecisionsFromArtifacts(sessionRoot: string, session: SessionMeta): Decision[] {
  const artifacts = listMdFiles(sessionRoot, 4);
  const decisions: Decision[] = [];
  const date = session.createdAt ? session.createdAt.slice(0, 10) : new Date().toISOString().slice(0, 10);

  for (const artifact of artifacts.slice(0, 10)) {
    try {
      const content = readFileSync(artifact, 'utf8');
      // Look for decision markers: "- Decision: ..." or "Decision: ..." or "ADR: ..."
      const decRegex = /^[\s-]*(?:decision|adr|决定|决策)\s*:\s*(.+?)$/gim;
      let m: RegExpExecArray | null;
      while ((m = decRegex.exec(content)) !== null) {
        const what = (m[1] ?? '').trim().slice(0, 200);
        if (what.length < 5) continue;
        const id = slugify(what.slice(0, 40));
        // Collect scope from surrounding context (modules mentioned within 3 lines before/after)
        const scope: string[] = [];
        const lineIdx = content.slice(0, m.index).split('\n').length;
        const lines = content.split('\n');
        for (let i = Math.max(0, lineIdx - 3); i < Math.min(lines.length, lineIdx + 3); i++) {
          const line = lines[i] ?? '';
          const pathMatch = /src\/[^\s)`\]}"]+\.(tsx?|jsx?)/.exec(line);
          if (pathMatch?.[0]) scope.push(pathMatch[0]);
        }
        decisions.push({ id, what, scope: [...new Set(scope)].slice(0, 5), session: session.sessionId, date });
        if (decisions.length >= 10) break;
      }
    } catch {
      // skip unreadable
    }
  }
  return decisions;
}

function scanConventionsFromArtifacts(sessionRoot: string, session: SessionMeta): Convention[] {
  const artifacts = listMdFiles(sessionRoot, 4);
  const conventions: Convention[] = [];
  const date = session.createdAt ? session.createdAt.slice(0, 10) : new Date().toISOString().slice(0, 10);

  for (const artifact of artifacts.slice(0, 10)) {
    try {
      const content = readFileSync(artifact, 'utf8');
      const convRegex = /^[\s-]*(?:convention|约定|规范)\s*:\s*(.+?)$/gim;
      let m: RegExpExecArray | null;
      while ((m = convRegex.exec(content)) !== null) {
        const rule = (m[1] ?? '').trim().slice(0, 200);
        if (rule.length < 5) continue;
        const id = slugify(rule.slice(0, 40));
        // Infer category from keywords
        let category: Convention['category'] = 'other';
        if (/class|function|interface|type|hook|component/i.test(rule)) category = 'code-style';
        else if (/service|layer|package|module|shared|extract/i.test(rule)) category = 'architecture';
        else if (/naming|命名|文件名|prefix|suffix/i.test(rule)) category = 'naming';
        else if (/tooling|lint|format|build|test/i.test(rule)) category = 'tooling';

        conventions.push({ id, rule, category, source: session.sessionId, date });
        if (conventions.length >= 10) break;
      }
    } catch {
      // skip unreadable
    }
  }
  return conventions;
}

function buildOntology(projectRoot: string): Ontology {
  const name = projectName(projectRoot);
  const existing = loadOntology(projectRoot);
  const onto = existing ?? emptyOntology(name);
  onto.updated = new Date().toISOString();
  onto.project = name;

  const metas = listSessionMetas(projectRoot);
  const knownSessions = new Set(metas.map((m) => m.sessionId));

  // Prune: remove modules/decisions/conventions from sessions that no longer exist
  onto.modules = onto.modules.filter((m) => m.sessions.some((s) => knownSessions.has(s)));
  onto.decisions = onto.decisions.filter((d) => knownSessions.has(d.session));
  onto.conventions = onto.conventions.filter((c) => knownSessions.has(c.source));

  // Merge: scan each session for new modules and decisions
  const moduleMap = new Map<string, Module>();
  for (const m of onto.modules) moduleMap.set(m.id, m);

  const decisionMap = new Map<string, Decision>();
  for (const d of onto.decisions) decisionMap.set(d.id, d);

  for (const meta of metas) {
    const sessionRoot = join(projectRoot, '.peaks', meta.sessionId);

    // Modules
    const foundModules = scanModulesFromArtifacts(sessionRoot, meta.sessionId);
    for (const fm of foundModules) {
      if (moduleMap.has(fm.id)) {
        const existing = moduleMap.get(fm.id)!;
        if (!existing.sessions.includes(meta.sessionId)) {
          existing.sessions.push(meta.sessionId);
        }
      } else {
        moduleMap.set(fm.id, {
          id: fm.id,
          path: fm.path,
          sessions: [meta.sessionId]
        });
      }
    }

    // Decisions
    const foundDecisions = scanDecisionsFromArtifacts(sessionRoot, meta);
    for (const fd of foundDecisions) {
      if (!decisionMap.has(fd.id)) {
        decisionMap.set(fd.id, fd);
      }
    }

    // Conventions
    const foundConventions = scanConventionsFromArtifacts(sessionRoot, meta);
    const convMap = new Map<string, Convention>();
    for (const c of onto.conventions) convMap.set(c.id, c);
    for (const fc of foundConventions) {
      if (!convMap.has(fc.id)) {
        convMap.set(fc.id, fc);
      }
    }
    onto.conventions = [...convMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  // Dedup: remove shorter paths that are substring-matches of longer paths
  const modules = [...moduleMap.values()];
  const deduped = modules.filter((m) => {
    return !modules.some((other) => other !== m && other.path.length > m.path.length && other.path.endsWith(m.path));
  });
  onto.modules = deduped.sort((a, b) => b.sessions.length - a.sessions.length);
  onto.decisions = [...decisionMap.values()].sort((a, b) => b.date.localeCompare(a.date));

  return onto;
}

export function saveOntology(projectRoot: string, onto: Ontology): void {
  const peaksDir = join(projectRoot, '.peaks');
  if (!existsSync(peaksDir)) mkdirSync(peaksDir, { recursive: true });
  writeFileSync(ontoPath(projectRoot), JSON.stringify(onto, null, 2), 'utf8');
}

// Mutations for skills to call when they discover new facts
export function upsertModule(projectRoot: string, mod: Omit<Module, 'sessions'> & { session: string }): Ontology {
  const onto = buildOntology(projectRoot);
  const existing = onto.modules.find((m) => m.id === mod.id);
  if (existing) {
    if (!existing.sessions.includes(mod.session)) existing.sessions.push(mod.session);
    if (mod.risk) existing.risk = mod.risk;
    if (mod.summary) existing.summary = mod.summary;
  } else {
    onto.modules.push({ ...mod, sessions: [mod.session] });
  }
  onto.updated = new Date().toISOString();
  saveOntology(projectRoot, onto);
  return onto;
}

export function upsertDecision(projectRoot: string, dec: Decision): Ontology {
  const onto = buildOntology(projectRoot);
  const idx = onto.decisions.findIndex((d) => d.id === dec.id);
  if (idx >= 0) {
    onto.decisions[idx] = dec;
  } else {
    onto.decisions.push(dec);
  }
  onto.updated = new Date().toISOString();
  saveOntology(projectRoot, onto);
  return onto;
}

export function upsertConvention(projectRoot: string, conv: Convention): Ontology {
  const onto = buildOntology(projectRoot);
  const idx = onto.conventions.findIndex((c) => c.id === conv.id);
  if (idx >= 0) {
    onto.conventions[idx] = conv;
  } else {
    onto.conventions.push(conv);
  }
  onto.updated = new Date().toISOString();
  saveOntology(projectRoot, onto);
  return onto;
}

// --- Context generator (unified: PROJECT.md + ontology.json) ---

export function generateProjectContext(projectRoot: string): { path: string; content: string; sessionCount: number; ontology: Ontology } {
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

  // Build and save ontology alongside PROJECT.md
  const ontology = buildOntology(projectRoot);
  saveOntology(projectRoot, ontology);

  return { path: contextPath, content, sessionCount: listSessionMetas(projectRoot).length, ontology };
}

export function readProjectContext(projectRoot: string): string | null {
  const contextPath = join(projectRoot, PROJECT_CONTEXT_FILE);
  if (!existsSync(contextPath)) return null;
  try {
    return readFileSync(contextPath, 'utf8');
  } catch {
    return null;
  }
}

export function getProjectContextPath(projectRoot: string): string {
  return join(projectRoot, PROJECT_CONTEXT_FILE);
}
