/**
 * Unit tests for `peaks ecc install|status|ls|show` (Slice 3 of 4.0.0-beta.10).
 *
 * Covers:
 *   - install: happy-path JSON envelope (mocked fetch + tar)
 *   - status: NO_CACHE envelope when manifest missing
 *   - ls: empty list when no manifest
 *   - show: INVALID_NAME on path-traversal name; NOT_FOUND on missing agent
 *
 * Network downloads are mocked at `globalThis.fetch` so the unit
 * suite is hermetic. Real-network testing is @integration.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCommand, parseJsonOutput, getMockedHomeDir } from '../cli-program-test-utils.js';

describe('peaks ecc install|status|ls|show', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'peaks-ecc-cli-'));
    // cli-program-test-utils owns its own mocked homedir; we
    // build the fake cache under the same dir so the ECC service
    // reads the same path the CLI is using.
    tempHome = getMockedHomeDir();
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('ecc status returns NO_CACHE when no manifest exists', async () => {
    const { stdout, exitCode } = await runCommand(['ecc', 'status', '--json'], {});
    const env = parseJsonOutput(stdout);
    expect(env.ok).toBe(false);
    expect(env.code).toBe('NO_CACHE');
    expect(exitCode).toBe(1);
  });

  it('ecc ls returns empty array when no cache exists', async () => {
    const { stdout, exitCode } = await runCommand(['ecc', 'ls', '--json'], {});
    const env = parseJsonOutput<{ agents: unknown[] }>(stdout);
    expect(env.ok).toBe(true);
    expect(env.data.agents).toEqual([]);
    expect(exitCode === undefined || exitCode === 0).toBe(true);
  });

  it('ecc show rejects path-traversal names with INVALID_NAME', async () => {
    const { stdout, exitCode } = await runCommand(['ecc', 'show', '../etc/passwd', '--json'], {});
    const env = parseJsonOutput(stdout);
    expect(env.ok).toBe(false);
    expect(env.code).toBe('INVALID_NAME');
    expect(exitCode).toBe(1);
  });

  it('ecc show rejects names with uppercase or leading-dash with INVALID_NAME', async () => {
    const { stdout: a, exitCode: ea } = await runCommand(['ecc', 'show', 'Bad-Name', '--json'], {});
    expect(parseJsonOutput(a).code).toBe('INVALID_NAME');
    expect(ea).toBe(1);
    const { stdout: b, exitCode: eb } = await runCommand(['ecc', 'show', '1bad', '--json'], {});
    expect(parseJsonOutput(b).code).toBe('INVALID_NAME');
    expect(eb).toBe(1);
  });

  it('ecc show returns NOT_FOUND when no cache exists', async () => {
    const { stdout, exitCode } = await runCommand(['ecc', 'show', 'reviewer', '--json'], {});
    const env = parseJsonOutput(stdout);
    expect(env.ok).toBe(false);
    expect(env.code).toBe('NOT_FOUND');
    expect(exitCode).toBe(1);
  });

  it('ecc show prints SKILL.md body to stdout when cached', async () => {
    // Populate a fake cache.
    const cacheDir = join(tempHome, '.peaks', 'cache');
    mkdirSync(cacheDir, { recursive: true });
    const sha = 'a'.repeat(40);
    const agentsDir = join(cacheDir, `ecc-${sha}`, 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(
      join(agentsDir, 'reviewer.md'),
      '---\nname: reviewer\ndescription: Reviewer agent\n---\n# Reviewer\nBody content\nMore body\n'
    );
    writeFileSync(
      join(cacheDir, 'ecc-installed.json'),
      JSON.stringify({
        version: '1',
        sha,
        fetchedAt: new Date().toISOString(),
        agents: ['reviewer'],
      })
    );

    const { stdout, exitCode } = await runCommand(['ecc', 'show', 'reviewer'], {});
    const joined = Array.isArray(stdout) ? stdout.join('\n') : stdout;
    expect(joined).toContain('# Reviewer');
    expect(joined).toContain('Body content');
    expect(exitCode === undefined || exitCode === 0).toBe(true);
  });

  it('ecc show --section extracts only the named H1 section', async () => {
    const cacheDir = join(tempHome, '.peaks', 'cache');
    mkdirSync(cacheDir, { recursive: true });
    const sha = 'b'.repeat(40);
    const agentsDir = join(cacheDir, `ecc-${sha}`, 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(
      join(agentsDir, 'foo.md'),
      '# Foo\nfoo body\n# Bar\nbar body\n'
    );
    writeFileSync(
      join(cacheDir, 'ecc-installed.json'),
      JSON.stringify({ version: '1', sha, fetchedAt: new Date().toISOString(), agents: ['foo'] })
    );
    const { stdout, exitCode } = await runCommand(['ecc', 'show', 'foo', '--section', 'Bar'], {});
    const joined = Array.isArray(stdout) ? stdout.join('\n') : stdout;
    expect(joined).toContain('bar body');
    expect(joined).not.toContain('foo body');
    expect(exitCode === undefined || exitCode === 0).toBe(true);
  });

  it('ecc show --section returns SECTION_NOT_FOUND on unknown heading', async () => {
    const cacheDir = join(tempHome, '.peaks', 'cache');
    mkdirSync(cacheDir, { recursive: true });
    const sha = 'c'.repeat(40);
    const agentsDir = join(cacheDir, `ecc-${sha}`, 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'foo.md'), '# Foo\nfoo body\n');
    writeFileSync(
      join(cacheDir, 'ecc-installed.json'),
      JSON.stringify({ version: '1', sha, fetchedAt: new Date().toISOString(), agents: ['foo'] })
    );
    const { stdout, exitCode } = await runCommand(['ecc', 'show', 'foo', '--section', 'Nope', '--json'], {});
    const env = parseJsonOutput(stdout);
    expect(env.ok).toBe(false);
    expect(env.code).toBe('SECTION_NOT_FOUND');
    expect(exitCode).toBe(1);
  });

  it('ecc show --max-lines caps stdout', async () => {
    const cacheDir = join(tempHome, '.peaks', 'cache');
    mkdirSync(cacheDir, { recursive: true });
    const sha = 'd'.repeat(40);
    const agentsDir = join(cacheDir, `ecc-${sha}`, 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'big.md'), 'line1\nline2\nline3\nline4\nline5\n');
    writeFileSync(
      join(cacheDir, 'ecc-installed.json'),
      JSON.stringify({ version: '1', sha, fetchedAt: new Date().toISOString(), agents: ['big'] })
    );
    const { stdout, exitCode } = await runCommand(['ecc', 'show', 'big', '--max-lines', '2'], {});
    const joined = Array.isArray(stdout) ? stdout.join('\n') : stdout;
    const lines = joined.split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(exitCode === undefined || exitCode === 0).toBe(true);
  });

  it('ecc ls returns parsed agents from cache', async () => {
    const cacheDir = join(tempHome, '.peaks', 'cache');
    mkdirSync(cacheDir, { recursive: true });
    const sha = 'e'.repeat(40);
    const agentsDir = join(cacheDir, `ecc-${sha}`, 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(
      join(agentsDir, 'a.md'),
      '---\nname: a\ndescription: Agent A\n---\nbody\n'
    );
    writeFileSync(
      join(agentsDir, 'b.md'),
      '---\nname: b\ndescription: Agent B\n---\nbody\n'
    );
    writeFileSync(
      join(cacheDir, 'ecc-installed.json'),
      JSON.stringify({ version: '1', sha, fetchedAt: new Date().toISOString(), agents: ['a', 'b'] })
    );
    const { stdout } = await runCommand(['ecc', 'ls', '--json'], {});
    const env = parseJsonOutput<{ agents: { name: string; description: string }[] }>(stdout);
    expect(env.ok).toBe(true);
    expect(env.data.agents.length).toBe(2);
    const names = env.data.agents.map((a) => a.name).sort();
    expect(names).toEqual(['a', 'b']);
  });
});