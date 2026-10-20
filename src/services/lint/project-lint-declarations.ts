// src/services/lint/project-lint-declarations.ts
//
// The declaration sites a project ships — the raw material for L1.
//
// A project says what its gate runs in the files it ships. This module reads
// those files and reports the commands they declare; it does not judge them.
// Judging (is this a lint tool?) belongs to the caller.
//
// THE SITES, and why each one is here:
//   - `package.json` scripts — the most common declaration of all.
//   - `Makefile` targets — the Unix convention.
//   - `pyproject.toml` `[tool.*]` tables — the Python convention.
//   - `go.mod` `tool` directives — the Go 1.24+ convention.
//   - CI workflow steps that RUN something — the gate as it actually executes.
//
// NOTHING HERE BRANCHES ON A LANGUAGE. The sites are the same for every
// project; a site that a project does not ship simply yields nothing.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { normalizePath } from '../../shared/path-utils.js';

/** One declaration the project ships: a script, a target, a table, a CI step. */
export type DeclaredCommand = {
  /**
   * The declaration's own name — the script name, the make target, the tool
   * table. Empty for a CI step, which has no name of its own.
   */
  readonly label: string;
  /** The command line the project declared. */
  readonly command: string;
  /** Where the declaration was found. */
  readonly declaredBy: string;
};

/** What one declaration site yielded. */
export type DeclarationScan = {
  readonly commands: readonly DeclaredCommand[];
  /** Sites that could not be read — reported, never swallowed. */
  readonly problems: readonly string[];
};

/** Every declaration the project ships, and the sites that could not be read. */
export type ProjectDeclarations = {
  readonly commands: readonly DeclaredCommand[];
  readonly problems: readonly string[];
  /** The `package.json` scripts by name, so `pnpm lint` can be resolved. */
  readonly scripts: ReadonlyMap<string, string>;
};

const EMPTY_SCAN: DeclarationScan = { commands: [], problems: [] };

function readText(path: string): { ok: true; text: string } | { ok: false; reason: string } {
  if (!existsSync(path)) return { ok: false, reason: 'not present' };
  try {
    return { ok: true, text: readFileSync(path, 'utf8') };
  } catch (error: unknown) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The `package.json` scripts — the most common declaration site. */
function packageJsonSite(root: string): DeclarationScan {
  const read = readText(join(root, 'package.json'));
  if (!read.ok) return EMPTY_SCAN;
  let parsed: unknown;
  try {
    parsed = JSON.parse(read.text);
  } catch (error: unknown) {
    return { commands: [], problems: [`package.json is not valid JSON: ${errorText(error)}`] };
  }
  if (parsed === null || typeof parsed !== 'object') {
    return { commands: [], problems: ['package.json is not a JSON object'] };
  }
  const scripts = (parsed as { scripts?: unknown }).scripts;
  if (scripts === null || typeof scripts !== 'object' || Array.isArray(scripts)) return EMPTY_SCAN;
  const commands: DeclaredCommand[] = [];
  for (const [label, value] of Object.entries(scripts as Record<string, unknown>)) {
    if (typeof value !== 'string') continue;
    commands.push({ label, command: value, declaredBy: `package.json scripts.${label}` });
  }
  return { commands, problems: [] };
}

/** The `Makefile` targets and their recipes. */
function makefileSite(root: string): DeclarationScan {
  const commands: DeclaredCommand[] = [];
  for (const fileName of ['Makefile', 'makefile']) {
    const read = readText(join(root, fileName));
    if (!read.ok) continue;
    readMakefileTargets(read.text, fileName, commands);
  }
  return { commands, problems: [] };
}

function readMakefileTargets(text: string, fileName: string, commands: DeclaredCommand[]): void {
  let target: string | null = null;
  let recipe: string[] = [];
  const flush = (): void => {
    if (target === null) return;
    commands.push({
      label: target,
      command: recipe.join(' '),
      declaredBy: `${fileName} ${target}`
    });
    target = null;
    recipe = [];
  };
  for (const line of text.split(/\r?\n/)) {
    const header = /^([A-Za-z0-9_./-]+):(?!=)\s*$/.exec(line);
    if (header?.[1] !== undefined) {
      flush();
      target = header[1];
      continue;
    }
    if (target !== null && /^\s+\S/.test(line)) recipe.push(line.trim());
  }
  flush();
}

/** The `pyproject.toml` `[tool.*]` tables. */
function pyprojectSite(root: string): DeclarationScan {
  const read = readText(join(root, 'pyproject.toml'));
  if (!read.ok) return EMPTY_SCAN;
  const commands: DeclaredCommand[] = [];
  for (const line of read.text.split(/\r?\n/)) {
    const match = /^\[tool\.([A-Za-z0-9_.-]+)\]/.exec(line.trim());
    const table = match?.[1];
    if (table === undefined) continue;
    const label = table.split('.')[0] ?? table;
    commands.push({ label, command: label, declaredBy: `pyproject.toml [tool.${table}]` });
  }
  return { commands, problems: [] };
}

/** The `go.mod` tool directives (Go 1.24+ `tool` blocks and single directives). */
function goModSite(root: string): DeclarationScan {
  const read = readText(join(root, 'go.mod'));
  if (!read.ok) return EMPTY_SCAN;
  const commands: DeclaredCommand[] = [];
  let inToolBlock = false;
  for (const raw of read.text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('tool (')) {
      inToolBlock = true;
      continue;
    }
    if (inToolBlock) {
      if (line === ')') {
        inToolBlock = false;
        continue;
      }
      const label = line.split(/\s+/)[0];
      if (label !== undefined && label.length > 0) commands.push(goToolCommand(label));
      continue;
    }
    const single = /^tool\s+(\S+)/.exec(line);
    if (single?.[1] !== undefined) commands.push(goToolCommand(single[1]));
  }
  return { commands, problems: [] };
}

function goToolCommand(pkg: string): DeclaredCommand {
  const label = pkg.split('/').pop() ?? pkg;
  return { label, command: `go tool ${label}`, declaredBy: `go.mod tool ${pkg}` };
}

/** The CI workflow steps that RUN something. */
function ciSite(root: string): DeclarationScan {
  const commands: DeclaredCommand[] = [];
  const problems: string[] = [];
  const found = ciFiles(root);
  problems.push(...found.problems);
  for (const file of found.files) {
    const read = readText(file);
    if (!read.ok) {
      problems.push(`${normalizePath(file.slice(root.length + 1))}: ${read.reason}`);
      continue;
    }
    const relative = normalizePath(file.slice(root.length + 1));
    read.text.split(/\r?\n/).forEach((line, index) => {
      const command = ciRunCommand(line);
      if (command === null) return;
      commands.push({ label: '', command, declaredBy: `${relative}:${String(index + 1)}` });
    });
  }
  return { commands, problems };
}

/** The CI files a project ships, plus the sites that could not be listed. */
function ciFiles(root: string): { files: readonly string[]; problems: readonly string[] } {
  const files: string[] = [];
  const problems: string[] = [];
  const workflowDir = join(root, '.github', 'workflows');
  if (existsSync(workflowDir)) {
    try {
      for (const entry of readdirSync(workflowDir)) {
        if (entry.endsWith('.yml') || entry.endsWith('.yaml')) files.push(join(workflowDir, entry));
      }
    } catch (error: unknown) {
      problems.push(`.github/workflows: ${errorText(error)}`);
    }
  }
  const gitlab = join(root, '.gitlab-ci.yml');
  if (existsSync(gitlab)) files.push(gitlab);
  return { files, problems };
}

/** The command a CI line runs, or `null` when the line runs nothing. */
function ciRunCommand(line: string): string | null {
  const match = /^\s*(?:-\s*)?(?:run|script):\s*(.+)$/.exec(line);
  const raw = match?.[1];
  if (raw === undefined) return null;
  const command = raw.trim().replace(/^['"]|['"]$/g, '');
  if (command.length === 0 || command === '|' || command === '>-') return null;
  return command;
}

/** Every declaration the project ships. */
export function readProjectDeclarations(projectRoot: string): ProjectDeclarations {
  const packageScan = packageJsonSite(projectRoot);
  const scripts = new Map(packageScan.commands.map((entry) => [entry.label, entry.command]));
  const scans: readonly DeclarationScan[] = [
    packageScan,
    makefileSite(projectRoot),
    pyprojectSite(projectRoot),
    goModSite(projectRoot),
    ciSite(projectRoot)
  ];
  return {
    commands: scans.flatMap((scan) => scan.commands),
    problems: scans.flatMap((scan) => scan.problems),
    scripts
  };
}
