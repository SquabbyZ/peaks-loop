import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve as resolvePath } from 'node:path';
import { readText } from '../../shared/fs.js';
import { requiredSchemaFiles, requiredSkillNames, schemasDir } from '../../shared/paths.js';
import { getErrorMessage } from '../../shared/result.js';
import { loadSkillRegistry } from '../skills/skill-registry.js';
import { getSkillPresence, type SkillPresence } from '../skills/skill-presence-service.js';
import { planStatusLineInstall } from '../skills/statusline-settings-service.js';
import { findProjectRoot } from '../config/config-safety.js';
import { isValidSessionId } from '../workspace/sid-naming-guard.js';
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

export type DistVersionComparison = {
  dist: string | null;
  source: string;
  match: boolean;
  distReadable: boolean;
};

export type DistVersionProbe = () => DistVersionComparison;

export type WorkspaceLayoutInspection = {
  topLevelSessionDirs: string[];
  legacyDotfiles: string[];
  /**
   * Slice 007 — per-change-id top-level dirs (e.g. `.peaks/001-2026-06-06-.../`).
   * The pre-F3 canonical layout put reviewable artifacts under a
   * per-change-id top-level dir; the post-F3 canonical layout
   * consolidates them under `.peaks/_runtime/<sid>/<role>/`. Any
   * leftover per-change-id top-level dir is a regression to flag.
   * Slice 008's migration will consolidate these; until then, the
   * check reports them as `ok: false`.
   *
   * Optional in the type for back-compat with test probes that
   * pre-date the slice 007 broadening; the check itself falls back
   * to an empty array when the field is missing.
   */
  perChangeIdDirs?: string[];
};

export type WorkspaceLayoutProbe = () => WorkspaceLayoutInspection;

/**
 * 2026-06-10 — `gateguard-fact-force` (a third-party PreToolUse hook,
 * NOT peaks-cli) fires on Edit / Write and demands a 4-fact questionnaire
 * before allowing the edit. When the LLM is in a peaks-qa flow and tries
 * to update `.peaks/_runtime/<sid>/qa/requests/*.md` via the Edit/Write
 * tool, the hook demands facts that are inapplicable to QA envelope
 * templates (no importers, no public API, no data files, user
 * instruction already in the conversation context). The check detects
 * this hook in the user's global and project `.claude/settings.json` and
 * warns when no `.peaks/**` skip is configured. The probe is injected so
 * tests do not depend on the real `~/.claude/settings.json` state.
 */
export type GateguardHookLocation = {
  /** Source file the hook was discovered in (`global` or `project .claude/settings.json`). */
  source: 'global' | 'project';
  /** Resolved absolute path to the source file (for the message). */
  sourcePath: string;
  /** The PreToolUse entry that contains a gateguard hook command. */
  entry: {
    matcher?: string;
    hooks: ReadonlyArray<{ type?: string; command?: string }>;
  };
};

export type GateguardProbeResult = {
  /** Absolute path to `~/.claude/settings.json` (or null when the probe could not resolve it). */
  globalSettingsPath: string | null;
  /** Parsed global settings payload (or null when missing / unreadable / malformed). */
  globalSettings: unknown;
  /** Absolute path to the project `.claude/settings.json` (or null when the project root is not in a peaks project). */
  projectSettingsPath: string | null;
  /** Parsed project settings payload (or null when missing / unreadable / malformed). */
  projectSettings: unknown;
};

export type GateguardProbe = () => GateguardProbeResult;

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
  /** Injected for the build:dist-version-matches-source check (defaults to compareDistVersion on disk). */
  distVersionProbe?: DistVersionProbe;
  /** Injected for the build:workspace-layout-canonical check (defaults to inspectWorkspaceLayout on disk). */
  workspaceLayoutProbe?: WorkspaceLayoutProbe;
  /** Injected for the integration:gateguard-peaks-conflict check (defaults to defaultGateguardProbe on disk). */
  gateguardProbe?: GateguardProbe;
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

/**
 * Pure helper that compares the published dist `CLI_VERSION` against the
 * source-of-truth `package.json#version`. Default readers fail-soft to `null`
 * on missing/unreadable/malformed input. Exported so tests can drive the
 * filesystem reads without monkey-patching `process.cwd()`.
 */
export function compareDistVersion(opts: {
  projectRoot: string;
  distVersionReader?: (root: string) => string | null;
  sourceVersionReader?: (root: string) => string | null;
}): DistVersionComparison {
  const distReader = opts.distVersionReader ?? defaultDistVersionReader;
  const sourceReader = opts.sourceVersionReader ?? defaultSourceVersionReader;
  const dist = safeRead(() => distReader(opts.projectRoot));
  const source = safeRead(() => sourceReader(opts.projectRoot)) ?? 'unknown';
  const distReadable = dist !== null;
  return {
    dist,
    source,
    match: distReadable && dist === source,
    distReadable
  };
}

function safeRead(reader: () => string | null): string | null {
  try {
    return reader();
  } catch {
    return null;
  }
}

function defaultDistVersionReader(projectRoot: string): string | null {
  // Synchronous read is fine: the dist version.js is small and on the
  // local build pipeline's hot path. readFileSync + regex is cheaper
  // than pulling in fs/promises for a single short file.
  const distPath = join(projectRoot, 'dist', 'src', 'shared', 'version.js');
  if (!existsSync(distPath)) {
    return null;
  }
  const body = readFileSync(distPath, 'utf8');
  const match = /export\s+const\s+CLI_VERSION\s*=\s*["']([^"']+)["']/.exec(body);
  return match?.[1] ?? null;
}

function defaultSourceVersionReader(projectRoot: string): string | null {
  const pkgPath = join(projectRoot, 'package.json');
  if (!existsSync(pkgPath)) {
    return null;
  }
  const body = readFileSync(pkgPath, 'utf8');
  const parsed = JSON.parse(body) as { version?: unknown };
  return typeof parsed.version === 'string' ? parsed.version : null;
}

function defaultDistVersionProbe(): DistVersionComparison {
  const projectRoot = findProjectRoot(process.cwd());
  if (projectRoot === null) {
    return { dist: null, source: 'unknown', match: false, distReadable: false };
  }
  return compareDistVersion({ projectRoot });
}

/**
 * Pure helper that inspects the on-disk workspace layout for
 * post-F3-canonical violations. The post-F3 canonical layout puts
 * session dirs under `.peaks/_runtime/<sid>/` and the runtime
 * binding at `.peaks/_runtime/session.json`; the legacy paths
 * (top-level `<YYYY-MM-DD-session-<hex>>/` dirs and the legacy
 * top-level `.peaks/.session.json` / `.peaks/.active-skill.json`
 * dotfiles) must be absent. This helper is exported so tests can
 * drive the filesystem walk without monkey-patching `process.cwd()`
 * or `findProjectRoot`.
 *
 * Both scanners fail-soft (return `[]` on read errors) so a flaky
 * filesystem read on a non-fatal probe path never escalates into a
 * doctor failure.
 */
export function inspectWorkspaceLayout(opts: {
  projectRoot: string;
  topLevelScanner?: (root: string) => string[];
  dotfileScanner?: (root: string) => string[];
  perChangeIdScanner?: (root: string) => string[];
}): WorkspaceLayoutInspection {
  const topLevel = opts.topLevelScanner ?? defaultTopLevelSessionDirScanner;
  const dotfiles = opts.dotfileScanner ?? defaultLegacyDotfileScanner;
  const perChangeId = opts.perChangeIdScanner ?? defaultPerChangeIdDirScanner;
  return {
    topLevelSessionDirs: safeList(() => topLevel(opts.projectRoot)),
    legacyDotfiles: safeList(() => dotfiles(opts.projectRoot)),
    perChangeIdDirs: safeList(() => perChangeId(opts.projectRoot))
  };
}

function safeList(reader: () => string[]): string[] {
  try {
    const out = reader();
    return Array.isArray(out) ? out : [];
  } catch {
    return [];
  }
}

const SESSION_DIR_PATTERN = /^\d{4}-\d{2}-\d{2}-session-[a-f0-9]+$/;

function defaultTopLevelSessionDirScanner(projectRoot: string): string[] {
  const peaksRoot = join(projectRoot, '.peaks');
  if (!existsSync(peaksRoot)) return [];
  let names: string[];
  try {
    names = readdirSync(peaksRoot);
  } catch {
    return [];
  }
  const offenders: string[] = [];
  for (const name of names) {
    if (!SESSION_DIR_PATTERN.test(name)) continue;
    const full = join(peaksRoot, name);
    try {
      const stat = existsSync(full) ? lstatSync(full) : null;
      if (stat === null) continue;
      // Directories only — the regex should never match a dotfile or
      // regular file, but be defensive against weird filesystem state
      // (e.g. someone manually created a file whose name happens to
      // match the session-id pattern).
      if (stat.isDirectory()) {
        offenders.push(join('.peaks', name) + '/');
      }
    } catch {
      continue;
    }
  }
  return offenders;
}

const LEGACY_DOTFILES: ReadonlyArray<string> = ['.session.json', '.active-skill.json'];

function defaultLegacyDotfileScanner(projectRoot: string): string[] {
  const peaksRoot = join(projectRoot, '.peaks');
  if (!existsSync(peaksRoot)) return [];
  const offenders: string[] = [];
  for (const name of LEGACY_DOTFILES) {
    if (existsSync(join(peaksRoot, name))) {
      offenders.push(join('.peaks', name));
    }
  }
  return offenders;
}

function defaultWorkspaceLayoutProbe(): WorkspaceLayoutInspection {
  const projectRoot = findProjectRoot(process.cwd());
  if (projectRoot === null) {
    return { topLevelSessionDirs: [], legacyDotfiles: [], perChangeIdDirs: [] };
  }
  return inspectWorkspaceLayout({ projectRoot });
}

// Slice 007 — per-change-id top-level dir pattern. Matches the
// F3-canonical (pre-canonicalization) layout the 5 already-shipped
// slices left behind, e.g. `.peaks/001-2026-06-06-doctor-dist-version-check/`.
// The pattern is intentionally narrow so it does NOT match the
// post-F3 system dirs (`_runtime/`, `_dogfood/`, `retrospective/`,
// `issues/`, `memory/`, `perf-baseline/`, `project-scan/`, `sops/`,
// `0NN-session-...`, `YYYY-MM-DD-session-...`).
const PER_CHANGE_ID_PATTERN = /^\d{3}-\d{4}-\d{2}-\d{2}-[a-z][a-z0-9-]*[a-z0-9]$/;

function defaultPerChangeIdDirScanner(projectRoot: string): string[] {
  const peaksRoot = join(projectRoot, '.peaks');
  if (!existsSync(peaksRoot)) return [];
  let names: string[];
  try {
    names = readdirSync(peaksRoot);
  } catch {
    return [];
  }
  const offenders: string[] = [];
  for (const name of names) {
    if (!PER_CHANGE_ID_PATTERN.test(name)) continue;
    const full = join(peaksRoot, name);
    try {
      const stat = existsSync(full) ? lstatSync(full) : null;
      if (stat === null) continue;
      // Directories only — the regex should never match a dotfile
      // or regular file, but be defensive against weird filesystem
      // state (e.g. someone manually created a file whose name
      // happens to match the per-change-id pattern).
      if (stat.isDirectory()) {
        offenders.push(join('.peaks', name) + '/');
      }
    } catch {
      continue;
    }
  }
  return offenders;
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

// ---------------------------------------------------------------------------
// 2026-06-10 — gateguard-fact-force integration check (NOT a peaks-cli hook).
//
// The `gateguard-fact-force` hook is a third-party PreToolUse hook that
// fires on Edit / Write / MultiEdit and demands a 4-fact questionnaire
// before allowing the edit. It is unrelated to peaks-cli, but when the
// LLM is in a peaks-qa flow and edits `.peaks/_runtime/<sid>/qa/requests/
// *.md`, the questionnaire demands facts that do not apply (no
// importers, no public API, no data files, user instruction already
// in the conversation context). The check below detects the hook in
// `~/.claude/settings.json` and the project `.claude/settings.json`,
// and warns when no `.peaks/**` skip is configured.
//
// Probing is split out of the check so the check itself stays a pure
// mapping over `GateguardProbeResult`. Tests inject the probe to keep
// `~/.claude/settings.json` from leaking into test fixtures.
// ---------------------------------------------------------------------------

/** Hook command fragments that identify the gateguard-fact-force hook. */
const GATEGUARD_HOOK_NEEDLES: ReadonlyArray<string> = ['gateguard', 'fact-force', 'fact_force'];

/** Token the gateguard hook exposes for "skip these paths" — the check
 *  treats any match against `.peaks` (path or globs) as a routed
 *  configuration. We accept a few common spellings because the third-
 *  party hook's CLI surface is not part of peaks-cli's contract. */
const GATEGUARD_PEAKS_SKIP_NEEDLES: ReadonlyArray<string> = [
  '.peaks',
  'peaks-skip',
  'skip-glob',
  '--skip',
  'skip_paths'
];

function commandMentionsGateguard(command: string | undefined): boolean {
  if (typeof command !== 'string' || command.length === 0) return false;
  const lower = command.toLowerCase();
  return GATEGUARD_HOOK_NEEDLES.some((needle) => lower.includes(needle));
}

function entrySkipsPeaks(entry: GateguardHookLocation['entry']): boolean {
  const matcher = typeof entry.matcher === 'string' ? entry.matcher : '';
  const matcherMentionsPeaks = matcher.toLowerCase().includes('.peaks');
  if (matcherMentionsPeaks) return true;
  for (const hook of entry.hooks) {
    const command = typeof hook.command === 'string' ? hook.command : '';
    const lower = command.toLowerCase();
    if (GATEGUARD_PEAKS_SKIP_NEEDLES.some((needle) => lower.includes(needle))) {
      return true;
    }
  }
  return false;
}

function extractGateguardEntries(
  source: 'global' | 'project',
  sourcePath: string,
  settings: unknown
): GateguardHookLocation[] {
  if (settings === null || typeof settings !== 'object') return [];
  const hooks = (settings as { hooks?: unknown }).hooks;
  if (hooks === null || typeof hooks !== 'object') return [];
  const preToolUse = (hooks as { PreToolUse?: unknown }).PreToolUse;
  if (!Array.isArray(preToolUse)) return [];

  const out: GateguardHookLocation[] = [];
  for (const rawEntry of preToolUse) {
    if (rawEntry === null || typeof rawEntry !== 'object') continue;
    const entry = rawEntry as {
      matcher?: unknown;
      hooks?: unknown;
    };
    if (!Array.isArray(entry.hooks)) continue;
    const hooks: Array<{ type?: string; command?: string }> = [];
    for (const rawHook of entry.hooks) {
      if (rawHook === null || typeof rawHook !== 'object') continue;
      const h = rawHook as { type?: unknown; command?: unknown };
      const hookEntry: { type?: string; command?: string } = {};
      if (typeof h.type === 'string') hookEntry.type = h.type;
      if (typeof h.command === 'string') hookEntry.command = h.command;
      hooks.push(hookEntry);
    }
    if (!hooks.some((h) => commandMentionsGateguard(h.command))) continue;
    const outEntry: {
      matcher?: string;
      hooks: ReadonlyArray<{ type?: string; command?: string }>;
    } = { hooks };
    if (typeof entry.matcher === 'string') outEntry.matcher = entry.matcher;
    out.push({ source, sourcePath, entry: outEntry });
  }
  return out;
}

function readSettingsJson(path: string): unknown {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function defaultGateguardProbe(): GateguardProbeResult {
  const projectRoot = findProjectRoot(process.cwd());
  const globalPath = join(homedir(), '.claude', 'settings.json');
  const projectPath = projectRoot === null ? null : join(projectRoot, '.claude', 'settings.json');

  return {
    globalSettingsPath: globalPath,
    globalSettings: readSettingsJson(globalPath),
    projectSettingsPath: projectPath,
    projectSettings: projectPath === null ? null : readSettingsJson(projectPath)
  };
}

export function collectGateguardEntries(probe: GateguardProbeResult): GateguardHookLocation[] {
  const fromGlobal = extractGateguardEntries('global', probe.globalSettingsPath ?? '~/.claude/settings.json', probe.globalSettings);
  const fromProject = probe.projectSettingsPath === null
    ? []
    : extractGateguardEntries('project', probe.projectSettingsPath, probe.projectSettings);
  return [...fromGlobal, ...fromProject];
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

  // Build-hygiene check: the published `dist/` ships a different CLI_VERSION
  // than the source-of-truth `src/shared/version.ts` / `package.json#version`
  // whenever the user runs `npx peaks` or `node bin/peaks.js` after `pnpm
  // install` but before `pnpm build`. This is the silent-stale-CLI failure
  // mode reported in `.peaks/2026-06-05-session-fecddb/txt/dogfood-2026-06-04-05.md`
  // (F1). A missing dist/ is treated as informational (fresh clone, not broken)
  // so the check does not flip the summary to red on a clean checkout.
  const distProbe = options.distVersionProbe ?? defaultDistVersionProbe;
  try {
    const result = distProbe();
    if (!result.distReadable) {
      checks.push({
        id: 'build:dist-version-matches-source',
        ok: true,
        message: `dist/ is not present; run \`pnpm build\` to populate dist/src/shared/version.js (source version ${result.source})`
      });
    } else if (result.match) {
      checks.push({
        id: 'build:dist-version-matches-source',
        ok: true,
        message: `dist/src/shared/version.js ships CLI_VERSION ${result.dist} matching source ${result.source}`
      });
    } else {
      checks.push({
        id: 'build:dist-version-matches-source',
        ok: false,
        message: `dist/src/shared/version.js ships CLI_VERSION ${result.dist} but source ${result.source} is in src/shared/version.ts; run \`pnpm build\` to refresh dist/`
      });
    }
  } catch (error) {
    checks.push({
      id: 'build:dist-version-matches-source',
      ok: false,
      message: `dist version check failed: ${getErrorMessage(error)}`
    });
  }

  // Build-hygiene check: a non-canonical post-F3 workspace layout is
  // the silent-regression failure mode that slice 003 explicitly chose
  // to allow (the current session binding was kept at top-level as a
  // safety measure). This check surfaces any leftover top-level
  // session dirs, the legacy runtime dotfiles (`.peaks/.session.json`,
  // `.peaks/.active-skill.json`), OR per-change-id top-level dirs
  // (`.peaks/NNN-YYYY-MM-DD-<slug>/`) so a future contributor who
  // manually recreates one of them is warned. The check is read-only;
  // the fix path is `peaks workspace migrate --to-runtime --project
  // <repo> --apply`.
  //
  // Slice 007 broadened this check to flag per-change-id top-level
  // dirs (the 5 already-shipped slices left them behind). Until
  // slice 008's migration consolidates them, the check reports
  // `ok: false` for any repo that still has the legacy per-change-id
  // layout.
  const layoutProbe = options.workspaceLayoutProbe ?? defaultWorkspaceLayoutProbe;
  try {
    const layout = layoutProbe();
    // Back-compat: probes injected by older tests (pre-slice-007)
    // return a 2-field shape (no perChangeIdDirs). Treat missing
    // field as empty.
    const perChangeIdDirs = layout.perChangeIdDirs ?? [];
    if (layout.topLevelSessionDirs.length === 0 && layout.legacyDotfiles.length === 0 && perChangeIdDirs.length === 0) {
      checks.push({
        id: 'build:workspace-layout-canonical',
        ok: true,
        message: 'Workspace layout is canonical: no top-level session dirs, no legacy runtime dotfiles, no per-change-id top-level dirs'
      });
    } else {
      const offenders = [
        ...layout.topLevelSessionDirs.map((p) => `top-level session dir: ${p}`),
        ...layout.legacyDotfiles.map((p) => `legacy dotfile: ${p}`),
        ...perChangeIdDirs.map((p) => `per-change-id top-level dir: ${p}`)
      ];
      checks.push({
        id: 'build:workspace-layout-canonical',
        ok: false,
        message: `Workspace layout is not canonical. Offenders: ${offenders.join('; ')}. Run \`peaks workspace migrate --to-runtime --project <repo> --apply\` to consolidate.`
      });
    }
  } catch (error) {
    checks.push({
      id: 'build:workspace-layout-canonical',
      ok: false,
      message: `Workspace layout check failed: ${getErrorMessage(error)}`
    });
  }

  // 2026-06-10 — gateguard-fact-force integration check. The hook is a
  // third-party PreToolUse that fires on Edit / Write and demands a
  // 4-fact questionnaire; when the LLM is in a peaks-qa flow updating
  // `.peaks/_runtime/<sid>/qa/requests/*.md` the facts do not apply.
  // We warn when the hook is installed and no `.peaks/**` skip is
  // configured. The check stays a pure mapping over the probe result
  // so tests can drive it without touching the real `~/.claude/`.
  const gateguardProbe = options.gateguardProbe ?? defaultGateguardProbe;
  try {
    const probe = gateguardProbe();
    const offending = collectGateguardEntries(probe);
    if (offending.length === 0) {
      checks.push({
        id: 'integration:gateguard-peaks-conflict',
        ok: true,
        message:
          'No gateguard-fact-force PreToolUse hook detected in ~/.claude/settings.json or project .claude/settings.json; the Edit/Write fact-forcing flow will not interfere with peaks-qa .peaks/ artifact writes'
      });
    } else {
      const unrouted = offending.filter((location) => !entrySkipsPeaks(location.entry));
      if (unrouted.length === 0) {
        checks.push({
          id: 'integration:gateguard-peaks-conflict',
          ok: true,
          message:
            `gateguard-fact-force hook is installed in ${offending.map((l) => l.source).join(' + ')} but a .peaks/** skip pattern is configured; peaks-qa .peaks/ artifact writes are not blocked`
        });
      } else {
        const sources = Array.from(new Set(unrouted.map((u) => u.sourcePath))).join(' + ');
        const matchers = unrouted.map((u) => u.entry.matcher ?? '*').join(', ');
        checks.push({
          id: 'integration:gateguard-peaks-conflict',
          ok: false,
          message:
            `gateguard-fact-force PreToolUse hook is installed (${sources}, matcher: ${matchers}) with no .peaks/** skip pattern; every Edit/Write of a peaks-qa envelope (.peaks/_runtime/<sid>/qa/requests/*.md) will be intercepted and demand a 4-fact questionnaire that does not apply to QA templates. Workaround: set \`ECC_DISABLED_HOOKS=pre:edit-write:gateguard-fact-force\` for the session, OR add a paired PreToolUse entry whose matcher restricts the hook to non-.peaks paths. peaks-cli is NOT the source of this hook.`
        });
      }
    }
  } catch (error) {
    checks.push({
      id: 'integration:gateguard-peaks-conflict',
      ok: true,
      message: `gateguard probe failed (${getErrorMessage(error)}); skipping check`
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

  // Slice L3.2: project doctor MVP — 2 new diagnostic checks.
  //   1. L3:l3-orphan-sessions — flags bare sids in .peaks/_runtime/ that
  //      fail isValidSessionId. Reuses the Slice 0.5 sid-naming-guard.
  //   2. L3:l3-memory-health — verifies .peaks/memory/index.json is
  //      well-formed JSON with the expected schema_version field and
  //      references real files on disk.
  // Slice L3.2: project doctor MVP — 2 new diagnostic checks.
  //   1. L3:l3-orphan-sessions — flags bare sids in .peaks/_runtime/ that
  //      fail isValidSessionId. Reuses the Slice 0.5 sid-naming-guard.
  //   2. L3:l3-memory-health — verifies .peaks/memory/index.json is
  //      well-formed JSON with the expected schema_version field and
  //      references real files on disk.
  const l3ProjectRoot = findProjectRoot(process.cwd()) ?? process.cwd();
  try {
    const runtimeDir = join(l3ProjectRoot, '.peaks/_runtime');
    if (existsSync(runtimeDir)) {
      const entries = readdirSync(runtimeDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
      const validSids = entries.filter((sid) => isValidSessionId(sid));
      const invalidSids = entries.filter((sid) => !isValidSessionId(sid));
      checks.push({
        id: 'L3:l3-orphan-sessions',
        ok: invalidSids.length === 0,
        message: invalidSids.length === 0
          ? `All ${validSids.length} session(s) under .peaks/_runtime/ are valid (isValidSessionId)`
          : `${invalidSids.length} orphan session(s) under .peaks/_runtime/ fail isValidSessionId: ${invalidSids.slice(0, 5).join(', ')}${invalidSids.length > 5 ? '...' : ''}. Run \`peaks workspace clean --project <repo>\` to archive.`
      });
    } else {
      checks.push({
        id: 'L3:l3-orphan-sessions',
        ok: true,
        message: 'No .peaks/_runtime/ directory; nothing to check.'
      });
    }
  } catch (error) {
    checks.push({
      id: 'L3:l3-orphan-sessions',
      ok: true,
      message: `L3:l3-orphan-sessions probe failed (${getErrorMessage(error)}); skipping check`
    });
  }

  try {
    const memoryIndexPath = join(l3ProjectRoot, '.peaks/memory/index.json');
    if (existsSync(memoryIndexPath)) {
      const raw = readFileSync(memoryIndexPath, 'utf8');
      try {
        const parsed = JSON.parse(raw) as { schema_version?: string; entries?: unknown[] };
        if (parsed.schema_version === undefined) {
          checks.push({
            id: 'L3:l3-memory-health',
            ok: false,
            message: '.peaks/memory/index.json missing schema_version field'
          });
        } else if (!Array.isArray(parsed.entries)) {
          checks.push({
            id: 'L3:l3-memory-health',
            ok: false,
            message: '.peaks/memory/index.json entries is not an array'
          });
        } else {
          checks.push({
            id: 'L3:l3-memory-health',
            ok: true,
            message: `.peaks/memory/index.json is well-formed JSON; schema_version=${parsed.schema_version}; ${parsed.entries.length} memory entries`
          });
        }
      } catch (parseError) {
        checks.push({
          id: 'L3:l3-memory-health',
          ok: false,
          message: `.peaks/memory/index.json is not valid JSON: ${getErrorMessage(parseError)}`
        });
      }
    } else {
      checks.push({
        id: 'L3:l3-memory-health',
        ok: true,
        message: 'No .peaks/memory/index.json yet (no memories extracted)'
      });
    }
  } catch (error) {
    checks.push({
      id: 'L3:l3-memory-health',
      ok: true,
      message: `L3:l3-memory-health probe failed (${getErrorMessage(error)}); skipping check`
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
