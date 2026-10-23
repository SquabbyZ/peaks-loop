/**
 * The exact build / test / lint commands of a consumer project.
 *
 * WHY THIS EXISTS. The AGENTS.md body tells an agent which commands to run.
 * A command that does not exist in the target project is worse than no command
 * at all: the agent runs it, the tool call fails, and the turn is wasted. So
 * every command in here is DERIVED from `package.json#scripts` — the script
 * NAME is read from that file and the RUNNER is derived from the lockfile or
 * the `packageManager` field. A category with no matching script is omitted
 * rather than guessed, and no command is ever invented.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isExpectedFsMiss } from '../../shared/fs-utils.js';

/** The command categories the AGENTS.md body can carry. */
export type ProjectScriptCategory = 'build' | 'test' | 'lint';

export type ProjectScriptCommand = {
  readonly category: ProjectScriptCategory;
  /** The script name exactly as it appears in `package.json#scripts`. */
  readonly script: string;
  /** The exact command line to run. */
  readonly command: string;
  /** What the command does — one clause, so an agent can pick the right one. */
  readonly purpose: string;
};

export type ProjectScripts = {
  /** The package manager the command lines are spelled for. */
  readonly packageManager: string;
  /** At most one command per category, in category order. */
  readonly commands: readonly ProjectScriptCommand[];
};

type ScriptCandidate = {
  readonly category: ProjectScriptCategory;
  readonly name: string;
  readonly purpose: string;
};

/**
 * The candidate scripts per category, most specific first. Each candidate
 * carries its OWN purpose because `test:unit` does not run "the test suite" —
 * it runs the unit tests, and an agent told otherwise runs the wrong thing.
 */
const SCRIPT_CANDIDATES: readonly ScriptCandidate[] = [
  { category: 'build', name: 'build', purpose: 'builds the project' },
  { category: 'test', name: 'test', purpose: 'runs the test suite' },
  { category: 'test', name: 'test:unit', purpose: 'runs the unit tests' },
  { category: 'test', name: 'tests', purpose: 'runs the test suite' },
  { category: 'lint', name: 'lint', purpose: 'runs the linter' },
  { category: 'lint', name: 'lint:check', purpose: 'runs the linter in check mode' }
];

/**
 * Lockfile → runner. First hit wins; `package.json#packageManager` outranks
 * every entry here, because that field is the project's own declaration.
 */
const LOCKFILE_RUNNERS: readonly { readonly file: string; readonly runner: string }[] = [
  { file: 'pnpm-lock.yaml', runner: 'pnpm' },
  { file: 'yarn.lock', runner: 'yarn' },
  { file: 'bun.lock', runner: 'bun' },
  { file: 'bun.lockb', runner: 'bun' },
  { file: 'package-lock.json', runner: 'npm' }
];

const DEFAULT_RUNNER = 'npm';

type PackageJsonLike = {
  readonly scripts?: Record<string, string>;
  readonly packageManager?: string;
};

function readPackageJson(projectRoot: string): PackageJsonLike | null {
  const pkgPath = join(projectRoot, 'package.json');
  if (!existsSync(pkgPath)) return null;
  try {
    return JSON.parse(readFileSync(pkgPath, 'utf8')) as PackageJsonLike;
  } catch (err) {
    // Only an EXPECTED FS miss means "no readable package.json here" — the
    // same answer the guard above gives. Anything else (a malformed
    // package.json, a TypeError) is a real defect and must surface instead
    // of being flattened into "this project has no scripts".
    if (isExpectedFsMiss(err)) return null;
    throw err;
  }
}

/** `pnpm@10.11.0` → `pnpm`. */
function runnerFromPackageManagerField(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const at = trimmed.lastIndexOf('@');
  const name = at > 0 ? trimmed.slice(0, at) : trimmed;
  return name.length > 0 ? name : null;
}

function runnerFromLockfile(projectRoot: string): string {
  for (const entry of LOCKFILE_RUNNERS) {
    if (existsSync(join(projectRoot, entry.file))) return entry.runner;
  }
  return DEFAULT_RUNNER;
}

/** The exact command line for one script under one runner. */
function commandLine(runner: string, script: string): string {
  if (runner === 'npm') return `npm run ${script}`;
  if (runner === 'yarn') return `yarn ${script}`;
  if (runner === 'bun') return `bun run ${script}`;
  if (runner === 'pnpm') return `pnpm ${script}`;
  return `${runner} run ${script}`;
}

/**
 * The exact commands this project really has, read from `package.json#scripts`.
 *
 * Returns an empty command list for a project without a readable
 * `package.json` — the AGENTS.md body then carries no command section at all,
 * which is the honest outcome for a project with no scripts to name.
 */
export function detectProjectScripts(projectRoot: string): ProjectScripts {
  const pkg = readPackageJson(projectRoot);
  if (pkg === null) return { packageManager: DEFAULT_RUNNER, commands: [] };
  const scripts = pkg.scripts ?? {};
  const packageManager =
    runnerFromPackageManagerField(pkg.packageManager) ?? runnerFromLockfile(projectRoot);
  const commands: ProjectScriptCommand[] = [];
  const seen = new Set<ProjectScriptCategory>();
  for (const candidate of SCRIPT_CANDIDATES) {
    if (seen.has(candidate.category)) continue;
    if (!(candidate.name in scripts)) continue;
    seen.add(candidate.category);
    commands.push({
      category: candidate.category,
      script: candidate.name,
      command: commandLine(packageManager, candidate.name),
      purpose: candidate.purpose
    });
  }
  return { packageManager, commands };
}
