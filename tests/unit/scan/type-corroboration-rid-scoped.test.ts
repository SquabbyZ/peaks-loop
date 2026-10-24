// tests/unit/scan/type-corroboration-rid-scoped.test.ts
//
// The declared-type rule judged against the RID's OWN changed paths, with the
// anti-lie fallback beside it.
//
// The old judgement read the whole working tree, so a docs rid was refused for
// another slice's `src/**` change. Scoping alone would be an escape hatch, so
// the fallback refuses a product-source change that NO rid claimed — but only
// when every rid artifact in the session declares its paths, because an
// incomplete table cannot prove "nobody claimed it".
//
// Every case runs in a TEMPORARY git repository with TEMPORARY artifacts: this
// repository's own working tree carries other slices' uncommitted changes, and
// judging it here would produce conclusions about somebody else's work.
//
// Dimensions: behavior (the verdict per scenario), integration (a real git
// repository and a real session tree), render (the two refusal messages), a11y
// (the note that says the fallback stood down).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { runRdTransitionGates } from '../../../src/services/artifacts/rd-transition-gates.js';
import { corroborateDeclaredType } from '../../../src/services/scan/type-corroboration.js';

declareDimensions('tests/unit/scan/type-corroboration-rid-scoped.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

const SESSION_ID = '2026-10-24-rid-scoped';
const RID_A = 'rid-a';
const RID_B = 'rid-b';
const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

function git(root: string, ...args: string[]): void {
  execFileSync('git', ['-C', root, ...args], { stdio: 'pipe', windowsHide: true });
}

/** A temporary repository with one commit, so `HEAD` resolves. */
function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-rid-scoped-'));
  roots.push(root);
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'user.name', 'fixture');
  git(root, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(root, 'README.md'), '# fixture\n', 'utf8');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}

/**
 * An RD artifact for `rid`. `declared: null` means the artifact carries NO
 * `## Changed paths` heading at all — the state that must fall back to the
 * whole working tree.
 */
function writeArtifact(root: string, rid: string, declared: readonly string[] | null): void {
  const path = join(root, '.peaks', '_runtime', SESSION_ID, 'rd', 'requests', `001-${rid}.md`);
  mkdirSync(dirname(path), { recursive: true });
  const head = `# RD Request ${rid}\n\n- session: ${SESSION_ID}\n- type: docs\n`;
  const section =
    declared === null
      ? ''
      : `\n## Changed paths\n\n${declared.map((p) => `changedPath: ${p}`).join('\n')}\n`;
  writeFileSync(path, `${head}${section}\n## Status\n\n- state: spec-locked\n`, 'utf8');
}

/** A changed file in the working tree. */
function put(root: string, relPath: string): void {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, 'export const x = 1;\n', 'utf8');
}

/** The gate, run for `ridA` as a `docs` request. */
function gate(root: string, ridA: string = RID_A): string | null {
  return runRdTransitionGates({
    projectRoot: root,
    declaredType: 'docs',
    allowIncomplete: false,
    phase: 'implemented',
    requestId: ridA,
    sessionId: SESSION_ID
  });
}

describe('Scenario: behavior — the rid-scoped verdict per scenario', () => {
  it('when the rid declares no source and another rid claims the source change, should pass', () => {
    // given: a docs rid that claims only a markdown file, and a feature rid
    //        that claims the src change that is in the working tree
    // when: the docs rid is judged
    // then: it passes — the working tree's src change belongs to the other rid
    const root = makeRepo();
    writeArtifact(root, RID_A, ['docs/a.md']);
    writeArtifact(root, RID_B, ['src/x.ts']);
    put(root, 'src/x.ts');

    const note = gate(root);

    expect(note).toBeNull();
  });

  it('when the rid declares product source itself, should refuse', () => {
    // given: a docs rid whose own declaration names a source file
    // when: the docs rid is judged
    // then: refused — the rule itself forbids a docs rid from carrying source,
    //       whether or not another rid claims the same path
    const root = makeRepo();
    writeArtifact(root, RID_A, ['src/x.ts']);
    put(root, 'src/x.ts');

    let refused: unknown = null;
    try {
      gate(root);
    } catch (error) {
      refused = error;
    }

    expect(refused).not.toBeNull();
    expect((refused as { kind: string }).kind).toBe('source-touched');
  });

  it('when the rid declares product source that another rid also claims, should refuse', () => {
    // given: two rids claiming the same source file
    // when: the docs rid is judged
    // then: refused — a shared claim does not make a docs rid legal
    const root = makeRepo();
    writeArtifact(root, RID_A, ['src/x.ts']);
    writeArtifact(root, RID_B, ['src/x.ts']);
    put(root, 'src/x.ts');

    let refused: unknown = null;
    try {
      gate(root);
    } catch (error) {
      refused = error;
    }

    expect((refused as { kind: string }).kind).toBe('source-touched');
  });

  it('when the rid declares nothing and the worktree has source, should refuse', () => {
    // given: a docs rid with NO `## Changed paths` heading, and source in the
    //        working tree
    // when: the docs rid is judged
    // then: refused on the whole working tree — the fallback is STRICTER
    const root = makeRepo();
    writeArtifact(root, RID_A, null);
    put(root, 'src/x.ts');

    let refused: unknown = null;
    try {
      gate(root);
    } catch (error) {
      refused = error;
    }

    expect((refused as { kind: string }).kind).toBe('source-touched');
  });

  it('when the rid declares no source, should differ from the whole-tree verdict it replaces', () => {
    // given: the same fixture as the passing case above — the source change
    //        belongs to the OTHER rid
    // when: the rule the gate used BEFORE this slice is run on the same fixture
    //        (the whole working tree, no rid scope)
    // then: the old verdict refused the docs rid, the new one passes it
    const root = makeRepo();
    writeArtifact(root, RID_A, ['docs/a.md']);
    writeArtifact(root, RID_B, ['src/x.ts']);
    put(root, 'src/x.ts');

    const before = corroborateDeclaredType({ projectRoot: root, declaredType: 'docs' });

    // and: the rule the gate uses NOW is run on the same fixture
    const after = gate(root);

    expect(before.ok).toBe(false);
    expect(after).toBeNull();
  });
});

describe('Scenario: integration — the anti-lie fallback', () => {
  it('when every rid declares its paths and one source change is unclaimed, should refuse', () => {
    // given: two declaring rids, neither of them claiming the source change
    // when: the docs rid is judged
    // then: refused, and the refusal names the unclaimed path
    const root = makeRepo();
    writeArtifact(root, RID_A, ['docs/a.md']);
    writeArtifact(root, RID_B, ['docs/b.md']);
    put(root, 'src/x.ts');

    let refused: unknown = null;
    try {
      gate(root);
    } catch (error) {
      refused = error;
    }

    expect((refused as { kind: string }).kind).toBe('source-unclaimed');
    expect((refused as { message: string }).message).toContain('src/x.ts');
  });

  it('when one rid declares nothing and a source change is unclaimed, should pass and say so', () => {
    // given: the same unclaimed source change, but a second rid whose artifact
    //        carries NO heading — the claim table is incomplete
    // when: the docs rid is judged
    // then: it passes, and the note states that the fallback stood down
    const root = makeRepo();
    writeArtifact(root, RID_A, ['docs/a.md']);
    writeArtifact(root, RID_B, null);
    put(root, 'src/x.ts');

    const note = gate(root);

    expect(note).not.toBeNull();
    expect(note).toContain('兜底未启用');
    expect(note).toContain('认领表不完整');
  });
});

describe('Scenario: render — the two refusals are distinguishable', () => {
  it('when both refusals happen, should carry different messages and the same paths', () => {
    // given: an unclaimed source change (the fallback's refusal)
    // when: the docs rid is judged
    // then: the two kinds differ, both name the path, and the messages differ
    const root = makeRepo();
    writeArtifact(root, RID_A, ['docs/a.md']);
    writeArtifact(root, RID_B, ['docs/b.md']);
    put(root, 'src/x.ts');
    let unclaimed: { kind: string; message: string } | null = null;
    try {
      gate(root);
    } catch (error) {
      unclaimed = error as { kind: string; message: string };
    }

    // and: a rid that declares the source itself (the rule's own refusal)
    const other = makeRepo();
    writeArtifact(other, RID_A, ['src/x.ts']);
    put(other, 'src/x.ts');
    let touched: { kind: string; message: string } | null = null;
    try {
      gate(other);
    } catch (error) {
      touched = error as { kind: string; message: string };
    }

    expect(unclaimed?.kind).toBe('source-unclaimed');
    expect(touched?.kind).toBe('source-touched');
    expect(unclaimed?.message).not.toBe(touched?.message);
    expect(unclaimed?.message).toContain('src/x.ts');
    expect(touched?.message).toContain('src/x.ts');
  });
});

describe('Scenario: a11y — an unreadable diff still fails closed', () => {
  it('when the project root is not a git repository, should refuse as diff-unavailable', () => {
    // given: a directory that is not a repository
    // when: the docs rid is judged
    // then: refused as an unreadable diff, not read as an empty one
    const root = mkdtempSync(join(tmpdir(), 'peaks-rid-scoped-nogit-'));
    roots.push(root);
    writeArtifact(root, RID_A, ['docs/a.md']);

    let refused: unknown = null;
    try {
      gate(root);
    } catch (error) {
      refused = error;
    }

    expect((refused as { kind: string }).kind).toBe('diff-unavailable');
    expect((refused as { message: string }).message).toContain('fails closed');
  });
});
