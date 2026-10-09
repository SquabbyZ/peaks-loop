// scripts/install-skills-output-styles.mjs
//
// The output-style install: the style FILES, reconciled into the one IDE directory that
// reads them. Single-target on purpose — the DISPATCH STRATEGY note below is the reason,
// and the other two dispatch paths are named there for the comparison.
//
// Split out of `scripts/install-skills.mjs` (rid-043). Every line below was moved
// VERBATIM from that file; only this header, the import block, and the `export`
// keyword on names a sibling imports are new.

import { existsSync, lstatSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { reconcileCanonicalFileEntry } from './canonical-store-link.mjs';
import { pruneBundledEntries } from './canonical-store-prune.mjs';
import { createInstallRootValidator, resolvePackageRoot } from './install-skills-fs.mjs';
import { createInstallResult } from './install-skills-report.mjs';
import { resolveBundleTargetRoot } from './install-skills-ide.mjs';

/**
 * DISPATCH STRATEGY — the three paths in this file, and why they differ
 * (D10, written down 2026-09-15).
 *
 * This script installs three kinds of asset, and each one resolves its target
 * by a different rule. That was undocumented and untested; it is now
 * documented here and each rule is stated with its reason.
 *
 *   1. SKILLS  (`installBundledSkillsForAllPlatforms`)
 *      Fan out to every platform the user HAS (`isPlatformPresent`).
 *      Reason: a skill directory is per-tool; the same skill is legitimately
 *      wanted in several tools at once, and peaks cannot know which tool the
 *      user will open next. Fan-out is the tenet; presence is the licence.
 *
 *   2. AGENTS  (`installBundledAgentsForAllPlatforms`)
 *      Fan out to present platforms, INTERSECTED with the profiles that
 *      declare `agentsDir`. Reason: sub-agent loaders are not a universal
 *      concept — only 6 of 10 profiles have one. The intersection is the fan
 *      of (1) with a capability filter, not a third rule.
 *
 *   3. OUTPUT STYLES (`installBundledOutputStyles`, this function)
 *      ONE target: the IDE detected in the project root, else the legacy
 *      `~/.claude/output-styles`. Reason: an output style is not a
 *      per-tool asset — it is registered as THE active style for the
 *      session by writing a single `outputStyle` key into
 *      `~/.claude/settings.json` (`installBundledOutputStyleDefault`). A
 *      second copy in `~/.trae/output-styles` would be a file nothing reads
 *      and a setting no one consults; fanning it out would be storing the
 *      same answer in ten places and reading it from one.
 *
 * So: (1) and (2) share one predicate and differ only by capability; (3) is
 * deliberately single-target, and this comment is the reason the brief asked
 * for. If a future platform needs a different rule, state it here.
 */
export function installBundledOutputStyles(options = {}) {
  const packageRoot = resolvePackageRoot(options);
  const outputStylesRoot = join(packageRoot, 'output-styles');

  if (process.env.PEAKS_SKIP_SKILL_INSTALL === '1' || !existsSync(outputStylesRoot)) {
    return createInstallResult();
  }

  // Slice #011: IDE-aware dispatch — same precedence as the other two families,
  // resolved by the same helper (`resolveBundleTargetRoot`).
  const targetRoot = resolveBundleTargetRoot(options, {
    profileField: 'outputStylesDir',
    envVar: 'PEAKS_CLAUDE_OUTPUT_STYLES_DIR',
    fallback: '.claude/output-styles'
  });

  const installed = [];
  const skipped = [];
  const fallbacks = [];
  mkdirSync(targetRoot, { recursive: true });
  const validateOutputStylesRoot = createInstallRootValidator(targetRoot, 'Peaks output styles');

  // Slice 4 (`agents-canonical-store`) — same move slice 2 made for skills, with the
  // one difference the brief calls out: a style is a FILE, so the link is a file
  // symlink, which Windows only grants with developer mode or Administrator.
  // `reconcileCanonicalFileEntry` is the whole policy — canonical copy, link, and the
  // reported fallback to a real copy when the host refuses the link. The loop below
  // no longer decides ownership, and that is deliberate: the decision it used to make
  // was `resolve(marker.sourcePath) === resolve(sourcePath)`, a string comparison
  // against a version-scoped package path that went false forever on the first
  // upgrade and silently froze the style.
  const bundledStyleNames = [];
  for (const outputStyleName of readdirSync(outputStylesRoot)) {
    const sourcePath = join(outputStylesRoot, outputStyleName);
    if (!lstatSync(sourcePath).isFile() || !outputStyleName.endsWith('.md')) continue;
    bundledStyleNames.push(outputStyleName);

    validateOutputStylesRoot();
    const reconciled = reconcileCanonicalFileEntry({
      kind: 'output-styles',
      name: outputStyleName,
      sourcePath,
      linkPath: join(targetRoot, outputStyleName),
      createFileLink: options.createFileLink
    });
    validateOutputStylesRoot();

    if (reconciled.linkAction === 'skipped') {
      skipped.push(outputStyleName);
      continue;
    }
    installed.push(outputStyleName);
    if (reconciled.fallback !== null) {
      fallbacks.push({ name: outputStyleName, ...reconciled.fallback });
    }
  }

  // The delete half, for the same reason skills have one: the loop above only ever
  // adds. A style removed from the package used to leave its canonical copy, its IDE
  // link and both sidecars behind forever.
  const { pruned } = pruneBundledEntries({
    kind: 'output-styles',
    keepNames: bundledStyleNames,
    linkDirs: [targetRoot]
  });

  return { installed, skipped, pruned, fallbacks };
}
