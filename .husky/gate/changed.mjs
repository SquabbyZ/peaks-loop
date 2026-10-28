// .husky/gate/changed.mjs
// Changed mode — the push path: base resolution, the diff list, the deleted-file
// rule, and the comparison it shares with staged mode. Hoisted VERBATIM out of
// `.husky/peaks-gate.mjs` by rid `2026-10-02-wave9-gate-entry-split`.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, inScope, outOfScopeNotice, rel, reportEmpty } from './context.mjs';
import { ratchetFiles } from './ratchet.mjs';

// ---------------------------------------------------------------------------
// changed mode — invoked by pre-push with the diff of the commits being pushed
// ---------------------------------------------------------------------------
// WHY THE PUSH GATE CHECKS CHANGED FILES AND NOT THE WHOLE REPO
// ------------------------------------------------------------
// The whole-repo ratchet is ~9 type-aware eslint programs (each rebuilding the
// TS program) plus a whole-program `tsc`. Measured 2026-09-19 on a healthy
// machine that was ~90s; measured on this host 2026-09-23 it is 8+ minutes.
// A push gate that costs minutes stops being a "check before I push" and starts
// being a thing people skip with `--no-verify` — and a gate that gets skipped is
// worse than no gate, because it is also believed.
//
// The per-file check is not a weaker check. It ENTAILS the whole-repo one:
//
//     every changed file ≤ its own baseline in `.peaks/lint/gate-baseline.json`
//     AND every new file contributes 0
//     AND every deleted file contributes 0
//   ⟹ total = Σ(untouched files' baseline) + Σ(changed files' actual) + 0
//            ≤ Σ(all baselines) ≤ the whole-repo ceiling.
//
// The baseline stores a number PER FILE, so "each file ≤ its own line" is not
// an approximation of the total check — it IS the total check, decomposed. The
// whole-repo run is therefore REDUNDANT FOR THE TOTALS.
//
// What it is not redundant for: growth on a file nobody touched, caused by
// config drift (a rule switched off/on, a phantom rule appearing, a coverage
// hole opening). That class is real, it is rare, it is nobody's commit, and it
// costs minutes — so it belongs in CI, where `.github/workflows/ci.yml` now runs
// `node .husky/peaks-gate.mjs repo` (step "Whole-repo lint ratchet", in the
// `vitest + build` job, right after Build — the tsc leg needs `packages/*/dist`
// and Build is what creates it). Nothing was dropped; the expensive half moved
// to the one place that can afford to pay for it on every push.
//
// The three details below each come from a real failure; none of them is
// defensive decoration.
const CHANGED_BASE_ENV = 'PEAKS_GATE_CHANGED_BASE';
const CHANGED_BASE_DEFAULT = 'origin/main';
// Tried ONLY when the env override is absent. A missing base must never turn
// this gate green: a gate whose answer is "could not measure, so pass" is a
// gate that fails open on exactly the checkouts (fresh clone, no remote) where
// nobody would notice.
const CHANGED_BASE_FALLBACKS = ['@{upstream}', 'main'];
// A TAG PUSH HAS NO BRANCH COMMITS OF ITS OWN. `git push origin vX.Y.Z` runs this
// gate after main was pushed, so `origin/main...HEAD` is empty by construction and
// every release tag would be refused. git feeds pre-push one line per ref pushed,
// `<local ref> <local sha> <remote ref> <remote sha>`; `.husky/pre-push` passes those
// lines through PUSH_REFS_ENV. When every pushed ref is a tag, the base is the release
// tag before the tagged commit, so the gate measures what this release changed.
const PUSH_REFS_ENV = 'PEAKS_PUSH_REFS';
const TAG_REF_PREFIX = 'refs/tags/';
const PUSH_LINE_FIELDS = 4;

/**
 * THE OTHER AXES ON THE PUSH PATH, for the empty-change-set sentence.
 *
 * WHY THE PUSH PATH NEEDS THIS AND THE COMMIT PATH DID NOT. On the commit path
 * the other axis is measured INSIDE this gate — the wide formatting leg
 * (`.husky/gate/wide-format.mjs`) runs over the staged files the lint scope
 * drops — so the gate knows whether it read anything and says so. On the push
 * path the other axes are OTHER LEGS of the hook: leg 1
 * (`node .husky/format-check-ratchet.mjs`) compares the WHOLE TREE on the
 * formatting axis, and leg 3 (`pnpm test:changed`) compares the affected test
 * suites.
 *
 * WITHOUT THIS NOTE THE PUSH PATH SAID SOMETHING FALSE. An empty change set on
 * this path printed "NOTHING WAS COMPARED", one line below the whole-tree
 * formatting ratchet's own verdict — so a reader was told that nothing had been
 * compared when the tree HAD been compared, by the leg above. The per-file
 * ratchet compared nothing; the tree was compared on other axes. Those are two
 * different facts, and the sentence now names both.
 */
const PUSH_OTHER_AXES =
  'This sentence is about the per-file ratchet alone. The push hook measures the same ' +
  'tree on other axes: leg 1 (`node .husky/format-check-ratchet.mjs`) compares the WHOLE ' +
  'TREE on the formatting axis, and leg 3 (`pnpm test:changed`) compares the affected test ' +
  'suites — each of them prints its own line.';

function gitOut(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
}

/** The commit a ref points at, or null when it does not resolve. */
function revParse(ref) {
  try {
    return gitOut(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).trim() || null;
  } catch {
    return null; // `--quiet` makes a bad ref a silent exit 1, not a poison message
  }
}

/** The tagged commits of a tag-only push, or null when any pushed ref is not a tag. */
function taggedCommitsOf(pushRefs) {
  const lines = pushRefs
    .split('\n')
    .map((l) => l.trim().split(/\s+/))
    .filter((f) => f.length === PUSH_LINE_FIELDS);
  if (lines.length === 0 || !lines.every((f) => f[2].startsWith(TAG_REF_PREFIX))) return null;
  return [...new Set(lines.map((f) => f[1]))];
}

/** The release tag reachable from the parent of `commit`, or null when there is none. */
function previousTagBefore(commit) {
  try {
    return gitOut(['describe', '--tags', '--abbrev=0', `${commit}^`]).trim() || null;
  } catch {
    return null; // `describe` exits non-zero when no tag is reachable; the caller refuses
  }
}

function resolveChangedBase() {
  const override = process.env[CHANGED_BASE_ENV];
  return override ? [override] : [CHANGED_BASE_DEFAULT, ...CHANGED_BASE_FALLBACKS];
}

/** The base for a branch push: the first candidate that resolves, or null after saying why. */
function branchPushBase() {
  const candidates = resolveChangedBase();
  // MEMO: an explicit override gets NO fallback. `PEAKS_GATE_CHANGED_BASE=typo`
  // must fail loudly, not quietly degrade onto `main` — otherwise the switch
  // exists to make the gate unverifiable.
  const base = candidates.map((ref) => ({ ref, sha: revParse(ref) })).find((c) => c.sha !== null);
  if (base === undefined) {
    console.error(
      `peaks-gate: cannot compute the changed set — none of [${candidates.join(', ')}] resolves.\n` +
        '  REFUSING to pass. A gate that goes green because it could not measure is not a gate.\n' +
        '  Fix: `git fetch origin main` (or push the branch to a remote first).\n' +
        `  To point this mode at another ref deliberately: ${CHANGED_BASE_ENV}=<ref>\n`
    );
    return null;
  }
  return { ref: base.ref, sha: base.sha, tip: 'HEAD' };
}

/**
 * The base for a tag-only push: the release tag before the tagged commit. Null
 * (after saying why) when it cannot be resolved. A tag push that cannot name its
 * previous release refuses; it never passes on an empty or unmeasured set.
 */
function tagPushBase(taggedShas) {
  if (taggedShas.length !== 1) {
    console.error(
      `peaks-gate: this push names ${taggedShas.length} different tagged commits, and one base ` +
        'cannot cover them.\n' +
        '  REFUSING to pass. Push one tag at a time, or name a base deliberately: ' +
        `${CHANGED_BASE_ENV}=<ref> node .husky/peaks-gate.mjs changed\n`
    );
    return null;
  }
  const commit = revParse(taggedShas[0]);
  const prev = commit === null ? null : previousTagBefore(commit);
  const sha = prev === null ? null : revParse(prev);
  if (sha === null) {
    console.error(
      `peaks-gate: cannot find the release tag before ${taggedShas[0]} — the tagged ` +
        'commit does not resolve, or no release tag is reachable from its parent.\n' +
        '  REFUSING to pass. With no previous release there is nothing to measure this one against.\n' +
        `  To point this mode at another ref deliberately: ${CHANGED_BASE_ENV}=<ref>\n`
    );
    return null;
  }
  return { ref: prev, sha, tip: commit };
}

/** The base this push is measured against, or null after saying why it cannot be measured. */
function pushBase() {
  // An explicit override names the base itself: it wins over the tag rule, with no fallback.
  if (process.env[CHANGED_BASE_ENV]) return branchPushBase();
  const tagged = taggedCommitsOf(process.env[PUSH_REFS_ENV] ?? '');
  return tagged === null ? branchPushBase() : tagPushBase(tagged);
}

async function changedMode() {
  const base = pushBase();
  if (base === null) return 1;

  const head = revParse('HEAD');
  if (head !== null && base.sha === head) {
    console.error(
      `peaks-gate: ${base.ref} resolves to HEAD (${head.slice(0, 8)}), so the changed set is empty\n` +
        '  by construction. REFUSING to report that as a pass: "nothing to compare" and\n' +
        '  "compared and clean" are different results, and only one of them is evidence.\n' +
        '  git runs pre-push for a TAG push too, even when every branch commit is already on\n' +
        '  the remote, so an empty branch diff is the normal shape of a tag push. A tag-only\n' +
        '  push is measured against the previous release tag (unless an override names a\n' +
        '  base), so reaching this line means that derivation did not run. If you are\n' +
        '  running the gate by hand, name a base: ' +
        `${CHANGED_BASE_ENV}=<ref> node .husky/peaks-gate.mjs changed\n`
    );
    return 1;
  }

  let raw;
  try {
    // `-c core.quotepath=false`: with git's default, a non-ASCII path is printed
    // C-quoted ("src/a\303\251.ts"), which would then fail BOTH the existence
    // test and the baseline lookup and be reported as a deleted file — i.e. a
    // silent skip dressed up as a legitimate one. The repo's paths are ASCII
    // today; this closes the class rather than relying on that staying true.
    //
    // The ref is NOT named here: the base of a tag push is a TAG NAME, and a tag
    // name is repository-controlled. git accepts a ref like `refs/tags/--output=x`
    // (verified 2026-10-28: `git update-ref` creates it), so passing the name as
    // an argument would let a pushed tag be read as a git OPTION. Diffing by the
    // resolved SHA closes that class: a SHA is hex and cannot be an option.
    raw = gitOut([
      '-c',
      'core.quotepath=false',
      'diff',
      '--name-only',
      `${base.sha}...${base.tip}`
    ]);
  } catch (err) {
    const why = String(err.stderr ?? err.message)
      .trim()
      .split('\n')[0];
    console.error(
      `peaks-gate: git diff ${base.ref}...${base.tip} failed — cannot compute the changed set.\n` +
        `  ${why}\n` +
        '  REFUSING to pass.\n'
    );
    return 1;
  }

  const listed = raw
    .split('\n')
    .map((l) => rel(l.trim()))
    .filter((l) => l !== '');
  // H2 (rid `2026-10-03-w10-rescope-a`): the out-of-scope code files in this
  // push are named BEFORE they are dropped — the exemption is a printed fact,
  // not a quiet filter.
  const dropped = outOfScopeNotice('pushed', listed);
  const scoped = listed.filter(inScope);

  // DELETED FILES CONTRIBUTE 0 — and must not be handed to eslint.
  //
  // This is not hypothetical: batch B1 deleted a file without staging the
  // deletion, the gate asked eslint about a path that no longer existed, eslint
  // fail-closed on it (correctly — "you asked me about a file and I have nothing
  // to say" is not a license to read 0), and the push was blocked by a false red
  // on a path that contributed nothing to any total. Existence on disk is the
  // test, not `--diff-filter=D`: the git-level filter only sees deletions that
  // were COMMITTED, while a deletion that is still sitting in the working tree
  // is exactly the B1 shape. One filter covers both, and it is printed, so a
  // path dropped by mistake is visible instead of silent.
  //
  // Renames need no special case: with git's default rename detection
  // `--name-only` lists the NEW path (checked against its own baseline line)
  // and not the old one, so a rename is neither a false red nor a skip. Adding
  // `--no-renames` would be worse, not safer — it decomposes every rename into
  // "delete the old path, add the new one", which forces the new path's
  // inherited debt through the "a NEW file must be clean" rule.
  const files = [];
  const missing = [];
  for (const f of scoped) {
    if (existsSync(resolve(ROOT, f))) files.push(f);
    else missing.push(f);
  }

  console.log(
    `peaks-gate: changed-file ratchet vs ${base.ref} (${base.sha.slice(0, 8)}) — ` +
      `${files.length} in-scope file(s) in the changed set.`
  );
  if (missing.length > 0) {
    console.log(
      `peaks-gate: ${missing.length} in-scope path(s) in the diff no longer exist on disk ` +
        'and contribute 0 (not handed to eslint):'
    );
    for (const f of missing) console.log(`    - ${f}`);
  }

  if (files.length === 0) return reportEmpty(`changed vs ${base.ref}`, dropped, PUSH_OTHER_AXES);
  return ratchetFiles(files, 'changed');
}

export { changedMode, revParse, resolveChangedBase };
