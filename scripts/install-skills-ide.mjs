// scripts/install-skills-ide.mjs
//
// Who is installed FOR, and where each one keeps its assets. The profile table bakes
// `homedir()` at module load, so a caller that redirects `$HOME`/$`USERPROFILE` must do it
// BEFORE this module is imported.
//
// Split out of `scripts/install-skills.mjs` (rid-043). Every line below was moved
// VERBATIM from that file; only this header, the import block, and the `export`
// keyword on names a sibling imports are new.

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export function resolveProjectRoot(options) {
  const projectRoot = options.projectRoot ?? process.env.PEAKS_PROJECT_ROOT ?? process.env.INIT_CWD;
  return projectRoot ? resolve(projectRoot) : null;
}

/**
 * Slice #011: Detect the installed IDE for the postinstall dispatch layer.
 *
 * Mirrors `src/services/ide/ide-detector.ts:detectInstalledIde` (cwd heuristic)
 * but inlined here because `install-skills.mjs` is a plain `.mjs` script and
 * cannot import the TS service at runtime. The dispatch:
 *   - Look for `.claude`, `.trae`, `.codex`, `.cursor`, `.qoder`,
 *     `.tongyi-lingma` in the project root in that insertion order
 *     (matches the registry's adapter order in `src/services/ide/ide-registry.ts`).
 *   - Returns the first match, or `null` if no adapter's directory is present.
 *
 * If the resolved IDE has no `skillInstall` declared (Trae in slice 1.3.2),
 * the caller falls back to the legacy `~/.claude/{skills,output-styles}` path
 * + emits a stderr warning. The dispatch is conservative: the env-var
 * overrides `PEAKS_CLAUDE_SKILLS_DIR` / `PEAKS_CLAUDE_OUTPUT_STYLES_DIR`
 * continue to work, and the legacy default is preserved.
 *
 * 2026-09-15 (D12 fix): `hermes` and `openclaw` have install profiles in
 * `IDE_SKILL_INSTALL_PROFILES` but were absent from this table. A profile
 * that no detector can ever return is reachable only through the
 * every-platform fan-out — i.e. it is installed for users who do NOT have
 * the tool and skipped for nobody. Both are listed here now, so detection
 * and installation answer the same question with the same table.
 *
 * This table is ALSO the presence oracle for `isPlatformPresent` below: a
 * directory here in the project root means the user has that tool.
 */
export const IDE_DETECTION_DIRS = [
  { id: 'claude-code', dir: '.claude' },
  { id: 'trae', dir: '.trae' },
  { id: 'trae-cn', dir: '.trae-cn' },
  { id: 'codex', dir: '.codex' },
  { id: 'cursor', dir: '.cursor' },
  { id: 'qoder', dir: '.qoder' },
  { id: 'tongyi-lingma', dir: '.tongyi-lingma' },
  { id: 'zcode', dir: '.zcode' },
  { id: 'hermes', dir: '.hermes' },
  { id: 'openclaw', dir: '.openclaw' }
];

/**
 * Per-IDE skill install paths. Per peaks-loop tenet
 * "minimal-user-operation" (2026-06-11), the user should
 * never have to run a per-platform install command — the
 * `npm i -g peaks-loop` postinstall iterates the platforms
 * the user HAS and symlinks the peaks-* skill family into each
 * (see `isPlatformPresent`; D9/2026-09-15 made "has" load-bearing).
 *
 * 1.x had only `claude-code` (the other 5 entries were
 * `null`); real Trae users reported the Trae skill
 * directory was never populated. 2.0 fixes this by giving
 * every platform a canonical install path.
 */
export const IDE_SKILL_INSTALL_PROFILES = {
  'claude-code': {
    // `alwaysPresent` — see `isPlatformPresent`. Declared HERE, in the
    // vendor's own row, rather than as an `ideId === 'claude-code'` branch in
    // the consumer: the guard at
    // `tests/unit/runtime/vendor-neutral-identity-guard.test.ts` pins identity
    // DECISIONS to the vendor declarations, and a comparison in the consumer
    // is exactly the re-injection shape it exists to catch. A future vendor
    // opts into the same policy by setting this field.
    alwaysPresent: true,
    skillsDir: join(homedir(), '.claude', 'skills'),
    outputStylesDir: join(homedir(), '.claude', 'output-styles'),
    agentsDir: join(homedir(), '.claude', 'agents'),
    envVar: 'PEAKS_CLAUDE_SKILLS_DIR',
    outputStylesEnvVar: 'PEAKS_CLAUDE_OUTPUT_STYLES_DIR',
    agentsEnvVar: 'PEAKS_CLAUDE_AGENTS_DIR'
  },
  trae: {
    skillsDir: join(homedir(), '.trae', 'skills'),
    outputStylesDir: join(homedir(), '.trae', 'output-styles'),
    agentsDir: join(homedir(), '.trae', 'agents'),
    envVar: 'PEAKS_TRAE_SKILLS_DIR',
    outputStylesEnvVar: 'PEAKS_TRAE_OUTPUT_STYLES_DIR',
    agentsEnvVar: 'PEAKS_TRAE_AGENTS_DIR'
  },
  'trae-cn': {
    skillsDir: join(homedir(), '.trae-cn', 'skills'),
    outputStylesDir: join(homedir(), '.trae-cn', 'output-styles'),
    agentsDir: join(homedir(), '.trae-cn', 'agents'),
    envVar: 'PEAKS_TRAE_CN_SKILLS_DIR',
    outputStylesEnvVar: 'PEAKS_TRAE_CN_OUTPUT_STYLES_DIR',
    agentsEnvVar: 'PEAKS_TRAE_CN_AGENTS_DIR'
  },
  codex: {
    skillsDir: join(homedir(), '.codex', 'skills'),
    outputStylesDir: join(homedir(), '.codex', 'output-styles'),
    agentsDir: join(homedir(), '.codex', 'agents'),
    envVar: 'PEAKS_CODEX_SKILLS_DIR',
    outputStylesEnvVar: 'PEAKS_CODEX_OUTPUT_STYLES_DIR',
    agentsEnvVar: 'PEAKS_CODEX_AGENTS_DIR'
  },
  cursor: {
    skillsDir: join(homedir(), '.cursor', 'skills'),
    outputStylesDir: join(homedir(), '.cursor', 'output-styles'),
    agentsDir: join(homedir(), '.cursor', 'agents'),
    envVar: 'PEAKS_CURSOR_SKILLS_DIR',
    outputStylesEnvVar: 'PEAKS_CURSOR_OUTPUT_STYLES_DIR',
    agentsEnvVar: 'PEAKS_CURSOR_AGENTS_DIR'
  },
  qoder: {
    skillsDir: join(homedir(), '.qoder', 'skills'),
    outputStylesDir: join(homedir(), '.qoder', 'output-styles'),
    envVar: 'PEAKS_QODER_SKILLS_DIR',
    outputStylesEnvVar: 'PEAKS_QODER_OUTPUT_STYLES_DIR'
  },
  'tongyi-lingma': {
    skillsDir: join(homedir(), '.tongyi-lingma', 'skills'),
    outputStylesDir: join(homedir(), '.tongyi-lingma', 'output-styles'),
    envVar: 'PEAKS_TONGYI_SKILLS_DIR',
    outputStylesEnvVar: 'PEAKS_TONGYI_OUTPUT_STYLES_DIR'
  },
  hermes: {
    skillsDir: join(homedir(), '.hermes', 'skills'),
    outputStylesDir: join(homedir(), '.hermes', 'output-styles'),
    envVar: 'PEAKS_HERMES_SKILLS_DIR',
    outputStylesEnvVar: 'PEAKS_HERMES_OUTPUT_STYLES_DIR'
  },
  openclaw: {
    skillsDir: join(homedir(), '.openclaw', 'skills'),
    outputStylesDir: join(homedir(), '.openclaw', 'output-styles'),
    envVar: 'PEAKS_OPENCLAW_SKILLS_DIR',
    outputStylesEnvVar: 'PEAKS_OPENCLAW_OUTPUT_STYLES_DIR'
  },
  zcode: {
    skillsDir: join(homedir(), '.zcode', 'skills'),
    outputStylesDir: join(homedir(), '.zcode', 'output-styles'),
    agentsDir: join(homedir(), '.zcode', 'agents'),
    envVar: 'PEAKS_ZCODE_SKILLS_DIR',
    outputStylesEnvVar: 'PEAKS_ZCODE_OUTPUT_STYLES_DIR',
    agentsEnvVar: 'PEAKS_ZCODE_AGENTS_DIR'
  }
};

export function detectInstalledIdeId(projectRoot) {
  if (!projectRoot) return null;
  for (const { id, dir } of IDE_DETECTION_DIRS) {
    if (existsSync(join(projectRoot, dir))) {
      return id;
    }
  }
  return null;
}

export function resolveIdeSkillInstallProfile(ideId) {
  if (ideId === null) return null;
  return IDE_SKILL_INSTALL_PROFILES[ideId] ?? null;
}

/**
 * Is this platform actually installed FOR? (D9 fix, 2026-09-15.)
 *
 * Before this gate, the postinstall ran `mkdirSync(targetRoot, {recursive:
 * true})` for ALL 10 profiles unconditionally, so `npm i -g peaks-loop` created
 * `~/.hermes`, `~/.openclaw`, `~/.qoder`, `~/.tongyi-lingma` and `~/.zcode` in
 * the home of a user who has never installed those tools. The peaks-loop tenet
 * is "the user never has to run a per-platform install command" — it is NOT
 * "peaks-loop guesses which tools you have". Creating a directory for a tool
 * the user does not own is the tenet misread, and it is visible on disk.
 *
 * Present means EITHER:
 *   - the tool's marker directory exists in the project root (the same
 *     directory `detectInstalledIdeId` consults above), OR
 *   - the tool's own home directory (`~/.<tool>`, derived from its profile)
 *     already exists on this machine.
 *
 * `claude-code` is unconditionally present: it is peaks-loop's primary runtime
 * and the documented legacy install target, so a machine with no `~/.claude`
 * yet still gets the trees the user is installing peaks-loop for. That fact is
 * declared as `alwaysPresent: true` IN THE VENDOR'S OWN PROFILE ROW — not as an
 * `ideId === 'claude-code'` branch here. This file sits outside the adapter
 * layer, so an identity comparison in it is the re-injection shape
 * `tests/unit/runtime/vendor-neutral-identity-guard.test.ts` pins; reading the
 * vendor's declaration keeps the policy in one place and vendor-neutral.
 *
 * A named target bypasses this gate entirely — `options.targetRoot`,
 * `options.ideId`, and the `PEAKS_<TOOL>_SKILLS_DIR` env vars are callers who
 * have already said which platform they mean; guessing a second time there
 * would break the 1.x back-compat contract that slice 2026-06-12 restored.
 */
export function isPlatformPresent(ideId, profile, projectRoot) {
  if (profile.alwaysPresent === true) return true;
  const detection = IDE_DETECTION_DIRS.find((entry) => entry.id === ideId);
  if (
    detection !== undefined &&
    projectRoot !== null &&
    existsSync(join(projectRoot, detection.dir))
  ) {
    return true;
  }
  return existsSync(dirname(profile.skillsDir));
}

export function warnUnverifiedIde(ideId, projectRoot) {
  process.stderr.write(
    `peaks install-skills: IDE '${ideId}' has no skillInstall profile declared; ` +
      `falling back to the legacy Claude Code path (~/.claude/skills + ~/.claude/output-styles) ` +
      `for project '${projectRoot}'. This is a slice #011 follow-up gap; ` +
      `see .peaks/memory/ide-adapter-resource-profile-framework.md.\n`
  );
}

export function warnNoIdeDetected(projectRoot) {
  process.stderr.write(
    `peaks install-skills: no IDE detected in '${projectRoot ?? '(project root unknown)'}'; ` +
      `installing to the legacy Claude Code path (~/.claude/skills + ~/.claude/output-styles). ` +
      `Set PEAKS_CLAUDE_SKILLS_DIR / PEAKS_CLAUDE_OUTPUT_STYLES_DIR to override.\n`
  );
}

/**
 * THE ONE DISPATCH PRECEDENCE — the three families that resolve a target root
 * (skills, agents, output-styles) each stated it separately before rid-043. Highest
 * first:
 *
 *   1. explicit `options.targetRoot`              (test / hook override)
 *   2. `options.ideId`'s `spec.profileField`      (per-IDE dispatch)
 *   3. `spec.envVar`                              (legacy 1.x back-compat)
 *   4. the DETECTED ide's `spec.profileField`     (auto-detect from projectRoot)
 *   5. `join(homedir(), spec.fallback)`           (no-IDE fallback)
 *
 * `spec.warn` is the ONE declared difference between the callers, and it is a field
 * rather than a branch at each call site: the SKILLS installer is the only family
 * that tells the user an IDE was seen without a profile, or that none was seen at
 * all. Output styles and agents resolve identically in silence.
 *
 * The two warn arms are mutually exclusive (`detectedIdeId` cannot be both null and
 * non-null), so the `else if` below is the same set of messages the two separate
 * `if`s produced.
 *
 * @param {Record<string, unknown>} options
 * @param {{ profileField: string, envVar: string, fallback: string, warn?: boolean }} spec
 * @returns {string} the resolved, absolute target root
 */
export function resolveBundleTargetRoot(options, spec) {
  const projectRoot = resolveProjectRoot(options);
  const detectedIdeId = detectInstalledIdeId(projectRoot);
  const detectedProfile = resolveIdeSkillInstallProfile(detectedIdeId);

  if (spec.warn === true && options.targetRoot === undefined && options.ideId === undefined) {
    if (detectedProfile === null && detectedIdeId !== null) {
      warnUnverifiedIde(detectedIdeId, projectRoot ?? '(project root unknown)');
    } else if (detectedIdeId === null && projectRoot !== null) {
      warnNoIdeDetected(projectRoot);
    }
  }

  const profileDir = detectedProfile?.[spec.profileField] ?? null;
  return resolve(
    options.targetRoot ??
      (options.ideId !== undefined
        ? (resolveIdeSkillInstallProfile(options.ideId)?.[spec.profileField] ?? null)
        : null) ??
      process.env[spec.envVar] ??
      profileDir ??
      join(homedir(), spec.fallback)
  );
}
