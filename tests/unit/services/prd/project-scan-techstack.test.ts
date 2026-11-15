// tests/unit/services/prd/project-scan-techstack.test.ts
//
// WHY THIS FILE EXISTS. The create path used to hard-code `techStack: {}` and a
// `Language | TypeScript (best-effort — re-confirm via package.json devDeps)`
// table row, so the FIRST write of a project scan was already uninformative.
// `deriveTechStack` is what replaced that: every value is read from the project,
// which is what makes a machine-field refresh worth running at all.
//
// The cases here pin the three decisions that are easy to get subtly wrong:
//   - a manifest's own `packageManager` beats a competing lockfile (the author's
//     statement outranks an inference);
//   - `language` follows a real typescript dependency or `tsconfig.json`, never a
//     literal;
//   - a malformed manifest degrades to the fields that need no manifest instead of
//     refusing the refresh entirely — `scanLibraries` already reports it.
//
// Dimensions covered:
//   - behavior:    input -> derived map, including the malformed-manifest path
//   - integration: real temp project roots and this repository's own manifest
//
// Dimensions omitted:
//   - render: nothing is rendered here; the frontmatter form is covered in
//     `project-scan-field-refresh.test.ts`.
//   - a11y: no user-visible text or exit code.

import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { deriveTechStack, mergeTechStack } from '~/src/services/prd/project-scan-techstack';

declareDimensions(
  'tests/unit/services/prd/project-scan-techstack.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'nothing is rendered; the frontmatter form is covered elsewhere' },
    { dim: 'a11y', reason: 'no user-visible text or exit code' }
  ]
);

const tempRoots: string[] = [];

function makeRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

/** A project root whose package.json declares exactly one build script. */
function makeRootWithBuild(build: string): string {
  const root = makeRoot('peaks-build-');
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'x', scripts: { build } }, null, 2),
    'utf8'
  );
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('(behavior) the tech-stack derivation', () => {
  it('when the manifest declares a packageManager, should prefer it over lockfile detection', () => {
    // given: a manifest with `packageManager` plus a competing lockfile
    // when: the tech stack is derived
    // then: the manifest wins, because it is the author's statement
    const root = makeRoot('peaks-techstack-pm-');
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ packageManager: 'pnpm@10.11.0' }),
      'utf8'
    );
    writeFileSync(join(root, 'package-lock.json'), '{}', 'utf8');

    const techStack = deriveTechStack(root);

    expect(techStack.packageManager).toBe('pnpm@10.11.0');
  });

  it('when the manifest declares typescript, should report the language as typescript', () => {
    // given: a manifest with typescript in devDependencies
    // when: the tech stack is derived
    // then: the language follows the dependency, not a literal string
    const root = makeRoot('peaks-techstack-ts-');
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ devDependencies: { typescript: '^5.7.2' } }),
      'utf8'
    );

    const techStack = deriveTechStack(root);

    expect(techStack.language).toBe('typescript');
  });

  it('when the manifest is malformed, should degrade to the fields that need no manifest', () => {
    // given: a project whose package.json is not JSON, plus a pnpm lockfile
    // when: the tech stack is derived
    // then: the lockfile still names the manager and the runtime is the active one
    const root = makeRoot('peaks-techstack-bad-');
    writeFileSync(join(root, 'package.json'), '{ not json', 'utf8');
    writeFileSync(join(root, 'pnpm-lock.yaml'), '', 'utf8');

    const techStack = deriveTechStack(root);

    expect(techStack.packageManager).toBe('pnpm');
    expect(techStack.runtime).toContain(process.versions.node);
    expect(techStack).not.toHaveProperty('buildTool');
  });
});

describe('(integration) the derivation against a real manifest', () => {
  it('when a copy of this repository is scanned, should derive its tech stack from its own manifest', () => {
    // given: this repository's real package.json
    // when: the tech stack is derived
    // then: the values are the manifest's, not the best-effort literals
    const root = makeRoot('peaks-techstack-self-');
    copyFileSync(join(process.cwd(), 'package.json'), join(root, 'package.json'));

    const techStack = deriveTechStack(root);

    expect(techStack.language).toBe('typescript');
    expect(techStack.packageManager).toBe('pnpm@10.11.0');
    // the build script is the manifest's own, truncated at the snapshot bound
    expect(techStack.buildTool).toContain('scripts/sync-version.mjs');
  });
});

describe('(behavior) the merge against the map already on disk', () => {
  it('when the owner corrected a key the derivation also produces, should let the derivation win', () => {
    // given: a human-edited packageManager
    // when: the derivation produces its own value for that key
    // then: the derived value wins — the rule AC-5 rests on, stated so it is testable
    const merged = mergeTechStack(
      { packageManager: 'pnpm (corepack, pinned)' },
      { packageManager: 'pnpm' }
    );

    expect(merged['packageManager']).toBe('pnpm');
  });

  it('when the owner added a row the derivation does not produce, should carry it over', () => {
    // given: an existing map with a row no derivation knows about
    // when: it is merged with a fresh derivation
    // then: the owner's row survives and the derived rows are current
    const merged = mergeTechStack(
      { language: 'typescript', lintTool: 'eslint@8.57.1', testRunner: 'vitest (pinned)' },
      { language: 'typescript', packageManager: 'pnpm', runtime: 'node v24' }
    );

    expect(merged['lintTool']).toBe('eslint@8.57.1');
    expect(merged['testRunner']).toBe('vitest (pinned)');
    expect(merged['packageManager']).toBe('pnpm');
  });

  it('when the build script was removed, should drop the stale buildTool instead of resurrecting it', () => {
    // given: an existing map recording a buildTool that no longer has a source
    // when: the derivation produces no buildTool (the project deleted the script)
    // then: the stale value is gone — a machine fact with no source is not sediment
    const merged = mergeTechStack(
      { language: 'typescript', buildTool: 'tsc -p tsconfig.build.json', lintTool: 'eslint' },
      { language: 'typescript', packageManager: 'pnpm', runtime: 'node v24' }
    );

    expect(merged).not.toHaveProperty('buildTool');
    expect(merged['lintTool']).toBe('eslint');
  });

  it('when the derived buildTool is truncated and the file has a fuller one, should keep the file', () => {
    // given: a long scripts.build that the derivation cuts at its bound, and an
    //        owner-written buildTool that says what the build actually is
    // when: the merge runs
    // then: the fuller value wins — a truncated value is less informative
    const longScript = `node ./a.mjs && node ./b.mjs && pnpm -r --filter "./packages/*" run build && ${'x'.repeat(30)}`;
    const derived = deriveTechStack(makeRootWithBuild(longScript));
    const merged = mergeTechStack({ buildTool: 'tsc -p tsconfig.build.json' }, derived);

    expect(derived['buildTool']).toMatch(/…$/);
    expect(merged['buildTool']).toBe('tsc -p tsconfig.build.json');
  });

  it('when the derived buildTool is short enough to be complete, should let it replace the file value', () => {
    // given: a short, complete scripts.build
    // when: the merge runs
    // then: the derived value wins — it is not truncated, so it is current fact
    const derived = deriveTechStack(makeRootWithBuild('tsc -p tsconfig.build.json'));
    const merged = mergeTechStack({ buildTool: 'some stale hand note' }, derived);

    expect(merged['buildTool']).toBe('tsc -p tsconfig.build.json');
  });
});
