/**
 * `peaks skill:visibility` — Skill visibility CLI surface.
 *
 * Slice: Task 1 of peaks-code → peaks-code rename plan.
 *
 * Reads `.claude-plugin/marketplace.json`, resolves each skill entry's
 * visibility (public / internal) from the optional `userInvocable`
 * field, and emits either:
 *   - a TSV list (`name \t visibility`) for human use
 *   - a JSON envelope `{ ok, skills }` for programmatic use
 *
 * Schema contract:
 *   - internal: `userInvocable: false`
 *   - public (default): `userInvocable` omitted OR `true`
 *
 * The skill list lives at `plugins[0].skills` in marketplace.json;
 * entries are objects of shape `{ name, path?, userInvocable?, description? }`.
 * Older string-array shapes are auto-coerced (each string is treated as
 * a public skill whose name is the basename of the path).
 */
import { readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { Command } from 'commander';

export interface SkillVisibility {
  name: string;
  userInvocable: boolean;
  visibility: 'public' | 'internal';
}

interface MarketplaceShape {
  plugins?: Array<{
    skills?: Array<{ name?: string; userInvocable?: boolean } | string>;
  }>;
}

export function listSkillsVisibility(repoRoot: string): SkillVisibility[] {
  const marketplacePath = join(repoRoot, '.claude-plugin', 'marketplace.json');
  const raw = readFileSync(marketplacePath, 'utf-8');
  const parsed = JSON.parse(raw) as MarketplaceShape;
  const skills = parsed.plugins?.[0]?.skills ?? [];
  return skills.map((entry) => {
    if (typeof entry === 'string') {
      return {
        name: basename(entry),
        userInvocable: true,
        visibility: 'public' as const,
      };
    }
    const userInvocable = entry.userInvocable !== false;
    return {
      name: entry.name ?? '',
      userInvocable,
      visibility: userInvocable ? ('public' as const) : ('internal' as const),
    };
  });
}

export function registerSkillVisibilityCommand(program: Command, repoRoot: string): void {
  const cmd = program
    .command('skill:visibility')
    .description('List skill visibility (public vs internal)')
    .option('--list', 'List all skills')
    .option('--name <name>', 'Query single skill')
    .option('--json', 'JSON output');

  cmd.action((opts: { list?: boolean; name?: string; json?: boolean }) => {
    const all = listSkillsVisibility(repoRoot);
    const filtered = opts.name ? all.filter((s) => s.name === opts.name) : all;
    if (opts.json) {
      process.stdout.write(JSON.stringify({ ok: true, skills: filtered }, null, 2) + '\n');
    } else {
      for (const s of filtered) {
        process.stdout.write(`${s.name}\t${s.visibility}\n`);
      }
    }
  });
}