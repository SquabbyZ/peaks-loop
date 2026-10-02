// .husky/gate/changed.mjs
// Changed mode — the push path: base resolution, the diff list, the deleted-file
// rule, and the comparison it shares with staged mode. Hoisted VERBATIM out of
// `.husky/peaks-gate.mjs` by rid `2026-10-02-wave9-gate-entry-split`.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, inScope, rel, reportEmpty } from './context.mjs';
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

function resolveChangedBase() {
  const override = process.env[CHANGED_BASE_ENV];
  return override ? [override] : [CHANGED_BASE_DEFAULT, ...CHANGED_BASE_FALLBACKS];
}

async function changedMode() {
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
    return 1;
  }

  const head = revParse('HEAD');
  if (head !== null && base.sha === head) {
    console.error(
      `peaks-gate: ${base.ref} resolves to HEAD (${head.slice(0, 8)}), so the changed set is empty\n` +
        '  by construction. REFUSING to report that as a pass: "nothing to compare" and\n' +
        '  "compared and clean" are different results, and only one of them is evidence.\n' +
        '  and clean" are different results and only one of them is evidence.\n' +
        '  Normally git does not run pre-push when there is nothing to push; if you are\n' +
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
    raw = gitOut(['-c', 'core.quotepath=false', 'diff', '--name-only', `${base.ref}...HEAD`]);
  } catch (err) {
    const why = String(err.stderr ?? err.message)
      .trim()
      .split('\n')[0];
    console.error(
      `peaks-gate: git diff ${base.ref}...HEAD failed — cannot compute the changed set.\n` +
        `  ${why}\n` +
        '  REFUSING to pass.\n'
    );
    return 1;
  }

  const listed = raw
    .split('\n')
    .map((l) => rel(l.trim()))
    .filter((l) => l !== '' && inScope(l));

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
  for (const f of listed) {
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

  if (files.length === 0) return reportEmpty(`changed vs ${base.ref}`);
  return ratchetFiles(files, 'changed');
}

export { changedMode, revParse, resolveChangedBase };
