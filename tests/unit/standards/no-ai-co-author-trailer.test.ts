// tests/unit/standards/no-ai-co-author-trailer.test.ts
//
// The enforcement behind the red rule `CLAUDE.md` states as
// "effective 2026-07-01, no exceptions":
//
//   No commit message in this repository may contain `Co-Authored-By: Claude`,
//   `Co-Authored-By: Anthropic`, or any equivalent AI-assistant attribution
//   trailer. SquabbyZ is the sole author of every commit.
//
// WHY THIS FILE EXISTS. Until now that rule had ZERO automated execution.
// `.git/hooks/` held only `.sample` files, there is no husky / lefthook /
// commitlint, and the string `Co-Authored-By` appeared in `tests/` only inside
// one fixture's prose. A rule with no executor is a statement of intent, and
// this repo has already paid for that mistake three times (diagnosis
// 2026-09-15: `CLAUDE.md` cited a deleted guard as "will fail the suite";
// `.peaks/standards/loop-engineering-guidelines.md` cited its own deleted test
// as "exercised by"; `peaks standards lint` was documented and never existed).
//
// WHY A VITEST GUARD AND NOT A GIT HOOK. `.git/hooks/` is NOT tracked by git:
// anything installed there is absent in a fresh clone, in CI, and on every
// machine but the one that ran the installer. The two forms that ARE carried
// by a clone are a CI check and a test. This is the test —
//
//   - it runs on every `pnpm test:unit`, locally and in CI's `Test` step, with
//     no new entry point to remember and no installer to have run;
//   - its checker is a pure function over message strings, so the injection
//     that proves it can fail is a permanent, ordinary test case rather than a
//     one-off manual demonstration;
//   - it needs no `core.hooksPath` management, which would be new product
//     surface for a rule this file can enforce on its own.
//
// The residual gap is stated rather than hidden: this DETECTS, it does not
// PREVENT. A violating commit is already in history when the guard runs, and
// the remedy is to rewrite it before it is pushed. That gap is narrow here
// because the repo pushes directly to `main` and the unit suite is the
// pre-push gate, but it is a gap. A `.git/hooks/commit-msg` would close it and
// is deliberately NOT installed — see above.
//
// CI DEPTH. `actions/checkout@v4` defaults to `fetch-depth: 1`, so in the main
// matrix this reads the tip commit only — which, for a direct push to `main`,
// is exactly the pushed commit. The `commit-message-red-line` job in
// `.github/workflows/ci.yml` runs this same file with `fetch-depth: 0` so the
// whole-history claim is enforced on at least one runner instead of asserted.
//
// Dimensions covered:
//   - behavior:    the checker flags AI attribution and clears the three
//                  shapes this repo's history legitimately carries (both
//                  controls live in this file, so the guard cannot pass by
//                  being unable to fail)
//   - integration: the real commit history is read off the real working tree
//   - render:      OMITTED — the checker returns findings, it renders nothing
//   - a11y:        OMITTED — no human-facing surface; findings are reported
//                  through the assertion message, which names the commit

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

declareDimensions(
  'tests/unit/standards/no-ai-co-author-trailer.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'the checker returns findings; it renders nothing' },
    { dim: 'a11y', reason: 'no human-facing surface; findings surface in the assertion message' }
  ]
);

const REPO_ROOT = resolve(__dirname, '..', '..', '..');

/** A git trailer key that could carry an attribution. */
const TRAILER_KEY =
  /^[ \t]*(?:Co-[Aa]uthored-[Bb]y|Authored-[Bb]y|Assisted-[Bb]y|Generated-[Bb]y|Written-[Bb]y|Reviewed-[Bb]y|Committed-[Bb]y|Made-[Bb]y)[ \t]*:[ \t]*(.*)$/;

/**
 * An assistant or vendor named in the trailer's identity. Whole words, so
 * `Claude`, `claude-code[bot]`, `anthropic/claude-code` and `GitHub Copilot`
 * all match and `SquabbyZ` matches nothing.
 */
const AI_ATTRIBUTION_NAME =
  /\b(?:claude|anthropic|openai|chatgpt|gpt|copilot|gemini|codex|cursor|windsurf|devin|aider|tabnine|qwen|deepseek)\b/i;

/** …or the address is a vendor address, whatever the display name says. */
const AI_ATTRIBUTION_EMAIL = /@(?:anthropic|openai)\.com\b/i;

/**
 * A trailer whose value is a parenthesised NOTE rather than an identity is not
 * an attribution, whatever it mentions.
 *
 * This is the rule that keeps the guard off `CLAUDE.md` in its own history.
 * `Co-Authored-By: (omitted per CLAUDE.md red rule)` and
 * `Co-Authored-By: (none — per dev-preference.md rule 3)` are real commit
 * trailers in this repo — written by the owner to say "I deliberately did not
 * add one" — and both name the rule's own file. A git trailer's value is an
 * identity (a name, usually with an address); a `(` in that position is a
 * sentence. Excluding that shape is narrower and more honest than tolerating
 * every phrase that happens to contain a vendor word.
 */
const IS_PARENTHESISED_NOTE = /^\(/;

export interface TrailerFinding {
  /** Index of the message in the input array. */
  readonly messageIndex: number;
  /** 1-based line number within that message. */
  readonly line: number;
  /** The offending trailer, trimmed. */
  readonly trailer: string;
}

/**
 * Every AI-attribution trailer in `messages`.
 *
 * `messages` is one full commit message per element, exactly as
 * `git log --format=%B` produces them. Only line-initial git trailers are
 * examined — that is the position a `Co-Authored-By:` trailer occupies, and
 * restricting the rule to it is what keeps a commit message that QUOTES this
 * red line (as the commit that introduced it does) out of the findings.
 */
export function findAiAttributionTrailers(messages: readonly string[]): TrailerFinding[] {
  const findings: TrailerFinding[] = [];
  messages.forEach((message, messageIndex) => {
    message.split('\n').forEach((line, zeroBased) => {
      const match = TRAILER_KEY.exec(line);
      if (match === null) return;
      const value = (match[1] ?? '').trim();
      const name = (value.split('<')[0] ?? '').trim();
      if (IS_PARENTHESISED_NOTE.test(name)) return;
      if (!AI_ATTRIBUTION_NAME.test(name) && !AI_ATTRIBUTION_EMAIL.test(value)) return;
      findings.push({ messageIndex, line: zeroBased + 1, trailer: line.trim() });
    });
  });
  return findings;
}

/** The full `git log` message bodies of every commit reachable from HEAD. */
export function readCommitMessages(repoRoot: string): string[] {
  const raw = execFileSync('git', ['log', '--format=%B%x00'], {
    cwd: repoRoot,
    encoding: 'utf8',
    // 1876 commits of prose is ~1 MB; the default 1 MB buffer truncates the
    // read and would turn a full-history check into a prefix check.
    maxBuffer: 64 * 1024 * 1024,
    // Repo standard (`tests/unit/spawn-windows-hide-guard.test.ts`): every
    // child_process call site pins this, or Windows flashes a console window.
    windowsHide: true
  });
  return raw
    .split('\u0000')
    .map((entry) => entry.replace(/^\n+/, '').replace(/\n+$/, ''))
    .filter((entry) => entry.length > 0);
}

function describeFindings(
  findings: readonly TrailerFinding[],
  messages: readonly string[]
): string {
  return findings
    .map((f) => {
      const subject = (messages[f.messageIndex] ?? '').split('\n')[0] ?? '';
      return `message #${f.messageIndex} line ${f.line} ("${subject}"): ${f.trailer}`;
    })
    .join('\n');
}

describe('behavior — the trailer checker', () => {
  it('flags the two forms CLAUDE.md names', () => {
    const messages = [
      'fix: something\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n',
      'fix: something else\n\nCo-Authored-By: Anthropic\n'
    ];
    const findings = findAiAttributionTrailers(messages);
    expect(findings.map((f) => f.messageIndex)).toEqual([0, 1]);
    expect(findings.map((f) => f.trailer)).toEqual([
      'Co-Authored-By: Claude <noreply@anthropic.com>',
      'Co-Authored-By: Anthropic'
    ]);
  });

  it('flags equivalent AI-assistant attribution trailers', () => {
    const messages = [
      'feat: a\n\nAssisted-By: Claude Opus 4\n',
      'feat: b\n\nGenerated-By: anthropic/claude-code\n',
      'feat: c\n\nCo-authored-by: claude-code[bot] <noreply@anthropic.com>\n',
      'feat: d\n\nCo-Authored-By: Some Bot <bot@openai.com>\n',
      'feat: e\n\nCo-Authored-By: GitHub Copilot <copilot@github.com>\n'
    ];
    expect(findAiAttributionTrailers(messages)).toHaveLength(5);
  });

  it('clears the three trailer shapes this repo’s own history carries', () => {
    // Given: the real, legitimate trailers found across 1876 commits. These are
    // the anti-false-positive controls — without them a guard that flagged
    // every `Co-Authored-By:` would look correct while being unusable.
    const messages = [
      'feat: a\n\nCo-Authored-By: SquabbyZ <601709253@qq.com>\n',
      'feat: b\n\nCo-Authored-By: none\n',
      'feat: c\n\nCo-Authored-By: (omitted per CLAUDE.md red rule)\n',
      'feat: d\n\nCo-Authored-By: (none — per dev-preference.md rule 3)\n'
    ];
    expect(findAiAttributionTrailers(messages)).toEqual([]);
  });

  it('clears a mid-line mention, because only line-initial trailers are examined', () => {
    // Given: the commit that introduced the red rule quotes it in prose, and
    // so does any commit explaining it. A substring rule would fail the repo
    // for describing its own rule.
    const messages = [
      'policy: no AI co-author trailers\n\nNo message may contain `Co-Authored-By: Claude` or an equivalent.\n'
    ];
    expect(findAiAttributionTrailers(messages)).toEqual([]);
  });

  it('reports the line number of the offending trailer', () => {
    const findings = findAiAttributionTrailers(['subject\n\nbody\n\nCo-Authored-By: Claude\n']);
    expect(findings).toEqual([{ messageIndex: 0, line: 5, trailer: 'Co-Authored-By: Claude' }]);
  });
});

describe('integration — the real commit history', () => {
  it('holds no AI-attribution trailer in any reachable commit', () => {
    const messages = readCommitMessages(REPO_ROOT);

    // The read must not be vacuous. `git log` returning nothing would make the
    // assertion below pass while checking nothing at all, which is the exact
    // failure mode this file exists to avoid.
    expect(messages.length, 'git log returned no commits — the guard read nothing').toBeGreaterThan(
      0
    );

    const findings = findAiAttributionTrailers(messages);
    expect(
      findings,
      `AI-attribution trailer(s) in commit history:\n${describeFindings(findings, messages)}\n` +
        'Rewriting the offending commit before it is pushed is the remedy; see the red rule in CLAUDE.md.'
    ).toEqual([]);
  });

  it(
    'flags a repository that really has the trailer — the injection control',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // The test above asserts the real repo is CLEAN. A guard that cannot go
      // red on an unclean one is indistinguishable from a guard that reads
      // nothing, and this repo has shipped that shape before (diagnosis
      // 2026-09-15: an assertion that could not fail). So: build a real git
      // repository, commit a real violating message into it, and drive the SAME
      // `readCommitMessages` + `findAiAttributionTrailers` chain over it.
      //
      // Both halves matter — the clean repo below is the control that shows the
      // red result comes from the trailer and not from "any temp repo fails".
      const base = mkdtempSync(join(tmpdir(), 'peaks-coauthor-injection-'));
      const cleanRepo = join(base, 'clean');
      const dirtyRepo = join(base, 'dirty');
      const commit = (repo: string, message: string, file: string): void => {
        mkdirSync(repo, { recursive: true });
        execFileSync('git', ['init', '-q'], { cwd: repo, windowsHide: true });
        execFileSync('git', ['config', 'user.name', 'SquabbyZ'], { cwd: repo, windowsHide: true });
        execFileSync('git', ['config', 'user.email', '601709253@qq.com'], {
          cwd: repo,
          windowsHide: true
        });
        // Keeps `git add` from warning about LF→CRLF on a machine with
        // core.autocrlf=true; the warning is stderr noise in the suite report.
        execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: repo, windowsHide: true });
        writeFileSync(join(repo, file), 'x\n', 'utf8');
        execFileSync('git', ['add', '-A'], { cwd: repo, windowsHide: true });
        execFileSync('git', ['commit', '-q', '-m', message], { cwd: repo, windowsHide: true });
      };
      try {
        commit(cleanRepo, 'fix(misc): a normal commit', 'a.txt');
        commit(dirtyRepo, 'fix(misc): a normal commit', 'a.txt');
        commit(
          dirtyRepo,
          'fix(misc): an injected commit\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
          'b.txt'
        );

        // then: the control is clean and reads a non-empty history…
        const cleanMessages = readCommitMessages(cleanRepo);
        expect(cleanMessages.length).toBe(1);
        expect(findAiAttributionTrailers(cleanMessages)).toEqual([]);

        // …and the injected repo is RED, naming the trailer it found
        const dirtyMessages = readCommitMessages(dirtyRepo);
        expect(dirtyMessages.length).toBe(2);
        const findings = findAiAttributionTrailers(dirtyMessages);
        expect(findings).toHaveLength(1);
        expect(findings[0]?.trailer).toBe('Co-Authored-By: Claude <noreply@anthropic.com>');
        expect(describeFindings(findings, dirtyMessages)).toContain('an injected commit');
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    }
  );
});
