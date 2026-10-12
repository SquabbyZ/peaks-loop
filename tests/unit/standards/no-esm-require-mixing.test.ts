// tests/unit/standards/no-esm-require-mixing.test.ts
//
// Every package.json in this repository declares `"type": "module"`, so `require` does
// not exist at runtime and any `require(` call that runs throws `require is not
// defined`. This guard refuses that call, in every scannable file the ESM-source census
// names, unless a `createRequire` in the same file binds the identifier.
//
// WHY NOTHING CAUGHT IT, AND WHY A GUARD IS THE FIX
//
// Sixteen such calls had accumulated across fourteen files, and fifteen of them sat
// inside a function body as a "lazy" require — so they only threw on their own cold
// path. One of them (`scripts/fix-dispatcher.js`) sat at top level, which means that
// file could not load at all. None of it was visible to CI: `tsc` does not care (a
// `require` call is well-typed in an ESM file), vitest never walked those paths, and ESLint's
// `@typescript-eslint/no-require-imports` was reported only as a bare `require` is
// forbidden with no runtime consequence attached. Prose could not hold the line
// either: two of the lazy-form rationales were simply wrong — a static import of a Node
// builtin neither "pulls `node:fs` into a test environment" nor "leaks internals" — and
// the third claim, that `node:fs` was already imported at the top of the same files, was
// false of three of the four files that carried a rationale (only `run-driver.ts` had
// one). The pattern returned because nothing could fail on it. This file is that thing.
//
// WHAT THIS GUARD PROVES
//
// That no scannable census file holds a `require(` call whose `require` identifier is
// bound by nothing, and that scanning the live tree reports zero of them. It covers the
// two SHIM spellings too (`globalThis.require(`, `module.require(`) — the reintroduction
// this sweep's auditors reached for, which binds no local identifier at all.
//
// WHAT IT DOES NOT PROVE — read before treating ESM safety as total. Each limit is a
// stated boundary, not a disclaimer.
//
//   (1) IT IS STATIC, NOT RUNTIME. It reads text and parses it; it never executes
//       anything. `eval`, `new Function`, `import.meta.resolve` and any INDIRECT call
//       (`const r = require; r('node:fs')`) are invisible to it. Nor can it see a
//       `require` that reaches a file through a re-export from outside the census.
//   (2) THE BINDING TEST IS PER-FILE, NOT PER-SCOPE. One `createRequire` anywhere in a
//       file sanctions every `require(` call in that file, including one in a function
//       that cannot see the binding. This is the rule the slice was specified with; a
//       scope-aware resolver is a separate decision with its own measurement.
//   (3) `tests/**` AND `docs/**` ARE OUT OF SCOPE. `tests/**` is where the sanctioned
//       `createRequire` diagnostics already live and is delivered by its own config; a
//       guard here would have to re-litigate each of them. The cost of that choice is
//       real and recorded: a NEW test file can carry a bare `require(` unpunished.
//   (4) `.husky/pre-commit` AND `.husky/pre-push` CARRY NO EXTENSION. They are POSIX
//       shell, so no JS/TS parse applies, and they are enumerated-but-not-parsed. The
//       guard asserts that they are the ONLY extensionless census files, so a new one
//       fails here rather than being skipped silently.
//   (5) IT DOES NOT PROVE ANY REPLACEMENT IMPORT IS CORRECT — only that no unbound
//       `require(` call remains. Whether the code still behaves the same is the
//       affected suites' question, not this one.
//
// WHY THE CONTROLS ARE NOT OPTIONAL. An always-green guard and a working one are
// indistinguishable from a green run, so this file drives the SAME functions its live leg
// calls over deliberately damaged inputs, and one of those inputs is not fabricated at
// all: it is the VERBATIM PRE-FIX CONTENT of one of the fourteen files
// (`tests/unit/standards/fixtures/loop-eval-capture-index.prefix.txt`, taken byte-for-byte
// from the tree before the sweep). That control is required to be reported and, in the
// case directly below it, the post-fix content of the SAME file is required to be clean.
// A control that cannot fail is not a control — and a control that was never shown to
// fail on the input it was written to refuse is not evidence.
//
// THERE IS NO ALLOWLIST AND NO RATCHET. The target is zero, and the live leg asserts zero.
//
// WHERE THE MACHINERY LIVES
//
// The walk, both collectors, the git cross-check, the binding analysis, the decision,
// the failure message and the fixture harness are in
// `tests/unit/standards/_no-esm-require-scan.ts` — a scan library, not a second test
// file, so this stays the one collected scenario module and every assertion literal
// stays here.

import { readFileSync } from 'node:fs';
import { dirname, join, relative as relativePath, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  decide,
  describeViolations,
  FULL_ARM,
  isGitIgnored,
  listExtensionlessFromGit,
  listFilesFromGit,
  listIgnoredFromGit,
  listOffListFromGit,
  scanTree,
  toPosix,
  withFixtureTree,
  type RequireHit
} from './_no-esm-require-scan.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** The file whose pre-fix bytes are the control, and the path the fixture is scanned at. */
const CONTROL_FILE = 'src/cli/commands/loop-eval-capture-index.ts';

/** Verbatim pre-fix content — see the header. Never a paraphrase. */
const PREFIX_SOURCE = readFileSync(
  join(REPO_ROOT, 'tests/unit/standards/fixtures/loop-eval-capture-index.prefix.txt'),
  'utf8'
);

/** The same file, after the sweep: the other half of the discriminating pair. */
const FIXED_SOURCE = readFileSync(join(REPO_ROOT, CONTROL_FILE), 'utf8');

declareDimensions(
  'tests/unit/standards/no-esm-require-mixing.test.ts',
  ['render', 'behavior', 'integration'],
  [
    {
      dim: 'a11y',
      reason: 'no user-facing surface: emits no stdout, exit code or message of its own'
    }
  ]
);

/** Scan one fixture file, at one census path, through the same machinery the live leg uses. */
function scanOne(path: string, content: string, arm = FULL_ARM): readonly RequireHit[] {
  let result: readonly RequireHit[] = [];
  withFixtureTree({ [path]: content }, (root) => {
    result = decide(scanTree(root, arm));
  });
  return result;
}

// ── integration: the real census ─────────────────────────────────────

describe('Scenario: integration — the guard runs over the real census', () => {
  const scan = scanTree(REPO_ROOT);
  const violations = decide(scan);
  const filesFromGit = listFilesFromGit(REPO_ROOT);

  it('when the census is walked, should reach exactly the files git reports', () => {
    // given: the real repository root and the census git reports for it
    // when:  the filesystem walk and the git enumeration are compared
    // then:  the two sets are equal, and a new file keeps them equal without an edit
    // Set equality, not a count: a dropped subtree, a narrowed root or an early return
    // breaks it, while a NEW FILE does not — git sees it and the walk sees it. This is
    // also the anti-collapse arm: an empty walk cannot equal a non-empty census.
    const walked = scan.files.map((file) => toPosix(relativePath(REPO_ROOT, file))).sort();
    expect(walked).toEqual(filesFromGit);
  });

  it('when a call is reported, should mention a `require` token on the same line', () => {
    // given: the real tree's two independent collectors, mechanism 1 and mechanism 2
    // when:  the reported call lines are looked for among the mentions
    // then:  every reported line is mentioned, and the mention list is non-empty
    // The anti-weakening arm. Mechanism 2 shares no traversal with mechanism 1 — it
    // never parses, mechanism 1 never reads a line — and a call always writes the token,
    // so mechanism 1 must be a SUBSET of mechanism 2, and neither can agree here with an
    // empty partner. The floor keeps the inclusion from being vacuously true.
    const mentioned = new Set(scan.mentions.map((mention) => `${mention.file}:${mention.line}`));
    const reported = scan.hits.map((hit) => `${hit.file}:${hit.line}`);
    expect(reported.filter((key) => !mentioned.has(key))).toEqual([]);
    expect(scan.mentions.length).toBeGreaterThan(0);
  });

  it('when the extensionless census is enumerated, should name only the two shell hooks', () => {
    // given: the real census, filtered to the files that carry no extension
    // when:  the extensionless population is enumerated from git
    // then:  it is exactly the two POSIX hooks — limit (4) in the header, measured
    expect(listExtensionlessFromGit(REPO_ROOT)).toEqual(['.husky/pre-commit', '.husky/pre-push']);
  });

  it('when the census is enumerated, should hold no file off both extension lists', () => {
    // given: the real census and the two stated lists — scannable code, declared non-code
    // when:  the population whose extension is on neither list is enumerated
    // then:  it is empty, so a new `src/x.jsx` fails here instead of being skipped silently
    expect(listOffListFromGit(REPO_ROOT)).toEqual([]);
  });

  it('when git is asked what it ignores, should name the ignored hook directory', () => {
    // given: the real repository, whose `.husky/_/` shims are ignored by its own `.gitignore`
    // when:  the ignore leg the walk reads is asked
    // then:  the ignored directory is named, so the pruning is driven by a real git answer
    //        and not by a list that is always empty
    expect(listIgnoredFromGit(REPO_ROOT)).toContain('.husky/_/');
  });

  it('when the census is scanned, should find no unbound require() call', () => {
    // given: the real repository and the scan the live leg runs
    // when:  the decision is read
    // then:  it is empty — the live target is zero, with no allowlist and no ratchet
    expect(violations, describeViolations(violations)).toEqual([]);
  });
});

// ── control: the guard must be able to fail, and must discriminate ───

describe('Scenario: control — the guard fires on the real pre-fix input, and only on it', () => {
  it('when the control bytes are read, should be the pre-fix content and not a paraphrase', () => {
    // given: the fixture captured from the tree before the sweep
    // when:  its shape and its prefix are read
    // then:  it is the real 41-line pre-fix file, and it differs from the fixed one
    // Without this, "the control failed" could mean the fixture was typed wrong.
    expect(PREFIX_SOURCE.split('\n').length - 1).toBe(41);
    expect(PREFIX_SOURCE.startsWith('// The cycle-file index seam for `--capture-score`.')).toBe(
      true
    );
    expect(PREFIX_SOURCE).not.toBe(FIXED_SOURCE);
  });

  it('when the pre-fix bytes are scanned, should report the real call at its real line', () => {
    // given: the verbatim pre-fix content, scanned at the census path it came from
    // when:  the decision is read
    // then:  exactly the one real call is reported, with the line's own text
    expect(scanOne(CONTROL_FILE, PREFIX_SOURCE)).toEqual([
      {
        file: CONTROL_FILE,
        line: 26,
        text: "const fs = require('node:fs') as typeof import('node:fs');"
      }
    ]);
  });

  it('when the post-fix bytes are scanned, should report nothing — the control discriminates', () => {
    // given: the same file's post-fix content, at the same census path
    // when:  the same checker is run over it
    // then:  it is clean — one input changed, and the two legs disagree by design
    // Same checker, same path, one input changed. If the checker could not fail (above)
    // or could not pass (here), one of these two legs would go red.
    expect(scanOne(CONTROL_FILE, FIXED_SOURCE)).toEqual([]);
  });

  it('when the pre-fix bytes are reported, should name the file through the operator message', () => {
    // given: a violation produced from the verbatim pre-fix content
    // when:  the message an operator reads is rendered
    // then:  it carries the runtime consequence, the `file:line` and the line's text
    const message = describeViolations(scanOne(CONTROL_FILE, PREFIX_SOURCE));
    expect(message).toContain('require is not defined');
    expect(message).toContain(`${CONTROL_FILE}:26`);
    expect(message).toContain("require('node:fs')");
  });

  it('when the call arm is disabled, should go quiet on the pre-fix input', () => {
    // given: the pre-fix content and the collector arm turned off
    // when:  the damaged scan runs over it
    // then:  it reports nothing — the arm that carries the verdict is the arm that fires
    // The injection: the arm that carries the verdict must be the arm that fires. If a
    // future edit moves the report off this arm, this case stops being empty and fails.
    expect(scanOne(CONTROL_FILE, PREFIX_SOURCE, { ...FULL_ARM, calls: false })).toEqual([]);
  });

  it('when the read arm is disabled, should go quiet on the pre-fix input', () => {
    // given: the pre-fix content and a walk that enumerates but never reads
    // when:  the damaged scan runs over it
    // then:  the walk still counts the file and sees no mention in it
    // A walk that enumerates but never reads is exactly the guard-shaped hole this
    // slice exists to close, so it is driven here rather than assumed impossible.
    let files = 0;
    let mentions = 0;
    withFixtureTree({ [CONTROL_FILE]: PREFIX_SOURCE }, (root) => {
      const scan = scanTree(root, { ...FULL_ARM, read: false });
      files = scan.files.length;
      mentions = scan.mentions.length;
    });
    expect(files).toBeGreaterThan(0);
    expect(mentions).toBe(0);
  });
});

// ── behavior: the decision, on fixtures ──────────────────────────────

describe('Scenario: behavior — the decision, on fixture files', () => {
  it('when a require sits in a function body, should flag it (the shape all fifteen carried)', () => {
    // given: a fixture whose require call sits inside a function body
    // when:  the fixture tree is scanned
    // then:  exactly that call is reported, at its line and with its text
    withFixtureTree(
      {
        'src/a.ts':
          'export function f(): string {\n' +
          "  const fs = require('node:fs') as typeof import('node:fs');\n" +
          "  return fs.readFileSync('x', 'utf8');\n" +
          '}\n'
      },
      (root) => {
        expect(decide(scanTree(root))).toEqual([
          {
            file: 'src/a.ts',
            line: 2,
            text: "const fs = require('node:fs') as typeof import('node:fs');"
          }
        ]);
      }
    );
  });

  it('when a require sits at top level, should flag it (the shape that breaks on load)', () => {
    // given: a fixture whose require call sits at module top level
    // when:  the fixture tree is scanned
    // then:  it is reported — this is the shape that makes the file unloadable
    withFixtureTree({ 'scripts/a.js': "const fs = require('fs');\n" }, (root) => {
      expect(decide(scanTree(root))).toHaveLength(1);
    });
  });

  it('when the call is require.resolve or require.cache, should flag it — the same family', () => {
    // given: a fixture reaching the property forms of the same identifier
    // when:  the fixture tree is scanned
    // then:  the property form is a call like any other
    withFixtureTree({ 'bin/a.mjs': "export const p = require.resolve('node:fs');\n" }, (root) =>
      expect(decide(scanTree(root))).toHaveLength(1)
    );
  });

  it('when the file binds require with createRequire, should pass — the opposite direction', () => {
    // given: the sanctioned ESM spelling of a CommonJS handle
    // when:  the fixture tree is scanned
    // then:  nothing is reported: the identifier the call uses is bound
    withFixtureTree(
      {
        'src/b.ts':
          "import { createRequire } from 'node:module';\n" +
          '\n' +
          'const require = createRequire(import.meta.url);\n' +
          '\n' +
          'export function load(p: string): unknown {\n' +
          '  return require(p) as unknown;\n' +
          '}\n'
      },
      (root) => expect(decide(scanTree(root))).toEqual([])
    );
  });

  it('when createRequire is aliased or read off the module object, should pass', () => {
    // given: the same sanction written as an alias, and as a namespace property
    // when:  the fixture tree is scanned
    // then:  both spellings are read as bindings, so neither is a violation
    withFixtureTree(
      {
        'src/c.ts':
          "import { createRequire as makeRequire } from 'node:module';\n" +
          'const require = makeRequire(import.meta.url);\n' +
          'export const v = (p: string): unknown => require(p) as unknown;\n',
        'src/d.ts':
          "import * as nodeModule from 'node:module';\n" +
          'const require = nodeModule.createRequire(import.meta.url);\n' +
          'export const v = (p: string): unknown => require(p) as unknown;\n'
      },
      (root) => expect(decide(scanTree(root))).toEqual([])
    );
  });

  it('when a file only IMPORTS createRequire, should still flag a bare require', () => {
    // given: a fixture that imports the helper but never calls it
    // when:  the fixture tree is scanned
    // then:  the bare require is reported — importing the helper is not binding it
    // The discriminating neighbour of the case above: importing the helper is not
    // binding the identifier. Without this, a guard that keyed on "the file mentions
    // createRequire" would pass every case here and refuse nothing real.
    withFixtureTree(
      {
        'src/e.ts':
          "import { createRequire } from 'node:module';\n" +
          'export const v = (p: string): unknown => require(p) as unknown;\n'
      },
      (root) => {
        expect(decide(scanTree(root))).toEqual([
          {
            file: 'src/e.ts',
            line: 2,
            text: 'export const v = (p: string): unknown => require(p) as unknown;'
          }
        ]);
      }
    );
  });

  it('when the shim binds require on globalThis or module, should flag the call', () => {
    // given: the `globalThis.require` / `module.require` shim, which binds no identifier
    // when:  the fixture tree is scanned
    // then:  both calls are reported — a shim is not the sanctioned binding
    // This is the reintroduction this sweep's auditors reached for when the call sites
    // were broken, so the guard must not be blind to it.
    withFixtureTree(
      {
        'src/i.mjs':
          'globalThis.require = createRequire(import.meta.url);\n' +
          "const fs = globalThis.require('node:fs');\n",
        'src/j.mjs': "export const m = module.require('node:module');\n"
      },
      (root) => {
        expect(decide(scanTree(root)).map((hit) => `${hit.file}:${hit.line}`)).toEqual([
          'src/i.mjs:2',
          'src/j.mjs:1'
        ]);
      }
    );
  });

  it('when the shim spelling sits in prose, should read it as data, not as a call', () => {
    // given: `globalThis.require(` written inside a comment and inside a string literal
    // when:  the fixture tree is scanned
    // then:  neither is reported, so the shim arm cannot fire on the token alone
    withFixtureTree(
      {
        'src/k.ts': '// measured: a globalThis.require("node:fs") shim was needed here\n',
        'src/l.ts': 'export const s = "module.require(\'node:fs\')";\n'
      },
      (root) => expect(decide(scanTree(root))).toEqual([])
    );
  });

  it('when a path is compared with the git ignore list, should match on a boundary', () => {
    // given: the ignored directory `.husky/_/` and one ignored file entry
    // when:  four paths are tested against them
    // then:  a directory entry matches by prefix, and never as a bare substring
    expect(isGitIgnored('.husky/_/husky.sh', ['.husky/_/'])).toBe(true);
    expect(isGitIgnored('.husky/pre-push', ['.husky/_/'])).toBe(false);
    expect(isGitIgnored('.husky/_extra/a.ts', ['.husky/_/'])).toBe(false);
    expect(isGitIgnored('src/a.ts', ['src/a.ts'])).toBe(true);
  });

  it('when the walk is given the ignore list, should prune those files from the census', () => {
    // given: a fixture file carrying an unbound require, with and without an ignore rule
    // when:  the same tree is scanned both ways
    // then:  the ignored file is absent from the WALK, and reported when it is not ignored
    withFixtureTree({ 'src/a.mjs': "const fs = require('node:fs');\n" }, (root) => {
      expect(decide(scanTree(root, FULL_ARM, []))).toHaveLength(1);
      expect(scanTree(root, FULL_ARM, ['src/a.mjs']).files).toEqual([]);
    });
  });

  it('when `require(` appears in a COMMENT, should read it as prose, not as a call', () => {
    // given: a fixture whose only `require(` sits in a line comment
    // when:  the fixture tree is scanned
    // then:  nothing is reported — the census contains this literal shape today
    withFixtureTree(
      { 'src/f.ts': '// measured: the prior require("node:fs") here was removed\n' },
      (root) => expect(decide(scanTree(root))).toEqual([])
    );
  });

  it('when `require(` appears inside a STRING, should read it as data, not as a call', () => {
    // given: a fixture whose only `require(` sits inside a string literal
    // when:  the fixture tree is scanned
    // then:  nothing is reported — the token alone is not a call
    withFixtureTree({ 'src/g.ts': 'export const s = \'require("node:fs")\';\n' }, (root) =>
      expect(decide(scanTree(root))).toEqual([])
    );
  });

  it('when a file sits outside the census, should ignore it', () => {
    // given: the same violation bytes at a path no census root covers
    // when:  the fixture tree is scanned
    // then:  nothing is reported — the rule is scoped to the census
    // `packages/<pkg>/tests` and `docs/` are not census roots; the same bytes there are
    // not this rule's business.
    withFixtureTree(
      { 'packages/fixture-pkg/tests/a.ts': "const fs = require('node:fs');\n" },
      (root) => expect(decide(scanTree(root))).toEqual([])
    );
  });

  it('when a census tree holds no require at all, should pass it', () => {
    // given: a fixture with no `require` token anywhere
    // when:  the fixture tree is scanned
    // then:  nothing is reported — the guard is not a scan that reports everything
    withFixtureTree(
      { 'src/h.ts': "import { join } from 'node:path';\nexport const j = join('a', 'b');\n" },
      (root) => expect(decide(scanTree(root))).toEqual([])
    );
  });
});

// ── render: the failure message ──────────────────────────────────────

describe('Scenario: render — the failure message names the file, the line and the text', () => {
  it('when a violation is rendered, should name the call and the runtime consequence', () => {
    // given: one violation, of the shape the sweep removed
    // when:  the failure message is rendered
    // then:  it carries the `file:line`, the call text and what breaks at runtime
    const message = describeViolations([
      {
        file: 'src/services/loop/monotonic-runner.ts',
        line: 153,
        text: "const fs = require('node:fs') as typeof import('node:fs');"
      }
    ]);
    expect(message).toContain('src/services/loop/monotonic-runner.ts:153');
    expect(message).toContain("require('node:fs')");
    expect(message).toContain('require is not defined');
  });

  it('when there is no violation, should say nothing at all', () => {
    // given: an empty violation list
    // when:  the failure message is rendered
    // then:  it is the empty string, so a green run prints no defect text
    expect(describeViolations([])).toBe('');
  });
});
