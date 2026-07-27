/**
 * doctor-service facade (slice rid-004).
 *
 * Public entrypoint for the code-driven fixed-registry doctor
 * pipeline. Replaces the legacy 1309-line monolithic `runDoctor`
 * with a thin dispatcher that:
 *
 *   1. Resolves all cross-domain injections (project-root resolver,
 *      skill loader, sid validator, schema root, presence, etc.)
 *      and builds a read-only `DoctorContext` once.
 *   2. Walks the `PLUGINS` array in `plugin-registry.ts` in order,
 *      calling each plugin's `run(context)`, flattening the
 *      returned `DoctorCheck[]` into the accumulator.
 *   3. Updates `context.accumulatedChecks` after each plugin so the
 *      `check-id-schema` self-validation plugin observes the full
 *      prior list.
 *   4. Hands the accumulated checks to `report/final-summary.ts`
 *      which builds the public `DoctorReport`.
 *
 * The `runDoctor` signature is unchanged from the legacy version;
 * main peaks-loop package imports it via
 * `import { runDoctor } from '../index.js'`.
 *
 * slice-3b Option C: the doctor package stays standalone by
 * accepting the cross-domain utilities as injectable probes. When
 * no injection is provided, the doctor falls back to a safe
 * "no-op / assume healthy" probe so the standalone test suite
 * does not depend on the main package. The CLI wires the main-
 * package implementations at call-site
 * (`src/cli/commands/core/doctor-command.ts`).
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { schemasDir, skillsDir } from 'peaks-loop-shared/paths';

import { PLUGINS } from './plugin-registry.js';
import { buildReport } from './report/final-summary.js';
import type {
  DoctorCheck,
  DoctorContext,
  DoctorOptions,
  DoctorReport,
  DoctorSkillPresence,
  DoctorSkillsResult
} from './types.js';

/**
 * slice-3b Option C: inlined sid regex. The main package's canonical
 * definition lives in `src/services/workspace/sid-naming-guard.ts`. The
 * regex MUST stay byte-identical with that file. If
 * `sid-naming-guard.ts` is ever moved to `peaks-loop-shared`, swap this
 * for a `peaks-loop-shared/workspace/sid-naming-guard` import and drop
 * the inlined copy.
 */
const VALID_SID_REGEX = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])-session-[0-9a-z]{3,6}$/;

function defaultIsValidSessionId(sid: string): boolean {
  return VALID_SID_REGEX.test(sid);
}

function defaultProjectRootResolver(): string | null {
  // slice-3b Option C: minimal in-package project-root resolver.
  // Mirrors the high-level behaviour of the main package's
  // `findProjectRoot` (src/services/config/config-safety.ts) without
  // pulling in its full safety-validation surface. The CLI may
  // inject a richer resolver at call-site.
  let current = process.cwd();
  let pkgRoot: string | null = null;
  while (true) {
    const parent = dirname(current);
    if (parent === current) {
      return pkgRoot;
    }
    if (existsSync(join(current, '.peaks', 'config.json'))) {
      return current;
    }
    if (existsSync(join(current, '.git'))) {
      return current;
    }
    if (pkgRoot === null && existsSync(join(current, 'package.json'))) {
      pkgRoot = current;
    }
    current = parent;
  }
}

/**
 * Pure helper extracted so tests can drive the filesystem check
 * without monkey-patching `process.cwd()` or `findProjectRoot`.
 * Returns `true` when EITHER the canonical
 * `.peaks/_runtime/session.json` OR the legacy
 * `.peaks/.session.json` exists.
 */
export function isWorkspaceInitializedAt(projectRoot: string): boolean {
  return (
    existsSync(join(projectRoot, '.peaks', '_runtime', 'session.json')) ||
    existsSync(join(projectRoot, '.peaks', '.session.json'))
  );
}

function defaultWorkspaceInitializedProbe(
  projectRootResolver: () => string | null
): boolean {
  const projectRoot = projectRootResolver();
  if (projectRoot === null) return false;
  // Workspace is "initialized" when EITHER the canonical runtime-layer
  // session binding (`.peaks/_runtime/session.json`) OR the legacy
  // top-level binding (`.peaks/.session.json`, kept as read-only
  // back-compat for one minor release) is present.
  return isWorkspaceInitializedAt(projectRoot);
}

async function defaultLoadSkills(baseDir: string | undefined, listDirectories: (target: string) => Promise<string[]>, pathExists: (target: string) => Promise<boolean>, readText: (target: string) => Promise<string>): Promise<DoctorSkillsResult> {
  // slice-3b Option C: minimal skill-loader. Walks
  // `<baseDir>/*/SKILL.md` (and one level into `bee/`, mirroring the
  // upstream `skill-registry.ts`), parses the frontmatter, and returns
  // `{ skills, failures }`. The CLI may inject a richer loader at
  // call-site.
  const target = baseDir ?? skillsDir;
  if (!(await pathExists(target))) {
    return { skills: [], failures: [] };
  }
  const skills: import('./types.js').DoctorSkillEntry[] = [];
  const failures: import('./types.js').DoctorSkillLoadFailure[] = [];
  const directories = await listDirectories(target);

  for (const directory of directories) {
    if (directory === 'bee') {
      const subEntries = await listDirectories(join(target, 'bee'));
      for (const subDir of subEntries) {
        const skillPath = join(target, 'bee', subDir, 'SKILL.md');
        if (!(await pathExists(skillPath))) continue;
        try {
          const { name } = parseDoctorSkillFrontmatter(await readText(skillPath));
          skills.push({ name, directory: subDir, skillPath });
        } catch (error) {
          failures.push({ directory: subDir, skillPath, message: getErrorMessageLite(error) });
        }
      }
      continue;
    }
    const skillPath = join(target, directory, 'SKILL.md');
    if (!(await pathExists(skillPath))) continue;
    try {
      const { name } = parseDoctorSkillFrontmatter(await readText(skillPath));
      skills.push({ name, directory, skillPath });
    } catch (error) {
      failures.push({ directory, skillPath, message: getErrorMessageLite(error) });
    }
  }

  skills.sort((left, right) => left.name.localeCompare(right.name));
  failures.sort((left, right) => left.directory.localeCompare(right.directory));
  return { skills, failures };
}

function parseDoctorSkillFrontmatter(body: string): { name: string; description: string } {
  // slice-3b Option C: minimal SKILL.md frontmatter parser. The
  // doctor only needs `name` and `description` for the
  // skill-name-matches-directory and skill-runbook checks.
  const lines = body.split(/\r?\n/);
  if (lines[0] !== '---') {
    throw new Error('Missing YAML frontmatter opening marker');
  }
  const endIndex = lines.findIndex((line, index) => index > 0 && line === '---');
  if (endIndex === -1) {
    throw new Error('Missing YAML frontmatter closing marker');
  }
  const metadata: Record<string, string> = {};
  for (let index = 1; index < endIndex; index += 1) {
    const line = lines[index];
    if (line === undefined) continue;
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const match = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(trimmed);
    if (match?.[1] === undefined) continue;
    metadata[match[1]] = (match[2] ?? '').trim().replace(/^['"]|['"]$/g, '');
  }
  if (!metadata.name) {
    throw new Error('Missing required frontmatter field: name');
  }
  if (!metadata.description) {
    throw new Error('Missing required frontmatter field: description');
  }
  return { name: metadata.name, description: metadata.description };
}

function getErrorMessageLite(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Public entrypoint. Walks the `PLUGINS` array, building the
 * `DoctorContext` once at the top and threading it through every
 * plugin. The accumulator is a mutable list shared via
 * `context.accumulatedChecks` so plugins like `check-id-schema`
 * that need to observe the prior list can do so.
 */
export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  // slice-3b Option C: resolve the cross-domain injections up front.
  const projectRootResolver = options.projectRootResolver ?? defaultProjectRootResolver;
  const isValidSessionId = options.isValidSessionIdProbe ?? defaultIsValidSessionId;

  const fsModule = await import('peaks-loop-shared/fs');
  const listDirectoriesImpl = (target: string): Promise<string[]> => fsModule.listDirectories(target);
  const pathExistsImpl = (target: string): Promise<boolean> => fsModule.pathExists(target);
  const readTextImpl = (target: string): Promise<string> => fsModule.readText(target);

  const loadSkills = options.loadSkills ?? ((baseDir?: string) => defaultLoadSkills(baseDir, listDirectoriesImpl, pathExistsImpl, readTextImpl));
  const registry = await loadSkills(options.skillsBaseDir);
  const skills = registry.skills;

  const schemaRoot = options.schemasBaseDir ?? schemasDir;

  // Skill presence: probe once up front, swallowing probe errors.
  let presence: DoctorSkillPresence | null = null;
  if (options.skillPresenceProbe !== undefined) {
    try {
      presence = options.skillPresenceProbe();
    } catch {
      presence = null;
    }
  }

  // Workspace initialized: probe once up front, swallowing probe errors.
  const workspaceProbe = options.workspaceInitializedProbe ?? (() => defaultWorkspaceInitializedProbe(projectRootResolver));
  let workspaceInitialized = false;
  try {
    workspaceInitialized = workspaceProbe();
  } catch {
    workspaceInitialized = false;
  }

  // Statusline installed: the legacy code uses a fallback wrapper that
  // returns false when the CLI injects nothing. Replicate that here.
  const statusLineProbe = options.statusLineInstalledProbe ?? (() => false);
  let statusLineInstalled = false;
  try {
    statusLineInstalled = statusLineProbe();
  } catch {
    statusLineInstalled = false;
  }

  const platform = options.platform ?? process.platform;
  const resolvedL3Root = options.l3ProjectRoot ?? projectRootResolver() ?? process.cwd();

  // Build the context. We use a mutable holder for the accumulator
  // so plugins reading `context.accumulatedChecks` see prior
  // emissions; the dispatcher updates the array reference after
  // each plugin runs.
  const accumulated: DoctorCheck[] = [];
  const context: DoctorContext = {
    options,
    registry,
    skills,
    schemaRoot,
    presence,
    workspaceInitialized,
    statusLineInstalled,
    platform,
    resolvedL3Root,
    projectRootResolver,
    isValidSessionId,
    accumulatedChecks: accumulated
  };

  for (const plugin of PLUGINS) {
    const emitted = await plugin.run(context);
    for (const check of emitted) {
      accumulated.push(check);
    }
  }

  return buildReport(accumulated);
}