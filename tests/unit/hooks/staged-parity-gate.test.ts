// tests/unit/hooks/staged-parity-gate.test.ts
//
// The leg under test: `.husky/peaks-gate-staged-parity.mjs` (appended to
// `.husky/pre-commit`), whose decisions live in `.husky/staged-parity/decide.mjs`.
//
// WHY THIS SUITE DRIVES A REAL REPOSITORY. The defect the leg exists for is
// "the index and the worktree hold different bytes", and the shapes that make
// that true — a path staged then deleted, one added and then removed from disk,
// one staged as deleted while still on disk, a rename — are all DEFINED BY GIT,
// not by this module. A stub `run()` would pin this module's view of git, which
// is exactly the belief under test. So every edge below is built with real
// `git add` / `git rm` in a throwaway repo, and only the branch tables (which
// git cannot be made to produce on demand) are driven as pure functions.
//
// The fixture scaffolding — throwaway repos, the CRLF repo, the source-mutated leg —
// lives in `_staged-parity-fixture.ts`, moved there when this file reached the 500-line
// tests cap. What is left here is the arms.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DECIDE_SRC,
  bothSides,
  decide,
  endTempRoots,
  makeCrlfRepo,
  makeRepo,
  mustGit,
  runLeg,
  runMutantLeg,
  stageThenEdit,
  tempRoot,
  write
} from './_staged-parity-fixture.js';
import type { Decide, LegRun, Outcome, Side } from './_staged-parity-fixture.js';

afterEach(endTempRoots);

// ---- behavior: the real git shapes -----------------------------------------

describe('Scenario: staged-parity — the index against the worktree', () => {
  it('when the staged blob matches the worktree, should pass and say so', () => {
    // given: a repo whose only change is staged and left alone
    // when:  the leg runs on that commit
    // then:  it passes, saying the two sides are identical
    const root = makeRepo();
    write(root, 'a.txt', 'one\ntwo\nthree\n');
    mustGit(root, ['add', 'a.txt']);
    const { status, out } = runLeg(root);
    expect(status).toBe(0);
    expect(out).toContain('what `git add` would store from the worktree');
  });

  it('when a tracked file is staged and then edited again, should refuse and name that path', () => {
    // given: the incident this leg exists for — a repair round that never re-ran git add
    // when:  the leg runs on that commit
    // then:  it refuses, and the refusal names the path with both byte sizes
    const root = makeRepo();
    stageThenEdit(root);
    const { status, out } = runLeg(root);
    expect(status).toBe(1);
    expect(out).toContain('REFUSED');
    expect(out).toContain('a.txt');
    expect(out).toContain('staged 15 B');
    expect(out).toContain('worktree 30 B');
  });

  it('when a staged path is deleted from the worktree, should refuse and say it is absent', () => {
    // given: a staged addition whose file is then removed from disk
    // when:  the leg runs
    // then:  the index holds a blob and the disk holds nothing, so it refuses
    const root = makeRepo();
    write(root, 'b.txt', 'gone\n');
    mustGit(root, ['add', 'b.txt']);
    rmSync(join(root, 'b.txt'));
    const { status, out } = runLeg(root);
    expect(status).toBe(1);
    expect(out).toContain('b.txt');
    expect(out).toContain('absent from the worktree');
  });

  it('when a path is staged as deleted while still on disk, should refuse and say so', () => {
    // given: `git rm --cached`, which removes the index entry and leaves the file
    // when:  the leg runs
    // then:  no index entry but bytes on disk is a divergence
    const root = makeRepo();
    mustGit(root, ['rm', '-q', '--cached', 'a.txt']);
    const { status, out } = runLeg(root);
    expect(status).toBe(1);
    expect(out).toContain('a.txt');
    expect(out).toContain('staged as deleted');
    expect(out).toContain('still on disk');
  });

  it('when a file is renamed and the rename is staged, should pass', () => {
    // given: a staged rename, which arrives as a deletion plus an addition
    // when:  the leg runs
    // then:  the old path is absent on BOTH sides and the new one is in sync
    const root = makeRepo();
    mustGit(root, ['mv', 'a.txt', 'renamed.txt']);
    const { status, out } = runLeg(root);
    expect(status).toBe(0);
    expect(out).toContain('2 staged path(s)');
    expect(out).toContain('what `git add` would store from the worktree');
  });

  it('when nothing is staged, should pass and say the staged set was empty', () => {
    // given: a clean repo
    // when:  the leg runs with an empty index diff
    // then:  it passes LOUDLY rather than vacuously
    const root = makeRepo();
    const { status, out } = runLeg(root);
    expect(status).toBe(0);
    expect(out).toContain('EMPTY');
    expect(out).toContain('nothing was compared');
  });

  it('when the leg runs from a subdirectory, should compare the same paths and pass', () => {
    // given: a repo whose staged path lives at the root, and a cwd inside it
    // when:  the leg runs with the caller's directory below the root
    // then:  it still passes — `ls-files` is cwd-relative AND cwd-scoped, so the root must be resolved
    const root = makeRepo();
    write(root, 'a.txt', 'one\ntwo\nthree\n');
    mustGit(root, ['add', 'a.txt']);
    mkdirSync(join(root, 'sub'), { recursive: true });
    const { status, out } = runLeg(join(root, 'sub'));
    expect(status).toBe(0);
    expect(out).toContain('1 staged path(s)');
    expect(out).toContain('what `git add` would store from the worktree');
  });

  it('when a side cannot be compared, should refuse with that reason rather than pass', () => {
    // given: an index entry whose worktree path is a directory, not a file
    // when:  the leg runs
    // then:  it refuses, the reason is on the line, and the way out is named
    const root = makeRepo();
    write(root, 'd.txt', 'staged\n');
    mustGit(root, ['add', 'd.txt']);
    rmSync(join(root, 'd.txt'));
    mkdirSync(join(root, 'd.txt'));
    const { status, out } = runLeg(root);
    expect(status).toBe(1);
    expect(out).toContain('COULD NOT BE COMPARED');
    expect(out).toContain('gate FAILURE, not a zero');
    expect(out).toContain('not a regular file');
    // R4: an uncomparable-only refusal is still a refusal someone has to get out of
    expect(out).toContain('Fix: make the path(s) above comparable');
    expect(out).toContain('No token exempts this refusal');
  });

  it('when the worktree file is CRLF and the staged blob is LF, should pass', () => {
    // given: the configuration this repo runs under — `core.autocrlf=true` plus the
    //        `.gitattributes` pin — and a file an editor wrote with CRLF
    // when:  the leg runs on the staged path
    // then:  it passes, because git stores that file as LF and compares it as such;
    //        the two sides are NOT equal as raw bytes, which is what R1 removed
    const root = makeCrlfRepo();
    write(root, 'crlf.txt', 'one\r\ntwo\r\n');
    mustGit(root, ['add', 'crlf.txt']);
    const { staged, worktree } = bothSides(root, 'crlf.txt');
    expect(staged.equals(worktree)).toBe(false); // the arm is not vacuous
    expect(worktree.length).toBe(10); // CRLF on disk
    expect(staged.length).toBe(8); // LF in the index
    // git itself calls this staged path clean — the verdict the gate must not contradict
    expect(
      spawnSync('git', ['diff', '--quiet', '--', 'crlf.txt'], { cwd: root, windowsHide: true })
        .status
    ).toBe(0);
    const { status, out } = runLeg(root);
    expect(status).toBe(0);
    expect(out).toContain('what `git add` would store from the worktree');
  });

  it('when CRLF content really is edited after staging, should still refuse', () => {
    // given: the same CRLF repo, with the file staged and then edited again
    // when:  the leg runs
    // then:  it refuses — the filter makes CRLF invisible to the comparison, not the
    //        content difference the leg exists for
    const root = makeCrlfRepo();
    write(root, 'crlf.txt', 'one\r\ntwo\r\n');
    mustGit(root, ['add', 'crlf.txt']);
    write(root, 'crlf.txt', 'one\r\ntwo\r\nTHREE\r\n');
    const { status, out } = runLeg(root);
    expect(status).toBe(1);
    expect(out).toContain('REFUSED');
    expect(out).toContain('crlf.txt');
  });

  it('when the worktree half is compared as raw bytes, should refuse a CRLF file git calls clean', () => {
    // given: the CRLF repo above, and the leg with R1's own comparison undone —
    //        `staged.oid === worktree.oid` swapped for `staged.bytes.equals(worktree.bytes)`
    // when:  both run as the hook on that same tree
    // then:  the shipped leg passes and the byte-comparing logic refuses, which is the
    //        proof the CRLF arm above is load-bearing rather than decorative
    const root = makeCrlfRepo();
    write(root, 'crlf.txt', 'one\r\ntwo\r\n');
    mustGit(root, ['add', 'crlf.txt']);
    expect(runLeg(root).status).toBe(0);
    const bytesOnly = runMutantLeg(root, (source) =>
      source.split('staged.oid === worktree.oid').join('staged.bytes.equals(worktree.bytes)')
    );
    expect(bytesOnly.status).toBe(1);
    expect(bytesOnly.out).toContain('crlf.txt');
  });

  it('when the git state itself cannot be read, should refuse and name the detector', () => {
    // given: a directory that is not a repository at all
    // when:  the leg runs there
    // then:  "could not read the scope" is not "the scope held nothing"
    const notARepo = realpathSync(mkdtempSync(join(tmpdir(), 'peaks-staged-parity-norepo-')));
    tempRoot(notARepo);
    const { status, out } = runLeg(notARepo);
    expect(status).toBe(1);
    expect(out).toContain('could not be read');
    expect(out).toContain('nothing was compared');
  });

  it('when the exemption token is set, should pass and name every path it allowed', () => {
    // given: a real divergence, the state a partial staging would leave behind
    // when:  the leg runs with the token
    // then:  it passes, naming the path AND the legitimate reason for the token
    const root = makeRepo();
    stageThenEdit(root);
    const { status, out } = runLeg(root, { [decide.EXEMPT_ENV]: '1' });
    expect(status).toBe(0);
    expect(out).toContain('EXEMPTION ACTIVE');
    expect(out).toContain('a.txt');
    expect(out).toContain('PARTIAL STAGING');
    expect(out).toContain('no trace in git history');
  });

  it('when the token is set and nothing diverges, should say the exemption allowed nothing', () => {
    // given: a token set on a tree whose staged content is in sync
    // when:  the leg runs with the token
    // then:  it passes and does NOT claim it allowed anything
    const root = makeRepo();
    write(root, 'a.txt', 'one\ntwo\nthree\n');
    mustGit(root, ['add', 'a.txt']);
    const { status, out } = runLeg(root, { [decide.EXEMPT_ENV]: '1' });
    expect(status).toBe(0);
    expect(out).toContain('allowed path(s): none');
  });

  it('when a side cannot be compared and the token is set, should still refuse', () => {
    // given: the same uncomparable path as above, under the exemption token
    // when:  the leg runs
    // then:  it refuses: the token exempts a DIVERGENCE the committer chose, never a
    //        check that did not run ("a detector that cannot run is a gate FAILURE")
    const root = makeRepo();
    write(root, 'd.txt', 'staged\n');
    mustGit(root, ['add', 'd.txt']);
    rmSync(join(root, 'd.txt'));
    mkdirSync(join(root, 'd.txt'));
    const { status, out } = runLeg(root, { [decide.EXEMPT_ENV]: '1' });
    expect(status).toBe(1);
    expect(out).toContain('COULD NOT BE COMPARED');
    expect(out).toContain('not a regular file');
    expect(out).toContain('does NOT cover this');
    expect(out).not.toContain('EXEMPTION ACTIVE');
  });

  it('when the token is 0, false, no, off or empty, should still refuse a divergence', () => {
    // given: a real divergence and every value a reader might write meaning "off"
    // when:  the leg runs with each of them
    // then:  only the documented `1` exempts; every other value leaves the gate ON,
    //        because someone writing `=false` believes they switched it off
    const root = makeRepo();
    stageThenEdit(root);
    const statuses: Record<string, number | null> = {};
    for (const value of ['0', 'false', 'no', 'off', '']) {
      statuses[value] = runLeg(root, { [decide.EXEMPT_ENV]: value }).status;
    }
    expect(statuses).toEqual({ '0': 1, false: 1, no: 1, off: 1, '': 1 });
    expect(runLeg(root, { [decide.EXEMPT_ENV]: '1' }).status).toBe(0);
  });
});

// ---- the pure branch table --------------------------------------------------

describe('Scenario: staged-parity — the decision without a repository', () => {
  it('when both sides are the same bytes, should report parity', () => {
    // given: two sides holding identical bytes and the same git identity
    // when:  they are compared
    // then:  the path is in parity
    const bytes = Buffer.from('same\n');
    const oid = 'a'.repeat(40);
    const outcome = decide.compareStagedPath(
      'f',
      { kind: 'bytes', oid, bytes },
      { kind: 'bytes', oid, bytes }
    );
    expect(outcome.status).toBe('parity');
  });

  it('when the two sides share git identity but differ as raw bytes, should report parity', () => {
    // given: the CRLF shape at its smallest — one file, stored LF, written CRLF
    // when:  the two sides are compared
    // then:  the identity decides, so this is parity; a byte comparison calls it a
    //        divergence and refuses a tree git calls clean
    const oid = 'b'.repeat(40);
    const staged: Side = { kind: 'bytes', oid, bytes: Buffer.from('one\ntwo\n') };
    const worktree: Side = { kind: 'bytes', oid, bytes: Buffer.from('one\r\ntwo\r\n') };
    expect(staged.bytes.equals(worktree.bytes)).toBe(false);
    expect(decide.compareStagedPath('crlf.txt', staged, worktree).status).toBe('parity');
  });

  it('when the two sides differ in size, should name both sizes in the detail', () => {
    // given: a staged blob and a longer worktree file, with different identities
    // when:  they are compared
    // then:  the divergence detail carries both sizes and both hashes
    const staged: Side = { kind: 'bytes', oid: 'c'.repeat(40), bytes: Buffer.from('one\n') };
    const worktree: Side = { kind: 'bytes', oid: 'd'.repeat(40), bytes: Buffer.from('one\ntwo\n') };
    const outcome = decide.compareStagedPath('f', staged, worktree);
    expect(outcome.status).toBe('divergence');
    expect(outcome.detail).toContain('staged 4 B');
    expect(outcome.detail).toContain('worktree 8 B');
    expect(outcome.detail).toMatch(/staged 4 B \([0-9a-f]{12}\)/);
  });

  it('when both sides are missing, should report parity rather than a divergence', () => {
    // given: a deleted path — no index entry and no file, which is how a rename's old half arrives
    // when:  the outcomes are judged
    // then:  nothing is refused
    const outcome = decide.compareStagedPath('f', { kind: 'missing' }, { kind: 'missing' });
    const verdict = decide.decideStagedParity({ outcomes: [outcome], scopeNote: 'x' });
    expect(outcome.status).toBe('parity');
    expect(verdict.exitCode).toBe(0);
  });

  it('when exactly one side is missing, should refuse in both directions', () => {
    // given: a path whose two sides disagree about whether the file exists
    // when:  both are judged
    // then:  both are divergences and the leg refuses
    const stagedOnly = decide.compareStagedPath(
      'gone',
      { kind: 'bytes', oid: 'e'.repeat(40), bytes: Buffer.from('x\n') },
      { kind: 'missing' }
    );
    const diskOnly = decide.compareStagedPath(
      'kept',
      { kind: 'missing' },
      { kind: 'bytes', oid: 'f'.repeat(40), bytes: Buffer.from('x\n') }
    );
    const verdict = decide.decideStagedParity({ outcomes: [stagedOnly, diskOnly], scopeNote: 'x' });
    expect(stagedOnly.status).toBe('divergence');
    expect(diskOnly.status).toBe('divergence');
    expect(verdict.exitCode).toBe(1);
  });

  it('when a side is uncomparable, should refuse and carry the reason', () => {
    // given: an index side that could not be read
    // when:  it is judged
    // then:  it refuses, printing the reason the side gave
    const outcome = decide.compareStagedPath(
      'f',
      { kind: 'uncomparable', reason: 'the blob is missing from the object database' },
      { kind: 'bytes', oid: 'a1'.repeat(20), bytes: Buffer.from('x\n') }
    );
    const verdict = decide.decideStagedParity({ outcomes: [outcome], scopeNote: 'x' });
    expect(verdict.exitCode).toBe(1);
    expect(verdict.lines.join('\n')).toContain('COULD NOT BE COMPARED');
    expect(verdict.lines.join('\n')).toContain('missing from the object database');
  });

  it('when outcomes arrive out of order, should print them sorted by path', () => {
    // given: two divergences handed over in reverse alphabetical order
    // when:  they are judged
    // then:  the printed order is the sorted one, so two runs are diffable
    const divergent = (path: string): Outcome => ({ path, status: 'divergence', detail: 'd' });
    const verdict = decide.decideStagedParity({
      outcomes: [divergent('z.txt'), divergent('a.txt')],
      scopeNote: 'x'
    });
    const printed = verdict.lines.filter((line) => line.includes('DIFFERS'));
    expect(printed[0]).toContain('a.txt');
    expect(printed[1]).toContain('z.txt');
  });
});

// ---- the injection control --------------------------------------------------

describe('Scenario: staged-parity — the refusal arms can fail', () => {
  it('when the divergence status is mutated to parity, should show the arm goes green', async () => {
    // given: a copy of the decide module with every `divergence` status renamed
    // when:  the mutated copy judges an outcome that really diverges
    // then:  it passes, which is the proof the real arm's refusal comes from that status
    const source = readFileSync(DECIDE_SRC, 'utf8');
    const mutated = source.split("'divergence'").join("'parity'");
    expect(mutated).not.toBe(source);
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'peaks-staged-parity-mut-')));
    tempRoot(dir);
    const copy = join(dir, 'decide.mjs');
    writeFileSync(copy, mutated);
    const injected = (await import(pathToFileURL(copy).href)) as Decide;
    const verdict = injected.decideStagedParity({
      outcomes: [{ path: 'a.txt', status: 'divergence', detail: 'staged 1 B vs worktree 2 B' }],
      scopeNote: 'x'
    });
    expect(verdict.exitCode).toBe(0);
    expect(verdict.lines.join('\n')).not.toContain('REFUSED');
  });
});
