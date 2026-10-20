// src/services/lint/curated-rule-reader.ts
//
// L3 — the CURATED language rule sets (the ECC `rules/<lang>/` tree).
//
// The curated layer answers "what are the general rules for this language?".
// It is read the same way the other two layers are read: by asking the source
// what it declares. Each ECC rule file declares the file patterns it governs
// in its own frontmatter:
//
//     ---
//     paths:
//       - "**/*.ts"
//       - "**/*.tsx"
//     ---
//
// So the file set is matched against those DECLARED patterns — there is no
// language table here, and no branch on the language of a file. A rule file
// with no `paths` (the `common/` layer) governs every file.
//
// ONE ENTRY PER RULE FILE, never one per file: the same rule text governs a
// whole family of files, and repeating it per file is what blows a fix prompt
// up.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import picomatch from 'picomatch';
import { resolveEccPackageRoot } from 'peaks-loop-mut';
import type { EffectiveRule } from './rule-pre-read-types.js';

/** The directory inside the ECC package that holds the curated rule sets. */
const CURATED_RULES_SUBDIR = 'rules';

/** Where the curated rule sets live, or why they could not be found. */
export type CuratedRoot =
  { readonly ok: true; readonly path: string } | { readonly ok: false; readonly reason: string };

/** One rule file, parsed into its declared patterns and its body. */
type CuratedRuleFile = {
  readonly globs: readonly string[];
  readonly body: string;
};

/**
 * The curated rule root, resolved through the bundled `ecc-universal`
 * dependency. The dependency ships the rules, so there is nothing to fetch.
 */
export function resolveCuratedRulesRoot(): CuratedRoot {
  try {
    return { ok: true, path: join(resolveEccPackageRoot(), CURATED_RULES_SUBDIR) };
  } catch (error: unknown) {
    return {
      ok: false,
      reason: `the curated rule sets are not available: ${
        error instanceof Error ? error.message : String(error)
      }`
    };
  }
}

/** The rule files of one curated language directory. */
function curatedRuleFiles(
  rulesDir: string,
  language: string,
  problems: string[]
): readonly CuratedRuleFile[] {
  const dir = join(rulesDir, language);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (error: unknown) {
    problems.push(`${language}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
  const files: CuratedRuleFile[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const read = readRuleFile(join(dir, entry));
    if (!read.ok) {
      problems.push(`${language}/${entry}: ${read.reason}`);
      continue;
    }
    files.push(read.ruleFile);
  }
  return files;
}

/** One rule file, or the reason it could not be read. */
function readRuleFile(
  path: string
): { ok: true; ruleFile: CuratedRuleFile } | { ok: false; reason: string } {
  try {
    return { ok: true, ruleFile: splitFrontmatter(readFileSync(path, 'utf8')) };
  } catch (error: unknown) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Split a rule file into its declared patterns and its body.
 *
 * A file with no frontmatter has no declared patterns, which means it governs
 * every file — that is how the `common/` layer is written.
 */
export function splitFrontmatter(text: string): CuratedRuleFile {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { globs: [], body: text };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end === -1) return { globs: [], body: text };
  const globs = frontmatterGlobs(lines.slice(1, end));
  return {
    globs,
    body: lines
      .slice(end + 1)
      .join('\n')
      .trim()
  };
}

/** The `paths:` list a rule file declares. */
function frontmatterGlobs(lines: readonly string[]): readonly string[] {
  const globs: string[] = [];
  let inPaths = false;
  for (const line of lines) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item?.[1] !== undefined) {
      if (inPaths) globs.push(unquote(item[1]));
      continue;
    }
    const inline = /^\s*paths\s*:\s*\[(.*)\]\s*$/.exec(line);
    if (inline?.[1] !== undefined) {
      for (const part of inline[1].split(',')) {
        const glob = unquote(part.trim());
        if (glob.length > 0) globs.push(glob);
      }
      inPaths = false;
      continue;
    }
    inPaths = /^\s*paths\s*:/.test(line);
  }
  return globs;
}

function unquote(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

/** Whether a rule file's declared patterns cover a file. */
function covers(ruleFile: CuratedRuleFile, file: string): boolean {
  if (ruleFile.globs.length === 0) return true;
  return ruleFile.globs.some((glob) => picomatch.isMatch(file, glob, { dot: true }));
}

/**
 * The curated rules that govern a file set.
 *
 * Returns the rules AND the reasons the read could not produce them, so a
 * missing curated layer is never mistaken for "there are no curated rules".
 */
export function readCuratedRules(
  files: readonly string[],
  root: CuratedRoot
): { rules: readonly EffectiveRule[]; reasons: readonly string[] } {
  if (!root.ok) {
    return { rules: [], reasons: [root.reason] };
  }
  const rulesDir = root.path;
  if (!existsSync(rulesDir)) {
    return { rules: [], reasons: [`the curated rule directory is missing: ${rulesDir}`] };
  }
  const reasons: string[] = [];
  const rules: EffectiveRule[] = [];
  for (const language of curatedLanguages(rulesDir, reasons)) {
    for (const ruleFile of curatedRuleFiles(rulesDir, language, reasons)) {
      const covered = files.filter((file) => covers(ruleFile, file));
      if (covered.length === 0) continue;
      rules.push({
        layer: 'curated',
        source: `ecc:${language}`,
        pattern: ruleFile.globs.length === 0 ? '*' : ruleFile.globs.join(', '),
        rule: ruleFile.body
      });
    }
  }
  return { rules, reasons };
}

/** The curated language directories, and the ones that could not be listed. */
function curatedLanguages(rulesDir: string, reasons: string[]): readonly string[] {
  try {
    return readdirSync(rulesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error: unknown) {
    reasons.push(
      `the curated rule directory could not be listed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return [];
  }
}
