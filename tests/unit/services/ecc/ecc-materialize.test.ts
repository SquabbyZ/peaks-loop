// Slice A (2026-09-09-ecc-dynamic-and-cleanup) — plugin-free ECC
// materialize layer. Verifies the peaks-owned copy lands under the
// injected `~/.peaks/agents/ecc`-shaped target and NEVER under a
// `~/.claude`-shaped path, and that every failure mode is fail-soft.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
} from '../../../../packages/peaks-loop-mut/src/services/agent/ecc-cache-service.js';

const SHA = 'a'.repeat(40);
const roots: string[] = [];

function tmpRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-ecc-materialize-'));
  roots.push(root);
  return root;
}

function writeCache(root: string, agents: Record<string, string>): string {
  const cacheDir = join(root, 'cache');
  const agentsDir = join(cacheDir, `ecc-${SHA}`, 'agents');
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(
    join(cacheDir, 'ecc-installed.json'),
    JSON.stringify({ version: '1', sha: SHA, fetchedAt: new Date().toISOString(), agents: Object.keys(agents) })
  );
  for (const [name, body] of Object.entries(agents)) {
    writeFileSync(join(agentsDir, `${name}.md`), body);
  }
  return cacheDir;
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe('materializeEccAgents', () => {
  it('copies cached agents into the target dir and writes the peaks-owned manifest', () => {
    const root = tmpRoot();
    const cacheDir = writeCache(root, {
      'code-review': '# Code review\n\nbody of code-review',
      'security-review': '# Security review'
    });
    const targetDir = join(root, 'home', '.peaks', 'agents', 'ecc');

    const result = materializeEccAgents({ cacheDir, targetDir });

    expect(result.sha).toBe(SHA);
    expect(result.materialized).toEqual(['code-review', 'security-review']);
    expect(readFileSync(join(targetDir, 'code-review.md'), 'utf8')).toContain('body of code-review');
    expect(readMaterializedAgent('code-review', targetDir)).toContain('body of code-review');
    expect(hasMaterializedEccAgents(targetDir)).toBe(true);
    expect(listMaterializedAgents(targetDir)).toEqual(['code-review', 'security-review']);

    const manifest = readEccMaterializeManifest(targetDir);
    expect(manifest?.sha).toBe(SHA);
    expect(manifest?.agents).toEqual(['code-review', 'security-review']);
  });

  it('never writes into a ~/.claude-shaped tree', () => {
    const root = tmpRoot();
    const cacheDir = writeCache(root, { 'code-review': '# Code review' });
    const home = join(root, 'home');
    const claudeDir = join(home, '.claude', 'agents');
    mkdirSync(claudeDir, { recursive: true });

    materializeEccAgents({ cacheDir, targetDir: join(home, '.peaks', 'agents', 'ecc') });

    expect(readdirSync(claudeDir)).toEqual([]);
    expect(existsSync(join(home, '.claude', 'agents', 'code-review.md'))).toBe(false);
  });

  it('resolves its default target under ~/.peaks (never ~/.claude)', () => {
    const dir = resolveEccMaterializedDir();
    expect(dir.endsWith(join('.peaks', 'agents', 'ecc'))).toBe(true);
    expect(dir.includes(`${sep}.claude${sep}`)).toBe(false);
  });

  it('is fail-soft when no cache manifest exists', () => {
    const root = tmpRoot();
    const targetDir = join(root, 'target');
    const result = materializeEccAgents({ cacheDir: join(root, 'missing-cache'), targetDir });
    expect(result).toEqual({ targetDir, sha: null, materialized: [] });
    expect(existsSync(targetDir)).toBe(false);
  });

  it('is fail-soft when the sha dir is missing', () => {
    const root = tmpRoot();
    const cacheDir = join(root, 'cache');
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(
      join(cacheDir, 'ecc-installed.json'),
      JSON.stringify({ version: '1', sha: SHA, fetchedAt: new Date().toISOString(), agents: ['code-review'] })
    );
    const result = materializeEccAgents({ cacheDir, targetDir: join(root, 'target') });
    expect(result.sha).toBeNull();
    expect(result.materialized).toEqual([]);
  });

  it('skips agent names that fail the safe-name allowlist', () => {
    const root = tmpRoot();
    const cacheDir = writeCache(root, { 'code-review': '# ok' });
    const agentsDir = join(cacheDir, `ecc-${SHA}`, 'agents');
    writeFileSync(join(agentsDir, 'BadName.md'), '# nope');
    writeFileSync(join(agentsDir, '9start.md'), '# nope');

    const result = materializeEccAgents({ cacheDir, targetDir: join(root, 'target') });

    expect(result.materialized).toEqual(['code-review']);
    expect(existsSync(join(root, 'target', 'BadName.md'))).toBe(false);
    expect(existsSync(join(root, 'target', '9start.md'))).toBe(false);
  });

  it('resolves the REAL upstream name `code-reviewer` without `code-review.md` existing', () => {
    const root = tmpRoot();
    const cacheDir = writeCache(root, {
      // Upstream ECC ships `<lang>-reviewer` agents. There is NO `code-review.md`.
      'code-reviewer': '# Code review\n\nbody of code-reviewer',
      'security-reviewer': '# Security review'
    });
    const targetDir = join(root, 'target');
    materializeEccAgents({ cacheDir, targetDir });

    expect(listMaterializedAgents(targetDir)).toEqual(['code-reviewer', 'security-reviewer']);
    expect(readMaterializedAgent('code-review', targetDir)).toBeNull();
    expect(resolveMaterializedAgentName(['code-reviewer', 'code-review'], targetDir)).toBe('code-reviewer');
  });

  it('prefers the caller candidate order when both names are materialized', () => {
    const root = tmpRoot();
    const cacheDir = writeCache(root, { 'code-review': '# legacy', 'code-reviewer': '# real' });
    const targetDir = join(root, 'target');
    materializeEccAgents({ cacheDir, targetDir });

    expect(resolveMaterializedAgentName(['code-reviewer', 'code-review'], targetDir)).toBe('code-reviewer');
    expect(resolveMaterializedAgentName(['code-review', 'code-reviewer'], targetDir)).toBe('code-review');
  });

  it('keeps backward compatibility when only the legacy `code-review` exists', () => {
    const root = tmpRoot();
    const cacheDir = writeCache(root, { 'code-review': '# legacy' });
    const targetDir = join(root, 'target');
    materializeEccAgents({ cacheDir, targetDir });

    expect(resolveMaterializedAgentName(['code-reviewer', 'code-review'], targetDir)).toBe('code-review');
  });

  it('falls back deterministically to a `code-*reviewer` agent when no candidate matches verbatim', () => {
    const root = tmpRoot();
    const cacheDir = writeCache(root, { 'code-quality-reviewer': '# variant' });
    const targetDir = join(root, 'target');
    materializeEccAgents({ cacheDir, targetDir });

    expect(resolveMaterializedAgentName(['code-reviewer', 'code-review'], targetDir)).toBe('code-quality-reviewer');
  });

  it('returns null when nothing matches, so the caller can degrade to inline', () => {
    const root = tmpRoot();
    const cacheDir = writeCache(root, { 'security-reviewer': '# unrelated' });
    const targetDir = join(root, 'target');
    materializeEccAgents({ cacheDir, targetDir });

    expect(resolveMaterializedAgentName(['code-reviewer', 'code-review'], targetDir)).toBeNull();
    expect(resolveMaterializedAgentName(['code-reviewer'], join(root, 'missing-dir'))).toBeNull();
  });

  it('prunes stale materialized copies no longer shipped by the active cache', () => {
    const root = tmpRoot();
    const cacheDir = writeCache(root, { 'code-review': '# ok' });
    const targetDir = join(root, 'target');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'removed-agent.md'), '# stale');

    const result = materializeEccAgents({ cacheDir, targetDir });

    expect(result.materialized).toEqual(['code-review']);
    expect(existsSync(join(targetDir, 'removed-agent.md'))).toBe(false);
  });
});
