// tests/unit/standards/gate-module-set.test.ts
//
// The anti-vacuity pair for the pooled gate pins (rid 2026-10-02-wave9-gate-entry-split).
//
// WHY A FILE OF ITS OWN. `.husky/peaks-gate.mjs` reached 1019 raw lines — over the
// cap its own hooks row measures — and its regions are now `.husky/gate/*.mjs`. The
// guards that pinned a wiring fact by reading THAT ONE FILE had to start reading the
// module SET (`gateModuleText` in `_file-size-cap-scan.ts`), because the symbol they
// pin moved. A pool that cannot be watched failing is a pool that asserts nothing, so
// the plant arm and the inverse arm live here, collected, next to the helper they
// observe. This file is also the sibling the cap itself wants: `file-size-cap.test.ts`
// is a capped file under `tests/`, and adding these arms to it pushed it over the cap
// — the same reason `_file-size-hooks-walk.ts` was extracted from its harness.
//
// NOTHING IS WRITTEN INTO THE REPOSITORY (backlog §2.31). Both arms build trees under
// `mkdtempSync(join(tmpdir(), …))` via `withFixtureTree`, which removes them itself.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  GATE_ENTRY_REL,
  gateModulePaths,
  gateModuleText,
  withFixtureTree
} from './_file-size-cap-scan.js';

declareDimensions(
  'tests/unit/standards/gate-module-set.test.ts',
  ['behavior', 'integration'],
  [
    {
      dim: 'render',
      reason:
        'the pooled reader prints nothing: its only output is the set of paths and the text a pin reads, both asserted in the arms below'
    },
    {
      dim: 'a11y',
      reason:
        'no human-visible surface is produced here — the refusal texts live in the gate itself and are guarded by `file-size-gate-leg.test.ts`'
    }
  ]
);

describe('Scenario: behavior — a pooled gate pin finds a symbol in whichever module holds it', () => {
  it('reads a symbol planted in exactly one sibling, and goes red when no module has it', () => {
    // PLANT. The symbol is in ONE sibling and nowhere else. A reader that opened only
    // the entry would call this a missing wiring; the pooled reader names it, and the
    // count below proves it read the sibling rather than restating the string.
    withFixtureTree(
      {
        [GATE_ENTRY_REL]: "import { lintFileList } from 'x';\n",
        '.husky/gate/legs.mjs': "import { FS_CEILING_KEY } from 'y';\n",
        '.husky/gate/repo.mjs': 'export const nothing = 1;\n'
      },
      (root) => {
        const paths = gateModulePaths(root);
        expect(paths.length, paths.join(', ')).toBe(3);
        expect(paths.some((file) => file.endsWith(join('gate', 'legs.mjs')))).toBe(true);
        const text = gateModuleText(root);
        expect(text).toContain('FS_CEILING_KEY');
        expect(text.match(/FS_CEILING_KEY/g) ?? []).toHaveLength(1);
      }
    );

    // INVERSE. The same set with the symbol in NO module must read absent: the pooled
    // assertion the gate pins use would fail here, which is what makes it a check.
    withFixtureTree(
      {
        [GATE_ENTRY_REL]: "import { lintFileList } from 'x';\n",
        '.husky/gate/legs.mjs': 'export const nothing = 1;\n',
        '.husky/gate/repo.mjs': 'export const alsoNothing = 1;\n'
      },
      (root) => {
        expect(gateModulePaths(root)).toHaveLength(3);
        expect(gateModuleText(root)).not.toContain('FS_CEILING_KEY');
      }
    );
  });
});

describe('Scenario: integration — the set is walked, so a new sibling is read unlisted', () => {
  it('grows the pooled read when a module appears under .husky/gate/, editing no list', () => {
    // The defect this slice keeps re-meeting (§2.28) is a hand-kept name list drifting
    // from the tree. `gateModulePaths` has no list of module names, so a fifth module
    // joins the set — and its text joins the pool — with nothing edited anywhere.
    const base = {
      [GATE_ENTRY_REL]: 'export const entry = 1;\n',
      '.husky/gate/legs.mjs': "import { FS_CEILING_KEY } from 'y';\n"
    };
    withFixtureTree(base, (root) => {
      expect(gateModulePaths(root)).toHaveLength(2);
      expect(gateModuleText(root)).not.toContain('printFileSizeLeg(');
      writeFileSync(join(root, '.husky', 'gate', 'modes.mjs'), 'printFileSizeLeg(size);\n', 'utf8');
      const paths = gateModulePaths(root);
      expect(paths, paths.join(', ')).toHaveLength(3);
      expect(gateModuleText(root)).toContain('printFileSizeLeg(');
    });
  });

  it('reads the real gate as a set whose head is the path every spawn site uses', () => {
    // The entry path is what `.husky/pre-commit`, `package.json` and five test files
    // spawn; the pool must EXTEND that surface, not move it.
    const paths = gateModulePaths();
    expect(paths[0]?.split(/[\\/]/).join('/')).toBe('.husky/peaks-gate.mjs');
    expect(paths.length).toBeGreaterThan(1);
    for (const file of paths) {
      expect(file.split(/[\\/]/).join('/'), file).toMatch(/^\.husky\/(gate\/)?[\w-]+\.mjs$/);
    }
  });
});
