/**
 * The SCOPE REDIRECT arms (`.peaks/docs/backlog.md` §9.48).
 *
 * WHY THIS FILE IS BESIDE `pipeline-contract-gate.test.ts` RATHER THAN IN IT: that
 * file is 533 raw lines, over the 500-line cap for root `tests/**`, and the policy
 * accepts an over-cap file only while it does not grow.
 *
 * The end-to-end arms spawn the real leg against a real throwaway project root, so
 * they exercise the real `discoverSessions` enumeration, the real mtimes and the
 * real prerequisite table. The in-process arms drive `runPipelineLeg` through its
 * documented `peaks` seam for the cases a tree cannot express: the ORDER in which a
 * target is chosen, and the postures in which the redirect must NOT run at all.
 *
 * Each arm states what it would take to pass while the defect is present; a control
 * that cannot fail the way §9.48 fails is not a control.
 */
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import { isRequestType } from '../../../src/services/artifacts/artifact-prerequisites.js';

/** Plain `.mjs`, `allowJs` off: the shapes are declared here (TS7016 otherwise). */
type Leg = {
  loadPeaks: () => Promise<Record<string, unknown>>;
  runPipelineLeg: (input: {
    projectRoot: string;
    env?: NodeJS.ProcessEnv;
    peaks?: unknown;
  }) => Promise<{ exitCode: number; lines: string[] }>;
};
type Verdict = {
  decidePipelineVerdict: (input: {
    rids: readonly string[];
    results: readonly Record<string, unknown>[];
    skipToken: string | null;
    scopeNote: string;
    redirect?: string | null;
  }) => { exitCode: number; lines: string[] };
};

const leg = (await import(
  new URL('../../../.husky/peaks-gate-pipeline.mjs', import.meta.url).href
)) as Leg;
const verdictModule = (await import(
  new URL('../../../.husky/pipeline/contract-verdict.mjs', import.meta.url).href
)) as Verdict;
const { decidePipelineVerdict } = verdictModule;
const { requestIdFromFileName: deriveId, getSessionDir } = (await leg.loadPeaks()) as {
  requestIdFromFileName: (name: string) => string | null;
  getSessionDir: (root: string, sid: string) => string;
};

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const HOOK = join(ROOT, '.husky', 'peaks-gate-pipeline.mjs');
const TSX_CLI = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const BOUND_EMPTY = '2026-01-01-session-bbbb';
const BOUND_FULL = '2026-01-06-session-bbbb';
const SIB_DONE = '2026-01-02-session-aaaa';
const SIB_DRAFT = '2026-01-05-session-cccc';
/** Name order and mtime order DISAGREE with this pair, on purpose (arm 6). */
const SIB_DONE_LATENAME = '2026-01-09-session-eeee';
const SIB_DRAFT_EARLYNAME = '2026-01-03-session-dddd';
const T0 = Date.UTC(2026, 0, 1, 0, 0, 0);

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** A throwaway project root, bound to `sessionId`. */
function makeRoot(sessionId: string = BOUND_EMPTY): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'peaks-pipeline-redirect-')));
  roots.push(root);
  write(
    join(root, '.peaks', '_runtime', 'session.json'),
    JSON.stringify({ sessionId, createdAt: '2026-01-01T00:00:00.000Z', projectRoot: root })
  );
  mkdirSync(join(root, '.peaks', '_runtime', sessionId), { recursive: true });
  return root;
}

function carrier(
  root: string,
  sessionId: string,
  meta: { role: string; name: string; type: string; state: string }
): string {
  const path = join(root, '.peaks', '_runtime', sessionId, meta.role, 'requests', meta.name);
  write(
    path,
    `# ${meta.role} Request ${meta.name}\n\n- session: ${sessionId}\n- type: ${meta.type}\n- state: ${meta.state}\n`
  );
  return path;
}

/** A `docs` rid: its prerequisite tables are empty, so it is genuinely complete. */
function completeRid(root: string, sessionId: string, name: string, minutes: number): void {
  carrier(root, sessionId, { role: 'rd', name, type: 'docs', state: 'qa-handoff' });
  carrier(root, sessionId, { role: 'qa', name, type: 'docs', state: 'verdict-issued' });
  stamp(root, sessionId, name, minutes);
}

/** A `feature` rid that never left draft: short by every RD and QA artifact. */
function draftRid(root: string, sessionId: string, name: string, minutes: number): void {
  carrier(root, sessionId, { role: 'rd', name, type: 'feature', state: 'draft' });
  stamp(root, sessionId, name, minutes);
}

/** Pin the carrier mtime, so "newest" is decided by the fixture and not the clock. */
function stamp(root: string, sessionId: string, name: string, minutes: number): void {
  const path = join(root, '.peaks', '_runtime', sessionId, 'rd', 'requests', name);
  const at = new Date((T0 + minutes * 60000) / 1000);
  utimesSync(path, at, at);
}

/** Spawn the leg exactly as `.husky/pre-commit` does. */
function runLeg(cwd: string): { status: number | null; out: string } {
  const env = { ...process.env };
  delete env.PEAKS_SKIP_PIPELINE_VERIFY;
  const run = spawnSync('node', [TSX_CLI, HOOK], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    env
  });
  return { status: run.status, out: `${run.stdout ?? ''}${run.stderr ?? ''}` };
}

/** The `peaks` seam, with a spy on the one call the redirect is allowed to make. */
function stubPeaks(
  root: string,
  complete: readonly string[]
): { calls: string[]; loader: Record<string, unknown> } {
  const calls: string[] = [];
  return {
    calls,
    loader: {
      getSessionIdCanonical: (): string => BOUND_EMPTY,
      getSessionDir,
      requestIdFromFileName: deriveId,
      isRequestType,
      listSessionDirs: (): { sessionId: string; path: string }[] => {
        calls.push('listSessionDirs');
        const runtime = join(root, '.peaks', '_runtime');
        return readdirSync(runtime, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => ({ sessionId: entry.name, path: join(runtime, entry.name) }));
      },
      verifyPipeline: ({ rid }: { rid: string }): { complete: boolean; violations: string[] } => ({
        complete: complete.includes(rid),
        violations: ['stub says so']
      })
    }
  };
}

describe(
  'Scenario: pipeline-contract scope redirect',
  { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
  () => {
    it('when the bound session is empty and a sibling carries a complete rid, should verify the sibling and name both', () => {
      // given: a session bound to an empty session dir, and a sibling holding one complete docs rid
      // when:  the pre-commit leg runs against that root
      // then:  it passes, names the bound session, the redirected sibling and the skip count
      // PASSES FALSELY IF: the redirect is implemented as a refusal — exit 1 here — or if the
      // pass line names only the bound session, which is what it said before this change.
      const root = makeRoot();
      completeRid(root, SIB_DONE, '001-sib-done.md', 10);
      const { status, out } = runLeg(root);
      expect(status).toBe(0);
      expect(out).toContain('artifact contract satisfied for 1 rid(s)');
      expect(out).toContain(`session ${BOUND_EMPTY}; 0 rid(s)`);
      expect(out).toContain(`REDIRECTED to session ${SIB_DONE}`);
      expect(out).toContain('the newest of 1 rid-carrying session(s); 0 NOT verified');
    });

    it('when the sibling it redirects to is short of the contract, should refuse and name that sibling and rid', () => {
      // given: an empty bound session and a sibling whose only rid is a feature slice still in draft
      // when:  the pre-commit leg runs against that root
      // then:  it refuses, names the SIBLING's rid, and the scope line names the sibling's session
      // PASSES FALSELY IF: the implementation still reports 0 carriers — then the leg prints
      // "no rid to verify" and exits 0, which is exactly the §9.48 defect.
      const root = makeRoot();
      draftRid(root, SIB_DRAFT, '002-sib-draft.md', 10);
      const { status, out } = runLeg(root);
      expect(status).toBe(1);
      expect(out).toContain('sib-draft (type feature) fails the artifact contract');
      expect(out).toContain(`SCOPE — REDIRECTED to session ${SIB_DRAFT}`);
      expect(out).not.toContain('no rid to verify');
    });

    it('when no sibling carries a rid, should be byte-identical to the leg without the redirect', () => {
      // given: a bound session with no carriers and NOTHING else under .peaks/_runtime
      // when:  the pre-commit leg runs against that root
      // then:  the output is the exact string this leg printed before the redirect existed
      // PASSES FALSELY IF: the empty-scope note gains any clause — a "nothing to redirect to"
      // hint, a scan count, a session census. The whole line is pinned, not a substring.
      const root = makeRoot();
      const { status, out } = runLeg(root);
      expect(status).toBe(0);
      expect(out).toBe(
        `peaks-gate-pipeline: no rid to verify — session ${BOUND_EMPTY}; 0 rid(s) under ` +
          'rd/requests, prd/requests, qa/requests. Nothing was refused.\n'
      );
    });

    it('when the bound session has carriers, should not redirect to a sibling that would fail', () => {
      // given: a bound session with a complete rid AND a sibling whose rid is short
      // when:  the pre-commit leg runs against that root
      // then:  it passes on the bound session and never mentions a redirect
      // PASSES FALSELY IF: the redirect fires whenever ANY sibling carries a rid rather than
      // only when the bound scope is empty — then the sibling's failure is charged to this commit.
      const root = makeRoot(BOUND_FULL);
      completeRid(root, BOUND_FULL, '001-bound-done.md', 5);
      draftRid(root, SIB_DRAFT, '002-sib-draft.md', 10);
      const { status, out } = runLeg(root);
      expect(status).toBe(0);
      expect(out).toContain('artifact contract satisfied for 1 rid(s)');
      expect(out).toContain(`session ${BOUND_FULL}; 1 rid(s)`);
      expect(out).not.toContain('REDIRECTED');
    });

    it('when the bound session has carriers, should never consult the sibling enumeration', () => {
      // given: an injected loader whose listSessionDirs records that it was asked
      // when:  the leg runs against a bound session that already carries a rid
      // then:  the redirect's scan is not paid for on the ordinary path at all
      // PASSES FALSELY IF: the scan is moved out of the empty-scope branch — the spy then
      // records a call, and every commit pays a session census it does not need.
      const root = makeRoot();
      completeRid(root, BOUND_EMPTY, '001-bound-done.md', 5);
      const { calls, loader } = stubPeaks(root, ['bound-done']);
      return leg
        .runPipelineLeg({ projectRoot: root, env: {}, peaks: loader })
        .then((verdict: { exitCode: number }) => {
          expect(verdict.exitCode).toBe(0);
          expect(calls).toEqual([]);
        });
    });

    it('when two siblings carry rids, should redirect to the one whose carrier was written last', () => {
      // given: two carrier-bearing siblings whose NAME order and MTIME order disagree —
      //        the greater name (…-09-…) is complete and older, the smaller name (…-03-…) is
      //        short and newer
      // when:  the leg runs against an empty bound session
      // then:  it verifies the NEWER one and refuses, naming it and the one rid it skipped
      // PASSES FALSELY IF: the target is chosen by directory name, by enumeration order, or by
      // the inner session.json (absent here) — each of those picks the COMPLETE sibling, and
      // the arm then exits 0.
      const root = makeRoot();
      completeRid(root, SIB_DONE_LATENAME, '001-sib-done.md', 10);
      draftRid(root, SIB_DRAFT_EARLYNAME, '002-sib-draft.md', 20);
      const { loader } = stubPeaks(root, ['sib-done']);
      return leg
        .runPipelineLeg({ projectRoot: root, env: {}, peaks: loader })
        .then((verdict: { exitCode: number; lines: string[] }) => {
          const text = verdict.lines.join('\n');
          expect(verdict.exitCode).toBe(1);
          expect(text).toContain(`REDIRECTED to session ${SIB_DRAFT_EARLYNAME}`);
          expect(text).toContain('the newest of 2 rid-carrying session(s); 1 NOT verified');
          expect(text).toContain('sib-draft (type default) fails the artifact contract');
        });
    });

    it('when the session binding cannot be resolved, should not redirect', () => {
      // given: a resolver that throws, and a sibling that genuinely carries a rid
      // when:  the leg runs against that root
      // then:  the pre-existing posture is unchanged — the scope says resolution threw
      // PASSES FALSELY IF: the redirect is placed above the resolver's own branches, which would
      // replace a named failure with a green line about somebody else's session.
      const root = makeRoot();
      draftRid(root, SIB_DRAFT, '002-sib-draft.md', 10);
      const { calls, loader } = stubPeaks(root, []);
      return leg
        .runPipelineLeg({
          projectRoot: root,
          env: {},
          peaks: {
            ...loader,
            getSessionIdCanonical: (): string => {
              throw new Error('resolver refused');
            }
          }
        })
        .then((verdict: { exitCode: number; lines: string[] }) => {
          expect(verdict.exitCode).toBe(0);
          expect(verdict.lines.join('\n')).toContain('session resolution threw (resolver refused)');
          expect(verdict.lines.join('\n')).not.toContain('REDIRECTED');
          expect(calls).toEqual([]);
        });
    });

    it('when no session is bound at all, should not redirect', () => {
      // given: a null binding, and a sibling that carries a rid
      // when:  the leg runs against that root
      // then:  the missing binding is still reported by name, with no redirect
      // PASSES FALSELY IF: a null binding is treated as an empty scope, which would make an
      // unbound tree verify whichever session happens to be newest.
      const root = makeRoot();
      draftRid(root, SIB_DRAFT, '002-sib-draft.md', 10);
      const { calls, loader } = stubPeaks(root, []);
      return leg
        .runPipelineLeg({
          projectRoot: root,
          env: {},
          peaks: { ...loader, getSessionIdCanonical: (): null => null }
        })
        .then((verdict: { exitCode: number; lines: string[] }) => {
          expect(verdict.exitCode).toBe(0);
          expect(verdict.lines.join('\n')).toContain('no peaks session binding');
          expect(verdict.lines.join('\n')).not.toContain('REDIRECTED');
          expect(calls).toEqual([]);
        });
    });

    it('when the sibling enumeration fails, should say so and still not refuse', () => {
      // given: an empty bound session and a lister that throws
      // when:  the leg runs against that root
      // then:  it passes as it does today, and the scope line carries the refusal
      // PASSES FALSELY IF: the scan failure is swallowed silently, which reads exactly like
      // "no sibling carries a rid"; or if it is turned into a refusal, which is the design the
      // measurement rejected (it would block every legitimate commit from a fresh session).
      const root = makeRoot();
      const { loader } = stubPeaks(root, []);
      return leg
        .runPipelineLeg({
          projectRoot: root,
          env: {},
          peaks: {
            ...loader,
            listSessionDirs: (): never => {
              throw new Error('runtime dir unreadable');
            }
          }
        })
        .then((verdict: { exitCode: number; lines: string[] }) => {
          expect(verdict.exitCode).toBe(0);
          expect(verdict.lines.join('\n')).toContain(
            'the sibling session scan refused (runtime dir unreadable)'
          );
          expect(verdict.lines.join('\n')).toContain('no rid to verify');
        });
    });

    it('when the verdict carries no redirect, should print the same lines it printed before', () => {
      // given: one failing rid, decided with and without a redirect sentence
      // when:  the decision point renders both
      // then:  the redirect adds exactly one SCOPE line, and nothing changes without it
      // PASSES FALSELY IF: the SCOPE line is emitted unconditionally — the line count is
      // pinned as well as the text, so a stray line on the pass or refusal path is caught.
      const input = {
        rids: ['rid-a'],
        results: [{ rid: 'rid-a', type: 'feature', complete: false, violations: ['missing X'] }],
        skipToken: null,
        scopeNote: 'session s'
      };
      const plain = decidePipelineVerdict(input);
      expect(plain.exitCode).toBe(1);
      expect(plain.lines).toHaveLength(3);
      expect(plain.lines.some((line) => line.includes('SCOPE'))).toBe(false);

      const redirected = decidePipelineVerdict({
        ...input,
        redirect: 'REDIRECTED to session s2 (1 rid(s))'
      });
      expect(redirected.lines).toHaveLength(4);
      expect(
        redirected.lines.some((line) => line.includes(`SCOPE — REDIRECTED to session s2`))
      ).toBe(true);

      const passing = decidePipelineVerdict({
        rids: [],
        results: [],
        skipToken: null,
        scopeNote: 'session s',
        redirect: 'REDIRECTED to session s2'
      });
      expect(passing.exitCode).toBe(0);
      expect(passing.lines).toHaveLength(1);
    });
  }
);
