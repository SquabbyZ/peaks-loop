// tests/unit/packages/peaks-loop-shared.test.ts
//
// 4-dimension unit test for peaks-loop-shared's three submodules:
// fs (pathExists / readText / listDirectories / isDirectory),
// paths (requiredSkillNames / requiredSchemaFiles / dirs),
// version (CLI_VERSION).
//
// Dimensions covered:
//   - render:    the catalog of required skills + schemas
//   - behavior:  fs helpers return correct truthy/falsy values
//                against the real filesystem
//   - integration: real fs read under tmp workspace
//   - a11y:      not applicable
//
// Run with: pnpm vitest run tests/unit/packages/peaks-loop-shared.test.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../_setup/tmp-workspace.js';

declareDimensions(
  'tests/unit/packages/peaks-loop-shared.test.ts',
  ['render', 'behavior', 'integration'],
  [{ dim: 'a11y', reason: 'no user-facing text or exit code' }],
);

import { isDirectory, listDirectories, pathExists, readText } from 'peaks-loop-shared/fs';
import { CLI_VERSION } from 'peaks-loop-shared/version';
import { requiredSchemaFiles, requiredSkillNames } from 'peaks-loop-shared/paths';

describe('render — peaks-loop-shared/paths catalog', () => {
  it('requiredSkillNames has the 8 documented skill ids', () => {
    expect([...requiredSkillNames].sort()).toEqual([
      'peaks-code',
      'peaks-prd',
      'peaks-qa',
      'peaks-rd',
      'peaks-sc',
      'peaks-sop',
      'peaks-txt',
      'peaks-ui',
    ]);
  });

  it('requiredSchemaFiles is non-empty and every entry ends with .schema.json', () => {
    expect(requiredSchemaFiles.length).toBeGreaterThanOrEqual(15);
    for (const f of requiredSchemaFiles) {
      expect(f).toMatch(/^[A-Za-z0-9-]+\.schema\.json$/);
    }
  });

  it('no duplicate skill names', () => {
    expect(new Set(requiredSkillNames).size).toBe(requiredSkillNames.length);
  });

  it('no duplicate schema file names', () => {
    expect(new Set(requiredSchemaFiles).size).toBe(requiredSchemaFiles.length);
  });
});

describe('render — peaks-loop-shared/version', () => {
  it('CLI_VERSION is a non-empty semver-shaped string', () => {
    expect(typeof CLI_VERSION).toBe('string');
    expect(CLI_VERSION.length).toBeGreaterThan(0);
    expect(CLI_VERSION).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
  });
});

describe('behavior + integration — peaks-loop-shared/fs', () => {
  withTmpWorkspacePerTest();

  it('pathExists: returns true for an existing file', async () => {
    const f = join(process.cwd(), 'a.txt');
    writeFileSync(f, 'hi', 'utf8');
    expect(await pathExists(f)).toBe(true);
  });

  it('pathExists: returns false for a missing path (no throw)', async () => {
    expect(await pathExists(join(process.cwd(), 'nope'))).toBe(false);
  });

  it('readText: returns the file contents verbatim', async () => {
    const f = join(process.cwd(), 'r.txt');
    writeFileSync(f, 'hello\nworld', 'utf8');
    expect(await readText(f)).toBe('hello\nworld');
  });

  it('readText: rejects with ENOENT for a missing file', async () => {
    await expect(readText(join(process.cwd(), 'missing.txt'))).rejects.toThrow();
  });

  it('listDirectories: returns sorted sub-directory names (files are filtered out)', async () => {
    const root = process.cwd();
    mkdirSync(join(root, 'a-dir'), { recursive: true });
    mkdirSync(join(root, 'b-dir'), { recursive: true });
    writeFileSync(join(root, 'note.txt'), 'noise', 'utf8');
    const out = await listDirectories(root);
    expect(out).toEqual(['a-dir', 'b-dir']);
  });

  it('listDirectories: rejects for a non-existent path', async () => {
    await expect(listDirectories(join(process.cwd(), 'no-such-dir'))).rejects.toThrow();
  });

  it('isDirectory: true for an existing directory', async () => {
    const d = join(process.cwd(), 'a-dir');
    mkdirSync(d, { recursive: true });
    expect(await isDirectory(d)).toBe(true);
  });

  it('isDirectory: false for an existing file (not a directory)', async () => {
    const f = join(process.cwd(), 'a.txt');
    writeFileSync(f, 'x', 'utf8');
    expect(await isDirectory(f)).toBe(false);
  });

  it('isDirectory: false for a missing path (no throw)', async () => {
    expect(await isDirectory(join(process.cwd(), 'nope'))).toBe(false);
  });
});
