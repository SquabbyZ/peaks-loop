// scripts/install-skills.mjs
//
// The npm postinstall entry. What stays HERE, and why it cannot move:
//
//   1. The two per-platform fan-outs. Their `ideId === 'claude-code'` branches are the
//      env-var override the 1.x-compat contract is written on, and they are pinned BY
//      FILE NAME by `tests/unit/runtime/vendor-neutral-identity-guard.test.ts` — moving
//      them would either drop a pinned decision or add one to a file the ratchet does
//      not know about. Their bodies are unchanged.
//   2. The CLI entry block. It identifies its own path (`import.meta.url` against
//      `process.argv[1]`), which is exactly what the module's own location means, so it
//      cannot live anywhere else.
//
// Everything else moved to a sibling by responsibility; the public surface below is a
// re-export, so no importer changes.
//
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { installBundledAgents, installBundledSkills } from './install-skills-bundles.mjs';
import {
  IDE_SKILL_INSTALL_PROFILES,
  isPlatformPresent,
  resolveProjectRoot
} from './install-skills-ide.mjs';
import { installBundledOutputStyles } from './install-skills-output-styles.mjs';
import { installBundledOutputStyleDefault } from './install-skills-output-style-default.mjs';
import { reportCopyFallbacks, reportLeftAlone } from './install-skills-report.mjs';
import { createConfigResult, installUserConfig } from './install-skills-user-config.mjs';

// THE PUBLIC SURFACE, re-exported so no importer changes. IDE_DETECTION_DIRS is
// not read here, so it is re-exported without a local binding.
export { IDE_DETECTION_DIRS } from './install-skills-ide.mjs';
export { IDE_SKILL_INSTALL_PROFILES };
export { installBundledSkills, installBundledAgents };
export { installUserConfig };
export { installBundledOutputStyles, installBundledOutputStyleDefault };

/**
 * Per-platform fan-out — iterate the platforms the user HAS and call
 * `installBundledAgents` for each one that also declares an `agentsDir`
 * profile field. 6 of the 10 profiles declare `agentsDir` today
 * (claude-code, trae, trae-cn, codex, cursor, zcode); the other 4 have no
 * sub-agent loader to write into and are skipped by construction. A future
 * platform opts in by adding `agentsDir` to its
 * `IDE_SKILL_INSTALL_PROFILES` entry.
 *
 * D9/D10 fix (2026-09-15): the platform set is filtered by
 * `isPlatformPresent` (same predicate as the skills fan-out), so this no
 * longer creates `~/.trae/agents`, `~/.codex/agents`, … for tools the user
 * does not have.
 *
 * Per peaks-loop tenet "minimal-user-operation" (2026-06-11): the user
 * should never have to run a per-platform install command. Symlink /
 * copy failures are soft (logged to stderr, never throw) so one platform's
 * failure doesn't block the others.
 */
export function installBundledAgentsForAllPlatforms(options = {}) {
  const projectRoot = resolveProjectRoot(options);
  const platforms = Object.entries(IDE_SKILL_INSTALL_PROFILES)
    .filter(([, profile]) => typeof profile.agentsDir === 'string')
    .filter(([ideId, profile]) => isPlatformPresent(ideId, profile, projectRoot));
  const perPlatform = [];
  for (const [ideId, profile] of platforms) {
    try {
      // Per-platform env-var override (claude-code only today):
      // PEAKS_CLAUDE_AGENTS_DIR. This is the same precedence as
      // installBundledSkillsForAllPlatforms (slice #011). For the
      // claude-code iteration, if the env var is set, use it as
      // `targetRoot` (so the env var takes priority over the profile).
      // For test mode, options.targetRoot also wins.
      const envOverride = ideId === 'claude-code' ? process.env.PEAKS_CLAUDE_AGENTS_DIR : undefined;
      const platformOpts =
        envOverride !== undefined && envOverride.length > 0
          ? { ...options, ideId, targetRoot: envOverride }
          : options.targetRoot !== undefined
            ? { ...options, ideId, targetRoot: options.targetRoot }
            : { ...options, ideId };
      const result = installBundledAgents(platformOpts);
      reportCopyFallbacks(`agents in ${profile.agentsDir}`, result.fallbacks);
      reportLeftAlone(`agents in ${profile.agentsDir}`, result.skipped);
      perPlatform.push({
        ideId,
        agentsDir: profile.agentsDir,
        installed: result.installed,
        skipped: result.skipped,
        fallbacks: result.fallbacks
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `peaks install-agents: ${ideId} platform failed (continuing): ${message}\n`
      );
      perPlatform.push({
        ideId,
        agentsDir: profile.agentsDir,
        installed: [],
        skipped: [],
        error: message
      });
    }
  }
  return perPlatform;
}

/**
 * Per-platform fan-out — iterate the platforms the user actually HAS and call
 * `installBundledSkills` for each. Per peaks-loop tenet
 * "minimal-user-operation" (2026-06-11): the user should
 * never have to run a per-platform install command. The
 * 1.x postinstall only handled the auto-detected single
 * IDE; 2.0 fixes this so the peaks-* skill family is
 * symlinked to every platform the user is on.
 *
 * D9/D10 fix (2026-09-15): the set is filtered by `isPlatformPresent`, not
 * "all 10 profiles". See that helper for why, and see the DISPATCH STRATEGY
 * note above `installBundledOutputStyles` for how this fan-out relates to the
 * other two dispatch paths in this file.
 *
 * Returns an array of { ideId, skillsDir, installed, skipped }
 * per platform. Symlink failures are soft (logged to stderr,
 * never throw) so one platform's failure doesn't block the
 * others.
 */
export function installBundledSkillsForAllPlatforms(options = {}) {
  const projectRoot = resolveProjectRoot(options);
  const platforms = Object.keys(IDE_SKILL_INSTALL_PROFILES).filter((ideId) =>
    isPlatformPresent(ideId, IDE_SKILL_INSTALL_PROFILES[ideId], projectRoot)
  );
  const perPlatform = [];
  // Back-compat precedence (regression fix 2026-06-12,
  // slice 2026-06-12-postinstall-1x-detector-tdd):
  // when iterating the present platforms, the claude-code install
  // must still honor the PEAKS_CLAUDE_SKILLS_DIR env var
  // (the legacy back-compat surface from 1.x). The other
  // platforms use their per-IDE profile paths unconditionally.
  // Without this fix the fan-out regresses the
  // `peaks install-skills` env-var override contract that
  // user CI / 1.x → 2.0 migration scripts depend on.
  const claudeEnv = process.env.PEAKS_CLAUDE_SKILLS_DIR;
  for (const ideId of platforms) {
    try {
      const platformOpts =
        ideId === 'claude-code' && claudeEnv !== undefined && claudeEnv.length > 0
          ? { ...options, ideId, targetRoot: claudeEnv }
          : { ...options, ideId };
      const result = installBundledSkills(platformOpts);
      perPlatform.push({
        ideId,
        skillsDir: IDE_SKILL_INSTALL_PROFILES[ideId]?.skillsDir ?? '(unknown)',
        installed: result.installed,
        skipped: result.skipped
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `peaks install-skills: ${ideId} platform failed (continuing): ${message}\n`
      );
      perPlatform.push({
        ideId,
        skillsDir: IDE_SKILL_INSTALL_PROFILES[ideId]?.skillsDir ?? '(unknown)',
        installed: [],
        skipped: [],
        error: message
      });
    }
  }
  return perPlatform;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    // 2.0 fix for the 1.x Trae bug (per real user feedback
    // 2026-06-11): iterate every platform the user HAS, not just the
    // one auto-detected in the project root. Per the
    // "minimal-user-operation" tenet, the user should never have to run a
    // per-platform install command — S6 (2026-09-15) narrowed "every" from
    // "all 10 profiles" to `isPlatformPresent`, because creating a home
    // directory for a tool the user does not own is that tenet misread.
    const perPlatform = installBundledSkillsForAllPlatforms();
    let totalInstalled = 0;
    for (const p of perPlatform) {
      totalInstalled += p.installed.length;
    }
    if (totalInstalled > 0) {
      process.stdout.write(
        `Peaks skills linked across ${perPlatform.length} platforms ` +
          `(${totalInstalled} total symlinks)\n`
      );
    }
    const outputStylesResult = installBundledOutputStyles();
    // Slice 7/7 — bundled agents (Claude Code sub-agent prompts) ship
    // under `agents/*.md` in the peaks-loop tarball and are auto-installed
    // to `~/.claude/agents/` on `npm i -g peaks-loop@latest`. Drift
    // detection is content-hash + `.peaks-managed` marker (mirrors the
    // output-styles contract).
    const agentsPerPlatform = installBundledAgentsForAllPlatforms();
    let totalAgentsInstalled = 0;
    for (const p of agentsPerPlatform) {
      totalAgentsInstalled += p.installed.length;
    }
    if (totalAgentsInstalled > 0) {
      process.stdout.write(
        `Peaks agents installed across ${agentsPerPlatform.length} platforms ` +
          `(${totalAgentsInstalled} total files)\n`
      );
    }
    let userConfigResult = createConfigResult({ skipped: true });
    try {
      userConfigResult = installUserConfig();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Peaks user config was not installed: ${message}\n`);
    }
    if (outputStylesResult.installed.length > 0) {
      process.stdout.write(
        `Peaks output styles installed: ${outputStylesResult.installed.join(', ')}\n`
      );
    }
    if (outputStylesResult.skipped.length > 0) {
      process.stderr.write(
        `Peaks output styles skipped because local files already exist: ${outputStylesResult.skipped.join(', ')}\n`
      );
    }
    reportCopyFallbacks('output styles', outputStylesResult.fallbacks);

    // Slice 2026-08-02 — auto-register bundled output style.
    //
    // After the bundled style file lands in `~/.claude/output-styles/`,
    // we also need Claude Code to actually USE it — otherwise the user
    // (real feedback 2026-08-02: fresh 0-1 project like
    // `Desktop\ticket-cross`) sees the default style in new sessions.
    //
    // This step reads `~/.claude/settings.json`, and only if the user
    // hasn't set `outputStyle` yet, writes
    // `outputStyle: 'peaks-skill-swarm'` while preserving every other
    // key. Malformed settings.json / IO errors / non-regular files are
    // soft-failed to stderr (the bundled file is already on disk, so
    // postinstall never aborts here).
    //
    // The `targetRoot` here mirrors the dispatch target of
    // `installBundledOutputStyles()` above so the env-var override
    // path (test fixtures + CI) stays consistent: if the bundled
    // style file was dispatched to an env-overridden dir, the
    // auto-register step checks THAT dir, not the user's homedir.
    try {
      const dispatchTargetRoot =
        process.env.PEAKS_CLAUDE_OUTPUT_STYLES_DIR ?? join(homedir(), '.claude', 'output-styles');
      const styleDefaultResult = installBundledOutputStyleDefault({
        targetRoot: dispatchTargetRoot
      });
      if (styleDefaultResult.installed) {
        process.stdout.write(
          `Peaks output style auto-registered: ${styleDefaultResult.outputStyle}\n` +
            `  → wrote ${styleDefaultResult.settingsPath}\n`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Peaks output style default was not installed: ${message}\n`);
    }
    if (userConfigResult.created) {
      process.stdout.write('Peaks user config created: ~/.peaks/config.json\n');
    }
    if (userConfigResult.updated) {
      process.stdout.write('Peaks user config updated: ~/.peaks/config.json\n');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Peaks skills and output styles were not installed: ${message}\n`);
    process.exitCode = 1;
  }
}
