// tests/unit/services/artifacts/type-corroboration-gate.test.ts
//
// The declared-type rule wired into `transitionRequestArtifact`. AC3 requires
// the SERVICE, not the CLI: every caller of the transition must get the
// refusal. AC5 requires that an author-planted skip record cannot carry source
// — the skip bypasses the prerequisite TABLE, not this gate.
//
// The late-change window is closed at `rd:qa-handoff` too: `chore` can legally
// step `implemented → qa-handoff`, so a src/** change added after the first
// transition is re-checked before the slice can leave RD.
//
// Dimensions: behavior (refuse/allow per shape), integration (real tmp project
// + real git diffs), render (the error payload and message), a11y (remedy and
// the recorded bypass note).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { transitionRequestArtifact } from '../../../../src/services/artifacts/request-artifact-service.js';
import {
  FileSizeViolationError,
  type RequestArtifactState
} from '../../../../src/services/artifacts/request-artifact-state-helpers.js';
import { TypeCorroborationViolationError } from '../../../../src/services/artifacts/rd-transition-gates.js';

declareDimensions('tests/unit/services/artifacts/type-corroboration-gate.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

const SESSION_ID = '2026-10-17-type-corroboration';
const RID = '2026-10-17-type-corroboration-fixture';
const roots: string[] = [];

function git(root: string, ...args: string[]): void {
  execFileSync('git', ['-C', root, ...args], { stdio: 'pipe', windowsHide: true });
}

function artifactPath(root: string): string {
  return join(root, '.peaks', '_runtime', SESSION_ID, 'rd', 'requests', `001-${RID}.md`);
}

/** A project with a committed baseline and one RD carrier. `inGit: false`
 *  leaves a bare directory so the enumeration cannot run. */
function makeProject(options: { type?: string; state?: string; inGit?: boolean }): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-type-gate-'));
  roots.push(root);
  if (options.inGit !== false) {
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 'fixture@example.invalid');
    git(root, 'config', 'user.name', 'fixture');
    git(root, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(root, 'README.md'), '# fixture\n', 'utf8');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'init');
  }
  const path = artifactPath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `# RD Request ${RID}\n\n- session: ${SESSION_ID}\n- type: ${options.type ?? 'chore'}\n` +
      `\n## Status\n\n- state: ${options.state ?? 'spec-locked'}\n`,
    'utf8'
  );
  return root;
}

function put(root: string, relPath: string): void {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, 'export const x = 1;\n', 'utf8');
}

/** A file of `lines` raw lines — over the 300-line cap at 301. */
function putLines(root: string, relPath: string, lines: number): void {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, 'x\n'.repeat(lines), 'utf8');
}

/** The author-controlled skip record (item ③b): a valid one for this rid. */
function plantSkip(root: string): string {
  const path = join(root, '.peaks', '_runtime', SESSION_ID, 'workflow-state', `${RID}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      rid: RID,
      skippedGates: ['QA'],
      skipReason: 'author says this chore needs no QA',
      skipAppliedAt: '2026-10-17T00:00:00.000Z',
      skipAppliedBy: 'fixture',
      callerKind: 'human'
    }),
    'utf8'
  );
  return path;
}

function transition(
  root: string,
  newState: RequestArtifactState,
  extra: { allowIncomplete?: boolean; reason?: string } = {}
): ReturnType<typeof transitionRequestArtifact> {
  return transitionRequestArtifact({
    role: 'rd',
    requestId: RID,
    projectRoot: root,
    sessionId: SESSION_ID,
    newState,
    confirmed: true,
    ...extra
  });
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

describe('Scenario: behavior — the service refuses a chore that carries src/**', () => {
  it('when a chore rid with src/x.ts moves to implemented, should refuse and leave the state', async () => {
    // given: a chore carrier at spec-locked and an untracked source file
    const root = makeProject({ type: 'chore' });
    put(root, 'src/x.ts');

    // when:  transitionRequestArtifact is driven DIRECTLY (not through the CLI)
    const attempt = transition(root, 'implemented');

    // then:  the typed refusal names the path and the declared type, and the
    //        artifact was not rewritten
    await expect(attempt).rejects.toBeInstanceOf(TypeCorroborationViolationError);
    await attempt.catch((error: TypeCorroborationViolationError) => {
      expect(error.code).toBe('TYPE_CORROBORATION_VIOLATION');
      expect(error.kind).toBe('source-touched');
      expect(error.declaredType).toBe('chore');
      expect(error.message).toContain('src/x.ts');
    });
    expect(readFileSync(artifactPath(root), 'utf8')).toContain('- state: spec-locked');
  });

  it('when a chore rid carries only tooling paths, should reach implemented', async () => {
    // given: scripts/, tests/ and .husky/ — allowed by the narrow rule
    const root = makeProject({ type: 'chore' });
    put(root, 'scripts/x.mjs');
    put(root, 'tests/unit/x.test.ts');
    put(root, '.husky/x.mjs');

    // when:  the transition runs
    const result = await transition(root, 'implemented');

    // then:  it succeeds and the artifact says implemented
    expect(result?.state).toBe('implemented');
    expect(readFileSync(artifactPath(root), 'utf8')).toContain('- state: implemented');
  });

  it('when a feature rid carries src/x.ts, should reach implemented', async () => {
    // given: a QA-bearing type with a source change
    const root = makeProject({ type: 'feature' });
    put(root, 'src/x.ts');

    // when:  the transition runs
    const result = await transition(root, 'implemented');

    // then:  allowed — the rule is scoped to the QA-free tables
    expect(result?.state).toBe('implemented');
  });
});

describe('Scenario: integration — the skip record cannot bypass the gate', () => {
  it('when a valid skip record is planted for a chore with src/**, should still refuse (the transition never reads skip state)', async () => {
    // given: the author-controlled skip record, plus the offending diff
    const root = makeProject({ type: 'chore' });
    put(root, 'src/x.ts');
    const skipPath = plantSkip(root);

    // the fixture is really on disk — the arm cannot go green because the write failed
    expect(existsSync(skipPath)).toBe(true);
    const skipRecord = JSON.parse(readFileSync(skipPath, 'utf8')) as { rid: string };
    expect(skipRecord.rid).toBe(RID);

    // when:  the transition runs
    const attempt = transition(root, 'implemented');

    // then:  refused. The transition path never CONSULTS skip state (only
    // `pipeline-verify-service` does), so the record cannot carry source.
    await expect(attempt).rejects.toBeInstanceOf(TypeCorroborationViolationError);
    expect(readFileSync(artifactPath(root), 'utf8')).toContain('- state: spec-locked');
  });

  it('when allowIncomplete bypasses the gates, should record the bypass in the artifact', async () => {
    // given: the same offending diff, and the documented escape hatch
    const root = makeProject({ type: 'chore' });
    put(root, 'src/x.ts');

    // when:  the transition is bypassed explicitly
    const result = await transition(root, 'implemented', {
      allowIncomplete: true,
      reason: 'fixture bypass'
    });

    // then:  it proceeds, and the bypass is stated rather than silent
    expect(result?.state).toBe('implemented');
    const content = readFileSync(artifactPath(root), 'utf8');
    expect(content).toContain('bypassed the rd implemented gates');
    expect(content).toContain('declared-type corroboration');
    expect(content).toContain('--allow-incomplete');
  });

  it('when allowIncomplete skips the type rule at qa-handoff, should name that phase', async () => {
    // given: a chore at implemented with a late source change
    const root = makeProject({ type: 'chore', state: 'implemented' });
    put(root, 'src/late.ts');

    // when:  qa-handoff is bypassed explicitly (the size ratchet is not in it)
    const result = await transition(root, 'qa-handoff', {
      allowIncomplete: true,
      reason: 'fixture bypass'
    });

    // then:  the note names the qa-handoff gate and only the rule that ran there
    expect(result?.state).toBe('qa-handoff');
    const content = readFileSync(artifactPath(root), 'utf8');
    expect(content).toContain('bypassed the rd qa-handoff gates (declared-type corroboration)');
  });

  it('when a feature rid bypasses, should not claim a gate was skipped (none could judge it)', async () => {
    // given: a QA-bearing type, for which the type rule is a constant pass
    const root = makeProject({ type: 'feature' });
    put(root, 'src/x.ts');

    // when:  allowIncomplete skips the size ratchet
    const result = await transition(root, 'implemented', {
      allowIncomplete: true,
      reason: 'fixture bypass'
    });

    // then:  no "bypassed" note is invented for a gate that had nothing to judge
    expect(result?.state).toBe('implemented');
    expect(readFileSync(artifactPath(root), 'utf8')).not.toContain('bypassed the rd implemented');
  });
});

describe('Scenario: behavior — the post-implemented window is closed at qa-handoff', () => {
  it('when src/** appears after implemented, should refuse the step to qa-handoff', async () => {
    // given: a chore already at implemented, then a late source change
    const root = makeProject({ type: 'chore', state: 'implemented' });
    put(root, 'src/late.ts');

    // when:  the legal next step is attempted
    const attempt = transition(root, 'qa-handoff');

    // then:  the same rule fires there, so the window is not left open
    await expect(attempt).rejects.toBeInstanceOf(TypeCorroborationViolationError);
    expect(readFileSync(artifactPath(root), 'utf8')).toContain('- state: implemented');
  });

  it('when src/** appears before handed-off, should refuse the last legal step too', async () => {
    // given: a chore at qa-handoff, then a source change before the commit boundary
    const root = makeProject({ type: 'chore', state: 'qa-handoff' });
    put(root, 'src/very-late.ts');

    // when:  the final RD step is attempted
    const attempt = transition(root, 'handed-off');

    // then:  the corroboration re-runs at handed-off, closing the whole window
    await expect(attempt).rejects.toBeInstanceOf(TypeCorroborationViolationError);
    expect(readFileSync(artifactPath(root), 'utf8')).toContain('- state: qa-handoff');
  });
});

describe('Scenario: behavior — the extracted size ratchet still refuses through the transition', () => {
  it('when a feature rid creates a file over the cap, should refuse with the size error', async () => {
    // given: a QA-bearing type (so the type rule passes) and a 301-line new file
    const root = makeProject({ type: 'feature' });
    putLines(root, 'src/big.ts', 301);

    // when:  the transition runs
    const attempt = transition(root, 'implemented');

    // then:  the size gate moved into the helper still fires — deleting its block
    //        from `rd-transition-gates.ts` turns this arm green-to-red
    await expect(attempt).rejects.toBeInstanceOf(FileSizeViolationError);
    expect(readFileSync(artifactPath(root), 'utf8')).toContain('- state: spec-locked');
  });
});

describe('Scenario: render/a11y — an unreadable diff refuses through the service', () => {
  it('when the project is not a git repository, should fail closed with a distinguishable message', async () => {
    // given: a chore carrier outside any git repository
    const root = makeProject({ type: 'chore', inGit: false });

    // when:  the transition runs
    const attempt = transition(root, 'implemented');

    // then:  the refusal names the unreadable diff, not an empty one
    await expect(attempt).rejects.toBeInstanceOf(TypeCorroborationViolationError);
    await attempt.catch((error: TypeCorroborationViolationError) => {
      expect(error.kind).toBe('diff-unavailable');
      expect(error.message).toContain('could not');
      expect(error.message).toContain('fails closed');
    });
  });
});
