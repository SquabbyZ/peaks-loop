// The plugin-free ECC copy: `materializeEccAgents` lands the `ecc-universal`
// package's `agents/*.md` under a peaks-owned dir, NEVER under a
// `~/.claude`-shaped path, and prunes what the package no longer ships.
//
// The source used to be a downloaded cache (`~/.peaks/cache/ecc-<sha>/` +
// `ecc-installed.json`), and the two "fail-soft when the cache/manifest is
// missing" cases that model had became ONE case here with the OPPOSITE polarity:
// an unresolvable source throws rather than landing zero agents and reporting
// success. That flip is deliberate — a status reading "installed, 0 agents" when
// nothing is installed is the failure mode this layer exists to avoid.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  hasMaterializedEccAgents,
  listMaterializedAgents,
  materializeEccAgents,
  readEccMaterializeManifest,
  readMaterializedAgent,
  resolveEccMaterializedDir,
  resolveMaterializedAgentName
} from '../../../../packages/peaks-loop-mut/src/services/agent/ecc-package-service.js';

const roots: string[] = [];

function tmpRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-ecc-materialize-'));
  roots.push(root);
  return root;
}

/** Stands in for `<node_modules>/ecc-universal/agents`. */
function seedAgents(root: string, agents: Record<string, string>): string {
  const agentsDir = join(root, 'ecc-universal', 'agents');
  mkdirSync(agentsDir, { recursive: true });
  for (const [name, body] of Object.entries(agents)) {
    writeFileSync(join(agentsDir, `${name}.md`), body);
  }
  return agentsDir;
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe('materializeEccAgents', () => {
  it('copies package agents into the target dir and writes the peaks-owned manifest', () => {
    const root = tmpRoot();
    const sourceDir = seedAgents(root, {
      'code-review': '# Code review\n\nbody of code-review',
      'security-review': '# Security review'
    });
    const targetDir = join(root, 'home', '.peaks', 'agents', 'ecc');

    const result = materializeEccAgents({ sourceDir, targetDir });

    expect(result.materialized).toEqual(['code-review', 'security-review']);
    expect(readFileSync(join(targetDir, 'code-review.md'), 'utf8')).toContain(
      'body of code-review'
    );
    expect(readMaterializedAgent('code-review', targetDir)).toContain('body of code-review');
    expect(hasMaterializedEccAgents(targetDir)).toBe(true);
    expect(listMaterializedAgents(targetDir)).toEqual(['code-review', 'security-review']);
    const manifest = readEccMaterializeManifest(targetDir);
    expect(manifest?.packageVersion).toBe(result.packageVersion);
    expect(manifest?.agents).toEqual(['code-review', 'security-review']);
  });

  it('never writes into a ~/.claude-shaped tree', () => {
    const root = tmpRoot();
    const sourceDir = seedAgents(root, { 'code-review': '# Code review' });
    const home = join(root, 'home');
    const claudeDir = join(home, '.claude', 'agents');
    mkdirSync(claudeDir, { recursive: true });

    materializeEccAgents({ sourceDir, targetDir: join(home, '.peaks', 'agents', 'ecc') });

    expect(readdirSync(claudeDir)).toEqual([]);
    expect(existsSync(join(home, '.claude', 'agents', 'code-review.md'))).toBe(false);
  });

  it('resolves its default target under ~/.peaks (never ~/.claude)', () => {
    const dir = resolveEccMaterializedDir();
    expect(dir.endsWith(join('.peaks', 'agents', 'ecc'))).toBe(true);
    expect(dir.includes(`${sep}.claude${sep}`)).toBe(false);
  });

  it('throws on an unreadable source rather than reporting an empty install', () => {
    const root = tmpRoot();
    const targetDir = join(root, 'target');
    expect(() =>
      materializeEccAgents({ sourceDir: join(root, 'no-such-agents'), targetDir })
    ).toThrow();
    expect(existsSync(targetDir)).toBe(false);
  });

  it('skips agent names that fail the safe-name allowlist', () => {
    const root = tmpRoot();
    const agentsDir = seedAgents(root, { 'code-review': '# ok' });
    writeFileSync(join(agentsDir, 'BadName.md'), '# nope');
    writeFileSync(join(agentsDir, '9start.md'), '# nope');
    const targetDir = join(root, 'target');

    const result = materializeEccAgents({ sourceDir: agentsDir, targetDir });

    expect(result.materialized).toEqual(['code-review']);
    expect(existsSync(join(targetDir, 'BadName.md'))).toBe(false);
    expect(existsSync(join(targetDir, '9start.md'))).toBe(false);
  });

  it('resolves the REAL upstream name `code-reviewer` without `code-review.md` existing', () => {
    const root = tmpRoot();
    // Upstream ECC ships `<lang>-reviewer` agents; there is NO `code-review.md`.
    const sourceDir = seedAgents(root, {
      'code-reviewer': '# Code review\n\nbody of code-reviewer',
      'security-reviewer': '# Security review'
    });
    const targetDir = join(root, 'target');
    materializeEccAgents({ sourceDir, targetDir });

    expect(listMaterializedAgents(targetDir)).toEqual(['code-reviewer', 'security-reviewer']);
    expect(readMaterializedAgent('code-review', targetDir)).toBeNull();
    expect(resolveMaterializedAgentName(['code-reviewer', 'code-review'], targetDir)).toBe(
      'code-reviewer'
    );
  });

  it('prefers the caller candidate order when both names are materialized', () => {
    const root = tmpRoot();
    const sourceDir = seedAgents(root, { 'code-review': '# legacy', 'code-reviewer': '# real' });
    const targetDir = join(root, 'target');
    materializeEccAgents({ sourceDir, targetDir });

    expect(resolveMaterializedAgentName(['code-reviewer', 'code-review'], targetDir)).toBe(
      'code-reviewer'
    );
    expect(resolveMaterializedAgentName(['code-review', 'code-reviewer'], targetDir)).toBe(
      'code-review'
    );
  });

  it('keeps backward compatibility when only the legacy `code-review` exists', () => {
    const root = tmpRoot();
    const sourceDir = seedAgents(root, { 'code-review': '# legacy' });
    const targetDir = join(root, 'target');
    materializeEccAgents({ sourceDir, targetDir });

    expect(resolveMaterializedAgentName(['code-reviewer', 'code-review'], targetDir)).toBe(
      'code-review'
    );
  });

  it('falls back deterministically to a `code-*reviewer` agent when nothing matches verbatim', () => {
    const root = tmpRoot();
    const sourceDir = seedAgents(root, { 'code-quality-reviewer': '# variant' });
    const targetDir = join(root, 'target');
    materializeEccAgents({ sourceDir, targetDir });

    expect(resolveMaterializedAgentName(['code-reviewer', 'code-review'], targetDir)).toBe(
      'code-quality-reviewer'
    );
  });

  it('returns null when nothing matches, so the caller can degrade to inline', () => {
    const root = tmpRoot();
    const sourceDir = seedAgents(root, { 'security-reviewer': '# unrelated' });
    const targetDir = join(root, 'target');
    materializeEccAgents({ sourceDir, targetDir });

    expect(resolveMaterializedAgentName(['code-reviewer', 'code-review'], targetDir)).toBeNull();
    expect(resolveMaterializedAgentName(['code-reviewer'], join(root, 'missing-dir'))).toBeNull();
  });

  it('prunes stale materialized copies the package version no longer ships', () => {
    const root = tmpRoot();
    const sourceDir = seedAgents(root, { 'code-review': '# ok' });
    const targetDir = join(root, 'target');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'removed-agent.md'), '# stale');

    const result = materializeEccAgents({ sourceDir, targetDir });

    expect(result.materialized).toEqual(['code-review']);
    expect(existsSync(join(targetDir, 'removed-agent.md'))).toBe(false);
  });
});
