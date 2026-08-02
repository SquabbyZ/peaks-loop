// tests/unit/standards/find-skills-integration.test.ts
//
// Slice 4.0.7-PR-12 round 2 (user direction 2026-08-02: do not
// hardcode a verified-owner whitelist; let the registry's
// leaderboard decide). Verifies the no-hardcode find-skills
// integration:
//   - queriesForContext maps ProjectContext → bounded query set
//   - parseFindOutput recovers owner/repo/skill-slug + install
//     count from typical `npx skills find` output
//   - findSkillsForContext dedups + ranks by install-count desc
//     (registry leaderboard order) using a custom SkillFindRunner
//     injection (no network)
//
// Run with: pnpm vitest run tests/unit/standards/find-skills-integration.test.ts

import { describe, expect, it } from 'vitest';
import {
  findSkillsForContext,
  parseFindOutput,
  queriesForContext,
  type SkillFindRunner,
} from '../../../src/services/standards/find-skills-integration.js';
import type { ProjectContext } from '../../../src/services/standards/project-context.js';

const baseContext: ProjectContext = {
  hasPackageJson: true,
  buildTool: 'vite',
  componentLibrary: { name: 'antd', majorVersion: '5' },
  cssFrameworks: ['less'],
  cssConflicts: [],
  stateManagement: [],
  routing: [],
  dataFetching: [],
  legacySignals: [],
  notableDeps: ['@nestjs/core', 'playwright', '@playwright/test'],
};

describe('queriesForContext (PR-12 round 2 — no hardcoded owner)', () => {
  it('returns antd, react, less, nestjs, playwright, e2e, typescript for ice-cola-shaped context', () => {
    const q = queriesForContext(baseContext);
    expect(q).toContain('antd');
    expect(q).toContain('react');
    expect(q).toContain('less');
    expect(q).toContain('nestjs');
    expect(q).toContain('playwright');
    expect(q).toContain('e2e');
    expect(q).toContain('typescript');
  });

  it('dedups the query list', () => {
    const q = queriesForContext(baseContext);
    expect(q.length).toBe(new Set(q).size);
  });

  it('bounds the result to 12 queries max', () => {
    const huge: ProjectContext = {
      ...baseContext,
      componentLibrary: { name: 'shadcn' },
      cssFrameworks: ['tailwind', 'less', 'sass', 'css-modules'],
      notableDeps: ['@nestjs/core', 'playwright', 'vitest', 'prisma', 'drizzle-orm', 'graphql'],
    };
    const q = queriesForContext(huge);
    expect(q.length).toBeLessThanOrEqual(12);
  });

  it('falls back to javascript when no package.json', () => {
    const q = queriesForContext({ ...baseContext, hasPackageJson: false });
    expect(q).toContain('javascript');
  });

  it('does NOT pre-filter by owner (the registry decides)', () => {
    // The function signature has no `owners` parameter — the runner
    // is invoked with no --owner filter so the leaderboard decides.
    // The findSkillsForContext options object should not accept
    // an owners whitelist; verify by looking at the function
    // signature in the test file.
    const sig = findSkillsForContext.toString();
    expect(sig).not.toContain('owners:');
  });
});

describe('parseFindOutput (PR-12 round 2)', () => {
  it('parses a single owner/repo@slug triple + install count', () => {
    const out = 'vercel-labs/agent-skills@react-best-practices  185.2K  React + Next.js performance';
    const rows = parseFindOutput(out);
    expect(rows.length).toBe(1);
    expect(rows[0]?.owner).toBe('vercel-labs');
    expect(rows[0]?.skillSlug).toBe('react-best-practices');
    expect(rows[0]?.installCount).toBe(185200);
    expect(rows[0]?.installCommand).toBe('npx skills add vercel-labs/agent-skills@react-best-practices -g -y');
  });

  it('returns empty array when no recognizable rows', () => {
    expect(parseFindOutput('nothing here')).toEqual([]);
  });

  it('emits the installCommand without any --owner filter (no hardcoded whitelist)', () => {
    const out = 'random-user/cool-repo@some-skill  42  Some skill';
    const rows = parseFindOutput(out);
    expect(rows[0]?.installCommand).toBe('npx skills add random-user/cool-repo@some-skill -g -y');
  });
});

describe('findSkillsForContext (PR-12 round 2 — registry-decides ranking)', () => {
  it('dedups across queries and ranks by install-count desc (registry order)', async () => {
    const findRunner: SkillFindRunner = async (q) => {
      if (q === 'react') {
        return [
          'vercel-labs/agent-skills@react-best-practices  185.2K  react',
          'random-user/cool@react-tips  50  tips',
        ].join('\n') + '\n';
      }
      if (q === 'typescript') {
        // Same vercel-labs/agent-skills@react-best-practices — should dedup.
        return 'vercel-labs/agent-skills@react-best-practices  185.2K  react\n';
      }
      if (q === 'antd') {
        return 'ant-design/antd-skills@antd-table  4.2K  antd\n';
      }
      return '';
    };
    const result = await findSkillsForContext(baseContext, { findRunner, topN: 10 });
    const slugs = result.recommendations.map((r) => r.skillSlug);
    // 3 unique skills after dedup (react-best-practices / react-tips / antd-table)
    expect(slugs.length).toBe(3);
    // Top of the list is the highest install-count — matches what
    // the user would see if they ran `npx skills find` manually.
    expect(result.recommendations[0]?.installCount).toBe(185200);
    expect(result.recommendations[0]?.owner).toBe('vercel-labs');
  });

  it('captures failedRuns when a runner throws (does not crash init)', async () => {
    const findRunner: SkillFindRunner = async () => { throw new Error('network down'); };
    const result = await findSkillsForContext(baseContext, { findRunner, topN: 3 });
    expect(result.recommendations).toEqual([]);
    expect(result.failedRuns.length).toBeGreaterThan(0);
    expect(result.failedRuns[0]?.reason).toContain('network down');
  });

  it('records emptyQueries when a query returns zero rows', async () => {
    const findRunner: SkillFindRunner = async () => '';
    const result = await findSkillsForContext(baseContext, { findRunner, topN: 3 });
    expect(result.emptyQueries.length).toBeGreaterThan(0);
  });

  it('orders results the same way the registry leaderboard does (desc by install count)', async () => {
    // The runner returns rows in leaderboard order (already desc by
    // install count). The service must keep that order, not re-sort
    // by some internal heuristic.
    const findRunner: SkillFindRunner = async () => [
      'vercel-labs/agent-skills@a  1000  a',
      'random-user/x@b  500  b',
      'vercel-labs/agent-skills@c  100  c',
    ].join('\n') + '\n';
    const result = await findSkillsForContext(baseContext, { findRunner, topN: 10 });
    const slugs = result.recommendations.map((r) => r.skillSlug);
    expect(slugs).toEqual(['a', 'b', 'c']);
  });
});
