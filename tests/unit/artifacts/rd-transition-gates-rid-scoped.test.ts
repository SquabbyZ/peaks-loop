// tests/unit/artifacts/rd-transition-gates-rid-scoped.test.ts
//
// The rid-scoped declared-type rule THROUGH THE SERVICE: the path a real
// `peaks request transition rd --state implemented` takes.
//
// The unit-level file next door drives the gate directly; this one proves the
// caller hands the gate the rid and the session it needs, and that the note
// about the anti-lie fallback lands in the artifact rather than in a log line
// nobody reads.
//
// Dimensions: behavior (the transition's verdict), integration (a real git
// repository, a real session tree, the real service), render (the artifact
// after the transition), a11y (the note a reader of the artifact can act on).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { transitionRequestArtifact } from '../../../src/services/artifacts/request-artifact-service.js';
import { TypeCorroborationViolationError } from '../../../src/services/artifacts/rd-transition-gates.js';

declareDimensions('tests/unit/artifacts/rd-transition-gates-rid-scoped.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

const SESSION_ID = '2026-10-24-rid-scoped-service';
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
  const root = mkdtempSync(join(tmpdir(), 'peaks-rid-scoped-svc-'));
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
 * `## Changed paths` heading at all.
 */
function writeArtifact(root: string, rid: string, declared: readonly string[] | null): string {
  const path = join(root, '.peaks', '_runtime', SESSION_ID, 'rd', 'requests', `001-${rid}.md`);
  mkdirSync(dirname(path), { recursive: true });
  const head = `# RD Request ${rid}\n\n- session: ${SESSION_ID}\n- type: docs\n`;
  const section =
    declared === null
      ? ''
      : `\n## Changed paths\n\n${declared.map((p) => `changedPath: ${p}`).join('\n')}\n`;
  writeFileSync(path, `${head}${section}\n## Status\n\n- state: spec-locked\n`, 'utf8');
  return path;
}

function put(root: string, relPath: string): void {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, 'export const x = 1;\n', 'utf8');
}

/** The real service call: `rd` moving to `implemented`. */
function transition(root: string, rid: string): Promise<{ state: string } | null> {
  return transitionRequestArtifact({
    role: 'rd',
    requestId: rid,
    projectRoot: root,
    sessionId: SESSION_ID,
    newState: 'implemented',
    confirmed: true
  });
}

describe('Scenario: behavior — the service judges the rid, not the working tree', () => {
  it('when a docs rid and a feature rid share a worktree, should the docs rid pass', async () => {
    // given: a docs rid claiming only a markdown file, another rid claiming the
    //        source change in the working tree
    // when: the docs rid moves to implemented
    // then: it succeeds — the old whole-tree judgement refused it
    const root = makeRepo();
    writeArtifact(root, RID_A, ['docs/a.md']);
    writeArtifact(root, RID_B, ['src/x.ts']);
    put(root, 'src/x.ts');

    const result = await transition(root, RID_A);

    expect(result?.state).toBe('implemented');
  });

  it('when a source change is claimed by nobody, should the service refuse', async () => {
    // given: two declaring rids and an unclaimed source change
    // when: the docs rid moves to implemented
    // then: refused, and the refusal names the unclaimed path
    const root = makeRepo();
    writeArtifact(root, RID_A, ['docs/a.md']);
    writeArtifact(root, RID_B, ['docs/b.md']);
    put(root, 'src/x.ts');

    const attempt = transition(root, RID_A);

    await expect(attempt).rejects.toBeInstanceOf(TypeCorroborationViolationError);
    await attempt.catch((error: TypeCorroborationViolationError) => {
      expect(error.kind).toBe('source-unclaimed');
      expect(error.message).toContain('src/x.ts');
    });
  });

  it('when the rid has no Changed paths, should the whole worktree be judged', async () => {
    // given: a docs rid with no heading and a source change in the worktree
    // when: the docs rid moves to implemented
    // then: refused — the fallback to the whole worktree is stricter
    const root = makeRepo();
    writeArtifact(root, RID_A, null);
    put(root, 'src/x.ts');

    const attempt = transition(root, RID_A);

    await expect(attempt).rejects.toBeInstanceOf(TypeCorroborationViolationError);
    await attempt.catch((error: TypeCorroborationViolationError) => {
      expect(error.kind).toBe('source-touched');
      expect(error.message).toContain('src/x.ts');
    });
  });
});

describe('Scenario: render — the artifact carries the verdict', () => {
  it('when the docs rid passes, should the artifact say implemented', async () => {
    // given: the passing shape from above
    // when: the transition runs
    // then: the artifact records the new state
    const root = makeRepo();
    const path = writeArtifact(root, RID_A, ['docs/a.md']);
    writeArtifact(root, RID_B, ['src/x.ts']);
    put(root, 'src/x.ts');

    await transition(root, RID_A);

    expect(readFileSync(path, 'utf8')).toContain('- state: implemented');
  });

  it('when the claim table is incomplete, should the artifact record the fallback', async () => {
    // given: a second rid whose artifact carries no heading
    // when: the transition runs
    // then: the note is in the artifact, not only in a log line
    const root = makeRepo();
    const path = writeArtifact(root, RID_A, ['docs/a.md']);
    writeArtifact(root, RID_B, null);
    put(root, 'src/x.ts');

    await transition(root, RID_A);

    const content = readFileSync(path, 'utf8');
    expect(content).toContain('- state: implemented');
    expect(content).toContain('兜底未启用');
  });
});
