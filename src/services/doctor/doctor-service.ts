import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve as resolvePath } from 'node:path';
import { readText } from '../../shared/fs.js';
import { requiredSchemaFiles, requiredSkillNames, schemasDir } from '../../shared/paths.js';
import { getErrorMessage } from '../../shared/result.js';
import { loadSkillRegistry } from '../skills/skill-registry.js';
import { getSkillPresence, type SkillPresence } from '../skills/skill-presence-service.js';
import { planStatusLineInstall } from '../skills/statusline-settings-service.js';
import { findProjectRoot } from '../config/config-safety.js';
import { CLI_VERSION } from '../../shared/version.js';

export type DoctorCheck = {
  id: string;
  ok: boolean;
  message: string;
};

export type DoctorReport = {
  checks: DoctorCheck[];
  summary: {
    ok: boolean;
    passed: number;
    failed: number;
  };
};

export type CodegraphCapabilityProbe = {
  packagePath: string;
  version: string;
  binaryPath: string;
  binaryExists: boolean;
};

export type DoctorOptions = {
  schemasBaseDir?: string;
  skillsBaseDir?: string;
  codegraphProbe?: () => CodegraphCapabilityProbe;
  skillPresenceProbe?: () => SkillPresence | null;
  skillPresenceFreshnessThresholdMs?: number;
  statusLineInstalledProbe?: () => boolean;
  /** Returns true when a Peaks workspace session (.peaks/.session.json) exists. */
  workspaceInitializedProbe?: () => boolean;
  /** Platform string (defaults to process.platform); injectable for tests. */
  platform?: NodeJS.Platform;
};

const CODEGRAPH_EXPECTED_VERSION = '0.7.10';
const SKILL_PRESENCE_FRESHNESS_THRESHOLD_MS = 24 * 60 * 60 * 1000;

function defaultCodegraphProbe(): CodegraphCapabilityProbe {
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve('@colbymchenry/codegraph/package.json');
  const pkg = require(packagePath) as { version?: string };
  const binaryPath = resolvePath(dirname(packagePath), 'dist', 'bin', 'codegraph.js');
  return {
    packagePath,
    version: pkg.version ?? 'unknown',
    binaryPath,
    binaryExists: existsSync(binaryPath)
  };
}

function defaultStatusLineInstalledProbe(): boolean {
  const projectRoot = findProjectRoot(process.cwd());
  // Check both scopes: a user may have installed the statusLine globally, which
  // the project-only check would miss and falsely report as "not installed".
  try {
    if (projectRoot !== null && planStatusLineInstall('project', projectRoot).alreadyInstalled) {
      return true;
    }
  } catch {
    /* fall through to global */
  }
  try {
    return planStatusLineInstall('global').alreadyInstalled;
  } catch {
    return false;
  }
}

function defaultWorkspaceInitializedProbe(): boolean {
  const projectRoot = findProjectRoot(process.cwd());
  if (projectRoot === null) return false;
  // Workspace is "initialized" when EITHER the canonical runtime-layer session
  // binding (`.peaks/_runtime/session.json`, the home since slice
  // 2026-06-05-peaks-runtime-layer) OR the legacy top-level binding
  // (`.peaks/.session.json`, kept as read-only back-compat for one minor
  // release) is present. The legacy check is what catches projects that ran
  // `peaks workspace init` before the runtime-layer migration and have not yet
  // been reconciled; both paths must continue to satisfy the doctor until the
  // legacy location is removed.
  return isWorkspaceInitializedAt(projectRoot);
}

/**
 * Pure helper extracted from `defaultWorkspaceInitializedProbe` so tests can
 * drive the filesystem check without monkey-patching `process.cwd()` or
 * `findProjectRoot`. Returns `true` when EITHER the canonical
 * `.peaks/_runtime/session.json` OR the legacy `.peaks/.session.json` exists.
 */
export function isWorkspaceInitializedAt(projectRoot: string): boolean {
  return (
    existsSync(join(projectRoot, '.peaks', '_runtime', 'session.json')) ||
    existsSync(join(projectRoot, '.peaks', '.session.json'))
  );
}

const DESTRUCTIVE_APPLY_PATTERNS = [
  /peaks\s+memory\s+sync[^\n]*--apply/,
  /peaks\s+memory\s+extract[^\n]*--apply/,
  /peaks\s+artifacts\s+sync[^\n]*--apply/,
  /peaks\s+openspec\s+archive[^\n]*--apply/,
  /peaks\s+standards\s+(?:init|update)[^\n]*--apply/
];

const AUTHORIZATION_KEYWORDS_PATTERN = /authoriz|explicit|--dry-run|approv|only after|only when/i;

function extractRunbookSection(body: string): string | null {
  const match = /## Default runbook\n+([\s\S]*?)(?=\n## |$)/.exec(body);
  return match === null ? null : (match[1] ?? null);
}

function findDestructiveApplyLines(section: string): string[] {
  const lines = section.split(/\r?\n/);
  return lines.filter((line) => DESTRUCTIVE_APPLY_PATTERNS.some((pattern) => pattern.test(line)));
}

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const registry = await loadSkillRegistry(options.skillsBaseDir);
  const skills = registry.skills;
  const skillNames = new Set(skills.map((skill) => skill.name));

  for (const requiredSkill of requiredSkillNames) {
    checks.push({
      id: `skill:${requiredSkill}`,
      ok: skillNames.has(requiredSkill),
      message: skillNames.has(requiredSkill)
        ? `Required skill ${requiredSkill} exists`
        : `Missing required skill ${requiredSkill}`
    });
  }

  for (const skill of skills) {
    checks.push({
      id: `skill-name:${skill.directory}`,
      ok: skill.name === skill.directory,
      message: skill.name === skill.directory
        ? `Skill ${skill.name} matches its directory`
        : `Skill ${skill.directory} declares mismatched name ${skill.name}`
    });
  }

  for (const failure of registry.failures) {
    checks.push({
      id: `skill-parse:${failure.directory}`,
      ok: false,
      message: `Skill ${failure.directory} has invalid metadata: ${failure.message}`
    });
  }

  const requiredSkillNameSet = new Set<string>(requiredSkillNames);
  for (const skill of skills) {
    if (!requiredSkillNameSet.has(skill.name)) {
      continue;
    }
    try {
      const body = await readText(skill.skillPath);
      const hasRunbook = /## Default runbook\s/.test(body);
      checks.push({
        id: `skill-runbook:${skill.name}`,
        ok: hasRunbook,
        message: hasRunbook
          ? `Skill ${skill.name} declares a Default runbook`
          : `Skill ${skill.name} is missing a ## Default runbook section`
      });

      const runbookSection = extractRunbookSection(body);
      if (runbookSection !== null) {
        const destructiveLines = findDestructiveApplyLines(runbookSection);
        if (destructiveLines.length === 0) {
          checks.push({
            id: `skill-apply-note:${skill.name}`,
            ok: true,
            message: `Skill ${skill.name} runbook has no destructive --apply commands to gate`
          });
        } else {
          const hasAuthorizationNote = AUTHORIZATION_KEYWORDS_PATTERN.test(runbookSection);
          checks.push({
            id: `skill-apply-note:${skill.name}`,
            ok: hasAuthorizationNote,
            message: hasAuthorizationNote
              ? `Skill ${skill.name} gates ${destructiveLines.length} destructive --apply command(s) with an authorization note`
              : `Skill ${skill.name} has ${destructiveLines.length} destructive --apply command(s) without an authorization/dry-run note in the runbook section`
          });
        }
      }
    } catch (error) {
      checks.push({
        id: `skill-runbook:${skill.name}`,
        ok: false,
        message: `Skill ${skill.name} runbook check failed: ${getErrorMessage(error)}`
      });
    }
  }

  const schemaRoot = options.schemasBaseDir ?? schemasDir;

  for (const schemaFile of requiredSchemaFiles) {
    try {
      JSON.parse(await readText(join(schemaRoot, schemaFile)));
      checks.push({ id: `schema:${schemaFile}`, ok: true, message: `Schema ${schemaFile} is valid JSON` });
    } catch (error) {
      checks.push({
        id: `schema:${schemaFile}`,
        ok: false,
        message: `Schema ${schemaFile} is missing or invalid: ${getErrorMessage(error)}`
      });
    }
  }

  const userConfigPath = join(homedir(), '.peaks', 'config.json');
  const hasUserConfig = existsSync(userConfigPath);
  checks.push({
    id: 'config:user',
    ok: true,
    message: hasUserConfig ? 'User config exists at ~/.peaks/config.json' : 'Optional user config not found at ~/.peaks/config.json'
  });

  const presenceProbe = options.skillPresenceProbe ?? getSkillPresence;
  const freshnessThresholdMs = options.skillPresenceFreshnessThresholdMs ?? SKILL_PRESENCE_FRESHNESS_THRESHOLD_MS;
  let presence: SkillPresence | null = null;
  try {
    presence = presenceProbe();
  } catch {
    presence = null;
  }

  if (presence === null) {
    checks.push({
      id: 'skill-presence:current',
      ok: true,
      message: 'No active Peaks skill presence (.peaks/.active-skill.json absent or invalid)'
    });
    checks.push({
      id: 'skill-presence:freshness',
      ok: true,
      message: 'No active Peaks skill presence to age-check'
    });
  } else {
    const modePart = presence.mode !== undefined ? `, mode ${presence.mode}` : '';
    const gatePart = presence.gate !== undefined ? `, gate ${presence.gate}` : '';
    checks.push({
      id: 'skill-presence:current',
      ok: true,
      message: `Active Peaks skill presence: ${presence.skill}${modePart}${gatePart} (set ${presence.setAt})`
    });

    const setAtMs = Date.parse(presence.setAt);
    if (Number.isNaN(setAtMs)) {
      checks.push({
        id: 'skill-presence:freshness',
        ok: false,
        message: `Skill presence ${presence.skill} has invalid setAt: ${presence.setAt}`
      });
    } else {
      const ageMs = Date.now() - setAtMs;
      if (ageMs > freshnessThresholdMs) {
        const ageHours = Math.round(ageMs / (60 * 60 * 1000));
        checks.push({
          id: 'skill-presence:freshness',
          ok: false,
          message: `Skill presence ${presence.skill} is stale (set ${presence.setAt}, ~${ageHours}h ago); run peaks skill presence:clear if the role has ended`
        });
      } else {
        checks.push({
          id: 'skill-presence:freshness',
          ok: true,
          message: `Skill presence ${presence.skill} is fresh (set ${presence.setAt})`
        });
      }
    }
  }

  // Workspace guard: an active workflow presence (peaks-solo) with no workspace
  // session means the skill was anchored but `peaks workspace init` never ran —
  // the #1 reported failure where .peaks/ artifacts are never created. This
  // turns the SKILL.md "MUST create the workspace" prose into an executable check.
  const workspaceProbe = options.workspaceInitializedProbe ?? defaultWorkspaceInitializedProbe;
  let workspaceInitialized = false;
  try {
    workspaceInitialized = workspaceProbe();
  } catch {
    workspaceInitialized = false;
  }
  if (presence !== null && !workspaceInitialized) {
    checks.push({
      id: 'skill-presence:workspace',
      ok: false,
      message: `Skill ${presence.skill} is active but no workspace session exists (.peaks/_runtime/session.json missing); run \`peaks workspace init --project <repo>\` — peaks-solo Step 0 must anchor the workspace before any work`
    });
  } else {
    checks.push({
      id: 'skill-presence:workspace',
      ok: true,
      message: presence === null
        ? 'No active skill presence; workspace guard not applicable'
        : `Workspace session present for active skill ${presence.skill}`
    });
  }

  // Discoverability nudge: when a skill is actively orchestrating but the
  // out-of-band statusLine isn't installed, the user has no terminal-level
  // signal that Peaks is in control. Suggest installing it (non-failing).
  const statusLineProbe = options.statusLineInstalledProbe ?? defaultStatusLineInstalledProbe;
  let statusLineInstalled = false;
  try {
    statusLineInstalled = statusLineProbe();
  } catch {
    statusLineInstalled = false;
  }
  if (presence !== null && !statusLineInstalled) {
    checks.push({
      id: 'statusline:install',
      ok: true,
      message: 'A Peaks skill is active but the statusLine is not installed; run `peaks statusline install` so the active skill shows in the terminal status bar'
    });
  } else {
    checks.push({
      id: 'statusline:install',
      ok: true,
      message: statusLineInstalled
        ? 'Peaks statusLine is installed'
        : 'Peaks statusLine not installed (no active skill; install optional)'
    });
  }

  // Runtime/platform diagnostic for the "statusLine shows nothing" reports.
  // Surfaces (a) the running peaks version — a stale global install predating
  // the statusLine feature is a common cause — and (b) on Windows, the fact that
  // the bare `peaks statusline` command must resolve in the shell Claude Code
  // spawns, which fails when the npm global bin dir is not on that shell's PATH.
  const platform = options.platform ?? process.platform;
  if (platform === 'win32') {
    checks.push({
      id: 'statusline:runtime',
      ok: true,
      message: `peaks ${CLI_VERSION} (win32): if the statusLine shows nothing in git bash, verify \`peaks\` resolves on PATH in the shell Claude Code uses (run \`peaks -v\` there), reinstall globally with \`npm i -g peaks-cli@latest\` if the version is older than ${CLI_VERSION}, then re-run \`peaks statusline install\` and reload Claude Code`
    });
  } else {
    checks.push({
      id: 'statusline:runtime',
      ok: true,
      message: `peaks ${CLI_VERSION} (${platform}): statusLine command is \`peaks statusline\``
    });
  }

  const probe = options.codegraphProbe ?? defaultCodegraphProbe;
  try {
    const result = probe();
    const versionOk = result.version === CODEGRAPH_EXPECTED_VERSION;
    if (!versionOk) {
      checks.push({
        id: 'capability:codegraph',
        ok: false,
        message: `@colbymchenry/codegraph version mismatch: expected ${CODEGRAPH_EXPECTED_VERSION}, resolved ${result.version} at ${result.packagePath}`
      });
    } else if (!result.binaryExists) {
      checks.push({
        id: 'capability:codegraph',
        ok: false,
        message: `@colbymchenry/codegraph@${result.version} resolved at ${result.packagePath} but binary is missing at ${result.binaryPath}`
      });
    } else {
      checks.push({
        id: 'capability:codegraph',
        ok: true,
        message: `@colbymchenry/codegraph@${result.version} resolves with binary at ${result.binaryPath}`
      });
    }
  } catch (error) {
    checks.push({
      id: 'capability:codegraph',
      ok: false,
      message: `@colbymchenry/codegraph not resolvable: ${getErrorMessage(error)}`
    });
  }

  try {
    const schemaText = await readText(join(schemaRoot, 'doctor-report.schema.json'));
    const schema = JSON.parse(schemaText) as {
      properties?: { checks?: { items?: { properties?: { id?: { pattern?: string } } } } };
    };
    const patternSource = schema.properties?.checks?.items?.properties?.id?.pattern;
    if (typeof patternSource === 'string') {
      const pattern = new RegExp(patternSource);
      const mismatches = checks.filter((check) => !pattern.test(check.id)).map((check) => check.id);
      checks.push({
        id: 'doctor-self:check-id-pattern',
        ok: mismatches.length === 0,
        message: mismatches.length === 0
          ? 'All doctor check IDs match the doctor-report schema pattern'
          : `Doctor check IDs missing from schema pattern: ${mismatches.join(', ')}`
      });
    } else {
      checks.push({
        id: 'doctor-self:check-id-pattern',
        ok: false,
        message: 'doctor-report.schema.json does not declare a check.id pattern'
      });
    }
  } catch (error) {
    checks.push({
      id: 'doctor-self:check-id-pattern',
      ok: false,
      message: `Failed to load doctor-report.schema.json for self-validation: ${getErrorMessage(error)}`
    });
  }

  const failed = checks.filter((check) => !check.ok).length;
  return {
    checks,
    summary: {
      ok: failed === 0,
      passed: checks.length - failed,
      failed
    }
  };
}
