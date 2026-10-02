// tests/unit/lint/gate-module-staging.test.ts
//
// The staging arm for the hooks fixture's copy set (rid 2026-10-02-wave9-gate-entry-split).
//
// WHY A FILE OF ITS OWN. The arms below observe `_file-size-hooks-fixture.ts`, and
// that harness is a capped file under `tests/`: adding them there pushed it over the
// 500-line cap — which is the same defect the slice exists to remove, so they live
// here instead. The division is the one `_file-size-hooks-walk.ts` already uses.
//
// WHAT THE FIXTURE OWES THE WAVE-7 INCIDENT IT REPEATED. The copy list named four
// `.husky/` files by hand, and the day `.husky/peaks-gate.mjs` grew regions into
// `.husky/gate/*.mjs` the fixture's copy of the entry died at LOAD inside its temp
// repo: `ERR_MODULE_NOT_FOUND: …\.husky\gate\changed.mjs`, exit 1, no output — nine
// arms across three files went red for a reason that had nothing to do with what they
// guard. A guard whose harness cannot follow the tree is a guard that fails loudly at
// the wrong moment; the PLANT arm below is what makes it fail at the RIGHT one.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { GATE_ENTRY_REL, REPO_ROOT, gateModulePaths } from '../standards/_file-size-cap-scan.js';
import { FIXTURE_COPIED_FILES, hooksScopeFilesUnder } from './_file-size-hooks-fixture.js';

declareDimensions(
  'tests/unit/lint/gate-module-staging.test.ts',
  ['behavior', 'integration'],
  [
    {
      dim: 'render',
      reason:
        'the subject is a set of staged paths, not output text; the leg output shapes are rendered and asserted in `file-size-hooks-gate-leg.test.ts`'
    },
    {
      dim: 'a11y',
      reason:
        'no operator-facing message is emitted by the copy set; the breach texts are guarded by the hooks leg file this harness belongs to'
    }
  ]
);

const norm = (file: string): string => file.split(/[\\/]/).join('/');

describe('Scenario: behavior — the staged set is a walk, so it cannot go stale', () => {
  it('grows when a module appears under .husky/gate/ and ignores a non-module', () => {
    const root = mkdtempSync(join(tmpdir(), 'peaks-copyset-'));
    try {
      const before = hooksScopeFilesUnder(root);
      expect(before, `a tree with no .husky/ stages nothing: ${before.join(', ')}`).toEqual([]);
      const write = (rel: string, text: string): void => {
        const abs = join(root, rel);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, text, 'utf8');
      };
      write(join('.husky', 'peaks-gate.mjs'), 'export const entry = 1;\n');
      write(join('.husky', 'gate', 'legs.mjs'), 'export const leg = 1;\n');
      expect(hooksScopeFilesUnder(root)).toEqual(['.husky/gate/legs.mjs', '.husky/peaks-gate.mjs']);
      // PLANT: a new region module joins the staged set with nothing edited here or in
      // the harness — which is precisely the edit the fixed list required, and missed.
      write(join('.husky', 'gate', 'modes.mjs'), 'export const mode = 1;\n');
      expect(hooksScopeFilesUnder(root)).toHaveLength(3);
      // And the rule is the CENSUS's rule, not "everything in the directory": a file
      // `.husky/` holds but the policy does not measure is not staged.
      write(join('.husky', 'notes.txt'), 'not a module\n');
      write(join('.husky', '_', 'husky.sh'), '#!/bin/sh\n');
      expect(hooksScopeFilesUnder(root)).toHaveLength(3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('Scenario: integration — what the fixture stages covers what the gate imports', () => {
  it('stages every module the real gate is made of, and its head is the spawned entry', () => {
    // The two enumerations must agree on the REAL tree: `gateModulePaths` is what the
    // pooled pins read, `hooksScopeFilesUnder` is what the fixture copies. A region
    // the entry imports and the fixture does not stage is the wave-7 crash, so this
    // arm is the one that would have caught it before the run.
    const modules = gateModulePaths();
    expect(modules.length, 'the gate is more than one file now').toBeGreaterThan(1);
    expect(norm(modules[0] ?? ''), 'pool head').toBe('.husky/peaks-gate.mjs');
    expect(norm(GATE_ENTRY_REL)).toBe('.husky/peaks-gate.mjs');
    for (const file of modules) {
      expect(FIXTURE_COPIED_FILES.map(norm), file).toContain(norm(file));
    }
    // And the copy set is the walk, not a list: the `.husky/` entries of
    // `FIXTURE_COPIED_FILES` are exactly what the walk returns for the real tree.
    const stagedHusky = FIXTURE_COPIED_FILES.map(norm).filter((file) => file.startsWith('.husky/'));
    expect(stagedHusky).toEqual(hooksScopeFilesUnder(REPO_ROOT));
  });

  it('stages the entry the pre-commit hook and package.json name, unchanged', () => {
    // W3 in one assertion: the split must not move the path the hook spawns.
    expect(gateModulePaths()[0]).toBe(GATE_ENTRY_REL);
  });
});
