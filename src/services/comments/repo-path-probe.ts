/**
 * Is a path required to exist in a checkout at all?
 *
 * The dominant false positive on `dead-reference` was never a stale comment: it
 * was a correct reference to a file git is told not to track. Ranked over this
 * repository, the top twelve "dead" citations were `.claude/settings.local.json`,
 * `.peaks/_runtime/session.json`, `.peaks/.session.json`,
 * `.peaks/_runtime/active-skill.json`, `.codegraph/config.json`,
 * `.peaks/preferences.json` and friends — all generated state, all named
 * correctly by the code that writes them.
 *
 * So the probe answers "exists OR ignored", and the ignore reading is deliberately
 * bounded: trailing-slash prefixes, whole-path entries, and bare-basename entries.
 * That limit has a direction, and the direction is the safe one — a rule
 * `.gitignore` expresses fancily (negation, `**`, character classes) is NOT read
 * here, so such a path stays reported. A missed exemption is a finding a human
 * reads and dismisses; a phantom exemption is a silent false green in a gate that
 * exists to catch claims that outlived their referent.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type IgnoreRules = {
  /** Directory rules: match the path and everything below it. */
  readonly prefixes: readonly string[];
  /** File rules written with a slash: match that exact repo-relative path. */
  readonly exact: ReadonlySet<string>;
  /** Basename rules: match that name in any directory. */
  readonly basenames: ReadonlySet<string>;
};

function parseGitignore(source: string): IgnoreRules {
  const prefixes: string[] = [];
  const exact = new Set<string>();
  const basenames = new Set<string>();
  for (const raw of source.split(/\r?\n/)) {
    const rule = raw.trim();
    if (rule.length === 0 || rule.startsWith('#') || rule.startsWith('!')) continue;
    const cleaned = rule.replace(/^\//, '').replace(/\/$/, '');
    if (cleaned.length === 0) continue;
    if (!cleaned.includes('/')) {
      basenames.add(cleaned);
      continue;
    }
    // A rule with a slash is registered both ways rather than guessed: `.peaks/_runtime/`
    // is a directory, `.claude/settings.local.json` is one file, and a rule that
    // matched only `path/` silently failed every single-file ignore in the
    // repository. Registering both costs nothing — an over-broad directory prefix
    // here can only ever name the path it was written for and things under it.
    prefixes.push(`${cleaned}/`);
    exact.add(cleaned);
  }
  return { prefixes, exact, basenames };
}

/** True when `.gitignore` says this repo-relative path need not be on disk. */
export function isIgnoredPath(relPath: string, rules: IgnoreRules): boolean {
  const posix = relPath.replace(/\\/g, '/');
  if (rules.exact.has(posix)) return true;
  if (rules.prefixes.some((prefix) => posix.startsWith(prefix))) return true;
  const segments = posix.split('/');
  return segments.some((segment) => rules.basenames.has(segment));
}

/**
 * Build the existence probe a scan should use: a real filesystem lookup, widened
 * by the repository's own ignore list read from its root.
 *
 * The second export below is the deliberate exception. "Is this an installed
 * package name?" must NOT be widened by the ignore list, because `node_modules` is
 * itself ignored — an ignore-aware probe answers yes for every first segment, and
 * the whole `dead-reference` count collapses to zero while looking perfectly
 * healthy.
 */
export function createRepoProbe(repoRoot: string): (relPath: string) => boolean {
  let rules: IgnoreRules = { prefixes: [], exact: new Set(), basenames: new Set() };
  const ignorePath = join(repoRoot, '.gitignore');
  if (existsSync(ignorePath)) {
    rules = parseGitignore(readFileSync(ignorePath, 'utf8'));
  }
  return (relPath: string): boolean =>
    existsSync(join(repoRoot, relPath)) || isIgnoredPath(relPath, rules);
}

/** Filesystem-only existence, for questions where "git ignores it" is no answer. */
export function createFsProbe(repoRoot: string): (relPath: string) => boolean {
  return (relPath: string): boolean => existsSync(join(repoRoot, relPath));
}
