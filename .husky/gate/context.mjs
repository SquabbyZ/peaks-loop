// .husky/gate/context.mjs
// Shared constants and the two printers every region of the gate reads: the
// slash-normalised repo root, the parsed baseline, the published scope filter, the
// one row printer (`makeCheck`) and the empty-change-set sentence (`reportEmpty`).
// Hoisted VERBATIM out of `.husky/peaks-gate.mjs` by rid
// `2026-10-02-wave9-gate-entry-split`; nothing here re-implements anything, and the
// line that decides which files `repo` mode measures is still in the entry.
//
// IMPORT SPELLING. A specifier that leaves the gate tree is anchored at the repo root
// (`../../scripts/…`, `../../.husky/…`), never at a sibling directory, for the reason
// documented in `.husky/peaks-gate.mjs`: a scratch copy of the gate has to load.
// Specifiers inside the gate tree are `./peer.mjs`, because a peer is only ever loaded
// from `.husky/gate/` — by the entry's own copy-safe `../.husky/gate/…` import.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXTENSIONS,
  filterScopeFiles,
  hasLintExtension,
  scopeDirs
} from '../../scripts/lint/lint-file-list.mjs';

// Slash-normalised ONCE, at the definition. `resolve()` returns backslashes on
// Windows, so a `p.split('\\').join('/')` path can never match a `${ROOT}/`
// prefix built from it — the first draft of this file did exactly that, and the
// eslint leg silently compared every file against nothing while reporting
// "improved N -> 0 findings". Six of seven injection arms passed anyway. Hence
// also the fail-closed check in stagedMode(): eslint not reporting on a file we
// asked about is an error, never a zero.
// ONE ANCHOR DEEPER THAN THE ENTRY. This definition sat in `.husky/peaks-gate.mjs`,
// where `<its dir>/..` is the repo root; the module is now in `.husky/gate/`, so the
// same `resolve()` needs a second `..` to reach the same value — and a scratch copy of
// the ENTRY (which `lint-file-list-parity.test.ts` runs from `.tmp/`) still resolves the
// real repo root, because this file is reached in place, not copied.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  .split('\\')
  .join('/');
const BASELINE_PATH = resolve(ROOT, '.peaks/lint/gate-baseline.json');

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
// The scope rule is `scripts/lint/lint-file-list.mjs`, not a copy in this file.
// It used to be a local `CODE_EXT` regex x `baseline.scope.dirs`, i.e. a second
// spelling of the rule `pnpm lint` also measures — and `tests/unit/lint/`
// observed the module, the baseline and `package.json`, but NOTHING observed
// this file's copy. Measured 2026-09-29: cutting the local regex to `ts|tsx`
// made `repo` mode check 1259 files instead of 1298, lose 80 findings, and still
// print `all whole-repo ceilings held` with exit 0. One list, one filter, both
// imported here, is what closes that class;
// `tests/unit/lint/lint-file-list-parity.test.ts` runs THIS file's `repo` mode
// and compares the count it reports against the published rule.
const SCOPE_DIRS = scopeDirs();

const rel = (p) => p.split('\\').join('/').replace(`${ROOT}/`, '');
// Per-path, so `staged` / `changed` keep their own filter step. The list is the
// files ONE commit touches, so calling the batch filter once per path costs
// nothing measurable and keeps one spelling of the rule.
const inScope = (p) => filterScopeFiles([p], SCOPE_DIRS, EXTENSIONS).length === 1;
/**
 * An empty change set, said out loud — and SINCE RID `2026-10-03-w10-rescope-a`,
 * a THIRD shape: an empty SET and an all-dropped set are different facts, and
 * the second is the new common case for docs/test-only commits (requirement 6).
 *
 * This used to read "no in-scope files staged, nothing to check." and exit 0.
 * An orchestrator read that as a PASS once — the exit code and the word count
 * were all it looked at. An empty set is LEGAL (a change set really can be
 * empty), so this must not become a failure; but it must also never be
 * mistakable for a verification result, because it is the absence of one. Hence
 * a message that a reader cannot flatten: it names the count, the source, and
 * what did NOT happen. The failure path is separate and shouts differently
 * ("push blocked", exit 1).
 */
function reportEmpty(source, droppedCount = 0) {
  if (droppedCount > 0) {
    console.log(
      `peaks-gate: NOTHING WAS COMPARED (${source}) — the change set held ${droppedCount} ` +
        'code file(s) and every one of them is OUTSIDE the lint scope (owner decision ' +
        '2026-10-03). This is a scope exemption, not a clean result: "nothing checked" ' +
        'and "0 findings" remain different sentences.'
    );
    return 0;
  }
  console.log(
    `peaks-gate: EMPTY CHANGE SET (${source}) — 0 in-scope files, NOTHING WAS CHECKED.\n` +
      '  This is neither a pass nor a failure: there was no file to compare against the\n' +
      '  baseline. Zero files checked is not "clean" — it is zero files checked.'
  );
  return 0;
}
// THE OUT-OF-SCOPE SENTENCE (rid `2026-10-03-w10-rescope-a`, H2 requirement 4):
// since the owner's boundary moved, a CODE file outside the enforced scope is
// exempt from the per-file ratchet — but a silent skip is §2.41's shape, so the
// exemption is named path by path. One implementation for `staged` and `changed`
// (the two per-file modes), differing only in the label. Non-code paths (.md,
// .json) are not named: they were never a candidate for any leg.
function outOfScopeNotice(label, allRelPaths) {
  const dropped = allRelPaths.filter((f) => !inScope(f) && hasLintExtension(f));
  if (dropped.length > 0) {
    console.log(
      `peaks-gate: ${dropped.length} ${label} file(s) are outside the lint scope and were ` +
        `not compared: ${dropped.join(', ')}`
    );
  }
  return dropped.length;
}
// ---------------------------------------------------------------------------
// the ceiling comparison — ONE row printer for every total
// ---------------------------------------------------------------------------
// Hoisted out of `repoMode` so `silent-warning` mode prints through it too. A
// second copy of this comparison would be exactly the thing this file's history
// warns about: a leg that reads green in one place and red in another.
function makeCheck(failures) {
  return (label, actual, ceiling) => {
    const ok = actual <= ceiling;
    console.log(
      `  ${ok ? '✓' : '✗'} ${label.padEnd(26)} ${String(actual).padStart(6)}   (ceiling ${ceiling})`
    );
    if (!ok) failures.push(`${label}: ${actual} > ceiling ${ceiling} (+${actual - ceiling})`);
  };
}

export {
  ROOT,
  BASELINE_PATH,
  baseline,
  SCOPE_DIRS,
  rel,
  inScope,
  outOfScopeNotice,
  reportEmpty,
  makeCheck
};
