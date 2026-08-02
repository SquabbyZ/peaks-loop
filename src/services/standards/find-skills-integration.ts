/**
 * Slice 4.0.7-PR-12 (ice-cola surface probe 2026-08-02).
 *
 * After `peaks standards init` / `peaks standards update` materializes
 * the project-local standards tree, the user often wants to also
 * bring in matching skills from the open agent-skills ecosystem
 * (https://skills.sh/). A TypeScript monorepo with React + NestJS +
 * Tailwind + Playwright + pnpm has natural companions in
 * vercel-labs/agent-skills, anthropics/skills, and similar curated
 * collections.
 *
 * Slice 4.0.7 dogfood round 2 (user direction 2026-08-02): do NOT
 * hardcode a `VERIFIED_SKILL_OWNERS` whitelist. The first version
 * shipped a static list of "trusted" owners, but that is exactly
 * what the find-skills skill tells users NOT to do — let the
 * registry + leaderboard decide. This service now:
 *   1. maps the detected ProjectContext to a small set of natural
 *      language queries (component library, build tool, language).
 *   2. runs `npx skills find <query>` ONCE per query with no
 *      `--owner` filter, so the registry returns whatever the
 *      leaderboard surfaces (vercel-labs/agent-skills at the top
 *      for "react" is a registry result, not a hardcoded one).
 *   3. parses + dedups + ranks by install count desc (the
 *      registry / leaderboard already orders by popularity).
 *   4. emits a `SkillRecommendation` list with `install` command.
 *
 * **Hard rule (per peaks-loop external-references):** this service
 * NEVER calls `npx skills add` itself. Installation is gated on the
 * user passing `--suggest-skills` to `peaks standards init/update`,
 * and the install command is emitted as a single shell snippet the
 * user can review before pasting. Default behavior: recommendation
 * only, no install. The CLI caller owns the gating.
 *
 * Pure: no I/O of the project tree; only `npx skills find` calls
 * (which are external side effects that we treat as testable via a
 * `skillFindRunner` injection).
 */
import { spawn } from 'node:child_process';
import type { ProjectContext } from './project-context.js';

export interface SkillRecommendation {
  /** GitHub owner/repo, e.g. "vercel-labs/agent-skills". */
  readonly owner: string;
  /** Skill slug within the repo, e.g. "react-best-practices". */
  readonly skillSlug: string;
  /** Display name (best-effort; may equal slug). */
  readonly displayName: string;
  /** Short description from the registry; empty when not parseable. */
  readonly description: string;
  /** Install count from the registry listing; null when unparseable. */
  readonly installCount: number | null;
  /** The shell command the user can paste to install this skill. */
  readonly installCommand: string;
}

export interface FindSkillsResult {
  readonly recommendations: readonly SkillRecommendation[];
  /** Queries that found zero candidates (operator-visible). */
  readonly emptyQueries: readonly string[];
  /** `npx skills find` runs that failed (network / registry); non-fatal. */
  readonly failedRuns: readonly { readonly query: string; readonly reason: string }[];
}

/**
 * Map a ProjectContext to a small query set. Returns at most 8
 * queries to keep the network surface bounded; ordering is
 * best-to-worst (more specific first, then broad). Deliberately
 * no hardcoded owner whitelist — `findSkillsForContext` runs
 * `npx skills find <query>` with no `--owner` filter so the
 * registry / leaderboard surfaces whatever the user might want
 * (per find-skills SKILL.md Step 2-3 guidance).
 */
export function queriesForContext(ctx: ProjectContext): readonly string[] {
  const queries: string[] = [];
  // Component library first (most specific)
  if (ctx.componentLibrary.name === 'antd') queries.push('antd', 'react');
  else if (ctx.componentLibrary.name === 'antd-pro') queries.push('antd-pro', 'react', 'pro-components');
  else if (ctx.componentLibrary.name === 'mui') queries.push('mui', 'react');
  else if (ctx.componentLibrary.name === 'shadcn') queries.push('shadcn', 'react', 'tailwind');
  else if (ctx.componentLibrary.name === 'arco') queries.push('arco', 'react');
  else if (ctx.componentLibrary.name === 'tdesign') queries.push('tdesign', 'react');
  else if (ctx.componentLibrary.name === 'element-plus') queries.push('element-plus', 'vue');
  else if (ctx.componentLibrary.name === 'vant') queries.push('vant', 'mobile');
  // Build tool
  if (ctx.buildTool === 'next') queries.push('nextjs', 'react');
  else if (ctx.buildTool === 'vite') queries.push('vite', 'frontend');
  else if (ctx.buildTool === 'umi') queries.push('umi');
  else if (ctx.buildTool === 'rsbuild') queries.push('rsbuild', 'rspack');
  else if (ctx.buildTool === 'rspack') queries.push('rspack');
  // CSS framework
  if (ctx.cssFrameworks.includes('tailwind')) queries.push('tailwind');
  if (ctx.cssFrameworks.includes('less')) queries.push('less');
  // Domain hints
  for (const dep of ctx.notableDeps) {
    if (dep.startsWith('@nestjs/')) queries.push('nestjs');
    if (dep === 'playwright' || dep === '@playwright/test') queries.push('playwright', 'e2e');
    if (dep === 'vitest') queries.push('vitest', 'testing');
    if (dep === 'prisma') queries.push('prisma');
    if (dep === 'drizzle-orm') queries.push('drizzle');
    if (dep === 'graphql' || dep === '@apollo/client') queries.push('graphql');
  }
  // Always include the language + the platform itself
  queries.push(ctx.hasPackageJson ? 'typescript' : 'javascript');
  // Dedup while preserving order, then cap at 12 to bound the
  // network surface (each query fans out to the registry). 12
  // keeps both "specific" (antd, react, nestjs) and "broad"
  // (typescript / javascript) queries in the same list.
  const seen = new Set<string>();
  const deduped = queries.filter((q) => (seen.has(q) ? false : (seen.add(q), true)));
  return deduped.slice(0, 12);
}

/**
 * Spawn runner injection point. The default spawns
 * `npx skills find <query>` (no `--owner` filter, so the registry
 * decides what surfaces). Tests pass a deterministic stub.
 */
export type SkillFindRunner = (query: string) => Promise<string>;

export const defaultSkillFindRunner: SkillFindRunner = (query) =>
  new Promise((resolveText, reject) => {
    // No `--owner` flag: the registry's leaderboard decides the
    // ranking. We do NOT hardcode a "verified owners" whitelist —
    // that is exactly the anti-pattern the find-skills SKILL.md
    // warns against (Step 4: verify install count + source
    // reputation, but trust the leaderboard first).
    const child = spawn('npx', ['skills', 'find', query], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolveText(stdout);
      else reject(new Error(`npx skills find exited ${code}: ${stderr.slice(0, 200)}`));
    });
  });

/**
 * Parse a `npx skills find` stdout blob into SkillRecommendation rows.
 * The CLI output is line-oriented; a row looks like
 *   <owner>/<repo>@<slug>   <install-count>   <description>
 * The parser is lenient — any line that contains a
 * `<owner>/<repo>@<slug>` triple is captured.
 */
export function parseFindOutput(stdout: string): readonly SkillRecommendation[] {
  const lines = stdout.split('\n');
  const rows: SkillRecommendation[] = [];
  const rowRe = /([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)@([A-Za-z0-9_.-]+)/;
  for (const line of lines) {
    const m = line.match(rowRe);
    if (!m || m[1] === undefined || m[2] === undefined || m[3] === undefined) continue;
    const rowOwner = m[1];
    const repoName = m[2];
    const skillSlug = m[3];
    // Parse install count if the line has a number with K/M suffix.
    let installCount: number | null = null;
    const countMatch = line.match(/(\d+(?:\.\d+)?)\s*([KkMm]?)\b/);
    if (countMatch && countMatch[1] !== undefined) {
      const base = parseFloat(countMatch[1]);
      const suffix = (countMatch[2] ?? '').toUpperCase();
      if (!Number.isNaN(base)) {
        installCount = suffix === 'K' ? base * 1_000 : suffix === 'M' ? base * 1_000_000 : base;
      }
    }
    const desc = line.replace(rowRe, '').trim();
    const fullSlug = `${rowOwner}/${repoName}@${skillSlug}`;
    rows.push({
      owner: rowOwner,
      skillSlug,
      displayName: skillSlug,
      description: desc,
      installCount,
      installCommand: `npx skills add ${fullSlug} -g -y`,
    });
  }
  return rows;
}

/**
 * Main entry: query the registry for each query, dedup, sort by
 * install-count desc (the registry's leaderboard already orders by
 * popularity; we keep the same ordering). Returns top-N rows.
 */
export async function findSkillsForContext(
  ctx: ProjectContext,
  options: {
    readonly topN?: number;
    readonly findRunner?: SkillFindRunner;
  } = {},
): Promise<FindSkillsResult> {
  const topN = options.topN ?? 8;
  const findRunner = options.findRunner ?? defaultSkillFindRunner;
  const queries = queriesForContext(ctx);
  const seen = new Set<string>();
  const all: SkillRecommendation[] = [];
  const emptyQueries: string[] = [];
  const failedRuns: { query: string; reason: string }[] = [];
  for (const query of queries) {
    try {
      const stdout = await findRunner(query);
      const rows = parseFindOutput(stdout);
      if (rows.length === 0) {
        emptyQueries.push(query);
        continue;
      }
      for (const r of rows) {
        const key = `${r.owner}/${r.skillSlug}`;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(r);
      }
    } catch (err) {
      failedRuns.push({
        query,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  // Sort by install count desc (registry leaderboard is already
  // ordered by popularity; we keep the same order so the user sees
  // the same top results they would see in `npx skills find`).
  // Tiebreaker: display name asc.
  all.sort((a, b) => {
    if (a.installCount !== null && b.installCount !== null && a.installCount !== b.installCount) {
      return b.installCount - a.installCount;
    }
    if (a.installCount === null && b.installCount !== null) return 1;
    if (a.installCount !== null && b.installCount === null) return -1;
    return a.displayName.localeCompare(b.displayName);
  });
  return {
    recommendations: all.slice(0, topN),
    emptyQueries,
    failedRuns,
  };
}
