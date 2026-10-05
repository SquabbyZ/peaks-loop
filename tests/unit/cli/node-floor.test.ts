// tests/unit/cli/node-floor.test.ts
//
// The floor check that `bin/peaks.js` runs BEFORE it imports the app.
//
// It has to be there rather than inside `src/`, because the requirement is a
// module-load requirement: every store now imports `node:sqlite`, and on a Node too old
// for that builtin the failure is an `ERR_UNKNOWN_BUILTIN_MODULE` raised while resolving
// the import graph — before any peaks code of ours has run. A check inside the CLI would be
// compiled into the very module graph that cannot load.
//
// Why a test at all: the failure this turns into a sentence is one a user hits once, on a
// machine they are about to file an issue from, and an opaque stack trace is the worst
// possible artifact of that moment.
//
// Dimensions:
//   - behavior:    the version boundary, per release line
//   - render:      the message an operator reads, including what to do
//   - integration: the same number `package.json#engines.node` declares — the arm that
//                  keeps the two from meaning different things
//   - a11y:        OMITTED — plain stderr text, no structure to navigate

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  MIN_NODE_MAJOR,
  nodeFloorProblem,
  nodeFloorSentence
} from '../../../bin/node-floor.mjs';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/cli/node-floor.test.ts',
  ['behavior', 'render', 'integration'],
  [{ dim: 'a11y', reason: 'one stderr sentence; no navigable structure' }]
);

const REPO_ROOT = join(__dirname, '..', '..', '..');

describe('nodeFloorProblem — where the floor sits', () => {
  it('accepts the version the floor names and anything above it', () => {
    expect(nodeFloorProblem(`${String(MIN_NODE_MAJOR)}.0.0`)).toBeUndefined();
    expect(nodeFloorProblem(`${String(MIN_NODE_MAJOR + 1)}.4.2`)).toBeUndefined();
    expect(nodeFloorProblem(`v${String(MIN_NODE_MAJOR)}.21.0`)).toBeUndefined();
  });

  it('rejects every release line below it, including the one that only flags it', () => {
    // 22.x is the line where `node:sqlite` exists but is not the module this code can
    // import unconditionally; 23.x is the same. Neither gets a "maybe it works" path,
    // because the stores cannot tell a working build from a broken one at runtime.
    expect(nodeFloorProblem('22.14.0')).toMatch(/Node/);
    expect(nodeFloorProblem('23.11.0')).toMatch(/Node/);
    expect(nodeFloorProblem('20.0.0')).toMatch(/Node/);
    expect(nodeFloorProblem('18.19.0')).toMatch(/Node/);
  });

  it('refuses to guess when the version string is not a version', () => {
    // A wrong "too old" is annoying; a wrong "you're fine" is a crash two commands later.
    expect(nodeFloorProblem('')).toBeUndefined();
    expect(nodeFloorProblem('nan.nan.nan')).toMatch(/could not read/);
  });

  it('runs on the interpreter executing this suite, or the suite itself could not load', () => {
    // Not a tautology: the test process imports `node:sqlite` through the stores. If this
    // arm ever fails, the floor in `node-floor.mjs` and the floor this repo can actually
    // test on have drifted apart.
    expect(nodeFloorProblem(process.versions.node)).toBeUndefined();
  });
});

describe('the floor is one number, stated twice', () => {
  it('package.json engines.node and the entry guard agree', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      engines: { node?: string };
    };
    const declared = /^>=(\d+)\.0\.0$/.exec(pkg.engines.node ?? '');
    expect(declared, `engines.node should read ">=${String(MIN_NODE_MAJOR)}.0.0"`).not.toBeNull();
    expect(Number(declared?.[1])).toBe(MIN_NODE_MAJOR);
  });

  it('names the module that costs the upgrade, so the message is a reason and not a rule', () => {
    const sentence = nodeFloorSentence('22.14.0');
    expect(sentence).toContain('node:sqlite');
    expect(sentence).toContain('22.14.0');
    expect(sentence).toContain(`>=${String(MIN_NODE_MAJOR)}`);
  });
});
