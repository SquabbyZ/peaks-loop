import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import { isRequestType } from '../../../src/services/artifacts/artifact-prerequisites.js';

/** The shapes the two decision modules expose, declared HERE on purpose: they are
 *  plain `.mjs` and `allowJs` is off, so a static import would be an untyped
 *  TS7016 and would take the repo's zero-error tsc ceiling with it. */
type RidResult = {
  rid: string;
  type?: string | null;
  complete?: boolean;
  violations?: readonly string[];
  error?: string;
  note?: string;
};
type Carriers = {
  carriers: Map<string, { rank: number; path: string }>;
  failures: string[];
};
// Declared as function-VALUED properties, not methods: destructuring a method
// off an object is `@typescript-eslint/unbound-method` (4 errors here), and the
// shadow's `unbound-method` set is not one this file should move.
type ContractVerdict = {
  SKIP_TOKEN_ENV: string;
  ridFromCarrier: (
    name: string,
    markdown: string,
    deriveId: (name: string) => string | null
  ) => string | null;
  collectRids: (sessionDir: string, deriveId: (name: string) => string | null) => Carriers;
  resolveRidType: (
    path: string,
    isRequestType: (value: string) => boolean
  ) => { type: string | undefined; note: string | null };
  decidePipelineVerdict: (input: {
    rids: readonly string[];
    results: readonly RidResult[];
    skipToken: string | null | undefined;
    scopeNote: string;
  }) => { exitCode: number; lines: string[] };
};
type PipelineLeg = {
  loadPeaks: () => Promise<{ requestIdFromFileName: (name: string) => string | null }>;
  runPipelineLeg: (input: {
    projectRoot: string;
    env?: NodeJS.ProcessEnv;
    peaks?: unknown;
  }) => Promise<{ exitCode: number; lines: string[] }>;
  main: (projectRoot?: string, env?: NodeJS.ProcessEnv) => Promise<void>;
};

const verdictModule = (await import(
  new URL('../../../.husky/pipeline/contract-verdict.mjs', import.meta.url).href
)) as ContractVerdict;
const legModule = (await import(
  new URL('../../../.husky/peaks-gate-pipeline.mjs', import.meta.url).href
)) as PipelineLeg;
const { SKIP_TOKEN_ENV, collectRids, decidePipelineVerdict, ridFromCarrier, resolveRidType } =
  verdictModule;

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const HOOK = join(ROOT, '.husky', 'peaks-gate-pipeline.mjs');
const TSX_CLI = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const SESSION = 'sess-gate-test';

/** Exactly the seam the leg uses: the composition `loadPeaks` builds, not a copy. */
const { requestIdFromFileName: deriveId } = await legModule.loadPeaks();

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A throwaway project root: a real one, so the leg's own resolution runs. */
function makeRoot(bind: boolean, sessionId = SESSION): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'peaks-pipeline-gate-')));
  roots.push(root);
  if (bind) {
    write(
      join(root, '.peaks', '_runtime', 'session.json'),
      JSON.stringify({
        sessionId,
        createdAt: '2026-01-01T00:00:00.000Z',
        projectRoot: root
      })
    );
  }
  return root;
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** A request artifact whose declared type and state are the ones given. */
function writeRequest(
  root: string,
  role: string,
  name: string,
  meta: { type: string; state: string }
): void {
  write(
    join(root, '.peaks', '_runtime', SESSION, role, 'requests', name),
    `# ${role} Request ${name}\n\n- session: ${SESSION}\n- type: ${meta.type}\n- state: ${meta.state}\n`
  );
}

/** A `docs` rid is genuinely complete in the contract: its tables are empty. */
function writeCompleteRid(root: string, name = '001-rid-done.md'): void {
  writeRequest(root, 'rd', name, { type: 'docs', state: 'qa-handoff' });
  writeRequest(root, 'qa', name, { type: 'docs', state: 'verdict-issued' });
}

/** A `feature` rid that never left draft: short by every RD and QA artifact. */
function writeDraftRid(root: string, name = '002-rid-draft.md'): void {
  writeRequest(root, 'rd', name, { type: 'feature', state: 'draft' });
}

function envWithoutToken(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env[SKIP_TOKEN_ENV];
  return { ...env, ...extra };
}

/** Spawn the leg exactly as `.husky/pre-commit` does; `tsx: false` drops tsx. */
function runLeg(
  cwd: string,
  { tsx = true, env = {} } = {}
): { status: number | null; out: string } {
  const script = tsx ? [TSX_CLI, HOOK] : [HOOK];
  const run = spawnSync('node', script, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    env: envWithoutToken(env)
  });
  return { status: run.status, out: `${run.stdout ?? ''}${run.stderr ?? ''}` };
}

/** A checker stub: the `peaks` seam `runPipelineLeg` documents, driven for real. */
function stubPeaks(completeRids: readonly string[]): {
  seen: string[];
  loader: Record<string, unknown>;
} {
  const seen: string[] = [];
  return {
    seen,
    loader: {
      getSessionIdCanonical: (): string => SESSION,
      getSessionDir: (projectRoot: string, sessionId: string): string =>
        join(projectRoot, '.peaks', '_runtime', sessionId),
      requestIdFromFileName: deriveId,
      isRequestType,
      verifyPipeline: ({ rid }: { rid: string }): { complete: boolean; violations: string[] } => {
        seen.push(rid);
        return { complete: completeRids.includes(rid), violations: ['stub says so'] };
      }
    }
  };
}

// The budget is declared on the DESCRIBE, not per test: this file's spawns are the
// class `_setup/subprocess-timeouts.ts` exists for. It ALSO went here because the
// BDD verifier read `it`'s SECOND argument as the callback, so the triple below came
// back `missing-given-when-then` — fixed 2026-10-12 (FIX B of
// rid-s3-artifact-contract-enforcement), which now finds the callback at any position.
describe('Scenario: pipeline-contract gate', { timeout: SUBPROCESS_TEST_TIMEOUT_MS }, () => {
  it('when a rid is missing rd/code-review-<rid>.md, should refuse the commit and name that path', () => {
    // given: a session whose only rid is a feature slice still in draft
    // when:  the pre-commit leg runs against it
    // then:  it exits non-zero and names the missing evidence path
    const root = makeRoot(true);
    writeDraftRid(root);
    const { status, out } = runLeg(root);
    expect(status).toBe(1);
    expect(out).toContain('rd/code-review-rid-draft.md');
    expect(out).not.toContain('artifact contract satisfied');
  });

  it('when every rid satisfies the artifact contract, should pass and name the scope it judged', () => {
    // given: a session whose only rid is a complete docs slice
    // when:  the pre-commit leg runs against it
    // then:  it exits zero and says which session was green
    const root = makeRoot(true);
    writeCompleteRid(root);
    const { status, out } = runLeg(root);
    expect(status).toBe(0);
    expect(out).toContain(`artifact contract satisfied for 1 rid(s) — session ${SESSION}`);
  });

  it('when the exemption token is set, should pass and name every rid it skipped', () => {
    // given: a session with two rids, one of them short of the contract
    // when:  the leg runs with PEAKS_SKIP_PIPELINE_VERIFY=1
    // then:  it passes, and both rid names are on the exemption line
    const root = makeRoot(true);
    writeCompleteRid(root);
    writeDraftRid(root);
    const { status, out } = runLeg(root, { env: { [SKIP_TOKEN_ENV]: '1' } });
    expect(status).toBe(0);
    expect(out).toContain('EXEMPTION ACTIVE');
    expect(out).toContain('Skipped rid(s) (2): rid-done, rid-draft');
    expect(out).toContain('no trace in git history');
  });

  it('when the checker cannot be loaded, should refuse and say the checker did not run', () => {
    // given: a session with a rid, run by plain node so the source import fails
    // when:  the leg runs without tsx
    // then:  it refuses, and the reason names the detector rather than "no violations"
    const root = makeRoot(true);
    writeCompleteRid(root);
    const { status, out } = runLeg(root, { tsx: false });
    expect(status).toBe(1);
    expect(out).toContain('DID NOT RUN');
    expect(out).toContain('the peaks modules could not be loaded');
    expect(out).not.toContain('artifact contract satisfied');
  });

  it('when the session has no rid, should pass and say it found none', () => {
    // given: a bound session with no request artifact under any role
    // when:  the pre-commit leg runs against it
    // then:  it passes and says the scope it judged held no rid
    const root = makeRoot(true);
    const { status, out } = runLeg(root);
    expect(status).toBe(0);
    expect(out).toContain('no rid to verify');
    expect(out).toContain(`session ${SESSION}; 0 rid(s)`);
  });

  it('when no session is bound, should pass by name rather than by silence', () => {
    // given: a project root with no .peaks/_runtime/session.json at all
    // when:  the pre-commit leg runs against it
    // then:  it passes and prints the missing binding, so silence is never the answer
    const root = makeRoot(false);
    const { status, out } = runLeg(root);
    expect(status).toBe(0);
    expect(out).toContain('no peaks session binding');
  });

  it('when a requests dir is a file rather than a directory, should refuse rather than read it as empty', () => {
    // given: a bound session whose rd/requests exists and cannot be listed
    // when:  the pre-commit leg runs against it
    // then:  it refuses and blames the detector, rather than reporting no violations
    const root = makeRoot(true);
    write(join(root, '.peaks', '_runtime', SESSION, 'rd', 'requests'), 'not a directory\n');
    const { status, out } = runLeg(root);
    expect(status).toBe(1);
    expect(out).toContain('DID NOT RUN');
    expect(out).toContain('rd/requests');
    expect(out).not.toContain('no rid to verify');
  });

  it('when the binding names a traversing session id, should refuse and judge nothing outside the root', () => {
    // given: a session.json whose sessionId escapes the runtime root, and an artifact tree that escape would have reached
    // when:  the pre-commit leg runs against it
    // then:  it refuses, and the out-of-root rid is never enumerated or judged
    const root = makeRoot(false);
    const escaped = `peaks-outside-${Date.now()}`;
    const outside = join(root, '..', escaped);
    roots.push(outside);
    writeRequest(outside, 'rd', '001-rid-outside.md', { type: 'feature', state: 'draft' });
    write(
      join(root, '.peaks', '_runtime', 'session.json'),
      JSON.stringify({
        sessionId: join('..', '..', escaped),
        createdAt: '2026-01-01T00:00:00.000Z',
        projectRoot: root
      })
    );
    const { status, out } = runLeg(root);
    expect(status).toBe(1);
    expect(out).toContain('DID NOT RUN');
    expect(out).not.toContain('rid-outside');
  });

  it('when a rid is short of the contract, should decide to refuse and quote its violations', () => {
    // given: a checker verdict that names a missing artifact
    // when:  the decision point is handed that result
    // then:  it refuses and prints the violation verbatim
    const verdict = decidePipelineVerdict({
      rids: ['rid-a'],
      results: [
        { rid: 'rid-a', type: 'feature', complete: false, violations: ['RD evidence missing: X'] }
      ],
      skipToken: null,
      scopeNote: 'session s'
    });
    expect(verdict.exitCode).toBe(1);
    expect(verdict.lines.join('\n')).toContain('  - RD evidence missing: X');
  });

  it('when the checker answers a scope failure, should refuse as a detector that did not run', () => {
    // given: an enumeration failure instead of a verdict
    // when:  the decision point is handed it
    // then:  it refuses, and says the scope could not be read
    const verdict = decidePipelineVerdict({
      rids: [],
      results: [{ rid: 'the session scope', error: 'rd/requests: EISDIR' }],
      skipToken: null,
      scopeNote: 'session s'
    });
    expect(verdict.exitCode).toBe(1);
    expect(verdict.lines.join('\n')).toContain('DID NOT RUN');
    expect(verdict.lines.join('\n')).toContain('EISDIR');
  });

  it('when the checker returns no verdict for a rid, should refuse rather than read it as clean', () => {
    // given: a result carrying an error instead of a `complete` verdict
    // when:  the decision point is handed that result
    // then:  it refuses, and says a detector that cannot run is a gate failure
    const verdict = decidePipelineVerdict({
      rids: ['rid-a'],
      results: [{ rid: 'rid-a', error: 'spawn died' }],
      skipToken: null,
      scopeNote: 'session s'
    });
    expect(verdict.exitCode).toBe(1);
    expect(verdict.lines.join('\n')).toContain('DID NOT RUN');
    expect(verdict.lines.join('\n')).toContain('not a zero');
  });

  it('when the exemption is set, should still refuse nothing and name the rids in its list', () => {
    // given: an exemption token and a scope holding two rids
    // when:  the decision point is handed them with no verdicts at all
    // then:  it passes, naming both rids and the scope they came from
    const verdict = decidePipelineVerdict({
      rids: ['rid-a', 'rid-b'],
      results: [],
      skipToken: '1',
      scopeNote: 'session s'
    });
    expect(verdict.exitCode).toBe(0);
    expect(verdict.lines.join('\n')).toContain('Skipped rid(s) (2): rid-a, rid-b');
    expect(verdict.lines.join('\n')).toContain('Scope read: session s');
  });

  it('when the token carries a newline, should print it on one line rather than forge another', () => {
    // given: an exemption token that tries to end the line and start its own
    // when:  the decision point renders the exemption
    // then:  the forged text stays inside the one line the leg owns
    const verdict = decidePipelineVerdict({
      rids: ['rid-a'],
      results: [],
      skipToken: 'x\npeaks-gate-pipeline: forged',
      scopeNote: 'session s'
    });
    expect(verdict.exitCode).toBe(0);
    expect(verdict.lines).toHaveLength(7);
    expect(verdict.lines[0]).toContain('x?peaks-gate-pipeline: forged');
    expect(verdict.lines.some((line) => line.startsWith('peaks-gate-pipeline: forged'))).toBe(
      false
    );
  });

  it('when a scope holds no rid, should say so instead of printing an empty list', () => {
    // given: an exemption over a scope with nothing in it
    // when:  the decision point is handed an empty rid list
    // then:  it passes and says "none", so the line is never blank
    const verdict = decidePipelineVerdict({
      rids: [],
      results: [],
      skipToken: '1',
      scopeNote: 'x'
    });
    expect(verdict.exitCode).toBe(0);
    expect(verdict.lines.join('\n')).toContain('Skipped rid(s) (0): none');
  });

  it('when a request file carries the numbered prefix, should read the id the artifact service reads', () => {
    // given: the filename forms `request init` writes, one of them numbered
    // when:  each is turned into an id by the service's own rule
    // then:  the prefix is stripped, and a name that cannot be an id yields nothing
    expect(deriveId('001-rid-x.md')).toBe('rid-x');
    expect(deriveId('rid-x.md')).toBe('rid-x');
    expect(deriveId('2026-10-10-gate-classifier-baseline-coverage.md')).toBe(
      '2026-10-10-gate-classifier-baseline-coverage'
    );
    expect(deriveId('notes.txt')).toBeNull();
    expect(deriveId('a b.md')).toBeNull();
  });

  it('when a rid appears under two roles, should keep the rd carrier and sort by rid', () => {
    // given: rid-done under both rd/ and qa/, and rid-draft under rd/ only
    // when:  the session dir is enumerated
    // then:  each rid appears once, the rd carrier wins, and the order is by name
    const root = makeRoot(true);
    writeCompleteRid(root);
    writeDraftRid(root);
    const found = collectRids(join(root, '.peaks', '_runtime', SESSION), deriveId);
    expect([...found.carriers.keys()]).toEqual(['rid-done', 'rid-draft']);
    expect(found.carriers.get('rid-done')?.rank).toBe(0);
    expect(
      found.carriers.get('rid-done')?.path.endsWith(join('rd', 'requests', '001-rid-done.md'))
    ).toBe(true);
    expect(found.failures).toEqual([]);
  });

  it('when a dispatch prompt sits in a requests dir, should not enumerate it as a rid', () => {
    // given: a complete docs rid and, beside it, the fragment a prompt dump is (this repo's 2026-10-11 session holds three of exactly this shape)
    // when:  the commit is attempted
    // then:  only the real rid is judged, so the commit still passes
    const root = makeRoot(true);
    writeCompleteRid(root, '001-rid-done.md');
    write(
      join(root, '.peaks', '_runtime', SESSION, 'rd', 'requests', 'rid-done-dispatch-prompt.md'),
      '## Test Tool Detection (mandatory)\n\nRead package.json#scripts.test …\n'
    );
    const found = collectRids(join(root, '.peaks', '_runtime', SESSION), deriveId);
    expect([...found.carriers.keys()]).toEqual(['rid-done']);
    const { status, out } = runLeg(root);
    expect(status).toBe(0);
    expect(out).not.toContain('dispatch-prompt');
    expect(out).toContain('artifact contract satisfied for 1 rid(s)');
  });

  it('when a document declares another request, should read it as that request and not as its own', () => {
    // given: a request, and beside it a report that declares the request it is about
    // when:  the session dir is enumerated
    // then:  the report adds no rid of its own, so no unsatisfiable rid is judged
    const root = makeRoot(true);
    writeCompleteRid(root, 'rid-done.md');
    write(
      join(root, '.peaks', '_runtime', SESSION, 'qa', 'requests', 'rid-done-verification.md'),
      `# rid-done — independent QA verification\n\n**Session:** ${SESSION} · **Role:** qa · **Request:** rid-done\n\n**Verdict: it reproduces.**\n`
    );
    const found = collectRids(join(root, '.peaks', '_runtime', SESSION), deriveId);
    expect([...found.carriers.keys()]).toEqual(['rid-done']);
    const selfDeclared = `# rid-own\n\n- session: ${SESSION}\n- request: rid-own\n`;
    expect(ridFromCarrier('rid-own.md', selfDeclared, deriveId)).toBe('rid-own');
    expect(ridFromCarrier('a b.md', '# a b\n', deriveId)).toBeNull();
    expect(ridFromCarrier('rid-own.md', '## fragment\n', deriveId)).toBeNull();
  });

  it('when a request is named 001-<slug>.md, should enumerate it and refuse the commit', () => {
    // given: an incomplete feature rid under the naming the 2026-10-10 session uses
    // when:  the commit is attempted
    // then:  the leg refuses and names that rid, rather than reporting no rid
    const root = makeRoot(true);
    write(
      join(root, '.peaks', '_runtime', SESSION, 'rd', 'requests', '001-some-slug.md'),
      `# RD Request 001 — some slug\n\n- session: ${SESSION}\n- type: feature\n- state: draft\n`
    );
    const { status, out } = runLeg(root);
    expect(status).toBe(1);
    expect(out).toContain('some-slug (type feature) fails the artifact contract');
    expect(out).not.toContain('no rid to verify');
  });

  it('when a complete request carries the numbered prefix, should pass like any other naming', () => {
    // given: a genuinely complete docs rid named 001-<slug>.md
    // when:  the commit is attempted
    // then:  it passes, naming the one rid it judged
    const root = makeRoot(true);
    writeCompleteRid(root, '001-some-slug.md');
    const { status, out } = runLeg(root);
    expect(status).toBe(0);
    expect(out).toContain('artifact contract satisfied for 1 rid(s)');
  });

  it('when a carrier declares no type line, should let the checker default apply', () => {
    // given: a carrier with no `- type:` line
    // when:  its type is resolved
    // then:  no type is forwarded, so the checker's own fail-closed default is used
    const root = makeRoot(true);
    const path = join(root, 'carrier.md');
    write(path, '# RD Request rid-x\n\n- state: draft\n');
    expect(resolveRidType(path, isRequestType)).toEqual({ type: undefined, note: null });
  });

  it('when a carrier declares an unknown type, should fall back to the default and say so', () => {
    // given: a carrier whose type value is not a request type
    // when:  its type is resolved
    // then:  no type is forwarded, and the fallback is stated rather than silent
    const root = makeRoot(true);
    const path = join(root, 'carrier.md');
    write(path, '# RD Request rid-x\n\n- type: nonsense\n- state: draft\n');
    const resolved = resolveRidType(path, isRequestType);
    expect(resolved.type).toBeUndefined();
    expect(resolved.note).toContain('not a request type');
    expect(resolved.note).toContain('fail-closed default');
  });

  it('when a checker is injected, should drive it without loading the real one', async () => {
    // given: an enumerable session and a stub checker that completes one rid
    // when:  the leg runs against the injected checker
    // then:  it judges each enumerated rid through the seam and refuses on the other
    const root = makeRoot(true);
    writeCompleteRid(root, '001-rid-done.md');
    writeDraftRid(root, '002-rid-draft.md');
    const { loader, seen } = stubPeaks(['rid-done']);
    const verdict = await legModule.runPipelineLeg({ projectRoot: root, env: {}, peaks: loader });
    expect(seen).toEqual(['rid-done', 'rid-draft']);
    expect(verdict.exitCode).toBe(1);
    expect(
      verdict.lines.some(
        (line) => line.includes('rid-draft') && line.includes('fails the artifact contract')
      )
    ).toBe(true);
    expect(verdict.lines.join('\n')).toContain('  - stub says so');
  });

  it('when the leg throws before deciding, should catch it and refuse instead of crashing', async () => {
    // given: an environment whose reads throw, which the leg touches on its way in
    // when:  the entry point runs
    // then:  main catches the throw, prints the refusal, and exits non-zero
    const env = new Proxy<NodeJS.ProcessEnv>(
      {},
      {
        get(): never {
          throw new Error('env read refused');
        }
      }
    );
    const previousCode = process.exitCode;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await legModule.main(process.cwd(), env);
      const out = errors.mock.calls.map((call) => String(call[0])).join('\n');
      expect(process.exitCode).toBe(1);
      expect(out).toContain('the leg threw before deciding');
      expect(out).toContain('env read refused');
    } finally {
      errors.mockRestore();
      process.exitCode = previousCode;
    }
  });
});
