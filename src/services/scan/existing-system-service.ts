import { readdir, stat } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { isDirectory, pathExists, readText } from '../../shared/fs.js';
import { scanArchetype } from './archetype-service.js';
import type { ConventionSample, ExistingSystemReport, VisualToken, VisualTokenSource } from './scan-types.js';

export type ExistingSystemScanOptions = {
  projectRoot: string;
  maxTokens?: number;
  maxSamplesPerKind?: number;
};

const DEFAULT_MAX_TOKENS = 40;
const DEFAULT_SAMPLES = 5;

const COLOR_KEYWORDS = ['color', 'primary', 'success', 'warning', 'error', 'danger', 'info', 'bg', 'background', 'border', 'text'];
const SPACING_KEYWORDS = ['spacing', 'gap', 'padding', 'margin', 'size'];
const TYPO_KEYWORDS = ['font', 'text-size', 'line-height', 'letter-spacing', 'heading'];
const RADIUS_KEYWORDS = ['radius', 'rounded'];

const STYLE_DIRS = ['src/styles', 'src/style', 'styles', 'src/assets/styles', 'src/theme', 'theme'];
const COMPONENT_DIRS = ['src/components', 'src/Components', 'components'];
const SERVICE_DIRS = ['src/services', 'src/service', 'src/api', 'src/apis'];
const HOOK_DIRS = ['src/hooks', 'src/hook', 'src/composables'];

type FileSample = { path: string; mtimeMs: number };

function classifyToken(name: string): 'color' | 'spacing' | 'typography' | 'radius' | null {
  const lower = name.toLowerCase();
  if (RADIUS_KEYWORDS.some((kw) => lower.includes(kw))) return 'radius';
  if (TYPO_KEYWORDS.some((kw) => lower.includes(kw))) return 'typography';
  if (SPACING_KEYWORDS.some((kw) => lower.includes(kw))) return 'spacing';
  if (COLOR_KEYWORDS.some((kw) => lower.includes(kw))) return 'color';
  return null;
}

function parseLessOrSassVars(content: string, sourceRel: string): VisualToken[] {
  const tokens: VisualToken[] = [];
  // Match `@var: value;` (Less) or `$var: value;` (Sass)
  const regex = /^\s*[@$]([a-zA-Z][\w-]*)\s*:\s*([^;]+);/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const [, rawName, rawValue] = match;
    if (rawName === undefined || rawValue === undefined) continue;
    tokens.push({ name: rawName, value: rawValue.trim(), source: sourceRel });
  }
  return tokens;
}

function parseCssVars(content: string, sourceRel: string): VisualToken[] {
  const tokens: VisualToken[] = [];
  const regex = /--([a-zA-Z][\w-]*)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const [, rawName, rawValue] = match;
    if (rawName === undefined || rawValue === undefined) continue;
    tokens.push({ name: `--${rawName}`, value: rawValue.trim(), source: sourceRel });
  }
  return tokens;
}

async function walkStyleFiles(projectRoot: string): Promise<string[]> {
  const found: string[] = [];
  for (const candidate of STYLE_DIRS) {
    const full = join(projectRoot, candidate);
    if (!(await isDirectory(full))) continue;
    const queue: string[] = [full];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      let entries;
      try {
        entries = await readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const entryPath = join(current, entry.name);
        if (entry.isDirectory()) {
          queue.push(entryPath);
        } else if (/\.(less|scss|sass|css)$/i.test(entry.name)) {
          found.push(entryPath);
        }
      }
    }
  }
  return found;
}

async function extractTailwindTokens(projectRoot: string): Promise<{ tokens: VisualToken[]; source: VisualTokenSource | null }> {
  const candidates = ['tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.cjs', 'tailwind.config.mjs'];
  for (const candidate of candidates) {
    const full = join(projectRoot, candidate);
    if (await pathExists(full)) {
      const content = await readText(full);
      const tokens: VisualToken[] = [];
      // Heuristic: extract keys under theme.extend.* via simple regex.
      const colorBlock = /colors\s*:\s*\{([\s\S]*?)\}/.exec(content);
      if (colorBlock?.[1] !== undefined) {
        const colorRegex = /([a-zA-Z_][\w-]*)\s*:\s*['"`]([^'"`]+)['"`]/g;
        let match: RegExpExecArray | null;
        while ((match = colorRegex.exec(colorBlock[1])) !== null) {
          const [, name, value] = match;
          if (name !== undefined && value !== undefined) {
            tokens.push({ name, value, source: candidate });
          }
        }
      }
      return { tokens, source: { path: candidate, kind: 'tailwind-config' } };
    }
  }
  return { tokens: [], source: null };
}

async function listFilesByMtime(dir: string, exts: RegExp, max: number): Promise<FileSample[]> {
  if (!(await isDirectory(dir))) return [];
  const collected: FileSample[] = [];
  const queue: string[] = [dir];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(full);
      } else if (exts.test(entry.name)) {
        try {
          const stats = await stat(full);
          collected.push({ path: full, mtimeMs: stats.mtimeMs });
        } catch {
          // skip unreadable
        }
      }
    }
  }
  collected.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return collected.slice(0, max);
}

function classifyComponentNaming(samples: FileSample[]): 'PascalCase' | 'kebab-case' | 'mixed' | 'unknown' {
  if (samples.length === 0) return 'unknown';
  let pascal = 0;
  let kebab = 0;
  for (const sample of samples) {
    const name = basename(sample.path).replace(/\.[^.]+$/, '');
    if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) pascal += 1;
    else if (/^[a-z][a-z0-9-]*$/.test(name)) kebab += 1;
  }
  if (pascal > 0 && kebab === 0) return 'PascalCase';
  if (kebab > 0 && pascal === 0) return 'kebab-case';
  if (pascal > 0 || kebab > 0) return 'mixed';
  return 'unknown';
}

async function firstExistingDir(projectRoot: string, candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    if (await isDirectory(join(projectRoot, candidate))) {
      return candidate;
    }
  }
  return null;
}

function dedupeTokens(tokens: VisualToken[], max: number): VisualToken[] {
  const seen = new Set<string>();
  const out: VisualToken[] = [];
  for (const token of tokens) {
    const key = `${token.name}=${token.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
    if (out.length >= max) break;
  }
  return out;
}

function findInconsistencies(tokens: VisualToken[]): string[] {
  const issues: string[] = [];
  const byName = new Map<string, Set<string>>();
  for (const token of tokens) {
    const set = byName.get(token.name) ?? new Set<string>();
    set.add(token.value);
    byName.set(token.name, set);
  }
  for (const [name, values] of byName.entries()) {
    if (values.size > 1) {
      issues.push(`token "${name}" has ${values.size} different values across sources: ${[...values].join(' | ')}`);
    }
  }
  return issues;
}

export async function scanExistingSystem(options: ExistingSystemScanOptions): Promise<ExistingSystemReport> {
  const { projectRoot } = options;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const maxSamples = options.maxSamplesPerKind ?? DEFAULT_SAMPLES;

  const archetypeReport = await scanArchetype({ projectRoot });
  if (archetypeReport.archetype === 'greenfield' || archetypeReport.archetype === 'unknown') {
    return {
      archetype: archetypeReport.archetype,
      scanned: false,
      scanSkippedReason: `archetype=${archetypeReport.archetype} — extraction only runs on legacy projects`,
      visualTokens: { colors: [], spacing: [], typography: [], radii: [], sources: [] },
      conventions: { componentNaming: 'unknown', componentDir: null, serviceDir: null, hookDir: null, samples: [] },
      inconsistencies: []
    };
  }

  const sources: VisualTokenSource[] = [];
  const rawTokens: VisualToken[] = [];

  const styleFiles = await walkStyleFiles(projectRoot);
  for (const file of styleFiles) {
    const content = await readText(file);
    const rel = relative(projectRoot, file).split(/[\\/]/).join('/');
    if (/\.less$/i.test(file)) {
      const lessTokens = parseLessOrSassVars(content, rel);
      if (lessTokens.length > 0) {
        sources.push({ path: rel, kind: 'less-vars' });
        rawTokens.push(...lessTokens);
      }
    } else if (/\.s[ac]ss$/i.test(file)) {
      const sassTokens = parseLessOrSassVars(content, rel);
      if (sassTokens.length > 0) {
        sources.push({ path: rel, kind: 'sass-vars' });
        rawTokens.push(...sassTokens);
      }
    }
    const cssVars = parseCssVars(content, rel);
    if (cssVars.length > 0) {
      sources.push({ path: rel, kind: 'css-vars' });
      rawTokens.push(...cssVars);
    }
  }

  const tailwind = await extractTailwindTokens(projectRoot);
  if (tailwind.source !== null) {
    sources.push(tailwind.source);
    rawTokens.push(...tailwind.tokens);
  }

  const colors: VisualToken[] = [];
  const spacing: VisualToken[] = [];
  const typography: VisualToken[] = [];
  const radii: VisualToken[] = [];
  for (const token of rawTokens) {
    const category = classifyToken(token.name);
    if (category === 'color') colors.push(token);
    else if (category === 'spacing') spacing.push(token);
    else if (category === 'typography') typography.push(token);
    else if (category === 'radius') radii.push(token);
  }

  const componentDir = await firstExistingDir(projectRoot, COMPONENT_DIRS);
  const serviceDir = await firstExistingDir(projectRoot, SERVICE_DIRS);
  const hookDir = await firstExistingDir(projectRoot, HOOK_DIRS);

  const componentSamples = componentDir !== null
    ? await listFilesByMtime(join(projectRoot, componentDir), /\.(tsx|jsx|vue|svelte)$/i, maxSamples)
    : [];
  const serviceSamples = serviceDir !== null
    ? await listFilesByMtime(join(projectRoot, serviceDir), /\.(ts|js)$/i, maxSamples)
    : [];
  const hookSamples = hookDir !== null
    ? await listFilesByMtime(join(projectRoot, hookDir), /\.(ts|js)$/i, maxSamples)
    : [];

  const samples: ConventionSample[] = [
    ...componentSamples.map<ConventionSample>((sample) => ({ path: relative(projectRoot, sample.path).split(/[\\/]/).join('/'), kind: 'component' })),
    ...serviceSamples.map<ConventionSample>((sample) => ({ path: relative(projectRoot, sample.path).split(/[\\/]/).join('/'), kind: 'service' })),
    ...hookSamples.map<ConventionSample>((sample) => ({ path: relative(projectRoot, sample.path).split(/[\\/]/).join('/'), kind: 'hook' }))
  ];

  return {
    archetype: archetypeReport.archetype,
    scanned: true,
    visualTokens: {
      colors: dedupeTokens(colors, maxTokens),
      spacing: dedupeTokens(spacing, maxTokens),
      typography: dedupeTokens(typography, maxTokens),
      radii: dedupeTokens(radii, maxTokens),
      sources
    },
    conventions: {
      componentNaming: classifyComponentNaming(componentSamples),
      componentDir,
      serviceDir,
      hookDir,
      samples
    },
    inconsistencies: findInconsistencies(rawTokens)
  };
}
