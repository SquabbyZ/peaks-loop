// .husky/gate/staged-size.mjs
// The COMMIT path's file-size leg — the one leg backlog §9.46 asked for.
//
// THE DEFECT. `staged` mode ran eslint and prettier over the lint-scope part of the
// staged list and NOTHING measured size, while the RD→implemented transition refused
// the very same file and named its growth. Measured 2026-10-14: `node
// .husky/peaks-gate.mjs staged tests/unit/lint/_file-size-hooks-fixture.ts`, with that
// file grown from 501 raw lines to 504 against its cap of 500, printed "NOTHING WAS
// COMPARED" and exited 0 — because `tests/**` is outside the lint scope, so the file
// never reached a leg at all. The transition path, on the same file and the same
// growth, exited 1 naming `lines 504, cap 500, previousLines 501`.
//
// WHY THIS LEG READS `all` AND NOT `files`. The two are not the same list: `files` is
// `all` filtered to the lint scope, and `tests/**` — where 34 files sit over their 500
// cap — is OUTSIDE that scope by owner decision. A file-size leg hung off `files` would
// therefore have missed the exact file the defect was measured on. It takes the whole
// staged argv and lets the POLICY decide which paths it measures, which is also why a
// staged `.md` or a staged `.peaks/` artifact is named as out of scope rather than
// counted here.
//
// NO SECOND COPY OF THE RULE (the reason this slice exists). This module holds the
// spawn, the fail-closed envelope checks and the wording — and no threshold, no
// comparison and no notion of what "grew" means. It spawns
// `scripts/lint/file-size-delta.ts`, which calls the SAME `scanFileSize` the
// transition path and `peaks scan file-size` call. The acceptance criterion is
// therefore not "the two agree" (there are not two) but "there is one: this leg
// reports a violation exactly when the shared function does".

import { execFileSync } from 'node:child_process';
import { ROOT } from './context.mjs';
import { FS_DELTA_TOOL, TSX_CLI } from '../../.husky/peaks-gate-file-size.mjs';

/** The population and the measurement, for the arms that read them back. */
export function measureFileSizeDelta(files, cwd = ROOT) {
  let raw = '';
  try {
    raw = execFileSync('node', [TSX_CLI, FS_DELTA_TOOL, '--json', ...files], {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024
    });
  } catch (err) {
    // Exit 1 means the tool FOUND growth; the envelope is still on stdout, the same
    // shape as eslint's report and the census's. An empty stdout is a tool that
    // could not run, and that is a failure rather than a zero.
    const out = typeof err.stdout === 'string' ? err.stdout : '';
    if (out.trim() === '') {
      const why = String(err.stderr ?? err.message)
        .trim()
        .split('\n')[0];
      return {
        failure: why === '' ? 'produced neither an envelope nor a message' : why,
        env: null
      };
    }
    raw = out;
  }
  let env;
  try {
    env = JSON.parse(raw);
  } catch {
    return { failure: `${FS_DELTA_TOOL} --json produced no parseable envelope`, env: null };
  }
  const problem = envelopeProblem(env);
  return problem === null ? { failure: null, env } : { failure: problem, env: null };
}

/**
 * Why this envelope may not be believed, or `null` when it may.
 *
 * FAIL-CLOSED on shape, never on SIZE. The census refuses when its `countedFiles` is 0,
 * because a whole-tree row that measured nothing is indistinguishable from a whole tree
 * that is clean. Here `checkedFiles: 0` is a legitimate answer a commit can produce: a
 * change set made only of `.md` files and `.peaks/` artifacts contains no file the
 * policy covers, and that is a measurement, not a missing one. Refusing it would block
 * every docs-only commit. What must not go unread is an envelope that cannot say.
 */
function envelopeProblem(env) {
  if (env === null || typeof env !== 'object' || Array.isArray(env)) {
    return `${FS_DELTA_TOOL} produced no envelope object`;
  }
  if (!Array.isArray(env.violations)) {
    return `${FS_DELTA_TOOL} produced an envelope with no \`violations\` array`;
  }
  if (!Number.isInteger(env.checkedFiles) || env.checkedFiles < 0) {
    return `${FS_DELTA_TOOL} produced an envelope with no non-negative integer \`checkedFiles\``;
  }
  if (!Number.isInteger(env.scope?.countedFiles) || env.scope.countedFiles < 0) {
    return `${FS_DELTA_TOOL} produced an envelope that does not say how many paths it was handed`;
  }
  for (const cap of [env.caps?.defaultCap, env.caps?.testsCap]) {
    if (!Number.isInteger(cap) || cap <= 0) {
      return `${FS_DELTA_TOOL} produced an envelope with no usable caps to have judged against`;
    }
  }
  if (typeof env.convention !== 'string' || env.convention === '') {
    return `${FS_DELTA_TOOL} produced an envelope that does not name the line convention`;
  }
  return null;
}

/**
 * The staged paths the envelope accounts for by name, subtracted from the number the
 * caller handed in. What is left is what `scanFileSize` skipped before it classified
 * anything — a path git reports no change for against HEAD, a deletion among them.
 * Reported rather than left implicit: "0 measured" must be readable as a partition of
 * the list the hook was given, never as a bare zero.
 */
function notReportedAsChanged(env) {
  const byName =
    env.checkedFiles +
    env.outOfScopeFiles.length +
    env.exemptFiles.length +
    env.deletedFiles.length;
  return env.scope.countedFiles - byName;
}

/** One line of what was measured — and, when nothing was, that it was nothing. */
function describeStagedRun(env) {
  const caps = `the caps ${env.caps.defaultCap} (src/packages/scripts) / ${env.caps.testsCap} (tests/)`;
  const rest = [
    `${env.outOfScopeFiles.length} outside the policy's scope`,
    `${env.exemptFiles.length} exempt`,
    `${env.deletedFiles.length} gone from disk`,
    `${notReportedAsChanged(env)} not reported as changed by git`
  ].join(', ');
  if (env.checkedFiles === 0) {
    return (
      `staged file-size ratchet — NOTHING WAS MEASURED. Of ${env.scope.countedFiles} staged ` +
      `path(s), 0 is one the file-size policy covers and git reports as changed (${rest}). ` +
      'That is not the same sentence as "nothing grew".'
    );
  }
  return (
    `staged file-size ratchet — ${env.checkedFiles} of ${env.scope.countedFiles} staged ` +
    `path(s) measured against ${caps} (${rest}): ${env.acceptedOverCapFiles.length} already ` +
    `over cap and not grown, ${env.violations.length} grown past their cap.`
  );
}

/** One violation, in the words the transition path's refusal already uses. */
function describeViolation(v) {
  const growth =
    v.previousLines === null
      ? `created at ${v.lines} lines`
      : `was ${v.previousLines} at HEAD, +${v.lines - v.previousLines}`;
  return `${v.file}: ${v.lines} lines > cap ${v.cap} (${growth})`;
}

/**
 * The leg. Returns `{ line, refusal }`: `line` is always the measurement (so the
 * evidence is printed even when the verdict is a refusal), `refusal` is the block the
 * caller turns into exit 1.
 */
export function stagedSizeLeg(files, cwd = ROOT) {
  if (files.length === 0) return { line: null, refusal: null, violations: [] };
  const m = measureFileSizeDelta(files, cwd);
  if (m.failure !== null) {
    return {
      line: null,
      violations: [],
      refusal:
        `REFUSING to measure the staged file-size ratchet — ${m.failure}.\n` +
        '  A tool that cannot run is a gate FAILURE, not a zero: "nothing grew" and\n' +
        '  "nothing was compared" look identical in an exit code.\n' +
        `  Run \`node ${TSX_CLI} ${FS_DELTA_TOOL} <file>\` to see why.`
    };
  }
  const line = describeStagedRun(m.env);
  const violations = m.env.violations;
  if (violations.length === 0) return { line, refusal: null, violations };
  return {
    line,
    violations,
    refusal:
      `REFUSING ${violations.length} staged file(s) this change grew past the file-size cap:\n` +
      violations.map((v) => `  ✗ ${describeViolation(v)}`).join('\n') +
      '\n\n  A file already over its cap may be edited freely; only GROWTH is refused, and\n' +
      '  the whole-tree rows in `repo` mode are unaffected. Split the file into modules.\n' +
      '  The same rule on the same change set: `peaks scan file-size --project .`'
  };
}
