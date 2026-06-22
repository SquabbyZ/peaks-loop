/**
 * Orphan scan service (Slice 4/6 — karpathy-enforcement).
 *
 * Detects 4 kinds of orphans that RD/QA should clean up before merge:
 *  - exportOrphan:     declared export with no in-repo importer
 *  - importOrphan:     import whose source no longer exports the symbol
 *                     (working-tree vs HEAD diff focus)
 *  - cliSubcommandOrphan: `.command('x')` registered but never wired
 *                     into the group registration call
 *  - docEndpointOrphan: tech-doc declares an endpoint / subcommand
 *                     that the codebase does not implement
 *
 * Pattern follows `api-surface-service.ts` (readFile + readdir; pure
 * data shape; no AST parsing). karpathy §2: minimum code, no abstractions.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

export type OrphanScope = 'working-tree' | 'git-diff' | 'all';

export type OrphanScanOptions = {
  projectRoot: string;
  /** Limit the walk to changed files only (default: working-tree). */
  scope?: OrphanScope;
  /** Strict mode: report exportOrphans even outside the working tree. */
  strict?: boolean;
  /**
   * Slice 2.6.1.A.4: git ref to diff against (default: HEAD).
   * When supplied, `git diff --name-status <baseRef>` is used instead of
   * the implicit `git diff --name-status HEAD`. Useful for branch-vs-main
   * scans and for cross-branch orphan detection.
   */
  baseRef?: string;
};

export type ExportOrphan = {
  name: string;
  kind: 'function' | 'class' | 'const' | 'interface' | 'type' | 'enum';
  sourceFile: string;
  line: number;
};

export type ImportOrphan = {
  importedFrom: string;
  symbol: string;
  importer: string;
  line: number;
};

export type CliSubcommandOrphan = {
  name: string;
  sourceFile: string;
  reason: string;
};

export type DocEndpointOrphan = {
  endpoint: string;
  declaredIn: string;
};

export type OrphanReport = {
  projectRoot: string;
  scannedAt: string;
  scope: OrphanScope;
  strict: boolean;
  counts: { export: number; import: number; cliSubcommand: number; docEndpoint: number };
  exportOrphans: ExportOrphan[];
  importOrphans: ImportOrphan[];
  cliSubcommandOrphans: CliSubcommandOrphan[];
  docEndpointOrphans: DocEndpointOrphan[];
  warnings: string[];
};

const DEFAULT_DIRS = ['src/cli', 'src/services', 'skills', 'tests'] as const;
// Slice 2.6.1.A.1: top-level commands registered via `register*Commands(program)`
// are wired through the program constructor, not through string references.
// Skip orphan detection for them so sub-commands of these parents aren't
// confused for top-level orphans.
const PARENT_COMMANDS = new Set([
  'scan', 'request', 'session', 'sub-agent', 'openspec', 'sop', 'workspace',
  'qa', 'sc', 'txt', 'code-review', 'rd', 'sh', 'config', 'audit', 'codegraph',
  'context', 'agent', 'capability', 'classify', 'companion', 'gstack', 'gate',
  'hook', 'hooks', 'log', 'loop', 'memory', 'perf', 'playwright', 'preferences',
  'project', 'retrospective', 'slice', 'statusline', 'understand', 'workflow',
  'migrate', 'mcp', 'doctor', 'help'
]);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);

const EXPORT_FUNCTION_RE = /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_CLASS_RE = /^export\s+class\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_CONST_RE = /^export\s+const\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_INTERFACE_RE = /^export\s+interface\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_TYPE_RE = /^export\s+type\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_ENUM_RE = /^export\s+enum\s+([A-Za-z_$][\w$]*)/gm;
// Slice 2.6.1.A.2: default-export detection (anonymous forms skipped — no name to track).
const EXPORT_DEFAULT_FUNCTION_RE = /^export\s+default\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_DEFAULT_CLASS_RE = /^export\s+default\s+class\s+([A-Za-z_$][\w$]*)/gm;

const COMMAND_RE = /\.command\(\s*['"]([a-z][a-z0-9-]*)['"]/g;
const COMMAND_NAME_USE_RE = /['"]([a-z][a-z0-9-]*)['"]/g;
// Slice 2.6.1.A.3: re-export detection (`export { a, b } from './c'`).
const RE_EXPORT_NAMED_RE = /export\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
const RE_EXPORT_TYPE_RE = /export\s+type\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;

const NAMED_IMPORT_RE = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT_RE = /import\s+['"]([^'"]+)['"]/g;

const TECH_DOC_API_SECTION_RE = /##\s*Existing API\s*\/\s*Component Inventory([\s\S]*?)(?=\n##\s|\Z)/g;

async function walkProject(
  projectRoot: string,
  includeDirs: string[]
): Promise<string[]> {
  const files: string[] = [];
  for (const rel of includeDirs) {
    const abs = join(projectRoot, rel);
    if (!(await isDir(abs))) continue;
    await walkDir(abs, projectRoot, files);
  }
  return files;
}

async function walkDir(dir: string, projectRoot: string, out: string[]): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(full, projectRoot, out);
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      // Normalize to POSIX separators: downstream filters (e.g.
      // `f.startsWith('src/cli/commands/')`) expect forward slashes
      // regardless of host OS. Without this, Windows hosts see empty
      // orphan reports because `path.relative` returns `\`-separated paths.
      out.push(relative(projectRoot, full).split(sep).join('/'));
    }
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

function lineOf(content: string, matchIndex: number): number {
  return content.slice(0, matchIndex).split('\n').length;
}

function uniqueByName<T extends { name: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.name)) continue;
    seen.add(item.name);
    out.push(item);
  }
  return out;
}

function dedupeImportOrphans(items: ImportOrphan[]): ImportOrphan[] {
  const seen = new Set<string>();
  const out: ImportOrphan[] = [];
  for (const item of items) {
    const key = `${item.importer}::${item.symbol}::${item.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function dedupeDocEndpointOrphans(items: DocEndpointOrphan[]): DocEndpointOrphan[] {
  const seen = new Set<string>();
  const out: DocEndpointOrphan[] = [];
  for (const item of items) {
    if (seen.has(item.endpoint)) continue;
    seen.add(item.endpoint);
    out.push(item);
  }
  return out;
}

type ExportedSymbol = { name: string; kind: ExportOrphan['kind']; sourceFile: string; line: number };

function scanExportsInFile(content: string, sourceFile: string): ExportedSymbol[] {
  const out: ExportedSymbol[] = [];
  for (const re of [EXPORT_FUNCTION_RE, EXPORT_CLASS_RE, EXPORT_CONST_RE,
                    EXPORT_INTERFACE_RE, EXPORT_TYPE_RE, EXPORT_ENUM_RE,
                    EXPORT_DEFAULT_FUNCTION_RE, EXPORT_DEFAULT_CLASS_RE]) {
    re.lastIndex = 0;
  }
  let m: RegExpExecArray | null;
  while ((m = EXPORT_FUNCTION_RE.exec(content)) !== null) {
    out.push({ name: m[1] as string, kind: 'function', sourceFile, line: lineOf(content, m.index) });
  }
  while ((m = EXPORT_CLASS_RE.exec(content)) !== null) {
    out.push({ name: m[1] as string, kind: 'class', sourceFile, line: lineOf(content, m.index) });
  }
  while ((m = EXPORT_INTERFACE_RE.exec(content)) !== null) {
    out.push({ name: m[1] as string, kind: 'interface', sourceFile, line: lineOf(content, m.index) });
  }
  while ((m = EXPORT_TYPE_RE.exec(content)) !== null) {
    out.push({ name: m[1] as string, kind: 'type', sourceFile, line: lineOf(content, m.index) });
  }
  while ((m = EXPORT_ENUM_RE.exec(content)) !== null) {
    out.push({ name: m[1] as string, kind: 'enum', sourceFile, line: lineOf(content, m.index) });
  }
  while ((m = EXPORT_CONST_RE.exec(content)) !== null) {
    out.push({ name: m[1] as string, kind: 'const', sourceFile, line: lineOf(content, m.index) });
  }
  // Slice 2.6.1.A.2: track named default exports.
  while ((m = EXPORT_DEFAULT_FUNCTION_RE.exec(content)) !== null) {
    out.push({ name: m[1] as string, kind: 'function', sourceFile, line: lineOf(content, m.index) });
  }
  while ((m = EXPORT_DEFAULT_CLASS_RE.exec(content)) !== null) {
    out.push({ name: m[1] as string, kind: 'class', sourceFile, line: lineOf(content, m.index) });
  }
  return out;
}

function buildExportIndex(files: string[], fileContents: Map<string, string>): ExportedSymbol[] {
  const all: ExportedSymbol[] = [];
  for (const rel of files) {
    const content = fileContents.get(rel);
    if (content === undefined) continue;
    for (const s of scanExportsInFile(content, rel)) {
      all.push(s);
    }
  }
  return all;
}

function scanNamedImportsInFile(content: string): Array<{ symbols: string[]; from: string; line: number }> {
  const out: Array<{ symbols: string[]; from: string; line: number }> = [];
  NAMED_IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NAMED_IMPORT_RE.exec(content)) !== null) {
    const raw = m[1] as string;
    const from = m[2] as string;
    const symbols = raw
      .split(',')
      .map((s) => s.trim().split(/\s+as\s+/)[0]?.trim() ?? '')
      .filter((s) => s.length > 0);
    out.push({ symbols, from, line: lineOf(content, m.index) });
  }
  return out;
}

function resolveImportPath(importer: string, fromSpec: string, projectRoot: string): string | null {
  if (!fromSpec.startsWith('.')) return null;
  const importerAbs = join(projectRoot, importer);
  const dirAbs = join(importerAbs, '..');
  // Normalize: ESM .ts projects import with .js extension; try .ts first.
  const specNoExt = fromSpec.replace(/\.(js|ts)$/, '');
  const baseCandidates = [specNoExt, `${specNoExt}/index`];
  const candidates: string[] = [];
  for (const base of baseCandidates) {
    candidates.push(join(dirAbs, `${base}.ts`));
    candidates.push(join(dirAbs, base));
  }
  for (const c of candidates) {
    const rel = relative(projectRoot, c);
    if (rel.startsWith('..')) continue;
    return rel;
  }
  return null;
}

function extractTechDocEndpoints(content: string): string[] {
  const out: string[] = [];
  const sectionRe = new RegExp(TECH_DOC_API_SECTION_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = sectionRe.exec(content)) !== null) {
    const block = m[1] as string;
    const peakCallRe = /peaks\s+([a-z][a-z0-9-]+(?:\s+[a-z][a-z0-9-]+)*)/g;
    let pm: RegExpExecArray | null;
    while ((pm = peakCallRe.exec(block)) !== null) {
      const full = pm[1] as string;
      out.push(`peaks ${full}`);
    }
  }
  return Array.from(new Set(out));
}

function diffVsHead(projectRoot: string, baseRef?: string): { added: string[]; removed: string[]; modified: string[] } {
  // Slice 2.6.1.A.4: when a base ref is supplied, diff against that ref instead of HEAD.
  // Default behaviour (no baseRef) preserves backward compatibility.
  const args = baseRef
    ? ['diff', '--name-status', baseRef]
    : ['diff', '--name-status', 'HEAD'];
  const res = spawnSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 5000
  });
  if (res.status !== 0 || !res.stdout) {
    return { added: [], removed: [], modified: [] };
  }
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  for (const line of res.stdout.split('\n')) {
    if (!line) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const status = line.slice(0, tab);
    const path = line.slice(tab + 1).split('\t')[0]?.split(' ')[0] ?? '';
    if (!path) continue;
    if (status.startsWith('A')) added.push(path);
    else if (status.startsWith('D')) removed.push(path);
    else if (status.startsWith('M') || status.startsWith('R') || status.startsWith('C')) modified.push(path);
  }
  return { added, removed, modified };
}

/**
 * Slice 2.6.1.A.3: scan a file for re-export statements of the form
 *   export { a, b, c } from './source';
 *   export type { T } from './source';
 * The returned entries tell the orphan scanner that `a`, `b`, `c` are
 * consumed (re-exported) and therefore should not be flagged as orphans
 * when the source file is the only declared source of those symbols.
 */
function scanReExportsInFile(
  content: string,
  sourceFile: string,
  projectRoot: string
): Array<{ symbol: string; from: string; line: number; resolvedFrom: string | null }> {
  const out: Array<{ symbol: string; from: string; line: number; resolvedFrom: string | null }> = [];
  for (const re of [RE_EXPORT_NAMED_RE, RE_EXPORT_TYPE_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const raw = m[1] as string;
      const from = m[2] as string;
      const resolved = from.startsWith('.') ? resolveImportPath(sourceFile, from, projectRoot) : null;
      const symbols = raw
        .split(',')
        .map((s) => s.trim().split(/\s+as\s+/)[0]?.trim() ?? '')
        .filter((s) => s.length > 0);
      for (const sym of symbols) {
        out.push({ symbol: sym, from, line: lineOf(content, m!.index), resolvedFrom: resolved });
      }
    }
  }
  return out;
}

/**
 * Scan the project for orphan symbols. Read-only. Never throws;
 * failures surface as warnings in the report.
 */
export async function scanOrphans(options: OrphanScanOptions): Promise<OrphanReport> {
  const scope = options.scope ?? 'working-tree';
  const strict = options.strict ?? false;
  const warnings: string[] = [];

  const files = await walkProject(options.projectRoot, [...DEFAULT_DIRS]);

  const fileContents = new Map<string, string>();
  for (const rel of files) {
    const full = join(options.projectRoot, rel);
    try {
      fileContents.set(rel, await readFile(full, 'utf8'));
    } catch (error) {
      warnings.push(`unreadable: ${rel}: ${(error as Error).message}`);
    }
  }

  const diff = scope === 'all' ? { added: files, removed: [], modified: files } : diffVsHead(options.projectRoot, options.baseRef);
  const changedSet = new Set<string>([...diff.added, ...diff.modified]);

  const allExports = buildExportIndex(files, fileContents);
  const exportBySource = new Map<string, ExportedSymbol[]>();
  for (const e of allExports) {
    const list = exportBySource.get(e.sourceFile) ?? [];
    list.push(e);
    exportBySource.set(e.sourceFile, list);
  }

  // Scan imports
  const importOrphans: ImportOrphan[] = [];
  for (const rel of files) {
    if (scope !== 'all' && !changedSet.has(rel)) continue;
    const content = fileContents.get(rel);
    if (!content) continue;
    const imports = scanNamedImportsInFile(content);
    for (const imp of imports) {
      const resolved = resolveImportPath(rel, imp.from, options.projectRoot);
      if (!resolved) continue;
      const exports = exportBySource.get(resolved) ?? [];
      const exportedNames = new Set(exports.map((e) => e.name));
      for (const sym of imp.symbols) {
        if (!exportedNames.has(sym)) {
          importOrphans.push({
            importedFrom: imp.from,
            symbol: sym,
            importer: rel,
            line: imp.line
          });
        }
      }
    }
  }

  // Build usage map: how many times is each export name referenced by an
  // import statement across the codebase?
  const importedNameCount = new Map<string, number>();
  for (const rel of files) {
    const content = fileContents.get(rel);
    if (!content) continue;
    const imports = scanNamedImportsInFile(content);
    for (const imp of imports) {
      for (const sym of imp.symbols) {
        importedNameCount.set(sym, (importedNameCount.get(sym) ?? 0) + 1);
      }
    }
    // Slice 2.6.1.A.3: re-exports count as a consumer reference.
    const reExports = scanReExportsInFile(content, rel, options.projectRoot);
    for (const re of reExports) {
      importedNameCount.set(re.symbol, (importedNameCount.get(re.symbol) ?? 0) + 1);
    }
    SIDE_EFFECT_IMPORT_RE.lastIndex = 0;
    let sm: RegExpExecArray | null;
    while ((sm = SIDE_EFFECT_IMPORT_RE.exec(content)) !== null) {
      const spec = sm[1] as string;
      if (!spec.startsWith('.')) continue;
      const resolved = resolveImportPath(rel, spec, options.projectRoot);
      if (!resolved) continue;
      const exps = exportBySource.get(resolved) ?? [];
      for (const e of exps) {
        importedNameCount.set(e.name, (importedNameCount.get(e.name) ?? 0) + 1);
      }
    }
  }

  // exportOrphan: declared exports with no consumer
  const exportOrphans: ExportOrphan[] = [];
  for (const e of allExports) {
    if (scope !== 'all' && !strict && !changedSet.has(e.sourceFile)) continue;
    const count = importedNameCount.get(e.name) ?? 0;
    if (count === 0) {
      exportOrphans.push({
        name: e.name,
        kind: e.kind,
        sourceFile: e.sourceFile,
        line: e.line
      });
    }
  }

  // cliSubcommandOrphan: every `.command('x')` referenced exactly once
  const cliFiles = files.filter((f) => f.startsWith('src/cli/commands/') && !f.endsWith('index.ts'));
  const declaredCommands = new Map<string, { sourceFile: string }>();
  for (const rel of cliFiles) {
    const content = fileContents.get(rel);
    if (!content) continue;
    COMMAND_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = COMMAND_RE.exec(content)) !== null) {
      const name = m[1] as string;
      // Slice 2.6.1.A.1: skip top-level commands — they're wired through
      // `register*Commands(program)`, not through string references.
      if (PARENT_COMMANDS.has(name)) continue;
      declaredCommands.set(name, { sourceFile: rel });
    }
  }
  const usageCount = new Map<string, number>();
  for (const [name, meta] of declaredCommands) {
    // Slice 2.6.1.A.1: exclude the declaration file itself. A subcommand
    // is "wired" iff its name appears as a string literal in any other
    // file (typically a wiring site or a tech-doc reference).
    let count = 0;
    for (const [rel, content] of fileContents) {
      if (rel === meta.sourceFile) continue;
      const useRe = new RegExp(`['"]${name}['"]`, 'g');
      const matches = content.match(useRe);
      if (matches) count += matches.length;
    }
    usageCount.set(name, count);
  }
  const cliSubcommandOrphans: CliSubcommandOrphan[] = [];
  for (const [name, meta] of declaredCommands) {
    if ((usageCount.get(name) ?? 0) === 0) {
      cliSubcommandOrphans.push({
        name,
        sourceFile: meta.sourceFile,
        reason: `declared in ${meta.sourceFile} but not referenced in any other file`
      });
    }
  }

  // docEndpointOrphan: tech-doc declares `peaks <sub>` but src/ lacks
  const techDocFiles = files.filter((f) => f.startsWith('skills/') && f.endsWith('.md'));
  const declaredEndpoints = new Set<string>();
  for (const rel of techDocFiles) {
    const content = fileContents.get(rel);
    if (!content) continue;
    for (const ep of extractTechDocEndpoints(content)) {
      declaredEndpoints.add(ep);
    }
  }
  const docEndpointOrphans: DocEndpointOrphan[] = [];
  for (const ep of declaredEndpoints) {
    if (ep.startsWith('peaks ')) {
      const parts = ep.split(/\s+/);
      const sub = parts[1] ?? '';
      if (sub && !declaredCommands.has(sub) && !PARENT_COMMANDS.has(sub)) {
        if (scope === 'all' || strict) {
          docEndpointOrphans.push({ endpoint: ep, declaredIn: 'tech-doc' });
        }
      }
    }
  }

  return {
    projectRoot: options.projectRoot,
    scannedAt: new Date().toISOString(),
    scope,
    strict,
    counts: {
      export: uniqueByName(exportOrphans).length,
      import: dedupeImportOrphans(importOrphans).length,
      cliSubcommand: uniqueByName(cliSubcommandOrphans).length,
      docEndpoint: dedupeDocEndpointOrphans(docEndpointOrphans).length
    },
    exportOrphans: uniqueByName(exportOrphans).sort((a, b) => a.name.localeCompare(b.name)),
    importOrphans: dedupeImportOrphans(importOrphans).sort((a, b) => a.importer.localeCompare(b.importer) || a.line - b.line),
    cliSubcommandOrphans: uniqueByName(cliSubcommandOrphans).sort((a, b) => a.name.localeCompare(b.name)),
    docEndpointOrphans: dedupeDocEndpointOrphans(docEndpointOrphans).sort((a, b) => a.endpoint.localeCompare(b.endpoint)),
    warnings
  };
}

export function formatOrphanMarkdown(
  report: OrphanReport,
  opts: { maxPerKind?: number } = {}
): string {
  const max = opts.maxPerKind ?? Number.POSITIVE_INFINITY;
  const lines: string[] = [];
  lines.push('## Orphan inventory');
  lines.push('');
  lines.push(`**Project:** ${report.projectRoot}`);
  lines.push(`**Generated:** ${report.scannedAt}`);
  lines.push(`**Scope:** ${report.scope}${report.strict ? ' (strict)' : ''}`);
  lines.push(`**Counts:** export=${report.counts.export} import=${report.counts.import} cliSubcommand=${report.counts.cliSubcommand} docEndpoint=${report.counts.docEndpoint}`);
  lines.push('');

  lines.push(`### Export orphans (declared but no in-repo importer) (${report.counts.export})`);
  lines.push('');
  {
    const arr = report.exportOrphans.slice(0, Number.isFinite(max) ? max : report.exportOrphans.length);
    for (const e of arr) {
      lines.push(`- \`${e.sourceFile}:${e.line}\` — \`${e.name}\` (${e.kind})`);
    }
    if (report.exportOrphans.length > arr.length) {
      lines.push(`- ... and ${report.exportOrphans.length - arr.length} more`);
    }
  }
  lines.push('');

  lines.push(`### Import orphans (working-tree diff focus) (${report.counts.import})`);
  lines.push('');
  {
    const arr = report.importOrphans.slice(0, Number.isFinite(max) ? max : report.importOrphans.length);
    for (const e of arr) {
      lines.push(`- \`${e.importer}:${e.line}\` imports \`${e.symbol}\` from \`${e.importedFrom}\` (not exported)`);
    }
    if (report.importOrphans.length > arr.length) {
      lines.push(`- ... and ${report.importOrphans.length - arr.length} more`);
    }
  }
  lines.push('');

  lines.push(`### CLI subcommand orphans (declared but only used at declaration site) (${report.counts.cliSubcommand})`);
  lines.push('');
  {
    const arr = report.cliSubcommandOrphans.slice(0, Number.isFinite(max) ? max : report.cliSubcommandOrphans.length);
    for (const e of arr) {
      lines.push(`- \`peaks ${e.name}\` declared in \`${e.sourceFile}\` — ${e.reason}`);
    }
    if (report.cliSubcommandOrphans.length > arr.length) {
      lines.push(`- ... and ${report.cliSubcommandOrphans.length - arr.length} more`);
    }
  }
  lines.push('');

  lines.push(`### Doc endpoint orphans (tech-doc declares; codebase lacks) (${report.counts.docEndpoint})`);
  lines.push('');
  {
    const arr = report.docEndpointOrphans.slice(0, Number.isFinite(max) ? max : report.docEndpointOrphans.length);
    for (const e of arr) {
      lines.push(`- \`${e.endpoint}\` declared in \`${e.declaredIn}\` — not implemented in src/`);
    }
    if (report.docEndpointOrphans.length > arr.length) {
      lines.push(`- ... and ${report.docEndpointOrphans.length - arr.length} more`);
    }
  }
  lines.push('');

  return lines.join('\n');
}
