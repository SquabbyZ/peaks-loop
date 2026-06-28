/**
 * v2.15.0 follow-up — G7: documentation auto-generator.
 *
 * Two CLI surfaces:
 *   1. `peaks doc generate-skill --from <code-path>` — produces a SKILL.md
 *      skeleton by scanning a code directory for command exports,
 *      with sections derived from JSDoc / signature.
 *   2. `peaks doc changelog-suggest --since <git-ref>` — diffs
 *      src/cli/commands/*.ts since the ref and emits a
 *      "## [Unreleased]" block describing the changes.
 *
 * Both are pragmatic / 80% solutions; the goal is to make the operator's
 * life easier, not to fully automate documentation.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';

export interface SkillSection {
  readonly heading: string;
  readonly bullets: readonly string[];
}

export interface SkillDoc {
  readonly name: string;
  readonly description: string;
  readonly sections: readonly SkillSection[];
}

const COMMAND_PATTERN = /program\s*\.\s*command\(\s*['"]([^'"]+)['"]/g;
const DESC_PATTERN = /\.description\(\s*['"]([^'"]+)['"]\)/g;

/** Generate a SKILL.md skeleton from a directory of CLI command files. */
export function generateSkillFromCommands(
  skillName: string,
  commandsDir: string
): SkillDoc {
  const sections: SkillSection[] = [];
  let description = `Auto-generated SKILL.md skeleton for ${skillName}.`;

  if (!existsSync(commandsDir)) {
    return { name: skillName, description, sections: [] };
  }
  const commandMap = new Map<string, string[]>();
  for (const file of readdirSync(commandsDir)) {
    if (!file.endsWith('.ts') && !file.endsWith('.js')) continue;
    const path = join(commandsDir, file);
    let content: string;
    try {
      content = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    const commands = [...content.matchAll(COMMAND_PATTERN)].map((m) => m[1]!).filter((c) => c.length > 0);
    const descs = [...content.matchAll(DESC_PATTERN)].map((m) => m[1]!);
    for (const cmd of commands) {
      if (!commandMap.has(cmd)) commandMap.set(cmd, []);
      commandMap.get(cmd)!.push(descs[0] ?? '(no description)');
    }
  }
  if (commandMap.size === 0) {
    return { name: skillName, description, sections: [] };
  }
  const bullets: string[] = [];
  let firstDescription: string | null = null;
  for (const [cmd, descs] of [...commandMap.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const desc = descs[0] ?? '(no description)';
    bullets.push(`- \`peaks ${cmd}\` — ${desc}`);
    if (firstDescription === null) firstDescription = desc;
  }
  sections.push({ heading: 'Commands', bullets });
  if (firstDescription !== null) {
    description = firstDescription.slice(0, 200);
  }
  return { name: skillName, description, sections };
}

/** Render SkillDoc as markdown. */
export function renderSkillMarkdown(doc: SkillDoc): string {
  const lines: string[] = [];
  lines.push(`# ${doc.name}`);
  lines.push('');
  lines.push(doc.description);
  lines.push('');
  for (const sec of doc.sections) {
    lines.push(`## ${sec.heading}`);
    lines.push('');
    for (const b of sec.bullets) lines.push(b);
    lines.push('');
  }
  return lines.join('\n');
}

export interface ChangelogEntry {
  readonly kind: 'feat' | 'fix' | 'docs' | 'refactor' | 'chore';
  readonly subject: string;
  readonly file: string;
}

/** Parse a single commit subject line into a ChangelogEntry. */
export function parseCommitSubject(subject: string, file: string): ChangelogEntry {
  const conventionalMatch = /^(feat|fix|docs|refactor|chore)(?:\([^)]+\))?:\s*(.+)$/i.exec(subject);
  if (conventionalMatch) {
    return { kind: conventionalMatch[1]!.toLowerCase() as ChangelogEntry['kind'], subject: conventionalMatch[2]!.trim(), file };
  }
  return { kind: 'chore', subject, file };
}

/** Run `git log` for the given ref range, return parsed entries. */
export function gitLogSince(projectRoot: string, since: string): ChangelogEntry[] {
  try {
    const out = execSync(`git log --pretty=format:"%s" ${since}..HEAD`, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    if (out.trim().length === 0) return [];
    return out.split('\n').filter((s) => s.length > 0).map((s) => parseCommitSubject(s, 'git log'));
  } catch {
    return [];
  }
}

/** Group entries by kind + render a "## [Unreleased]" block. */
export function suggestChangelog(entries: readonly ChangelogEntry[]): string {
  if (entries.length === 0) return '## [Unreleased]\n\n(no changes since the reference)';
  const groups: Record<ChangelogEntry['kind'], ChangelogEntry[]> = { feat: [], fix: [], docs: [], refactor: [], chore: [] };
  for (const e of entries) groups[e.kind].push(e);
  const lines: string[] = ['## [Unreleased]', ''];
  for (const k of ['feat', 'fix', 'refactor', 'docs', 'chore'] as const) {
    if (groups[k].length === 0) continue;
    lines.push(`### ${k.charAt(0).toUpperCase() + k.slice(1)}`);
    lines.push('');
    for (const e of groups[k]) lines.push(`- ${e.subject}`);
    lines.push('');
  }
  return lines.join('\n');
}
