// scripts/install-skills-bundles.mjs
//
// The two installers that read a directory of bundled assets out of the package and
// reconcile each entry into an IDE directory: the DIRECTORY-shaped family (skills) and
// the FILE-shaped one (agents). Each owns its dispatch precedence and its repair rule.
//
// Split out of `scripts/install-skills.mjs` (rid-043). Every line below was moved
// VERBATIM from that file; only this header, the import block, and the `export`
// keyword on names a sibling imports are new.

import { existsSync, lstatSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { reconcileCanonicalEntry } from './canonical-store.mjs';
import { reconcileCanonicalFileEntry } from './canonical-store-link.mjs';
import { pruneBundledEntries } from './canonical-store-prune.mjs';
import { createInstallResult } from './install-skills-report.mjs';
import { createInstallRootValidator, resolvePackageRoot } from './install-skills-fs.mjs';
import { resolveBundleTargetRoot } from './install-skills-ide.mjs';

/**
 * THE INSTALL CANDIDATE LIST — every skill the package ships, as
 * `{ skillName, sourcePath }`.
 *
 * After the v2.13.0 bee-demote (commit de0872b), the role skills (peaks-prd,
 * peaks-rd, peaks-qa, peaks-ui, peaks-sc, peaks-txt) moved under
 * `skills/bee/<role>/` while user-facing helpers stayed at `skills/<name>/`. So the
 * list is built by walking top-level entries (user-facing helpers) AND
 * `skills/bee/<role>` (demoted role skills). Each candidate is installed under its
 * basename, so the postinstall links `~/.claude/skills/peaks-rd` to
 * `skills/bee/peaks-rd` rather than to `skills/bee`.
 *
 * De-dupe rule: a top-level helper with the same name WINS, which preserves the
 * existing install contract for any helper sharing a name with a demoted role skill
 * (legacy overlap).
 *
 * @param {string} skillsRoot
 * @returns {Array<{ skillName: string, sourcePath: string }>}
 */
function collectSkillCandidates(skillsRoot) {
  const beeRoot = join(skillsRoot, 'bee');
  /** @type {Array<{ skillName: string, sourcePath: string }>} */
  const candidates = [];
  for (const skillName of readdirSync(skillsRoot)) {
    if (skillName === 'bee') continue;
    const sourcePath = join(skillsRoot, skillName);
    if (!isSkillSource(sourcePath)) continue;
    candidates.push({ skillName, sourcePath });
  }
  if (existsSync(beeRoot) && isDirectoryEntry(beeRoot)) {
    for (const skillName of readdirSync(beeRoot)) {
      const sourcePath = join(beeRoot, skillName);
      if (!isSkillSource(sourcePath)) continue;
      if (candidates.some((c) => c.skillName === skillName)) continue;
      candidates.push({ skillName, sourcePath });
    }
  }
  return candidates;
}

/** A real directory entry — `lstat`, so a symlink to one is NOT one. */
function isDirectoryEntry(entryPath) {
  return lstatSync(entryPath).isDirectory();
}

/** A directory entry that is a skill: a real directory holding a `SKILL.md`. */
function isSkillSource(sourcePath) {
  return isDirectoryEntry(sourcePath) && existsSync(join(sourcePath, 'SKILL.md'));
}

export function installBundledSkills(options = {}) {
  const packageRoot = resolvePackageRoot(options);
  const skillsRoot = join(packageRoot, 'skills');

  if (process.env.PEAKS_SKIP_SKILL_INSTALL === '1' || !existsSync(skillsRoot)) {
    return createInstallResult();
  }

  // Slice #011: IDE-aware dispatch — the precedence itself now lives in ONE place
  // (`resolveBundleTargetRoot` in `install-skills-ide.mjs`), because all three
  // families stated it and only this one also warns.
  const targetRoot = resolveBundleTargetRoot(options, {
    profileField: 'skillsDir',
    envVar: 'PEAKS_CLAUDE_SKILLS_DIR',
    fallback: '.claude/skills',
    warn: true
  });

  const installed = [];
  const skipped = [];
  mkdirSync(targetRoot, { recursive: true });
  const validateSkillsRoot = createInstallRootValidator(targetRoot, 'Peaks skills');

  const candidates = collectSkillCandidates(skillsRoot);

  for (const { skillName, sourcePath } of candidates) {
    const targetPath = join(targetRoot, skillName);

    // Slice 2 (`agents-canonical-store`) — the entry points at the CANONICAL
    // STORE (`~/.peaks/skills/<name>`), not at `<packageRoot>/skills/<name>`,
    // because `<packageRoot>` changes on every `npm i -g peaks-loop@latest` and
    // the links must bind to a PATH peaks-loop owns, not to a VERSION. Repair is
    // the only behaviour: an entry peaks-loop owns (sidecar matches, or the link
    // dangles) is relinked onto the store; only a real directory the user authored
    // is left alone and reported `skipped`. `options.reconcileJunctions` is
    // therefore READ NOWHERE here — still accepted (`sync-service.ts` forwards it)
    // so passing it changes nothing, and removing it is a CLI-surface change this
    // slice does not own.
    validateSkillsRoot();
    const reconciled = reconcileCanonicalEntry({
      kind: 'skills',
      name: skillName,
      sourcePath,
      linkPath: targetPath
    });
    validateSkillsRoot();

    if (reconciled.linkAction === 'skipped') {
      skipped.push(skillName);
      continue;
    }
    installed.push(skillName);
  }

  // Slice 3 — PRUNE. The loop above only ever ADDS. A skill removed from the
  // package left its canonical copy, every IDE link and every sidecar on the
  // user's machine forever, because nothing walked the DESTINATIONS. This does,
  // and deletes only what `isManagedEntry` proves is ours.
  const { pruned } = pruneBundledEntries({
    kind: 'skills',
    keepNames: candidates.map((candidate) => candidate.skillName),
    linkDirs: [targetRoot]
  });

  return { installed, skipped, pruned };
}

/**
 * Slice 7/7 — bundled agents (Claude Code sub-agent prompts).
 *
 * Writes into the IDE's sub-agent loader directory (`~/.claude/agents/` for Claude
 * Code, and whatever `agentsDir` the detected profile declares). The bytes live in
 * the canonical store (`~/.peaks/agents/<name>`) and the IDE entry is a link to it.
 *
 * Ownership policy — ONE predicate, in `canonical-store-link.mjs::isOwnedFileEntry`,
 * and it is deliberately not a string comparison:
 *   - entry resolves to the canonical copy              → leave it (idempotent run)
 *   - entry is a link we wrote (sidecar agrees, dangles) → relink onto the store
 *   - entry is a real file with OUR sidecar beside it    → re-point it at the store
 *   - entry is a real file with a LEGACY sidecar whose
 *     recorded package path no longer resolves           → same: repair it
 *   - entry is a real file we never wrote (no sidecar)   → skip (user-authored)
 *   - entry is a real file whose sidecar names a path
 *     that STILL resolves                                → skip (a second live install)
 *
 * The two "skip" arms above are the ones the old code got wrong in opposite
 * directions: it skipped whenever the package path merely DIFFERED, which froze
 * every entry on the first upgrade, silently and permanently. See
 * `isOwnedFileEntry` for why a vanished package path is proof of an earlier install.
 */
export function installBundledAgents(options = {}) {
  const packageRoot = resolvePackageRoot(options);
  const agentsRoot = join(packageRoot, 'agents');

  // Per-IDE env-var override (claude-code only today): PEAKS_CLAUDE_AGENTS_DIR.
  // Universal escape hatch: PEAKS_SKIP_AGENT_INSTALL=1 (parallel to
  // PEAKS_SKIP_SKILL_INSTALL).
  if (
    process.env.PEAKS_SKIP_SKILL_INSTALL === '1' ||
    process.env.PEAKS_SKIP_AGENT_INSTALL === '1' ||
    !existsSync(agentsRoot)
  ) {
    return createInstallResult();
  }

  // Slice #011: IDE-aware dispatch — same precedence as the other two families,
  // resolved by the same helper (`resolveBundleTargetRoot`).
  const targetRoot = resolveBundleTargetRoot(options, {
    profileField: 'agentsDir',
    envVar: 'PEAKS_CLAUDE_AGENTS_DIR',
    fallback: '.claude/agents'
  });

  const installed = [];
  const skipped = [];
  const fallbacks = [];
  mkdirSync(targetRoot, { recursive: true });
  const validateAgentsRoot = createInstallRootValidator(targetRoot, 'Peaks agents');

  // Slice 4 (`agents-canonical-store`) — the canonical store owns the bytes and the
  // IDE entry points at it. Everything this loop used to decide about ownership is
  // now `reconcileCanonicalFileEntry`'s, and the reason is the defect the brief
  // names as this slice's core: the old test was
  // `resolve(marker.sourcePath) === resolve(sourcePath)`, a STRING comparison against
  // the package path of the installing version — a path with a node version inside it
  // (`…\nvm\v24.21.0\node_modules\peaks-loop\agents\…`). It went false the first time
  // the package moved and stayed false, so the agent silently never updated again.
  const bundledAgentNames = [];
  for (const agentFileName of readdirSync(agentsRoot)) {
    const sourcePath = join(agentsRoot, agentFileName);
    if (!lstatSync(sourcePath).isFile() || !agentFileName.endsWith('.md')) continue;
    bundledAgentNames.push(agentFileName);

    validateAgentsRoot();
    const reconciled = reconcileCanonicalFileEntry({
      kind: 'agents',
      name: agentFileName,
      sourcePath,
      linkPath: join(targetRoot, agentFileName),
      createFileLink: options.createFileLink
    });
    validateAgentsRoot();

    if (reconciled.linkAction === 'skipped') {
      skipped.push(agentFileName);
      continue;
    }
    installed.push(agentFileName);
    if (reconciled.fallback !== null) {
      fallbacks.push({ name: agentFileName, ...reconciled.fallback });
    }
  }

  // The delete half: an agent the package stops shipping used to leave its canonical
  // copy, its IDE entry and both sidecars on the machine forever.
  const { pruned } = pruneBundledEntries({
    kind: 'agents',
    keepNames: bundledAgentNames,
    linkDirs: [targetRoot]
  });

  return { installed, skipped, pruned, fallbacks };
}
