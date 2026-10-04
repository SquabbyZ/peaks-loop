// The ECC source: the `ecc-universal` dependency, and the roster readers that
// render it.
//
// Two things are pinned here that the download layer could not be pinned for:
//   1. that the dependency actually resolves and ships the agents this whole
//      path reads — the assertion that turns "we replaced the fetch with a
//      dependency" from a claim into a measurement;
//   2. the D-009 warn-once fallback, which moved with the roster reader from the
//      deleted cache manifest.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ECC_PACKAGE_NAME,
  eccPackageInfo,
  listEccAgents,
  readEccPackageVersion,
  resolveEccAgentsDir,
  resolveEccPackageRoot
} from '../../../../packages/peaks-loop-mut/src/services/agent/ecc-package-service.js';

const roots: string[] = [];

function tmpRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-ecc-source-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe('the ecc-universal dependency is the source', () => {
  it('resolves the package root and reads a version that is not a placeholder', () => {
    const root = resolveEccPackageRoot();
    expect(root.replace(/\\/g, '/')).toContain(ECC_PACKAGE_NAME);
    const version = readEccPackageVersion(root);
    // `unknown` is what a package.json this cannot read yields; a resolved
    // dependency must not.
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
    expect(eccPackageInfo().version).toBe(version);
  });

  it('finds the agents directory and the reviewer Gate B3 dispatches', () => {
    const agentsDir = resolveEccAgentsDir();
    expect(agentsDir.replace(/\\/g, '/')).toMatch(/\/agents$/);
    // The roster is not empty and contains the one name the review fan-out
    // resolves; if upstream ever drops it, this fails here instead of at G4.
    const names = listEccAgents(agentsDir).map((agent) => agent.name);
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain('code-reviewer');
  });
});

describe('listEccAgents D-009 fallback', () => {
  function seed(dir: string, files: Record<string, string>): void {
    mkdirSync(dir, { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(dir, `${name}.md`), body);
    }
  }

  it('reads name and description from well-formed frontmatter', () => {
    const dir = join(tmpRoot(), 'agents');
    seed(dir, {
      'code-reviewer': '---\nname: code-reviewer\ndescription: Reviews diffs\n---\n# Body\n'
    });
    expect(listEccAgents(dir)).toEqual([{ name: 'code-reviewer', description: 'Reviews diffs' }]);
  });

  it('falls back to filename + first body line, and warns exactly once', () => {
    const dir = join(tmpRoot(), 'agents');
    seed(dir, {
      'broken-one': 'no fence at all\nfirst prose line\n',
      'broken-two': 'also broken\nsecond prose line\n'
    });
    const warn = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const listed = listEccAgents(dir);

    expect(listed.map((agent) => agent.name).sort()).toEqual(['broken-one', 'broken-two']);
    // With no frontmatter fence there is no "body below the fence" — the first
    // non-empty line IS the only prose the file offers, so that is the
    // description. The old fence-only reader returned '' here, listing an agent
    // with no description at all.
    expect(listed.find((agent) => agent.name === 'broken-one')?.description).toBe(
      'no fence at all'
    );
    // Two malformed agents, one warning: the latch is process-wide, so a large
    // roster of malformed files cannot bury the notice in repetition.
    const warnings = warn.mock.calls.filter((call) => String(call[0]).includes('malformed'));
    expect(warnings.length).toBe(1);
  });
});
