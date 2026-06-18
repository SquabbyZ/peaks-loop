/**
 * API surface scan service.
 *
 * Walks the project for CLI subcommands, service-level public exports,
 * public types, and module-level constants. Output feeds the tech-doc
 * "Existing API / Component Inventory" section. Read-only — no writes.
 *
 * Pattern follows `libraries-service.ts` (readFileSync + readdir; pure
 * data shape; no AST parsing). karpathy §2: minimum code, no abstractions.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

export type ApiSurfaceOptions = {
  projectRoot: string;
  /** Maximum entries per kind in output (after filtering). */
  maxPerKind?: number;
  /** Comma-separated globs (substring match) to limit the walk. */
  includeDirs?: string;
};

export type CliEntry = {
  name: string;
  description: string;
  sourceFile: string;
};

export type ServiceEntry = {
  name: string;
  kind: 'function' | 'class' | 'const';
  isAsync: boolean;
  sourceFile: string;
  line: number;
};

export type TypeEntry = {
  name: string;
  kind: 'interface' | 'type' | 'enum';
  sourceFile: string;
  line: number;
};

export type ConstantEntry = {
  name: string;
  sourceFile: string;
  line: number;
};

export type ApiSurfaceReport = {
  projectRoot: string;
  scannedAt: string;
  counts: { cli: number; service: number; type: number; constant: number };
  cli: CliEntry[];
  service: ServiceEntry[];
  type: TypeEntry[];
  constant: ConstantEntry[];
  warnings: string[];
};

const DEFAULT_DIRS = ['src/cli', 'src/services'] as const;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);

const COMMAND_RE = /\.command\(\s*['"]([^'"]+)['"]\s*\)\s*\.description\(\s*['"]([^'"]+)['"]/g;
const EXPORT_FUNCTION_RE = /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_CLASS_RE = /^export\s+class\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_CONST_RE = /^export\s+const\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_INTERFACE_RE = /^export\s+interface\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_TYPE_RE = /^export\s+type\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_ENUM_RE = /^export\s+enum\s+([A-Za-z_$][\w$]*)/gm;

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
      out.push(relative(projectRoot, full));
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

function parseIncludeDirs(raw: string | undefined): string[] {
  if (!raw) return [...DEFAULT_DIRS];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Scan the project for API surfaces. Read-only. Never throws; failures
 * surface as warnings in the report.
 */
export async function scanApiSurface(options: ApiSurfaceOptions): Promise<ApiSurfaceReport> {
  const includeDirs = parseIncludeDirs(options.includeDirs);
  const maxPerKind = options.maxPerKind ?? Number.POSITIVE_INFINITY;
  const warnings: string[] = [];

  const files = await walkProject(options.projectRoot, includeDirs);

  const cli: CliEntry[] = [];
  const service: ServiceEntry[] = [];
  const types: TypeEntry[] = [];
  const constants: ConstantEntry[] = [];

  for (const rel of files) {
    const full = join(options.projectRoot, rel);
    let content: string;
    try {
      content = await readFile(full, 'utf8');
    } catch (error) {
      warnings.push(`unreadable: ${rel}: ${(error as Error).message}`);
      continue;
    }

    if (rel.startsWith('src/cli/commands/')) {
      let m: RegExpExecArray | null;
      COMMAND_RE.lastIndex = 0;
      while ((m = COMMAND_RE.exec(content)) !== null) {
        cli.push({
          name: m[1] as string,
          description: (m[2] as string).slice(0, 120),
          sourceFile: rel
        });
      }
    }

    if (rel.startsWith('src/services/')) {
      for (const re of [EXPORT_FUNCTION_RE, EXPORT_CLASS_RE, EXPORT_CONST_RE,
                        EXPORT_INTERFACE_RE, EXPORT_TYPE_RE, EXPORT_ENUM_RE]) {
        re.lastIndex = 0;
      }

      let m: RegExpExecArray | null;
      while ((m = EXPORT_FUNCTION_RE.exec(content)) !== null) {
        service.push({
          name: m[1] as string,
          kind: 'function',
          isAsync: /export\s+async\s+function/.test(content.slice(Math.max(0, m.index - 10), m.index + 30)),
          sourceFile: rel,
          line: lineOf(content, m.index)
        });
      }
      while ((m = EXPORT_CLASS_RE.exec(content)) !== null) {
        service.push({
          name: m[1] as string,
          kind: 'class',
          isAsync: false,
          sourceFile: rel,
          line: lineOf(content, m.index)
        });
      }
      while ((m = EXPORT_INTERFACE_RE.exec(content)) !== null) {
        types.push({
          name: m[1] as string,
          kind: 'interface',
          sourceFile: rel,
          line: lineOf(content, m.index)
        });
      }
      while ((m = EXPORT_TYPE_RE.exec(content)) !== null) {
        types.push({
          name: m[1] as string,
          kind: 'type',
          sourceFile: rel,
          line: lineOf(content, m.index)
        });
      }
      while ((m = EXPORT_ENUM_RE.exec(content)) !== null) {
        types.push({
          name: m[1] as string,
          kind: 'enum',
          sourceFile: rel,
          line: lineOf(content, m.index)
        });
      }
      while ((m = EXPORT_CONST_RE.exec(content)) !== null) {
        constants.push({
          name: m[1] as string,
          sourceFile: rel,
          line: lineOf(content, m.index)
        });
      }
    }
  }

  const cliUnique = uniqueByName(cli).sort((a, b) => a.name.localeCompare(b.name));
  const serviceUnique = uniqueByName(service).sort((a, b) =>
    a.sourceFile.localeCompare(b.sourceFile) || a.name.localeCompare(b.name));
  const typeUnique = uniqueByName(types).sort((a, b) => a.name.localeCompare(b.name));
  const constantUnique = uniqueByName(constants).sort((a, b) => a.name.localeCompare(b.name));

  return {
    projectRoot: options.projectRoot,
    scannedAt: new Date().toISOString(),
    counts: {
      cli: cliUnique.length,
      service: serviceUnique.length,
      type: typeUnique.length,
      constant: constantUnique.length
    },
    cli: Number.isFinite(maxPerKind) ? cliUnique.slice(0, maxPerKind) : cliUnique,
    service: Number.isFinite(maxPerKind) ? serviceUnique.slice(0, maxPerKind) : serviceUnique,
    type: Number.isFinite(maxPerKind) ? typeUnique.slice(0, maxPerKind) : typeUnique,
    constant: Number.isFinite(maxPerKind) ? constantUnique.slice(0, maxPerKind) : constantUnique,
    warnings
  };
}

export function formatApiSurfaceMarkdown(
  report: ApiSurfaceReport,
  opts: { maxPerKind?: number; truncatedCounts?: { cli: number; service: number; type: number; constant: number } } = {}
): string {
  const max = opts.maxPerKind ?? Number.POSITIVE_INFINITY;
  const truncated = opts.truncatedCounts;
  const lines: string[] = [];
  lines.push('## API surface inventory');
  lines.push('');
  lines.push(`**Project:** ${report.projectRoot}`);
  lines.push(`**Generated:** ${report.scannedAt}`);
  lines.push(`**Counts:** cli=${report.counts.cli} service=${report.counts.service} type=${report.counts.type} constant=${report.counts.constant}`);
  lines.push('');

  const sections: Array<[string, number, (n: string) => string]> = [
    ['CLI subcommands', report.counts.cli, (n) => `\`peaks ${n}\``],
    ['Service exports', report.counts.service, (n) => `\`${n}\``],
    ['Public types', report.counts.type, (n) => `\`${n}\``],
    ['Module constants', report.counts.constant, (n) => `\`${n}\``]
  ];

  const arrays = [report.cli, report.service, report.type, report.constant];
  const trunc = truncated
    ? [truncated.cli - report.cli.length, truncated.service - report.service.length, truncated.type - report.type.length, truncated.constant - report.constant.length]
    : [0, 0, 0, 0];

  for (let i = 0; i < sections.length; i++) {
    const [title, count, fmt] = sections[i] as [string, number, (n: string) => string];
    const arr = arrays[i] as Array<{ name: string; sourceFile?: string; kind?: string; description?: string }>;
    const more = trunc[i] as number;
    lines.push(`### ${title} (${count})`);
    lines.push('');
    for (const entry of arr) {
      if (title === 'CLI subcommands') {
        const e = entry as CliEntry;
        lines.push(`- ${fmt(e.name)} — ${e.description}`);
      } else if (title === 'Service exports') {
        const e = entry as ServiceEntry;
        lines.push(`- \`${e.sourceFile}:${e.name}\` — ${e.isAsync ? 'async ' : ''}${e.kind}`);
      } else {
        const e = entry as { name: string; sourceFile: string; kind?: string };
        lines.push(`- ${fmt(e.name)} — \`${e.kind ?? 'const'}\` (from \`${e.sourceFile}\`)`);
      }
    }
    if (more > 0) {
      lines.push(`- ... and ${more} more`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
