// Slice B1 (2026-09-09-ecc-dynamic-and-cleanup) — `getInstalledCapabilityIds`
// used to return `[]` unconditionally, so the capability catalog could never
// report anything installed. These cases pin the read-only detection rules.

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { detectInstalledCapabilityIds } from '../../../../src/services/recommendations/installed-capability-detector.js';

const roots: string[] = [];

function tmpRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-installed-cap-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

const ECC_IDS = [
  'everything-claude-code.code-review-agent',
  'everything-claude-code.code-review-guidance',
  'everything-claude-code.language-standards',
  'everything-claude-code.security-review-agent',
  'everything-claude-code.security-review-guidance'
];

const CODEGRAPH_IDS = [
  'codegraph.context-pack',
  'codegraph.impact-analysis',
  'codegraph.project-indexing',
  'codegraph.semantic-query'
];

describe('detectInstalledCapabilityIds', () => {
  it('returns nothing when neither the ECC cache nor any npm dep is present', () => {
    const root = tmpRoot();
    expect(detectInstalledCapabilityIds({ projectRoot: root, eccCacheAvailable: false })).toEqual([]);
  });

  it('reports every everything-claude-code capability when the ECC cache is populated', () => {
    const root = tmpRoot();
    const installed = detectInstalledCapabilityIds({ projectRoot: root, eccCacheAvailable: true });
    expect(installed).toEqual(ECC_IDS);
  });

  it('reports codegraph capabilities when the npm package is present in node_modules', () => {
    const root = tmpRoot();
    mkdirSync(join(root, 'node_modules', 'codegraph'), { recursive: true });
    const installed = detectInstalledCapabilityIds({ projectRoot: root, eccCacheAvailable: false });
    expect(installed).toEqual(CODEGRAPH_IDS);
  });

  it('reports codegraph capabilities when only the .bin shim is present', () => {
    const root = tmpRoot();
    mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true });
    mkdirSync(join(root, 'node_modules', '.bin', 'codegraph'));
    const installed = detectInstalledCapabilityIds({ projectRoot: root, eccCacheAvailable: false });
    expect(installed).toEqual(CODEGRAPH_IDS);
  });

  it('merges ECC + npm evidence and keeps the list sorted', () => {
    const root = tmpRoot();
    mkdirSync(join(root, 'node_modules', 'codegraph'), { recursive: true });
    const installed = detectInstalledCapabilityIds({ projectRoot: root, eccCacheAvailable: true });
    expect(installed).toEqual([...CODEGRAPH_IDS, ...ECC_IDS].sort());
  });

  it('honors an explicit nodeModulesDir override', () => {
    const root = tmpRoot();
    const elsewhere = join(root, 'elsewhere', 'node_modules');
    mkdirSync(join(elsewhere, 'codegraph'), { recursive: true });
    const installed = detectInstalledCapabilityIds({
      projectRoot: join(root, 'project-without-deps'),
      nodeModulesDir: elsewhere,
      eccCacheAvailable: false
    });
    expect(installed).toEqual(CODEGRAPH_IDS);
  });
});
