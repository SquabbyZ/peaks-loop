import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runContextStats } from '../../../../src/cli/commands/skill-context-stats-command.js';

describe('R003.2 peaks skill context-stats', () => {
  let projectRoot: string;
  let cleanup: () => void;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'peaks-r003-stats-'));
    cleanup = () => {
      if (existsSync(projectRoot)) rmSync(projectRoot, { recursive: true, force: true });
    };
  });

  afterEach(() => cleanup());

  // Helper: write a fake scope allowlist + N allowed/denied shadow stubs.
  function seedScope(opts: { allowed: number; denied: number }): void {
    mkdirSync(join(projectRoot, '.peaks', 'scope'), { recursive: true });
    mkdirSync(join(projectRoot, '.claude', 'skills'), { recursive: true });
    const allowlist: string[] = [];
    for (let i = 0; i < opts.allowed; i++) allowlist.push(`allowed-skill-${i}`);
    const denied: string[] = [];
    for (let i = 0; i < opts.denied; i++) denied.push(`denied-skill-${i}`);
    writeFileSync(
      join(projectRoot, '.peaks', 'scope', 'skills.json'),
      JSON.stringify({
        generatedAt: '2026-06-10T00:00:00.000Z',
        ide: 'claude-code',
        strict: false,
        allowlist,
      }),
    );
    for (const name of denied) {
      const dir = join(projectRoot, '.claude', 'skills', name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: _peaks_scope_disabled\n---\n# stub\n`);
    }
  }

  it('returns no-scope branch when no .peaks/scope/skills.json exists', async () => {
    const out = await runContextStats({ projectRoot, json: true });
    expect(out.ok).toBe(false);
    expect(out.command).toBe('skill.context-stats');
    expect(out.code).toBe('NO_SCOPE');
    expect(out.data.scope).toBeNull();
    expect(out.data.message).toMatch(/no scope applied/i);
    expect(out.data.recommendedCommand).toMatch(/peaks skill scope --apply/);
  });

  it('reports allowed + denied + total bytes when scope is applied', async () => {
    seedScope({ allowed: 5, denied: 3 });
    const out = await runContextStats({ projectRoot, json: true });
    expect(out.ok).toBe(true);
    expect(out.data.scope).not.toBeNull();
    expect(out.data.totals.allowedCount).toBe(5);
    expect(out.data.totals.deniedCount).toBe(3);
    // Each stub is ~80 bytes; 3 stubs × ~80 = ~240 bytes; allow with tolerance.
    expect(out.data.totals.stubBytes).toBeGreaterThan(0);
    expect(out.data.totals.stubBytes).toBeLessThan(2000);
    // Shadow-stub reduction = 1 - (stubBytes / originalDeniedBytes)
    // Original estimated at 7000 bytes per denied skill × 3 = 21000.
    // Reduction should be > 95%.
    expect(out.data.totals.shadowReductionPct).toBeGreaterThan(0.95);
  });

  it('produces a human-readable table by default', async () => {
    seedScope({ allowed: 2, denied: 4 });
    const out = await runContextStats({ projectRoot, json: false });
    expect(out.ok).toBe(true);
    expect(out.data.human).toMatch(/Allowed: 2 skills/);
    expect(out.data.human).toMatch(/Denied: 4 skills/);
    expect(out.data.human).toMatch(/Total:/);
  });

  it('reports estimated tokens alongside bytes', async () => {
    seedScope({ allowed: 1, denied: 1 });
    const out = await runContextStats({ projectRoot, json: true });
    expect(out.ok).toBe(true);
    expect(typeof out.data.estimatedTokens.total).toBe('number');
    expect(out.data.estimatedTokens.total).toBeGreaterThan(0);
  });
});
