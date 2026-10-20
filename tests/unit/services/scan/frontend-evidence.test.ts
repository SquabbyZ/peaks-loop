import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { readRootBin } from '../../../../src/services/scan/frontend-evidence.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';

const ws = withTmpWorkspacePerTest('peaks-frontend-evidence-');

function writeManifest(content: string): string {
  const root = ws().path;
  writeFileSync(join(root, 'package.json'), content, 'utf8');
  return root;
}

describe('readRootBin', () => {
  it('when package.json is absent, should return false', async () => {
    // given: a project root with no manifest at all
    const projectRoot = ws().path;
    // when: the bin probe runs
    const hasBin = await readRootBin(projectRoot);
    // then: an absent manifest is not a CLI claim
    expect(hasBin).toBe(false);
  });

  it('when package.json is not valid JSON, should return false', async () => {
    // given: a manifest that cannot be parsed
    const projectRoot = writeManifest('{ "bin": ');
    // when: the bin probe runs
    const hasBin = await readRootBin(projectRoot);
    // then: an unreadable manifest yields no bin evidence
    expect(hasBin).toBe(false);
  });

  it('when bin is an empty object, should return false', async () => {
    // given: a manifest whose bin object names no command
    const projectRoot = writeManifest(JSON.stringify({ bin: {} }));
    // when: the bin probe runs
    const hasBin = await readRootBin(projectRoot);
    // then: an empty bin is not a CLI claim
    expect(hasBin).toBe(false);
  });

  it('when bin is a non-empty object, should return true', async () => {
    // given: the object form peaks itself uses
    const projectRoot = writeManifest(JSON.stringify({ bin: { peaks: './bin/peaks.js' } }));
    // when: the bin probe runs
    const hasBin = await readRootBin(projectRoot);
    // then: a named command is a CLI claim
    expect(hasBin).toBe(true);
  });

  it('when bin is a non-empty string, should return true', async () => {
    // given: the single-command string form
    const projectRoot = writeManifest(JSON.stringify({ bin: './bin/peaks.js' }));
    // when: the bin probe runs
    const hasBin = await readRootBin(projectRoot);
    // then: a path string is a CLI claim
    expect(hasBin).toBe(true);
  });
});
